/**
 * Season records and every number the tiebreakers need, computed from the
 * played regular-season games. A tie game counts as half a win and half a loss.
 */
import type { Game, Team } from "../league/schema";

export interface WLT {
  wins: number;
  losses: number;
  ties: number;
}

export function pctOf(r: WLT): number {
  const games = r.wins + r.losses + r.ties;
  // One division per value, so equal records always give exactly equal numbers.
  return games === 0 ? 0 : (2 * r.wins + r.ties) / (2 * games);
}

export function formatWLT(r: WLT): string {
  return r.ties > 0 ? `${r.wins}-${r.losses}-${r.ties}` : `${r.wins}-${r.losses}`;
}

interface Played {
  opponent: string;
  pointsFor: number;
  pointsAgainst: number;
  tdFor: number;
  tdAgainst: number;
  home: boolean;
  week: number;
}

export class SeasonTable {
  readonly teams: Team[];
  private readonly byTeam = new Map<string, Played[]>();
  private readonly team = new Map<string, Team>();
  private readonly rankCache = new Map<string, Map<string, number>>();

  constructor(teams: Team[], games: Game[]) {
    this.teams = teams;
    for (const t of teams) {
      this.byTeam.set(t.id, []);
      this.team.set(t.id, t);
    }
    for (const g of games) {
      if (g.round !== "regular" || !g.result) continue;
      const r = g.result;
      this.byTeam.get(g.homeId)?.push({
        opponent: g.awayId,
        pointsFor: r.homeScore,
        pointsAgainst: r.awayScore,
        tdFor: r.homeTouchdowns,
        tdAgainst: r.awayTouchdowns,
        home: true,
        week: g.week,
      });
      this.byTeam.get(g.awayId)?.push({
        opponent: g.homeId,
        pointsFor: r.awayScore,
        pointsAgainst: r.homeScore,
        tdFor: r.awayTouchdowns,
        tdAgainst: r.homeTouchdowns,
        home: false,
        week: g.week,
      });
    }
  }

  teamOf(id: string): Team {
    const t = this.team.get(id);
    if (!t) throw new Error(`no team ${id}`);
    return t;
  }

  games(id: string): Played[] {
    return this.byTeam.get(id) ?? [];
  }

  /** Record in the team's games that pass the filter. */
  record(id: string, include: (p: Played) => boolean = () => true): WLT {
    const r = { wins: 0, losses: 0, ties: 0 };
    for (const p of this.games(id)) {
      if (!include(p)) continue;
      if (p.pointsFor > p.pointsAgainst) r.wins++;
      else if (p.pointsFor < p.pointsAgainst) r.losses++;
      else r.ties++;
    }
    return r;
  }

  pct(id: string, include?: (p: Played) => boolean): number {
    return pctOf(this.record(id, include));
  }

  count(id: string, include: (p: Played) => boolean): number {
    return this.games(id).filter(include).length;
  }

  netPoints(id: string, include: (p: Played) => boolean = () => true): number {
    return this.games(id).reduce(
      (sum, p) => (include(p) ? sum + p.pointsFor - p.pointsAgainst : sum),
      0,
    );
  }

  netTouchdowns(id: string): number {
    return this.games(id).reduce((sum, p) => sum + p.tdFor - p.tdAgainst, 0);
  }

  pointsFor(id: string): number {
    return this.games(id).reduce((sum, p) => sum + p.pointsFor, 0);
  }

  pointsAgainst(id: string): number {
    return this.games(id).reduce((sum, p) => sum + p.pointsAgainst, 0);
  }

  isDivisionGame = (id: string) => (p: Played) =>
    this.teamOf(p.opponent).divisionId === this.teamOf(id).divisionId;
  isConferenceGame = (id: string) => (p: Played) =>
    this.teamOf(p.opponent).conferenceId === this.teamOf(id).conferenceId;

  /** Opponents every team in the group has played, not counting the group itself. */
  commonOpponents(group: string[]): Set<string> {
    const sets = group.map((id) => new Set(this.games(id).map((p) => p.opponent)));
    const common = new Set<string>();
    for (const opponent of sets[0] ?? []) {
      if (!group.includes(opponent) && sets.every((s) => s.has(opponent))) common.add(opponent);
    }
    return common;
  }

  /** Combined record of the teams this team beat (strength of victory). */
  strengthOfVictory(id: string): number {
    const total = { wins: 0, losses: 0, ties: 0 };
    for (const p of this.games(id)) {
      if (p.pointsFor <= p.pointsAgainst) continue;
      const r = this.record(p.opponent);
      total.wins += r.wins;
      total.losses += r.losses;
      total.ties += r.ties;
    }
    return pctOf(total);
  }

  /** Combined record of every opponent, once per game played against them (strength of schedule). */
  strengthOfSchedule(id: string): number {
    const total = { wins: 0, losses: 0, ties: 0 };
    for (const p of this.games(id)) {
      const r = this.record(p.opponent);
      total.wins += r.wins;
      total.losses += r.losses;
      total.ties += r.ties;
    }
    return pctOf(total);
  }

  /**
   * Rank in points scored plus rank in points allowed, among the conference or
   * the whole league (lower is better). Tied teams share the better rank.
   */
  combinedRank(id: string, scope: "conference" | "league"): number {
    const key = scope === "league" ? "league" : this.teamOf(id).conferenceId;
    let ranks = this.rankCache.get(key);
    if (!ranks) {
      const group = this.teams
        .filter((t) => scope === "league" || t.conferenceId === key)
        .map((t) => t.id);
      const rank = (value: (t: string) => number, higherIsBetter: boolean) => {
        const out = new Map<string, number>();
        for (const t of group) {
          const v = value(t);
          out.set(
            t,
            1 + group.filter((o) => (higherIsBetter ? value(o) > v : value(o) < v)).length,
          );
        }
        return out;
      };
      const scored = rank((t) => this.pointsFor(t), true);
      const allowed = rank((t) => this.pointsAgainst(t), false);
      ranks = new Map(
        group.map((t) => [t, (scored.get(t) as number) + (allowed.get(t) as number)]),
      );
      this.rankCache.set(key, ranks);
    }
    return ranks.get(id) as number;
  }

  /** Current streak, e.g. "W3" or "L1". */
  streak(id: string): string {
    const games = [...this.games(id)].sort((a, b) => b.week - a.week);
    const first = games[0];
    if (!first) return "";
    const result = (p: Played) =>
      p.pointsFor > p.pointsAgainst ? "W" : p.pointsFor < p.pointsAgainst ? "L" : "T";
    const kind = result(first);
    let n = 0;
    for (const p of games) {
      if (result(p) !== kind) break;
      n++;
    }
    return `${kind}${n}`;
  }
}
