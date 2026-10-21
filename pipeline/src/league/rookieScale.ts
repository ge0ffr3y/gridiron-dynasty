/**
 * The real rookie wage scale (Phase 7b): every 2026 draft pick's four-year
 * deal from nflverse's contract data (total value), with the signing bonus
 * share of the same slot a year earlier (the 2026 deals have no year-by-year
 * detail in the data yet; the share by slot barely moves from year to year),
 * turned into the rules file's knots
 * [overall pick, value above four rookie minimums as a share of the cap,
 * signing bonus as a share of total value]. Linear interpolation between knots
 * reproduces every slot within the printed error. Only these derived shares are
 * committed (rules/2026.json); the contract data stays in pipeline/cache.
 *
 *   npm run pipeline -- rookies
 */
import { asyncBufferFromFile, parquetReadObjects } from "hyparquet";
import { minimumSalary, rulesFor, salaryCap } from "@fgm/sim-core";
import { ensure, RELEASE } from "../matchups";

const FILE = "historical_contracts.parquet";
const DRAFT = 2026;
/** A knot is dropped when interpolation stays this close (total value, dollars) at every pick it covers. */
const MAX_ERROR = 40_000;
/** ...and this close on the signing bonus. */
const MAX_BONUS_ERROR = 40_000;

interface Row {
  year_signed: number | null;
  years: number | null;
  value: number | null;
  draft_year: number | null;
  draft_overall: number | null;
  gsis_id: string | null;
  season_history: { year: string; prorated_bonus: number | null }[] | null;
}

interface Slot {
  pick: number;
  above: number;
  bonusShare: number;
  total: number;
  bonus: number;
}

export async function rookieScale(): Promise<void> {
  const path = await ensure(FILE, `${RELEASE}/contracts/${FILE}`);
  const rows = (await parquetReadObjects({
    file: await asyncBufferFromFile(path),
    columns: [
      "year_signed",
      "years",
      "value",
      "draft_year",
      "draft_overall",
      "gsis_id",
      "season_history",
    ],
  })) as Row[];
  // The signing bonus share by slot from last year's rookies: a player's year-by-year
  // history sits on one of his rows (the others list it empty).
  const prorated = new Map<string, number>();
  for (const r of rows) {
    const h = r.season_history?.find((x) => x.year === String(DRAFT - 1));
    if (r.gsis_id && h?.prorated_bonus) prorated.set(r.gsis_id, h.prorated_bonus);
  }
  const lastYearShare = new Map<number, number>();
  for (const r of rows) {
    if (r.draft_year !== DRAFT - 1 || r.year_signed !== DRAFT - 1 || r.years !== 4) continue;
    const yearly = r.gsis_id ? prorated.get(r.gsis_id) : undefined;
    if (!r.draft_overall || !yearly || !r.value || lastYearShare.has(r.draft_overall)) continue;
    lastYearShare.set(r.draft_overall, (yearly * 4) / r.value);
  }
  const shareAt = (pick: number) => {
    for (let d = 0; d < 20; d++) {
      const s = lastYearShare.get(pick - d) ?? lastYearShare.get(pick + d);
      if (s !== undefined) return s;
    }
    return 0;
  };
  const cap = rulesFor(DRAFT).cap;
  const capDollars = salaryCap(cap, DRAFT);
  const floor = [0, 1, 2, 3].reduce((a, i) => a + minimumSalary(cap, DRAFT + i, i), 0);

  // One four-year rookie deal per pick.
  const slots = new Map<number, Slot>();
  for (const r of rows) {
    if (r.draft_year !== DRAFT || r.year_signed !== DRAFT || r.years !== 4 || !r.draft_overall)
      continue;
    if (slots.has(r.draft_overall)) continue;
    const total = Math.round((r.value ?? 0) * 1_000_000);
    const bonusShare = shareAt(r.draft_overall);
    const bonus = Math.round(total * bonusShare);
    slots.set(r.draft_overall, {
      pick: r.draft_overall,
      above: (total - floor) / capDollars,
      bonusShare,
      total,
      bonus,
    });
  }
  const sorted = [...slots.values()].sort((a, b) => a.pick - b.pick);
  console.log(`${sorted.length} of the ${DRAFT} draft's picks have a four-year rookie deal.`);

  // Greedy knots: extend each segment while interpolation reproduces every slot it covers.
  const value = (s: Slot, above: number, share: number) => {
    const total = floor + Math.round(above * capDollars);
    return { total, bonus: Math.round(total * share) };
  };
  const fits = (a: Slot, b: Slot) =>
    sorted
      .filter((s) => s.pick > a.pick && s.pick < b.pick)
      .every((s) => {
        const t = (s.pick - a.pick) / (b.pick - a.pick);
        const v = value(
          s,
          a.above + (b.above - a.above) * t,
          a.bonusShare + (b.bonusShare - a.bonusShare) * t,
        );
        return (
          Math.abs(v.total - s.total) <= MAX_ERROR && Math.abs(v.bonus - s.bonus) <= MAX_BONUS_ERROR
        );
      });
  const knots: Slot[] = [sorted[0]!];
  let i = 0;
  while (i < sorted.length - 1) {
    let j = i + 1;
    while (j + 1 < sorted.length && fits(sorted[i]!, sorted[j + 1]!)) j += 1;
    knots.push(sorted[j]!);
    i = j;
  }
  const round6 = (x: number) => Math.round(x * 1_000_000) / 1_000_000;
  console.log(`${knots.length} knots reproduce every slot within $${MAX_ERROR.toLocaleString()}:`);
  console.log(JSON.stringify(knots.map((k) => [k.pick, round6(k.above), round6(k.bonusShare)])));
}
