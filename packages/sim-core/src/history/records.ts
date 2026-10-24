/**
 * The record book (Phase 15): league and franchise records for single games, single seasons and
 * careers (regular season, as in real record books). The real league starts with the real books
 * (renamed); a generated league starts empty and its first season sets the marks.
 *
 * After every game the game lists are checked; after every week, the season and career lists of
 * everyone who played. When a record changes hands, the book keeps the old holder and the
 * newsfeed reports it. Ties keep the earlier holder ahead.
 */
import type { BoxScore, StatLine } from "@fgm/game-engine";
import {
  RECORD_STATS,
  type Game,
  type League,
  type Player,
  type RecordEntry,
  type RecordLevel,
  type RecordList,
  type RecordStat,
} from "../league/schema";
import { addNews, newsWeek, teamName } from "./news";

/** Entries kept per list: the league's top ten, a franchise's top three. */
export const RECORDS = {
  keepLeague: 10,
  keepTeam: 3,
  /** Breaks of a franchise record make news once the record has stood this many seasons... */
  teamNewsAfterSeasons: 6,
  /** ...and the list is at least this many seasons old (a new league's first marks aren't news). */
  minBookSeasons: 3,
  /** Times a list remembers it changed hands. */
  keepBreaks: 8,
};

/** Career milestones worth a news item (judgment). */
const MILESTONES: Partial<Record<RecordStat, number[]>> = {
  passYds: [40000, 50000, 60000, 70000, 80000],
  passTd: [300, 400, 500, 600],
  rushYds: [10000, 12500, 15000, 17500],
  rushTd: [100, 125, 150],
  recYds: [10000, 12500, 15000, 17500, 20000],
  rec: [800, 1000, 1200, 1400],
  recTd: [100, 125, 150],
  sacks: [100, 125, 150, 175, 200],
  defInt: [50, 60],
};

export const STAT_LABELS: Record<RecordStat, string> = {
  passYds: "passing yards",
  passTd: "touchdown passes",
  rushYds: "rushing yards",
  rushTd: "rushing touchdowns",
  rec: "receptions",
  recYds: "receiving yards",
  recTd: "receiving touchdowns",
  sacks: "sacks",
  defInt: "interceptions",
  fgm: "field goals",
};

const LEVEL_LABEL: Record<RecordLevel, string> = {
  game: "single-game",
  season: "single-season",
  career: "career",
};

const name = (p: { firstName: string; lastName: string }) => `${p.firstName} ${p.lastName}`;
const fmt = (v: number) =>
  Number.isInteger(v) ? v.toLocaleString("en-US") : v.toFixed(1).replace(/\.0$/, "");

/** Franchises whose books are kept, per league object (null: all of them). */
const TRACKED = new WeakMap<League, Set<string> | null>();

/**
 * In a league built from the real one, only franchises whose real record book was imported keep
 * one: the others' modern-era numbers would stand in for all-time records they never held.
 */
export function tracksBook(league: League, teamId: string): boolean {
  let set = TRACKED.get(league);
  if (set === undefined) {
    set =
      league.meta.kind === "real"
        ? new Set(league.records.filter((r) => r.top.some((e) => e.real)).map((r) => r.scope))
        : null;
    TRACKED.set(league, set);
  }
  return set === null || teamId === "league" || set.has(teamId);
}

/** Lists by key, per league object (a thousand lists; looking one up must be quick). */
const INDEX = new WeakMap<RecordList[], Map<string, RecordList>>();

/** The list for one scope, level and stat (made empty if missing). */
export function recordList(
  league: League,
  scope: string,
  level: RecordLevel,
  stat: RecordStat,
): RecordList {
  let index = INDEX.get(league.records);
  if (!index || index.size !== league.records.length) {
    index = new Map(league.records.map((r) => [`${r.scope}|${r.level}|${r.stat}`, r]));
    INDEX.set(league.records, index);
  }
  const key = `${scope}|${level}|${stat}`;
  let list = index.get(key);
  if (!list) {
    list = { scope, level, stat, top: [], broken: [] };
    league.records.push(list);
    index.set(key, list);
  }
  return list;
}

/** Same holder, same performance (a game, a season, or a career). */
function sameEntry(level: RecordLevel, a: RecordEntry, b: RecordEntry): boolean {
  if (a.playerId === null || a.playerId !== b.playerId) return false;
  if (level === "career") return true;
  if (level === "season") return a.season === b.season;
  return a.date === b.date;
}

/**
 * Puts an entry in a list (or updates the same performance in progress) and keeps the best few.
 * Returns the old record if this entry just took it from someone else.
 */
function consider(league: League, list: RecordList, entry: RecordEntry): RecordEntry | null {
  const keep = list.scope === "league" ? RECORDS.keepLeague : RECORDS.keepTeam;
  const before = list.top[0] ?? null;
  const at = list.top.findIndex((e) => sameEntry(list.level, e, entry));
  if (at >= 0) {
    if (list.top[at]!.value >= entry.value) return null;
    list.top[at] = entry;
  } else {
    if (list.top.length >= keep && entry.value <= list.top[list.top.length - 1]!.value) return null;
    list.top.push(entry);
  }
  // Best first; a tie keeps the earlier mark ahead (it was there first).
  list.top.sort(
    (a, b) =>
      b.value - a.value ||
      (a.season ?? 0) - (b.season ?? 0) ||
      (a.date ?? "").localeCompare(b.date ?? "") ||
      (a.playerId ?? -1) - (b.playerId ?? -1),
  );
  list.top = list.top.slice(0, keep);
  const now = list.top[0]!;
  if (!before || sameEntry(list.level, before, now) || now.value <= before.value) return null;
  if (!sameEntry(list.level, now, entry)) return null;
  // A new book's first marks (a generated league's early seasons) are set, not broken.
  if (
    !before.real &&
    league.season - Math.min(...list.top.map((e) => e.season ?? league.season)) <
      RECORDS.minBookSeasons
  )
    return null;
  list.broken.push({
    date: league.date,
    season: league.season,
    value: now.value,
    name: now.name,
    playerId: now.playerId,
    previous: { value: before.value, name: before.name, season: before.season },
  });
  if (list.broken.length > RECORDS.keepBreaks) list.broken.shift();
  return before;
}

/** News for a record that changed hands (league records always; franchise ones when they're old). */
function recordNews(league: League, list: RecordList, p: Player, old: RecordEntry): void {
  const isLeague = list.scope === "league";
  if (!isLeague) {
    // A franchise's single-game marks fall too often to be news; its season and career marks
    // make news once they've stood a while.
    if (list.level === "game") return;
    const age = old.season === null ? 99 : league.season - old.season;
    if (age < RECORDS.teamNewsAfterSeasons && !old.real) return;
  }
  // A brand-new book (a generated league's first seasons) sets marks, it doesn't break them.
  const oldest = Math.min(...list.top.map((e) => e.season ?? league.season));
  if (!old.real && league.season - oldest < RECORDS.minBookSeasons) return;
  const what = `${LEVEL_LABEL[list.level]} ${STAT_LABELS[list.stat]}`;
  const where = isLeague ? "the league record" : `the ${teamName(league, list.scope)} record`;
  const value = list.top[0]!.value;
  addNews(league, {
    week: newsWeek(league),
    kind: "record",
    headline: `${name(p)} sets ${where} for ${what}`,
    text: `${name(p)} now has ${fmt(value)} ${STAT_LABELS[list.stat]}${list.level === "game" ? " in a game" : list.level === "season" ? " this season" : " in his career"}, past ${old.name}'s ${fmt(old.value)}${old.season ? ` (${old.season})` : ""}.`,
    teamIds: isLeague ? (p.teamId ? [p.teamId] : []) : [list.scope],
    playerIds: [p.id],
    link: "/records",
  });
}

function entryFor(
  p: Player,
  value: number,
  teamId: string | null,
  season: number,
  date: string | null,
): RecordEntry {
  return { value, playerId: p.id, name: name(p), teamId, season, date, real: false };
}

/** After a regular-season game: single-game marks, league and both franchises. */
export function gameRecords(
  league: League,
  game: Game,
  box: BoxScore,
  players: Map<number, Player>,
): void {
  for (const e of box.players) {
    const p = players.get(e.id);
    if (!p) continue;
    const teamId = e.side === "home" ? game.homeId : game.awayId;
    for (const stat of RECORD_STATS) {
      const v = e.line[stat];
      if (!v || v <= 0) continue;
      const entry = entryFor(p, v, teamId, league.season, game.date);
      for (const scope of ["league", teamId]) {
        if (!tracksBook(league, scope)) continue;
        const list = recordList(league, scope, "game", stat);
        const old = consider(league, list, entry);
        if (old) recordNews(league, list, p, old);
      }
    }
  }
}

type Totals = Record<RecordStat, number>;

/** The record stats summed over some seasons' lines (one pass). */
function totals(stats: { line: StatLine }[]): Totals {
  const t = Object.fromEntries(RECORD_STATS.map((k) => [k, 0])) as Totals;
  for (const s of stats) for (const k of RECORD_STATS) t[k] += s.line[k] ?? 0;
  for (const k of RECORD_STATS) t[k] = Math.round(t[k] * 10) / 10;
  return t;
}

/**
 * After a week (or a season's end): season and career marks for these players, league and
 * franchise (a franchise counts only what he did there). Career milestones make news.
 */
export function seasonAndCareerRecords(league: League, players: Player[]): void {
  for (const p of players) {
    const thisSeason = p.stats.filter((s) => s.season === league.season);
    if (thisSeason.length === 0) continue;
    const season = totals(thisSeason);
    const before = totals(p.stats.filter((s) => s.season < league.season));
    const career = totals(p.stats);
    const teams = [...new Set(p.stats.map((s) => s.teamId))];
    // Per franchise: what he did there this season and in all his seasons there.
    const here = teams.map((t) => ({
      t,
      season: totals(thisSeason.filter((s) => s.teamId === t)),
      career: totals(p.stats.filter((s) => s.teamId === t)),
      played: thisSeason.some((s) => s.teamId === t),
    }));
    const team = p.teamId ?? thisSeason.at(-1)!.teamId;
    for (const stat of RECORD_STATS) {
      if (season[stat] <= 0) continue;
      const checks: [string, RecordLevel, number, string | null][] = [
        ["league", "season", season[stat], team],
        ["league", "career", career[stat], team],
      ];
      for (const h of here) {
        if (h.season[stat] > 0) checks.push([h.t, "season", h.season[stat], h.t]);
        if (h.played) checks.push([h.t, "career", h.career[stat], h.t]);
      }
      for (const [scope, level, value, teamId] of checks) {
        if (!tracksBook(league, scope)) continue;
        const list = recordList(league, scope, level, stat);
        const old = consider(league, list, entryFor(p, value, teamId, league.season, null));
        if (old) recordNews(league, list, p, old);
      }
      milestone(league, p, stat, before[stat], career[stat]);
    }
  }
}

/** A career total crossing a round number makes news (once: the week he crosses it). */
function milestone(league: League, p: Player, stat: RecordStat, before: number, now: number): void {
  const marks = MILESTONES[stat];
  if (!marks) return;
  // Checked against his total before this season; the news log keeps it to once.
  for (const m of marks) {
    if (before >= m || now < m) continue;
    const said = league.news.some(
      (n) => n.kind === "milestone" && n.playerIds[0] === p.id && n.headline.includes(fmt(m)),
    );
    if (said) continue;
    addNews(league, {
      week: newsWeek(league),
      kind: "milestone",
      headline: `${name(p)} passes ${fmt(m)} career ${STAT_LABELS[stat]}`,
      text: `${name(p)} (${p.position}) has ${fmt(now)} ${STAT_LABELS[stat]} in his career.`,
      teamIds: p.teamId ? [p.teamId] : [],
      playerIds: [p.id],
      link: `/player/${p.id}`,
    });
  }
}

/** A record list's view rows. */
export function recordRows(list: RecordList) {
  return list.top.map((e, i) => ({ rank: i + 1, ...e }));
}
