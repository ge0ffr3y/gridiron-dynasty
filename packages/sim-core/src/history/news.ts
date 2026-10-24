/**
 * The newsfeed (Phase 15): short storylines from what actually happened in the league. Items come
 * from the league's own logs (trades, signings, coaching and front-office moves), from the record
 * book, the awards and the Hall of Fame, and from a weekly look at races, streaks, hot seats and
 * big injuries. Plain text, each with a link; no random draws (screens never change the future).
 */
import type { League, NewsItem } from "../league/schema";
import { seasonDates } from "../season/calendar";

/** Seasons of news kept (this one and last). */
const KEEP_SEASONS = 2;

export function addNews(
  league: League,
  item: Omit<NewsItem, "id" | "date" | "season"> & {
    date?: string;
  },
): NewsItem {
  const n: NewsItem = {
    id: league.nextIds.news++,
    date: item.date ?? league.date,
    season: league.season,
    week: item.week,
    kind: item.kind,
    headline: item.headline,
    text: item.text,
    teamIds: item.teamIds,
    playerIds: item.playerIds,
    link: item.link,
  };
  league.news.push(n);
  return n;
}

/** Drops news older than last season (at each new season). */
export function pruneNews(league: League): void {
  league.news = league.news.filter((n) => n.season > league.season - KEEP_SEASONS);
}

export const teamName = (league: League, id: string | null) => {
  if (!id) return "";
  const t = league.teams.find((x) => x.id === id);
  return t ? `${t.city} ${t.nickname}` : id;
};

/** The current regular-season week, or null outside the season. */
export function newsWeek(league: League): number | null {
  return league.calendar.stage === "regular" ? league.calendar.week : null;
}

/** The newest items first (optionally one team's). */
export function latestNews(league: League, teamId?: string, limit = 60): NewsItem[] {
  return league.news
    .filter((n) => !teamId || n.teamIds.includes(teamId))
    .slice(-limit * 3)
    .reverse()
    .slice(0, limit);
}

/** Is the date inside this season's League Year (for once-a-year items)? */
export function sinceLeagueYear(league: League, date: string): boolean {
  return date >= seasonDates(league.rules, league.season).leagueYear;
}
