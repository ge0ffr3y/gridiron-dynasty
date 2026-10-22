/**
 * How differently teams play (Phase 10): each team's tendencies over a season,
 * measured from its games the way the pipeline measured real teams
 * (calibration/coaching.json), and how much teams differ, sim vs. real.
 */
import type { GameOutput, Play } from "@fgm/game-engine";
import coachingData from "../../../../calibration/coaching.json";

export interface TeamGame {
  homeId: string;
  awayId: string;
  output: GameOutput;
}

type Counts = Record<string, number>;
const add = (c: Counts, k: string, v = 1) => (c[k] = (c[k] ?? 0) + v);
const DROPBACK = new Set(["pass", "sack", "scramble"]);
const MAN = new Set(["cover0", "cover1", "2man"]);

function fourthKey(toGo: number, ytg: number): string {
  const d = toGo <= 1 ? "1" : toGo <= 3 ? "2-3" : toGo <= 6 ? "4-6" : "7+";
  const z = ytg > 60 ? "own" : ytg > 40 ? "mid" : ytg > 20 ? "plus" : "red";
  return `${d}|${z}`;
}

/** The measured tendencies (keys as in calibration/coaching.json). */
export const MEASURED = [
  "passOverExpected",
  "deepShare",
  "personnel11",
  "blitz",
  "manCoverage",
  "fourthDownGoOverExpected",
] as const;
export type Measured = (typeof MEASURED)[number];

/** Each team's tendencies over these games. */
export function teamTendencies(games: TeamGame[]): Map<string, Record<Measured, number>> {
  const off = new Map<string, Counts>();
  const def = new Map<string, Counts>();
  const fourth = new Map<string, Map<string, [number, number]>>();
  const of = (m: Map<string, Counts>, id: string) => m.get(id) ?? (m.set(id, {}), m.get(id)!);
  for (const g of games) {
    const ids = { home: g.homeId, away: g.awayId };
    for (const p of g.output.plays as Play[]) {
      const o = of(off, ids[p.offense]);
      const d = of(def, ids[p.offense === "home" ? "away" : "home"]);
      const scrimmage = p.kind === "run" || DROPBACK.has(p.kind);
      const wp = p.wp === undefined ? 0.5 : p.offense === "home" ? p.wp : 1 - p.wp;
      if (scrimmage && p.quarter <= 3 && wp >= 0.2 && wp <= 0.8) {
        add(o, "neutral");
        if (DROPBACK.has(p.kind)) add(o, "neutralPass");
      }
      if (scrimmage && p.personnel) {
        add(o, "personnel");
        if (p.personnel === "11") add(o, "p11");
      }
      if (p.kind === "pass" && p.airYards !== undefined) {
        add(o, "attempts");
        if (p.airYards >= 20) add(o, "deep");
      }
      if (DROPBACK.has(p.kind) && p.rushers !== undefined) {
        add(d, "dropbacks");
        if (p.rushers >= 5) add(d, "blitz");
      }
      if (DROPBACK.has(p.kind) && p.coverage) {
        add(d, "coverage");
        if (MAN.has(p.coverage)) add(d, "man");
      }
      if (
        p.down === 4 &&
        (scrimmage || p.kind === "punt" || p.kind === "fieldGoal") &&
        !(p.quarter >= 4 && p.clock < 300) &&
        wp >= 0.05 &&
        wp <= 0.95 &&
        !p.fake
      ) {
        const m = fourth.get(ids[p.offense]) ?? new Map<string, [number, number]>();
        const k = fourthKey(p.toGo, p.yardsToGoal);
        const s = m.get(k) ?? [0, 0];
        s[0] += scrimmage ? 1 : 0;
        s[1] += 1;
        m.set(k, s);
        fourth.set(ids[p.offense], m);
      }
    }
  }
  // Expected 4th-down go rates across these games' league, then each team's excess.
  const league = new Map<string, [number, number]>();
  for (const m of fourth.values())
    for (const [k, [w, n]] of m) {
      const s = league.get(k) ?? [0, 0];
      league.set(k, [s[0] + w, s[1] + n]);
    }
  const passRates = [...off.values()].map(
    (c) => (c.neutralPass ?? 0) / Math.max(1, c.neutral ?? 0),
  );
  const leaguePass = passRates.reduce((a, b) => a + b, 0) / Math.max(1, passRates.length);
  const out = new Map<string, Record<Measured, number>>();
  for (const [id, o] of [...off].sort((a, b) => a[0].localeCompare(b[0]))) {
    const d = def.get(id) ?? {};
    let over = 0;
    let n = 0;
    for (const [k, [w, total]] of fourth.get(id) ?? []) {
      const [lw, ln] = league.get(k)!;
      over += w - total * (lw / ln);
      n += total;
    }
    out.set(id, {
      passOverExpected: (o.neutralPass ?? 0) / Math.max(1, o.neutral ?? 0) - leaguePass,
      deepShare: (o.deep ?? 0) / Math.max(1, o.attempts ?? 0),
      personnel11: (o.p11 ?? 0) / Math.max(1, o.personnel ?? 0),
      blitz: (d.blitz ?? 0) / Math.max(1, d.dropbacks ?? 0),
      manCoverage: (d.man ?? 0) / Math.max(1, d.coverage ?? 0),
      fourthDownGoOverExpected: n ? over / n : 0,
    });
  }
  return out;
}

export interface SpreadLine {
  key: Measured;
  label: string;
  /** How much teams differ (standard deviation across teams), sim and real (one season each). */
  sim: number;
  real: number;
  simMean: number;
  realMean: number;
}

/** How much teams differ in each tendency, sim vs. real. */
export function tendencySpread(teams: Map<string, Record<Measured, number>>): SpreadLine[] {
  const real = coachingData.tendencies as Record<
    string,
    { label: string; spread: number; mean: number }
  >;
  return MEASURED.map((key) => {
    const xs = [...teams.values()].map((t) => t[key]);
    const m = xs.reduce((a, b) => a + b, 0) / xs.length;
    const sd = Math.sqrt(xs.reduce((a, b) => a + (b - m) * (b - m), 0) / xs.length);
    return {
      key,
      label: real[key]!.label,
      sim: sd,
      real: real[key]!.spread,
      simMean: m,
      realMean: real[key]!.mean,
    };
  });
}
