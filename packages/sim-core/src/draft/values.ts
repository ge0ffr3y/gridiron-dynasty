/**
 * What picks are worth (Phase 11b): the real career value of each overall
 * pick (calibration/draft.json `pickValue`, weighted approximate value of
 * classes since 1994). Future picks and picks whose number isn't known yet
 * count as the middle pick of their round, a round later for future years.
 */
import draftData from "../../../../calibration/draft.json";
import type { DraftPick, League } from "../league/schema";
import { DRAFT_DAY } from "./config";

const CURVE = draftData.pickValue;

/** The career value of an overall pick number. */
export function careerValue(overall: number): number {
  return CURVE[Math.max(0, Math.min(CURVE.length - 1, overall - 1))]!;
}

/** What a pick is worth today, in career value. */
export function pickWorth(league: League, pick: DraftPick): number {
  if (pick.season === league.season && pick.overall !== null) return careerValue(pick.overall);
  const teams = league.teams.length;
  const later = pick.season > league.season ? DRAFT_DAY.futureRoundsLater : 0;
  const round = Math.min(league.rules.draft.rounds, pick.round + later);
  // A future pick beyond the last round still has some value: the last round's.
  return careerValue(round * teams - Math.floor(teams / 2));
}
