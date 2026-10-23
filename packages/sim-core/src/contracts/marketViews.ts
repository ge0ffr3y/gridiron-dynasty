/**
 * Free-agency screens (Phase 12): the negotiation screen (a player's market
 * value, his ask and why, his agent, how he sees the team, the talks so far,
 * and what an offer would do to the cap), the league office's offers (until GM
 * Mode it can negotiate for any team), and the free-agent market board.
 *
 * Ratings shown are the viewer's read (perception.ts).
 */
import { personTeam } from "../career/delegation";
import { ownerVeto } from "../career/job";
import { ageOn, type Dollars } from "@fgm/foundation";
import type { League, Offer, Player } from "../league/schema";
import { readOverall, type Viewer } from "../perception";
import { agentOf } from "../people/agents";
import { capHit, span } from "./contract";
import { formerTeam, makeRoomFor, teamBudget } from "./freeAgency";
import { marketValue, type MarketValue } from "./market";
import {
  answerOffer,
  askAsOffer,
  contractFromOffer,
  demandFor,
  teamAppeal,
  type Appeal,
  type Demand,
} from "./negotiation";
import { extendContract, recordTransaction } from "./operations";
import { capSheet } from "./team";
import { scratch } from "./views";

type Talks = League["negotiations"][number];

const name = (p: { firstName: string; lastName: string }) => `${p.firstName} ${p.lastName}`;
const money = (d: number) => `$${(d / 1_000_000).toFixed(2)}M`;

function teamName(league: League, id: string): string {
  const t = league.teams.find((x) => x.id === id);
  return t ? `${t.city} ${t.nickname}` : id;
}

/** What kind of talks a team can have with a player now, or why it can't. */
export function talksKind(
  league: League,
  p: Player,
  teamId: string,
): { kind: Talks["kind"] | null; why: string } {
  if (p.retiredAfter !== null) return { kind: null, why: "He has retired." };
  if (p.rights && p.rights.teamId !== teamId)
    return {
      kind: null,
      why: `${p.rights.teamId} holds his rights (a tender or tag); other teams deal through offer sheets.`,
    };
  if (p.teamId === null) {
    if (league.freeAgency === null && league.calendar.stage === "offseason")
      return { kind: null, why: "Free agency opens with the new League Year." };
    return { kind: "free-agent", why: "A free agent: any team may make an offer." };
  }
  if (p.teamId !== teamId) return { kind: null, why: `Under contract with ${p.teamId}.` };
  const c = p.contract!;
  const last = span(c).lastReal;
  if (p.rights)
    return {
      kind: "re-sign",
      why: "His tender or tag holds his rights: a long-term deal replaces it.",
    };
  if (last < league.season)
    return { kind: "re-sign", why: "His deal runs out at the League Year: the re-signing window." };
  if (c.type === "rookie" && p.experience < league.rules.freeAgency.rookieExtensionAfterSeasons)
    return {
      kind: null,
      why: `A drafted rookie's deal can't be redone until after his ${league.rules.freeAgency.rookieExtensionAfterSeasons}rd season (CBA Article 7).`,
    };
  if (last <= league.season + 1)
    return { kind: "extension", why: "In his deal's last years: an extension adds years to it." };
  return { kind: null, why: "Under contract for more than two more seasons." };
}

export interface NegotiationView {
  player: {
    id: number;
    name: string;
    position: string;
    age: number;
    overall: number;
    team: string | null;
    experience: number;
  };
  team: { id: string; name: string };
  kind: Talks["kind"] | null;
  why: string;
  market: MarketValue;
  ask: Offer & { minYears: number; maxYears: number };
  reasons: string[];
  agent: { name: string; agency: string; style: string };
  priorities: { money: number; winning: number; role: number; location: number };
  appeal: Appeal;
  talks: Talks | null;
  /** Room this League Year and next, now and after signing his ask. */
  cap: { roomNow: Dollars; roomNext: Dollars; afterAsk: { now: Dollars; next: Dollars } };
}

function talksOf(league: League, p: Player, teamId: string): Talks | null {
  return (
    league.negotiations.find(
      (n) => n.playerId === p.id && n.teamId === teamId && n.season === league.season,
    ) ?? null
  );
}

/** Room this League Year and next if this offer were signed (tried on a scratch copy). */
export function capAfter(
  league: League,
  p: Player,
  teamId: string,
  offer: Offer,
  kind: Talks["kind"],
): { now: Dollars; next: Dollars } {
  const copy = scratch(league);
  const q = copy.players.find((x) => x.id === p.id)!;
  if (kind === "extension") {
    const add = contractFromOffer(
      copy,
      q,
      teamId,
      offer,
      "extension",
      span(q.contract!).lastReal + 1,
    );
    q.contract = {
      ...q.contract!,
      years: [...q.contract!.years.filter((y) => !y.void), ...add.years],
      bonuses: [...q.contract!.bonuses, ...add.bonuses],
    };
  } else {
    q.contract = contractFromOffer(copy, q, teamId, offer);
    q.teamId = teamId;
  }
  return {
    now: capSheet(copy, teamId, copy.season).room,
    next: capSheet(copy, teamId, copy.season + 1).room,
  };
}

export function negotiationView(
  league: League,
  playerId: number,
  teamId: string,
  viewer: Viewer,
): NegotiationView {
  const p = league.players.find((x) => x.id === playerId);
  if (!p) throw new Error(`no player ${playerId}`);
  const { kind, why } = talksKind(league, p, teamId);
  const demand: Demand = demandFor(league, p, teamId, p.teamId ?? formerTeam(league, p));
  const agent = agentOf(league, p);
  const ask = askAsOffer(demand);
  return {
    player: {
      id: p.id,
      name: name(p),
      position: p.position,
      age: ageOn(p.birthDate, league.date),
      overall: readOverall(league, p, viewer),
      team: p.teamId,
      experience: p.experience,
    },
    team: { id: teamId, name: teamName(league, teamId) },
    kind,
    why,
    market: demand.market,
    ask: { ...ask, minYears: demand.minYears, maxYears: demand.maxYears },
    reasons: demand.reasons,
    agent: {
      name: name(agent),
      agency: agent.agency,
      style:
        agent.style === "relationship"
          ? "relationship-driven"
          : agent.style === "money"
            ? "money-only"
            : agent.style,
    },
    priorities: p.personality.priorities,
    appeal: teamAppeal(league, p, teamId),
    talks: talksOf(league, p, teamId),
    cap: {
      roomNow: capSheet(league, teamId, league.season).room,
      roomNext: capSheet(league, teamId, league.season + 1).room,
      afterAsk: kind ? capAfter(league, p, teamId, ask, kind) : { now: 0, next: 0 },
    },
  };
}

/**
 * The league office's offer for a team (until GM Mode): his answer, recorded in the talks. An
 * accepted offer is signed at once if the team can fit it under the cap.
 */
export function makeOffer(
  league: League,
  playerId: number,
  teamId: string,
  offer: Offer,
): { decision: string; message: string; counter: Offer | null } {
  const p = league.players.find((x) => x.id === playerId);
  if (!p) throw new Error(`no player ${playerId}`);
  const { kind, why } = talksKind(league, p, teamId);
  if (!kind) throw new Error(why);
  if (offer.years < 1 || offer.apy <= 0)
    throw new Error("An offer needs at least one year and a yearly value.");
  if (offer.guaranteed > offer.apy * offer.years)
    throw new Error("Guarantees can't exceed the contract's total value.");
  let talks = talksOf(league, p, teamId);
  if (talks?.status === "ended") throw new Error(`Talks have ended: ${talks.reason}`);
  if (talks?.status === "agreed") throw new Error("They already agreed.");
  const round = (talks?.rounds ?? 0) + 1;
  const answer = answerOffer(league, p, teamId, offer, round, talks?.counter ?? null);
  if (answer.decision === "accept") {
    // GM Mode: a meddling owner may veto a deal far past his budget (Phase 14b).
    const veto = ownerVeto(league, teamId, offer);
    if (veto) throw new Error(veto);
    const after = capAfter(league, p, teamId, offer, kind);
    if (after.now < 0)
      throw new Error(
        `He'd accept, but ${teamId} would be ${money(-after.now)} over the cap this League Year: make room first.`,
      );
    // A roster spot last, so nobody is waived for a deal that can't be signed.
    if (kind === "free-agent" && !makeRoomFor(league, teamId, p))
      throw new Error(`He'd accept, but ${teamId} has no roster spot and no one worse to let go.`);
  }
  if (!talks) {
    talks = {
      playerId,
      teamId,
      season: league.season,
      kind,
      rounds: 0,
      status: "open",
      offer: null,
      counter: null,
      reason: "",
      date: league.date,
    };
    league.negotiations.push(talks);
  }
  talks.rounds = round;
  talks.offer = offer;
  talks.counter = answer.counter;
  talks.reason = answer.reason;
  talks.date = league.date;
  talks.status =
    answer.decision === "accept" ? "agreed" : answer.decision === "reject" ? "ended" : "open";
  if (answer.decision === "accept") {
    const reason = `${personTeam(league) === teamId ? "Your decision" : "Negotiated by the league office"}. ${answer.reason}`;
    if (kind === "extension") {
      const add = contractFromOffer(
        league,
        p,
        teamId,
        offer,
        "extension",
        span(p.contract!).lastReal + 1,
      );
      extendContract(
        league,
        p.id,
        add.years.map(({ season: _s, ...rest }) => rest),
        offer.signingBonus,
        reason,
      );
    } else {
      p.contract = contractFromOffer(league, p, teamId, offer);
      const from = p.teamId ?? formerTeam(league, p);
      p.teamId = teamId;
      p.rights = null;
      p.roster = "active";
      if (
        kind === "free-agent" &&
        from &&
        from !== teamId &&
        p.experience >= league.rules.draft.compensatory.unrestrictedAccruedSeasons
      )
        league.freeAgentMoves.push({
          season: league.season,
          date: league.date,
          playerId: p.id,
          fromTeamId: from,
          toTeamId: teamId,
          position: p.position,
          averagePerYear: offer.apy,
          years: offer.years,
          accruedSeasons: p.experience,
        });
      if (league.freeAgency)
        league.freeAgency.offers = league.freeAgency.offers.filter((o) => o.playerId !== p.id);
      recordTransaction(league, {
        type: "signed",
        teamIds: [teamId],
        playerIds: [p.id],
        text: `${teamId} ${kind === "re-sign" ? "re-signed" : "signed free agent"} ${name(p)} (${p.position}): ${offer.years} year${offer.years === 1 ? "" : "s"}, ${money(offer.apy)} a year, ${money(offer.guaranteed)} guaranteed.`,
        reason,
      });
    }
  }
  return { decision: answer.decision, message: answer.reason, counter: answer.counter };
}

export interface FreeAgentRow {
  id: number;
  name: string;
  position: string;
  age: number;
  overall: number;
  formerTeam: string | null;
  market: number;
  ask: number;
  /** Teams with an offer out, and the best offer's yearly value. */
  offers: number;
  bestOffer: number | null;
  bidders: string[];
}

export interface FreeAgencyView {
  season: number;
  open: boolean;
  day: number | null;
  rows: FreeAgentRow[];
  signings: { date: string; text: string; reason: string }[];
  rights: {
    player: string;
    playerId: number;
    position: string;
    team: string;
    kind: string;
    amount: number;
  }[];
  offerSheets: { player: string; team: string; prior: string; apy: number; matchBy: string }[];
  /** The viewer team's room (if a team), else null. */
  room: number | null;
}

/** The free-agent market: who's available, interest, recent signings, tags and tenders. */
export function freeAgencyView(league: League, viewer: Viewer, limit = 150): FreeAgencyView {
  const fa = league.freeAgency;
  const pool = league.players
    .filter((p) => p.teamId === null && p.retiredAfter === null && p.experience > 0)
    .map((p) => ({ p, value: marketValue(league, p) }))
    .sort((a, b) => b.value.apy - a.value.apy || a.p.id - b.p.id)
    .slice(0, limit);
  const rows = pool.map(({ p, value }): FreeAgentRow => {
    const offers = fa?.offers.filter((o) => o.playerId === p.id) ?? [];
    const former = formerTeam(league, p);
    return {
      id: p.id,
      name: name(p),
      position: p.position,
      age: ageOn(p.birthDate, league.date),
      overall: readOverall(league, p, viewer),
      formerTeam: former,
      market: value.apy,
      ask: demandFor(league, p, null, former).apy,
      offers: offers.length,
      bestOffer: offers.length ? Math.max(...offers.map((o) => o.offer.apy)) : null,
      bidders: offers
        .sort((a, b) => b.offer.apy - a.offer.apy)
        .slice(0, 3)
        .map((o) => o.teamId),
    };
  });
  const since = `${league.season}-02-01`;
  const signings = league.transactions
    .filter(
      (t) =>
        t.type === "signed" &&
        t.date >= since &&
        /signed free agent|re-signed|offer sheet/.test(t.text) &&
        !t.text.includes("minimum"),
    )
    .slice(-60)
    .reverse()
    .map((t) => ({ date: t.date, text: t.text, reason: t.reason }));
  const label: Record<string, string> = {
    "franchise-exclusive": "Franchise tag (exclusive)",
    franchise: "Franchise tag",
    transition: "Transition tag",
    "rfa-first": "Restricted: first-round tender",
    "rfa-second": "Restricted: second-round tender",
    "rfa-original": "Restricted: original-round tender",
    "rfa-rofr": "Restricted: right of first refusal",
    erfa: "Exclusive-rights tender",
  };
  const rights = league.players
    .filter((p) => p.rights && p.rights.season === league.season && p.contract)
    .map((p) => ({
      player: name(p),
      playerId: p.id,
      position: p.position,
      team: p.rights!.teamId,
      kind: label[p.rights!.kind]!,
      amount: capHit(p.contract!, league.season, league.rules.cap),
    }))
    .sort((a, b) => b.amount - a.amount);
  return {
    season: league.season,
    open: fa !== null,
    day: fa?.day ?? null,
    rows,
    signings,
    rights,
    offerSheets: (fa?.offerSheets ?? []).map((s) => ({
      player: name(league.players.find((x) => x.id === s.playerId)!),
      team: s.teamId,
      prior: s.priorTeamId,
      apy: s.offer.apy,
      matchBy: s.matchBy,
    })),
    room: viewer.kind === "team" ? teamBudget(league, viewer.teamId) : null,
  };
}
