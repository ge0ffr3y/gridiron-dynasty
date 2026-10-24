/**
 * "Where things stand" (Phase 16): the screen a new league opens on. It reads the league as it
 * is on its first day: last season's champion, the draft order, who has cap room, the biggest
 * free agents-to-be, and the coaching and front-office changes the starting carousel made.
 */
import { ageOn, type Dollars } from "@fgm/foundation";
import { capSheet } from "./contracts/team";
import { marketValue } from "./contracts/market";
import { draftOrder } from "./draft/day";
import type { League } from "./league/schema";
import { readOverall, screenViewer } from "./perception";

const name = (p: { firstName: string; lastName: string }) => `${p.firstName} ${p.lastName}`;

function teamName(league: League, id: string | null): string {
  const t = league.teams.find((x) => x.id === id);
  return t ? `${t.city} ${t.nickname}` : (id ?? "");
}

export interface DayOneView {
  season: number;
  date: string;
  /** The season just played. */
  lastSeason: {
    season: number;
    champion: string | null;
    runnerUp: string | null;
    score: string | null;
  } | null;
  /** The top of the coming draft. */
  draft: { overall: number; teamId: string; team: string; note: string }[];
  /** The most and the least cap room. */
  capRoom: { most: CapRow[]; least: CapRow[] };
  /** Players whose deals ran out, best first. */
  freeAgents: {
    id: number;
    name: string;
    position: string;
    age: number;
    overall: number;
    teamId: string;
    team: string;
    market: Dollars;
  }[];
  /** Head-coaching changes made before the league began, then coordinators. */
  coaching: { teamId: string | null; text: string; reason: string; head: boolean }[];
  /** General managers fired or hired. */
  frontOffice: { teamId: string | null; text: string; reason: string }[];
  /** Head-coaching jobs still open. */
  openJobs: string[];
}

interface CapRow {
  teamId: string;
  team: string;
  room: Dollars;
}

export function dayOneView(league: League): DayOneView {
  const viewer = screenViewer(league);
  const last = league.history.at(-1) ?? null;
  const final = last?.playoffGames.find((g) => g.round === "championship");
  const rooms: CapRow[] = league.teams
    .map((t) => ({
      teamId: t.id,
      team: teamName(league, t.id),
      room: capSheet(league, t.id, league.season).room,
    }))
    .sort((a, b) => b.room - a.room || a.teamId.localeCompare(b.teamId));
  const pending = league.players
    .filter((p) => {
      if (p.teamId === null || p.retiredAfter !== null) return false;
      const years = p.contract?.years.filter((y) => !y.void) ?? [];
      return years.length === 0 || Math.max(...years.map((y) => y.season)) < league.season;
    })
    .map((p) => ({ p, market: marketValue(league, p).apy }))
    .sort((a, b) => b.market - a.market || a.p.id - b.p.id)
    .slice(0, 12);
  // The moves made in the starting carousel are the ones dated before the league's first day.
  const before = (m: { date: string }) => m.date < league.date;
  const coachMoves = league.coachingMoves.filter(
    (m) => before(m) && (m.kind === "fired" || m.kind === "hired" || m.kind === "interim"),
  );
  const heads = (m: { role: string }) => m.role === "HC";
  return {
    season: league.season,
    date: league.date,
    lastSeason: last
      ? {
          season: last.season,
          champion: last.championId ? teamName(league, last.championId) : null,
          runnerUp: last.runnerUpId ? teamName(league, last.runnerUpId) : null,
          score: final
            ? `${Math.max(final.homeScore, final.awayScore)}-${Math.min(final.homeScore, final.awayScore)}`
            : null,
        }
      : null,
    draft: draftOrder(league)
      .slice(0, 12)
      .map((p) => ({
        overall: p.overall!,
        teamId: p.ownerTeamId,
        team: teamName(league, p.ownerTeamId),
        note: [
          p.originalTeamId === p.ownerTeamId ? "" : `from ${teamName(league, p.originalTeamId)}`,
          p.compensatory ? "compensatory" : "",
        ]
          .filter(Boolean)
          .join(", "),
      })),
    capRoom: { most: rooms.slice(0, 6), least: rooms.slice(-6).reverse() },
    freeAgents: pending.map(({ p, market }) => ({
      id: p.id,
      name: name(p),
      position: p.position,
      age: ageOn(p.birthDate, league.date),
      overall: readOverall(league, p, viewer),
      teamId: p.teamId!,
      team: teamName(league, p.teamId),
      market,
    })),
    coaching: [...coachMoves.filter(heads), ...coachMoves.filter((m) => !heads(m))]
      .slice(0, 40)
      .map((m) => ({ teamId: m.teamId, text: m.text, reason: m.reason, head: heads(m) })),
    frontOffice: league.executiveMoves
      .filter((m) => before(m) && (m.kind === "fired" || m.kind === "hired"))
      .map((m) => ({ teamId: m.teamId, text: m.text, reason: m.reason })),
    openJobs: league.teams
      .filter(
        (t) => !league.coaches.some((c) => c.teamId === t.id && c.role === "HC" && !c.interim),
      )
      .map((t) => teamName(league, t.id)),
  };
}
