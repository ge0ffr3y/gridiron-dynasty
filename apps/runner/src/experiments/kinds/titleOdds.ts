/**
 * Alternate histories (Phase 17): the same start (rosters, staffs, contracts, schedule) played many
 * times with different seeds. Every game, injury and bounce changes; nothing before Week 1 does.
 * The result is each team's chance of winning the most games, making the playoffs, the final and the
 * title, and how far its record swings.
 */
import { expectedWinShare, mean, sd, teamSeasonFacts, wilson, type Interval } from "@fgm/sim-core";
import type { Spec } from "../spec";
import { header, leagueFor, stepUntil, type Base, type ResultHeader } from "./common";

export interface TitleOddsRow {
  seed: number;
  /** Per team: win share, made the playoffs, reached the final, won the title (0 or 1). */
  teams: Record<string, [number, number, number, number]>;
  /** Per team: the roster's strength before the season, as an expected win share. */
  strength: Record<string, number>;
}

export function run(spec: Spec, base: Base, seed: number): TitleOddsRow {
  const league = leagueFor(spec, base, seed);
  const strength = Object.fromEntries(
    league.teams.map((t) => [t.id, Math.round(expectedWinShare(league, t.id) * 1000) / 1000]),
  );
  stepUntil(league, (l) => l.calendar.stage === "complete");
  const last = league.history.at(-1)!;
  const facts = teamSeasonFacts(league);
  const teams: TitleOddsRow["teams"] = {};
  for (const f of facts)
    teams[f.teamId] = [
      Math.round(f.winShare * 10_000) / 10_000,
      f.playoffs ? 1 : 0,
      last.championId === f.teamId || last.runnerUpId === f.teamId ? 1 : 0,
      f.title ? 1 : 0,
    ];
  return { seed, teams, strength };
}

export interface TitleOddsResult extends ResultHeader {
  teams: {
    id: string;
    /** Roster strength before the season (expected win share). */
    strength: number;
    winShare: Interval;
    winShareSd: number;
    playoffs: Interval;
    final: Interval;
    title: Interval;
  }[];
  /** How many of the runs each number is out of. */
  totals: { titlesPerSeason: number };
}

export function summarize(spec: Spec, rows: TitleOddsRow[]): TitleOddsResult {
  const ids = Object.keys(rows[0]!.teams);
  const teams = ids.map((id) => {
    const col = (i: 0 | 1 | 2 | 3) => rows.map((r) => r.teams[id]![i]);
    const count = (i: 1 | 2 | 3) => col(i).reduce((a, b) => a + b, 0);
    const share = col(0);
    return {
      id,
      strength: rows[0]!.strength[id]!,
      winShare: {
        mean: mean(share),
        lo: mean(share) - 1.96 * (sd(share) / Math.sqrt(share.length)),
        hi: mean(share) + 1.96 * (sd(share) / Math.sqrt(share.length)),
        n: share.length,
        sd: sd(share),
      },
      winShareSd: sd(share),
      playoffs: wilson(count(1), rows.length),
      final: wilson(count(2), rows.length),
      title: wilson(count(3), rows.length),
    };
  });
  teams.sort((a, b) => b.title.mean - a.title.mean || b.strength - a.strength);
  return {
    ...header(spec, rows.length),
    teams,
    totals: { titlesPerSeason: teams.reduce((a, t) => a + t.title.mean, 0) },
  };
}
