/**
 * Keeping saves small (Phase 18). The transaction log is the biggest thing a long league grows (about
 * 1.5 MB a season: releases, practice-squad moves, draft picks), and nothing reads it far back: the
 * Transactions page shows the latest, free agency looks at this League Year, tag prices at the last
 * two. Players' stats, awards, the almanac and the draft history keep the long story.
 */
import type { League } from "../league/schema";

export const KEEP = {
  /** League Years of transactions kept: this one and the two before. */
  transactionSeasons: 3,
  /** Seasons of coaching and front-office moves kept. */
  moveSeasons: 10,
};

/** Drops log entries nobody reads any more. Call once a new season has begun. */
export function pruneLogs(league: League): void {
  const from = `${league.season - (KEEP.transactionSeasons - 1)}-01-01`;
  const drafts = new Set(league.draftsHeld);
  for (const t of league.transactions)
    if (t.date < from && t.type === "drafted") drafts.add(Number(t.date.slice(0, 4)));
  league.draftsHeld = [...drafts].sort((a, b) => a - b);
  league.transactions = league.transactions.filter((t) => t.date >= from);
  // The newsfeed remembers how many coaching and front-office moves it has read: keep it in step.
  const coaching = league.coachingMoves.length;
  league.coachingMoves = league.coachingMoves.filter(
    (m) => m.season > league.season - KEEP.moveSeasons,
  );
  league.newsCursor.coachingMove = Math.max(
    0,
    league.newsCursor.coachingMove - (coaching - league.coachingMoves.length),
  );
  const executive = league.executiveMoves.length;
  league.executiveMoves = league.executiveMoves.filter(
    (m) => m.season > league.season - KEEP.moveSeasons,
  );
  league.newsCursor.executiveMove = Math.max(
    0,
    league.newsCursor.executiveMove - (executive - league.executiveMoves.length),
  );
}
