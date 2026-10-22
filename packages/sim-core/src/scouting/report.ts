/**
 * How drafts turned out (Phase 11), measured the way the real targets were
 * (calibration/draft.json, classes 1994-2020 from nflverse/PFR): by round,
 * the share of picks who started 3+ seasons, who never started, and their
 * average seasons started. A "started" season is one where he played at least
 * half a season's snaps on his side of the ball (kickers and punters: half
 * the games), our stand-in for PFR's "primary starter".
 */
import draftData from "../../../../calibration/draft.json";
import type { League, Player } from "../league/schema";

export const DRAFT_REPORT = {
  /** About half of one side's snaps in a 17-game season (a team runs ~1,060 a side). */
  startedSeasonSnaps: 530,
  /** Kickers and punters: games played in a season to count as the starter. */
  startedSeasonGames: 9,
};

export interface RoundOutcome {
  round: number;
  players: number;
  starter3Plus: number;
  neverStarted: number;
  meanSeasonsStarted: number;
  /** Real: the same measures from calibration/draft.json. */
  real: { starter3Plus: number; neverStarted: number; meanSeasonsStarted: number } | null;
}

/** Seasons in which he was a starter (regular-season lines; a traded player's lines add up). */
export function seasonsStarted(p: Player): number {
  const bySeason = new Map<number, { snaps: number; games: number }>();
  for (const s of p.stats) {
    const t = bySeason.get(s.season) ?? { snaps: 0, games: 0 };
    t.snaps += Math.max(s.line.offSnaps ?? 0, s.line.defSnaps ?? 0);
    t.games += s.line.gp ?? 0;
    bySeason.set(s.season, t);
  }
  const specialist = p.position === "K" || p.position === "P";
  let n = 0;
  for (const t of bySeason.values())
    if (
      specialist
        ? t.games >= DRAFT_REPORT.startedSeasonGames
        : t.snaps >= DRAFT_REPORT.startedSeasonSnaps
    )
      n += 1;
  return n;
}

/** Outcomes by round for the classes drafted from `first` to `last` (inclusive). */
export function draftOutcomes(league: League, first: number, last: number): RoundOutcome[] {
  const byRound = new Map<number, number[]>();
  for (const p of league.players) {
    const d = p.drafted;
    if (!d || d.season < first || d.season > last) continue;
    const list = byRound.get(d.round) ?? [];
    list.push(seasonsStarted(p));
    byRound.set(d.round, list);
  }
  return [...byRound.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([round, started]) => {
      const real = draftData.byRound.find((r) => r.round === round) ?? null;
      return {
        round,
        players: started.length,
        starter3Plus: started.filter((s) => s >= 3).length / started.length,
        neverStarted: started.filter((s) => s === 0).length / started.length,
        meanSeasonsStarted: started.reduce((a, b) => a + b, 0) / started.length,
        real: real
          ? {
              starter3Plus: real.starter3Plus,
              neverStarted: real.neverStarted,
              meanSeasonsStarted: real.meanSeasonsStarted,
            }
          : null,
      };
    });
}

export interface PickRangeOutcome {
  picks: string;
  players: number;
  starter3Plus: number;
  neverStarted: number;
  meanSeasonsStarted: number;
  real: { starter3Plus: number; neverStarted: number; meanSeasonsStarted: number } | null;
}

/**
 * The same by overall pick, in the real ranges (1-10, 11-32, ...): fairer than by round, since
 * real rounds 3-7 held more picks (compensatory picks, older drafts) than ours.
 */
export function draftOutcomesByPick(
  league: League,
  first: number,
  last: number,
): PickRangeOutcome[] {
  return draftData.byPickRange.map((range) => {
    const [lo, hi] = range.picks.split("-").map(Number) as [number, number];
    const started = league.players
      .filter((p) => {
        const d = p.drafted;
        return d && d.season >= first && d.season <= last && d.pick >= lo && d.pick <= hi;
      })
      .map(seasonsStarted);
    const n = Math.max(1, started.length);
    return {
      picks: range.picks,
      players: started.length,
      starter3Plus: started.filter((s) => s >= 3).length / n,
      neverStarted: started.filter((s) => s === 0).length / n,
      meanSeasonsStarted: started.reduce((a, b) => a + b, 0) / n,
      real: {
        starter3Plus: range.starter3Plus,
        neverStarted: range.neverStarted,
        meanSeasonsStarted: range.meanSeasonsStarted,
      },
    };
  });
}
