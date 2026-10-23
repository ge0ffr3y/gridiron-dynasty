/**
 * GM Mode (Phase 14): what puts a decision in the person's inbox, what his staff do when he lets
 * its deadline pass, and the tidy-up that closes items he settled on the screens themselves.
 *
 * Staff decisions use the AI's own logic (the same functions AI teams run), so a fully delegated
 * team plays out like an AI team, and every staff decision leaves a line in the career log.
 */
import type { DelegationArea, League, PendingDecision, Player } from "../league/schema";
import { aiAnswer } from "../decisions";
import { span } from "../contracts/contract";
import {
  expiringPlayers,
  reSigningWindow,
  roleOn,
  teamLimit,
  tenderFor,
  tryExtension,
} from "../contracts/freeAgency";
import { aiPick, onTheClock } from "../draft/day";
import { getUnderCap } from "../contracts/upkeep";
import { respondToOffer } from "../front-office/views";
import { staffAnswerDispute } from "../people/disputes";
import { staffHire, openings } from "../coaches/carousel";
import { onTeam } from "../roster/lists";
import { seasonDates } from "../season/calendar";
import { personTeam, setDelegation, staffDecides } from "./delegation";
import { ask, note, resolveWhere } from "./inbox";

const name = (p: { firstName: string; lastName: string }) => `${p.firstName} ${p.lastName}`;
const money = (d: number) => `$${(d / 1_000_000).toFixed(2)}M`;

// ---------------------------------------------------------------------------
// Triggers: decisions that come to the person

/**
 * The re-signing window: one decision per expiring player worth keeping (starters, rotation
 * players, and young players worth a tender). Due before the League Year opens. Returns how many.
 */
export function askReSigns(league: League): number {
  const team = personTeam(league);
  if (!team || staffDecides(league, team, "re-signing")) return 0;
  let n = 0;
  for (const p of expiringPlayers(league).filter((x) => x.teamId === team)) {
    const role = roleOn(league, team, p);
    const tender = tenderFor(league, p);
    if (role === "depth" && !tender) continue;
    const options = tender
      ? ["re-sign", "tender", "let-go"]
      : ["re-sign", "franchise-tag", "transition-tag", "let-go"];
    const asked = ask(
      league,
      team,
      {
        kind: "re-sign",
        prompt: `${name(p)} (${p.position}, ${role}) is a ${tender ? (tender.kind === "erfa" ? "exclusive-rights" : "restricted") : "pending"} free agent. Re-sign him, ${tender ? "tender him" : "tag him"}, or let him go.`,
        options,
        playerId: p.id,
        area: "re-signing",
        link: `/negotiate/${p.id}`,
      },
      league.date,
    );
    if (asked) n += 1;
  }
  return n;
}

/** The person's pick is on the clock (he keeps the draft). */
export function askDraftPick(league: League): boolean {
  const team = personTeam(league);
  const pick = onTheClock(league);
  if (!team || !pick || pick.ownerTeamId !== team || staffDecides(league, team, "draft"))
    return false;
  ask(
    league,
    team,
    {
      kind: "draft-pick",
      prompt: `You're on the clock: round ${pick.round}, pick ${pick.overall}. Make your pick in the draft room.`,
      options: ["pick"],
      area: "draft",
      link: "/draft",
    },
    league.date,
  );
  return true;
}

/** Final cuts: the person's roster is over 53 and he keeps the cuts. */
export function askCutdown(league: League): boolean {
  const team = personTeam(league);
  if (!team || staffDecides(league, team, "cutdown")) return false;
  const over = onTeam(league, team, "active").length - league.rules.roster.regularSeasonMax;
  if (over <= 0) return false;
  ask(
    league,
    team,
    {
      kind: "cutdown",
      prompt: `Cut down to ${league.rules.roster.regularSeasonMax} by cutdown day: ${over} more to go. Your staff's suggestions are on the Manage roster tab.`,
      options: ["done"],
      area: "cutdown",
      link: `/team/${team}`,
    },
    league.date,
  );
  return true;
}

/** Starters in their deal's last year: extend him before the trade deadline, or let him play it out. */
export function askExtensions(league: League): number {
  const team = personTeam(league);
  if (!team || staffDecides(league, team, "extensions")) return 0;
  const dates = seasonDates(league.rules, league.season);
  const deadline =
    dates.weekSundays[league.rules.schedule.tradeDeadlineAfterWeek - 1] ?? league.date;
  if (league.date > deadline) return 0;
  let n = 0;
  for (const p of league.players) {
    if (p.teamId !== team || !p.contract || p.rights || p.roster === "practice-squad") continue;
    if (span(p.contract).lastReal !== league.season) continue;
    if (
      p.contract.type === "rookie" &&
      p.experience < league.rules.freeAgency.rookieExtensionAfterSeasons
    )
      continue;
    if (roleOn(league, team, p) !== "starter") continue;
    // Asked once a season per player.
    if (
      league.career!.log.some(
        (l) =>
          l.kind === "extension" && l.text.includes(`(#${p.id})`) && l.date >= dates.leagueYear,
      )
    )
      continue;
    const asked = ask(
      league,
      team,
      {
        kind: "extension",
        prompt: `${name(p)} (${p.position}) is a starter in his deal's last year. Extend him before the trade deadline, or let him play it out.`,
        options: ["extend", "play-it-out"],
        playerId: p.id,
        area: "extensions",
        link: `/negotiate/${p.id}`,
      },
      deadline,
    );
    if (asked) n += 1;
  }
  return n;
}

// ---------------------------------------------------------------------------
// The staff step in at a deadline

function playerOf(league: League, id: number | undefined): Player | undefined {
  return id === undefined ? undefined : league.players.find((p) => p.id === id);
}

/** What the person's staff do with one decision he left past its deadline. A log line. */
function staffDecide(league: League, d: PendingDecision): string {
  const r = d.request;
  const team = d.teamId;
  switch (r.kind) {
    case "trade-offer": {
      const answer = aiAnswer(league, team, r);
      if (!answer || r.offerId === undefined) return "The offer lapsed.";
      try {
        const text = respondToOffer(league, r.offerId, answer.choice === "accept");
        return `Your staff ${answer.choice === "accept" ? "accepted" : "declined"} the offer: ${answer.reason} ${answer.choice === "accept" ? text : ""}`.trim();
      } catch (e) {
        return `The offer lapsed: ${(e as Error).message}`;
      }
    }
    case "re-sign": {
      const p = playerOf(league, r.playerId);
      if (!p) return "He's gone.";
      reSigningWindow(league, { teamIds: [team], playerIds: [p.id] });
      if (p.rights && p.rights.teamId === team && p.rights.season === league.season)
        return `Your staff kept ${name(p)}'s rights: ${p.rights.kind} tender or tag, ${money(p.contract ? (p.contract.years[0]?.base ?? 0) : 0)}.`;
      if (p.contract && span(p.contract).lastReal >= league.season)
        return `Your staff re-signed ${name(p)} (${p.position}).`;
      return `Your staff let ${name(p)} (${p.position}) go to free agency: no deal they'd make.`;
    }
    case "draft-pick": {
      const pick = onTheClock(league);
      if (!pick || pick.ownerTeamId !== team) return "The pick was already made.";
      const p = aiPick(league);
      getUnderCap(league, team);
      return `Your scouts picked ${name(p)} (${p.position}) at #${p.drafted?.pick ?? pick.overall}, the top of your board.`;
    }
    case "cutdown":
      // Cutdown day's own cuts take a roster still over 53 down (the AI's choices).
      return "Your staff will make the final cuts to 53 on cutdown day.";
    case "extension": {
      const p = playerOf(league, r.playerId);
      if (!p || p.teamId !== team) return "He's gone.";
      const done = tryExtension(
        league,
        team,
        p,
        teamLimit(league, team, p),
        "Extended by your staff before the deadline.",
      );
      return done.extended
        ? `Your staff extended ${name(p)} (#${p.id}). ${done.reason}`
        : `No extension for ${name(p)} (#${p.id}): ${done.reason} He plays out his deal.`;
    }
    case "dispute": {
      const p = playerOf(league, r.playerId);
      const text = p ? staffAnswerDispute(league, p.id) : null;
      return text ? `Your staff answered ${name(p!)}'s dispute: ${text}` : "The dispute is over.";
    }
    case "coach-vacancy": {
      if (!r.role) return "No opening.";
      return (
        staffHire(league, team, r.role as Parameters<typeof staffHire>[2]) ??
        "No candidate was free to sign yet; your staff will fill the job in the final hiring round."
      );
    }
    case "interview":
      return "Noted: your coach interviewed elsewhere.";
    default:
      return "Your staff let it go.";
  }
}

/**
 * Decisions whose deadline has come (`passed`: strictly before today) are taken by the staff,
 * oldest first, each with a log line.
 */
export function staffAtDeadlines(league: League, passed = false): number {
  const due = league.pendingDecisions
    .filter(
      (d) => d.deadline != null && (passed ? d.deadline < league.date : d.deadline <= league.date),
    )
    .sort((a, b) => a.id - b.id);
  let n = 0;
  for (const d of due) {
    if (!league.pendingDecisions.includes(d)) continue;
    league.pendingDecisions = league.pendingDecisions.filter((x) => x !== d);
    note(league, d.request.kind, "staff", staffDecide(league, d));
    n += 1;
  }
  return n;
}

/**
 * Decisions that opened during a step and whose deadline the same step already passed (a summer
 * trade offer when the calendar jumps to camp): their deadline moves to today, so the person
 * still gets to answer before the next step.
 */
export function giveTimeToNew(league: League, openBefore: Set<number>): void {
  for (const d of league.pendingDecisions) {
    if (openBefore.has(d.id) || d.deadline == null || d.deadline >= league.date) continue;
    d.deadline = league.date;
    const o =
      d.request.offerId !== undefined
        ? league.tradeOffers.find((x) => x.id === d.request.offerId)
        : undefined;
    if (o && o.expires < league.date) o.expires = league.date;
  }
}

/** Closes inbox items the person has settled on the screens (or that no longer apply). */
export function tidyInbox(league: League): void {
  const team = personTeam(league);
  if (!team) return;
  const max = league.rules.roster.regularSeasonMax;
  const settled = (d: PendingDecision): string | null => {
    const r = d.request;
    const p = playerOf(league, r.playerId);
    switch (r.kind) {
      case "trade-offer": {
        const o = league.tradeOffers.find((x) => x.id === r.offerId);
        return !o || o.status !== "open" ? `Trade offer ${o?.status ?? "gone"}.` : null;
      }
      case "re-sign":
        if (!p || p.teamId !== team) return "He's no longer yours.";
        if (p.rights && p.rights.teamId === team && p.rights.season === league.season)
          return `You kept ${name(p)}'s rights.`;
        if (p.contract && span(p.contract).lastReal >= league.season)
          return `You re-signed ${name(p)}.`;
        return null;
      case "draft-pick": {
        const pick = onTheClock(league);
        return !pick || pick.ownerTeamId !== team ? "Your pick is in." : null;
      }
      case "cutdown":
        return onTeam(league, team, "active").length <= max ? `You cut down to ${max}.` : null;
      case "extension":
        if (!p || p.teamId !== team) return "He's no longer yours.";
        return p.contract && span(p.contract).lastReal > league.season
          ? `You extended ${name(p)} (#${p.id}).`
          : null;
      case "dispute": {
        const open = league.disputes.find((x) => x.playerId === r.playerId && x.end === null);
        return !open || open.teamId !== team ? "The dispute is over." : null;
      }
      case "coach-vacancy":
        return openings(league).some((o) => o.teamId === team && o.role === r.role)
          ? null
          : "The job is filled.";
      default:
        return null;
    }
  };
  for (const d of [...league.pendingDecisions]) {
    if (d.teamId !== team) continue;
    const why = settled(d);
    if (why) resolveWhere(league, (x) => x.id === d.id, "you", why);
  }
}

/**
 * The person hands an area to his staff (or takes it back). Handing it over, his staff take the
 * open decisions in that area at once.
 */
export function delegate(league: League, area: DelegationArea, who: "you" | "staff"): number {
  setDelegation(league, area, who);
  if (who === "you") return 0;
  const team = personTeam(league);
  const mine = league.pendingDecisions
    .filter((d) => d.teamId === team && d.request.area === area)
    .sort((a, b) => a.id - b.id);
  for (const d of mine) {
    league.pendingDecisions = league.pendingDecisions.filter((x) => x !== d);
    note(league, d.request.kind, "staff", staffDecide(league, d));
  }
  return mine.length;
}
