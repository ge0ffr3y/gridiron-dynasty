/**
 * The trade AI's answers (Phase 13): a team values what it would get and give in its own eyes
 * (`tradeValue.ts`), and says yes when it gets more than it gives by its GM's margin. Every answer
 * names the biggest pieces and why; a no comes with what it would want instead (a counter). A
 * team remembers recent deals: more trades with the same partner in a short span need a wider
 * margin, so a run of small one-way deals stops. Trades must also be legal (cap, rosters, dates).
 *
 * The same function answers AI-to-AI deals, the league office's proposals and (later) a
 * person's, so what the anti-exploit tests check is what every screen gets.
 */
import { addDays, daysBetween } from "@fgm/foundation";
import type { League } from "../league/schema";
import { makeTrade, previewTradeDeal, tradablePicks, type TradeSide } from "../roster/trades";
import { gmStyle } from "./executives";
import {
  pickTradeValue,
  playerTradeValue,
  rosterSpotCost,
  type ItemValue,
  type Judge,
} from "./tradeValue";

export const TRADE_AI = {
  /** A team wants this share more than it gives (less for risk-takers and keen traders). */
  margin: 0.06,
  marginRisk: 0.04,
  marginAppetite: 0.04,
  /** ...and at least this much more in absolute terms (no trades for nothing), or this share of
   * what it gives for small deals (a depth player for a 7th). */
  minGain: 0.5,
  minGainShare: 0.03,
  /** Memory: each trade with the same partner in this many days adds this to the margin. */
  memoryDays: 120,
  memoryMargin: 0.1,
  /** More than this many with the same partner in that span: no. */
  memoryMax: 2,
} as const;

export interface SideValue {
  /** The team doing the valuing. */
  teamId: string;
  got: number;
  gave: number;
  gets: { label: string; value: number; why: string }[];
  gives: { label: string; value: number; why: string }[];
}

const name = (league: League, id: number) => {
  const p = league.players.find((x) => x.id === id)!;
  return `${p.firstName} ${p.lastName}`;
};

function items(league: League, side: TradeSide, judge: Judge, receiving: boolean) {
  const out: { label: string; value: number; why: string }[] = [];
  for (const id of side.players) {
    const p = league.players.find((x) => x.id === id);
    if (!p) continue;
    const v: ItemValue = playerTradeValue(league, p, judge, receiving);
    out.push({ label: name(league, id), ...v });
  }
  for (const id of side.picks) {
    const d = league.draftPicks.find((x) => x.id === id);
    if (!d) continue;
    const v = pickTradeValue(league, d, judge);
    out.push({ label: v.why, ...v });
  }
  return out.sort((a, b) => b.value - a.value);
}

/** How a team (`judge`) values a trade in which it sends `mine` and receives `theirs`. */
export function valueTrade(
  league: League,
  mine: TradeSide,
  theirs: TradeSide,
  judge: Judge = { teamId: mine.teamId },
): SideValue {
  const gets = items(league, theirs, judge, true);
  const gives = items(league, mine, judge, false);
  let got = gets.reduce((s, x) => s + x.value, 0);
  const gave = gives.reduce((s, x) => s + x.value, 0);
  // Taking in more players than it sends means cutting someone.
  if (!("neutral" in judge)) {
    const spots = theirs.players.length - mine.players.length;
    got -= rosterSpotCost(league, mine.teamId, spots);
  }
  return {
    teamId: mine.teamId,
    got: Math.round(got * 10) / 10,
    gave: Math.round(gave * 10) / 10,
    gets,
    gives,
  };
}

/** Recent trades between two teams (the memory guard). */
function recentWith(league: League, teamId: string, partner: string): number {
  return league.tradeHistory.filter(
    (t) =>
      t.teams.includes(teamId) &&
      t.teams.includes(partner) &&
      daysBetween(t.date, league.date) <= TRADE_AI.memoryDays,
  ).length;
}

/** The least a team must gain in absolute terms, by the size of the deal. */
export function minGain(gave: number): number {
  return Math.min(TRADE_AI.minGain, Math.max(0.1, TRADE_AI.minGainShare * gave));
}

/** The margin a team wants over what it gives, with this partner now. */
export function requiredMargin(league: League, teamId: string, partner: string): number {
  const gm = gmStyle(league, teamId);
  return (
    TRADE_AI.margin -
    TRADE_AI.marginRisk * gm.risk -
    TRADE_AI.marginAppetite * gm.tradeAppetite +
    TRADE_AI.memoryMargin * recentWith(league, teamId, partner)
  );
}

export interface TradeAnswer {
  accept: boolean;
  /** One sentence: the decision and the main reason. */
  reason: string;
  /** The answering team's view. */
  view: SideValue;
  /** What it would want instead (the proposer adds these), or null. */
  counter: { players: number[]; picks: number[] } | null;
  counterText: string | null;
  /** Rule problems (cap, roster, dates) if the trade isn't legal. */
  problems: string[];
}

const fmt = (x: number) => x.toFixed(1);

/**
 * The responder's answer to a proposal: `proposer` sends what's in it, `responder` sends what's
 * in its side. Same answer every time for the same league state (no random draws).
 */
export function answerTrade(
  league: League,
  proposer: TradeSide,
  responder: TradeSide,
  /** The trade's legality already checked (the market checks it once for both answers). */
  legal?: boolean,
  /** Skip looking for a counter-offer (the market doesn't show one). */
  quick?: boolean,
): TradeAnswer {
  const preview = legal
    ? { legal: true, problems: [] as string[] }
    : previewTradeDeal(league, proposer, responder);
  const view = valueTrade(league, responder, proposer);
  const top = (xs: SideValue["gets"]) =>
    xs
      .slice(0, 2)
      .map((x) => `${x.label} (${fmt(x.value)}${x.why !== x.label ? `: ${x.why}` : ""})`)
      .join(", ") || "nothing";
  const summary = `They'd get ${top(view.gets)} (${fmt(view.got)} in all) for ${top(view.gives)} (${fmt(view.gave)}).`;
  if (!preview.legal)
    return {
      accept: false,
      reason: `Not allowed: ${preview.problems.join(" ")}`,
      view,
      counter: null,
      counterText: null,
      problems: preview.problems,
    };
  if (recentWith(league, responder.teamId, proposer.teamId) >= TRADE_AI.memoryMax)
    return {
      accept: false,
      reason: `${responder.teamId} has traded with ${proposer.teamId} ${recentWith(league, responder.teamId, proposer.teamId)} times lately and wants no more for now. ${summary}`,
      view,
      counter: null,
      counterText: null,
      problems: [],
    };
  const margin = requiredMargin(league, responder.teamId, proposer.teamId);
  const needed = view.gave * (1 + margin) + minGain(view.gave);
  if (view.got >= needed)
    return {
      accept: true,
      reason: `${responder.teamId} accepts. ${summary}`,
      view,
      counter: null,
      counterText: null,
      problems: [],
    };
  const counter = quick ? null : findCounter(league, proposer, responder, needed - view.got);
  return {
    accept: false,
    reason: `${responder.teamId} says no: it wants about ${fmt(needed)} back and sees ${fmt(view.got)}. ${summary}`,
    view,
    counter: counter?.add ?? null,
    counterText: counter
      ? `They'd do it if you add ${counter.labels.join(" and ")}.`
      : "Nothing more you have would get it done.",
    problems: [],
  };
}

/**
 * The smallest addition from the proposer (one or two picks, or one player) that closes the
 * responder's gap, by the responder's own valuation.
 */
function findCounter(
  league: League,
  proposer: TradeSide,
  responder: TradeSide,
  gap: number,
): { add: { players: number[]; picks: number[] }; labels: string[] } | null {
  const judge = { teamId: responder.teamId };
  const picks = tradablePicks(league, proposer.teamId)
    .filter((d) => !proposer.picks.includes(d.id))
    .map((d) => ({ d, v: pickTradeValue(league, d, judge) }))
    .sort((a, b) => a.v.value - b.v.value);
  let best: { cost: number; add: { players: number[]; picks: number[] }; labels: string[] } | null =
    null;
  const consider = (
    cost: number,
    add: { players: number[]; picks: number[] },
    labels: string[],
  ) => {
    if (cost < gap) return;
    if (!best || cost < best.cost) best = { cost, add, labels };
  };
  for (let i = 0; i < picks.length; i++) {
    consider(picks[i]!.v.value, { players: [], picks: [picks[i]!.d.id] }, [picks[i]!.v.why]);
    for (let j = i + 1; j < Math.min(picks.length, i + 12); j++)
      consider(
        picks[i]!.v.value + picks[j]!.v.value,
        { players: [], picks: [picks[i]!.d.id, picks[j]!.d.id] },
        [picks[i]!.v.why, picks[j]!.v.why],
      );
  }
  if (!best) {
    // A player instead: the cheapest one on the proposer's roster that closes it.
    const players = league.players
      .filter(
        (p) =>
          p.teamId === proposer.teamId &&
          p.roster === "active" &&
          p.contract?.teamId === proposer.teamId &&
          !proposer.players.includes(p.id),
      )
      .map((p) => ({ p, v: playerTradeValue(league, p, judge, true).value }))
      .filter((x) => x.v >= gap)
      .sort((a, b) => a.v - b.v);
    const p = players[0];
    if (p)
      best = { cost: p.v, add: { players: [p.p.id], picks: [] }, labels: [name(league, p.p.id)] };
  }
  return best;
}

/**
 * Makes a trade both sides agreed to: the transaction carries both teams' reasons, and each
 * side's valuation goes into the trade memory.
 */
export function executeTrade(
  league: League,
  a: TradeSide,
  b: TradeSide,
  source: "ai" | "office" | "offer",
  why: string,
): void {
  const va = valueTrade(league, a, b);
  const vb = valueTrade(league, b, a);
  // What each side sends, by a neutral judge (for the market report and the exploit tests).
  const fair = valueTrade(league, a, b, { neutral: true });
  const reason = `${why} ${a.teamId} saw ${fmt(va.got)} for ${fmt(va.gave)}; ${b.teamId} saw ${fmt(vb.got)} for ${fmt(vb.gave)}.`;
  makeTrade(league, a, b, reason);
  league.tradeHistory.push({
    season: league.season,
    date: league.date,
    teams: [a.teamId, b.teamId],
    gave: [va.gave, vb.gave],
    got: [va.got, vb.got],
    neutral: [fair.gave, fair.got],
    source,
  });
  // Keep three seasons of memory.
  const cutoff = addDays(league.date, -3 * 365);
  league.tradeHistory = league.tradeHistory.filter((t) => t.date >= cutoff);
}
