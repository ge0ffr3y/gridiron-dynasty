/**
 * The GM Mode inbox (Phase 14): decisions that wait for the person, each with a deadline and a
 * link to the screen where he acts. When a deadline passes unanswered (he simmed past it), his
 * staff decide the way an AI team would, and the inbox log says what they did and why.
 */
import type { Career, DecisionRequest, League, PendingDecision } from "../league/schema";
import { personTeam } from "./delegation";

/** Log lines kept (newest last). */
const LOG_KEEP = 300;

/** Open decisions for the person's team. */
export function inbox(league: League): PendingDecision[] {
  const team = personTeam(league);
  return league.pendingDecisions.filter((d) => d.teamId === team);
}

/** Is there already an open decision like this one (same kind and subject)? */
function alreadyOpen(league: League, teamId: string, r: DecisionRequest): boolean {
  return league.pendingDecisions.some(
    (d) =>
      d.teamId === teamId &&
      d.request.kind === r.kind &&
      d.request.playerId === r.playerId &&
      d.request.offerId === r.offerId &&
      d.request.role === r.role,
  );
}

/** Puts a decision in the person's inbox (once per subject). */
export function ask(
  league: League,
  teamId: string,
  request: DecisionRequest,
  deadline: string | null,
): PendingDecision | null {
  if (alreadyOpen(league, teamId, request)) return null;
  const decision: PendingDecision = {
    id: league.nextIds.decision++,
    teamId,
    createdOn: league.date,
    request,
    deadline,
  };
  league.pendingDecisions.push(decision);
  return decision;
}

/** Notes something in the career log (decisions made, by whom). */
export function note(
  league: League,
  kind: Career["log"][number]["kind"],
  by: "you" | "staff" | "owner",
  text: string,
): void {
  const c = league.career;
  if (!c) return;
  c.log.push({ date: league.date, kind, by, text });
  if (c.log.length > LOG_KEEP) c.log.splice(0, c.log.length - LOG_KEEP);
}

/** Closes open decisions that match, noting who settled them and how. */
export function resolveWhere(
  league: League,
  match: (d: PendingDecision) => boolean,
  by: "you" | "staff",
  text: string,
): number {
  const done = league.pendingDecisions.filter(match);
  if (done.length === 0) return 0;
  league.pendingDecisions = league.pendingDecisions.filter((d) => !match(d));
  for (const d of done) note(league, d.request.kind, by, text);
  return done.length;
}

/** Decisions due by `date` (their deadline has come). */
export function due(league: League, date: string = league.date): PendingDecision[] {
  return league.pendingDecisions.filter((d) => d.deadline != null && d.deadline <= date);
}
