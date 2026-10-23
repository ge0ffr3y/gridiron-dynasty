/**
 * The AI trade market (Phase 13). From the new League Year to the trade deadline, GMs look for
 * deals: a buyer (a contender or a retooling team) chases a starter at its biggest need; a seller
 * (a rebuilding team) shops its veterans to contenders that need them; at camp, teams with more
 * good players at a position than they can keep swap them for late picks. A deal happens only
 * when both sides' valuations say yes (`answerTrade`). How often teams look follows the real
 * count of trades in each stretch of the year (calibration/frontoffice.json), scaled by each
 * GM's trade appetite. A team run by a person gets an offer to answer instead.
 */
import { addDays, ageOn, type Position } from "@fgm/foundation";
import frontOffice from "../../../../calibration/frontoffice.json";
import { askTeam } from "../decisions";
import { teamNeeds } from "../draft/boards";
import { ROSTER_MIX, STARTERS } from "../generate/config";
import type { DraftPick, League, Player } from "../league/schema";
import { makeRoomFor } from "../contracts/freeAgency";
import { readOverall } from "../perception";
import { previewTradeDeal, tradablePicks, tradingOpen, type TradeSide } from "../roster/trades";
import { uniformFrom } from "../scouting/noise";
import { stanceOf } from "./evaluate";
import { gmStyle } from "./executives";
import { answerTrade, executeTrade, minGain, requiredMargin } from "./tradeAI";
import { pickTradeValue, playerTradeValue, teamReadsAt } from "./tradeValue";

const REAL = frontOffice.trades.byWindow;

export type MarketStretch = "spring" | "summer" | "camp" | "season";

export const TRADE_MARKET = {
  /** Real trades a day league-wide in each stretch (by stance counts and lengths in days). */
  perDay: {
    spring: REAL.leagueYearToDraft / 41,
    summer: REAL.summer / 68,
    camp: REAL.camp / 50,
    season: REAL.season / 57,
  } as Record<MarketStretch, number>,
  /** Searches per trade made in each stretch (most searches find nothing both sides like). Tuned. */
  searchesPerTrade: { spring: 1.5, summer: 3, camp: 6, season: 2.5 } as Record<
    MarketStretch,
    number
  >,
  /**
   * Deal size: most searches look only at cheap players (value up to `smallCap`, late-round
   * prices), some at mid-sized deals (up to `midCap`), a few at anything. Real non-draft player
   * trades 2015-25: about 5% include a 1st-round pick, 8% a 2nd, two-thirds only 5th-7th
   * rounders (nflverse/nfldata trades). Win-now GMs and contenders swing big more often.
   */
  smallCap: 12,
  midCap: 30,
  midChance: 0.22,
  bigChance: 0.06,
  /** Trade appetite moves how often a GM looks (x 1 + this x appetite). */
  appetite: 1,
  /** The deadline week draws this many times the usual searches; cutdown week too. */
  deadlineBoost: 3,
  cutdownBoost: 2,
  /** Candidates a search considers. */
  candidates: 6,
  /** A buyer wants a player who'd start and beats its weakest starter there by this much. */
  upgradeBy: 2,
  /** Buyers chase a position whose need is at least this. */
  minNeed: 0.3,
  /** At camp, a team takes a surplus player at a position it needs at least this much. */
  campNeed: 0.15,
  /** Sellers shop veteran starters this old or older. */
  sellAge: 27,
  /** Picks considered for a package: rounds up to this, this year's and next. */
  packageRounds: 7,
  /** Offers to a person-run team stay open this many days. */
  offerDays: 7,
} as const;

const name = (p: Player) => `${p.firstName} ${p.lastName}`;

/** How many times a team's GM looks for a deal this step (by hash: the same every time). */
function searches(
  league: League,
  teamId: string,
  stretch: MarketStretch,
  days: number,
  boost: number,
): number {
  const M = TRADE_MARKET;
  const expected = M.perDay[stretch] * days * M.searchesPerTrade[stretch] * boost;
  const appetite = Math.max(0.1, 1 + M.appetite * gmStyle(league, teamId).tradeAppetite);
  const n = (expected / league.teams.length) * appetite;
  const whole = Math.floor(n);
  const extra =
    uniformFrom(`${league.meta.seed}:trade-search:${teamId}:${league.date}`) < n - whole;
  return whole + (extra ? 1 : 0);
}

/**
 * The cheapest package of the payer's picks (by the payer's own valuation) that the receiver
 * values at `target` or more. One, two or three picks.
 */
export function cheapestPackage(
  league: League,
  payer: string,
  receiver: string,
  target: number,
): { picks: DraftPick[]; cost: number; worth: number } | null {
  const options = tradablePicks(league, payer)
    .filter((d) => d.round <= TRADE_MARKET.packageRounds && d.season <= league.season + 1)
    .map((d) => ({
      d,
      cost: pickTradeValue(league, d, { teamId: payer }).value,
      worth: pickTradeValue(league, d, { teamId: receiver }).value,
    }))
    .sort((a, b) => a.cost - b.cost);
  let best: { picks: DraftPick[]; cost: number; worth: number } | null = null;
  const consider = (xs: typeof options) => {
    const worth = xs.reduce((s, x) => s + x.worth, 0);
    if (worth < target) return;
    const cost = xs.reduce((s, x) => s + x.cost, 0);
    if (!best || cost < best.cost) best = { picks: xs.map((x) => x.d), cost, worth };
  };
  const n = options.length;
  for (let i = 0; i < n; i++) {
    consider([options[i]!]);
    for (let j = i + 1; j < n; j++) {
      consider([options[i]!, options[j]!]);
      for (let k = j + 1; k < Math.min(n, j + 6); k++)
        consider([options[i]!, options[j]!, options[k]!]);
    }
  }
  return best;
}

/** How big a deal this search will consider (the most the team will value what it trades for). */
function dealCap(league: League, teamId: string): number {
  const M = TRADE_MARKET;
  const gm = gmStyle(league, teamId);
  const roll = uniformFrom(`${league.meta.seed}:trade-size:${teamId}:${league.date}`);
  // Win-now contenders swing for the big deal; everyone else mostly deals at the margins.
  const big =
    M.bigChance *
    (1 + 0.5 * Math.max(0, gm.futureDiscount) + (stanceOf(league, teamId) === "contend" ? 0.5 : 0));
  if (roll < big) return Infinity;
  if (roll < big + M.midChance) return M.midCap;
  return M.smallCap;
}

/** Players a team reads at a position, best first. */
function readAt(
  league: League,
  teamId: string,
  position: Position,
): { p: Player; overall: number }[] {
  return teamReadsAt(league, teamId, position);
}

const tradable = (league: League, p: Player, teamId: string) =>
  p.teamId === teamId &&
  p.roster === "active" &&
  p.contract !== null &&
  p.contract.teamId === teamId &&
  p.rights === null;

/**
 * Tries to trade `player` from `seller` to `buyer` for picks. The buyer pays the cheapest
 * package the seller wants; both must say yes. True if a trade (or an offer) was made.
 */
function tryDeal(
  league: League,
  seller: string,
  buyer: string,
  player: Player,
  why: string,
): boolean {
  const sellerWants =
    playerTradeValue(league, player, { teamId: seller }, false).value *
      (1 + requiredMargin(league, seller, buyer)) +
    minGain(playerTradeValue(league, player, { teamId: seller }, false).value);
  const pack = cheapestPackage(league, buyer, seller, sellerWants);
  if (!pack) return false;
  const buyerGets = playerTradeValue(league, player, { teamId: buyer }, true).value;
  if (buyerGets < pack.cost * (1 + requiredMargin(league, buyer, seller)) + minGain(pack.cost))
    return false;
  const sellerSide: TradeSide = { teamId: seller, players: [player.id], picks: [] };
  const buyerSide: TradeSide = { teamId: buyer, players: [], picks: pack.picks.map((d) => d.id) };
  // A person-run team gets an offer to answer instead.
  const human = (id: string) => league.teams.find((t) => t.id === id)?.controller === "human";
  if (human(seller) || human(buyer)) {
    const [from, to] = human(seller) ? [buyerSide, sellerSide] : [sellerSide, buyerSide];
    offerTrade(league, from, to, why);
    return true;
  }
  // A full roster makes room first (waiving only someone worse); then both sides must say yes.
  const preview = previewTradeDeal(league, sellerSide, buyerSide);
  if (!preview.legal) {
    const rosterOnly = preview.problems.every((x) => x.includes("limit"));
    if (!rosterOnly || preview.teams[1].roomNow.after < 0) return false;
    if (!makeRoomFor(league, buyer, player)) return false;
    if (!previewTradeDeal(league, sellerSide, buyerSide).legal) return false;
  }
  if (!answerTrade(league, buyerSide, sellerSide, true, true).accept) return false;
  if (!answerTrade(league, sellerSide, buyerSide, true, true).accept) return false;
  executeTrade(
    league,
    sellerSide,
    buyerSide,
    "ai",
    `${why} (${name(player)}, ${player.position}).`,
  );
  return true;
}

/**
 * Shops a player his team wants to move (an unhappy player who asked out, say): the teams he'd
 * start for, most interested first. Returns the trade's description, or null if no one bit.
 */
export function shopPlayer(
  league: League,
  seller: string,
  player: Player,
  why: string,
): string | null {
  if (!tradingOpen(league).open) return null;
  const buyers = league.teams
    .filter((t) => t.id !== seller && t.controller === "ai")
    .map((t) => ({ id: t.id, v: playerTradeValue(league, player, { teamId: t.id }, true).value }))
    .sort((a, b) => b.v - a.v || a.id.localeCompare(b.id))
    .slice(0, 8);
  for (const b of buyers)
    if (tryDeal(league, seller, b.id, player, why)) {
      const t = league.transactions.at(-1)!;
      return t.type === "traded" ? t.text : `Offered to ${b.id}.`;
    }
  return null;
}

/** A buyer chases a starter at its biggest need. */
function buy(league: League, buyer: string): boolean {
  const M = TRADE_MARKET;
  const needs = [...teamNeeds(league, buyer)]
    .filter(([, n]) => n >= M.minNeed)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const target = needs[0];
  if (!target) return false;
  const position = target[0];
  const cap = dealCap(league, buyer);
  const mine = readAt(league, buyer, position);
  const weakestStarter = mine[(STARTERS[position] ?? 1) - 1]?.overall ?? 0;
  const viewer = { kind: "team" as const, teamId: buyer };
  // Each seller's starters at the position, read once per search.
  const startersBy = new Map<string, Set<number>>();
  const candidates = league.players
    .filter(
      (p) =>
        p.position === position &&
        p.teamId !== null &&
        p.teamId !== buyer &&
        tradable(league, p, p.teamId) &&
        readOverall(league, p, viewer) >= weakestStarter + M.upgradeBy,
    )
    // Sellers: rebuilding teams, or teams with him on the bench.
    .filter((p) => {
      if (stanceOf(league, p.teamId!) === "rebuild") return true;
      let starters = startersBy.get(p.teamId!);
      if (!starters) {
        starters = new Set(
          readAt(league, p.teamId!, position)
            .slice(0, STARTERS[position] ?? 1)
            .map((x) => x.p.id),
        );
        startersBy.set(p.teamId!, starters);
      }
      return !starters.has(p.id);
    })
    .map((p) => ({ p, v: playerTradeValue(league, p, { teamId: buyer }, true).value }))
    .filter((x) => x.v <= cap)
    .sort((a, b) => b.v - a.v || a.p.id - b.p.id)
    .slice(0, M.candidates);
  for (const { p } of candidates)
    if (
      tryDeal(
        league,
        p.teamId!,
        buyer,
        p,
        `${buyer} needed a ${position} and bought from ${p.teamId}`,
      )
    )
      return true;
  return false;
}

/** A seller shops a veteran starter to a contender that needs him. */
function sell(league: League, seller: string): boolean {
  const M = TRADE_MARKET;
  const cap = dealCap(league, seller);
  const vets = league.players
    .filter(
      (p) =>
        tradable(league, p, seller) &&
        p.experience >= 4 &&
        ageOn(p.birthDate, league.date) >= M.sellAge,
    )
    .map((p) => ({ p, v: playerTradeValue(league, p, { teamId: seller }, false).value }))
    .filter((x) => x.v > 3 && x.v <= cap)
    .sort((a, b) => b.v - a.v || a.p.id - b.p.id)
    .slice(0, 3);
  for (const { p } of vets) {
    const buyers = league.teams
      .filter((t) => t.id !== seller && stanceOf(league, t.id) === "contend")
      .map((t) => ({ id: t.id, need: teamNeeds(league, t.id).get(p.position) ?? 0 }))
      .filter((b) => b.need >= M.minNeed)
      .sort((a, b) => b.need - a.need || a.id.localeCompare(b.id))
      .slice(0, M.candidates);
    for (const b of buyers)
      if (tryDeal(league, seller, b.id, p, `${seller} is rebuilding and sold a veteran to ${b.id}`))
        return true;
  }
  return false;
}

/** At camp: a team deep at a position moves a player it can't keep for a late pick. */
function moveDepth(league: League, seller: string): boolean {
  const M = TRADE_MARKET;
  for (const position of Object.keys(ROSTER_MIX).sort() as Position[]) {
    const at = readAt(league, seller, position);
    if (at.length <= (ROSTER_MIX[position] ?? 2)) continue;
    // The best of those beyond what the team will keep.
    const extra = at[ROSTER_MIX[position] ?? 2];
    if (!extra || !tradable(league, extra.p, seller)) continue;
    const buyers = league.teams
      .filter((t) => t.id !== seller)
      .map((t) => ({ id: t.id, need: teamNeeds(league, t.id).get(position) ?? 0 }))
      .filter((b) => b.need >= M.campNeed)
      .sort((a, b) => b.need - a.need || a.id.localeCompare(b.id))
      .slice(0, 3);
    for (const b of buyers)
      if (
        tryDeal(league, seller, b.id, extra.p, `${seller} had more ${position}s than it could keep`)
      )
        return true;
  }
  return false;
}

/**
 * One step of the trade market: each GM may look for a deal (buy, sell, or at camp move depth).
 * Returns the number of trades (and offers) made.
 */
export function tradeMarket(
  league: League,
  stretch: MarketStretch,
  days: number,
  boost = 1,
): number {
  if (!tradingOpen(league).open) return 0;
  let n = 0;
  for (const team of [...league.teams].sort((a, b) => a.id.localeCompare(b.id))) {
    if (team.controller !== "ai") continue;
    const tries = searches(league, team.id, stretch, days, boost);
    for (let i = 0; i < tries; i++) {
      const stance = stanceOf(league, team.id);
      const roll = uniformFrom(`${league.meta.seed}:trade-mode:${team.id}:${league.date}:${i}`);
      const done =
        stretch === "camp" && roll < 0.5
          ? moveDepth(league, team.id)
          : stance === "rebuild" || (stance === "retool" && roll < 0.5)
            ? sell(league, team.id)
            : buy(league, team.id);
      if (done) n += 1;
    }
  }
  return n;
}

/** An offer to a person-run team: saved, and a decision waiting in their queue. */
export function offerTrade(league: League, from: TradeSide, to: TradeSide, reason: string): void {
  const id = league.nextIds.tradeOffer++;
  league.tradeOffers.push({
    id,
    date: league.date,
    expires: addDays(league.date, TRADE_MARKET.offerDays),
    fromTeamId: from.teamId,
    toTeamId: to.teamId,
    give: { players: from.players, picks: from.picks },
    get: { players: to.players, picks: to.picks },
    reason,
    status: "open",
  });
  askTeam(league, to.teamId, {
    kind: "trade-offer",
    prompt: `${from.teamId} offers a trade: ${reason}`,
    options: ["accept", "decline"],
    offerId: id,
  });
}

/** Offers past their date expire (and leave the person's queue). */
export function expireOffers(league: League): void {
  for (const o of league.tradeOffers) {
    if (o.status !== "open" || o.expires >= league.date) continue;
    o.status = "expired";
    league.pendingDecisions = league.pendingDecisions.filter((d) => d.request.offerId !== o.id);
  }
  league.tradeOffers = league.tradeOffers.filter(
    (o) => o.status === "open" || o.date >= addDays(league.date, -365),
  );
}
