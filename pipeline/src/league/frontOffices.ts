/**
 * Real front offices (Phase 13, private): each 2025 GM's knobs from what his team did on his
 * watch (pipeline/private/out/front-office-habits.json, from `npm run pipeline -- frontoffice`),
 * and each owner's patience from his franchise's head-coach turnover since 2000.
 *
 * - Trade appetite: trades a year against the league's typical team (spread of the 32 teams).
 * - Future discount: the share of his draft-day trades that moved up (moving up spends the
 *   future for now); measured over the drafts he ran.
 * - Cap aggression: his team's 2026 dead money as a share of the cap, against the league's spread.
 * - Owner patience: fewer head-coach changes than typical = patient.
 * The other knobs (analytics, loyalty, risk) can't be measured from public data and keep their
 * generated values. Each measure carries its seasons of tenure, so a new GM stays near typical.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { RealFrontOffice } from "@fgm/sim-core";
import { ROOT } from "../matchups";

const FILE = join(ROOT, "pipeline", "private", "out", "front-office-habits.json");
export const GMS_FILE = join(ROOT, "pipeline", "private", "gms-2025.csv");

interface Habits {
  leagueTradesPerTeam: number;
  teams: Record<
    string,
    {
      hired: number;
      seasons: number;
      tradesPerYear: { value: number; n: number };
      draftUpShare: { value: number | null; n: number };
      coachChangesSince2000: number | null;
      deadShare2026: number | null;
    }
  >;
}

const clamp = (x: number) => Math.max(-1, Math.min(1, x));
function spread(xs: number[]): { mean: number; sd: number } {
  const mean = xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
  const sd = Math.sqrt(
    xs.reduce((a, b) => a + (b - mean) * (b - mean), 0) / Math.max(1, xs.length),
  );
  return { mean, sd: sd || 1 };
}

/** The real GMs' names (to keep generated names from matching them). */
export function realGmNames(): string[] {
  if (!existsSync(GMS_FILE)) return [];
  return readFileSync(GMS_FILE, "utf8")
    .trim()
    .split("\n")
    .slice(1)
    .map((line) => line.split(",")[1] ?? "")
    .filter(Boolean);
}

/** Each team's front office as measured, or null when the private file is missing. */
export function realFrontOffices(): Record<string, RealFrontOffice> | null {
  if (!existsSync(FILE)) return null;
  const h = JSON.parse(readFileSync(FILE, "utf8")) as Habits;
  const rows = Object.entries(h.teams);
  const trades = spread(rows.map(([, t]) => t.tradesPerYear.value));
  const dead = spread(rows.flatMap(([, t]) => (t.deadShare2026 === null ? [] : [t.deadShare2026])));
  const changes = spread(
    rows.flatMap(([, t]) => (t.coachChangesSince2000 === null ? [] : [t.coachChangesSince2000])),
  );
  const out: Record<string, RealFrontOffice> = {};
  for (const [teamId, t] of rows) {
    const gm: RealFrontOffice["gm"] = {
      // Two spreads from typical is the end of the scale.
      tradeAppetite: {
        value: clamp((t.tradesPerYear.value - trades.mean) / (2 * trades.sd)),
        seasons: t.seasons,
      },
    };
    if (t.draftUpShare.value !== null && t.draftUpShare.n >= 2)
      gm.futureDiscount = {
        value: clamp((t.draftUpShare.value - 0.5) / 0.3),
        // Measured over his draft-day trades: few trades, little weight.
        seasons: Math.min(t.seasons, t.draftUpShare.n),
      };
    if (t.deadShare2026 !== null)
      gm.capAggression = {
        value: clamp((t.deadShare2026 - dead.mean) / (2 * dead.sd)),
        seasons: t.seasons,
      };
    out[teamId] = {
      hiredSeason: t.hired,
      gm,
      owner:
        t.coachChangesSince2000 === null
          ? {}
          : { patience: clamp(-(t.coachChangesSince2000 - changes.mean) / (2 * changes.sd)) },
    };
  }
  return out;
}
