/**
 * The official NFL tie-breaking procedures (nfl.com/standings/tie-breaking-procedures).
 *
 * Rules that shape the code:
 * - Only one club advances per pass. The clubs still tied go back to step 1.
 * - If a step leaves some clubs behind but more than one ahead, the ones
 *   ahead restart at step 1 of the two-club or three-plus-club format.
 * - Wild cards: clubs from the same division use the division procedure;
 *   with three or more, only the best-placed club of each division stays in.
 * - Coin tosses are a fixed hash of the league seed, season, and clubs, so
 *   looking at the standings never uses up random numbers.
 */
import { fingerprint } from "../serialize";
import { SeasonTable } from "./standings";

export type TieKind = "division" | "wildcard" | "interconference";

export interface TieResult {
  winner: string;
  reason: string;
}

type Value = (id: string, group: string[]) => number | null;

interface Step {
  reason: string;
  /** Higher is better; null means the step doesn't apply to this group. */
  value: Value;
}

export class Tiebreaker {
  constructor(
    private readonly table: SeasonTable,
    private readonly coinSalt: string,
    /** Each team's place in its division (needed by the wild-card procedure). */
    private readonly divisionRank: Map<string, number> = new Map(),
  ) {}

  withDivisionRanks(ranks: Map<string, number>): Tiebreaker {
    return new Tiebreaker(this.table, this.coinSalt, ranks);
  }

  // --- The individual steps ---------------------------------------------------

  private headToHead: Step = {
    reason: "head-to-head",
    value: (id, group) => {
      const others = new Set(group.filter((g) => g !== id));
      const n = this.table.count(id, (p) => others.has(p.opponent));
      return n === 0 ? null : this.table.pct(id, (p) => others.has(p.opponent));
    },
  };

  /** Head-to-head between two clubs from different divisions: only if they played. */
  private headToHeadIfPlayed: Step = {
    reason: "head-to-head",
    value: (id, group) => {
      const other = group.find((g) => g !== id) as string;
      return this.table.count(id, (p) => p.opponent === other) === 0
        ? null
        : this.table.pct(id, (p) => p.opponent === other);
    },
  };

  private divisionRecord: Step = {
    reason: "division record",
    value: (id) => this.table.pct(id, this.table.isDivisionGame(id)),
  };

  private conferenceRecord: Step = {
    reason: "conference record",
    value: (id) => this.table.pct(id, this.table.isConferenceGame(id)),
  };

  private commonGames(minimum: number): Step {
    return {
      reason: "record in common games",
      value: (id, group) => {
        const common = this.table.commonOpponents(group);
        const counts = group.map((g) => this.table.count(g, (p) => common.has(p.opponent)));
        if (Math.min(...counts) < Math.max(1, minimum)) return null;
        return this.table.pct(id, (p) => common.has(p.opponent));
      },
    };
  }

  private strengthOfVictory: Step = {
    reason: "strength of victory",
    value: (id) => this.table.strengthOfVictory(id),
  };

  private strengthOfSchedule: Step = {
    reason: "strength of schedule",
    value: (id) => this.table.strengthOfSchedule(id),
  };

  private conferenceRank: Step = {
    reason: "points ranking in the conference",
    value: (id) => -this.table.combinedRank(id, "conference"),
  };

  private leagueRank: Step = {
    reason: "points ranking in the league",
    value: (id) => -this.table.combinedRank(id, "league"),
  };

  private netCommon: Step = {
    reason: "net points in common games",
    value: (id, group) => {
      const common = this.table.commonOpponents(group);
      return this.table.netPoints(id, (p) => common.has(p.opponent));
    },
  };

  private netConference: Step = {
    reason: "net points in conference games",
    value: (id) => this.table.netPoints(id, this.table.isConferenceGame(id)),
  };

  private netAll: Step = { reason: "net points", value: (id) => this.table.netPoints(id) };

  private netTouchdowns: Step = {
    reason: "net touchdowns",
    value: (id) => this.table.netTouchdowns(id),
  };

  private coinToss: Step = {
    reason: "a coin toss",
    value: (id, group) =>
      parseInt(fingerprint(`${this.coinSalt}|${[...group].sort().join(",")}|${id}`), 16),
  };

  // --- The procedures ---------------------------------------------------------

  private divisionSteps(): Step[] {
    return [
      this.headToHead,
      this.divisionRecord,
      this.commonGames(1),
      this.conferenceRecord,
      this.strengthOfVictory,
      this.strengthOfSchedule,
      this.conferenceRank,
      this.leagueRank,
      this.netCommon,
      this.netAll,
      this.netTouchdowns,
      this.coinToss,
    ];
  }

  private wildCardSteps(twoClubs: boolean): Step[] {
    return [
      twoClubs ? this.headToHeadIfPlayed : this.sweep,
      this.conferenceRecord,
      this.commonGames(4),
      this.strengthOfVictory,
      this.strengthOfSchedule,
      this.conferenceRank,
      this.leagueRank,
      this.netConference,
      this.netAll,
      this.netTouchdowns,
      this.coinToss,
    ];
  }

  /** Draft-order ties between clubs of different conferences (two clubs). */
  private interconferenceSteps(): Step[] {
    return [
      this.headToHeadIfPlayed,
      this.commonGames(4),
      this.strengthOfVictory,
      this.leagueRank,
      this.netAll,
      this.netTouchdowns,
      this.coinToss,
    ];
  }

  /**
   * Head-to-head sweep (three or more clubs): applies only if one club beat
   * each of the others (it advances) or lost to each of the others (it drops).
   * Encoded as values: sweeper 1, swept -1, others 0; "not applicable" if neither.
   */
  private sweep: Step = {
    reason: "head-to-head sweep",
    value: (id, group) => {
      const beatAll = (t: string) =>
        group.every(
          (o) =>
            o === t ||
            (this.table.count(t, (p) => p.opponent === o) > 0 &&
              this.table.games(t).every((p) => p.opponent !== o || p.pointsFor > p.pointsAgainst)),
        );
      const lostToAll = (t: string) =>
        group.every(
          (o) =>
            o === t ||
            (this.table.count(t, (p) => p.opponent === o) > 0 &&
              this.table.games(t).every((p) => p.opponent !== o || p.pointsFor < p.pointsAgainst)),
        );
      const sweeper = group.find(beatAll);
      const swept = group.find(lostToAll);
      if (!sweeper && !swept) return null;
      if (sweeper) return id === sweeper ? 1 : 0;
      return id === swept ? -1 : 0;
    },
  };

  /** The one club that advances out of a tie. */
  best(group: string[], kind: TieKind): TieResult {
    if (group.length === 0) throw new Error("empty tie");
    if (group.length === 1) return { winner: group[0] as string, reason: "no tie" };
    const sameDivision = group.every(
      (g) => this.table.teamOf(g).divisionId === this.table.teamOf(group[0] as string).divisionId,
    );
    if (kind === "division" || (kind === "wildcard" && sameDivision))
      return this.run(group, "division", this.divisionSteps());
    if (kind === "wildcard") {
      if (group.length > 2) {
        // Step 1: only the best-placed club of each division stays in.
        const leaders = new Map<string, string>();
        for (const g of group) {
          const division = this.table.teamOf(g).divisionId;
          const current = leaders.get(division);
          if (!current || (this.divisionRank.get(g) ?? 99) < (this.divisionRank.get(current) ?? 99))
            leaders.set(division, g);
        }
        const kept = group.filter((g) => [...leaders.values()].includes(g));
        if (kept.length < group.length) {
          const r = this.best(kept, "wildcard");
          return kept.length === 1
            ? { winner: r.winner, reason: "best-placed club in its division" }
            : r;
        }
      }
      return this.run(group, "wildcard", this.wildCardSteps(group.length === 2));
    }
    // Interconference (draft order).
    if (group.length === 2) return this.run(group, "interconference", this.interconferenceSteps());
    return this.run(group, "interconference", [
      this.strengthOfVictory,
      this.leagueRank,
      this.netAll,
      this.netTouchdowns,
      this.coinToss,
    ]);
  }

  private run(group: string[], kind: TieKind, steps: Step[]): TieResult {
    for (const step of steps) {
      const values = group.map((g) => step.value(g, group));
      if (values.some((v) => v === null)) continue;
      const top = Math.max(...(values as number[]));
      const leaders = group.filter((_, i) => values[i] === top);
      if (leaders.length === 1) return { winner: leaders[0] as string, reason: step.reason };
      if (leaders.length < group.length) {
        // Some clubs dropped out; the rest start over at step 1.
        return this.best(leaders, kind);
      }
    }
    throw new Error("tiebreak ended without a winner"); // unreachable: the coin toss always decides
  }

  /**
   * Orders a group of clubs with the same record: repeatedly the club that
   * advances goes next, and the rest start over. Returns notes explaining it.
   */
  order(
    group: string[],
    kind: TieKind,
  ): { order: string[]; notes: { winner: string; over: string[]; reason: string }[] } {
    const remaining = [...group];
    const order: string[] = [];
    const notes: { winner: string; over: string[]; reason: string }[] = [];
    while (remaining.length > 0) {
      const r = this.best(remaining, kind);
      if (remaining.length > 1)
        notes.push({
          winner: r.winner,
          over: remaining.filter((g) => g !== r.winner),
          reason: r.reason,
        });
      order.push(r.winner);
      remaining.splice(remaining.indexOf(r.winner), 1);
    }
    return { order, notes };
  }
}
