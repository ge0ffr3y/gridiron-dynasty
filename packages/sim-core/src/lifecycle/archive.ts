/**
 * Long-gone players (Phase 13). Retired players stay in the player list for four seasons (their
 * last games are still recent history), and so do free agents nobody has signed. After that they
 * move to `league.formerPlayers` as short cards: name, position, college, draft, seasons, teams,
 * seasons started, peak and career totals. A century of history then costs a few hundred cards a
 * year instead of full players that every step of the sim would have to look past.
 */
import { honorsOf, type Honors } from "../history/honors";
import { ageOn } from "@fgm/foundation";
import type { FormerPlayer, League, Player } from "../league/schema";
import { perceiveHistory } from "../perception";
import { seasonsStarted } from "../scouting/report";
import { sumLines } from "../views";

export const ARCHIVE = {
  /** Seasons after he last played (or retired) before a player becomes a history card. */
  afterSeasons: 4,
} as const;

/** The last season a player was on a team (or retired), or null if never. */
function lastActive(p: Player): number | null {
  let last: number | null = p.retiredAfter;
  for (const h of p.ratingHistory)
    if (h.teamId !== null) last = Math.max(last ?? h.season, h.season);
  for (const s of p.stats) last = Math.max(last ?? s.season, s.season);
  if (p.drafted) last = Math.max(last ?? p.drafted.season, p.drafted.season);
  return last;
}

/** Championships won by the teams he played for, in the seasons he played for them. */
export function titlesOf(league: League, p: Player): number {
  const champs = new Map(league.history.map((h) => [h.season, h.championId]));
  for (const a of league.annals) if (a.championId) champs.set(a.season, a.championId);
  const won = new Set<number>();
  for (const s of p.stats) if (champs.get(s.season) === s.teamId) won.add(s.season);
  return won.size;
}

/** A player's history card. */
export function formerPlayerCard(league: League, p: Player): FormerPlayer {
  const history = perceiveHistory(league, p, { kind: "league" });
  const teams: string[] = [];
  for (const s of p.stats) if (!teams.includes(s.teamId)) teams.push(s.teamId);
  const first = p.ratingHistory[0]?.season ?? p.drafted?.season ?? league.season;
  const last = p.ratingHistory.at(-1);
  return {
    id: p.id,
    firstName: p.firstName,
    lastName: p.lastName,
    position: p.position,
    college: p.college,
    birthDate: p.birthDate,
    drafted: p.drafted,
    experience: p.experience,
    retiredAfter: p.retiredAfter,
    firstSeason: first,
    lastSeason: last?.season ?? lastActive(p) ?? first,
    lastAge: last?.age ?? ageOn(p.birthDate, league.date),
    teams,
    seasonsStarted: seasonsStarted(p),
    peak: history.length ? Math.max(...history.map((h) => h.overall)) : 0,
    career: sumLines(p.stats.map((s) => s.line)),
    number: p.jersey,
    legend: false,
    titles: titlesOf(league, p),
  };
}

/**
 * At a season's end: players retired, or free agents unsigned, for `afterSeasons` seasons or more
 * become history cards. Returns how many moved.
 */
export function archivePlayers(league: League, endedSeason: number): number {
  const cutoff = endedSeason - ARCHIVE.afterSeasons;
  const keep: Player[] = [];
  let moved = 0;
  for (const p of league.players) {
    const gone =
      p.teamId === null &&
      p.contract === null &&
      (p.retiredAfter !== null
        ? p.retiredAfter <= cutoff
        : (lastActive(p) ?? endedSeason) <= cutoff);
    if (gone) {
      league.formerPlayers.push(formerPlayerCard(league, p));
      moved += 1;
    } else keep.push(p);
  }
  league.players = keep;
  return moved;
}

/** A former player's card by id (or null). */
export function formerPlayer(league: League, id: number): FormerPlayer | null {
  return league.formerPlayers.find((f) => f.id === id) ?? null;
}

export interface FormerPlayerView {
  id: number;
  name: string;
  position: string;
  college: string;
  birthDate: string;
  drafted: FormerPlayer["drafted"];
  years: string;
  retiredAfter: number | null;
  teams: string[];
  seasonsStarted: number;
  peak: number;
  career: FormerPlayer["career"];
  honors: Honors;
  /** Imported from the real league's past (a legend). */
  legend: boolean;
}

/** A long-gone player's page: his history card. */
export function formerPlayerView(league: League, id: number): FormerPlayerView {
  const c = formerPlayer(league, id);
  if (!c) throw new Error(`no player ${id}`);
  return {
    id: c.id,
    name: `${c.firstName} ${c.lastName}`,
    position: c.position,
    college: c.college,
    birthDate: c.birthDate,
    drafted: c.drafted,
    honors: honorsOf(league, c.id),
    legend: c.legend,
    years: c.firstSeason === c.lastSeason ? `${c.firstSeason}` : `${c.firstSeason}-${c.lastSeason}`,
    retiredAfter: c.retiredAfter,
    teams: c.teams,
    seasonsStarted: c.seasonsStarted,
    peak: c.peak,
    career: c.career,
  };
}
