/**
 * A franchise's recent past for the people who judge it (Phase 15): the league's own seasons,
 * newest first, then the real seasons before the league began, but only the last ten of them.
 * Owners and the coaching carousel read droughts and losing runs through this, so a real team that
 * went a decade without the playoffs starts with an impatient owner, while the 1970s count for
 * nothing.
 */
import type { League } from "../league/schema";

/** Seasons of real history before the league began that still count with owners. */
export const PAST_YEARS_THAT_COUNT = 10;

export interface PastSeason {
  season: number;
  wins: number;
  losses: number;
  ties: number;
  playoffs: boolean;
}

export function recentSeasons(league: League, teamId: string): PastSeason[] {
  const out: PastSeason[] = [];
  for (let i = league.history.length - 1; i >= 0; i--) {
    const h = league.history[i]!;
    const s = h.standings.find((x) => x.teamId === teamId);
    if (!s) return out;
    out.push({
      season: h.season,
      wins: s.wins,
      losses: s.losses,
      ties: s.ties,
      playoffs: s.seed !== null,
    });
  }
  const first = league.history[0]?.season ?? league.season;
  for (let i = league.annals.length - 1; i >= 0; i--) {
    const a = league.annals[i]!;
    if (a.season >= first || a.season < first - PAST_YEARS_THAT_COUNT) continue;
    const t = a.teams.find((x) => x.teamId === teamId);
    if (!t) break;
    out.push({
      season: a.season,
      wins: t.wins,
      losses: t.losses,
      ties: t.ties,
      playoffs: t.playoffs,
    });
  }
  return out;
}
