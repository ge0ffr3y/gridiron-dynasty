/**
 * Free agency (Phase 12).
 *
 * Before the League Year (the re-signing window): each team negotiates with
 * its expiring players it wants back; when talks fail with a star, it may use
 * its one tag (franchise or transition); restricted and exclusive-rights free
 * agents get tenders.
 *
 * From the League Year: the market runs day by day for the first week, then a
 * week at a time. Each day AI teams make or raise offers to the free agents
 * they want most (by need, their own staff's read of him, and the room they
 * keep), and players take the best offer by everything they care about once
 * it's good enough; the longer a player waits unsigned, the less he holds out
 * for. Restricted free agents can sign offer sheets, which their old team has
 * five days to match. After the draft, a weekly late market and minimum deals
 * fill rosters.
 *
 * Every move carries a reason. Choices use the league's own seeded draws only
 * through hashes, so a screen asking about the market never changes it.
 */
import { addDays, ageOn, daysBetween, type Dollars } from "@fgm/foundation";
import { STARTERS } from "../generate/config";
import type { League, Offer, Player } from "../league/schema";
import { readOverall } from "../perception";
import { MORALE } from "../people/morale";
import { staffDecides } from "../career/delegation";
import { gmBudgetShift, gmLimitFactor, wantsEarlyExtension } from "../front-office/strategy";
import { teamNeeds } from "../draft/boards";
import { uniformFrom } from "../scouting/noise";
import { seasonDates } from "../season/calendar";
import { minimumSalary, rookieSlot, salaryCap, tagCategory } from "./cap";
import { capHit, span, totalValue } from "./contract";
import { marketValue, typicalGuarantee } from "./market";
import {
  betterOnTeam,
  answerOffer,
  askAsOffer,
  contractFromOffer,
  demandFor,
  moneyScore,
  NEGOTIATION,
  teamAppeal,
  type Demand,
} from "./negotiation";
import { extendContract, previewRelease, recordTransaction } from "./operations";
import { getUnderCap } from "./upkeep";
import { scratch } from "./views";
import { onTeam, openSpots } from "../roster/lists";
import { playerValue, waivePlayer } from "../roster/moves";
import { tagTender } from "./tags";
import { capSheet } from "./team";

export const FREE_AGENCY = {
  /** Day by day for the first week, then a week at a time. */
  dailyDays: 7,
  /** Room a team keeps for the season (share of the cap), beyond its draft picks' deals. */
  reserveShareOfCap: 0.02,
  /** A team pays up to this much more for a full need, and this much per point its read beats the market's. */
  needPremium: 0.12,
  readPremiumPerPoint: 0.03,
  /** Teams open at this share of their limit and raise when outbid. */
  openingShare: 0.94,
  raiseStep: 0.04,
  /** Open offers a team may have out, as a multiple of its room (most aren't accepted). */
  overcommit: 2,
  /** At most this many new offers a team makes in a day (a week counts as one round). */
  offersPerRound: 6,
  /** Free agents worth more than the minimum by this factor get the teams' attention. */
  targetAboveMinimum: 1.15,
  /** A player holds out for less the longer he's unsigned: per day in the first week, then per week. */
  dailyDecay: 0.012,
  weeklyDecay: 0.035,
  /** The least a player holds out for, as a share of his ask (before the minimum). */
  floorShare: 0.45,
  /** Days a free agent waits for offers to come in before deciding (top 50 at his position: 1). */
  waitDays: { top: 1, rest: 2 },
  /** Re-signing: a team wants a player back if he'd be among its top this many times the starters at his position. */
  keepDepth: 1.5,
  /**
   * The share of wanted players who let their deal run out to test the market (before personality:
   * money, ego, loyalty and his mood (Phase 12b) move it). Tuned so about as many good players change teams as re-sign
   * (real: ~140 a year paid 1%+ of the cap change teams, ~105 re-sign; calibration/market.json).
   */
  testMarket: { base: 0.5, money: 0.15, ego: 0.1, loyalty: 0.15, mood: 0.2, winning: 0.25 },
  /** Tags: used on a player in the market's top this-many at his position whose talks failed. */
  tagTopRank: 8,
  /** ...or, for a quarterback, in the top this-many (teams keep starting quarterbacks). */
  tagTopRankQb: 16,
  /** A starting quarterback tests the market this share as often as others. */
  starterQbTest: 0.5,
  /** Restricted tenders: the level the player's market value covers, by this margin. */
  tenderMargin: 1.1,
  /** Offer sheets: a team offers one only if the player is worth this many times his tender. */
  offerSheetValue: 2,
  /** Offer sheets are rare (about one or two a year league-wide in the 2020s). Judgment. */
  offerSheetsPerYear: 2,
  /** After the draft, a late round this often until camp. */
  lateEveryDays: 21,
  /** Extensions: each regular-season week, a team extends players in their last year if they'd start. */
  extensionChance: 0.2,
  /** ...up to this many of its starters in their deal's last year (Phase 13: real teams extend
   * about 67 players a year at 1%+ of the cap, calibration/market.json). */
  extensionsPerRoll: 1,
};

const money = (d: number) => `$${(d / 1_000_000).toFixed(2)}M`;
const name = (p: Player) => `${p.firstName} ${p.lastName}`;

/** Rookie deals still to sign this League Year (the team's unused picks), first-year cost. */
function rookiePool(league: League, teamId: string): Dollars {
  return league.draftPicks
    .filter((d) => d.season === league.season && d.ownerTeamId === teamId && d.selection === null)
    .reduce((s, d) => {
      const slot = rookieSlot(
        league.rules,
        league.season,
        d.overall ?? d.round * league.teams.length,
      );
      return s + Math.round(slot.total / league.rules.cap.rookieScale.years);
    }, 0);
}

/** What a team can still spend this League Year: its room, less its picks' deals and a reserve. */
export function teamBudget(league: League, teamId: string): Dollars {
  const cap = salaryCap(league.rules.cap, league.season);
  const room = capSheet(league, teamId, league.season).room;
  // The GM and owner move it (Phase 13): cap-aggressive GMs and big spenders spend more,
  // rebuilders keep money back.
  return (
    room -
    rookiePool(league, teamId) -
    Math.round(cap * FREE_AGENCY.reserveShareOfCap) +
    gmBudgetShift(league, teamId)
  );
}

/** Where he'd fit on a team: starter, rotation or depth (by the team's read). */
export function roleOn(
  league: League,
  teamId: string,
  p: Player,
): "starter" | "rotation" | "depth" {
  const better = betterOnTeam(league, teamId, p);
  const starters = STARTERS[p.position] ?? 1;
  return better < starters
    ? "starter"
    : better < Math.ceil(FREE_AGENCY.keepDepth * starters)
      ? "rotation"
      : "depth";
}

/** The most a team will pay a player a year: his market value, moved by its read and its need. */
export function teamLimit(
  league: League,
  teamId: string,
  p: Player,
  needs = teamNeeds(league, teamId),
): Dollars {
  const F = FREE_AGENCY;
  const market = marketValue(league, p);
  const own = readOverall(league, p, { kind: "team", teamId });
  const consensus = readOverall(league, p, { kind: "league" });
  const read = 1 + F.readPremiumPerPoint * (own - consensus);
  const need = 1 + F.needPremium * (needs.get(p.position) ?? 0);
  const minimum = minimumSalary(league.rules.cap, league.season, p.experience);
  // The GM's style and the team's stance (Phase 13).
  const style = gmLimitFactor(league, teamId, p);
  return Math.max(minimum, Math.round(market.apy * read * need * style));
}

/** An offer at a yearly value, shaped like his ask (years, guarantees by pay). */
function offerAt(league: League, demand: Demand, apy: Dollars): Offer {
  const cap = salaryCap(league.rules.cap, league.season);
  const years = demand.years;
  const guaranteed = Math.round(apy * years * typicalGuarantee(apy / cap));
  const minimum = minimumSalary(league.rules.cap, league.season, 0);
  return {
    years,
    apy,
    guaranteed,
    signingBonus: apy > 3 * minimum ? Math.round(guaranteed * 0.5) : 0,
  };
}

/**
 * A roster spot for a new signing: a team at the limit waives its least valuable player (never
 * this year's draft picks), but only for someone better. False if there's no one to let go.
 */
export function makeRoomFor(league: League, teamId: string, p: Player, why?: string): boolean {
  if (openSpots(league, teamId) > 0) return true;
  // The least valuable player whose release the cap can bear: a release can cost more than it
  // saves (guaranteed money accelerates), and that mustn't push the team over the cap.
  const room = capSheet(league, teamId, league.season).room;
  const weakest = onTeam(league, teamId)
    .filter((x) => x.roster === "active" && x.id !== p.id && x.drafted?.season !== league.season)
    .sort((a, b) => playerValue(league, a) - playerValue(league, b) || b.id - a.id)
    .slice(0, 6)
    .find((x) => room + previewRelease(league, x.id).savingsThisYear >= 0);
  if (!weakest || playerValue(league, weakest) >= playerValue(league, p)) return false;
  waivePlayer(
    league,
    weakest.id,
    why ?? `Waived to make room for ${name(p)}, signed as a free agent.`,
  );
  return openSpots(league, teamId) > 0;
}

/** Signs a negotiated deal: the contract, a transaction with its reason, and the free-agent record. */
function sign(
  league: League,
  p: Player,
  teamId: string,
  offer: Offer,
  kind: "re-signed" | "free-agent" | "matched",
  reason: string,
  formerTeamId: string | null,
): void {
  const contract = contractFromOffer(league, p, teamId, offer);
  p.teamId = teamId;
  p.contract = contract;
  p.rights = null;
  p.roster = "active";
  if (
    kind === "free-agent" &&
    formerTeamId &&
    formerTeamId !== teamId &&
    p.experience >= league.rules.draft.compensatory.unrestrictedAccruedSeasons
  )
    league.freeAgentMoves.push({
      season: league.season,
      date: league.date,
      playerId: p.id,
      fromTeamId: formerTeamId,
      toTeamId: teamId,
      position: p.position,
      averagePerYear: Math.round(totalValue(contract) / contract.years.length),
      years: contract.years.length,
      accruedSeasons: p.experience,
    });
  recordTransaction(league, {
    type: "signed",
    teamIds: [teamId],
    playerIds: [p.id],
    text: `${teamId} ${kind === "re-signed" ? "re-signed" : kind === "matched" ? "matched the offer sheet for" : "signed free agent"} ${name(p)} (${p.position}): ${offer.years} year${offer.years === 1 ? "" : "s"}, ${money(offer.apy)} a year, ${money(offer.guaranteed)} guaranteed.`,
    reason,
  });
}

// Free agents' former teams, read once per League Year from the "expired" transactions.
const FORMER = new WeakMap<League, { key: string; teams: Map<number, string> }>();

/** The team a free agent last played for (his deal ran out there this League Year), if any. */
export function formerTeam(league: League, p: Player): string | null {
  const key = `${league.season}:${league.transactions.length}`;
  let cache = FORMER.get(league);
  if (!cache || cache.key !== key) {
    const teams = new Map<number, string>();
    const since = `${league.season - 1}-12-31`;
    for (const t of league.transactions)
      if (t.type === "expired" && t.date > since)
        for (const id of t.playerIds) if (t.teamIds[0]) teams.set(id, t.teamIds[0]);
    cache = { key, teams };
    FORMER.set(league, cache);
  }
  return cache.teams.get(p.id) ?? null;
}

// --- The re-signing window, tags and tenders -------------------------------------------------

/** Players whose deals run out at this League Year, still on their teams. */
export function expiringPlayers(league: League): Player[] {
  return league.players
    .filter(
      (p) =>
        p.teamId !== null &&
        p.contract &&
        p.retiredAfter === null &&
        span(p.contract).lastReal < league.season,
    )
    .sort((a, b) => a.id - b.id);
}

/**
 * Talks between a team and its own expiring player: it opens below its limit and meets his
 * counters up to its limit. Returns the agreed offer, or null with why talks failed.
 */
function negotiateOwn(
  league: League,
  teamId: string,
  p: Player,
  limit: Dollars,
): { offer: Offer | null; reason: string } {
  const demand = demandFor(league, p, teamId);
  let apy = Math.min(limit, Math.round(demand.apy * FREE_AGENCY.openingShare));
  let asked: Offer | null = null;
  for (let round = 1; round <= 6; round++) {
    const offer = offerAt(league, demand, apy);
    const answer = answerOffer(league, p, teamId, offer, round, asked);
    if (answer.decision === "accept") return { offer, reason: answer.reason };
    if (answer.decision === "reject") return { offer: null, reason: answer.reason };
    asked = answer.counter!;
    // Meet his counter if it's within the limit; otherwise go to the limit once more.
    if (asked.apy <= limit)
      return { offer: { ...asked }, reason: `Met his counter. ${answer.reason}` };
    if (apy >= limit)
      return {
        offer: null,
        reason: `His counter (${money(asked.apy)} a year) is beyond what they'll pay (${money(limit)}).`,
      };
    apy = limit;
  }
  return { offer: null, reason: "Talks went nowhere." };
}

/** Restricted and exclusive-rights free agents: the tender a team would give (or none). */
export function tenderFor(
  league: League,
  p: Player,
): { kind: NonNullable<Player["rights"]>["kind"]; amount: Dollars } | null {
  const F = league.rules.freeAgency;
  const t = league.rules.cap.rfaTenders2026;
  const capGrowth = salaryCap(league.rules.cap, league.season) / salaryCap(league.rules.cap, 2026);
  const prior = p.contract
    ? (p.contract.years.find((y) => y.season === league.season - 1)?.base ?? 0)
    : 0;
  const level = (amount: number) =>
    Math.max(Math.round(amount * capGrowth), Math.round(prior * t.priorSalaryMultiplier));
  const value = marketValue(league, p).apy;
  if (p.experience < F.exclusiveRightsBelowAccruedSeasons)
    return { kind: "erfa", amount: minimumSalary(league.rules.cap, league.season, p.experience) };
  if (p.experience !== F.restrictedAccruedSeasons) return null;
  const tiers: [NonNullable<Player["rights"]>["kind"], number][] = [
    ["rfa-first", level(t.firstRound)],
    ["rfa-second", level(t.secondRound)],
    [
      p.drafted ? "rfa-original" : "rfa-rofr",
      level(p.drafted ? t.originalRound : t.rightOfFirstRefusal),
    ],
  ];
  // The highest level his value covers (by a margin); a team won't tender above his worth.
  for (const [kind, amount] of tiers)
    if (value >= amount * FREE_AGENCY.tenderMargin) return { kind, amount };
  return value >= tiers[2]![1] ? { kind: tiers[2]![0], amount: tiers[2]![1] } : null;
}

/** A one-year tender or tag contract that holds his rights (it counts on the cap). */
export function holdRights(
  league: League,
  p: Player,
  teamId: string,
  kind: NonNullable<Player["rights"]>["kind"],
  amount: Dollars,
  reason: string,
): void {
  const type = kind.startsWith("franchise")
    ? "franchise"
    : kind === "transition"
      ? "transition"
      : "tender";
  const contract = contractFromOffer(
    league,
    p,
    teamId,
    { years: 1, apy: amount, guaranteed: kind === "erfa" ? 0 : amount, signingBonus: 0 },
    type,
  );
  p.contract = contract;
  p.rights = { kind, teamId, season: league.season };
  const label: Record<string, string> = {
    "franchise-exclusive": "the exclusive franchise tag",
    franchise: "the franchise tag",
    transition: "the transition tag",
    "rfa-first": "a first-round restricted tender",
    "rfa-second": "a second-round restricted tender",
    "rfa-original": "an original-round restricted tender",
    "rfa-rofr": "a right-of-first-refusal tender",
    erfa: "an exclusive-rights tender",
  };
  recordTransaction(league, {
    type: "tagged",
    teamIds: [teamId],
    playerIds: [p.id],
    text: `${teamId} placed ${label[kind]} on ${name(p)} (${p.position}): ${money(amount)} for one year.`,
    reason,
  });
}

/** What a franchise or transition tag on him costs this League Year (CBA Article 10). */
export function tagPrice(league: League, p: Player, kind: "franchise" | "transition"): Dollars {
  const prior = p.contract?.years.find((y) => y.season === league.season - 1)?.base ?? 0;
  const timesTagged = league.transactions.filter(
    (t) => t.type === "tagged" && t.playerIds.includes(p.id) && t.text.includes("franchise tag"),
  ).length;
  return tagTender(league, kind, p.position, league.season, prior, timesTagged);
}

/**
 * The re-signing window (before the League Year): every team talks to its expiring players it
 * wants back, may tag a star whose talks failed, and tenders its restricted and exclusive-rights
 * free agents. Players it doesn't keep hit free agency when the League Year opens.
 */
export function reSigningWindow(
  league: League,
  /** Only these teams' (or players') decisions: a person's staff stepping in (Phase 14). */
  only?: { teamIds?: string[]; playerIds?: number[] },
): void {
  const season = league.season;
  // A team's one tag a year: those already used this League Year count.
  const tagsUsed = new Set<string>(
    league.players.flatMap((p) =>
      p.rights &&
      p.rights.season === season &&
      (p.rights.kind === "franchise" ||
        p.rights.kind === "franchise-exclusive" ||
        p.rights.kind === "transition")
        ? [p.rights.teamId]
        : [],
    ),
  );
  // First every team gets under the new League Year's cap (restructures, then releases).
  if (!only) for (const team of league.teams) getUnderCap(league, team.id);
  const teams = [...league.teams]
    .sort((a, b) => a.id.localeCompare(b.id))
    .filter((t) =>
      only?.teamIds ? only.teamIds.includes(t.id) : staffDecides(league, t.id, "re-signing"),
    );
  for (const team of teams) {
    const needs = teamNeeds(league, team.id);
    const mine = expiringPlayers(league)
      .filter((p) => p.teamId === team.id && (!only?.playerIds || only.playerIds.includes(p.id)))
      .sort((a, b) => marketValue(league, b).apy - marketValue(league, a).apy || a.id - b.id);
    for (const p of mine) {
      const tender = tenderFor(league, p);
      const role = roleOn(league, team.id, p);
      if (tender && p.experience <= league.rules.freeAgency.restrictedAccruedSeasons) {
        // Young players: a tender holds their rights cheaply if they'd make the team.
        if (role !== "depth" && teamBudget(league, team.id) >= tender.amount)
          holdRights(
            league,
            p,
            team.id,
            tender.kind,
            tender.amount,
            `${role === "starter" ? "A starter" : "A rotation player"} the team wants to keep; the tender holds his rights for a year.`,
          );
        continue;
      }
      if (role === "depth") continue;
      const age = ageOn(p.birthDate, league.date);
      const limit = Math.min(
        teamLimit(league, team.id, p, needs),
        Math.max(0, teamBudget(league, team.id)),
      );
      if (limit <= minimumSalary(league.rules.cap, season, p.experience)) continue;
      // Some players want to see what the market says first (more if they care about money or
      // think highly of themselves; less if they're loyal): they let their deal run out.
      const pr = p.personality;
      const testChance =
        FREE_AGENCY.testMarket.base +
        FREE_AGENCY.testMarket.money * ((pr.priorities.money - 25) / 75) +
        FREE_AGENCY.testMarket.ego * ((pr.ego - 50) / 50) -
        FREE_AGENCY.testMarket.loyalty * ((pr.loyalty - 50) / 50) -
        FREE_AGENCY.testMarket.mood * (((p.mood?.score ?? MORALE.neutral) - MORALE.neutral) / 50) -
        // A winning team keeps its players: few leave a contender to test the market (Phase 13).
        FREE_AGENCY.testMarket.winning * teamAppeal(league, p, team.id).parts.winning;
      // A team's starting quarterback rarely reaches the market (Phase 13).
      const qbFactor = p.position === "QB" && role === "starter" ? FREE_AGENCY.starterQbTest : 1;
      const testsMarket =
        uniformFrom(`${league.meta.seed}:tests-market:${p.id}:${season}`) < testChance * qbFactor;
      if (testsMarket) continue;
      const talks = negotiateOwn(league, team.id, p, limit);
      if (talks.offer) {
        sign(
          league,
          p,
          team.id,
          talks.offer,
          "re-signed",
          `${role === "starter" ? "A starter" : "A rotation player"} (age ${age}) they wanted back. ${talks.reason}`,
          null,
        );
        continue;
      }
      // Talks failed. A star in the market's top at his position may get the team's tag.
      const value = marketValue(league, p);
      const tagRank = p.position === "QB" ? FREE_AGENCY.tagTopRankQb : FREE_AGENCY.tagTopRank;
      if (tagsUsed.has(team.id) || value.rank > tagRank) continue;
      const category = tagCategory(league.rules.cap, p.position);
      const amount = tagPrice(league, p, "franchise");
      if (amount <= value.apy * 1.25 && teamBudget(league, team.id) >= amount) {
        tagsUsed.add(team.id);
        holdRights(
          league,
          p,
          team.id,
          "franchise",
          amount,
          `Talks failed (${talks.reason}). He's #${value.rank} at ${p.position} on the market; the franchise tag for ${category} keeps him a year (others may make an offer sheet, at the price of two first-round picks).`,
        );
      }
    }
  }
}

// --- Free agency day by day -------------------------------------------------------------------

/** Free agency opens with the League Year. */
export function startFreeAgency(league: League): void {
  league.freeAgency = { season: league.season, day: 0, offers: [], offerSheets: [] };
}

/** Free agents worth a team's attention (more than the minimum by a margin), best first. */
function marketPool(league: League): Player[] {
  return league.players
    .filter((p) => p.teamId === null && p.retiredAfter === null && p.experience > 0)
    .map((p) => ({ p, v: marketValue(league, p).apy }))
    .filter(
      ({ p, v }) =>
        v >=
        minimumSalary(league.rules.cap, league.season, p.experience) *
          FREE_AGENCY.targetAboveMinimum,
    )
    .sort((a, b) => b.v - a.v || a.p.id - b.p.id)
    .map(({ p }) => p);
}

/** How much less a player holds out for after `days` unsigned. */
function holdOut(days: number): number {
  const F = FREE_AGENCY;
  const early = Math.min(days, F.dailyDays) * F.dailyDecay;
  const late = (Math.max(0, days - F.dailyDays) / 7) * F.weeklyDecay;
  return Math.max(F.floorShare, 1 - early - late);
}

/** How a player rates a team's offer: the money against his ask, plus how much he likes the team. */
function utility(
  league: League,
  p: Player,
  teamId: string,
  offer: Offer,
  home: string | null,
): number {
  const demand = demandFor(league, p, teamId, home);
  const appeal = teamAppeal(league, p, teamId);
  return (
    moneyScore(offer, demand) +
    NEGOTIATION.appealWeight * (1 - p.personality.priorities.money / 100) * appeal.score
  );
}

/**
 * One round of free agency (`days` long: 1 in the first week, 7 after): teams make and raise
 * offers, players choose, offer sheets are matched or not. Returns how many signed.
 */
export function freeAgencyRound(league: League, days: number): number {
  const fa = league.freeAgency;
  if (!fa) return 0;
  const F = FREE_AGENCY;
  fa.day += days;
  resolveOfferSheets(league);
  const pool = marketPool(league);
  const inPool = new Set(pool.map((p) => p.id));
  // Offers to players no longer available are dropped.
  fa.offers = fa.offers.filter((o) => inPool.has(o.playerId));
  // Teams make and raise offers, in an order that rotates each round (no team always goes first).
  const teams = [...league.teams].sort((a, b) => a.id.localeCompare(b.id));
  const start = fa.day % teams.length;
  const ordered = [...teams.slice(start), ...teams.slice(0, start)];
  for (const team of ordered) {
    // A person-run team bids itself, unless his staff handle free agency (Phase 14).
    if (!staffDecides(league, team.id, "free-agency")) continue;
    const needs = teamNeeds(league, team.id);
    const room = teamBudget(league, team.id);
    // Most offers won't be accepted, so a team has more out than it could pay (signing checks room).
    let budget =
      room * F.overcommit -
      fa.offers.filter((o) => o.teamId === team.id).reduce((s, o) => s + o.offer.apy, 0);
    let made = 0;
    // Its targets: players it values most above their ask (where its read and needs say "buy").
    const targets = pool
      .filter((p) => roleOn(league, team.id, p) !== "depth")
      .map((p) => {
        const limit = teamLimit(league, team.id, p, needs);
        const ask = demandFor(league, p, team.id, formerTeam(league, p)).apy;
        return { p, limit, ratio: limit / Math.max(1, ask) };
      })
      .sort((a, b) => b.ratio - a.ratio || b.limit - a.limit || a.p.id - b.p.id);
    for (const { p, limit: full } of targets) {
      if (made >= F.offersPerRound || budget <= 0) break;
      const limit = Math.min(full, room);
      const demand = demandFor(league, p, team.id, formerTeam(league, p));
      const mine = fa.offers.find((o) => o.playerId === p.id && o.teamId === team.id);
      const best = fa.offers
        .filter((o) => o.playerId === p.id && o.teamId !== team.id)
        .reduce((m, o) => Math.max(m, o.offer.apy), 0);
      if (!mine) {
        const apy = Math.min(
          limit,
          Math.max(Math.round(demand.apy * F.openingShare), Math.round(best * (1 + F.raiseStep))),
        );
        if (apy < minimumSalary(league.rules.cap, league.season, p.experience)) continue;
        fa.offers.push({
          playerId: p.id,
          teamId: team.id,
          offer: offerAt(league, demand, apy),
          date: league.date,
          reason: `${roleOn(league, team.id, p) === "starter" ? "Would start" : "Would play in the rotation"}${(needs.get(p.position) ?? 0) >= 0.5 ? ` at a position of need (${p.position})` : ""}; up to ${money(limit)} a year.`,
        });
        budget -= apy;
        made += 1;
      } else if (mine.offer.apy < best && mine.offer.apy < limit) {
        // Outbid: raise once a round, up to the limit.
        const apy = Math.min(limit, Math.round(best * (1 + F.raiseStep)));
        budget -= apy - mine.offer.apy;
        mine.offer = offerAt(league, demand, apy);
        mine.date = league.date;
      }
    }
  }
  makeOfferSheets(league);
  // Players decide.
  let signed = 0;
  const top = new Set(pool.filter((p) => marketValue(league, p).rank <= 50).map((p) => p.id));
  for (const p of pool) {
    const offers = fa.offers.filter((o) => o.playerId === p.id);
    if (offers.length === 0) continue;
    const wait = top.has(p.id) ? F.waitDays.top : F.waitDays.rest;
    if (fa.day < wait) continue;
    const home = formerTeam(league, p);
    const rated = offers
      .map((o) => ({ o, u: utility(league, p, o.teamId, o.offer, home) }))
      .sort((a, b) => b.u - a.u || a.o.teamId.localeCompare(b.o.teamId));
    const best = rated[0]!;
    // His own wobble keeps players from all deciding the same way.
    const wobble =
      (uniformFrom(`${league.meta.seed}:fa:${p.id}:${fa.day}`) * 2 - 1) * NEGOTIATION.wobble;
    if (best.u + wobble < holdOut(fa.day)) continue;
    // A team that can no longer afford it, or has no roster spot for him, withdraws.
    if (
      capSheet(league, best.o.teamId, league.season).room -
        fa.offerSheets
          .filter((x) => x.teamId === best.o.teamId)
          .reduce((t, x) => t + x.offer.apy, 0) <
        best.o.offer.apy ||
      !makeRoomFor(league, best.o.teamId, p)
    ) {
      fa.offers = fa.offers.filter((o) => o !== best.o);
      continue;
    }
    const appeal = teamAppeal(league, p, best.o.teamId);
    const others =
      rated.length > 1
        ? ` (${rated.length} offers; ${rated
            .slice(1, 3)
            .map((r) => r.o.teamId)
            .join(", ")} also bid)`
        : "";
    sign(
      league,
      p,
      best.o.teamId,
      best.o.offer,
      "free-agent",
      `The best offer for him${others}: ${money(best.o.offer.apy)} a year${appeal.reasons.length ? `; he ${appeal.reasons.join(", ")}` : ""}. ${best.o.reason}`,
      home,
    );
    fa.offers = fa.offers.filter((o) => o.playerId !== p.id);
    signed += 1;
  }
  return signed;
}

/** Offer sheets past their matching deadline: the old team matches or takes the compensation. */
function resolveOfferSheets(league: League): void {
  const fa = league.freeAgency!;
  for (const sheet of [...fa.offerSheets].filter((s) => s.matchBy <= league.date)) {
    const p = league.players.find((x) => x.id === sheet.playerId)!;
    fa.offerSheets = fa.offerSheets.filter((s) => s !== sheet);
    const limit = teamLimit(league, sheet.priorTeamId, p);
    // The tender's cap hit comes off when the offer replaces it.
    const affordable =
      capSheet(league, sheet.priorTeamId, league.season).room +
        (p.contract ? capHit(p.contract, league.season, league.rules.cap) : 0) >=
      sheet.offer.apy;
    if (limit >= sheet.offer.apy && affordable)
      sign(
        league,
        p,
        sheet.priorTeamId,
        sheet.offer,
        "matched",
        `Matched the ${sheet.teamId} offer sheet within ${league.rules.freeAgency.offerSheet.matchDays} days: worth it to them (up to ${money(limit)} a year).`,
        null,
      );
    else if (capSheet(league, sheet.teamId, league.season).room < sheet.offer.apy) {
      // Shouldn't happen (a team's room counts its pending sheets), but a sheet it can't fit lapses.
      recordTransaction(league, {
        type: "signed",
        teamIds: [sheet.teamId, sheet.priorTeamId],
        playerIds: [p.id],
        text: `${name(p)}'s offer sheet with ${sheet.teamId} lapsed; he stays with ${sheet.priorTeamId} on his tender.`,
        reason: `${sheet.teamId} no longer had cap room for it.`,
      });
    } else {
      // The new club needs a roster spot (it signed a binding offer sheet: someone else goes).
      makeRoomFor(league, sheet.teamId, p);
      const picks = compensationRounds(league, p).map((r, i) =>
        compensationPick(league, sheet.teamId, r, i),
      );
      for (const pick of picks) if (pick) pick.ownerTeamId = sheet.priorTeamId;
      const given = picks.filter((x) => x !== null).map((x) => `${x!.season} round ${x!.round}`);
      sign(
        league,
        p,
        sheet.teamId,
        sheet.offer,
        "free-agent",
        `${sheet.priorTeamId} declined to match the offer sheet (worth up to ${money(limit)} a year to them)${given.length ? ` and receives ${sheet.teamId}'s ${given.join(" and ")} pick${given.length > 1 ? "s" : ""}` : ""}.`,
        sheet.priorTeamId,
      );
    }
  }
}

/** Free agency closes for the draft (offers lapse; offer sheets are settled first). */
export function closeFreeAgency(league: League): void {
  if (league.freeAgency) {
    for (const sheet of league.freeAgency.offerSheets) sheet.matchBy = league.date;
    resolveOfferSheets(league);
  }
  league.freeAgency = null;
}

/**
 * Late free agency, from after the draft to camp: a round every `lateEveryDays` days, players by
 * now holding out for much less (days counted from the League Year). Then minimum deals.
 */
export function lateFreeAgency(league: League, leagueYear: string, camp: string): number {
  let signed = 0;
  league.freeAgency = {
    season: league.season,
    day: daysBetween(leagueYear, league.date),
    offers: [],
    offerSheets: [],
  };
  let date = league.date;
  for (let guard = 0; guard < 20; guard++) {
    const next = addDays(date, FREE_AGENCY.lateEveryDays);
    if (next >= camp) break;
    league.date = next;
    date = next;
    signed += freeAgencyRound(league, FREE_AGENCY.lateEveryDays);
  }
  league.freeAgency = null;
  return signed;
}

// --- Extensions -----------------------------------------------------------------------------

/**
 * In-season extensions: each regular-season week, a team may extend a player in his deal's last
 * year who'd start for it (drafted rookies only after their third season), through the same talks.
 */
export function weeklyExtensions(league: League, week: number): number {
  const F = FREE_AGENCY;
  let n = 0;
  for (const team of [...league.teams].sort((a, b) => a.id.localeCompare(b.id))) {
    // A person-run team extends players himself, unless his staff do (Phase 14).
    if (!staffDecides(league, team.id, "extensions")) continue;
    // Most weeks a team doesn't extend anyone: decide that first (cheap), then look.
    if (
      uniformFrom(`${league.meta.seed}:extend:${team.id}:${league.season}:${week}`) >=
      F.extensionChance
    )
      continue;
    const candidates = league.players
      .filter(
        (p) =>
          p.teamId === team.id &&
          p.contract &&
          p.rights === null &&
          p.roster !== "practice-squad" &&
          (p.contract.type === "veteran" ||
            p.contract.type === "extension" ||
            p.contract.type === "rookie") &&
          // The deal's last year, or (for a patient or loyal GM's young starters) a year early.
          (span(p.contract).lastReal === league.season ||
            (span(p.contract).lastReal === league.season + 1 &&
              wantsEarlyExtension(league, team.id, p))),
      )
      .filter(
        (p) =>
          p.contract!.type !== "rookie" ||
          p.experience >= league.rules.freeAgency.rookieExtensionAfterSeasons,
      )
      .filter((p) => roleOn(league, team.id, p) === "starter")
      .sort((a, b) => marketValue(league, b).apy - marketValue(league, a).apy || a.id - b.id);
    for (const p of candidates.slice(0, FREE_AGENCY.extensionsPerRoll)) {
      const done = tryExtension(
        league,
        team.id,
        p,
        teamLimit(league, team.id, p),
        "Extended before his deal's last season ran out: a starter they want to keep.",
      );
      if (done.extended) n += 1;
    }
  }
  return n;
}

/**
 * Talks on an extension up to `limit` a year; signs it if they agree and it fits under the cap
 * this year and next (tried on a scratch copy first: the new bonus counts on this year's cap).
 */
export function tryExtension(
  league: League,
  teamId: string,
  p: Player,
  limit: Dollars,
  why: string,
): { extended: boolean; reason: string } {
  const talks = negotiateOwn(league, teamId, p, limit);
  if (!talks.offer) return { extended: false, reason: talks.reason };
  const o = talks.offer;
  const contract = contractFromOffer(league, p, teamId, o, "extension", league.season + 1);
  const years = contract.years.map(({ season: _s, ...rest }) => rest);
  const copy = scratch(league);
  extendContract(copy, p.id, years, o.signingBonus, "preview");
  if (
    capSheet(copy, teamId, league.season).room < 0 ||
    capSheet(copy, teamId, league.season + 1).room < 0
  )
    return {
      extended: false,
      reason: "They agreed on terms, but the deal doesn't fit under the cap.",
    };
  extendContract(league, p.id, years, o.signingBonus, `${why} ${talks.reason}`);
  return { extended: true, reason: talks.reason };
}

/** The last day of the signing period for offer sheets this League Year. */
export function offerSheetDeadline(league: League): string {
  const draft = seasonDates(league.rules, league.season).draft;
  return addDays(draft, -league.rules.freeAgency.offerSheet.signingPeriodEndsDaysBeforeDraft);
}

/** Tendered players other clubs may offer sheets to (not exclusive-rights or exclusive tags). */
function openToOfferSheets(league: League): Player[] {
  return league.players.filter(
    (p) =>
      p.rights !== null &&
      p.rights.season === league.season &&
      p.rights.kind !== "erfa" &&
      p.rights.kind !== "franchise-exclusive" &&
      !league.freeAgency?.offerSheets.some((s) => s.playerId === p.id),
  );
}

/** The picks a club gives up if an offer sheet isn't matched (by the tender level). */
function compensationRounds(league: League, p: Player): number[] {
  const kind = p.rights!.kind;
  const c = league.rules.freeAgency.offerSheet.compensation;
  const rule =
    kind === "rfa-first"
      ? c.firstRound
      : kind === "rfa-second"
        ? c.secondRound
        : kind === "rfa-original"
          ? c.originalRound
          : kind === "rfa-rofr"
            ? c.rightOfFirstRefusal
            : null;
  if (kind === "franchise") return league.rules.freeAgency.tags.nonExclusiveFranchiseCompensation;
  if (kind === "transition" || rule === null || rule === "none") return [];
  if (rule === "original-round") return [p.drafted?.round ?? league.rules.draft.rounds];
  return [rule === "round-1" ? 1 : 2];
}

/**
 * Offer sheets: a club that would start a tendered player and values him far above his tender
 * signs him to one if it can afford the compensation picks; his old club has five days to match.
 */
function makeOfferSheets(league: League): void {
  const fa = league.freeAgency!;
  if (league.date > offerSheetDeadline(league)) return;
  const thisYear = league.transactions.filter(
    (t) =>
      t.type === "signed" &&
      t.text.includes("signed an offer sheet with") &&
      t.date.startsWith(`${league.season}-`),
  );
  for (const p of openToOfferSheets(league)) {
    if (thisYear.length + fa.offerSheets.length >= FREE_AGENCY.offerSheetsPerYear) return;
    const holder = p.rights!.teamId;
    const tender = p.contract ? totalValue(p.contract) : 0;
    const rounds = compensationRounds(league, p);
    for (const team of [...league.teams].sort((a, b) => a.id.localeCompare(b.id))) {
      if (team.id === holder || roleOn(league, team.id, p) !== "starter") continue;
      if (!staffDecides(league, team.id, "free-agency")) continue;
      // One offer sheet a year per team, and only with room for it (it's a binding contract).
      if (
        fa.offerSheets.some((x) => x.teamId === team.id) ||
        thisYear.some((t) => t.text.includes(`offer sheet with ${team.id}:`))
      )
        continue;
      const pending = fa.offers
        .filter((o) => o.teamId === team.id)
        .reduce((x, o) => x + o.offer.apy, 0);
      const limit = Math.min(teamLimit(league, team.id, p), teamBudget(league, team.id) - pending);
      if (limit < tender * FREE_AGENCY.offerSheetValue) continue;
      // It must hold the picks it would give up.
      if (!rounds.every((r, i) => compensationPick(league, team.id, r, i) !== null)) continue;
      const demand = demandFor(league, p, team.id);
      const offer = offerAt(league, demand, Math.min(limit, demand.apy));
      if (answerOffer(league, p, team.id, offer, 1, null).decision !== "accept") continue;
      fa.offerSheets.push({
        playerId: p.id,
        teamId: team.id,
        priorTeamId: holder,
        offer,
        date: league.date,
        matchBy: addDays(league.date, league.rules.freeAgency.offerSheet.matchDays),
      });
      recordTransaction(league, {
        type: "signed",
        teamIds: [team.id, holder],
        playerIds: [p.id],
        text: `${name(p)} (${p.position}) signed an offer sheet with ${team.id}: ${offer.years} years, ${money(offer.apy)} a year. ${holder} has ${league.rules.freeAgency.offerSheet.matchDays} days to match.`,
        reason: `${team.id} would start him and values him well above his tender${rounds.length ? `, worth the ${rounds.map((r) => `round-${r}`).join(" and ")} pick${rounds.length > 1 ? "s" : ""} it would give up` : ""}.`,
      });
      break;
    }
  }
}

/** The pick a club would hand over for round `round` (the `nth` such pick: this draft's first, then next year's). */
function compensationPick(league: League, teamId: string, round: number, nth: number) {
  const late = league.date > addDays(seasonDates(league.rules, league.season).draft, -2);
  const seasons = late
    ? [league.season + 1, league.season + 2]
    : [league.season, league.season + 1];
  const own = league.draftPicks
    .filter(
      (d) =>
        d.ownerTeamId === teamId &&
        d.round === round &&
        d.selection === null &&
        d.compensatory === null &&
        seasons.includes(d.season),
    )
    .sort((a, b) => a.season - b.season || (a.overall ?? 0) - (b.overall ?? 0));
  return own[nth] ?? null;
}
