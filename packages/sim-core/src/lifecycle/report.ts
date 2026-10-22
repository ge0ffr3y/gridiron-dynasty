/**
 * Long-run checks for the player lifecycle (Phase 9): the league's age mix,
 * how good its starters are, how many stars it has, and how long careers
 * last, so a 30-season run can show the league neither inflates nor collapses
 * and careers look like the real ones (calibration/lifecycle.json).
 */
import { addDays, ageOn, overallAt, type Position } from "@fgm/foundation";
import { DEPTH_SLOTS } from "@fgm/game-engine";
import lifecycle from "../../../../calibration/lifecycle.json";
import injuryData from "../../../../calibration/injuries.json";
import type { League, Player } from "../league/schema";
import { seasonDates } from "../season/calendar";
import { DEPTH_CHART } from "../season/config";
import { fitFor } from "../coaches/fit";
import { resolveDepthChart, teamRoster } from "../season/depthChart";

/** The measured groups (offensive linemen together), as in lifecycle.json. */
export function careerGroup(position: Position): string {
  return position === "OT" || position === "OG" || position === "C" ? "OL" : position;
}

export interface LifecycleSnapshot {
  season: number;
  /** Players who played this season: mean age and the [10, 25, 50, 75, 90] percentiles. */
  age: { players: number; mean: number; quantiles: number[] };
  /** Mean age of those players by group. */
  ageByGroup: Record<string, number>;
  /** Average overall of each team's starters (by its depth chart), across the league. */
  starterOverall: number;
  /** Average overall of everyone on an active roster. */
  rosterOverall: number;
  /** Players on teams rated 90 or better, and 80 or better. */
  stars: { ninety: number; eighty: number };
  /** Players not retired, on teams, and free agents. */
  pool: { onTeams: number; freeAgents: number };
}

function quantiles(values: number[], qs: number[]): number[] {
  const sorted = [...values].sort((a, b) => a - b);
  return qs.map((q) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0);
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

/** The league as it stands after a season's games (call before the next offseason). */
export function lifecycleSnapshot(league: League): LifecycleSnapshot {
  const kickoff = seasonDates(league.rules, league.season).weekSundays[0]!;
  const played = league.players.filter((p) =>
    p.stats.some((s) => s.season === league.season && (s.line.gp ?? 0) > 0),
  );
  const ages = played.map((p) => ageOn(p.birthDate, kickoff));
  const byGroup = new Map<string, number[]>();
  played.forEach((p, i) => {
    const g = careerGroup(p.position);
    byGroup.set(g, [...(byGroup.get(g) ?? []), ages[i]!]);
  });
  const starters: number[] = [];
  for (const team of league.teams) {
    const roster = teamRoster(league, team.id);
    const byId = new Map(roster.map((p) => [p.id, p]));
    const chart = resolveDepthChart(team, roster, league.season, fitFor(league, team.id));
    const seen = new Set<number>();
    for (const slot of DEPTH_SLOTS) {
      if (slot === "KR" || slot === "PR") continue;
      for (const id of chart[slot].slice(0, DEPTH_CHART.starters[slot])) {
        if (seen.has(id)) continue;
        seen.add(id);
        const p = byId.get(id)!;
        starters.push(overallAt(p.ratings, p.position));
      }
    }
  }
  const rostered = league.players.filter((p) => p.teamId !== null && p.roster === "active");
  const overalls = rostered.map((p) => overallAt(p.ratings, p.position));
  return {
    season: league.season,
    age: {
      players: played.length,
      mean: mean(ages),
      quantiles: quantiles(ages, [0.1, 0.25, 0.5, 0.75, 0.9]),
    },
    ageByGroup: Object.fromEntries(
      [...byGroup].sort((a, b) => a[0].localeCompare(b[0])).map(([g, xs]) => [g, mean(xs)]),
    ),
    starterOverall: mean(starters),
    rosterOverall: mean(overalls),
    stars: {
      ninety: overalls.filter((o) => o >= 90).length,
      eighty: overalls.filter((o) => o >= 80).length,
    },
    pool: {
      onTeams: league.players.filter((p) => p.retiredAfter === null && p.teamId !== null).length,
      freeAgents: league.players.filter((p) => p.retiredAfter === null && p.teamId === null).length,
    },
  };
}

export interface CareerSummary {
  group: string;
  players: number;
  /** Seasons from first to last in the league, mean and [10, 25, 50, 75, 90] percentiles. */
  seasonsMean: number;
  seasonsQuantiles: number[];
  /** Age in his last season. */
  lastSeasonAgeMean: number;
  real: { seasonsMean: number; lastSeasonAgeMean: number } | null;
}

function careerSpan(p: Player): { first: number; last: number; lastAge: number } | null {
  const h = p.ratingHistory;
  if (h.length === 0) return null;
  return { first: h[0]!.season, last: h.at(-1)!.season, lastAge: h.at(-1)!.age };
}

/**
 * Career lengths for players who entered the league in seasons `from`-`to` and have all
 * (or nearly all) finished, by group, next to the real numbers.
 */
export function careerSummary(league: League, from: number, to: number): CareerSummary[] {
  const groups = new Map<string, { seasons: number[]; ages: number[] }>();
  for (const p of league.players) {
    const span = careerSpan(p);
    if (!span || span.first < from || span.first > to) continue;
    const g = careerGroup(p.position);
    const entry = groups.get(g) ?? { seasons: [], ages: [] };
    entry.seasons.push(span.last - span.first + 1);
    entry.ages.push(span.lastAge);
    groups.set(g, entry);
  }
  const real = lifecycle.careers as Record<
    string,
    { seasonsMean: number; lastSeasonAgeMean: number }
  >;
  return [...groups]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([group, { seasons, ages }]) => ({
      group,
      players: seasons.length,
      seasonsMean: mean(seasons),
      seasonsQuantiles: quantiles(seasons, [0.1, 0.25, 0.5, 0.75, 0.9]),
      lastSeasonAgeMean: mean(ages),
      real: real[group]
        ? {
            seasonsMean: real[group]!.seasonsMean,
            lastSeasonAgeMean: real[group]!.lastSeasonAgeMean,
          }
        : null,
    }));
}

/** The real league's age mix (players who played in 2025), for comparison. */
export function realAgeMix(): { mean: number; quantiles: number[] } {
  const all = (lifecycle.ageMix as Record<string, { mean: number; quantiles: number[] }>)["ALL"]!;
  return { mean: all.mean, quantiles: all.quantiles };
}

// --- Injuries (Phase 9b) -----------------------------------------------------------------

/** This week's injury report, counted per team: listed Out, Doubtful, Questionable (sitting), and playing through a knock. */
export function reportCounts(league: League): {
  Out: number;
  Doubtful: number;
  Questionable: number;
  playingThrough: number;
} {
  const c = { Out: 0, Doubtful: 0, Questionable: 0, playingThrough: 0 };
  for (const p of league.players) {
    // Players on a reserve list aren't on the report (as in the real one).
    if (p.teamId === null || p.roster !== "active") continue;
    if (p.injury) c[p.injury.status] += 1;
    else if (p.knock) c.playingThrough += 1;
  }
  const teams = league.teams.length;
  return {
    Out: c.Out / teams,
    Doubtful: c.Doubtful / teams,
    Questionable: c.Questionable / teams,
    playingThrough: c.playingThrough / teams,
  };
}

export interface InjurySeason {
  season: number;
  /** Injuries that cost games in the regular season, per team (in games, at practice). */
  costingPerTeam: { all: number; game: number; practice: number };
  /** Severity of those, shares by games missed. */
  severity: Record<string, number>;
  /** Players put on reserve lists at final cuts, and on injured reserve during the season, per team. */
  reserve: { irAtWeek1: number; irDuring: number; pupAtWeek1: number; nfiAtWeek1: number };
  /** The most common body parts (all listed injuries), sim share vs. real. */
  parts: { part: string; sim: number; real: number }[];
}

const SEVERITY_BUCKETS = ["1", "2", "3", "4-5", "6-8", "9+"];
function bucketFor(games: number): string {
  if (games <= 3) return String(games);
  if (games <= 5) return "4-5";
  if (games <= 8) return "6-8";
  return "9+";
}

/** Injuries and reserve lists over a finished regular season, next to the real numbers. */
export function injurySeason(league: League, season: number): InjurySeason {
  const d = seasonDates(league.rules, season);
  const first = d.weekSundays[0]!;
  const last = d.weekSundays.at(-1)!;
  const teams = league.teams.length;
  const inSeason = league.players.flatMap((p) =>
    p.injuryHistory.filter((h) => h.season === season && h.date >= first && h.date <= last),
  );
  const costing = inSeason.filter((h) => h.games >= 1);
  const severity = Object.fromEntries(
    SEVERITY_BUCKETS.map((b) => [
      b,
      costing.filter((h) => bucketFor(h.games) === b).length / Math.max(1, costing.length),
    ]),
  );
  const moves = league.transactions.filter((t) => t.type === "reserve");
  const placed = (on: string, from: string, to: string) =>
    new Set(
      moves
        .filter((t) => t.date >= from && t.date <= to && t.text.includes(on))
        .flatMap((t) => t.playerIds),
    ).size / teams;
  // Real overall mix: each severity's body parts, weighted by how common that severity is.
  const realMix = new Map<string, number>();
  const shares = injuryData.episodes.severity.shares as Record<string, number>;
  for (const [b, mix] of Object.entries(
    injuryData.bodyParts.bySeverity as Record<string, Record<string, number>>,
  ))
    for (const [part, share] of Object.entries(mix))
      realMix.set(part, (realMix.get(part) ?? 0) + (shares[b] ?? 0) * share);
  const simMix = new Map<string, number>();
  for (const h of inSeason) simMix.set(h.part, (simMix.get(h.part) ?? 0) + 1 / inSeason.length);
  return {
    season,
    costingPerTeam: {
      all: costing.length / teams,
      game: costing.filter((h) => h.kind === "game").length / teams,
      practice: costing.filter((h) => h.kind === "practice").length / teams,
    },
    severity,
    reserve: {
      irAtWeek1: placed("injured reserve", d.cutdown, d.cutdown),
      irDuring: placed("injured reserve", addDays(d.cutdown, 1), last),
      pupAtWeek1: placed("the PUP list", d.cutdown, d.cutdown),
      nfiAtWeek1: placed("the NFI list", d.cutdown, d.cutdown),
    },
    parts: [...realMix]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([part, real]) => ({ part, sim: simMix.get(part) ?? 0, real })),
  };
}

/** The real numbers the injury summary compares with (calibration/injuries.json). */
export const REAL_INJURIES = {
  costingPerTeam: injuryData.episodes.costingGamesPerTeamSeason,
  severity: injuryData.episodes.severity.shares,
  reserve: injuryData.reserve,
  statuses: injuryData.statuses,
};
