/**
 * Real-NFL draft numbers (Phase 11) from nflverse (CC-BY-4.0): every pick since
 * 1980 with its career (draft_picks) and every combine since 2000 (combine).
 * Names are only used in memory and in the private 2026 class.
 *
 * calibration/draft.json:
 * - hit rates by round and by pick range (classes 1994-2020, careers mostly
 *   complete): multi-year starters, never started, Pro Bowl, All-Pro, career
 *   value (Pro Football Reference's weighted approximate value);
 * - a pick value curve: average career value by overall pick, smoothed and
 *   kept falling (our own trade chart);
 * - position mix by round;
 * - combine measurables by position: means, spreads, how often each drill is
 *   run, and how the drills move together;
 * - draft ages by round, and how many combine invitees go undrafted.
 *
 * pipeline/private/out/class-2026.json: the real 2026 class (combine invitees
 * and every draftee) with measurables and real draft slot, for the private
 * real-league build.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ensure, readCsv, RELEASE, ROOT, round, type Row } from "./matchups";

const HIT_CLASSES: [number, number] = [1994, 2020];
const VALUE_CLASSES: [number, number] = [1994, 2015];
const COMBINE_YEARS: [number, number] = [2010, 2026];
const DRILLS = ["forty", "bench", "vertical", "broad_jump", "cone", "shuttle"] as const;
const MEASURES = ["ht", "wt", ...DRILLS] as const;

/** nflverse position labels -> the sim's positions, with shares for generic labels. */
function positions(label: string): [string, number][] {
  const l = label.toUpperCase();
  const map: Record<string, [string, number][]> = {
    QB: [["QB", 1]],
    RB: [["RB", 1]],
    HB: [["RB", 1]],
    FB: [["FB", 1]],
    WR: [["WR", 1]],
    TE: [["TE", 1]],
    T: [["OT", 1]],
    OT: [["OT", 1]],
    G: [["OG", 1]],
    OG: [["OG", 1]],
    OL: [
      ["OG", 0.5],
      ["OT", 0.5],
    ],
    C: [["C", 1]],
    OC: [["C", 1]],
    DE: [["EDGE", 1]],
    EDGE: [["EDGE", 1]],
    OLB: [
      ["EDGE", 0.6],
      ["LB", 0.4],
    ],
    DT: [["DT", 1]],
    NT: [["DT", 1]],
    DL: [
      ["DT", 0.6],
      ["EDGE", 0.4],
    ],
    LB: [["LB", 1]],
    ILB: [["LB", 1]],
    MLB: [["LB", 1]],
    CB: [["CB", 1]],
    DB: [
      ["CB", 0.6],
      ["S", 0.4],
    ],
    S: [["S", 1]],
    SAF: [["S", 1]],
    FS: [["S", 1]],
    SS: [["S", 1]],
    K: [["K", 1]],
    PK: [["K", 1]],
    P: [["P", 1]],
    LS: [["LS", 1]],
  };
  return map[l] ?? [];
}

/** The single most likely sim position (for a person, not a share). */
const mainPosition = (label: string) =>
  positions(label).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

const num = (v: string | undefined) =>
  v === undefined || v === "" || v === "NA" ? null : Number(v);
const inches = (ht: string | undefined) => {
  const m = /^(\d+)-(\d+)$/.exec(ht ?? "");
  return m ? Number(m[1]) * 12 + Number(m[2]) : num(ht);
};
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
const sd = (xs: number[]) => {
  const m = mean(xs);
  return Math.sqrt(mean(xs.map((x) => (x - m) * (x - m))));
};

export async function draft(): Promise<void> {
  const picks: Row[] = [];
  await readCsv(
    await ensure("draft_picks.csv.gz", `${RELEASE}/draft_picks/draft_picks.csv.gz`),
    (r) => {
      picks.push(r);
    },
  );
  const combine: Row[] = [];
  await readCsv(await ensure("combine.csv.gz", `${RELEASE}/combine/combine.csv.gz`), (r) => {
    combine.push(r);
  });

  // --- Hit rates by round and pick range (classes whose careers are mostly complete) ---
  const hits = picks.filter((r) => {
    const s = Number(r["season"]);
    return s >= HIT_CLASSES[0] && s <= HIT_CLASSES[1] && Number(r["round"]) <= 7;
  });
  const summary = (rows: Row[]) => ({
    players: rows.length,
    starter3Plus: round(
      rows.filter((r) => (num(r["seasons_started"]) ?? 0) >= 3).length / rows.length,
      3,
    ),
    neverStarted: round(
      rows.filter((r) => (num(r["seasons_started"]) ?? 0) === 0).length / rows.length,
      3,
    ),
    proBowl: round(rows.filter((r) => (num(r["probowls"]) ?? 0) > 0).length / rows.length, 3),
    allPro: round(rows.filter((r) => (num(r["allpro"]) ?? 0) > 0).length / rows.length, 3),
    meanSeasonsStarted: round(mean(rows.map((r) => num(r["seasons_started"]) ?? 0)), 2),
    meanCareerValue: round(mean(rows.map((r) => num(r["w_av"]) ?? 0)), 1),
  });
  const byRound = Array.from({ length: 7 }, (_, i) => ({
    round: i + 1,
    ...summary(hits.filter((r) => Number(r["round"]) === i + 1)),
  }));
  const RANGES: [number, number][] = [
    [1, 10],
    [11, 32],
    [33, 64],
    [65, 100],
    [101, 150],
    [151, 200],
    [201, 262],
  ];
  const byPickRange = RANGES.map(([a, b]) => ({
    picks: `${a}-${b}`,
    ...summary(hits.filter((r) => Number(r["pick"]) >= a && Number(r["pick"]) <= b)),
  }));

  // --- Pick value: average career value by overall pick, smoothed, never rising ---
  const valueRows = picks.filter((r) => {
    const s = Number(r["season"]);
    return s >= VALUE_CLASSES[0] && s <= VALUE_CLASSES[1];
  });
  const maxPick = 262;
  const raw: number[] = [];
  for (let p = 1; p <= maxPick; p++) {
    const xs = valueRows.filter((r) => Number(r["pick"]) === p).map((r) => num(r["w_av"]) ?? 0);
    raw.push(xs.length ? mean(xs) : NaN);
  }
  const smooth = raw.map((_, i) => {
    const w = Math.max(2, Math.round(i / 8));
    const xs = raw.slice(Math.max(0, i - w), i + w + 1).filter((x) => !Number.isNaN(x));
    return mean(xs);
  });
  for (let i = 1; i < smooth.length; i++) smooth[i] = Math.min(smooth[i]!, smooth[i - 1]!);
  const pickValue = smooth.map((v) => round(v, 1));

  // --- Position mix by round (fractional for generic labels) ---
  const mix: Record<number, Record<string, number>> = {};
  for (const r of hits) {
    const rd = Number(r["round"]);
    for (const [pos, share] of positions(r["position"] ?? "")) {
      mix[rd] = mix[rd] ?? {};
      mix[rd]![pos] = (mix[rd]![pos] ?? 0) + share;
    }
  }
  const positionMix = Object.fromEntries(
    Object.entries(mix).map(([rd, counts]) => {
      const total = Object.values(counts).reduce((a, b) => a + b, 0);
      return [
        rd,
        Object.fromEntries(
          Object.entries(counts)
            .sort((a, b) => b[1] - a[1])
            .map(([p, n]) => [p, round(n / total, 4)]),
        ),
      ];
    }),
  );

  // --- Draft ages by round ---
  const ages = Array.from({ length: 7 }, (_, i) => {
    const xs = picks
      .filter((r) => Number(r["season"]) >= 2010 && Number(r["round"]) === i + 1)
      .map((r) => num(r["age"]))
      .filter((x): x is number => x !== null);
    return { round: i + 1, mean: round(mean(xs), 2), spread: round(sd(xs), 2) };
  });

  // --- Combine measurables by position ---
  const recent = combine.filter((r) => {
    const s = Number(r["season"]);
    return s >= COMBINE_YEARS[0] && s <= COMBINE_YEARS[1];
  });
  const byPos = new Map<string, Row[]>();
  for (const r of recent) {
    const pos = mainPosition(r["pos"] ?? "");
    if (!pos) continue;
    byPos.set(pos, [...(byPos.get(pos) ?? []), r]);
  }
  const value = (r: Row, k: (typeof MEASURES)[number]) =>
    k === "ht" ? inches(r["ht"]) : num(r[k]);
  const measurables: Record<string, unknown> = {};
  // How the drills move together: correlations of standardized values, pooled across positions.
  const zs: Record<string, number | null>[] = [];
  for (const [pos, rows] of [...byPos].sort((a, b) => a[0].localeCompare(b[0]))) {
    const stats: Record<string, { mean: number; spread: number; tested: number }> = {};
    for (const k of MEASURES) {
      const xs = rows.map((r) => value(r, k)).filter((x): x is number => x !== null);
      stats[k] = {
        mean: round(mean(xs), 2),
        spread: round(sd(xs), 3),
        tested: round(xs.length / rows.length, 3),
      };
    }
    measurables[pos] = { invitees: rows.length, ...stats };
    for (const r of rows)
      zs.push(
        Object.fromEntries(
          MEASURES.map((k) => {
            const x = value(r, k);
            return [
              k,
              x === null || !stats[k]!.spread ? null : (x - stats[k]!.mean) / stats[k]!.spread,
            ];
          }),
        ),
      );
  }
  const correlations: Record<string, Record<string, number>> = {};
  for (const a of MEASURES) {
    correlations[a] = {};
    for (const b of MEASURES) {
      const pairs = zs
        .filter((z) => z[a] !== null && z[b] !== null)
        .map((z) => [z[a]!, z[b]!] as const);
      const r = pairs.length ? mean(pairs.map(([x, y]) => x * y)) : 0;
      correlations[a]![b] = round(Math.max(-1, Math.min(1, r)), 3);
    }
  }
  const invitesPerYear = round(
    recent.filter((r) => Number(r["season"]) < COMBINE_YEARS[1]).length /
      (COMBINE_YEARS[1] - COMBINE_YEARS[0]),
    0,
  );
  const draftedInvitees = recent.filter(
    (r) => r["draft_round"] && r["draft_round"] !== "NA",
  ).length;

  const trades = await draftDayTrades(pickValue);

  writeFileSync(
    join(ROOT, "calibration", "draft.json"),
    JSON.stringify(
      {
        source: `nflverse draft_picks (careers from Pro Football Reference) and combine data (CC-BY-4.0), built by \`npm run pipeline -- draft\`. Hit rates: classes ${HIT_CLASSES.join("-")}. Pick value: classes ${VALUE_CLASSES.join("-")}. Combine: ${COMBINE_YEARS.join("-")}.`,
        note: "starter3Plus: started 3+ seasons as a primary starter. meanCareerValue: weighted approximate value (w_av). pickValue[i] is the career value of overall pick i+1, smoothed and never rising. Measurables: height in inches, weight in pounds, 40 in seconds, bench reps, vertical and broad jump in inches, cone and shuttle in seconds.",
        byRound,
        byPickRange,
        pickValue,
        positionMix,
        ages,
        trades,
        combine: {
          invitesPerYear,
          draftedShare: round(
            draftedInvitees /
              Math.max(1, recent.filter((r) => Number(r["season"]) < COMBINE_YEARS[1]).length),
            3,
          ),
          measurables,
          correlations,
        },
      },
      null,
      2,
    ) + "\n",
  );

  // --- The real 2026 class (private) ---
  const class2026 = new Map<string, Record<string, unknown>>();
  const keyOf = (r: Row) =>
    r["cfb_id"] ||
    r["cfb_player_id"] ||
    r["pfr_id"] ||
    r["pfr_player_id"] ||
    r["player_name"] ||
    r["pfr_player_name"] ||
    "";
  for (const r of combine.filter((x) => x["season"] === "2026")) {
    const pos = mainPosition(r["pos"] ?? "");
    if (!pos) continue;
    class2026.set(keyOf(r), {
      key: keyOf(r),
      name: r["player_name"],
      position: pos,
      school: r["school"],
      age: null,
      heightIn: inches(r["ht"]),
      weightLb: num(r["wt"]),
      drills: Object.fromEntries(DRILLS.map((k) => [k, num(r[k])])),
      invited: true,
      pick: null,
    });
  }
  for (const r of picks.filter((x) => x["season"] === "2026")) {
    const key = keyOf(r);
    const existing =
      class2026.get(key) ??
      [...class2026.values()].find(
        (c) => c["key"] === r["pfr_player_id"] || c["name"] === r["pfr_player_name"],
      );
    const pick = { round: Number(r["round"]), overall: Number(r["pick"]), team: r["team"] };
    if (existing) {
      existing["pick"] = pick;
      existing["age"] = num(r["age"]);
    } else {
      const pos = mainPosition(r["position"] ?? "");
      if (!pos) continue;
      class2026.set(key, {
        key,
        name: r["pfr_player_name"],
        position: pos,
        school: r["college"],
        age: num(r["age"]),
        heightIn: null,
        weightLb: null,
        drills: Object.fromEntries(DRILLS.map((k) => [k, null])),
        invited: false,
        pick,
      });
    }
  }
  const privateOut = join(ROOT, "pipeline", "private", "out");
  mkdirSync(privateOut, { recursive: true });
  const prospects = [...class2026.values()].sort((a, b) =>
    String(a["key"]).localeCompare(String(b["key"])),
  );
  writeFileSync(join(privateOut, "class-2026.json"), JSON.stringify(prospects, null, 1));

  console.log(`Wrote calibration/draft.json (${hits.length} picks for hit rates).`);
  console.log(
    `  Draft-day trades: ${trades.perDraft} a draft (${TRADE_YEARS.join("-")}); pick-for-pick price (value given by the team moving up / value received): median ${trades.pickOnlyPrice.median}, middle half ${trades.pickOnlyPrice.p25}-${trades.pickOnlyPrice.p75} (${trades.pickOnlyPrice.trades} trades)`,
  );
  for (const r of byRound)
    console.log(
      `  Round ${r.round}: starters 3+ seasons ${(r.starter3Plus * 100).toFixed(0)}%, never started ${(r.neverStarted * 100).toFixed(0)}%, Pro Bowl ${(r.proBowl * 100).toFixed(0)}%, career value ${r.meanCareerValue}`,
    );
  console.log(
    `  Pick value: #1 ${pickValue[0]}, #32 ${pickValue[31]}, #64 ${pickValue[63]}, #100 ${pickValue[99]}, #224 ${pickValue[223]}`,
  );
  console.log(
    `  2026 class (private): ${prospects.length} prospects, ${prospects.filter((p) => p["pick"]).length} drafted, ${prospects.filter((p) => p["invited"]).length} at the combine.`,
  );
}

/** Drafts whose draft-day trades are measured (nflverse/nfldata trades, pick numbers known). */
const TRADE_YEARS = [2011, 2025] as const;

/**
 * Draft-day trades: how many a draft, and what the team moving up pays. A trade counts when it
 * moves a pick in that year's draft and happens between April 20 and May 12 (the draft window
 * 2011-25). Price: for trades of only that year's picks, the career value (pickValue) the team
 * moving up gave, divided by what it got.
 */
async function draftDayTrades(pickValue: number[]): Promise<{
  perDraft: number;
  pickOnlyPrice: { trades: number; p25: number; median: number; p75: number };
  note: string;
}> {
  const rows: Row[] = [];
  await readCsv(
    await ensure("trades.csv", "https://github.com/nflverse/nfldata/raw/master/data/trades.csv"),
    (r) => {
      rows.push(r);
    },
  );
  const byTrade = new Map<string, Row[]>();
  for (const r of rows) byTrade.set(r["trade_id"]!, [...(byTrade.get(r["trade_id"]!) ?? []), r]);
  let count = 0;
  const prices: number[] = [];
  for (const items of byTrade.values()) {
    const season = Number(items[0]!["season"]);
    const date = items[0]!["trade_date"] ?? "";
    if (season < TRADE_YEARS[0] || season > TRADE_YEARS[1]) continue;
    const md = date.slice(5);
    if (md < "04-20" || md > "05-12") continue;
    const current = (r: Row) =>
      Number(r["pick_season"]) === season && num(r["pick_number"]) !== null;
    if (!items.some(current)) continue;
    count += 1;
    // Pick-only trades within this draft: every item is a numbered pick of this year.
    if (!items.every(current)) continue;
    const teams = [...new Set(items.map((r) => r["gave"]!))];
    if (teams.length !== 2) continue;
    const value = (r: Row) =>
      pickValue[Math.min(pickValue.length, num(r["pick_number"])!) - 1] ?? 0;
    const gaveBy = (t: string) => items.filter((r) => r["gave"] === t);
    const best = (t: string) => Math.min(...gaveBy(t).map((r) => num(r["pick_number"])!));
    // The team moving up gives up the later best pick and receives the earliest one.
    const [a, b] = teams as [string, string];
    const up = best(a) > best(b) ? a : b;
    const down = up === a ? b : a;
    const given = gaveBy(up).reduce((x, r) => x + value(r), 0);
    const got = gaveBy(down).reduce((x, r) => x + value(r), 0);
    if (got > 0) prices.push(given / got);
  }
  const sorted = [...prices].sort((x, y) => x - y);
  const q = (p: number) => round(sorted[Math.round(p * (sorted.length - 1))] ?? 0, 3);
  return {
    perDraft: round(count / (TRADE_YEARS[1] - TRADE_YEARS[0] + 1), 1),
    pickOnlyPrice: { trades: sorted.length, p25: q(0.25), median: q(0.5), p75: q(0.75) },
    note: `Draft-day trades ${TRADE_YEARS.join("-")} from nflverse/nfldata trades: any trade moving a pick in that year's draft between April 20 and May 12. Price: for trades of only that year's picks, the career value (pickValue) given by the team moving up over the value it received.`,
  };
}
