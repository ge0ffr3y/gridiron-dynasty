/**
 * Screen data for the season: calendar, schedule, standings, playoffs, history.
 */
import type { Game, League, PlayoffRound, Team } from "../league/schema";
import { PLAYOFF_ROUNDS } from "../league/schema";
import { availableActions, type SimAction } from "./actions";
import { personTeam } from "../career/delegation";
import { stageLabel } from "./calendar";
import { canPlayNow, currentStandings, isPlaying } from "./flow";
import { formatWLT, pctOf } from "./standings";

export interface TeamTag {
  id: string;
  city: string;
  nickname: string;
  abbreviation: string;
  colors: { primary: string; secondary: string };
}

function tag(league: League, id: string): TeamTag {
  const t = league.teams.find((x) => x.id === id) as Team;
  return {
    id: t.id,
    city: t.city,
    nickname: t.nickname,
    abbreviation: t.abbreviation,
    colors: t.colors,
  };
}

export interface CalendarView {
  season: number;
  stage: League["calendar"]["stage"];
  label: string;
  date: string;
  actions: SimAction[];
  /** GM Mode: open decisions in your inbox and how many are due now; null in Simulation Mode. */
  inbox: { open: number; due: number } | null;
}

export function calendarView(league: League): CalendarView {
  return {
    season: league.season,
    stage: league.calendar.stage,
    label: stageLabel(league.calendar.stage, league.calendar.week),
    date: league.date,
    actions: availableActions(league),
    inbox: inboxCounts(league),
  };
}

/** GM Mode: open decisions in the person's inbox, and how many are due now (Phase 14). */
function inboxCounts(league: League): { open: number; due: number } | null {
  const team = personTeam(league);
  if (!team) return null;
  const mine = league.pendingDecisions.filter((d) => d.teamId === team);
  return {
    open: mine.length,
    due: mine.filter((d) => d.deadline != null && d.deadline <= league.date).length,
  };
}

export interface GameSummary {
  id: number;
  round: Game["round"];
  week: number;
  date: string;
  home: TeamTag;
  away: TeamTag;
  neutral: boolean;
  homeScore: number | null;
  awayScore: number | null;
  overtime: boolean;
  /** Up next and not played yet, so it can be played (and watched) right away. */
  playable: boolean;
}

function gameSummary(league: League, g: Game): GameSummary {
  return {
    id: g.id,
    round: g.round,
    week: g.week,
    date: g.date,
    home: tag(league, g.homeId),
    away: tag(league, g.awayId),
    neutral: g.neutral,
    homeScore: g.result?.homeScore ?? null,
    awayScore: g.result?.awayScore ?? null,
    overtime: g.result?.overtime ?? false,
    playable: canPlayNow(league, g),
  };
}

export type ScheduleSelection =
  { kind: "week"; week: number } | { kind: "round"; round: PlayoffRound };

export interface ScheduleView {
  season: number;
  selection: ScheduleSelection;
  weeks: number[];
  /** Playoff rounds that have games so far. */
  rounds: PlayoffRound[];
  games: GameSummary[];
  byes: TeamTag[];
}

/** The week or round to show by default: what's being played now (or just was). */
export function defaultSelection(league: League): ScheduleSelection {
  const { stage, week } = league.calendar;
  if (stage === "regular") return { kind: "week", week };
  if (stage === "complete") return { kind: "round", round: "championship" };
  if (
    stage === "wildcard" ||
    stage === "divisional" ||
    stage === "conference" ||
    stage === "championship"
  )
    return { kind: "round", round: stage };
  // Before the season: Week 1.
  return { kind: "week", week: 1 };
}

export function scheduleView(league: League, selection?: ScheduleSelection): ScheduleView {
  const sel = selection ?? defaultSelection(league);
  const games =
    sel.kind === "week"
      ? league.games.filter((g) => g.round === "regular" && g.week === sel.week)
      : league.games.filter((g) => g.round === sel.round);
  const playing = new Set(games.flatMap((g) => [g.homeId, g.awayId]));
  return {
    season: league.season,
    selection: sel,
    weeks: Array.from({ length: league.rules.schedule.regularSeasonWeeks }, (_, i) => i + 1),
    rounds: PLAYOFF_ROUNDS.filter((r) => league.games.some((g) => g.round === r)),
    games: games.map((g) => gameSummary(league, g)),
    byes:
      sel.kind === "week"
        ? league.teams.filter((t) => !playing.has(t.id)).map((t) => tag(league, t.id))
        : [],
  };
}

export interface StandingRow {
  team: TeamTag;
  record: string;
  wins: number;
  losses: number;
  ties: number;
  pct: string;
  pointsFor: number;
  pointsAgainst: number;
  net: number;
  home: string;
  away: string;
  division: string;
  conference: string;
  streak: string;
  divisionRank: number;
  seed: number | null;
}

export interface StandingsView {
  season: number;
  /** "After Week 6", "Final", "Before the season". */
  asOf: string;
  divisions: { conference: string; division: string; rows: StandingRow[] }[];
  conferences: { id: string; name: string; rows: StandingRow[]; playoffTeams: number }[];
  league: StandingRow[];
  notes: string[];
}

function formatPct(pct: number): string {
  return pct === 1 ? "1.000" : pct.toFixed(3).replace(/^0/, "");
}

export function standingsView(league: League): StandingsView {
  const s = currentStandings(league);
  const t = s.table;
  const row = (id: string): StandingRow => {
    const r = t.record(id);
    const pf = t.pointsFor(id);
    const pa = t.pointsAgainst(id);
    return {
      team: tag(league, id),
      record: formatWLT(r),
      ...r,
      pct: formatPct(pctOf(r)),
      pointsFor: pf,
      pointsAgainst: pa,
      net: pf - pa,
      home: formatWLT(t.record(id, (p) => p.home)),
      away: formatWLT(t.record(id, (p) => !p.home)),
      division: formatWLT(t.record(id, t.isDivisionGame(id))),
      conference: formatWLT(t.record(id, t.isConferenceGame(id))),
      streak: t.streak(id),
      divisionRank: s.divisionRank.get(id) as number,
      seed: s.seed.get(id) ?? null,
    };
  };
  const played = league.games.filter((g) => g.round === "regular" && g.result).length;
  const { stage, week } = league.calendar;
  const asOf =
    played === 0
      ? "Before the season"
      : stage === "regular"
        ? `After Week ${week - 1}`
        : "Final regular-season standings";
  const conferenceRows = league.rules.structure.conferences.flatMap((c) =>
    (s.conferenceOrder.get(c.id) as string[]).map(row),
  );
  return {
    season: league.season,
    asOf,
    divisions: league.rules.structure.conferences.flatMap((c) =>
      c.divisions.map((d) => ({
        conference: c.name,
        division: d.name,
        rows: (s.divisionOrder.get(d.id) as string[]).map(row),
      })),
    ),
    conferences: league.rules.structure.conferences.map((c) => ({
      id: c.id,
      name: c.name,
      rows: (s.conferenceOrder.get(c.id) as string[]).map(row),
      playoffTeams: league.rules.playoffs.teamsPerConference,
    })),
    league: [...conferenceRows].sort((a, b) => pctOf(b) - pctOf(a) || b.net - a.net),
    notes: played === 0 ? [] : s.notes,
  };
}

export interface PlayoffsView {
  season: number;
  /** True once the regular season is over (seeds are final). */
  seedsFinal: boolean;
  started: boolean;
  conferences: {
    id: string;
    name: string;
    seeds: { seed: number; team: TeamTag; record: string; divisionWinner: boolean }[];
    /** The next few teams outside the playoff spots. */
    hunt: { team: TeamTag; record: string }[];
  }[];
  rounds: { round: PlayoffRound; games: GameSummary[] }[];
  champion: TeamTag | null;
}

export function playoffsView(league: League): PlayoffsView {
  const s = currentStandings(league);
  const stage = league.calendar.stage;
  // Seeds are settled once the regular season is over (the playoffs, or the season complete).
  const seedsFinal =
    stage === "wildcard" ||
    stage === "divisional" ||
    stage === "conference" ||
    stage === "championship" ||
    stage === "complete";
  const record = (id: string) => formatWLT(s.table.record(id));
  const final = league.games.find((g) => g.round === "championship" && g.result);
  const winner = final
    ? final.result!.homeScore > final.result!.awayScore
      ? final.homeId
      : final.awayId
    : null;
  return {
    season: league.season,
    seedsFinal,
    started: seedsFinal,
    conferences: league.rules.structure.conferences.map((c) => {
      const order = s.conferenceOrder.get(c.id) as string[];
      const n = league.rules.playoffs.teamsPerConference;
      return {
        id: c.id,
        name: c.name,
        seeds: order.slice(0, n).map((id, i) => ({
          seed: i + 1,
          team: tag(league, id),
          record: record(id),
          divisionWinner: s.divisionRank.get(id) === 1,
        })),
        hunt: order.slice(n, n + 3).map((id) => ({ team: tag(league, id), record: record(id) })),
      };
    }),
    rounds: PLAYOFF_ROUNDS.map((round) => ({
      round,
      games: league.games.filter((g) => g.round === round).map((g) => gameSummary(league, g)),
    })).filter((r) => r.games.length > 0),
    champion: winner && stage === "complete" ? tag(league, winner) : null,
  };
}

export interface HistoryView {
  seasons: {
    season: number;
    champion: TeamTag;
    runnerUp: TeamTag;
    score: string;
    overtime: boolean;
    bestRecord: { team: TeamTag; record: string };
  }[];
}

export function historyView(league: League): HistoryView {
  return {
    seasons: [...league.history].reverse().map((h) => {
      const final = h.playoffGames.find((g) => g.round === "championship");
      const hi = final ? Math.max(final.homeScore, final.awayScore) : 0;
      const lo = final ? Math.min(final.homeScore, final.awayScore) : 0;
      const best = [...h.standings].sort(
        (a, b) =>
          pctOf(b) - pctOf(a) || b.pointsFor - b.pointsAgainst - (a.pointsFor - a.pointsAgainst),
      )[0]!;
      return {
        season: h.season,
        champion: tag(league, h.championId),
        runnerUp: tag(league, h.runnerUpId),
        score: `${hi}-${lo}`,
        overtime: final?.overtime ?? false,
        bestRecord: { team: tag(league, best.teamId), record: formatWLT(best) },
      };
    }),
  };
}

export { isPlaying };
