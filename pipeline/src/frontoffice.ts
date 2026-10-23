/**
 * Front offices (Phase 13): `npm run pipeline -- frontoffice` writes calibration/frontoffice.json
 * (counts and shapes only, no names) and, for the real league, a private file of each 2025
 * front office's habits (pipeline/private/out/front-office-habits.json).
 *
 * - Trades 2015-25 (nflverse/nfldata trades.csv): how many a year, of what kind, when in the
 *   year, who gets traded (age, position) and which picks move.
 * - Parity 2002-25 (nflverse schedules): how much a team's record carries over, playoff repeats,
 *   different champions per decade, and how often long playoff runs and long losing runs happen.
 * - Executive turnover: GM changes a year (a researched count; sources in the note).
 * - Dead money as a share of the cap in 2026, across teams (from the private cap pages; only the
 *   spread is committed).
 * - Private: the 2025 GMs (pipeline/private/gms-2025.csv: team, name, year hired) and what their
 *   teams did on their watch (trades a year, trading up or down on draft day), each owner's
 *   franchise's head-coach turnover since 2000, and each team's 2026 dead money share.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import draftData from "../../calibration/draft.json";
import { ensure, readCsv, RELEASE, ROOT, round, type Row } from "./matchups";
import { fetchTeamPages, readTeamPages } from "./league/capPages";
import { leagueTeam } from "./league/inputs";

const TRADE_SEASONS = [2015, 2025] as const;
const PARITY_SEASONS = [2002, 2025] as const;
const PRIVATE = join(ROOT, "pipeline", "private");
const GMS_FILE = join(PRIVATE, "gms-2025.csv");
const HABITS_FILE = join(PRIVATE, "out", "front-office-habits.json");

/** Franchises that moved: their old codes count as today's team. */
const FRANCHISE: Record<string, string> = { OAK: "LV", SD: "LAC", STL: "LA" };
const franchise = (code: string) => FRANCHISE[code] ?? code;

/** When in the league year a trade happened (by month-day of its date). */
const WINDOWS: [string, string][] = [
  ["beforeLeagueYear", "03-10"],
  ["leagueYearToDraft", "04-20"],
  ["draft", "05-13"],
  ["summer", "07-20"],
  ["camp", "09-08"],
  ["season", "12-32"],
];
const windowOf = (date: string) => WINDOWS.find(([, end]) => date.slice(5) < end)![0];

const num = (s: string | undefined) => (s && s !== "NA" && s !== "" ? Number(s) : null);
function quantiles(xs: number[]): {
  p10: number;
  p25: number;
  p50: number;
  p75: number;
  p90: number;
} {
  const s = [...xs].sort((a, b) => a - b);
  const q = (p: number) => round(s[Math.round(p * (s.length - 1))] ?? 0, 3);
  return { p10: q(0.1), p25: q(0.25), p50: q(0.5), p75: q(0.75), p90: q(0.9) };
}
const per = (n: number, years: number) => round(n / years, 1);

/** Position groups as the league uses them. */
function group(position: string): string {
  const map: Record<string, string> = {
    QB: "QB",
    RB: "RB",
    FB: "RB",
    WR: "WR",
    TE: "TE",
    T: "OL",
    OT: "OL",
    G: "OL",
    OG: "OL",
    C: "OL",
    OL: "OL",
    DE: "DL",
    DT: "DL",
    NT: "DL",
    DL: "DL",
    OLB: "LB",
    ILB: "LB",
    MLB: "LB",
    LB: "LB",
    CB: "DB",
    S: "DB",
    SS: "DB",
    FS: "DB",
    DB: "DB",
    K: "ST",
    P: "ST",
    LS: "ST",
  };
  return map[position] ?? "other";
}

interface Trade {
  id: string;
  season: number;
  date: string;
  teams: string[];
  items: Row[];
}

async function readTrades(): Promise<Trade[]> {
  const rows: Row[] = [];
  await readCsv(
    await ensure("trades.csv", "https://github.com/nflverse/nfldata/raw/master/data/trades.csv"),
    (r) => {
      rows.push(r);
    },
  );
  const byId = new Map<string, Row[]>();
  for (const r of rows) byId.set(r["trade_id"]!, [...(byId.get(r["trade_id"]!) ?? []), r]);
  return [...byId.entries()].map(([id, items]) => ({
    id,
    season: Number(items[0]!["trade_date"]!.slice(0, 4)),
    date: items[0]!["trade_date"]!,
    teams: [...new Set(items.flatMap((r) => [franchise(r["gave"]!), franchise(r["received"]!)]))],
    items,
  }));
}

/** Players' birth dates and positions by Pro Football Reference id. */
async function playerFacts(): Promise<Map<string, { birth: string; position: string }>> {
  const out = new Map<string, { birth: string; position: string }>();
  await readCsv(await ensure("players.csv.gz", `${RELEASE}/players/players.csv.gz`), (r) => {
    if (r["pfr_id"])
      out.set(r["pfr_id"], { birth: r["birth_date"] ?? "", position: r["position"] ?? "" });
  });
  return out;
}

function measureTrades(trades: Trade[], facts: Map<string, { birth: string; position: string }>) {
  const inRange = trades.filter(
    (t) => t.season >= TRADE_SEASONS[0] && t.season <= TRADE_SEASONS[1],
  );
  const years = TRADE_SEASONS[1] - TRADE_SEASONS[0] + 1;
  const byType = { picksOnly: 0, playersForPicks: 0, playersForPlayers: 0, mixed: 0 };
  const byWindow: Record<string, number> = Object.fromEntries(WINDOWS.map(([w]) => [w, 0]));
  const ages: number[] = [];
  const positions: Record<string, number> = {};
  const rounds: Record<string, number> = {};
  let players = 0;
  let picks = 0;
  let futurePicks = 0;
  for (const t of inRange) {
    byWindow[windowOf(t.date)]! += 1;
    const side = (team: string) => t.items.filter((r) => franchise(r["gave"]!) === team);
    // A pick row can also name the player later drafted with it: a pick counts as a pick.
    const isPick = (r: Row) => Boolean(r["pick_season"]);
    const isPlayer = (r: Row) => !isPick(r) && Boolean(r["pfr_id"]);
    const kinds = t.teams.map((team) => ({
      players: side(team).filter(isPlayer).length,
      picks: side(team).filter(isPick).length,
    }));
    const allPicks = kinds.every((k) => k.players === 0);
    const allPlayers = kinds.every((k) => k.picks === 0);
    const onePlayersOtherPicks =
      kinds.length === 2 &&
      kinds.some((k) => k.players > 0 && k.picks === 0) &&
      kinds.some((k) => k.players === 0 && k.picks > 0);
    if (allPicks) byType.picksOnly += 1;
    else if (allPlayers) byType.playersForPlayers += 1;
    else if (onePlayersOtherPicks) byType.playersForPicks += 1;
    else byType.mixed += 1;
    for (const r of t.items) {
      if (isPlayer(r)) {
        players += 1;
        const f = facts.get(r["pfr_id"]!);
        if (f?.birth) ages.push(Number(t.date.slice(0, 4)) - Number(f.birth.slice(0, 4)));
        const g = group(f?.position ?? "");
        positions[g] = (positions[g] ?? 0) + 1;
      } else if (isPick(r)) {
        picks += 1;
        const rd = num(r["pick_round"]);
        if (rd !== null) rounds[String(rd)] = (rounds[String(rd)] ?? 0) + 1;
        if (Number(r["pick_season"]) > t.season) futurePicks += 1;
      }
    }
  }
  return {
    seasons: TRADE_SEASONS,
    perYear: per(inRange.length, years),
    byType: Object.fromEntries(Object.entries(byType).map(([k, v]) => [k, per(v, years)])),
    byWindow: Object.fromEntries(Object.entries(byWindow).map(([k, v]) => [k, per(v, years)])),
    playersPerYear: per(players, years),
    playerAge: quantiles(ages),
    playersByGroup: Object.fromEntries(
      Object.entries(positions)
        .sort()
        .map(([k, v]) => [k, per(v, years)]),
    ),
    picksPerYear: per(picks, years),
    pickRounds: Object.fromEntries(
      Object.entries(rounds)
        .sort()
        .map(([k, v]) => [k, per(v, years)]),
    ),
    futurePickShare: round(futurePicks / Math.max(1, picks), 3),
    pickOnlyPrice: draftData.trades.pickOnlyPrice,
    note: `Trades ${TRADE_SEASONS.join("-")} from nflverse/nfldata trades.csv, by the year of the trade date. Windows by date: before March 10 (agreed before the League Year), to April 20, the draft (to May 12), summer (to July 20), camp and cuts (to September 8), the season. Ages are the year of the trade minus the birth year. pickOnlyPrice repeats draft.json's draft-day price spread (value given by the team moving up over value received): the real spread of overpays.`,
  };
}

interface TeamSeason {
  wins: number;
  games: number;
  playoffs: boolean;
  champion: boolean;
}

async function measureParity() {
  const seasons = new Map<string, TeamSeason>();
  const coaches = new Map<string, Map<string, number>>();
  const get = (team: string, season: number) => {
    const k = `${team}|${season}`;
    let s = seasons.get(k);
    if (!s) {
      s = { wins: 0, games: 0, playoffs: false, champion: false };
      seasons.set(k, s);
    }
    return s;
  };
  await readCsv(await ensure("games.csv.gz", `${RELEASE}/schedules/games.csv.gz`), (r) => {
    const season = Number(r["season"]);
    if (season < 2000 || season > PARITY_SEASONS[1]) return;
    const hs = num(r["home_score"]);
    const as = num(r["away_score"]);
    if (hs === null || as === null) return;
    const home = franchise(r["home_team"]!);
    const away = franchise(r["away_team"]!);
    if (r["game_type"] === "REG") {
      for (const [team, mine, theirs, coach] of [
        [home, hs, as, r["home_coach"]],
        [away, as, hs, r["away_coach"]],
      ] as [string, number, number, string][]) {
        const s = get(team, season);
        s.games += 1;
        s.wins += mine > theirs ? 1 : mine === theirs ? 0.5 : 0;
        const k = `${team}|${season}`;
        const c = coaches.get(k) ?? new Map<string, number>();
        c.set(coach, (c.get(coach) ?? 0) + 1);
        coaches.set(k, c);
      }
    } else {
      get(home, season).playoffs = true;
      get(away, season).playoffs = true;
      if (r["game_type"] === "SB") get(hs > as ? home : away, season).champion = true;
    }
  });
  const teams = [...new Set([...seasons.keys()].map((k) => k.split("|")[0]!))].sort();
  const share = (t: string, s: number) => {
    const x = seasons.get(`${t}|${s}`);
    return x && x.games > 0 ? x.wins / x.games : null;
  };
  const [from, to] = PARITY_SEASONS;
  // Year to year: correlation of win share, playoff repeats, worst to playoffs.
  const pairs: [number, number][] = [];
  let playoffRepeat = 0;
  let playoffTeams = 0;
  let worst = 0;
  let worstUp = 0;
  for (const t of teams)
    for (let s = from; s < to; s++) {
      const a = share(t, s);
      const b = share(t, s + 1);
      if (a === null || b === null) continue;
      pairs.push([a, b]);
      const now = seasons.get(`${t}|${s}`)!;
      const next = seasons.get(`${t}|${s + 1}`)!;
      if (now.playoffs) {
        playoffTeams += 1;
        if (next.playoffs) playoffRepeat += 1;
      }
      if (a <= 5 / 16) {
        worst += 1;
        if (next.playoffs) worstUp += 1;
      }
    }
  const mx = pairs.reduce((s, p) => s + p[0], 0) / pairs.length;
  const my = pairs.reduce((s, p) => s + p[1], 0) / pairs.length;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (const [x, y] of pairs) {
    sxy += (x - mx) * (y - my);
    sxx += (x - mx) * (x - mx);
    syy += (y - my) * (y - my);
  }
  // Different champions in each ten-season window.
  const champs: number[] = [];
  for (let s = from; s + 9 <= to; s++) {
    const set = new Set<string>();
    for (let y = s; y < s + 10; y++)
      for (const t of teams) if (seasons.get(`${t}|${y}`)?.champion) set.add(t);
    champs.push(set.size);
  }
  // Runs: five or more straight playoff seasons, four or more straight losing seasons.
  let playoffRuns = 0;
  let losingRuns = 0;
  let longestPlayoff = 0;
  let longestLosing = 0;
  for (const t of teams) {
    let p = 0;
    let l = 0;
    for (let s = from; s <= to + 1; s++) {
      const x = seasons.get(`${t}|${s}`);
      const sh = share(t, s);
      if (x?.playoffs) p += 1;
      else {
        if (p >= 5) playoffRuns += 1;
        longestPlayoff = Math.max(longestPlayoff, p);
        p = 0;
      }
      if (sh !== null && sh < 0.5) l += 1;
      else {
        if (l >= 4) losingRuns += 1;
        longestLosing = Math.max(longestLosing, l);
        l = 0;
      }
    }
  }
  const teamDecades = (teams.length * (to - from + 1)) / 10;
  // The spread of win share within a season (how far apart teams finish).
  const shares: number[] = [];
  for (const t of teams)
    for (let s = from; s <= to; s++) {
      const x = share(t, s);
      if (x !== null) shares.push(x);
    }
  const meanShare = shares.reduce((a, b) => a + b, 0) / shares.length;
  const sdShare = Math.sqrt(
    shares.reduce((a, b) => a + (b - meanShare) * (b - meanShare), 0) / shares.length,
  );
  return {
    measure: {
      seasons: PARITY_SEASONS,
      winShareSd: round(sdShare, 3),
      winShareCorrelation: round(sxy / Math.sqrt(sxx * syy), 3),
      playoffRepeatRate: round(playoffRepeat / playoffTeams, 3),
      worstToPlayoffsRate: round(worstUp / Math.max(1, worst), 3),
      championsPerDecade: {
        mean: round(champs.reduce((a, b) => a + b, 0) / champs.length, 2),
        min: Math.min(...champs),
        max: Math.max(...champs),
      },
      playoffRunsOf5PerTeamDecade: round(playoffRuns / teamDecades, 3),
      losingRunsOf4PerTeamDecade: round(losingRuns / teamDecades, 3),
      longestPlayoffRun: longestPlayoff,
      longestLosingRun: longestLosing,
      note: `Regular-season win share and postseason games ${PARITY_SEASONS.join("-")} from nflverse schedules, franchises that moved counted as one (OAK/LV, SD/LAC, STL/LA). Worst = 5 or fewer wins in 16 games (or the same share). A run is five or more straight playoff seasons, or four or more straight seasons under .500; per team per ten seasons.`,
    },
    coaches,
    seasons,
  };
}

/** Each franchise's head-coach changes since 2000 (the owner's patience, private). */
function coachChanges(coaches: Map<string, Map<string, number>>): Record<string, number> {
  const main = (m: Map<string, number> | undefined) =>
    m ? [...m].sort((a, b) => b[1] - a[1])[0]![0] : null;
  const out: Record<string, number> = {};
  for (const k of [...coaches.keys()].sort()) {
    const [team, s] = k.split("|") as [string, string];
    const season = Number(s);
    const now = coaches.get(k)!;
    const prev = main(coaches.get(`${team}|${season - 1}`));
    let n = 0;
    if (prev !== null && prev !== main(now)) n += 1;
    // A coach replaced during the season (more than one coach that season).
    if (now.size > 1) n += 1;
    out[team] = (out[team] ?? 0) + n;
  }
  return out;
}

/** Real GM turnover (researched; numbers only). */
const EXECUTIVES = {
  gmChangesPerYear: { mean: 4.5, range: [3, 7] as [number, number] },
  inSeasonGmFiringsPerYear: 0.4,
  note: "Judgment from news coverage of the 2021-25 hiring cycles: four new GMs in 2021, 2022, 2024 and 2025 among those still in place in 2025, one in 2023, plus hires since replaced; in-season GM firings about one every two or three years (2023, 2024). Sources: Pro Football Rumors, 'The NFL's longest-tenured GMs' (July 2025); NFL.com coaching and GM tracker (2025 cycle).",
};

export async function frontOffice(): Promise<void> {
  const trades = await readTrades();
  const facts = await playerFacts();
  const tradeMeasure = measureTrades(trades, facts);
  const parity = await measureParity();
  const changes = coachChanges(parity.coaches);

  // Dead money in 2026 by team, from the private cap pages (only the spread is committed).
  const deadShare: Record<string, number> = {};
  const rules = JSON.parse(readFileSync(join(ROOT, "rules", "2026.json"), "utf8"));
  const cap2026 = Number(rules.cap.salaryCapByYear["2026"]);
  if (existsSync(join(PRIVATE, "cap", "teams")) && cap2026 > 0) {
    const pages = readTeamPages(await fetchTeamPages());
    for (const [teamId, page] of pages) {
      const dead = page.gone.filter((g) => g.season === 2026).reduce((s, g) => s + g.capNumber, 0);
      deadShare[teamId] = dead / cap2026;
    }
  }
  const shares = Object.values(deadShare);
  const cap =
    shares.length > 0
      ? {
          season: 2026,
          deadMoneyShare: quantiles(shares),
          teamsAbove15Pct: shares.filter((x) => x > 0.15).length,
          teamsAbove10Pct: shares.filter((x) => x > 0.1).length,
          note: "Dead money as a share of the 2026 cap across the 32 teams, from each team's public cap page as archived near Feb 9, 2026 (private input; only the spread is kept). 'Cap hell' here: more than 15% of the cap dead.",
        }
      : null;

  const out = {
    trades: tradeMeasure,
    parity: parity.measure,
    executives: EXECUTIVES,
    ...(cap ? { cap } : {}),
  };
  writeFileSync(join(ROOT, "calibration", "frontoffice.json"), `${JSON.stringify(out, null, 2)}\n`);

  // Private: the 2025 GMs' habits on their watch, the owners' patience, dead money by team.
  if (existsSync(GMS_FILE)) {
    const gms = readFileSync(GMS_FILE, "utf8")
      .trim()
      .split("\n")
      .slice(1)
      .map((line) => {
        const [team, , hired] = line.split(",");
        return { team: team!, hired: Number(hired) };
      });
    const draftUps = new Map<string, { up: number; down: number }>();
    for (const t of trades) {
      const md = t.date.slice(5);
      if (md < "04-20" || md > "05-12" || t.teams.length !== 2) continue;
      const current = t.items.filter(
        (r) => Number(r["pick_season"]) === t.season && num(r["pick_number"]) !== null,
      );
      if (current.length === 0) continue;
      const best = current.sort((a, b) => num(a["pick_number"])! - num(b["pick_number"])!)[0]!;
      const upTeam = franchise(best["received"]!);
      const downTeam = franchise(best["gave"]!);
      for (const [team, dir] of [
        [upTeam, "up"],
        [downTeam, "down"],
      ] as const) {
        const k = `${team}|${t.season}`;
        const v = draftUps.get(k) ?? { up: 0, down: 0 };
        v[dir] += 1;
        draftUps.set(k, v);
      }
    }
    const habits: Record<string, unknown> = {};
    for (const gm of gms) {
      const first = Math.max(gm.hired, TRADE_SEASONS[0]);
      const span = Math.max(1, TRADE_SEASONS[1] - first + 1);
      const mine = trades.filter(
        (t) => t.season >= first && t.season <= TRADE_SEASONS[1] && t.teams.includes(gm.team),
      ).length;
      let up = 0;
      let down = 0;
      for (let s = first; s <= TRADE_SEASONS[1]; s++) {
        const v = draftUps.get(`${gm.team}|${s}`);
        up += v?.up ?? 0;
        down += v?.down ?? 0;
      }
      const id = leagueTeam(gm.team);
      habits[id] = {
        hired: gm.hired,
        seasons: span,
        tradesPerYear: { value: round(mine / span, 2), n: span },
        draftUpShare: { value: up + down > 0 ? round(up / (up + down), 3) : null, n: up + down },
        coachChangesSince2000: changes[gm.team] ?? null,
        deadShare2026: deadShare[id] !== undefined ? round(deadShare[id]!, 4) : null,
      };
    }
    const leagueTradesPerTeam = round((tradeMeasure.perYear * 2) / 32, 2);
    mkdirSync(join(PRIVATE, "out"), { recursive: true });
    writeFileSync(
      HABITS_FILE,
      `${JSON.stringify({ leagueTradesPerTeam, coachChangesSeasons: [2000, PARITY_SEASONS[1]], teams: habits }, null, 2)}\n`,
    );
    console.log(`Wrote the 2025 front offices' habits (private) to ${HABITS_FILE}.`);
  }

  const t = tradeMeasure;
  console.log(
    `Trades ${t.seasons.join("-")}: ${t.perYear} a year (picks only ${t.byType.picksOnly}, players for picks ${t.byType.playersForPicks}, players for players ${t.byType.playersForPlayers}, mixed ${t.byType.mixed}); by window ${JSON.stringify(t.byWindow)}; ${t.playersPerYear} players a year (median age ${t.playerAge.p50}), ${t.picksPerYear} picks (${Math.round(t.futurePickShare * 100)}% future).`,
  );
  const p = parity.measure;
  console.log(
    `Parity ${p.seasons.join("-")}: win share carries over r=${p.winShareCorrelation}; playoff teams return ${Math.round(p.playoffRepeatRate * 100)}%; worst to playoffs ${Math.round(p.worstToPlayoffsRate * 100)}%; ${p.championsPerDecade.mean} different champions a decade (${p.championsPerDecade.min}-${p.championsPerDecade.max}); 5-year playoff runs ${p.playoffRunsOf5PerTeamDecade} and 4-year losing runs ${p.losingRunsOf4PerTeamDecade} per team-decade; longest ${p.longestPlayoffRun} and ${p.longestLosingRun}.`,
  );
  if (cap)
    console.log(
      `Dead money 2026: median ${Math.round(cap.deadMoneyShare.p50 * 1000) / 10}% of the cap, ${cap.teamsAbove15Pct} teams above 15%, ${cap.teamsAbove10Pct} above 10%.`,
    );
}
