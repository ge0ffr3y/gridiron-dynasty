/**
 * Draft screens (Phase 11b): the draft room, big boards, mock drafts and draft
 * history with retro grades. Ratings are always a viewer's read
 * (perception.ts); retro grades judge what players did on the field (seasons
 * started) against what real picks at the same slot did.
 */
import { personTeam } from "../career/delegation";
import { POSITIONS, type Position } from "@fgm/foundation";
import draftData from "../../../../calibration/draft.json";
import type { FormerPlayer, League, Player, Prospect } from "../league/schema";
import { perceiveHistory, perceiveProspect, type Viewer } from "../perception";
import { pickLabel } from "../roster/trades";
import { draftClass, upcomingDraftYear } from "../scouting/classes";
import { seasonsStarted } from "../scouting/report";
import { bigBoard, consensusRanks, philosophy, teamNeeds } from "./boards";
import { DRAFT_DAY } from "./config";
import { draftOrder, onTheClock, tradeOffers, type TradeOffer } from "./day";

const name = (p: { firstName: string; lastName: string }) => `${p.firstName} ${p.lastName}`;

function teamName(league: League, id: string): string {
  const t = league.teams.find((x) => x.id === id);
  return t ? `${t.city} ${t.nickname}` : id;
}

export interface DraftPickRow {
  overall: number;
  round: number;
  teamId: string;
  team: string;
  label: string;
  compensatory: string | null;
  /** The player taken, once used. */
  player: { id: number; name: string; position: string } | null;
}

function pickRow(league: League, p: League["draftPicks"][number]): DraftPickRow {
  const player =
    p.selection === null
      ? null
      : (league.players.find((x) => x.id === p.selection) ??
        league.formerPlayers.find((x) => x.id === p.selection) ??
        null);
  return {
    overall: p.overall!,
    round: p.round,
    teamId: p.ownerTeamId,
    team: teamName(league, p.ownerTeamId),
    label: pickLabel(league, p),
    compensatory: p.compensatory,
    player: player ? { id: player.id, name: name(player), position: player.position } : null,
  };
}

export interface BoardRow {
  rank: number;
  id: number;
  name: string;
  position: Position;
  college: string;
  overall: number;
  range: [number, number];
  potential: [number, number];
  consensusRank: number;
  need: number;
  value: number;
  reason: string;
}

function boardRows(
  league: League,
  teamId: string,
  available: Prospect[],
  limit: number,
): BoardRow[] {
  const consensus = consensusRanks(league, available);
  return bigBoard(league, teamId, available)
    .slice(0, limit)
    .map((e, i) => {
      const seen = perceiveProspect(league, e.prospect, { kind: "team", teamId });
      return {
        rank: i + 1,
        id: e.prospect.id,
        name: name(e.prospect),
        position: e.prospect.position,
        college: e.prospect.college,
        overall: seen.overall,
        range: seen.range,
        potential: seen.potential.range,
        consensusRank: consensus.get(e.prospect.id)!,
        need: e.need,
        value: Math.round(e.value * 10) / 10,
        reason: e.reason,
      };
    });
}

export interface DraftRoomView {
  draftYear: number;
  /** "before" draft day, "live" while picks are being made, "done" once every pick is used. */
  status: "before" | "live" | "done";
  date: string;
  onClock: (DraftPickRow & { clockMinutes: number; philosophy: string }) | null;
  /** The team on the clock's biggest needs (0-1). */
  needs: { position: Position; need: number }[];
  /** Its board (top of what's left). */
  board: BoardRow[];
  offers: TradeOffer[];
  upcoming: DraftPickRow[];
  /** Every pick and draft-day trade so far, newest first, with reasons. */
  log: { kind: "pick" | "trade"; text: string; reason: string }[];
  picksMade: number;
  picksTotal: number;
  /** GM Mode: your team (null in Simulation Mode), and whether you're on the clock. */
  you: string | null;
  yours: boolean;
}

export function draftRoomView(league: League): DraftRoomView {
  const live = league.calendar.stage === "draft";
  const draftYear = live ? league.season : upcomingDraftYear(league);
  const order = draftOrder(league, draftYear);
  const pick = onTheClock(league);
  const available = draftClass(league, draftYear);
  const made = order.filter((p) => p.selection !== null).length;
  const status: DraftRoomView["status"] = !live ? "before" : pick ? "live" : "done";
  const onClock = pick
    ? {
        ...pickRow(league, pick),
        clockMinutes: league.rules.draft.pickClockMinutes[pick.round - 1] ?? 5,
        philosophy: philosophy(league, pick.ownerTeamId).label,
      }
    : null;
  const needs = pick
    ? [...teamNeeds(league, pick.ownerTeamId)]
        .filter(([, n]) => n > 0)
        .sort((a, b) => b[1] - a[1] || POSITIONS.indexOf(a[0]) - POSITIONS.indexOf(b[0]))
        .slice(0, 5)
        .map(([position, need]) => ({ position, need }))
    : [];
  const log = live
    ? league.transactions
        .filter((t) => t.date === league.date && (t.type === "drafted" || t.type === "traded"))
        .reverse()
        .map((t) => ({
          kind: t.type === "drafted" ? ("pick" as const) : ("trade" as const),
          text: t.text,
          reason: t.reason,
        }))
    : [];
  return {
    draftYear,
    status,
    date: league.date,
    onClock,
    needs,
    board: pick ? boardRows(league, pick.ownerTeamId, available, 15) : [],
    offers: pick ? tradeOffers(league) : [],
    upcoming: order
      .filter((p) => p.selection === null)
      .slice(pick ? 1 : 0, (pick ? 1 : 0) + 12)
      .map((p) => pickRow(league, p)),
    log,
    picksMade: made,
    picksTotal: order.length,
    you: personTeam(league),
    yours: pick !== null && pick.ownerTeamId === personTeam(league),
  };
}

export interface BigBoardView {
  teamId: string;
  team: string;
  draftYear: number;
  philosophy: string;
  custom: boolean;
  needs: { position: Position; need: number }[];
  rows: BoardRow[];
}

/** A team's big board (top `limit`), as its draft room would use it. */
export function bigBoardView(league: League, teamId: string, limit = 100): BigBoardView {
  const team = league.teams.find((t) => t.id === teamId);
  if (!team) throw new Error(`no team ${teamId}`);
  return {
    teamId,
    team: teamName(league, teamId),
    draftYear: upcomingDraftYear(league),
    philosophy: philosophy(league, teamId).label,
    custom: (team.scouting.board?.length ?? 0) > 0,
    needs: [...teamNeeds(league, teamId)]
      .filter(([, n]) => n > 0)
      .sort((a, b) => b[1] - a[1] || POSITIONS.indexOf(a[0]) - POSITIONS.indexOf(b[0]))
      .map(([position, need]) => ({ position, need })),
    rows: boardRows(league, teamId, draftClass(league), limit),
  };
}

/** Sets a team's board by hand (prospect ids, best first), or back to its scouts' (null). */
export function setBoard(league: League, teamId: string, ids: number[] | null): void {
  const team = league.teams.find((t) => t.id === teamId);
  if (!team) throw new Error(`no team ${teamId}`);
  if (ids === null) {
    team.scouting.board = null;
    return;
  }
  const known = new Set(draftClass(league).map((p) => p.id));
  const bad = ids.find((id) => !known.has(id));
  if (bad !== undefined) throw new Error(`Prospect ${bad} isn't in this year's class.`);
  team.scouting.board = [...new Set(ids)];
}

export interface MockDraftView {
  draftYear: number;
  /** Whose mock: the league office's consensus, or a team's scouts. */
  by: string;
  /** Null when the order isn't set yet (it's set when the season ends). */
  picks: (DraftPickRow & {
    prospect: { id: number; name: string; position: Position; college: string };
    consensusRank: number;
  })[];
  note: string;
}

/**
 * A mock draft: who goes where if every team takes the best player for it, as the viewer's
 * scouts see the class and each team's needs and philosophy (no trades).
 */
export function mockDraftView(league: League, viewer: Viewer): MockDraftView {
  const draftYear = upcomingDraftYear(league);
  const by =
    viewer.kind === "league"
      ? "the league office's consensus"
      : `${teamName(league, viewer.teamId)}'s scouts`;
  const order = draftOrder(league, draftYear).filter((p) => p.selection === null);
  if (order.length === 0)
    return {
      draftYear,
      by,
      picks: [],
      note: "The draft order is set when the season ends; the mock appears then.",
    };
  const left = new Map(draftClass(league, draftYear).map((p) => [p.id, p]));
  const consensus = consensusRanks(league, [...left.values()]);
  // The viewer's read of everyone, once.
  const read = new Map(
    [...left.values()].map((p) => {
      const seen = perceiveProspect(league, p, viewer);
      return [p.id, seen.overall + 0.25 * (seen.potential.estimate - seen.overall)];
    }),
  );
  const needs = new Map<string, Map<Position, number>>();
  const picks: MockDraftView["picks"] = [];
  for (const pick of order) {
    const team = pick.ownerTeamId;
    if (!needs.has(team)) needs.set(team, teamNeeds(league, team));
    const style = philosophy(league, team);
    let best: Prospect | null = null;
    let bestValue = -Infinity;
    for (const p of left.values()) {
      const specialist = p.position === "K" || p.position === "P" || p.position === "LS";
      const v =
        read.get(p.id)! +
        (needs.get(team)!.get(p.position) ?? 0) * style.needPoints -
        (specialist ? DRAFT_DAY.mockSpecialistPenalty : 0);
      if (v > bestValue || (v === bestValue && best && p.id < best.id)) {
        best = p;
        bestValue = v;
      }
    }
    if (!best) break;
    left.delete(best.id);
    // The team's need there is filled for the rest of the mock.
    needs.get(team)!.set(best.position, 0);
    picks.push({
      ...pickRow(league, pick),
      prospect: { id: best.id, name: name(best), position: best.position, college: best.college },
      consensusRank: consensus.get(best.id)!,
    });
  }
  return {
    draftYear,
    by,
    picks,
    note: "Each team takes the best player for it as these scouts see the class, its needs and its philosophy. No trades.",
  };
}

export interface DraftHistoryView {
  seasons: number[];
  season: number | null;
  picks: {
    overall: number;
    round: number;
    teamId: string;
    player: { id: number; name: string; position: Position };
    now: string;
    seasons: number;
    started: number;
    /** What real picks at this slot started by now, on average. */
    expected: number;
    /** The viewer's read of his best season-end overall so far. */
    peak: number | null;
    grade: "Steal" | "Hit" | "Fair" | "Miss" | "Bust" | "Too early";
  }[];
  teams: { teamId: string; team: string; picks: number; score: number; grade: string }[];
  note: string;
}

/** Real picks' average seasons started over a career, by overall pick (calibration/draft.json). */
function realCareerStarts(pick: number): number {
  for (const r of draftData.byPickRange) {
    const [lo, hi] = r.picks.split("-").map(Number) as [number, number];
    if (pick >= lo && pick <= hi) return r.meanSeasonsStarted;
  }
  return draftData.byPickRange.at(-1)!.meanSeasonsStarted;
}

/**
 * A draft class looked back on: each pick's seasons started against what real picks at the same
 * slot started in as many seasons (their career average spread over the first
 * `DRAFT_DAY.retro.careerSeasons` seasons), with a label, and each team's grade for the class.
 */
export function draftHistoryView(
  league: League,
  viewer: Viewer,
  season?: number,
): DraftHistoryView {
  const R = DRAFT_DAY.retro;
  // Drafts held in this league (a generated league's back-story picks are made up), plus, for the
  // real league, the real drafts its players came from.
  const held = new Set([
    ...league.draftsHeld,
    ...league.transactions
      .filter((t) => t.type === "drafted")
      .map((t) => Number(t.date.slice(0, 4))),
  ]);
  const drafted = [...league.players, ...league.formerPlayers];
  const seasons = [...new Set(drafted.flatMap((p) => (p.drafted ? [p.drafted.season] : [])))]
    .filter((s) => league.meta.kind === "real" || held.has(s))
    .sort((a, b) => b - a);
  const chosen = season ?? seasons.find((s) => s < league.season) ?? seasons[0] ?? null;
  if (chosen === null)
    return { seasons, season: null, picks: [], teams: [], note: "No drafts yet." };
  // Seasons he could have played since the draft (this one counts once it has started).
  const played = Math.max(
    0,
    league.season -
      chosen +
      (["regular", "wildcard", "divisional", "conference", "championship", "complete"].includes(
        league.calendar.stage,
      )
        ? 1
        : 0),
  );
  // Players still in the league, and history cards for those long gone (Phase 13).
  const people = [
    ...league.players.map((p) => ({ p, card: null as FormerPlayer | null })),
    ...league.formerPlayers.map((c) => ({ p: null as Player | null, card: c })),
  ].filter((x) => (x.p ?? x.card)!.drafted?.season === chosen);
  const picks = people
    .sort((a, b) => (a.p ?? a.card)!.drafted!.pick - (b.p ?? b.card)!.drafted!.pick)
    .map(({ p, card }) => {
      const who = (p ?? card)!;
      const d = who.drafted!;
      const started = p ? seasonsStarted(p) : card!.seasonsStarted;
      const expected =
        Math.round(realCareerStarts(d.pick) * Math.min(1, played / R.careerSeasons) * 10) / 10;
      const history = p ? perceiveHistory(league, p, viewer) : [];
      const peak = p
        ? history.length
          ? Math.max(...history.map((h) => h.overall))
          : null
        : card!.peak;
      let grade: DraftHistoryView["picks"][number]["grade"];
      if (played < R.minSeasons) grade = "Too early";
      else if (d.round <= 2 && started === 0 && played >= R.bustSeasons) grade = "Bust";
      else if (started >= expected + R.stealMargin && d.pick > R.stealAfterPick) grade = "Steal";
      else if (started >= expected) grade = "Hit";
      else if (started >= expected - R.fairMargin) grade = "Fair";
      else grade = "Miss";
      const team = p?.teamId ? teamName(league, p.teamId) : null;
      return {
        overall: d.pick,
        round: d.round,
        teamId: d.teamId,
        player: { id: who.id, name: name(who), position: who.position },
        now:
          who.retiredAfter !== null
            ? `Retired after ${who.retiredAfter}`
            : team
              ? p!.teamId === d.teamId
                ? `With ${team}`
                : `Now with ${team}`
              : "Free agent",
        seasons: played,
        started,
        expected,
        peak,
        grade,
      };
    });
  // A team's grade: its picks' seasons started over (or under) the slot's expectation, on average.
  const byTeam = new Map<string, number[]>();
  for (const p of picks)
    byTeam.set(p.teamId, [...(byTeam.get(p.teamId) ?? []), p.started - p.expected]);
  const teams = [...byTeam.entries()]
    .map(([teamId, xs]) => {
      const score = Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 100) / 100;
      const grade =
        played < R.minSeasons ? "—" : (R.letters.find(([cut]) => score >= cut)?.[1] ?? "F");
      return { teamId, team: teamName(league, teamId), picks: xs.length, score, grade };
    })
    .sort((a, b) => b.score - a.score || a.teamId.localeCompare(b.teamId));
  return {
    seasons,
    season: chosen,
    picks,
    teams,
    note: `Graded on seasons started (at least half a season's snaps) against real picks at the same slot after ${played} season${played === 1 ? "" : "s"}. Peak is your staff's read of his best season-end overall.`,
  };
}
