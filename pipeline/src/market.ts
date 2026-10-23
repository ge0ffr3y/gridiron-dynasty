/**
 * The real contract market (Phase 12): `npm run pipeline -- market` writes
 * calibration/market.json from nflverse's contract data (compiled by
 * OverTheCap). The data is private (pipeline/cache); only derived curves are
 * committed: pay as a share of the cap by position and rank, free agents'
 * deals by tier, contract length by age, guarantees by pay, and how many
 * players change teams, re-sign or extend each year. No player rows or names.
 *
 * Definitions:
 * - A player's first contract is his rookie (or undrafted) deal: not market pay.
 * - Veteran deals "in force" in a season: signed by then and not yet run out.
 * - A free agent's deal: signed with a new team once his previous deal had run out.
 * - A re-signing: the same team, once the previous deal had run out.
 * - An extension: the same team, before the previous deal ran out.
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { asyncBufferFromFile, parquetReadObjects } from "hyparquet";
import { ensure, RELEASE, ROOT, round } from "./matchups";

const FILE = "historical_contracts.parquet";
/** Seasons measured: recent enough to be today's market, long enough to be stable. */
const SEASONS = [2019, 2025] as const;
/** Ranks at which the pay curve is reported (1 = highest paid veteran at the position). */
const RANKS = [1, 2, 3, 5, 8, 12, 16, 24, 32, 48, 64, 96];
/** Free agents' tiers within a position's class each year (by pay). */
const FA_TIERS: [string, number, number][] = [
  ["1", 1, 1],
  ["2-3", 2, 3],
  ["4-8", 4, 8],
  ["9-16", 9, 16],
  ["17-32", 17, 32],
];
/** Pay buckets (share of the cap) for guarantees and signing bonuses. */
const PAY_BUCKETS: [number, number][] = [
  [0, 0.01],
  [0.01, 0.03],
  [0.03, 0.06],
  [0.06, 0.1],
  [0.1, 1],
];
const AGE_BUCKETS: [number, number][] = [
  [0, 25],
  [26, 27],
  [28, 29],
  [30, 31],
  [32, 99],
];

const POSITION: Record<string, string> = {
  QB: "QB",
  RB: "RB",
  FB: "FB",
  WR: "WR",
  TE: "TE",
  LT: "OT",
  RT: "OT",
  LG: "OG",
  RG: "OG",
  C: "C",
  ED: "EDGE",
  IDL: "DT",
  LB: "LB",
  CB: "CB",
  S: "S",
  K: "K",
  P: "P",
  LS: "LS",
};

interface Row {
  otc_id: string | null;
  player: string | null;
  position: string | null;
  team: string | null;
  year_signed: number | null;
  years: number | null;
  value: number | null;
  apy_cap_pct: number | null;
  guaranteed: number | null;
  draft_year: number | null;
  date_of_birth: string | null;
}

interface Deal {
  position: string;
  team: string;
  signed: number;
  years: number;
  share: number;
  guaranteedShare: number;
  age: number | null;
  kind: "rookie" | "free-agent" | "re-signed" | "extension" | "other";
}

const median = (xs: number[]) => quantile(xs, 0.5);
function quantile(xs: number[], p: number): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.round(p * (s.length - 1)))]!;
}
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);

function birthYear(dob: string | null): number | null {
  const m = /(\d{4})/.exec(dob ?? "");
  return m ? Number(m[1]) : null;
}

/** Every contract, classified, from each player's sequence of deals. */
async function deals(): Promise<Deal[]> {
  const path = await ensure(FILE, `${RELEASE}/contracts/${FILE}`);
  const file = await asyncBufferFromFile(path);
  const rows = (await parquetReadObjects({
    file,
    columns: [
      "otc_id",
      "player",
      "position",
      "team",
      "year_signed",
      "years",
      "value",
      "apy_cap_pct",
      "guaranteed",
      "draft_year",
      "date_of_birth",
    ],
  })) as Row[];
  const byPlayer = new Map<string, Row[]>();
  for (const r of rows) {
    const key = r.otc_id ?? r.player;
    if (!key || !r.year_signed || !r.years || r.apy_cap_pct === null) continue;
    byPlayer.set(key, [...(byPlayer.get(key) ?? []), r]);
  }
  const out: Deal[] = [];
  for (const list of byPlayer.values()) {
    list.sort(
      (a, b) => a.year_signed! - b.year_signed! || (a.apy_cap_pct ?? 0) - (b.apy_cap_pct ?? 0),
    );
    list.forEach((r, i) => {
      const position = POSITION[r.position ?? ""];
      if (!position) return;
      const prev = list[i - 1];
      const teams = (t: string | null) => (t ?? "").split("/");
      const ended = prev ? prev.year_signed! + prev.years! : 0;
      let kind: Deal["kind"];
      if (i === 0 || r.year_signed === r.draft_year) kind = "rookie";
      else if (r.year_signed! < ended)
        kind = teams(prev!.team).includes(r.team ?? "") ? "extension" : "other";
      else kind = teams(prev!.team).includes(r.team ?? "") ? "re-signed" : "free-agent";
      const born = birthYear(r.date_of_birth);
      out.push({
        position,
        team: r.team ?? "",
        signed: r.year_signed!,
        years: r.years!,
        share: r.apy_cap_pct!,
        guaranteedShare: r.value ? Math.min(1, (r.guaranteed ?? 0) / r.value) : 0,
        age: born ? r.year_signed! - born : null,
        kind,
      });
    });
  }
  return out;
}

export async function market(): Promise<void> {
  const all = await deals();
  const inWindow = (d: Deal) => d.signed >= SEASONS[0] && d.signed <= SEASONS[1];
  const veteran = all.filter((d) => d.kind !== "rookie");
  const positions = [...new Set(all.map((d) => d.position))].sort();

  // Pay by rank: each season, veteran deals in force at a position, highest paid first.
  const payByRank: Record<string, number[]> = {};
  for (const pos of positions) {
    const perRank = RANKS.map(() => [] as number[]);
    for (let season = SEASONS[0]; season <= SEASONS[1]; season++) {
      const shares = veteran
        .filter((d) => d.position === pos && d.signed <= season && season < d.signed + d.years)
        .map((d) => d.share)
        .sort((a, b) => b - a);
      RANKS.forEach((rank, i) => {
        if (shares[rank - 1] !== undefined) perRank[i]!.push(shares[rank - 1]!);
      });
    }
    payByRank[pos] = perRank.map((xs) => round(median(xs), 4));
  }

  // Free agents' deals with new teams: by tier within each position's class each year.
  const freeAgents: Record<
    string,
    Record<string, { p10: number; p50: number; p90: number; n: number }>
  > = {};
  for (const pos of positions) {
    const tiers = new Map<string, number[]>(FA_TIERS.map(([t]) => [t, []]));
    for (let season = SEASONS[0]; season <= SEASONS[1]; season++) {
      const shares = veteran
        .filter((d) => d.kind === "free-agent" && d.position === pos && d.signed === season)
        .map((d) => d.share)
        .sort((a, b) => b - a);
      shares.forEach((share, i) => {
        const tier = FA_TIERS.find(([, lo, hi]) => i + 1 >= lo && i + 1 <= hi);
        if (tier) tiers.get(tier[0])!.push(share);
      });
    }
    freeAgents[pos] = Object.fromEntries(
      [...tiers].map(([t, xs]) => [
        t,
        {
          p10: round(quantile(xs, 0.1), 4),
          p50: round(quantile(xs, 0.5), 4),
          p90: round(quantile(xs, 0.9), 4),
          n: xs.length,
        },
      ]),
    );
  }

  // How many veterans sign each kind of deal a year (all, and those paid 1%+ of the cap).
  const perYear = (kind: Deal["kind"], minShare = 0) =>
    round(
      veteran.filter((d) => inWindow(d) && d.kind === kind && d.share >= minShare).length /
        (SEASONS[1] - SEASONS[0] + 1),
      1,
    );
  const movement = {
    freeAgentsNewTeam: perYear("free-agent"),
    freeAgentsNewTeamPaid1Pct: perYear("free-agent", 0.01),
    reSigned: perYear("re-signed"),
    reSignedPaid1Pct: perYear("re-signed", 0.01),
    extensions: perYear("extension"),
    extensionsPaid5Pct: perYear("extension", 0.05),
  };

  // Contract shape: years by age (deals paid 1%+), guarantees by pay.
  const shaped = veteran.filter((d) => inWindow(d) && d.kind !== "other");
  const yearsByAge = AGE_BUCKETS.map(([lo, hi]) => {
    const xs = shaped.filter(
      (d) => d.age !== null && d.age >= lo && d.age <= hi && d.share >= 0.01,
    );
    return { ages: [lo, hi], years: round(mean(xs.map((d) => d.years)), 2), n: xs.length };
  });
  const guaranteesByPay = PAY_BUCKETS.map(([lo, hi]) => {
    const xs = shaped.filter((d) => d.share >= lo && d.share < hi);
    return {
      share: [lo, hi],
      guaranteed: round(median(xs.map((d) => d.guaranteedShare)), 3),
      years: round(mean(xs.map((d) => d.years)), 2),
      n: xs.length,
    };
  });

  writeFileSync(
    join(ROOT, "calibration", "market.json"),
    JSON.stringify(
      {
        source: `nflverse contract data (compiled by OverTheCap), built by \`npm run pipeline -- market\`: veteran deals signed ${SEASONS.join("-")}. Derived curves only; the source rows stay private.`,
        note: "Shares are average yearly pay over that year's salary cap at signing. payByRank[position][i]: the median, over seasons, of the pay of the RANKS[i]-th highest-paid veteran in force at the position. freeAgents: deals with a new team after the previous deal ran out, ranked by pay within the position's class each year (p10/p50/p90 over seasons). movement: deals a year. yearsByAge: deals paid 1%+ of the cap. guaranteesByPay: median guaranteed share of total value.",
        ranks: RANKS,
        payByRank,
        freeAgents,
        movement,
        yearsByAge,
        guaranteesByPay,
      },
      null,
      2,
    ) + "\n",
  );
  console.log(`Wrote calibration/market.json (${veteran.filter(inWindow).length} veteran deals).`);
  console.log("  Movement a year:", JSON.stringify(movement));
  for (const pos of ["QB", "WR", "EDGE", "CB", "OT"])
    console.log(
      `  ${pos}: top ${payByRank[pos]![0]}, #12 ${payByRank[pos]![5]}, #32 ${payByRank[pos]![8]}; top free agent p50 ${freeAgents[pos]!["1"]!.p50}`,
    );
}
