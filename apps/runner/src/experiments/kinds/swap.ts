/**
 * A great head coach vs a great quarterback (Phase 17). In each run one team is picked by seed and
 * given, in separate copies of the same league, a better staff, a better quarterback or nothing.
 * Two measures: (A) the team plays every other team many times on a neutral field with the lineups
 * it has, which isolates the change from injuries and schedules; (B) the copies each play a full
 * season from Week 1, which shows whether the change survives a real season.
 */
import { exhibitionRig, uniformFrom, type Interval, type League } from "@fgm/sim-core";
import type { Spec } from "../spec";
import { applyLever, applyAll } from "../levers";
import {
  across,
  cloneLeague,
  difference,
  header,
  leagueFor,
  seedFrom,
  stepUntil,
  type Base,
  type ResultHeader,
} from "./common";

interface Params {
  /** Neutral games against each of the other teams. */
  gamesPerOpponent: number;
  /** Play the full season too (measure B). */
  season: boolean;
}
const paramsOf = (spec: Spec): Params => ({
  gamesPerOpponent: (spec.params.gamesPerOpponent as number | undefined) ?? 40,
  season: (spec.params.season as boolean | undefined) ?? true,
});

export interface SwapRow {
  seed: number;
  focal: string;
  /** Per condition: win share and points scored minus allowed per game on neutral fields (A), and the season's win share (B). */
  conditions: Record<string, { winShare: number; pointDiff: number; season: number | null }>;
}

export function run(spec: Spec, base: Base, seed: number): SwapRow {
  const { gamesPerOpponent, season } = paramsOf(spec);
  const start = leagueFor(spec, base, seed);
  // Everyone plays the offseason once; the copies start from Week 1.
  const baselineOnly = new Map(start.teams.map((t) => [t.id, { name: "", label: "", levers: [] }]));
  applyAll(start, spec.baseline, baselineOnly);
  stepUntil(start, (l) => l.calendar.stage === "regular");
  const ids = start.teams.map((t) => t.id);
  const focal = [...ids].sort(
    (a, b) => uniformFrom(`${seed}:focal:${a}`) - uniformFrom(`${seed}:focal:${b}`),
  )[0]!;
  const conditions: SwapRow["conditions"] = {};
  for (const group of spec.groups) {
    const league: League = cloneLeague(start);
    const set = (l: League) => {
      for (const lever of group.levers) applyLever(l, focal, lever);
    };
    set(league);
    // A: neutral-field games against every other team.
    const rig = exhibitionRig(league);
    let wins = 0;
    let diff = 0;
    let games = 0;
    for (const other of ids) {
      if (other === focal) continue;
      for (let g = 0; g < gamesPerOpponent; g++) {
        const out = rig.play(focal, other, seedFrom(uniformFrom, `${seed}:swap:${other}:${g}`));
        wins += out.homeScore > out.awayScore ? 1 : out.homeScore === out.awayScore ? 0.5 : 0;
        diff += out.homeScore - out.awayScore;
        games += 1;
      }
    }
    // B: the season, with the change held while coaches and managers come and go.
    let seasonShare: number | null = null;
    if (season) {
      const hold = spec.hold ? set : () => {};
      stepUntil(league, (l) => l.calendar.stage === "complete", hold);
      const row = league.history.at(-1)!.standings.find((s) => s.teamId === focal)!;
      seasonShare = (row.wins + row.ties / 2) / Math.max(1, row.wins + row.losses + row.ties);
    }
    conditions[group.name] = {
      winShare: Math.round((wins / games) * 10_000) / 10_000,
      pointDiff: Math.round((diff / games) * 100) / 100,
      season: seasonShare === null ? null : Math.round(seasonShare * 10_000) / 10_000,
    };
  }
  return { seed, focal, conditions };
}

export interface SwapResult extends ResultHeader {
  conditions: {
    name: string;
    label: string;
    winShare: Interval;
    pointDiff: Interval;
    season: Interval | null;
  }[];
  /** Each condition minus the first, over the same leagues and the same team. */
  differences: {
    name: string;
    versus: string;
    winShare: Interval;
    pointDiff: Interval;
    season: Interval | null;
  }[];
  gamesPerOpponent: number;
}

export function summarize(spec: Spec, rows: SwapRow[]): SwapResult {
  const col = (name: string, k: "winShare" | "pointDiff" | "season") =>
    rows.map((r) => r.conditions[name]![k] as number);
  const hasSeason = rows.every((r) =>
    spec.groups.every((g) => r.conditions[g.name]!.season !== null),
  );
  const first = spec.groups[0]!;
  return {
    ...header(spec, rows.length),
    conditions: spec.groups.map((g) => ({
      name: g.name,
      label: g.label,
      winShare: across(col(g.name, "winShare")),
      pointDiff: across(col(g.name, "pointDiff")),
      season: hasSeason ? across(col(g.name, "season")) : null,
    })),
    differences: spec.groups.slice(1).map((g) => ({
      name: g.name,
      versus: first.name,
      winShare: difference(col(g.name, "winShare"), col(first.name, "winShare")),
      pointDiff: difference(col(g.name, "pointDiff"), col(first.name, "pointDiff")),
      season: hasSeason ? difference(col(g.name, "season"), col(first.name, "season")) : null,
    })),
    gamesPerOpponent: paramsOf(spec).gamesPerOpponent,
  };
}
