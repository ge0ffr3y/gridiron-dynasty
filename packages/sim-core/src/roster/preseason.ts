/**
 * Preseason games (Phase 8): a showcase for players fighting for a roster
 * spot. Starters rest, so backups and camp bodies play. Each player's
 * production per snap becomes a showcase grade (50 = typical for his position,
 * shrunk toward 50 when he barely played). At cutdown a strong grade can win a
 * bubble player a spot, and a strong showing from a player with room to grow
 * (hidden potential above his current overall) and good work habits earns a
 * modest boost: his upside shows, without anyone seeing the hidden numbers.
 * Phase 9's development model takes over later. Stats are kept apart from the
 * season's.
 */
import {
  ATTRIBUTES,
  OVERALL_WEIGHTS,
  overallAt,
  Rng,
  streamSeed,
  type Position,
} from "@fgm/foundation";
import {
  DEPTH_SLOTS,
  LONGEST_STATS,
  simulateGame,
  type DepthChart,
  type StatKey,
  type StatLine,
} from "@fgm/game-engine";
import { recordTransaction } from "../contracts/operations";
import type { Game, League, Player } from "../league/schema";
import { seasonDates } from "../season/calendar";
import { DEPTH_CHART } from "../season/config";
import { gameDepthChart } from "../season/depthChart";
import { applyInjuries } from "../season/injuries";
import { conditionsFor, drawWeather } from "../season/weather";
import type { SimHooks } from "../season/flow";
import { PRESEASON } from "./config";

/** Pairs the 32 teams for each preseason week (no division rivals, home sides alternate). */
export function schedulePreseason(league: League): void {
  const dates = seasonDates(league.rules, league.season).preseasonSaturdays;
  const rng = new Rng(streamSeed(league.meta.seed, `preseason:${league.season}`));
  const division = new Map(league.teams.map((t) => [t.id, t.divisionId]));
  const met = new Set<string>();
  const homeGames = new Map(league.teams.map((t) => [t.id, 0]));
  league.preseasonGames = [];
  dates.forEach((date, w) => {
    for (let attempt = 0; attempt < 200; attempt++) {
      const order = rng.shuffle(league.teams.map((t) => t.id));
      const pairs: [string, string][] = [];
      for (let i = 0; i < order.length; i += 2) pairs.push([order[i]!, order[i + 1]!]);
      const ok = pairs.every(
        ([a, b]) => division.get(a) !== division.get(b) && !met.has([a, b].sort().join("-")),
      );
      if (!ok && attempt < 199) continue;
      for (const [a, b] of pairs) {
        met.add([a, b].sort().join("-"));
        const [home, away] = homeGames.get(a)! <= homeGames.get(b)! ? [a, b] : [b, a];
        homeGames.set(home, homeGames.get(home)! + 1);
        league.preseasonGames.push({
          id: PRESEASON.firstGameId + league.preseasonGames.length,
          season: league.season,
          round: "preseason",
          week: w + 1,
          date,
          homeId: home,
          awayId: away,
          neutral: false,
          result: null,
          boxScore: null,
          weather: null,
        });
      }
      break;
    }
  });
}

/** The chart a team takes into a preseason game: its starters rest when there's someone behind them. */
export function preseasonDepthChart(league: League, teamId: string): DepthChart {
  const full = gameDepthChart(league, teamId);
  const resting = new Set<number>();
  for (const slot of DEPTH_SLOTS) {
    const starters = DEPTH_CHART.starters[slot];
    if (full[slot].length > starters)
      for (const p of full[slot].slice(0, starters)) resting.add(p.id);
  }
  const depth = {} as DepthChart;
  for (const slot of DEPTH_SLOTS) {
    const fresh = full[slot].filter((p) => !resting.has(p.id));
    // Never leave a spot short: starters fill in only where nobody else can.
    const need = Math.max(DEPTH_CHART.starters[slot], 1);
    depth[slot] =
      fresh.length >= need ? fresh : [...fresh, ...full[slot].filter((p) => resting.has(p.id))];
  }
  return depth;
}

function addLine(into: StatLine, line: StatLine): void {
  for (const [key, value] of Object.entries(line) as [StatKey, number][]) {
    const current = into[key];
    into[key] = LONGEST_STATS.includes(key)
      ? Math.max(current ?? value, value)
      : (current ?? 0) + value;
  }
}

/** Plays one preseason week. */
export function playPreseasonWeek(league: League, week: number, hooks: SimHooks = {}): void {
  const games = league.preseasonGames.filter((g) => g.week === week && g.result === null);
  const depth = new Map(
    games.flatMap((g) => [g.homeId, g.awayId]).map((id) => [id, preseasonDepthChart(league, id)]),
  );
  const players = new Map(league.players.map((p) => [p.id, p]));
  for (const g of games) {
    const weather = drawWeather(league, g);
    const output = simulateGame(
      {
        home: { id: g.homeId, depth: depth.get(g.homeId)! },
        away: { id: g.awayId, depth: depth.get(g.awayId)! },
        neutral: g.neutral,
        conditions: conditionsFor(league, g, weather),
        playoff: false,
        rules: league.rules.game,
      },
      new Rng(streamSeed(league.meta.seed, `preseason-game:${league.season}:${g.id}`)),
    );
    g.result = {
      homeScore: output.homeScore,
      awayScore: output.awayScore,
      homeTouchdowns: output.homeTouchdowns,
      awayTouchdowns: output.awayTouchdowns,
      overtime: output.overtime,
    };
    g.boxScore = output.box;
    g.weather = weather;
    for (const entry of output.box.players) {
      const p = players.get(entry.id);
      if (!p) continue;
      if (p.preseason?.season !== league.season)
        p.preseason = { season: league.season, line: {}, grade: null };
      addLine(p.preseason.line, entry.line);
    }
    // Camp injuries count: a player hurt in August may start the season on a reserve list.
    applyInjuries(league, g, output.injuries, players);
    hooks.onGame?.(g, output);
  }
}

/** Production per snap by position (higher is better), from the preseason stat line. */
function production(position: Position, s: StatLine): { value: number; snaps: number } | null {
  const v = (k: StatKey) => s[k] ?? 0;
  const off = v("offSnaps");
  const def = v("defSnaps");
  const per = (x: number, snaps: number) => ({ value: snaps > 0 ? x / snaps : 0, snaps });
  switch (position) {
    case "QB":
      return per(v("passEpa") + v("rushEpa"), Math.max(v("dropbacks") + v("rushAtt"), 0) || off);
    case "RB":
    case "FB":
      return per(
        v("rushEpa") +
          v("recYds") / 10 +
          (6 * (v("rushTd") + v("recTd"))) / 10 -
          2 * v("fumblesLost"),
        off,
      );
    case "WR":
    case "TE":
      return per(v("recYds") / 10 + (6 * v("recTd")) / 10 - v("drops"), off);
    case "OT":
    case "OG":
    case "C":
      return per(-v("pressuresAllowed") - v("penalties"), off);
    case "EDGE":
    case "DT":
      return per(v("pressures") + 2 * v("sacks") + 0.4 * v("tackles") - 0.5 * v("missedTkl"), def);
    case "LB":
    case "S":
      return per(
        v("tackles") + 3 * v("defInt") + v("passDef") + 2 * v("sacks") - v("missedTkl"),
        def,
      );
    case "CB":
      return per(2 * v("passDef") + 4 * v("defInt") + 0.5 * v("tackles") - v("missedTkl"), def);
    case "K":
      return v("fga") + v("xpa") > 0
        ? { value: (v("fgm") + v("xpm")) / (v("fga") + v("xpa")), snaps: 5 * (v("fga") + v("xpa")) }
        : null;
    case "P":
      return v("punts") > 0 ? { value: v("puntYds") / v("punts"), snaps: 5 * v("punts") } : null;
    case "LS":
      return null;
  }
}

/**
 * After the last preseason week: each player's grade against others at his position, then
 * the boosts for standouts with room to grow. Returns how many players got a boost.
 */
export function gradePreseason(league: League): number {
  const graded = league.players.filter(
    (p) => p.teamId !== null && p.preseason?.season === league.season,
  );
  const byPosition = new Map<Position, { p: Player; value: number; snaps: number }[]>();
  for (const p of graded) {
    const prod = production(p.position, p.preseason!.line);
    if (!prod || prod.snaps <= 0) continue;
    const list = byPosition.get(p.position) ?? [];
    list.push({ p, ...prod });
    byPosition.set(p.position, list);
  }
  let boosted = 0;
  for (const [position, list] of [...byPosition].sort((a, b) => a[0].localeCompare(b[0]))) {
    const total = list.reduce((a, x) => a + x.snaps, 0);
    const mean = list.reduce((a, x) => a + x.value * x.snaps, 0) / total;
    const variance =
      list.reduce((a, x) => a + x.snaps * (x.value - mean) * (x.value - mean), 0) / total;
    const sd = Math.sqrt(variance) || 1;
    const ranked: { p: Player; grade: number }[] = [];
    for (const x of list.sort((a, b) => a.p.id - b.p.id)) {
      const weight = x.snaps / (x.snaps + PRESEASON.gradeShrinkSnaps);
      const grade = Math.round(
        Math.max(
          0,
          Math.min(100, 50 + weight * ((x.value - mean) / sd) * PRESEASON.gradePointsPerSd),
        ),
      );
      x.p.preseason!.grade = grade;
      ranked.push({ p: x.p, grade });
    }
    ranked.sort((a, b) => b.grade - a.grade || a.p.id - b.p.id);
    ranked.forEach(({ p, grade }, i) => {
      if (grade < PRESEASON.standoutGrade) return;
      const gain = boostFor(p);
      if (gain <= 0) return;
      const percentile = Math.max(1, Math.round(((i + 1) / ranked.length) * 100));
      grow(p, gain);
      boosted += 1;
      recordTransaction(league, {
        type: "development",
        teamIds: [p.teamId!],
        playerIds: [p.id],
        text: `${p.firstName} ${p.lastName} (${position}) had a strong preseason and improved.`,
        reason: `Strong preseason: grade ${grade}, top ${percentile}% of preseason ${position}s. Players with room to grow and good work habits build on a showing like that.`,
      });
    });
  }
  return boosted;
}

/** The boost a standout earns: up to the maximum, never past his potential, scaled by work ethic. */
function boostFor(p: Player): number {
  const room = p.hidden.potential - overallAt(p.ratings, p.position);
  if (room <= 0) return 0;
  const habits = Math.min(1, p.hidden.workEthic / PRESEASON.fullBoostWorkEthic);
  return Math.min(room, Math.round(PRESEASON.maxBoost * habits));
}

/** Raises the skills (not physical traits) that count at his position until his overall rises by `gain`. */
function grow(p: Player, gain: number): void {
  const target = overallAt(p.ratings, p.position) + gain;
  const skills = ATTRIBUTES.filter(
    (a) => a.group !== "physical" && (OVERALL_WEIGHTS[p.position][a.key] ?? 0) > 0,
  ).map((a) => a.key);
  for (let step = 0; step < 10 && overallAt(p.ratings, p.position) < target; step++)
    for (const key of skills) p.ratings[key] = Math.min(99, p.ratings[key] + 1);
}

export function preseasonGame(league: League, id: number): Game | undefined {
  return league.preseasonGames.find((g) => g.id === id);
}
