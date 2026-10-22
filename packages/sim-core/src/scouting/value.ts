/**
 * A prospect's draft value as a viewer sees him (Phase 11): his overall plus some of his room to
 * grow. Teams don't spend early picks on kickers: a specialist's head start doesn't count. Used
 * by the AI's boards and by the class list's rankings.
 */
import type { Position } from "@fgm/foundation";
import type { PerceivedPlayer } from "../perception";
import { DRAFT_CLASS } from "../roster/config";

const SPECIALISTS = new Set<Position>(["K", "P", "LS"]);

export function draftValue(seen: PerceivedPlayer, position: Position): number {
  return (
    seen.overall +
    DRAFT_CLASS.potentialWeight * (seen.potential.estimate - seen.overall) -
    (SPECIALISTS.has(position) ? DRAFT_CLASS.specialistBonus : 0)
  );
}
