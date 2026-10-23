/**
 * What things are worth in a trade (Phase 13), in one currency: draft career value (weighted
 * approximate value, the units of `calibration/draft.json` pickValue).
 *
 * A player is worth the value he adds over the years his new team controls him (his contract),
 * as that team's staff projects him (its own read, the age curve), plus a little for the right
 * to re-sign him, plus his contract's surplus (market value above his cap cost, turned into the
 * same units at the price the market pays for value). A pick is worth its career value at the
 * slot it's likely to land in. Both are moved by the team's GM and stance: win-now GMs discount
 * the future; contenders pay for this season, rebuilders for later; analytics GMs value positions
 * differently; needs and roles matter; injured players count only once they're back.
 *
 * Mistakes are realistic and unfarmable: each team values players through its own scouts, its
 * GM's biases, and a gut feeling fixed per team, player and season (a hash), so asking again
 * never re-rolls it. A neutral judge (true ratings, no biases) checks the AI in tests.
 */
import { ageOn, overallAt } from "@fgm/foundation";
import type { DraftPick, League, Player } from "../league/schema";
import { STARTERS } from "../generate/config";
import { careerValue } from "../draft/values";
import { teamNeeds } from "../draft/boards";
import { salaryCap } from "../contracts/cap";
import { capHit, span } from "../contracts/contract";
import { marketValue } from "../contracts/market";
import { DEVELOPMENT } from "../lifecycle/config";
import { ageCurve, peakAge } from "../lifecycle/curves";
import { readOverall, readPlayer, readsKey } from "../perception";
import { normalFrom, uniformFrom } from "../scouting/noise";
import { seasonDates } from "../season/calendar";
import { stanceOf } from "./evaluate";
import { gmStyle } from "./executives";
import { STRATEGY } from "./strategy";

export const TRADE_VALUE = {
  /** A season's value by overall: (overall - floor) x slope, never below zero (AV-like units). */
  floor: 62,
  slope: 0.55,
  /** Quarterbacks pile up more value a season; specialists less. */
  positionWeight: { QB: 1.3, K: 0.4, P: 0.4, LS: 0.3 } as Partial<Record<string, number>>,
  /** Each later season counts this much (less for a win-now GM, more for a patient one). */
  yearDiscount: 0.85,
  gmDiscount: 0.1,
  /** The right to re-sign him: this share of the two seasons after his deal. */
  rightsShare: 0.25,
  /** Contract surplus: dollars per unit of value, as a share of the cap (an average starter's ~7
   * a season costs about 3% of the cap). */
  dollarsPerValueShareOfCap: 0.0045,
  /** Contenders weigh this season up, rebuilders down. */
  contendNow: 0.15,
  rebuildNow: -0.3,
  rebuildLater: 0.1,
  /** A starter at a position the team needs is worth up to this much more. */
  needBonus: 0.25,
  /** A player who wouldn't start for them is worth this share of a season this year. */
  benchShare: 0.5,
  /** Giving away his own players: a loyal GM wants this much more per loyalty point. */
  loyalty: 0.1,
  /** Picks: rebuilders value them more, contenders less. */
  pickRebuild: 0.15,
  pickContend: -0.1,
  /** Future picks: each year ahead is worth this much (less for win-now, more for patient GMs). */
  futurePick: 0.8,
  futurePickGm: 0.15,
  /** Gut feel: an everyday spread around the read, and a rare big swing (fixed per season). */
  gutSpread: 0.06,
  gutSwingChance: 0.04,
  gutSwing: 0.25,
  /** A team shopping a player who wants out (Phase 12b) takes less for him. */
  disputeDiscount: 0.75,
  /** A severe injury: later seasons count this much less (he may not be the same). Judgment. */
  severeInjury: 0.15,
} as const;

/** One season's value at an overall. */
export function seasonValue(position: string, overall: number): number {
  const T = TRADE_VALUE;
  return Math.max(0, overall - T.floor) * T.slope * (T.positionWeight[position] ?? 1);
}

const TEAM_READS = new WeakMap<
  League,
  { key: string; teams: Map<string, Map<string, { p: Player; overall: number }[]>> }
>();

/**
 * A team's players at a position as its staff reads them, best first (cached until the date,
 * a development round or any roster move changes them).
 */
export function teamReadsAt(
  league: League,
  teamId: string,
  position: string,
): { p: Player; overall: number }[] {
  const key = `${readsKey(league)}:${league.transactions.length}`;
  let cache = TEAM_READS.get(league);
  if (!cache || cache.key !== key) {
    cache = { key, teams: new Map() };
    TEAM_READS.set(league, cache);
  }
  let byPos = cache.teams.get(teamId);
  if (!byPos) {
    byPos = new Map();
    const viewer = { kind: "team" as const, teamId };
    for (const x of league.players) {
      if (x.teamId !== teamId || x.retiredAfter !== null) continue;
      const list = byPos.get(x.position) ?? [];
      list.push({ p: x, overall: readOverall(league, x, viewer) });
      byPos.set(x.position, list);
    }
    for (const list of byPos.values())
      list.sort((a, b) => b.overall - a.overall || a.p.id - b.p.id);
    cache.teams.set(teamId, byPos);
  }
  return byPos.get(position) ?? [];
}

/** Who's judging: a team (its own read and biases), or a neutral judge (truth, no biases). */
export type Judge = { teamId: string } | { neutral: true };
const isNeutral = (j: Judge): j is { neutral: true } => "neutral" in j;

/** Share of this season still to play (1 before the regular season). */
function seasonLeft(league: League): number {
  const stage = league.calendar.stage;
  if (stage !== "regular") return stage === "complete" ? 0 : 1;
  const weeks = league.rules.schedule.regularSeasonWeeks;
  return Math.max(0, (weeks - (league.calendar.week - 1)) / weeks);
}

/** His overall now and his potential, as the judge sees them. */
function read(league: League, p: Player, judge: Judge): { overall: number; potential: number } {
  if (isNeutral(judge))
    return { overall: overallAt(p.ratings, p.position), potential: p.hidden.potential };
  return readPlayer(league, p, { kind: "team", teamId: judge.teamId });
}

/** The judge's gut about a player this season: fixed, so asking again never changes it. */
function gut(league: League, p: Player, teamId: string): number {
  const T = TRADE_VALUE;
  const key = `${league.meta.seed}:gut:${teamId}:${p.id}:${league.season}`;
  let g = normalFrom(key) * T.gutSpread;
  if (uniformFrom(`${key}:swing`) < T.gutSwingChance)
    g += (uniformFrom(`${key}:dir`) < 0.5 ? -1 : 1) * T.gutSwing;
  return g;
}

export interface ItemValue {
  value: number;
  /** Why, in a few words (for the answer's reasons). */
  why: string;
}

/**
 * What a player is worth to a team receiving him (`receiving`) or giving him up (`!receiving`),
 * in the judge's eyes. The team giving him up values him as its own player (loyalty included).
 */
export function playerTradeValue(
  league: League,
  p: Player,
  judge: Judge,
  receiving: boolean,
): ItemValue {
  const T = TRADE_VALUE;
  const neutral = isNeutral(judge);
  const teamId = neutral ? null : judge.teamId;
  const gm = teamId ? gmStyle(league, teamId) : null;
  const stance = teamId ? stanceOf(league, teamId) : "retool";
  const { overall, potential } = read(league, p, judge);
  const age = ageOn(p.birthDate, league.date);
  const contractEnd = p.contract ? span(p.contract).lastReal : league.season;
  const control = Math.max(1, contractEnd - league.season + 1);
  const discount = T.yearDiscount - (gm ? T.gmDiscount * gm.futureDiscount : 0);
  const left = seasonLeft(league);
  // Out injured: each season counts only for the games after he's back (a long injury runs into
  // next season), and a severe one may leave him a step slower.
  const seasonGames = league.rules.schedule.regularSeasonWeeks - 1;
  const gamesLeft = Math.max(1, Math.round(left * league.rules.schedule.regularSeasonWeeks));
  const missed = (y: number): number => {
    if (!p.injury) return 0;
    const out = p.injury.gamesRemaining - (y === 0 ? 0 : gamesLeft + (y - 1) * seasonGames);
    return Math.max(0, Math.min(1, out / (y === 0 ? gamesLeft : seasonGames)));
  };
  const injured = missed(0);
  const severe = p.injury?.severity === "severe" ? 1 - T.severeInjury : 1;

  // Would he start for this team? (Its read of its own players at his position.)
  let starts = true;
  if (teamId) {
    const better = teamReadsAt(league, teamId, p.position).filter(
      (x) => x.p.id !== p.id && x.overall > overall,
    ).length;
    starts = better < (STARTERS[p.position] ?? 1);
  }
  const need = teamId && receiving ? (teamNeeds(league, teamId).get(p.position) ?? 0) : 0;

  let total = 0;
  let ovr = overall;
  const years = control + 2;
  for (let y = 0; y < years; y++) {
    const a = age + y;
    if (y > 0) {
      if (a - 1 < peakAge(p.position)) ovr += Math.max(0, potential - ovr) * 0.3;
      else ovr += ageCurve(p.position, a - 1) * DEVELOPMENT.declinePointsPerSd;
    }
    let v = seasonValue(p.position, ovr);
    if (y === 0) {
      v *= left * (1 - injured);
      if (!starts) v *= T.benchShare;
      if (stance === "contend") v *= 1 + T.contendNow;
      if (stance === "rebuild") v *= 1 + T.rebuildNow;
      if (starts) v *= 1 + T.needBonus * need;
    } else {
      v *= (1 - missed(y)) * severe;
      if (stance === "rebuild") v *= 1 + T.rebuildLater;
    }
    // Beyond his deal, only the right to re-sign him.
    if (y >= control) v *= T.rightsShare;
    let d = 1;
    for (let i = 0; i < y; i++) d *= discount;
    total += v * d;
  }

  // His contract: market value above what he costs is extra value (below it, a burden).
  let surplus = 0;
  if (p.contract) {
    const cap = salaryCap(league.rules.cap, league.season);
    const perValue = cap * T.dollarsPerValueShareOfCap;
    const market = marketValue(league, p).apy;
    for (let s = league.season; s <= contractEnd; s++) {
      const share = s === league.season ? left : 1;
      surplus += ((market - capHit(p.contract, s, league.rules.cap)) * share) / perValue;
    }
  }
  let value = total + surplus;
  // Analytics GMs value positions by what they're worth on the field.
  if (gm) value *= 1 + gm.analytics * (STRATEGY.positionValue[p.position] ?? 0) * 2;
  if (gm && !receiving && p.teamId === teamId) value *= 1 + T.loyalty * Math.max(0, gm.loyalty);
  // A player in a dispute with his team (a holdout or trade request) is worth less to it.
  if (
    !receiving &&
    teamId &&
    league.disputes.some((d) => d.end === null && d.playerId === p.id && d.teamId === teamId)
  )
    value *= T.disputeDiscount;
  if (teamId) value *= 1 + gut(league, p, teamId);

  const bits = [
    `${p.position}, ${age}, rated ${Math.round(overall)}`,
    `${control} season${control === 1 ? "" : "s"} of control`,
  ];
  if (injured > 0) bits.push(missed(1) > 0 ? "injured into next season" : "injured");
  if (!starts) bits.push("wouldn't start");
  else if (need >= 0.5) bits.push("fills a need");
  if (surplus < -3) bits.push("an expensive deal");
  else if (surplus > 5) bits.push("a bargain contract");
  return { value: Math.round(value * 10) / 10, why: bits.join("; ") };
}

/** The slot a pick is likely to land in: known, or projected from the original team's strength. */
export function projectedSlot(league: League, pick: DraftPick): number {
  if (pick.overall !== null && pick.season === league.season) return pick.overall;
  const teams = league.teams.length;
  const ranked = [...league.teams]
    .map((t) => ({ id: t.id, s: t.plan?.strength ?? 75 }))
    .sort((a, b) => a.s - b.s || a.id.localeCompare(b.id));
  const place = ranked.findIndex((t) => t.id === pick.originalTeamId);
  // A team's strength now says less about drafts further away: blend toward the middle.
  const years = Math.max(0, pick.season - league.season);
  const weight = years <= 1 ? 0.6 : 0.3;
  const slot = (place < 0 ? teams / 2 : place + 1) * weight + (teams / 2) * (1 - weight);
  return (pick.round - 1) * teams + Math.round(slot);
}

/** What a pick is worth to a team (or the neutral judge). */
export function pickTradeValue(league: League, pick: DraftPick, judge: Judge): ItemValue {
  const T = TRADE_VALUE;
  const slot = projectedSlot(league, pick);
  let value = careerValue(Math.max(1, slot));
  const draftDone =
    pick.season === league.season && league.date > seasonDates(league.rules, league.season).draft;
  const yearsAhead = Math.max(0, pick.season - league.season - (draftDone ? 1 : 0));
  const future = isNeutral(judge)
    ? T.futurePick
    : T.futurePick - T.futurePickGm * gmStyle(league, judge.teamId).futureDiscount;
  for (let i = 0; i < yearsAhead; i++) value *= future;
  if (!isNeutral(judge)) {
    const w = stanceOf(league, judge.teamId);
    if (w === "rebuild") value *= 1 + T.pickRebuild;
    if (w === "contend") value *= 1 + T.pickContend;
  }
  const label = `${pick.season} round ${pick.round}${pick.overall !== null && pick.season === league.season ? ` (#${pick.overall})` : ` (likely #${slot})`}`;
  return { value: Math.round(value * 10) / 10, why: label };
}

/** A roster spot a team has to clear: the weakest player it would cut, by its own value. */
export function rosterSpotCost(league: League, teamId: string, spots: number): number {
  if (spots <= 0) return 0;
  const viewer = { kind: "team" as const, teamId };
  const weakest = league.players
    .filter((p) => p.teamId === teamId && p.roster === "active")
    .map((p) => seasonValue(p.position, readOverall(league, p, viewer)))
    .sort((a, b) => a - b);
  return weakest.slice(0, spots).reduce((s, v) => s + v * 0.5, 0) + spots * 0.3;
}
