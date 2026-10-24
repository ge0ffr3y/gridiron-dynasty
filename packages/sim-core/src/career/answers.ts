/**
 * The person answers inbox items (Phase 14). Some answers act at once (decline an offer, tag a
 * player, let him go, wait out a holdout); others point to the screen where he acts (negotiate,
 * pick in the draft room, hire on the Coaching page), and the item closes when that's done.
 */
import type { League } from "../league/schema";
import { holdRights, tagPrice, tenderFor } from "../contracts/freeAgency";
import { capSheet } from "../contracts/team";
import { respondToOffer } from "../front-office/views";
import { waitOutDispute } from "../people/disputes";
import { onTeam } from "../roster/lists";
import { personTeam } from "./delegation";
import { resolveWhere } from "./inbox";
import { tidyInbox } from "./staff";

const money = (d: number) => `$${(d / 1_000_000).toFixed(2)}M`;

/** Answers that only point to another screen (the item stays open until he acts there). */
export const POINTER_ANSWERS = new Set(["re-sign", "pick", "extend", "trade", "hire"]);

export interface InboxAnswer {
  /** What happened, or where to go. */
  message: string;
  /** The screen to open, for a pointer answer. */
  link: string | null;
}

export function answerInbox(league: League, decisionId: number, choice: string): InboxAnswer {
  const team = personTeam(league);
  const d = league.pendingDecisions.find((x) => x.id === decisionId);
  if (!d || d.teamId !== team) throw new Error("That decision isn't in your inbox.");
  const r = d.request;
  if (!r.options.includes(choice)) throw new Error(`"${choice}" isn't an answer to this one.`);
  if (POINTER_ANSWERS.has(choice)) return { message: "", link: r.link ?? null };
  const close = (text: string) => {
    resolveWhere(league, (x) => x.id === d.id, "you", text);
    return { message: text, link: null };
  };
  const p = r.playerId !== undefined ? league.players.find((x) => x.id === r.playerId) : undefined;
  const who = p ? `${p.firstName} ${p.lastName}` : "";
  // Extension lines carry his id: the inbox asks about each player once a season by it.
  const whoWithId = p ? `${who} (#${p.id})` : "";
  switch (r.kind) {
    case "trade-offer": {
      const text = respondToOffer(league, r.offerId!, choice === "accept");
      tidyInbox(league);
      return { message: text, link: null };
    }
    case "re-sign": {
      if (!p || p.teamId !== team) return close("He's no longer yours.");
      if (choice === "let-go")
        return close(`You let ${who} go: he hits free agency at the League Year.`);
      if (choice === "tender") {
        const t = tenderFor(league, p);
        if (!t) throw new Error("He isn't eligible for a tender.");
        holdRights(
          league,
          p,
          team!,
          t.kind,
          t.amount,
          "Your decision: the tender holds his rights.",
        );
        return close(`You tendered ${who}: ${money(t.amount)} for one year.`);
      }
      const kind = choice === "franchise-tag" ? "franchise" : "transition";
      const used = league.players.some(
        (x) =>
          x.rights &&
          x.rights.teamId === team &&
          x.rights.season === league.season &&
          (x.rights.kind === "franchise" ||
            x.rights.kind === "franchise-exclusive" ||
            x.rights.kind === "transition"),
      );
      if (used) throw new Error("You've already used your one tag this year.");
      const amount = tagPrice(league, p, kind);
      const room = capSheet(league, team!, league.season).room;
      if (room < amount)
        throw new Error(
          `The ${kind} tag costs ${money(amount)}, and you have ${money(room)} of room: make room first.`,
        );
      holdRights(
        league,
        p,
        team!,
        kind,
        amount,
        `Your decision: the ${kind} tag keeps him a year.`,
      );
      return close(`You placed the ${kind} tag on ${who}: ${money(amount)} for one year.`);
    }
    case "cutdown": {
      const over = onTeam(league, team!, "active").length - league.rules.roster.regularSeasonMax;
      if (over > 0) throw new Error(`You still have ${over} to cut.`);
      return close("You made your final cuts.");
    }
    case "extension":
      return close(`You let ${whoWithId} play out his deal.`);
    case "dispute":
      if (p) waitOutDispute(league, p.id);
      return close(`You're waiting ${who} out.`);
    default:
      return close("Noted.");
  }
}
