/**
 * The injury model (Phase 9b). The engine decides who gets hurt during a game
 * and whether he came back; practice and camp add the injuries no game shows.
 * Here each injury gets:
 * - how long he's out, from real distributions (in-game: calibration/people.json;
 *   the rest so the totals match the real injury reports, calibration/injuries.json);
 * - a body part from the real mix for that severity, with reinjury: a player back
 *   from an injury is more likely to hurt the same part again;
 * - a status on the injury report (Out, Doubtful, Questionable). A knock he plays
 *   through lists him Questionable, and he plays a step slower;
 * - lasting damage when a severe injury hits the legs.
 * Long injuries carry over the offseason; the rest heal.
 *
 * Every draw uses a seed made from the game, team and week, so results never
 * depend on the order games are played.
 */
import {
  addDays,
  ageOn,
  daysBetween,
  POSITIONS,
  Rng,
  streamSeed,
  type Position,
} from "@fgm/foundation";
import { PEOPLE, type GameInjury } from "@fgm/game-engine";
import injuryData from "../../../../calibration/injuries.json";
import type {
  Game,
  INJURY_KINDS,
  INJURY_SEVERITIES,
  League,
  Player,
  REPORT_STATUSES,
} from "../league/schema";
import { INJURY_MODEL, LONGEST_INJURY_GAMES } from "./config";
import { injuryRisk } from "./depthChart";

type Kind = (typeof INJURY_KINDS)[number];
type Severity = (typeof INJURY_SEVERITIES)[number];
type Status = (typeof REPORT_STATUSES)[number];

const BUCKETS = ["0", "1", "2", "3", "4-5", "6-8", "9+"] as const;
type Bucket = (typeof BUCKETS)[number];

/** The fewest games in each bucket. */
const FEWEST: Record<Bucket, number> = {
  "0": 0,
  "1": 1,
  "2": 2,
  "3": 3,
  "4-5": 4,
  "6-8": 6,
  "9+": 9,
};

export function bucketOf(games: number): Bucket {
  if (games <= 3) return String(games) as Bucket;
  if (games <= 5) return "4-5";
  if (games <= 8) return "6-8";
  return "9+";
}

/** How bad an injury is, by games missed. */
export function severityFor(games: number): Severity {
  if (games <= 1) return "minor";
  if (games <= 3) return "moderate";
  if (games <= 8) return "significant";
  return "severe";
}

/** A number of games inside a bucket. */
function gamesIn(bucket: Bucket, rng: Rng): number {
  if (bucket === "9+") return rng.intBetween(9, LONGEST_INJURY_GAMES);
  const [low, high] = bucket.split("-").map(Number) as [number, number?];
  return high === undefined ? low : rng.intBetween(low, high);
}

function drawBucket(shares: Record<string, number>, rng: Rng): Bucket {
  let r = rng.next();
  let last: Bucket = "0";
  for (const b of BUCKETS) {
    const share = shares[b] ?? 0;
    if (share <= 0) continue;
    last = b;
    r -= share;
    if (r < 0) return b;
  }
  return last;
}

/** Games missed after leaving a game hurt: the real distribution (0 = back next game). */
export function drawGamesMissed(rng: Rng): number {
  return gamesIn(drawBucket(PEOPLE.injuries.gamesMissed.shares, rng), rng);
}

/**
 * Practice and camp injuries that cost games: the real total of injuries costing games
 * (injury reports) minus what the engine's in-game injuries already supply, bucket by bucket.
 */
const PRACTICE = (() => {
  const costing = (shares: Record<string, number>) => {
    const total = BUCKETS.filter((b) => b !== "0").reduce((a, b) => a + (shares[b] ?? 0), 0);
    return Object.fromEntries(BUCKETS.map((b) => [b, b === "0" ? 0 : (shares[b] ?? 0) / total]));
  };
  const real = costing(injuryData.episodes.severity.shares);
  const game = costing(PEOPLE.injuries.gamesMissed.shares);
  const realTotal = injuryData.episodes.costingGamesPerTeamSeason;
  const gameTotal = INJURY_MODEL.inGameCostingPerTeamSeason;
  const perTeamSeason = Math.max(0, realTotal - gameTotal);
  const raw = BUCKETS.map((b) => Math.max(0, real[b]! * realTotal - game[b]! * gameTotal));
  const sum = raw.reduce((a, b) => a + b, 0) || 1;
  return {
    shares: Object.fromEntries(BUCKETS.map((b, i) => [b, raw[i]! / sum])),
    perTeamWeek: perTeamSeason / INJURY_MODEL.practiceWeeksPerSeason,
  };
})();

export const PRACTICE_INJURIES = PRACTICE;

/** A body part for an injury of this length: the real mix, with reinjury for a recent return. */
export function drawPart(p: Player, games: number, date: string, rng: Rng): string {
  const mix = injuryData.bodyParts.bySeverity[bucketOf(games)] as Record<string, number>;
  const recent = recentPart(p, date);
  const boost = injuryData.reinjury.samePartRelativeRisk;
  const weights = Object.entries(mix).map(
    ([part, share]) => [part, part === recent ? share * boost : share] as const,
  );
  const total = weights.reduce((a, [, w]) => a + w, 0);
  let r = rng.next() * total;
  for (const [part, w] of weights) {
    r -= w;
    if (r < 0) return part;
  }
  return weights.at(-1)![0];
}

/** The part he came back from within the reinjury window, if any. */
export function recentPart(p: Player, date: string): string | null {
  const weeksAfter = injuryData.reinjury.windowWeeks;
  for (let i = p.injuryHistory.length - 1; i >= 0; i--) {
    const h = p.injuryHistory[i]!;
    if (h.games < 1) continue;
    // Out about a week per game, then the window after his return.
    if (daysBetween(h.date, date) <= 7 * (h.games + weeksAfter)) return h.part;
    return null;
  }
  return null;
}

const SEVERITY_WORDS: Record<Severity, string> = {
  minor: "minor",
  moderate: "moderate",
  significant: "significant",
  severe: "severe",
};

/** His status for his last game out: sometimes listed Questionable or Doubtful instead of Out. */
function lastGameStatus(rng: Rng): Status {
  const { Questionable, Doubtful } = INJURY_MODEL.lastGameStatus;
  const r = rng.next();
  if (r < Questionable) return "Questionable";
  if (r < Questionable + Doubtful) return "Doubtful";
  return "Out";
}

/**
 * A player gets hurt: games to miss (0 = a knock he plays through), with a body part, a
 * report status and, for a severe injury to the legs, lasting damage. Returns the part.
 */
export function hurt(
  league: League,
  p: Player,
  games: number,
  kind: Kind,
  where: string,
  rng: Rng,
  date = league.date,
): string {
  const part = drawPart(p, games, date, rng);
  if (games <= 0) {
    p.knock = { part, since: date };
    p.injuryHistory.push({ season: league.season, date, part, kind, games: 0 });
    return part;
  }
  const out = Math.max(1, Math.round(games * INJURY_MODEL.medicalRecovery));
  const severity = severityFor(out);
  p.knock = null;
  p.injury = {
    description: `${part} (${SEVERITY_WORDS[severity]}), ${where}`,
    part,
    severity,
    kind,
    gamesRemaining: out,
    totalGames: out,
    since: date,
    status: out === 1 ? lastGameStatus(rng) : "Out",
  };
  p.injuryHistory.push({ season: league.season, date, part, kind, games: out });
  if (severity === "severe") lastingDamage(league, p, part);
  return part;
}

/** A severe injury to the legs costs some speed for good, more for older players. */
function lastingDamage(league: League, p: Player, part: string): void {
  const { parts, points, perYearPast28 } = INJURY_MODEL.lastingDamage;
  if (!parts.includes(part)) return;
  const age = ageOn(p.birthDate, league.date);
  const loss = Math.round(points + Math.max(0, age - 28) * perYearPast28);
  for (const key of ["speed", "acceleration", "agility"] as const)
    p.ratings[key] = Math.max(1, p.ratings[key] - loss);
}

/**
 * After a game: last game's knocks are over, players already hurt are one game closer to
 * returning (and listed for the next one), and anyone hurt in this game gets his injury.
 */
export function applyInjuries(
  league: League,
  game: Game,
  injuries: GameInjury[],
  players: Map<number, Player>,
): void {
  // Each game has its own seed, so a game's injuries don't depend on the order games are played.
  const rng = new Rng(streamSeed(league.meta.seed, `injury:${league.season}:${game.id}`));
  for (const p of [...players.values()].sort((a, b) => a.id - b.id)) {
    if (p.teamId !== game.homeId && p.teamId !== game.awayId) continue;
    p.knock = null;
    if (!p.injury) continue;
    p.injury.gamesRemaining -= 1;
    if (p.injury.gamesRemaining <= 0) p.injury = null;
    else if (p.injury.gamesRemaining === 1) p.injury.status = lastGameStatus(rng);
  }
  const when =
    game.round === "regular"
      ? `Week ${game.week}`
      : game.round === "preseason"
        ? `the preseason`
        : `the ${game.round} round`;
  for (const injury of injuries) {
    const player = players.get(injury.playerId);
    if (!player || player.injury) continue;
    const opponent = injury.side === "home" ? game.awayId : game.homeId;
    const where = `hurt in ${when} against ${league.teams.find((t) => t.id === opponent)?.abbreviation ?? opponent}`;
    // Back in the same game: a knock. Otherwise the real games-missed distribution.
    const games = injury.returned ? 0 : drawGamesMissed(rng);
    // Dated to the game (the league's date moves to the week's end only after all its games).
    hurt(league, player, games, "game", where, rng, game.date);
  }
}

/**
 * How exposed a position is to injury away from games, relative to the average player: the
 * real in-game injury rate of its group (calibration/people.json). Kickers, punters and long
 * snappers barely appear on real injury reports.
 */
const EXPOSURE: Record<Position, number> = (() => {
  const perSnap = PEOPLE.injuries.perSnap as Record<string, number>;
  const rates = Object.values(perSnap);
  const average = rates.reduce((a, b) => a + b, 0) / rates.length;
  const group: Record<Position, string | null> = {
    QB: "QB",
    RB: "RB",
    FB: "FB",
    WR: "WR",
    TE: "TE",
    OT: "OL",
    OG: "OL",
    C: "OL",
    EDGE: "EDGE",
    DT: "DT",
    LB: "LB",
    CB: "CB",
    S: "S",
    K: null,
    P: null,
    LS: null,
  };
  return Object.fromEntries(
    POSITIONS.map((pos) => {
      const g = group[pos];
      return [pos, g ? (perSnap[g] ?? average) / average : INJURY_MODEL.specialistExposure];
    }),
  ) as Record<Position, number>;
})();

/** A team's healthy players, each with his share of the risk of getting hurt. */
function exposed(league: League, teamId: string): { p: Player; risk: number }[] {
  return league.players
    .filter((p) => p.teamId === teamId && p.roster === "active" && !p.injury)
    .sort((a, b) => a.id - b.id)
    .map((p) => ({ p, risk: injuryRisk(p) * EXPOSURE[p.position] }));
}

/** Each player's chance is `expected` shared out by injury risk. */
function draws(pool: { p: Player; risk: number }[], expected: number, rng: Rng): Player[] {
  const total = pool.reduce((a, x) => a + x.risk, 0);
  if (total <= 0) return [];
  return pool.filter((x) => rng.chance(Math.min(1, (expected * x.risk) / total))).map((x) => x.p);
}

/**
 * The week's practice: injuries that cost games (at the rate the real reports need beyond
 * in-game ones) and minor knocks players play through. `label` names the week.
 */
export function practiceWeek(league: League, label: string): void {
  for (const team of league.teams) {
    const rng = new Rng(
      streamSeed(league.meta.seed, `practice:${league.season}:${label}:${team.id}`),
    );
    const pool = exposed(league, team.id);
    for (const p of draws(pool, PRACTICE.perTeamWeek, rng)) {
      const games = gamesIn(drawBucket(PRACTICE.shares, rng), rng);
      hurt(league, p, games, "practice", `hurt in practice before ${label}`, rng);
    }
    const healthy = pool.filter((x) => !x.p.injury && !x.p.knock);
    for (const p of draws(healthy, INJURY_MODEL.practiceKnocksPerTeamWeek, rng))
      hurt(league, p, 0, "practice", `banged up in practice before ${label}`, rng);
  }
}

/** Camp injuries for one stretch of camp: `share` of the camp total, at the practice severities. */
function campStretch(league: League, label: string, share: number): void {
  for (const team of league.teams) {
    const rng = new Rng(
      streamSeed(league.meta.seed, `camp-injuries:${league.season}:${label}:${team.id}`),
    );
    for (const p of draws(
      exposed(league, team.id),
      INJURY_MODEL.campInjuriesPerTeam * share,
      rng,
    )) {
      const games = gamesIn(drawBucket(PRACTICE.shares, rng), rng);
      hurt(league, p, games, "camp", "hurt in training camp", rng);
    }
  }
}

/**
 * Training camp opens: the first part of camp's injuries, and non-football injuries, which
 * start the player on the non-football injury list. Returns those players.
 */
export function campInjuries(league: League): Player[] {
  campStretch(league, "opening", INJURY_MODEL.campOpeningShare);
  const nonFootball: Player[] = [];
  // Only the longer severities (at least nonFootballMinGames).
  const longer = Object.fromEntries(
    BUCKETS.map((b) => [
      b,
      FEWEST[b] >= INJURY_MODEL.nonFootballMinGames ? PRACTICE.shares[b]! : 0,
    ]),
  );
  for (const team of league.teams) {
    const rng = new Rng(streamSeed(league.meta.seed, `non-football:${league.season}:${team.id}`));
    for (const p of draws(exposed(league, team.id), INJURY_MODEL.nonFootballPerTeam, rng)) {
      const games = Math.max(
        INJURY_MODEL.nonFootballMinGames,
        gamesIn(drawBucket(longer, rng), rng),
      );
      hurt(league, p, games, "non-football", "a non-football injury before camp", rng);
      nonFootball.push(p);
    }
  }
  return nonFootball;
}

/** The rest of camp's injuries, spread over the preseason weeks. */
export function preseasonCampInjuries(league: League, week: number, weeks: number): void {
  campStretch(league, `preseason-${week}`, (1 - INJURY_MODEL.campOpeningShare) / weeks);
}

/** Free agents heal a game's worth each week, though no team is playing them. */
export function freeAgentsHeal(league: League): void {
  for (const p of league.players) {
    if (p.teamId !== null || !p.injury) continue;
    p.injury.gamesRemaining -= 1;
    if (p.injury.gamesRemaining <= 0) p.injury = null;
  }
}

/**
 * The offseason: knocks and short injuries heal; a long one loses the offseason's worth of
 * games and carries into camp (the player starts camp on the PUP list).
 */
export function offseasonHealing(league: League): void {
  for (const p of league.players) {
    p.knock = null;
    if (!p.injury) continue;
    p.injury.gamesRemaining -= INJURY_MODEL.offseasonRecoveryGames;
    if (p.injury.gamesRemaining <= 0) p.injury = null;
    else p.injury.status = "Out";
  }
}

/** The date a practice injury is dated (the day after the games). */
export function practiceDate(date: string): string {
  return addDays(date, 1);
}

/** A plain injury of a given length (for tests and the league office). */
export function injuryFor(
  games: number,
  since: string,
  description = "Injury",
): NonNullable<Player["injury"]> {
  return {
    description,
    part: "Other",
    severity: severityFor(games),
    kind: "game",
    gamesRemaining: games,
    totalGames: games,
    since,
    status: "Out",
  };
}
