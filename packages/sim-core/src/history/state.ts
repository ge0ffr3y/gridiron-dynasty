/**
 * League history (Phase 15): the parts of the league file that keep its story. A new league (and
 * an upgraded save) starts with none; the real league's pipeline fills in its real past.
 */
import type { League } from "../league/schema";

export type HistoryState = Pick<
  League,
  | "annals"
  | "awards"
  | "records"
  | "hallOfFame"
  | "retiredNumbers"
  | "news"
  | "newsCursor"
  | "draftsHeld"
>;

export function emptyHistory(): HistoryState {
  return {
    annals: [],
    awards: [],
    records: [],
    hallOfFame: [],
    retiredNumbers: [],
    news: [],
    draftsHeld: [],
    newsCursor: { transaction: 0, coachingMove: 0, executiveMove: 0 },
  };
}
