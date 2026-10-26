/**
 * Experiment results (Phase 17): plain JSON files written by the runner (`npm run sim -- --experiment`)
 * and copied into the web app's `public/experiments/` (committed results) and `public/private/experiments/`
 * (results from private data, which exist only on the machine that ran them). The pages read them
 * directly; they don't go through the simulation worker.
 */
import { useEffect, useState } from "react";

export interface Interval {
  mean: number;
  lo: number;
  hi: number;
  n: number;
  sd: number;
}

export interface IndexEntry {
  id: string;
  title: string;
  question: string;
  kind: ExperimentKind;
  visibility: "public" | "private";
  runs: number;
  seasons: number;
  conclusion: string;
}

export type ExperimentKind = "team-groups" | "title-odds" | "playoff-randomness" | "swap-study";

interface Header extends IndexEntry {
  spec: {
    groups: { name: string; label: string; levers: unknown[] }[];
    baseline: unknown[];
    hold: boolean;
    params: Record<string, unknown>;
    start: { type: string };
  };
}

export interface TeamGroupsResult extends Header {
  kind: "team-groups";
  bands: [number, number][];
  groups: { name: string; label: string; metrics: Record<string, Interval>; series: Interval[] }[];
  differences: {
    group: string;
    versus: string;
    metrics: Record<string, Interval>;
    series: Interval[];
  }[];
}

export interface TitleOddsResult extends Header {
  kind: "title-odds";
  teams: {
    id: string;
    strength: number;
    winShare: Interval;
    winShareSd: number;
    playoffs: Interval;
    final: Interval;
    title: Interval;
  }[];
}

export interface PlayoffResult extends Header {
  kind: "playoff-randomness";
  strongestWinsTitle: Interval;
  strongestReachesFinal: Interval;
  strongestInPlayoffsWinsTitle: Interval;
  bestRecordWinsTitle: Interval;
  topSeedsWinTitle: Interval;
  strongestMadePlayoffs: Interval;
  coinFlipStrongestTitle: number;
  distinctChampions: Interval;
  strengthSpread: { best: Interval; median: Interval; worst: Interval };
  replays: number;
}

export interface SwapResult extends Header {
  kind: "swap-study";
  conditions: {
    name: string;
    label: string;
    winShare: Interval;
    pointDiff: Interval;
    season: Interval | null;
  }[];
  differences: {
    name: string;
    versus: string;
    winShare: Interval;
    pointDiff: Interval;
    season: Interval | null;
  }[];
  gamesPerOpponent: number;
}

export type ExperimentResult = TeamGroupsResult | TitleOddsResult | PlayoffResult | SwapResult;

const base = () => import.meta.env.BASE_URL;

/** A JSON file, or null when it isn't there (the dev server answers a missing file with the app's own page). */
async function fetchJson<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(new URL(`${base()}${path}`, window.location.origin));
    if (!res.ok) return null;
    const text = await res.text();
    return text.trimStart().startsWith("{") || text.trimStart().startsWith("[")
      ? (JSON.parse(text) as T)
      : null;
  } catch {
    return null;
  }
}

export async function loadIndex(): Promise<IndexEntry[]> {
  const [pub, priv] = await Promise.all([
    fetchJson<IndexEntry[]>("experiments/index.json"),
    fetchJson<IndexEntry[]>("private/experiments/index.json"),
  ]);
  return [...(pub ?? []), ...(priv ?? [])];
}

export async function loadResult(entry: IndexEntry): Promise<ExperimentResult | null> {
  const folder = entry.visibility === "public" ? "experiments" : "private/experiments";
  return fetchJson<ExperimentResult>(`${folder}/${entry.id}.json`);
}

/** The list of results available, loading. */
export function useExperimentIndex(): { entries: IndexEntry[] | null } {
  const [entries, setEntries] = useState<IndexEntry[] | null>(null);
  useEffect(() => {
    let live = true;
    void loadIndex().then((e) => live && setEntries(e));
    return () => {
      live = false;
    };
  }, []);
  return { entries };
}

/** One result by id, loading (`undefined`), or not found (`null`). */
export function useExperiment(id: string): ExperimentResult | null | undefined {
  const [result, setResult] = useState<ExperimentResult | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    setResult(undefined);
    void loadIndex().then(async (entries) => {
      const entry = entries.find((e) => e.id === id);
      const r = entry ? await loadResult(entry) : null;
      if (live) setResult(r);
    });
    return () => {
      live = false;
    };
  }, [id]);
  return result;
}
