/**
 * First-season tips (Phase 14b): short cards at the big moments of a GM's year, each shown until
 * he dismisses it. Plain English; numbers come from the league's rules.
 */
import type { League } from "../league/schema";
import { salaryCap } from "../contracts/cap";
import { personTeam } from "./delegation";

export interface Tip {
  id: string;
  title: string;
  text: string;
  link: string | null;
}

interface TipRule extends Tip {
  /** Is this its moment? */
  when: (league: League) => boolean;
}

const stage = (league: League) => league.calendar.stage;

function tips(league: League): TipRule[] {
  const r = league.rules;
  const deadline = r.schedule.tradeDeadlineAfterWeek;
  return [
    {
      id: "welcome",
      title: "Your inbox",
      text: `Decisions that need you land in your inbox, each with a deadline. "Sim to next decision" runs the calendar until one arrives. If you sim past a deadline, your staff decide for you and the log says what they did. Below the inbox you choose which areas you keep and which your staff run.`,
      link: "/inbox",
      when: () => true,
    },
    {
      id: "re-signing",
      title: "The re-signing window",
      text: "Before the new League Year your expiring players can be re-signed, tagged (one franchise or transition tag a year keeps a star for a season at a set price) or tendered (young players, cheaply). Anyone you don't keep becomes a free agent when the League Year opens.",
      link: "/free-agency",
      when: (l) =>
        stage(l) === "offseason" &&
        l.pendingDecisions.some((d) => d.teamId === personTeam(l) && d.request.kind === "re-sign"),
    },
    {
      id: "free-agency",
      title: "Free agency",
      text: `The market opens with the League Year. Every player asks for money, years and guarantees, and weighs winning, his role and where he'd live. Meet his ask and he signs; offer less and his agent counters or walks. Your cap room is the limit (the cap is $${(salaryCap(league.rules.cap, league.season) / 1_000_000).toFixed(1)}M this League Year).`,
      link: "/free-agency",
      when: (l) => stage(l) === "free-agency",
    },
    {
      id: "draft",
      title: "Draft day",
      text: "Your scouts' board ranks the class by their read of each prospect plus your needs. Reorder it on the Big board tab, take anyone on it when you're on the clock, or accept an offer to trade down. Late-round picks rarely start; first-rounders usually do.",
      link: "/draft",
      when: (l) => stage(l) === "draft",
    },
    {
      id: "camp",
      title: "Training camp",
      text: `Camp opens with up to ${r.roster.offseasonMax} players. Three preseason games give young players a showcase, and close position battles go to whoever played better. Some unhappy stars hold out.`,
      link: "/camp",
      when: (l) => stage(l) === "preseason",
    },
    {
      id: "cutdown",
      title: "Final cuts",
      text: `Rosters go from ${r.roster.offseasonMax} to ${r.roster.regularSeasonMax}. Players you cut go on waivers, where other teams can claim them; up to ${r.roster.practiceSquad.max} can join your practice squad. Cutting a player with guaranteed money left leaves dead money on your cap.`,
      link: "/inbox",
      when: (l) => stage(l) === "cutdown",
    },
    {
      id: "deadline",
      title: "The trade deadline",
      text: `Trades close after week ${deadline}. Contenders buy, rebuilders sell, and offers come to your inbox. Extensions for starters in their last year are due then too.`,
      link: "/trade",
      when: (l) =>
        stage(l) === "regular" && l.calendar.week >= deadline - 2 && l.calendar.week <= deadline,
    },
    {
      id: "black-monday",
      title: "Black Monday",
      text: "After the regular season, owners judge their GMs and head coaches. Yours compares your record with what the roster should have won, playoff droughts, losing runs and cap trouble, weighed by his patience. Your job security is on your career page.",
      link: "/career",
      when: (l) =>
        stage(l) === "wildcard" ||
        stage(l) === "divisional" ||
        stage(l) === "conference" ||
        stage(l) === "championship",
    },
  ];
}

/** Tips for this moment the person hasn't dismissed yet. */
export function currentTips(league: League): Tip[] {
  const c = league.career;
  if (!c || c.status !== "active") return [];
  return tips(league)
    .filter((t) => !c.tipsSeen.includes(t.id) && t.when(league))
    .map(({ id, title, text, link }) => ({ id, title, text, link }));
}

/** Dismisses a tip (or all of them with "all"). */
export function dismissTip(league: League, id: string): void {
  const c = league.career;
  if (!c) return;
  const ids = id === "all" ? tips(league).map((t) => t.id) : [id];
  for (const x of ids) if (!c.tipsSeen.includes(x)) c.tipsSeen.push(x);
}
