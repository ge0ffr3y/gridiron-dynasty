/**
 * Front-office screens (Phase 13): a team's front office (GM, owner, where the team stands, the
 * cap outlook, needs, recent trades), the trade offers waiting for a person-run team, and the
 * league office's trades, which the other team's AI must now accept.
 */
import { ageOn } from "@fgm/foundation";
import type { League } from "../league/schema";
import { teamNeeds } from "../draft/boards";
import { pickLabel, previewTradeDeal, type TradeSide } from "../roster/trades";
import {
  ARCHETYPE_LABELS,
  archetypeOf,
  describeGm,
  describeOwner,
  gmOf,
  GM_KNOBS,
  ownerOf,
} from "./executives";
import { answerTrade, executeTrade, type TradeAnswer } from "./tradeAI";

const KNOB_LABELS: Record<(typeof GM_KNOBS)[number], [string, string]> = {
  futureDiscount: ["Builds for later", "Wins now"],
  analytics: ["Scouts and veterans", "The numbers"],
  capAggression: ["Clean books", "Pay later"],
  tradeAppetite: ["Rarely trades", "Loves to deal"],
  loyalty: ["Unsentimental", "Loyal"],
  risk: ["Avoids risk", "Takes risks"],
};

export interface FrontOfficeView {
  teamId: string;
  gm: {
    id: number;
    name: string;
    age: number;
    archetype: string;
    leanings: string[];
    knobs: { key: string; low: string; high: string; value: number }[];
    hiredSeason: number;
    contractThrough: number | null;
  } | null;
  owner: { id: number; name: string; age: number; traits: string[] } | null;
  plan: {
    stance: string;
    reasons: string[];
    strength: number;
    future: number;
    capRoom: { season: number; share: number }[];
    date: string;
  } | null;
  needs: { position: string; need: number }[];
  trades: {
    date: string;
    partner: string;
    gave: number;
    got: number;
    text: string;
  }[];
}

/** A team's front office, as the league office sees it. */
export function frontOfficeView(league: League, teamId: string): FrontOfficeView {
  const gm = gmOf(league, teamId);
  const owner = ownerOf(league, teamId);
  const plan = league.teams.find((t) => t.id === teamId)?.plan ?? null;
  const name = (e: { firstName: string; lastName: string }) => `${e.firstName} ${e.lastName}`;
  return {
    teamId,
    gm:
      gm && gm.gm
        ? {
            id: gm.id,
            name: name(gm),
            age: ageOn(gm.birthDate, league.date),
            archetype: ARCHETYPE_LABELS[archetypeOf(gm.gm)],
            leanings: describeGm(gm.gm),
            knobs: GM_KNOBS.map((k) => ({
              key: k,
              low: KNOB_LABELS[k][0],
              high: KNOB_LABELS[k][1],
              value: gm.gm![k],
            })),
            hiredSeason: gm.hiredSeason,
            contractThrough: gm.contractThrough,
          }
        : null,
    owner:
      owner && owner.owner
        ? {
            id: owner.id,
            name: name(owner),
            age: ageOn(owner.birthDate, league.date),
            traits: describeOwner(owner.owner),
          }
        : null,
    plan: plan
      ? {
          stance: plan.stance,
          reasons: plan.reasons,
          strength: plan.strength,
          future: plan.future,
          capRoom: plan.capRoom.map((share, i) => ({ season: plan.season + i, share })),
          date: plan.date,
        }
      : null,
    needs: [...teamNeeds(league, teamId)]
      .map(([position, need]) => ({ position, need: Math.round(need * 100) / 100 }))
      .filter((n) => n.need > 0.05)
      .sort((a, b) => b.need - a.need || a.position.localeCompare(b.position))
      .slice(0, 6),
    trades: league.tradeHistory
      .filter((h) => h.teams.includes(teamId))
      .slice()
      .reverse()
      .slice(0, 10)
      .map((h) => {
        const i = h.teams[0] === teamId ? 0 : 1;
        const t = league.transactions.find(
          (x) =>
            x.type === "traded" &&
            x.date === h.date &&
            x.teamIds.includes(h.teams[0]) &&
            x.teamIds.includes(h.teams[1]),
        );
        return {
          date: h.date,
          partner: h.teams[1 - i]!,
          gave: h.gave[i]!,
          got: h.got[i]!,
          text: t?.text ?? "",
        };
      }),
  };
}

export interface TradeOfferRow {
  id: number;
  date: string;
  expires: string;
  from: string;
  /** What you'd get and give, in words. */
  get: string[];
  give: string[];
  reason: string;
  status: string;
}

function describe(league: League, side: { players: number[]; picks: number[] }): string[] {
  return [
    ...side.players.map((id) => {
      const p = league.players.find((x) => x.id === id);
      return p ? `${p.firstName} ${p.lastName} (${p.position})` : `player ${id}`;
    }),
    ...side.picks.map((id) => {
      const d = league.draftPicks.find((x) => x.id === id);
      return d ? pickLabel(league, d) : `pick ${id}`;
    }),
  ];
}

export interface TradeOffersView {
  /** True when a person answers this team's offers (else its AI does, and none arrive). */
  human: boolean;
  offers: TradeOfferRow[];
}

/** Trade offers to a team (open first, then the last few answered). */
export function tradeOffersView(league: League, teamId: string): TradeOffersView {
  const team = league.teams.find((t) => t.id === teamId);
  return {
    human: team?.controller === "human",
    offers: league.tradeOffers
      .filter((o) => o.toTeamId === teamId)
      .sort((a, b) => (a.status === "open" ? 0 : 1) - (b.status === "open" ? 0 : 1) || b.id - a.id)
      .slice(0, 15)
      .map((o) => ({
        id: o.id,
        date: o.date,
        expires: o.expires,
        from: o.fromTeamId,
        get: describe(league, o.give),
        give: describe(league, o.get),
        reason: o.reason,
        status: o.status,
      })),
  };
}

/** The person's answer to an offer: accepting makes the trade if it's still legal. */
export function respondToOffer(league: League, offerId: number, accept: boolean): string {
  const o = league.tradeOffers.find((x) => x.id === offerId);
  if (!o || o.status !== "open") throw new Error("That offer is no longer open.");
  league.pendingDecisions = league.pendingDecisions.filter((d) => d.request.offerId !== offerId);
  if (!accept) {
    o.status = "declined";
    return `Declined ${o.fromTeamId}'s offer.`;
  }
  const from: TradeSide = { teamId: o.fromTeamId, ...o.give };
  const to: TradeSide = { teamId: o.toTeamId, ...o.get };
  const preview = previewTradeDeal(league, from, to);
  if (!preview.legal) {
    o.status = "expired";
    throw new Error(`The trade can't go through any more: ${preview.problems.join(" ")}`);
  }
  executeTrade(
    league,
    from,
    to,
    "offer",
    `${o.toTeamId} accepted ${o.fromTeamId}'s offer: ${o.reason}`,
  );
  o.status = "accepted";
  return league.transactions.at(-1)!.text;
}

/** The other team's answer to a league-office proposal (`a` proposes, `b` answers). */
export function tradeAnswer(league: League, a: TradeSide, b: TradeSide): TradeAnswer {
  return answerTrade(league, a, b);
}

/** The league office proposes a trade for team `a`; it goes through only if `b`'s GM agrees. */
export function proposeTrade(league: League, a: TradeSide, b: TradeSide): string {
  const answer = answerTrade(league, a, b);
  if (!answer.accept) throw new Error(answer.reason);
  executeTrade(
    league,
    a,
    b,
    "office",
    `The league office proposed it for ${a.teamId} (until GM Mode); ${b.teamId}'s GM agreed.`,
  );
  return league.transactions.at(-1)!.text;
}

/** Who answers a team's decisions (trade offers today): the AI, or the person playing. */
export function setController(league: League, teamId: string, human: boolean): void {
  const t = league.teams.find((x) => x.id === teamId);
  if (!t) throw new Error(`no team ${teamId}`);
  t.controller = human ? "human" : "ai";
}
