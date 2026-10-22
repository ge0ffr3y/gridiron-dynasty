/** How strong a draft class is by rank (Phase 11): the knots in DRAFT_CLASS, interpolated. */
import { DRAFT_CLASS } from "../roster/config";

/** The true overall a prospect of this rank is drawn around (before his hidden spread). */
export function meanOverall(rank: number): number {
  const knots = DRAFT_CLASS.overallByRank;
  for (let i = 0; i < knots.length - 1; i++) {
    const [r0, v0] = knots[i]!;
    const [r1, v1] = knots[i + 1]!;
    if (rank <= r1) return v0 + ((v1 - v0) * (Math.max(rank, r0) - r0)) / (r1 - r0);
  }
  return knots[knots.length - 1]![1];
}
