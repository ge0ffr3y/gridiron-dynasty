/**
 * Who decides (Phase 14). In GM Mode each area of the job is the person's or his staff's; AI
 * teams' staffs decide everything. Every AI routine that acts for a team asks `staffDecides`
 * first, so a person-run team is never moved behind his back in an area he kept.
 */
import type { Career, DelegationArea, League } from "../league/schema";

/** The person keeps the big calls; staff handle routine upkeep (his choice at career start). */
export const DEFAULT_DELEGATION: Career["delegation"] = {
  draft: "you",
  "re-signing": "you",
  "free-agency": "you",
  trades: "you",
  extensions: "you",
  disputes: "you",
  coaching: "you",
  cutdown: "staff",
  "depth-chart": "staff",
  "reserve-lists": "staff",
  waivers: "staff",
  elevations: "staff",
  cap: "staff",
};

/** Areas in plain English, for screens. */
export const AREA_LABELS: Record<DelegationArea, { label: string; staff: string }> = {
  draft: {
    label: "The draft",
    staff: "Your scouts pick from your board when you're on the clock.",
  },
  "re-signing": {
    label: "Re-signing, tags and tenders",
    staff: "Your staff re-sign, tag or tender your expiring players the way an AI team would.",
  },
  "free-agency": {
    label: "Free agency",
    staff: "Your staff bid on free agents for your needs and budget.",
  },
  trades: {
    label: "Trades",
    staff: "Your staff look for deals and answer offers by your team's own values.",
  },
  extensions: {
    label: "Extensions",
    staff: "Your staff extend starters in their last year when the price is right.",
  },
  disputes: {
    label: "Holdouts and trade requests",
    staff: "Your staff answer them: extend, trade or wait.",
  },
  coaching: {
    label: "Coaching hires",
    staff: "Your staff fill open coaching jobs from the candidates.",
  },
  cutdown: {
    label: "Final cuts",
    staff: "Your staff cut to 53 on cutdown day (you can cut first).",
  },
  "depth-chart": {
    label: "Depth chart",
    staff: "Your coaches set the depth chart by their read of the roster.",
  },
  "reserve-lists": {
    label: "Injured reserve and practice squad",
    staff: "Your staff place injured players on reserve, bring them back and keep the squad full.",
  },
  waivers: { label: "Waiver claims", staff: "Your staff claim players who beat your weakest." },
  elevations: {
    label: "Game-day elevations",
    staff: "Your coaches elevate practice-squad players to fill game-day holes.",
  },
  cap: {
    label: "Cap compliance",
    staff: "Your staff restructure or release to get under the cap when a deadline arrives.",
  },
};

/** The team the person runs (null in Simulation Mode or between jobs). */
export function personTeam(league: League): string | null {
  const c = league.career;
  return c && c.status === "active" ? c.teamId : null;
}

/** Does the team's staff decide in this area? (AI teams: always.) */
export function staffDecides(league: League, teamId: string, area: DelegationArea): boolean {
  if (teamId === personTeam(league)) return league.career!.delegation[area] === "staff";
  // Simulation Mode's "answer this team's offers myself" (Phase 13): only trades are the person's.
  if (area === "trades") return league.teams.find((t) => t.id === teamId)?.controller !== "human";
  return true;
}

/** Change who decides an area (the person's choice). */
export function setDelegation(league: League, area: DelegationArea, who: "you" | "staff"): void {
  if (!league.career) throw new Error("No GM Mode career in this league.");
  league.career.delegation[area] = who;
}

/**
 * GM Mode: the league office's powers are gone, so screens act only for the person's team.
 * (In Simulation Mode anyone may act for any team.)
 */
export function assertYourTeam(league: League, teamId: string | null | undefined): void {
  const you = personTeam(league);
  if (you && teamId !== you)
    throw new Error(`In GM Mode you act for your own team only${teamId ? `, not ${teamId}` : ""}.`);
}
