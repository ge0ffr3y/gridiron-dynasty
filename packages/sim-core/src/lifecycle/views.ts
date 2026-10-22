/**
 * Screens for the player lifecycle (Phase 9b): the injury report and the
 * development report. Ratings go through the perception layer like every
 * other screen.
 */
import { ageOn, type Position } from "@fgm/foundation";
import type { League, Player } from "../league/schema";
import { perceiveChange, type Viewer } from "../perception";

export interface InjuryReportEntry {
  id: number;
  name: string;
  position: Position;
  /** Out, Doubtful, Questionable (sitting), or Questionable and expected to play through it. */
  status: "Out" | "Doubtful" | "Questionable";
  playingThrough: boolean;
  part: string;
  description: string;
  /** Games still to miss (0 when he's playing through a knock). */
  gamesRemaining: number;
  since: string;
}

export interface InjuryReportView {
  season: number;
  /** What the report is for, e.g. "Week 5" or "the preseason". */
  forWhat: string;
  teams: {
    teamId: string;
    name: string;
    entries: InjuryReportEntry[];
    /** Players on reserve lists (not on the report, as in the real one). */
    reserve: { injuredReserve: number; pup: number; nfi: number };
  }[];
  totals: { out: number; doubtful: number; questionable: number; reserve: number };
}

const STATUS_ORDER = { Out: 0, Doubtful: 1, Questionable: 2 };

function entryFor(p: Player): InjuryReportEntry | null {
  const name = `${p.firstName} ${p.lastName}`;
  if (p.injury)
    return {
      id: p.id,
      name,
      position: p.position,
      status: p.injury.status,
      playingThrough: false,
      part: p.injury.part,
      description: p.injury.description,
      gamesRemaining: p.injury.gamesRemaining,
      since: p.injury.since,
    };
  if (p.knock)
    return {
      id: p.id,
      name,
      position: p.position,
      status: "Questionable",
      playingThrough: true,
      part: p.knock.part,
      description: `${p.knock.part}: banged up, expected to play`,
      gamesRemaining: 0,
      since: p.knock.since,
    };
  return null;
}

/** This week's injury report: each team's listed players, or one team's. */
export function injuryReportView(league: League, teamId: string | null): InjuryReportView {
  const cal = league.calendar;
  const forWhat =
    cal.stage === "regular"
      ? `Week ${cal.week}`
      : cal.stage === "preseason" || cal.stage === "cutdown"
        ? "the preseason"
        : ["wildcard", "divisional", "conference", "championship"].includes(cal.stage)
          ? `the ${cal.stage} round`
          : "the offseason";
  const teams = league.teams
    .filter((t) => teamId === null || t.id === teamId)
    .map((t) => {
      const roster = league.players.filter((p) => p.teamId === t.id);
      const entries = roster
        .filter((p) => p.roster === "active")
        .map(entryFor)
        .filter((e): e is InjuryReportEntry => e !== null)
        .sort(
          (a, b) =>
            STATUS_ORDER[a.status] - STATUS_ORDER[b.status] ||
            Number(a.playingThrough) - Number(b.playingThrough) ||
            b.gamesRemaining - a.gamesRemaining ||
            a.id - b.id,
        );
      return {
        teamId: t.id,
        name: `${t.city} ${t.nickname}`,
        entries,
        reserve: {
          injuredReserve: roster.filter((p) => p.roster === "injured-reserve").length,
          pup: roster.filter((p) => p.roster === "pup").length,
          nfi: roster.filter((p) => p.roster === "nfi").length,
        },
      };
    });
  const all = teams.flatMap((t) => t.entries);
  return {
    season: league.season,
    forWhat,
    teams,
    totals: {
      out: all.filter((e) => e.status === "Out").length,
      doubtful: all.filter((e) => e.status === "Doubtful").length,
      questionable: all.filter((e) => e.status === "Questionable").length,
      reserve: teams.reduce(
        (a, t) => a + t.reserve.injuredReserve + t.reserve.pup + t.reserve.nfi,
        0,
      ),
    },
  };
}

export interface DevelopmentEntry {
  id: number;
  name: string;
  team: string | null;
  position: Position;
  age: number;
  before: number;
  after: number;
  change: number;
  reason: string;
}

export interface DevelopmentReportView {
  season: number;
  rounds: {
    stage: "league-year" | "camp" | "season";
    label: string;
    date: string;
    risers: DevelopmentEntry[];
    fallers: DevelopmentEntry[];
  }[];
}

const ROUND_LABELS = {
  "league-year": "The new League Year (most of the year's development)",
  camp: "Training camp",
  season: "During the season (small weekly changes, added up)",
} as const;

/** This season's development rounds: the biggest risers and fallers, each with the reason. */
export function developmentReportView(
  league: League,
  viewer: Viewer,
  limit = 25,
): DevelopmentReportView {
  const byId = new Map(league.players.map((p) => [p.id, p]));
  const order = ["league-year", "camp", "season"] as const;
  return {
    season: league.season,
    rounds: league.development
      .filter((r) => r.season === league.season)
      .sort((a, b) => order.indexOf(a.stage) - order.indexOf(b.stage))
      .map((r) => {
        const entries = r.changes
          .map((c) => {
            const p = byId.get(c.playerId)!;
            const seen = perceiveChange(league, p, viewer, c.before, c.after);
            return {
              id: p.id,
              name: `${p.firstName} ${p.lastName}`,
              team: p.teamId,
              position: p.position,
              age: ageOn(p.birthDate, r.date),
              before: seen.before,
              after: seen.after,
              change: seen.after - seen.before,
              reason: c.reason,
            };
          })
          .filter((e) => e.change !== 0);
        const by = (sign: 1 | -1) =>
          entries
            .filter((e) => Math.sign(e.change) === sign)
            .sort((a, b) => sign * (b.change - a.change) || a.id - b.id)
            .slice(0, limit);
        return {
          stage: r.stage,
          label: ROUND_LABELS[r.stage],
          date: r.date,
          risers: by(1),
          fallers: by(-1),
        };
      }),
  };
}
