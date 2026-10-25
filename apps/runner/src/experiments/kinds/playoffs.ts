/**
 * How random is a single-elimination playoff? (Phase 17.) In each run a league plays its season to
 * the playoffs. Every team's true strength is then measured by playing it against every other team
 * many times on a neutral field, and the real bracket is replayed many times from the same
 * rosters: how often does the strongest team win, reach the final, and how does that compare with
 * a coin flip in every game?
 */
import {
  currentStandings,
  exhibitionRig,
  mean,
  tInterval,
  uniformFrom,
  type Interval,
  type League,
} from "@fgm/sim-core";
import type { Spec } from "../spec";
import {
  cloneLeague,
  header,
  leagueFor,
  seedFrom,
  stepUntil,
  type Base,
  type ResultHeader,
} from "./common";

interface Params {
  gamesPerPair: number;
  replays: number;
}
const paramsOf = (spec: Spec): Params => ({
  gamesPerPair: (spec.params.gamesPerPair as number | undefined) ?? 20,
  replays: (spec.params.replays as number | undefined) ?? 200,
});

export interface PlayoffRow {
  seed: number;
  /** The team with the best neutral-field win share, and where it was seeded (null: missed). */
  strongest: { id: string; strength: number; seed: number | null };
  /** Strength of every team (neutral win share), best first, to show the spread. */
  strengths: number[];
  /** Out of `replays`: the strongest team's titles and finals; the best record's titles; the top seed's titles. */
  strongestTitles: number;
  strongestFinals: number;
  bestRecordTitles: number;
  topSeedTitles: number;
  /** The same for the strongest team that made the playoffs. */
  strongestInPlayoffsTitles: number;
  replays: number;
  /** Did the strongest team make the playoffs at all? */
  strongestMade: boolean;
  /** Distinct champions across the replays. */
  champions: number;
}

export function run(spec: Spec, base: Base, seed: number): PlayoffRow {
  const { gamesPerPair, replays } = paramsOf(spec);
  const league = leagueFor(spec, base, seed);
  stepUntil(league, (l) => l.calendar.stage === "wildcard");
  const standings = currentStandings(league);
  const ids = league.teams.map((t) => t.id);
  const rig = exhibitionRig(league);
  // Strength: win share against every other team over many neutral games.
  const wins = new Map<string, number>(ids.map((id) => [id, 0]));
  for (let i = 0; i < ids.length; i++)
    for (let j = i + 1; j < ids.length; j++)
      for (let g = 0; g < gamesPerPair; g++) {
        const out = rig.play(ids[i]!, ids[j]!, seedFrom(uniformFrom, `${seed}:rr:${i}:${j}:${g}`));
        const a = out.homeScore > out.awayScore ? 1 : out.homeScore < out.awayScore ? 0 : 0.5;
        wins.set(ids[i]!, wins.get(ids[i]!)! + a);
        wins.set(ids[j]!, wins.get(ids[j]!)! + (1 - a));
      }
  const games = (ids.length - 1) * gamesPerPair;
  const strength = new Map(ids.map((id) => [id, wins.get(id)! / games]));
  const ranked = [...ids].sort((a, b) => strength.get(b)! - strength.get(a)! || a.localeCompare(b));
  const strongest = ranked[0]!;
  const inPlayoffs = ids.filter((id) => standings.seed.has(id));
  const strongestIn = [...inPlayoffs].sort(
    (a, b) => strength.get(b)! - strength.get(a)! || a.localeCompare(b),
  )[0]!;
  const record = (id: string) => {
    const r = standings.table.record(id);
    return (r.wins + r.ties / 2) / Math.max(1, r.wins + r.losses + r.ties);
  };
  const bestRecord = [...ids].sort((a, b) => record(b) - record(a) || a.localeCompare(b))[0]!;
  const topSeeds = ids.filter((id) => standings.seed.get(id) === 1);

  let strongestTitles = 0;
  let strongestFinals = 0;
  let bestRecordTitles = 0;
  let topSeedTitles = 0;
  let strongestInTitles = 0;
  const champions = new Set<string>();
  for (let r = 0; r < replays; r++) {
    const copy: League = cloneLeague(league, seedFrom(uniformFrom, `${seed}:replay:${r}`));
    stepUntil(copy, (l) => l.calendar.stage === "complete");
    const h = copy.history.at(-1)!;
    champions.add(h.championId);
    if (h.championId === strongest) strongestTitles += 1;
    if (h.championId === strongest || h.runnerUpId === strongest) strongestFinals += 1;
    if (h.championId === bestRecord) bestRecordTitles += 1;
    if (topSeeds.includes(h.championId)) topSeedTitles += 1;
    if (h.championId === strongestIn) strongestInTitles += 1;
  }
  return {
    seed,
    strongest: {
      id: strongest,
      strength: Math.round(strength.get(strongest)! * 1000) / 1000,
      seed: standings.seed.get(strongest) ?? null,
    },
    strengths: ranked.map((id) => Math.round(strength.get(id)! * 1000) / 1000),
    strongestTitles,
    strongestFinals,
    bestRecordTitles,
    topSeedTitles,
    strongestInPlayoffsTitles: strongestInTitles,
    replays,
    strongestMade: standings.seed.has(strongest),
    champions: champions.size,
  };
}

export interface PlayoffResult extends ResultHeader {
  /** Across leagues, the chance (per season) that: */
  strongestWinsTitle: Interval;
  strongestReachesFinal: Interval;
  strongestInPlayoffsWinsTitle: Interval;
  bestRecordWinsTitle: Interval;
  topSeedsWinTitle: Interval;
  strongestMadePlayoffs: Interval;
  /** What a coin flip in every game would give the strongest team, from where it was seeded. */
  coinFlipStrongestTitle: number;
  /** Distinct champions in 200 replays of one bracket. */
  distinctChampions: Interval;
  /** Strength of the best, median and worst team (neutral win share). */
  strengthSpread: { best: Interval; median: Interval; worst: Interval };
  replays: number;
}

/** A coin-flip bracket: the one seed has a bye and three rounds; a seed that plays all four rounds, 1 in 16. */
const coinFlipTitle = (seed: number | null) => (seed === null ? 0 : seed === 1 ? 1 / 8 : 1 / 16);

export function summarize(spec: Spec, rows: PlayoffRow[]): PlayoffResult {
  const share = (pick: (r: PlayoffRow) => number) =>
    tInterval(rows.map((r) => pick(r) / r.replays));
  return {
    ...header(spec, rows.length),
    strongestWinsTitle: share((r) => r.strongestTitles),
    strongestReachesFinal: share((r) => r.strongestFinals),
    strongestInPlayoffsWinsTitle: share((r) => r.strongestInPlayoffsTitles),
    bestRecordWinsTitle: share((r) => r.bestRecordTitles),
    topSeedsWinTitle: share((r) => r.topSeedTitles),
    strongestMadePlayoffs: tInterval(rows.map((r) => (r.strongestMade ? 1 : 0))),
    coinFlipStrongestTitle: mean(rows.map((r) => coinFlipTitle(r.strongest.seed))),
    distinctChampions: tInterval(rows.map((r) => r.champions)),
    strengthSpread: {
      best: tInterval(rows.map((r) => r.strengths[0]!)),
      median: tInterval(rows.map((r) => r.strengths[Math.floor(r.strengths.length / 2)]!)),
      worst: tInterval(rows.map((r) => r.strengths.at(-1)!)),
    },
    replays: rows[0]!.replays,
  };
}
