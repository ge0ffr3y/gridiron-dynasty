/**
 * Team groups (Phase 17): in each run, one league is simulated for some seasons with its teams
 * split into equal groups by seed; each group gets its own levers (a kind of general manager, a
 * coach style). Every group is in every run, so the groups are compared inside the same league and
 * differences are averaged over runs (a paired comparison).
 */
import { advance, mean, sd, teamSeasonFacts, uniformFrom, type Interval } from "@fgm/sim-core";
import type { Spec } from "../spec";
import { applyAll, assignTeams } from "../levers";
import {
  across,
  difference,
  header,
  leagueFor,
  stepUntil,
  type Base,
  type ResultHeader,
} from "./common";

/** Scalar measures of one group in one run, and its mean win share each season. */
export interface GroupRun {
  metrics: Record<string, number>;
  /** Mean win share of the group's teams in each simulated season. */
  series: number[];
}
export interface TeamGroupsRow {
  seed: number;
  teams: Record<string, number>;
  groups: Record<string, GroupRun>;
}

interface Params {
  /** Season ranges (1-based, inclusive) to average win share over. */
  bands: [number, number][];
}
const paramsOf = (spec: Spec): Params => ({
  bands: (spec.params.bands as [number, number][] | undefined) ?? [
    [1, 5],
    [6, 10],
    [11, 20],
  ],
});

export const bandName = ([a, b]: [number, number]) => `winShareYears${a}to${b}`;

/** The best and worst three-season average win share of one team. */
function stretches(winShares: number[]): { best: number; worst: number } {
  if (winShares.length < 3) return { best: mean(winShares), worst: mean(winShares) };
  const rolling: number[] = [];
  for (let i = 0; i + 3 <= winShares.length; i++) rolling.push(mean(winShares.slice(i, i + 3)));
  return { best: Math.max(...rolling), worst: Math.min(...rolling) };
}

export function run(spec: Spec, base: Base, seed: number): TeamGroupsRow {
  const league = leagueFor(spec, base, seed);
  const assignment = assignTeams(
    league.teams.map((t) => t.id),
    spec.groups,
    seed,
    uniformFrom,
  );
  const apply = (l: typeof league) => applyAll(l, spec.baseline, assignment);
  apply(league);
  const hold = spec.hold ? apply : () => {};
  // Bands that start after the last simulated season have nothing to average.
  const bands = paramsOf(spec).bands.filter(([a]) => a <= spec.seasons);
  // Per team, per season: win share, playoffs, title, dead money, free-agent spending, trades.
  const perTeam = new Map<
    string,
    {
      win: number[];
      playoffs: number[];
      title: number[];
      dead: number[];
      spend: number[];
      trades: number[];
    }
  >();
  for (let s = 0; s < spec.seasons; s++) {
    stepUntil(league, (l) => l.calendar.stage === "complete", hold);
    for (const f of teamSeasonFacts(league)) {
      let t = perTeam.get(f.teamId);
      if (!t)
        perTeam.set(
          f.teamId,
          (t = { win: [], playoffs: [], title: [], dead: [], spend: [], trades: [] }),
        );
      t.win.push(f.winShare);
      t.playoffs.push(f.playoffs ? 1 : 0);
      t.title.push(f.title ? 1 : 0);
      t.dead.push(f.deadShare);
      t.spend.push(f.faSpend);
      t.trades.push(f.trades);
    }
    advance(league);
    hold(league);
  }
  const groups: Record<string, GroupRun> = {};
  for (const g of spec.groups) {
    const ids = [...assignment].filter(([, grp]) => grp.name === g.name).map(([id]) => id);
    const rows = ids.map((id) => perTeam.get(id)!);
    const each = (pick: (t: (typeof rows)[number]) => number[]) => rows.map((r) => pick(r));
    const metrics: Record<string, number> = {};
    for (const band of bands) {
      const [a, b] = band;
      metrics[bandName(band)] = mean(
        each((r) => r.win).map((w) => mean(w.slice(a - 1, Math.min(b, w.length)))),
      );
    }
    metrics.winShare = mean(each((r) => r.win).map((w) => mean(w)));
    metrics.titleShare = mean(each((r) => r.title).map((w) => mean(w)));
    metrics.playoffRate = mean(each((r) => r.playoffs).map((w) => mean(w)));
    metrics.winShareSpread = mean(each((r) => r.win).map((w) => sd(w)));
    metrics.bestThreeYears = mean(each((r) => r.win).map((w) => stretches(w).best));
    metrics.worstThreeYears = mean(each((r) => r.win).map((w) => stretches(w).worst));
    metrics.deadMoneyShare = mean(each((r) => r.dead).map((w) => mean(w)));
    metrics.freeAgentSpend = mean(each((r) => r.spend).map((w) => mean(w)));
    metrics.trades = mean(each((r) => r.trades).map((w) => mean(w)));
    const series = Array.from({ length: spec.seasons }, (_, s) =>
      mean(rows.map((r) => r.win[s] ?? NaN)),
    );
    groups[g.name] = { metrics, series };
  }
  return {
    seed,
    teams: Object.fromEntries([...assignment].map(([id, g]) => [id, spec.groups.indexOf(g)])),
    groups,
  };
}

export interface TeamGroupsResult extends ResultHeader {
  groups: {
    name: string;
    label: string;
    metrics: Record<string, Interval>;
    /** Mean win share per season across runs, with intervals. */
    series: Interval[];
  }[];
  /** Each later group minus the first, over the same runs. */
  differences: {
    group: string;
    versus: string;
    metrics: Record<string, Interval>;
    series: Interval[];
  }[];
  bands: [number, number][];
}

export function summarize(spec: Spec, rows: TeamGroupsRow[]): TeamGroupsResult {
  const names = Object.keys(rows[0]?.groups[spec.groups[0]!.name]?.metrics ?? {});
  const column = (g: string, m: string) => rows.map((r) => r.groups[g]!.metrics[m]!);
  const seriesAt = (g: string, s: number) => rows.map((r) => r.groups[g]!.series[s]!);
  const out: TeamGroupsResult = {
    ...header(spec, rows.length),
    bands: paramsOf(spec).bands.filter(([a]) => a <= spec.seasons),
    groups: spec.groups.map((g) => ({
      name: g.name,
      label: g.label,
      metrics: Object.fromEntries(names.map((m) => [m, across(column(g.name, m))])),
      series: Array.from({ length: spec.seasons }, (_, s) => across(seriesAt(g.name, s))),
    })),
    differences: [],
  };
  const first = spec.groups[0]!;
  for (const g of spec.groups.slice(1))
    out.differences.push({
      group: g.name,
      versus: first.name,
      metrics: Object.fromEntries(
        names.map((m) => [m, difference(column(g.name, m), column(first.name, m))]),
      ),
      series: Array.from({ length: spec.seasons }, (_, s) =>
        difference(seriesAt(g.name, s), seriesAt(first.name, s)),
      ),
    });
  return out;
}
