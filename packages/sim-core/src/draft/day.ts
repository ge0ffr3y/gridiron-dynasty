/**
 * Draft day (Phase 11b). The draft runs pick by pick so the draft room can
 * stop anywhere: `simPicks` makes AI picks (with trades) until told to stop,
 * `makePick` lets the league office choose for the team on the clock, and
 * `finishDraft` makes the rest, runs the undrafted rush and closes the class.
 *
 * Before each AI pick, teams further down may trade up for a prospect they
 * rate far above what they expect at their own pick and who is likely gone
 * first; the team on the clock trades down if it loses little on its board.
 * Prices follow real draft-day trades: the team moving up pays about 1.42
 * times the picks' career value (calibration/draft.json `trades`).
 */
import { personTeam, staffDecides } from "../career/delegation";
import { rookieContract } from "../contracts/generate";
import { minimumSalary } from "../contracts/cap";
import { recordTransaction } from "../contracts/operations";
import { getUnderCap } from "../contracts/upkeep";
import type { Contract, DraftPick, League, Player, Prospect } from "../league/schema";
import { DRAFT_CLASS } from "../roster/config";
import { onTeam, openSpots } from "../roster/lists";
import { playerValue, waivePlayer } from "../roster/moves";
import { assignJerseys } from "../roster/jerseys";
import { makeTrade, pickLabel, tradablePicks } from "../roster/trades";
import { draftClass, prospectToPlayer } from "../scouting/classes";
import { uniformFrom } from "../scouting/noise";
import { runProDays } from "../scouting/study";
import { bigBoard, consensusRanks } from "./boards";
import { DRAFT_DAY } from "./config";
import { careerValue, pickWorth } from "./values";

const ordinal = (n: number) =>
  `${n}${n % 100 >= 11 && n % 100 <= 13 ? "th" : (["th", "st", "nd", "rd"][n % 10] ?? "th")}`;

/** This year's picks in order (overall pick number). */
export function draftOrder(league: League, season = league.season): DraftPick[] {
  return league.draftPicks
    .filter((p) => p.season === season && p.overall !== null)
    .sort((a, b) => a.overall! - b.overall!);
}

/** The pick on the clock, or null when the draft isn't under way (or is over). */
export function onTheClock(league: League): DraftPick | null {
  if (league.calendar.stage !== "draft") return null;
  return draftOrder(league).find((p) => p.selection === null) ?? null;
}

/** Draft day begins: everyone not measured yet has had his pro day. */
export function startDraft(league: League): void {
  runProDays(league, league.date);
}

function teamName(league: League, id: string): string {
  const t = league.teams.find((x) => x.id === id);
  return t ? `${t.city} ${t.nickname}` : id;
}

function name(p: { firstName: string; lastName: string }): string {
  return `${p.firstName} ${p.lastName}`;
}

/** Drafted this year by a team: it makes room on its roster first (never cutting this year's picks). */
function makeRoom(league: League, teamId: string): void {
  if (openSpots(league, teamId) > 0) return;
  const weakest = onTeam(league, teamId)
    .filter((x) => x.roster === "active" && x.drafted?.season !== league.season)
    .sort((a, b) => playerValue(league, a) - playerValue(league, b) || b.id - a.id)[0];
  if (weakest)
    waivePlayer(
      league,
      weakest.id,
      `Waived to make room for a draft pick (${weakest.position}, the least valuable player on the roster).`,
    );
}

/**
 * Uses the pick on the clock for `prospectId` (the league office's choice) or, if none is given,
 * the top of the owner's board. Returns the new player.
 */
export function makePick(league: League, prospectId?: number, reason?: string): Player {
  const pick = onTheClock(league);
  if (!pick) throw new Error("No pick is on the clock: the draft isn't under way.");
  const teamId = pick.ownerTeamId;
  const available = draftClass(league, league.season);
  let prospect: Prospect | undefined;
  let why = reason;
  if (prospectId !== undefined) {
    prospect = available.find((p) => p.id === prospectId);
    if (!prospect) throw new Error("That prospect isn't available.");
    why ??= "Chosen by the league office.";
  } else {
    const top = bigBoard(league, teamId, available)[0];
    if (!top) throw new Error("No prospects are left.");
    prospect = top.prospect;
    why ??= `Top of their board: ${top.reason.toLowerCase()}.`;
  }
  makeRoom(league, teamId);
  const player = prospectToPlayer(prospect);
  league.players.push(player);
  league.prospects = league.prospects.filter((p) => p.id !== prospect!.id);
  player.drafted = { season: league.season, round: pick.round, pick: pick.overall!, teamId };
  player.teamId = teamId;
  player.contract = rookieContract(league, player, teamId, league.season, pick.overall!);
  pick.selection = player.id;
  assignJerseys(league, [teamId]);
  recordTransaction(league, {
    type: "drafted",
    teamIds: [teamId],
    playerIds: [player.id],
    text: `${teamId} drafted ${name(player)} (${player.position}), ${ordinal(pick.round)} round, ${ordinal(pick.overall!)} overall${pick.compensatory ? " (compensatory)" : ""}, and signed him to a rookie-scale deal.`,
    reason: why,
  });
  return player;
}

/** A team's unused picks this year after `overall`, and its future picks: what it can offer. */
function offerablePicks(league: League, teamId: string, after: number): DraftPick[] {
  return tradablePicks(league, teamId).filter(
    (p) =>
      p.selection === null &&
      (p.season > league.season || (p.overall !== null && p.overall > after)),
  );
}

/** How many trades this draft has had so far. */
function tradesSoFar(league: League): number {
  return league.transactions.filter(
    (t) => t.type === "traded" && t.date === league.date && t.text.includes(" round"),
  ).length;
}

export interface TradeOffer {
  /** The team moving up, and the prospect it wants. */
  teamId: string;
  target: { id: number; name: string; position: string; reason: string };
  /** Picks it offers (ids and labels), their career value over the pick's, and why. */
  picks: { id: number; label: string; worth: number }[];
  priceRatio: number;
  /** Board points it gains beyond what the team on the clock loses (the AI trades above its bar). */
  surplus: number;
  /** Whether the AI on the clock would take it. */
  aiAccepts: boolean;
  reason: string;
}

/**
 * Offers for the pick on the clock from teams further down: each wants the top of its board,
 * likely gone before its own pick, and gains more by moving up than the team on the clock loses
 * by moving down. Listed from half the AI's bar (the league office may take any), best first.
 */
export function tradeOffers(league: League): TradeOffer[] {
  const pick = onTheClock(league);
  if (!pick) return [];
  const T = DRAFT_DAY.tradeUp;
  const available = draftClass(league, league.season);
  if (available.length < 2) return [];
  const consensus = consensusRanks(league, available);
  const here = pick.overall!;
  const owner = pick.ownerTeamId;
  const ownerBoard = bigBoard(league, owner, available);
  // Boards are flatter late in the draft (talent thins out), so the bar falls with the picks' worth.
  const threshold =
    T.surplus *
    Math.max(T.minScale, Math.sqrt(careerValue(here) / careerValue(league.teams.length / 2)));
  // The price: about 1.42 times the pick's career value, varying deal by deal.
  const u = uniformFrom(`${league.meta.seed}:draft-trade:${pick.id}`) * 2 - 1;
  const price = careerValue(here) * (T.price + u * T.priceSpread);
  const offers: TradeOffer[] = [];
  for (const team of [...league.teams].sort((a, b) => a.id.localeCompare(b.id))) {
    if (team.id === owner) continue;
    const mine = offerablePicks(league, team.id, here);
    const next = mine.find((p) => p.season === league.season && p.overall! - here <= T.lookahead);
    if (!next) continue;
    const between = next.overall! - here;
    const board = bigBoard(league, team.id, available);
    const target = board[0]!;
    // He's likely gone before its own pick...
    if (consensus.get(target.prospect.id)! > between + T.goneMargin) continue;
    // ...and it gains more by moving up than the team on the clock loses by moving down.
    const gain = target.value - board[Math.min(board.length - 1, between)]!.value;
    const loss = ownerBoard[0]!.value - ownerBoard[Math.min(ownerBoard.length - 1, between)]!.value;
    const surplus = gain - loss;
    if (surplus < threshold * T.offerShare) continue;
    // It pays with the cheapest set of its picks (its next one plus up to a few more) that covers it.
    const rest = mine.filter((p) => p.id !== next.id).slice(0, 12);
    const base = pickWorth(league, next);
    let best: DraftPick[] | null = base >= price ? [next] : null;
    let total = best ? base : Infinity;
    const consider = (extra: DraftPick[]) => {
      const sum = base + extra.reduce((x, p) => x + pickWorth(league, p), 0);
      if (sum >= price && sum < total) {
        total = sum;
        best = [next, ...extra];
      }
    };
    for (let i = 0; i < rest.length; i++) {
      consider([rest[i]!]);
      if (T.maxExtraPicks < 2) continue;
      for (let j = i + 1; j < rest.length; j++) {
        consider([rest[i]!, rest[j]!]);
        if (T.maxExtraPicks < 3) continue;
        for (let k = j + 1; k < rest.length; k++) consider([rest[i]!, rest[j]!, rest[k]!]);
      }
    }
    const picks: DraftPick[] | null = best;
    if (!picks || total > price * T.maxOverpay) continue;
    const ratio = total / careerValue(here);
    offers.push({
      teamId: team.id,
      target: {
        id: target.prospect.id,
        name: name(target.prospect),
        position: target.prospect.position,
        reason: target.reason,
      },
      picks: picks.map((p) => ({
        id: p.id,
        label: pickLabel(league, p),
        worth: pickWorth(league, p),
      })),
      priceRatio: ratio,
      surplus,
      aiAccepts: surplus >= threshold,
      reason: `${team.id} moved up to #${here} for ${name(target.prospect)} (${target.prospect.position}), the top of its board and likely gone before its pick at #${next.overall}; ${owner} traded down, expecting a player nearly as good there, for picks worth ${ratio.toFixed(2)} times the pick's career value.`,
    });
  }
  return offers.sort((a, b) => b.surplus - a.surplus || a.teamId.localeCompare(b.teamId));
}

/** Makes a trade offer for the pick on the clock (the AI's choice, or the league office's). */
export function acceptOffer(league: League, offer: TradeOffer, reason = offer.reason): void {
  const pick = onTheClock(league);
  if (!pick) throw new Error("No pick is on the clock.");
  makeTrade(
    league,
    { teamId: pick.ownerTeamId, players: [], picks: [pick.id] },
    { teamId: offer.teamId, players: [], picks: offer.picks.map((p) => p.id) },
    reason,
  );
}

/**
 * Before an AI pick: does a team further down move up for a prospect it loves? Returns the reason
 * for the pick if one did (the pick now belongs to the team that moved up).
 */
function tradeUp(league: League): string | null {
  if (tradesSoFar(league) >= DRAFT_DAY.maxTradesPerDraft) return null;
  // A person who keeps trades makes his own draft-day deals (Phase 14): his staff never trade his
  // pick, and his team never moves up on its own.
  const pick = onTheClock(league);
  if (pick && !staffDecides(league, pick.ownerTeamId, "trades")) return null;
  const offer = tradeOffers(league).find(
    (o) => o.aiAccepts && staffDecides(league, o.teamId, "trades"),
  );
  if (!offer) return null;
  try {
    acceptOffer(league, offer);
  } catch {
    return null; // a rule got in the way (it shouldn't for picks): no trade
  }
  return `Moved up to take him: ${offer.target.reason.toLowerCase()}, and likely gone before their own pick.`;
}

/** The AI makes the pick on the clock (after any trade). Returns the new player. */
export function aiPick(league: League): Player {
  const pick = onTheClock(league);
  if (!pick) throw new Error("No pick is on the clock.");
  const traded = tradeUp(league);
  return makePick(league, undefined, traded ?? undefined);
}

/** AI picks until `stop` says so (checked before each pick) or the draft's picks are all made. */
export function simPicks(league: League, stop: (pick: DraftPick) => boolean = () => false): number {
  let n = 0;
  for (let pick = onTheClock(league); pick && !stop(pick); pick = onTheClock(league)) {
    aiPick(league);
    n += 1;
  }
  return n;
}

function undraftedDeal(league: League, teamId: string): Contract {
  const cap = league.rules.cap;
  const years = Array.from({ length: DRAFT_CLASS.undraftedYears }, (_, i) => ({
    season: league.season + i,
    base: minimumSalary(cap, league.season + i, i),
    guaranteed: 0,
    injuryGuaranteed: 0,
    vestsOn: null,
    rosterBonus: 0,
    workoutBonus: 0,
    perGameBonus: 0,
    incentives: [],
    void: false,
  }));
  return {
    teamId,
    type: "rookie",
    signedOn: league.date,
    years,
    bonuses: [],
    fifthYearOption: null,
    veteranSalaryBenefit: false,
  };
}

/**
 * The rest of the draft, then the undrafted rush (teams fill open spots from their boards, one
 * at a time in draft order), and everyone left becomes a free agent. Returns the counts.
 */
export function finishDraft(league: League): { drafted: number; undrafted: number } {
  simPicks(league);
  const drafted = draftOrder(league).filter((p) => p.selection !== null).length;
  const available = new Map(draftClass(league, league.season).map((p) => [p.id, p]));
  // Each team's board, once: its scouts' order of everyone left.
  const order = draftOrder(league)
    .filter((p) => p.round === 1 && p.compensatory === null)
    .map((p) => p.originalTeamId);
  const boards = new Map(
    order.map((id) => [
      id,
      bigBoard(league, id, [...available.values()]).map((e) => e.prospect.id),
    ]),
  );
  let undrafted = 0;
  for (let round = 0; round < 60 && available.size > 0; round++) {
    let signed = false;
    for (const teamId of order) {
      if (openSpots(league, teamId) <= 0) continue;
      const id = boards.get(teamId)!.find((x) => available.has(x));
      if (id === undefined) break;
      const prospect = available.get(id)!;
      available.delete(id);
      const player = prospectToPlayer(prospect);
      league.players.push(player);
      player.teamId = teamId;
      player.contract = undraftedDeal(league, teamId);
      assignJerseys(league, [teamId]);
      undrafted += 1;
      signed = true;
      recordTransaction(league, {
        type: "signed",
        teamIds: [teamId],
        playerIds: [player.id],
        text: `${teamId} signed undrafted free agent ${name(player)} (${player.position}).`,
        reason:
          "Undrafted free-agent rush after the draft: an open camp spot, the best prospect left on this team's board.",
      });
    }
    if (!signed) break;
  }
  // Everyone left is a free agent; the class is done (scouts turn to next year's).
  for (const p of available.values()) league.players.push(prospectToPlayer(p));
  league.prospects = league.prospects.filter((p) => p.draftYear !== league.season);
  // Players stay in id order (the league file and history rely on a stable order).
  league.players.sort((a, b) => a.id - b.id);
  // First-round deals can push a tight team over the cap: it restructures or releases, with reasons.
  for (const team of league.teams) getUnderCap(league, team.id);
  return { drafted, undrafted };
}

export { teamName as draftTeamName };

export type DraftAction =
  | { kind: "pick"; prospectId?: number }
  | { kind: "sim"; until: "next" | "team" | "round" | "all"; teamId?: string }
  | { kind: "accept-offer"; teamId: string };

/**
 * A draft-room action (the league office's, until GM Mode): make the pick on the clock (a chosen
 * prospect, or the team's top), let the AI pick to the next pick, to a team's pick, to the end of
 * the round or through the last pick, or accept a trade offer for the pick on the clock.
 */
export function draftAction(league: League, action: DraftAction): string {
  const pick = onTheClock(league);
  if (!pick) throw new Error("No pick is on the clock: the draft isn't under way.");
  // GM Mode: you pick only for your team, and the sim buttons stop at your picks.
  const you = personTeam(league);
  const yours = (p: DraftPick) =>
    you !== null && p.ownerTeamId === you && !staffDecides(league, you, "draft");
  if (you && action.kind !== "sim" && pick.ownerTeamId !== you)
    throw new Error(`It's ${pick.ownerTeamId}'s pick, not yours.`);
  if (action.kind === "sim" && yours(pick))
    throw new Error("You're on the clock: make your pick (or hand the draft to your scouts).");
  if (action.kind === "pick") {
    const p = makePick(league, action.prospectId);
    return `${p.drafted!.teamId} took ${name(p)} (${p.position}) at #${p.drafted!.pick}.`;
  }
  if (action.kind === "accept-offer") {
    const offer = tradeOffers(league).find((o) => o.teamId === action.teamId);
    if (!offer) throw new Error(`${action.teamId} has no offer for this pick.`);
    const from = pick.ownerTeamId;
    acceptOffer(league, offer, `${offer.reason} Accepted by the league office.`);
    return `${from} traded #${pick.overall} to ${offer.teamId}.`;
  }
  const round = pick.round;
  let n = 0;
  switch (action.until) {
    case "next":
      aiPick(league);
      n = 1;
      break;
    case "team":
      // Up to (not including) the team's next pick, so the league office can make it.
      n = simPicks(
        league,
        (p) => (p.ownerTeamId === action.teamId && p.id !== pick.id) || yours(p),
      );
      break;
    case "round":
      n = simPicks(league, (p) => p.round !== round || yours(p));
      break;
    case "all":
      n = simPicks(league, yours);
      break;
  }
  return `${n} pick${n === 1 ? "" : "s"} made.`;
}
