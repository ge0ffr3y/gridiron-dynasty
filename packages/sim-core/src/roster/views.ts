/**
 * Screen data for Phase 8b: the transactions log, the League Year calendar,
 * the camp report, and the trade builder's lists.
 */
import { ageOn, type Position } from "@fgm/foundation";
import { capHit } from "../contracts/contract";
import type { League } from "../league/schema";
import { perceivePlayer, type Viewer } from "../perception";
import { calendarEvents, seasonDates, stageLabel } from "../season/calendar";
import { availableActions } from "../season/actions";
import { onTeam } from "./lists";
import { pickLabel, tradablePicks, tradingOpen } from "./trades";

export const TRANSACTION_GROUPS: Record<string, string[]> = {
  Signings: ["signed", "practice-squad", "drafted", "extended"],
  Releases: ["released", "waived", "expired", "retired"],
  Claims: ["claimed"],
  Trades: ["traded"],
  "Injured reserve": ["reserve", "activated", "elevated"],
  Contracts: ["restructured", "pay-cut", "option", "tagged", "cash-shortfall"],
  Development: ["development"],
};

export interface TransactionRow {
  id: number;
  date: string;
  type: string;
  teams: string[];
  players: { id: number; name: string }[];
  text: string;
  reason: string;
}

export interface TransactionsView {
  total: number;
  rows: TransactionRow[];
  teams: { id: string; name: string }[];
  groups: string[];
}

/** The transaction log, newest first, filtered by team and kind. */
export function transactionsView(
  league: League,
  options: { teamId?: string; group?: string; limit?: number } = {},
): TransactionsView {
  const kinds = options.group ? new Set(TRANSACTION_GROUPS[options.group] ?? []) : null;
  const matching = league.transactions.filter(
    (t) => (!options.teamId || t.teamIds.includes(options.teamId)) && (!kinds || kinds.has(t.type)),
  );
  const names = new Map(league.players.map((p) => [p.id, `${p.firstName} ${p.lastName}`]));
  return {
    total: matching.length,
    rows: matching
      .slice(-(options.limit ?? 300))
      .reverse()
      .map((t) => ({
        id: t.id,
        date: t.date,
        type: t.type,
        teams: t.teamIds,
        players: t.playerIds.map((id) => ({ id, name: names.get(id) ?? `Player ${id}` })),
        text: t.text,
        reason: t.reason,
      })),
    teams: league.teams.map((t) => ({ id: t.id, name: `${t.city} ${t.nickname}` })),
    groups: Object.keys(TRANSACTION_GROUPS),
  };
}

export interface CalendarPageView {
  season: number;
  date: string;
  stage: string;
  events: { date: string; label: string; past: boolean; next: boolean }[];
  /** What each sim button does from here. */
  actions: { label: string }[];
  trading: { open: boolean; why: string };
}

export function calendarPageView(league: League): CalendarPageView {
  const events = calendarEvents(league.rules, league.season);
  const nextIndex = events.findIndex((e) => e.date > league.date);
  return {
    season: league.season,
    date: league.date,
    stage: stageLabel(league.calendar.stage, league.calendar.week),
    events: events.map((e, i) => ({ ...e, past: e.date <= league.date, next: i === nextIndex })),
    actions: availableActions(league).map((a) => ({ label: a.label })),
    trading: tradingOpen(league),
  };
}

export interface CampReportView {
  season: number;
  /** Graded once the last preseason week is played. */
  graded: boolean;
  standouts: {
    id: number;
    name: string;
    team: string;
    position: Position;
    grade: number;
    improved: boolean;
    madeTeam: boolean | null;
  }[];
  improved: { id: number; name: string; team: string; reason: string }[];
  claims: { date: string; text: string }[];
  cuts: { team: string; cut: number; claimedAway: number }[];
}

/** This year's camp: preseason standouts, who improved, and the waiver claims at final cuts. */
export function campReportView(league: League): CampReportView {
  const season = league.season;
  const cutsDone =
    league.calendar.stage !== "offseason" &&
    league.calendar.stage !== "free-agency" &&
    league.calendar.stage !== "after-draft" &&
    league.calendar.stage !== "preseason" &&
    league.calendar.stage !== "cutdown";
  const graded = league.players.filter(
    (p) => p.preseason?.season === season && p.preseason.grade !== null,
  );
  // Camp's development round (Phase 9): who improved notably in camp.
  const camp = league.development.find((r) => r.season === season && r.stage === "camp");
  const campGains = (camp?.changes ?? []).filter((c) => c.after > c.before);
  const developmentIds = new Set(campGains.map((c) => c.playerId));
  const d = seasonDates(league.rules, season);
  const atCuts = league.transactions.filter(
    (t) => t.date >= d.cutdown && t.date <= d.practiceSquads,
  );
  return {
    season,
    graded: graded.length > 0,
    standouts: graded
      .sort((a, b) => b.preseason!.grade! - a.preseason!.grade! || a.id - b.id)
      .slice(0, 40)
      .map((p) => ({
        id: p.id,
        name: `${p.firstName} ${p.lastName}`,
        team: p.teamId ?? "Free agent",
        position: p.position,
        grade: p.preseason!.grade!,
        improved: developmentIds.has(p.id),
        madeTeam: cutsDone ? p.teamId !== null && p.roster === "active" : null,
      })),
    improved: campGains.map((c) => {
      const p = league.players.find((x) => x.id === c.playerId)!;
      return {
        id: p.id,
        name: `${p.firstName} ${p.lastName}`,
        // Cut at final cuts after improving in camp: say so rather than leave the team blank.
        team: p.teamId ?? "cut",
        reason: c.reason,
      };
    }),
    claims: atCuts.filter((t) => t.type === "claimed").map((t) => ({ date: t.date, text: t.text })),
    cuts: league.teams.map((t) => ({
      team: t.id,
      cut: atCuts.filter(
        (x) =>
          (x.type === "released" || x.type === "claimed") &&
          x.teamIds[0] === t.id &&
          x.reason.startsWith("Cut at final cuts"),
      ).length,
      claimedAway: atCuts.filter((x) => x.type === "claimed" && x.teamIds[0] === t.id).length,
    })),
  };
}

export interface TradeAssets {
  team: { id: string; name: string };
  players: {
    id: number;
    name: string;
    position: Position;
    age: number;
    overall: number;
    capHit: number;
    lastSeason: number;
    list: string;
  }[];
  picks: { id: number; label: string }[];
}

/** One team's tradable players and picks, for the trade builder. */
export function tradeAssetsView(league: League, teamId: string, viewer: Viewer): TradeAssets {
  const team = league.teams.find((t) => t.id === teamId);
  if (!team) throw new Error(`no team ${teamId}`);
  return {
    team: { id: team.id, name: `${team.city} ${team.nickname}` },
    players: onTeam(league, teamId)
      .filter((p) => p.roster !== "practice-squad" && p.contract)
      .map((p) => ({
        id: p.id,
        name: `${p.firstName} ${p.lastName}`,
        position: p.position,
        age: ageOn(p.birthDate, league.date),
        overall: perceivePlayer(league, p, viewer).overall,
        capHit: capHit(p.contract!, league.season, league.rules.cap),
        lastSeason: Math.max(...p.contract!.years.filter((y) => !y.void).map((y) => y.season)),
        list: p.roster,
      }))
      .sort((a, b) => b.overall - a.overall || a.id - b.id),
    picks: tradablePicks(league, teamId).map((p) => ({ id: p.id, label: pickLabel(league, p) })),
  };
}
