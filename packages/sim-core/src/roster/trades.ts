/**
 * Trades (Phase 8b): players and draft picks between two teams. A trade is
 * refused when either team would end up over the cap or the roster limit, when
 * a player can't be traded (practice-squad players aren't under a regular
 * contract), or outside the trading period: from the new League Year in March
 * through the trade deadline (rules.calendar). Each player's bonus money stays
 * with his old team; the new team takes the rest of his contract (and in the
 * season only the weeks still to be paid). Until GM Mode the league office can
 * make any legal trade, and AI teams don't propose or judge trades (Phase 13).
 */
import { capHit } from "../contracts/contract";
import { batch, recordTransaction, tradePlayer } from "../contracts/operations";
import { capSheet } from "../contracts/team";
import { scratch } from "../contracts/views";
import type { DraftPick, League } from "../league/schema";
import { seasonDates } from "../season/calendar";
import { assignJerseys } from "./jerseys";
import { rosterProblems } from "./legality";
import { rosterCount, rosterLimit } from "./lists";

export interface TradeSide {
  teamId: string;
  /** Players this team sends. */
  players: number[];
  /** Draft picks (ids) this team sends. */
  picks: number[];
}

export interface TradeTeamPreview {
  teamId: string;
  name: string;
  /** Cap room this League Year and next, before and after. */
  roomNow: { before: number; after: number };
  roomNext: { before: number; after: number };
  /** Dead money the trade leaves on this team (bonus money of players it sends, pay already earned). */
  deadMoney: number;
  roster: { before: number; after: number; limit: number };
  receives: {
    players: { id: number; name: string; position: string; capHit: number }[];
    picks: string[];
  };
}

export interface TradePreview {
  legal: boolean;
  /** Plain-English reasons it can't be made (empty when legal). */
  problems: string[];
  teams: [TradeTeamPreview, TradeTeamPreview];
}

/** The trading period: from the new League Year until the deadline (closed after it until March). */
export function tradingOpen(league: League): { open: boolean; why: string } {
  const d = seasonDates(league.rules, league.season);
  if (league.calendar.stage === "offseason")
    return {
      open: false,
      why: `Trading reopens when the new League Year starts (${d.leagueYear}).`,
    };
  if (league.date > d.tradeDeadline)
    return {
      open: false,
      why: `The trade deadline (${d.tradeDeadline}) has passed; trading reopens at the next League Year.`,
    };
  return { open: true, why: "" };
}

/** Picks a team can trade: future drafts it holds, and this year's until the draft is made. */
export function tradablePicks(league: League, teamId: string): DraftPick[] {
  const draftDay = seasonDates(league.rules, league.season).draft;
  return (
    league.draftPicks
      .filter((p) => p.ownerTeamId === teamId)
      // This year's picks trade until they're used: before draft day, or on it while the draft runs.
      .filter(
        (p) =>
          p.season > league.season ||
          (p.season === league.season &&
            p.selection === null &&
            (league.date < draftDay || league.calendar.stage === "draft")),
      )
      .sort(
        (a, b) =>
          a.season - b.season ||
          a.round - b.round ||
          (a.overall ?? 999) - (b.overall ?? 999) ||
          a.id - b.id,
      )
  );
}

export function pickLabel(league: League, p: DraftPick): string {
  const ordinal = ["", "1st", "2nd", "3rd", "4th", "5th", "6th", "7th"][p.round] ?? `${p.round}th`;
  const own = p.originalTeamId === p.ownerTeamId ? "" : ` (from ${p.originalTeamId})`;
  const comp = p.compensatory ? " (compensatory)" : "";
  return `${p.season} ${ordinal} round${p.overall ? `, #${p.overall}` : ""}${comp}${own}`;
}

function teamName(league: League, id: string): string {
  const t = league.teams.find((x) => x.id === id);
  return t ? `${t.city} ${t.nickname}` : id;
}

/** Moves everything in the deal (no transaction recorded; the caller records one). */
function apply(league: League, a: TradeSide, b: TradeSide, reason: string): void {
  for (const [from, to] of [
    [a, b],
    [b, a],
  ] as const) {
    for (const id of from.players) {
      const p = league.players.find((x) => x.id === id)!;
      p.roster = "active";
      p.reserve = null;
      tradePlayer(league, id, to.teamId, reason, { record: false });
    }
    for (const id of from.picks)
      league.draftPicks.find((d) => d.id === id)!.ownerTeamId = to.teamId;
  }
}

/** What a trade would do to both teams, and whether it's legal. Changes nothing. */
export function previewTradeDeal(league: League, a: TradeSide, b: TradeSide): TradePreview {
  const problems: string[] = [];
  const period = tradingOpen(league);
  if (!period.open) problems.push(period.why);
  if (a.teamId === b.teamId) problems.push("A trade needs two different teams.");
  if (a.players.length + a.picks.length + b.players.length + b.picks.length === 0)
    problems.push("Add at least one player or pick.");
  for (const side of [a, b]) {
    for (const id of side.players) {
      const p = league.players.find((x) => x.id === id);
      if (!p || p.teamId !== side.teamId || !p.contract || p.contract.teamId !== side.teamId)
        problems.push(`Player ${id} isn't under contract with ${side.teamId}.`);
      else if (p.roster === "practice-squad")
        problems.push(
          `${p.firstName} ${p.lastName} is on the practice squad, and practice-squad players can't be traded.`,
        );
    }
    const tradable = new Set(tradablePicks(league, side.teamId).map((d) => d.id));
    for (const id of side.picks)
      if (!tradable.has(id)) problems.push(`Pick ${id} isn't ${side.teamId}'s to trade.`);
  }
  const copy = scratch(league);
  const before = (l: League, id: string) => ({
    now: capSheet(l, id, l.season).room,
    next: capSheet(l, id, l.season + 1).room,
    roster: rosterCount(l, id),
    dead: l.teams
      .find((t) => t.id === id)!
      .cap.deadMoney.reduce((s, d) => s + (d.season === l.season ? d.amount : 0), 0),
  });
  const was = [before(league, a.teamId), before(league, b.teamId)] as const;
  if (problems.length === 0) {
    apply(copy, a, b, "preview");
    // The rules both teams must meet afterwards (cap and roster limits).
    for (const issue of rosterProblems(copy, [a.teamId, b.teamId]))
      if (issue.startsWith(a.teamId) || issue.startsWith(b.teamId)) problems.push(issue);
  }
  const now = [before(copy, a.teamId), before(copy, b.teamId)] as const;
  const side = (i: 0 | 1, self: TradeSide, other: TradeSide): TradeTeamPreview => ({
    teamId: self.teamId,
    name: teamName(league, self.teamId),
    roomNow: { before: was[i].now, after: now[i].now },
    roomNext: { before: was[i].next, after: now[i].next },
    deadMoney: now[i].dead - was[i].dead,
    roster: { before: was[i].roster, after: now[i].roster, limit: rosterLimit(league) },
    receives: {
      players: other.players.map((id) => {
        const p = copy.players.find((x) => x.id === id)!;
        return {
          id,
          name: `${p.firstName} ${p.lastName}`,
          position: p.position,
          capHit: p.contract ? capHit(p.contract, league.season, league.rules.cap) : 0,
        };
      }),
      picks: other.picks.map((id) =>
        pickLabel(
          league,
          league.draftPicks.find((d) => d.id === id)!,
        ),
      ),
    },
  });
  return { legal: problems.length === 0, problems, teams: [side(0, a, b), side(1, b, a)] };
}

/** Makes a legal trade, recording one transaction with its reason. Throws if it isn't legal. */
export function makeTrade(
  league: League,
  a: TradeSide,
  b: TradeSide,
  reason: string,
): TradePreview {
  const preview = previewTradeDeal(league, a, b);
  if (!preview.legal) throw new Error(preview.problems.join(" "));
  const describe = (side: TradeSide) =>
    [
      ...side.players.map((id) => {
        const p = league.players.find((x) => x.id === id)!;
        return `${p.firstName} ${p.lastName} (${p.position})`;
      }),
      ...side.picks.map((id) =>
        pickLabel(
          league,
          league.draftPicks.find((d) => d.id === id)!,
        ),
      ),
    ].join(", ") || "nothing";
  const text = `${a.teamId} traded ${describe(a)} to ${b.teamId} for ${describe(b)}.`;
  batch(league, () => {
    apply(league, a, b, reason);
    assignJerseys(league, [a.teamId, b.teamId]);
    recordTransaction(league, {
      type: "traded",
      teamIds: [a.teamId, b.teamId],
      playerIds: [...a.players, ...b.players],
      text,
      reason,
    });
  });
  return preview;
}
