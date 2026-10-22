/**
 * Contract talks (Phase 12).
 *
 * - A player's demand starts at his market value (market.ts) and moves with
 *   his agent's style, his ego and how much he cares about money; his own
 *   team gets a loyalty discount. He wants the years his age usually gets and
 *   the guarantees his pay usually carries.
 * - A team's appeal to him (-1 to 1) weighs what he cares about: winning (the
 *   roster's strength), his role (would he start?), the location, and the
 *   coach's scheme. A great situation lets him take a little less.
 * - An offer is judged by its money (yearly value and guarantees against his
 *   ask, and the years). Meeting or beating the ask in every part always
 *   works. Well short of it ends talks (a lowball); in between, he counters,
 *   meeting the team partway at his agent's pace, until his patience runs out.
 *
 * Every answer has a reason. Nothing is random: small differences between
 * players come from hashes, so the same offer always gets the same answer.
 */
import type { Dollars } from "@fgm/foundation";
import { STARTERS } from "../generate/config";
import type { Agent, Contract, ContractYear, League, Offer, Player } from "../league/schema";
import { fitScore, teamScheme } from "../coaches/fit";
import { agentOf } from "../people/agents";
import { readOverall } from "../perception";
import { uniformFrom } from "../scouting/noise";
import { starterStrengths } from "../season/flow";
import { minimumSalary, salaryCap } from "./cap";
import { prorationSeasons } from "./contract";
import { marketValue, typicalGuarantee, type MarketValue } from "./market";

export const NEGOTIATION = {
  /** Agents' styles: how much more they ask, how far below the ask ends talks, how fast they come down. */
  agent: {
    hardball: { ask: 1.08, walkAway: 0.86, concession: 0.25, patience: 3 },
    fair: { ask: 1.0, walkAway: 0.76, concession: 0.5, patience: 4 },
    relationship: { ask: 0.98, walkAway: 0.72, concession: 0.5, patience: 5 },
    money: { ask: 1.05, walkAway: 0.82, concession: 0.35, patience: 3 },
  } as Record<
    Agent["style"],
    { ask: number; walkAway: number; concession: number; patience: number }
  >,
  /** Ask moves: per point of ego and money priority above typical (as shares). */
  egoAsk: 0.04,
  moneyAsk: 0.05,
  /** A loyal player takes up to this much less from his own team. */
  loyaltyDiscount: 0.06,
  /** Money score: yearly value and guarantees, and the cost of years off what he wants. */
  guaranteeWeight: 0.3,
  yearsTolerance: 1,
  yearsPenalty: 0.04,
  /** How much a team's appeal (-1 to 1) can move the money he needs (for a player who cares nothing about money). */
  appealWeight: 0.15,
  /** Appeal parts: role (starter, rotation, backup) and coach fit's weight next to his priorities. */
  role: { starter: 1, rotation: 0.2, backup: -0.6 },
  coachWeight: 0.15,
  /** Offers this close to the ask (a share) count as meeting it: rounding isn't a reason to haggle. */
  askTolerance: 0.005,
  /** Each player's own wobble on what he needs (from a hash; keeps answers from being identical). */
  wobble: 0.02,
};

export interface Demand {
  apy: Dollars;
  years: number;
  guaranteed: Dollars;
  signingBonus: Dollars;
  market: MarketValue;
  agent: Agent;
  /** Years he'll consider. */
  minYears: number;
  maxYears: number;
  reasons: string[];
}

/** What a player asks a team (or the market, `teamId` null) for. */
export function demandFor(
  league: League,
  p: Player,
  teamId: string | null,
  /** The team he's loyal to (his own, or the one he just left). */
  home: string | null = p.teamId,
): Demand {
  const N = NEGOTIATION;
  const market = marketValue(league, p);
  const agent = agentOf(league, p);
  const style = N.agent[agent.style];
  const ego = (p.personality.ego - 50) / 50;
  const money = (p.personality.priorities.money - 25) / 75;
  const loyal =
    teamId !== null && teamId === home ? Math.max(0, (p.personality.loyalty - 50) / 50) : 0;
  const factor =
    style.ask * (1 + N.egoAsk * ego + N.moneyAsk * money) * (1 - N.loyaltyDiscount * loyal);
  const minimum = minimumSalary(league.rules.cap, league.season, p.experience);
  const apy = Math.max(minimum, Math.round(market.apy * factor));
  const cap = salaryCap(league.rules.cap, league.season);
  const years = market.years;
  const total = apy * years;
  const guaranteed = Math.round(total * typicalGuarantee(apy / cap));
  // Big deals put much of the guarantee in a signing bonus (spread on the cap).
  const signingBonus = apy > 3 * minimum ? Math.round(guaranteed * 0.5) : 0;
  const reasons = [
    market.reason,
    `Agent ${agent.firstName} ${agent.lastName} (${agent.agency}, ${agent.style === "relationship" ? "relationship-driven" : agent.style === "money" ? "money-only" : agent.style})${style.ask !== 1 ? ` asks ${style.ask > 1 ? "more" : "less"}` : ""}.`,
  ];
  if (Math.abs(ego) > 0.4)
    reasons.push(ego > 0 ? "A big ego: he thinks he's worth more." : "Modest about his worth.");
  if (loyal > 0.3) reasons.push("Loyal to his team: he'd take a little less to stay.");
  return {
    apy,
    years,
    guaranteed,
    signingBonus,
    market,
    agent,
    minYears: Math.max(1, years - N.yearsTolerance),
    maxYears: years + N.yearsTolerance,
    reasons,
  };
}

// Teams by roster strength, kept while nothing changes (same date, no new transactions).
const STRENGTHS = new WeakMap<League, { key: string; ranked: [string, number][] }>();
function rankedStrengths(league: League): [string, number][] {
  const key = `${league.date}:${league.transactions.length}`;
  const hit = STRENGTHS.get(league);
  if (hit && hit.key === key) return hit.ranked;
  const ranked = [...starterStrengths(league).entries()].sort(
    (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
  );
  STRENGTHS.set(league, { key, ranked });
  return ranked;
}

// Each team's read of its players' overalls at each position (best first), kept while nothing
// changes (same date, no new transactions): role questions are asked many times a day.
const DEPTH = new WeakMap<
  League,
  { key: string; teams: Map<string, Map<string, { id: number; overall: number }[]>> }
>();

function depthReads(
  league: League,
  teamId: string,
): Map<string, { id: number; overall: number }[]> {
  const key = `${league.date}:${league.transactions.length}`;
  let cache = DEPTH.get(league);
  if (!cache || cache.key !== key) {
    cache = { key, teams: new Map() };
    DEPTH.set(league, cache);
  }
  let team = cache.teams.get(teamId);
  if (!team) {
    team = new Map();
    const viewer = { kind: "team" as const, teamId };
    for (const x of league.players) {
      if (x.teamId !== teamId || x.retiredAfter !== null || x.roster === "practice-squad") continue;
      const list = team.get(x.position) ?? [];
      list.push({ id: x.id, overall: readOverall(league, x, viewer) });
      team.set(x.position, list);
    }
    for (const list of team.values()) list.sort((a, b) => b.overall - a.overall);
    cache.teams.set(teamId, team);
  }
  return team;
}

/** How many of a team's players at his position it rates above him (its own read). */
export function betterOnTeam(league: League, teamId: string, p: Player): number {
  const mine = readOverall(league, p, { kind: "team", teamId });
  let n = 0;
  for (const x of depthReads(league, teamId).get(p.position) ?? []) {
    if (x.overall <= mine) break;
    if (x.id !== p.id) n += 1;
  }
  return n;
}

export interface Appeal {
  /** -1 (a place he'd avoid) to 1 (ideal). */
  score: number;
  parts: { winning: number; role: number; location: number; coach: number };
  reasons: string[];
}

/** How attractive a team is to him, by what he cares about. */
export function teamAppeal(league: League, p: Player, teamId: string): Appeal {
  const N = NEGOTIATION;
  // Winning: where the roster ranks (by its starters' strength).
  const strengths = rankedStrengths(league);
  const place = strengths.findIndex(([id]) => id === teamId);
  const winning = strengths.length > 1 ? 1 - (2 * place) / (strengths.length - 1) : 0;
  // Role: would he start there (by the team's own read of its players)?
  const better = betterOnTeam(league, teamId, p);
  const starters = STARTERS[p.position] ?? 1;
  const role =
    better < starters ? N.role.starter : better < 2 * starters ? N.role.rotation : N.role.backup;
  // Location: each player likes some places more (fixed by a hash).
  const location = uniformFrom(`${league.meta.seed}:location:${p.id}:${teamId}`) * 2 - 1;
  const coach = fitScore(p.ratings, p.position, teamScheme(league, teamId, p.position));
  const pr = p.personality.priorities;
  const weights = pr.winning + pr.role + pr.location;
  const situation =
    weights > 0 ? (pr.winning * winning + pr.role * role + pr.location * location) / weights : 0;
  const score = Math.max(-1, Math.min(1, (1 - N.coachWeight) * situation + N.coachWeight * coach));
  const reasons: string[] = [];
  if (pr.winning >= 30)
    reasons.push(
      winning > 0.3
        ? "wants to win, and they can"
        : winning < -0.3
          ? "wants to win, and they're rebuilding"
          : "wants to win",
    );
  if (pr.role >= 30) reasons.push(role > 0.5 ? "would start there" : "wouldn't start there");
  if (pr.location >= 30)
    reasons.push(
      location > 0.3
        ? "likes the city"
        : location < -0.3
          ? "isn't keen on the city"
          : "cares where he lives",
    );
  if (Math.abs(coach) > 0.4)
    reasons.push(coach > 0 ? "fits their scheme" : "doesn't fit their scheme");
  return { score, parts: { winning, role, location, coach }, reasons };
}

/** The money in an offer against his ask: about 1 when it matches. */
export function moneyScore(offer: Offer, demand: Demand): number {
  const N = NEGOTIATION;
  const pay = offer.apy / Math.max(1, demand.apy);
  const gtd = demand.guaranteed > 0 ? offer.guaranteed / demand.guaranteed : 1;
  const yearsOff = Math.max(0, Math.abs(offer.years - demand.years) - N.yearsTolerance);
  return (
    (1 - N.guaranteeWeight) * pay +
    N.guaranteeWeight * Math.min(gtd, 1.5) -
    N.yearsPenalty * yearsOff
  );
}

/** What he needs from this team: 1 is his full ask; a team he likes needs a little less. */
export function required(league: League, p: Player, appeal: Appeal): number {
  const N = NEGOTIATION;
  const caresAboutMoney = p.personality.priorities.money / 100;
  const wobble = (uniformFrom(`${league.meta.seed}:needs:${p.id}`) * 2 - 1) * N.wobble;
  return Math.min(1, 1 - N.appealWeight * (1 - caresAboutMoney) * appeal.score + wobble);
}

export interface Answer {
  decision: "accept" | "counter" | "reject";
  counter: Offer | null;
  reason: string;
  /** The money in the offer against his ask, and what he needed from this team. */
  score: number;
  needed: number;
}

const pct = (x: number) => `${Math.round(x * 100)}%`;
const money = (d: number) => `$${(d / 1_000_000).toFixed(2)}M`;

/** Meets or beats the ask in every part: always accepted (overpaying always works). */
export function meetsAsk(offer: Offer, demand: Demand): boolean {
  // Within half a percent counts as meeting it (offers are typed in rounded millions).
  const t = 1 - NEGOTIATION.askTolerance;
  return (
    offer.apy >= demand.apy * t &&
    offer.guaranteed >= demand.guaranteed * t &&
    offer.years >= demand.minYears &&
    offer.years <= demand.maxYears
  );
}

/**
 * His answer to an offer in round `round` (1 = the first) of talks with this team, with `asked`
 * his last counter (null before the first): accept, counter or reject, and why.
 */
export function answerOffer(
  league: League,
  p: Player,
  teamId: string,
  offer: Offer,
  round: number,
  asked: Offer | null,
): Answer {
  const N = NEGOTIATION;
  const demand = demandFor(league, p, teamId);
  // After a counter, he's measured against what he last asked for.
  const target: Demand = asked
    ? { ...demand, apy: asked.apy, guaranteed: asked.guaranteed, years: asked.years }
    : demand;
  const appeal = teamAppeal(league, p, teamId);
  const score = moneyScore(offer, target);
  const needed = required(league, p, appeal);
  const style = N.agent[demand.agent.style];
  const styleName =
    demand.agent.style === "relationship"
      ? "relationship-driven"
      : demand.agent.style === "money"
        ? "money-only"
        : demand.agent.style;
  const why = appeal.reasons.length ? ` He ${appeal.reasons.join(", ")}.` : "";
  if (meetsAsk(offer, target) || score >= needed)
    return {
      decision: "accept",
      counter: null,
      score,
      needed,
      reason: `Accepted: ${money(offer.apy)} a year over ${offer.years} with ${money(offer.guaranteed)} guaranteed ${score >= 1 ? "meets his ask" : `is ${pct(score)} of his ask, enough from this team`}.${why}`,
    };
  if (score < style.walkAway)
    return {
      decision: "reject",
      counter: null,
      score,
      needed,
      reason: `Offered ${pct(score)} of his asking price (${money(target.apy)} a year, ${money(target.guaranteed)} guaranteed); his agent (${styleName}) ended talks.`,
    };
  if (round >= style.patience)
    return {
      decision: "reject",
      counter: null,
      score,
      needed,
      reason: `After ${round} rounds at ${pct(score)} of his ask, his patience ran out.${why}`,
    };
  // Counter: come down part of the way, never below what he'd accept from this team.
  const floor = Math.round(target.apy * needed);
  const apy = Math.max(floor, Math.round(target.apy - style.concession * (target.apy - offer.apy)));
  const guaranteed = Math.max(
    offer.guaranteed,
    Math.round(
      target.guaranteed - style.concession * Math.max(0, target.guaranteed - offer.guaranteed),
    ),
  );
  const counter: Offer = {
    years: Math.min(demand.maxYears, Math.max(demand.minYears, offer.years)),
    apy,
    guaranteed: Math.min(
      guaranteed,
      apy * Math.min(demand.maxYears, Math.max(demand.minYears, offer.years)),
    ),
    signingBonus: Math.round(Math.min(guaranteed, apy) * 0.5),
  };
  return {
    decision: "counter",
    counter,
    score,
    needed,
    reason: `Countered at ${money(counter.apy)} a year, ${money(counter.guaranteed)} guaranteed: the offer was ${pct(score)} of his ask.${why}`,
  };
}

function year(season: number, base: Dollars): ContractYear {
  return {
    season,
    base,
    guaranteed: 0,
    injuryGuaranteed: 0,
    vestsOn: null,
    rosterBonus: 0,
    workoutBonus: 0,
    perGameBonus: 0,
    incentives: [],
    void: false,
  };
}

/**
 * A contract that pays the offer: the signing bonus prorated, salaries rising a little each
 * year (at least the minimum), and the rest of the guarantee in the first years' salaries.
 */
export function contractFromOffer(
  league: League,
  p: Player,
  teamId: string,
  offer: Offer,
  type: Contract["type"] = "veteran",
  season = league.season,
): Contract {
  const cap = league.rules.cap;
  const total = offer.apy * offer.years;
  const bonus = Math.min(offer.signingBonus, total);
  const salaryTotal = total - bonus;
  const weights = Array.from({ length: offer.years }, (_, i) => 1 + 0.1 * i);
  const sum = weights.reduce((a, b) => a + b, 0);
  const years = weights.map((w, i) =>
    year(
      season + i,
      Math.max(
        minimumSalary(cap, season + i, p.experience + i),
        Math.round((salaryTotal * w) / sum),
      ),
    ),
  );
  // Guarantees beyond the bonus go into the earliest salaries.
  let left = Math.max(0, offer.guaranteed - bonus);
  for (const y of years) {
    const g = Math.min(left, y.base);
    y.guaranteed = g;
    left -= g;
  }
  const contract: Contract = {
    teamId,
    type,
    signedOn: league.date,
    years,
    bonuses: [],
    fifthYearOption: null,
    veteranSalaryBenefit: false,
  };
  if (bonus > 0)
    contract.bonuses.push({
      amount: bonus,
      kind: "signing",
      seasons: prorationSeasons(contract, season, cap.maxProrationYears),
      paidIn: season,
    });
  return contract;
}

/** The offer his ask amounts to (for screens and teams that meet it). */
export function askAsOffer(d: Demand): Offer {
  return { years: d.years, apy: d.apy, guaranteed: d.guaranteed, signingBonus: d.signingBonus };
}
