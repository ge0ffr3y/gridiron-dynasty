/**
 * History screens (Phase 15): the almanac, season recaps, the record book, a franchise's history,
 * the newsfeed, and the coaching tree. They read the league's own seasons and, for the real
 * league, the real past imported at its start (`annals`, real award winners, records, the Hall).
 */
import type { Annal, League, NewsItem, RecordStat } from "../league/schema";
import { AWARD_KINDS, RECORD_STATS } from "../league/schema";
import { leadersView, type LeadersView } from "../peopleViews";
import { ROLE_NAMES } from "../coaches/config";
import { AWARD_LABELS } from "./awards";
import { latestNews, teamName } from "./news";
import { STAT_LABELS, tracksBook } from "./records";

const name = (p: { firstName: string; lastName: string }) => `${p.firstName} ${p.lastName}`;
const rec = (w: number, l: number, t: number) => `${w}-${l}${t ? `-${t}` : ""}`;

interface SeasonRow {
  season: number;
  championId: string | null;
  runnerUpId: string | null;
  score: string | null;
  best: { teamId: string; record: string } | null;
  /** From the real past (before the league began). */
  past: boolean;
}

/** The best winning share among a season's teams (from the real past). */
function bestOf(teams: Annal["teams"]): { teamId: string; record: string } | null {
  const share = (t: Annal["teams"][number]) =>
    (t.wins + t.ties / 2) / Math.max(1, t.wins + t.losses + t.ties);
  const best = [...teams].sort((x, y) => share(y) - share(x))[0];
  return best ? { teamId: best.teamId, record: rec(best.wins, best.losses, best.ties) } : null;
}

/** Every season we know, newest first: the league's own, then the real past. */
function seasonRows(league: League): SeasonRow[] {
  const own: SeasonRow[] = league.history.map((h) => {
    const final = h.playoffGames.find((g) => g.round === "championship");
    const best = [...h.standings].sort(
      (a, b) =>
        (b.wins + b.ties / 2) / Math.max(1, b.wins + b.losses + b.ties) -
          (a.wins + a.ties / 2) / Math.max(1, a.wins + a.losses + a.ties) ||
        b.pointsFor - b.pointsAgainst - (a.pointsFor - a.pointsAgainst),
    )[0];
    return {
      season: h.season,
      championId: h.championId,
      runnerUpId: h.runnerUpId,
      score: final
        ? `${Math.max(final.homeScore, final.awayScore)}-${Math.min(final.homeScore, final.awayScore)}`
        : null,
      best: best ? { teamId: best.teamId, record: rec(best.wins, best.losses, best.ties) } : null,
      past: false,
    };
  });
  const have = new Set(own.map((r) => r.season));
  const past: SeasonRow[] = league.annals
    .filter((a) => !have.has(a.season))
    .map((a) => ({
      season: a.season,
      championId: a.championId,
      runnerUpId: a.runnerUpId,
      score: a.final ? `${a.final[0]}-${a.final[1]}` : null,
      best: bestOf(a.teams),
      past: true,
    }));
  return [...own, ...past].sort((a, b) => b.season - a.season);
}

const teamRef = (league: League, id: string | null) =>
  id ? { id, name: teamName(league, id) } : null;

function winner(league: League, season: number, award: string) {
  const a = league.awards.find((x) => x.season === season && x.award === award && x.place === 1);
  return a
    ? { name: a.name, position: a.position, team: teamRef(league, a.teamId), playerId: a.playerId }
    : null;
}

// ---------------------------------------------------------------------------
// The almanac

export interface AlmanacView {
  seasons: {
    season: number;
    past: boolean;
    champion: { id: string; name: string } | null;
    runnerUp: { id: string; name: string } | null;
    score: string | null;
    mvp: {
      name: string;
      position: string;
      team: { id: string; name: string } | null;
      playerId: number | null;
    } | null;
    best: { team: { id: string; name: string }; record: string } | null;
  }[];
  /** Franchises by titles, with playoff trips and all-time record where known. */
  franchises: {
    teamId: string;
    name: string;
    titles: number;
    finals: number;
    playoffs: number;
    seasons: number;
    wins: number;
    losses: number;
    ties: number;
  }[];
  /** Dynasties (three titles in four years or more) and the longest droughts. */
  dynasties: { teamId: string; name: string; from: number; to: number; titles: number }[];
  droughts: { teamId: string; name: string; since: number | null; seasons: number }[];
  hallOfFame: {
    name: string;
    kind: string;
    position: string;
    inducted: number;
    teams: string[];
    reason: string;
    playerId: number | null;
  }[];
  firstSeason: number | null;
}

export function almanacView(league: League): AlmanacView {
  const rows = seasonRows(league);
  const franchises = new Map(
    league.teams.map((t) => [
      t.id,
      {
        teamId: t.id,
        name: teamName(league, t.id),
        titles: 0,
        finals: 0,
        playoffs: 0,
        seasons: 0,
        wins: 0,
        losses: 0,
        ties: 0,
      },
    ]),
  );
  for (const r of rows) {
    const c = r.championId ? franchises.get(r.championId) : null;
    if (c) c.titles += 1;
    const ru = r.runnerUpId ? franchises.get(r.runnerUpId) : null;
    if (ru) ru.finals += 1;
  }
  for (const a of league.annals) {
    if (league.history.some((h) => h.season === a.season)) continue;
    for (const t of a.teams) {
      const f = franchises.get(t.teamId);
      if (!f) continue;
      f.seasons += 1;
      f.wins += t.wins;
      f.losses += t.losses;
      f.ties += t.ties;
      if (t.playoffs) f.playoffs += 1;
    }
  }
  for (const h of league.history)
    for (const s of h.standings) {
      const f = franchises.get(s.teamId)!;
      f.seasons += 1;
      f.wins += s.wins;
      f.losses += s.losses;
      f.ties += s.ties;
      if (s.seed !== null) f.playoffs += 1;
    }
  // Dynasties: windows of four seasons with three or more titles by one team.
  const oldestFirst = [...rows].reverse();
  const dynasties: AlmanacView["dynasties"] = [];
  for (const t of league.teams) {
    let i = 0;
    while (i < oldestFirst.length) {
      const span = oldestFirst.slice(i, i + 4);
      const wins = span.filter((r) => r.championId === t.id);
      if (wins.length >= 3) {
        const last = wins[wins.length - 1]!.season;
        let j = i + 4;
        // extend while titles keep coming
        while (j < oldestFirst.length && oldestFirst[j]!.championId === t.id) j += 1;
        dynasties.push({
          teamId: t.id,
          name: teamName(league, t.id),
          from: wins[0]!.season,
          to: Math.max(last, oldestFirst[j - 1]!.season),
          titles: oldestFirst.slice(i, j).filter((r) => r.championId === t.id).length,
        });
        i = j;
      } else i += 1;
    }
  }
  // Droughts: seasons since a title (or since the record began).
  const last = rows[0]?.season ?? league.season;
  const droughts = league.teams
    .map((t) => {
      const won = rows.find((r) => r.championId === t.id);
      return {
        teamId: t.id,
        name: teamName(league, t.id),
        since: won?.season ?? null,
        seasons: won ? last - won.season : rows.length,
      };
    })
    .sort((a, b) => b.seasons - a.seasons || a.teamId.localeCompare(b.teamId))
    .slice(0, 6);
  return {
    seasons: rows.map((r) => ({
      season: r.season,
      past: r.past,
      champion: teamRef(league, r.championId),
      runnerUp: teamRef(league, r.runnerUpId),
      score: r.score,
      mvp: winner(league, r.season, "mvp"),
      best: r.best ? { team: teamRef(league, r.best.teamId)!, record: r.best.record } : null,
    })),
    franchises: [...franchises.values()].sort(
      (a, b) => b.titles - a.titles || b.finals - a.finals || a.teamId.localeCompare(b.teamId),
    ),
    dynasties: dynasties.sort((a, b) => a.from - b.from),
    droughts,
    hallOfFame: [...league.hallOfFame]
      .sort((a, b) => b.inducted - a.inducted || a.name.localeCompare(b.name))
      .map((h) => ({
        name: h.name,
        kind: h.kind,
        position: h.position,
        inducted: h.inducted,
        teams: h.teams.map((t) => teamName(league, t)),
        reason: h.reason,
        playerId: h.playerId,
      })),
    firstSeason: rows.at(-1)?.season ?? null,
  };
}

// ---------------------------------------------------------------------------
// A season's recap

export interface SeasonRecapView {
  season: number;
  seasons: number[];
  past: boolean;
  champion: { id: string; name: string } | null;
  runnerUp: { id: string; name: string } | null;
  score: string | null;
  standings: {
    teamId: string;
    name: string;
    record: string;
    pointsFor: number;
    pointsAgainst: number;
    seed: number | null;
    exit: string | null;
  }[];
  playoffs: { round: string; home: string; away: string; score: string; overtime: boolean }[];
  awards: {
    award: string;
    label: string;
    place: number;
    name: string;
    position: string;
    team: string;
    share: number | null;
    reason: string;
    playerId: number | null;
  }[];
  allPro: {
    team: "first" | "second";
    position: string;
    name: string;
    teamName: string;
    playerId: number | null;
  }[];
  leaders: LeadersView["categories"];
  recordsBroken: {
    level: string;
    stat: string;
    scope: string;
    value: number;
    name: string;
    previous: string;
  }[];
  news: NewsItem[];
}

export function seasonRecapView(league: League, season?: number): SeasonRecapView {
  const rows = seasonRows(league);
  const year = season ?? rows[0]?.season ?? league.season;
  const own = league.history.find((h) => h.season === year);
  const annal: Annal | undefined = league.annals.find((a) => a.season === year);
  const row = rows.find((r) => r.season === year);
  const awards = league.awards.filter((a) => a.season === year);
  return {
    season: year,
    seasons: rows.map((r) => r.season),
    past: !own,
    champion: teamRef(league, row?.championId ?? null),
    runnerUp: teamRef(league, row?.runnerUpId ?? null),
    score: row?.score ?? null,
    standings: own
      ? own.standings
          .map((s) => ({
            teamId: s.teamId,
            name: teamName(league, s.teamId),
            record: rec(s.wins, s.losses, s.ties),
            pointsFor: s.pointsFor,
            pointsAgainst: s.pointsAgainst,
            seed: s.seed,
            exit: s.exit,
          }))
          .sort((a, b) => (a.seed ?? 99) - (b.seed ?? 99) || a.name.localeCompare(b.name))
      : (annal?.teams ?? [])
          .map((t) => ({
            teamId: t.teamId,
            name: `${t.city}`,
            record: rec(t.wins, t.losses, t.ties),
            pointsFor: t.pointsFor,
            pointsAgainst: t.pointsAgainst,
            seed: null,
            exit: t.playoffs ? "playoffs" : null,
          }))
          .sort((a, b) => b.pointsFor - b.pointsAgainst - (a.pointsFor - a.pointsAgainst)),
    playoffs: (own?.playoffGames ?? []).map((g) => ({
      round: g.round,
      home: teamName(league, g.homeId),
      away: teamName(league, g.awayId),
      score: `${g.homeScore}-${g.awayScore}`,
      overtime: g.overtime,
    })),
    awards: awards
      .filter((a) => !["all-pro-1", "all-pro-2", "pro-bowl"].includes(a.award))
      .sort(
        (a, b) => AWARD_KINDS.indexOf(a.award) - AWARD_KINDS.indexOf(b.award) || a.place - b.place,
      )
      .map((a) => ({
        award: a.award,
        label: AWARD_LABELS[a.award],
        place: a.place,
        name: a.name,
        position: a.position,
        team: teamName(league, a.teamId),
        share: a.share,
        reason: a.reason,
        playerId: a.playerId,
      })),
    allPro: awards
      .filter((a) => a.award === "all-pro-1" || a.award === "all-pro-2")
      .map((a) => ({
        team: a.award === "all-pro-1" ? ("first" as const) : ("second" as const),
        position: a.position,
        name: a.name,
        teamName: teamName(league, a.teamId),
        playerId: a.playerId,
      })),
    leaders: own ? leadersView(league, year).categories : [],
    recordsBroken: league.records.flatMap((r) =>
      r.broken
        .filter((b) => b.season === year)
        .map((b) => ({
          level: r.level,
          stat: STAT_LABELS[r.stat],
          scope: r.scope === "league" ? "League" : teamName(league, r.scope),
          value: b.value,
          name: b.name,
          previous: `${b.previous.name} (${b.previous.value}${b.previous.season ? `, ${b.previous.season}` : ""})`,
        })),
    ),
    news: league.news.filter((n) => n.season === year && n.kind !== "injury").slice(-12),
  };
}

// ---------------------------------------------------------------------------
// The record book

export interface RecordsView {
  scope: string;
  scopes: { id: string; name: string }[];
  lists: {
    level: string;
    stat: RecordStat;
    label: string;
    top: {
      rank: number;
      value: number;
      name: string;
      team: string | null;
      season: number | null;
      real: boolean;
      playerId: number | null;
    }[];
    recentBreaks: { season: number; name: string; value: number; previous: string }[];
  }[];
}

export function recordsView(league: League, scope = "league"): RecordsView {
  const lists = league.records.filter((r) => r.scope === scope && r.top.length > 0);
  const order = (l: string) => ["game", "season", "career"].indexOf(l);
  return {
    scope,
    scopes: [
      { id: "league", name: "The league" },
      ...league.teams
        .filter((t) => tracksBook(league, t.id))
        .map((t) => ({ id: t.id, name: teamName(league, t.id) }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    ],
    lists: lists
      .sort(
        (a, b) =>
          order(a.level) - order(b.level) ||
          RECORD_STATS.indexOf(a.stat) - RECORD_STATS.indexOf(b.stat),
      )
      .map((l) => ({
        level: l.level,
        stat: l.stat,
        label: STAT_LABELS[l.stat],
        top: l.top.map((e, i) => ({
          rank: i + 1,
          value: e.value,
          name: e.name,
          team: e.teamId ? teamName(league, e.teamId) : null,
          season: e.season,
          real: e.real,
          playerId: e.playerId,
        })),
        recentBreaks: l.broken
          .slice(-3)
          .reverse()
          .map((b) => ({
            season: b.season,
            name: b.name,
            value: b.value,
            previous: `${b.previous.name} (${b.previous.value})`,
          })),
      })),
  };
}

// ---------------------------------------------------------------------------
// A franchise's history

export interface TeamHistoryView {
  teamId: string;
  name: string;
  titles: number;
  playoffTrips: number;
  seasons: {
    season: number;
    record: string;
    result: string;
    coach: string | null;
    past: boolean;
  }[];
  retiredNumbers: {
    number: number;
    name: string;
    season: number | null;
    playerId: number | null;
  }[];
  hallOfFamers: { name: string; position: string; inducted: number; playerId: number | null }[];
  records: { level: string; label: string; value: number; name: string; season: number | null }[];
  /** False when the club's real record book couldn't be imported (so none is kept). */
  recordsKept: boolean;
}

export function teamHistoryView(league: League, teamId: string): TeamHistoryView {
  const champions = new Map(seasonRows(league).map((r) => [r.season, r]));
  const seasons: TeamHistoryView["seasons"] = [];
  for (const h of league.history) {
    const s = h.standings.find((x) => x.teamId === teamId);
    if (!s) continue;
    const hc = league.coaches.flatMap((c) =>
      c.career
        .filter((l) => l.role === "HC" && l.teamId === teamId && l.season === h.season)
        .map(() => c),
    )[0];
    seasons.push({
      season: h.season,
      record: rec(s.wins, s.losses, s.ties),
      result:
        h.championId === teamId
          ? "Champions"
          : h.runnerUpId === teamId
            ? "Lost the final"
            : s.seed !== null
              ? "Playoffs"
              : "Missed the playoffs",
      coach: hc ? name(hc) : null,
      past: false,
    });
  }
  for (const a of league.annals) {
    if (league.history.some((h) => h.season === a.season)) continue;
    const t = a.teams.find((x) => x.teamId === teamId);
    if (!t) continue;
    const row = champions.get(a.season);
    seasons.push({
      season: a.season,
      record: rec(t.wins, t.losses, t.ties),
      result:
        row?.championId === teamId
          ? "Champions"
          : row?.runnerUpId === teamId
            ? "Lost the final"
            : t.playoffs
              ? "Playoffs"
              : "Missed the playoffs",
      coach: a.coaches[teamId] ?? null,
      past: true,
    });
  }
  seasons.sort((a, b) => b.season - a.season);
  return {
    teamId,
    name: teamName(league, teamId),
    titles: seasons.filter((s) => s.result === "Champions").length,
    playoffTrips: seasons.filter((s) => s.result !== "Missed the playoffs").length,
    seasons,
    retiredNumbers: league.retiredNumbers
      .filter((r) => r.teamId === teamId)
      .sort((a, b) => a.number - b.number)
      .map((r) => ({ number: r.number, name: r.name, season: r.season, playerId: r.playerId })),
    hallOfFamers: league.hallOfFame
      .filter((h) => h.kind === "player" && h.teams[0] === teamId)
      .sort((a, b) => a.inducted - b.inducted)
      .map((h) => ({
        name: h.name,
        position: h.position,
        inducted: h.inducted,
        playerId: h.playerId,
      })),
    recordsKept: tracksBook(league, teamId),
    records: league.records
      .filter((r) => r.scope === teamId && r.top[0])
      .map((r) => ({
        level: r.level,
        label: STAT_LABELS[r.stat],
        value: r.top[0]!.value,
        name: r.top[0]!.name,
        season: r.top[0]!.season,
      }))
      .sort(
        (a, b) =>
          ["game", "season", "career"].indexOf(a.level) -
          ["game", "season", "career"].indexOf(b.level),
      ),
  };
}

// ---------------------------------------------------------------------------
// The newsfeed

export interface NewsView {
  items: (NewsItem & { teamNames: string[] })[];
}

export function newsView(league: League, teamId?: string): NewsView {
  return {
    items: latestNews(league, teamId, 60).map((n) => ({
      ...n,
      teamNames: n.teamIds.map((t) => teamName(league, t)),
    })),
  };
}

// ---------------------------------------------------------------------------
// The coaching tree

export interface TreeNode {
  id: number;
  name: string;
  role: string;
  /** Where he is now, in words. */
  now: string;
  /** Seasons he was a head coach, and his wins there. */
  headSeasons: number;
  headWins: number;
  children: TreeNode[];
}

export function coachTreeView(league: League, coachId: number, depth = 3): TreeNode {
  const byId = new Map(league.coaches.map((c) => [c.id, c]));
  const kids = new Map<number, number[]>();
  for (const c of league.coaches)
    for (const e of c.career)
      if (e.underId !== null && e.underId !== c.id) {
        const list = kids.get(e.underId) ?? [];
        if (!list.includes(c.id)) list.push(c.id);
        kids.set(e.underId, list);
      }
  const build = (id: number, level: number, seen: Set<number>): TreeNode => {
    const c = byId.get(id)!;
    const hc = c.career.filter((l) => l.role === "HC");
    const children =
      level >= depth
        ? []
        : (kids.get(id) ?? [])
            .filter((k) => !seen.has(k))
            // Show the branches that grew: protégés who became head coaches or coordinators.
            .filter((k) => {
              const kc = byId.get(k)!;
              return kc.career.some((l) => l.role === "HC" || l.role === "OC" || l.role === "DC");
            })
            .sort((a, b) => byId.get(b)!.reputation - byId.get(a)!.reputation || a - b)
            .slice(0, 6)
            .map((k) => build(k, level + 1, new Set([...seen, id])));
    return {
      id,
      name: name(c),
      role: ROLE_NAMES[c.role],
      now:
        c.retiredAfter !== null
          ? "retired"
          : c.teamId
            ? `${ROLE_NAMES[c.role]}, ${c.teamId}`
            : "out of work",
      headSeasons: hc.length,
      headWins: hc.reduce((s, l) => s + (l.record?.wins ?? 0), 0),
      children,
    };
  };
  return build(coachId, 0, new Set());
}
