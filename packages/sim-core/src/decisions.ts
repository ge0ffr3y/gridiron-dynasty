/**
 * One engine, two modes: every team decision goes through askTeam(). An AI team
 * answers on the spot (with a reason); a human team's request waits in the
 * league's pending decisions until the person answers it.
 */
import type { DecisionRequest, League, PendingDecision } from "./league/schema";

export interface DecisionAnswer {
  choice: string;
  reason: string;
}

type AiPolicy = (league: League, teamId: string, request: DecisionRequest) => DecisionAnswer;

/** How the AI answers each kind of decision. Real decisions arrive from Phase 2 on. */
const AI_POLICIES: Record<DecisionRequest["kind"], AiPolicy> = {
  placeholder: (_league, _teamId, request) => ({
    choice: request.options[0] as string,
    reason: "Placeholder AI: picks the first option.",
  }),
};

export type AskResult =
  { status: "answered"; answer: DecisionAnswer } | { status: "pending"; decision: PendingDecision };

export function askTeam(league: League, teamId: string, request: DecisionRequest): AskResult {
  const team = league.teams.find((t) => t.id === teamId);
  if (!team) throw new Error(`no team ${teamId}`);
  if (team.controller === "ai")
    return { status: "answered", answer: AI_POLICIES[request.kind](league, teamId, request) };
  const decision: PendingDecision = {
    id: league.nextIds.decision++,
    teamId,
    createdOn: league.date,
    request,
  };
  league.pendingDecisions.push(decision);
  return { status: "pending", decision };
}

/** The person answers a pending decision; it leaves the queue. */
export function answerDecision(
  league: League,
  decisionId: number,
  choice: string,
  reason: string,
): PendingDecision {
  const index = league.pendingDecisions.findIndex((d) => d.id === decisionId);
  const decision = league.pendingDecisions[index];
  if (!decision) throw new Error(`no pending decision ${decisionId}`);
  if (!decision.request.options.includes(choice))
    throw new Error(`"${choice}" is not one of the options`);
  if (!reason.trim()) throw new Error("every decision needs a reason");
  league.pendingDecisions.splice(index, 1);
  return decision;
}
