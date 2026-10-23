/**
 * Where a team stands (Phase 13): each GM reads his roster through his own staff's eyes, now
 * and two years out (the real age curves), with last season's record, the quarterback and the
 * cap, and calls it: contend, retool or rebuild. Win-now GMs call "contend" sooner; patient
 * ones call "rebuild" sooner. The call is re-read at the turning points of the year (the League
 * Year, camp, the trade deadline, the season's end) and keeps its reasons.
 */
import { ageOn, POSITIONS, type Position } from "@fgm/foundation";
import { STARTERS } from "../generate/config";
import type { League, Player, TeamPlan } from "../league/schema";
import { DEVELOPMENT } from "../lifecycle/config";
import { ageCurve, peakAge } from "../lifecycle/curves";
import { readOverall, readPlayer, readsKey, type Viewer } from "../perception";
import { salaryCap } from "../contracts/cap";
import { span } from "../contracts/contract";
import { capSheet } from "../contracts/team";
import { gmStyle } from "./executives";

export const EVALUATION = {
  /** Years ahead the "future" read looks. */
  futureYears: 2,
  /** A young player closes this share of the gap to his (perceived) potential a year. */
  growthShare: 0.3,
  /** Players whose deals end before then count this much of a replacement-level starter instead. */
  replacement: 70,
  leavingWeight: 0.5,
  /** Weights of the read: roster now, last season's record, roster in two years. */
  weights: { now: 0.55, record: 0.25, future: 0.2 },
  /** Calls: contend at or above, rebuild at or below (league-relative z), moved by the GM. */
  contendLine: 0.45,
  rebuildLine: -0.5,
  /** How far a win-now (+1) or patient (-1) GM moves both lines. */
  gmShift: 0.25,
  /** The quarterback: a read of this or better adds, this or worse subtracts. */
  qbGood: 80,
  qbPoor: 68,
  qbWeight: 0.2,
  /** Changing the call needs this much margin past a line (so plans don't flicker). */
  hysteresis: 0.1,
} as const;

const PROJECTIONS = new WeakMap<League, { key: string; values: Map<string, number> }>();

/**
 * A player's overall in `years`, as a team's staff sees him: young players grow toward the
 * potential the staff reads in them; past the peak they decline along the real curve.
 */
export function projectedOverall(league: League, p: Player, viewer: Viewer, years: number): number {
  const key = readsKey(league);
  let cache = PROJECTIONS.get(league);
  if (!cache || cache.key !== key) {
    cache = { key, values: new Map() };
    PROJECTIONS.set(league, cache);
  }
  const id = `${viewer.kind === "team" ? viewer.teamId : "office"}:${p.id}:${p.teamId}:${years}`;
  const hit = cache.values.get(id);
  if (hit !== undefined) return hit;
  const seen = readPlayer(league, p, viewer);
  const age = ageOn(p.birthDate, league.date);
  let overall = seen.overall;
  for (let y = 0; y < years; y++) {
    const a = age + y;
    if (a < peakAge(p.position))
      overall += Math.max(0, seen.potential - overall) * EVALUATION.growthShare;
    else overall += ageCurve(p.position, a) * DEVELOPMENT.declinePointsPerSd;
  }
  cache.values.set(id, overall);
  return overall;
}

/** A team's starters' average (its own read), now or projected `years` ahead. */
function teamStrength(league: League, teamId: string, years: number): number {
  const viewer = { kind: "team" as const, teamId };
  const by = new Map<Position, number[]>();
  for (const p of league.players) {
    if (p.teamId !== teamId || p.retiredAfter !== null || p.roster === "practice-squad") continue;
    let v =
      years === 0 ? readOverall(league, p, viewer) : projectedOverall(league, p, viewer, years);
    // A player whose deal runs out before then may be gone: half a replacement starter.
    if (years > 0 && p.contract && span(p.contract).lastReal < league.season + years)
      v = v * (1 - EVALUATION.leavingWeight) + EVALUATION.replacement * EVALUATION.leavingWeight;
    by.set(p.position, [...(by.get(p.position) ?? []), v]);
  }
  let sum = 0;
  let n = 0;
  for (const pos of POSITIONS) {
    const best = (by.get(pos) ?? []).sort((a, b) => b - a).slice(0, STARTERS[pos] ?? 1);
    // A missing starter counts as replacement level.
    for (let i = 0; i < (STARTERS[pos] ?? 1); i++) sum += best[i] ?? EVALUATION.replacement;
    n += STARTERS[pos] ?? 1;
  }
  return sum / n;
}

/** Each team's win share this season (four games or more), or last season's. */
function recordShare(league: League, teamId: string): number {
  let w = 0;
  let g = 0;
  for (const game of league.games) {
    if (game.round !== "regular" || !game.result) continue;
    if (game.homeId !== teamId && game.awayId !== teamId) continue;
    const mine = game.homeId === teamId ? game.result.homeScore : game.result.awayScore;
    const theirs = game.homeId === teamId ? game.result.awayScore : game.result.homeScore;
    w += mine > theirs ? 1 : mine === theirs ? 0.5 : 0;
    g += 1;
  }
  if (g >= 4) return w / g;
  const row = league.history.at(-1)?.standings.find((s) => s.teamId === teamId);
  if (!row) return 0.5;
  const games = row.wins + row.losses + row.ties;
  return games > 0 ? (row.wins + row.ties / 2) / games : 0.5;
}

const z = (x: number, xs: number[]) => {
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  const sd = Math.sqrt(xs.reduce((a, b) => a + (b - mean) * (b - mean), 0) / xs.length) || 1;
  return (x - mean) / sd;
};

/** Every team's GM reads where it stands; the plans are saved on the teams. */
export function updatePlans(league: League): void {
  const E = EVALUATION;
  const teams = [...league.teams].sort((a, b) => a.id.localeCompare(b.id));
  const now = new Map(teams.map((t) => [t.id, teamStrength(league, t.id, 0)]));
  const future = new Map(teams.map((t) => [t.id, teamStrength(league, t.id, E.futureYears)]));
  const record = new Map(teams.map((t) => [t.id, recordShare(league, t.id)]));
  const nows = [...now.values()];
  const futures = [...future.values()];
  const records = [...record.values()];
  const cap = (s: number) => salaryCap(league.rules.cap, s);
  for (const team of teams) {
    const gm = gmStyle(league, team.id);
    const nz = z(now.get(team.id)!, nows);
    const fz = z(future.get(team.id)!, futures);
    const rz = z(record.get(team.id)!, records);
    const viewer = { kind: "team" as const, teamId: team.id };
    const qb = league.players
      .filter((p) => p.teamId === team.id && p.position === "QB" && p.retiredAfter === null)
      .map((p) => readOverall(league, p, viewer))
      .sort((a, b) => b - a)[0];
    let score = E.weights.now * nz + E.weights.record * rz + E.weights.future * fz;
    const reasons: string[] = [];
    if (qb !== undefined && qb >= E.qbGood) {
      score += E.qbWeight;
      reasons.push(`A quarterback to build around (rated ${Math.round(qb)}).`);
    } else if (qb === undefined || qb <= E.qbPoor) {
      score -= E.qbWeight;
      reasons.push(`No answer at quarterback (best rated ${Math.round(qb ?? 0)}).`);
    }
    const shift = E.gmShift * gm.futureDiscount;
    const prev = team.plan;
    const stay = (w: TeamPlan["stance"]) => (prev?.stance === w ? E.hysteresis : 0);
    const stance: TeamPlan["stance"] =
      score >= E.contendLine - shift - stay("contend")
        ? "contend"
        : score <= E.rebuildLine - shift + stay("rebuild")
          ? "rebuild"
          : "retool";
    const describe = (x: number) =>
      x >= 1
        ? "among the league's best"
        : x >= 0.3
          ? "above average"
          : x > -0.3
            ? "about average"
            : x > -1
              ? "below average"
              : "among the league's worst";
    reasons.unshift(
      `Roster ${describe(nz)} now (starters ${now.get(team.id)!.toFixed(1)}), ${describe(fz)} in two years; last record ${describe(rz)}.`,
    );
    if (gm.futureDiscount >= 0.4) reasons.push("A win-now GM: quick to call it a contender.");
    else if (gm.futureDiscount <= -0.4) reasons.push("A patient GM: quick to start over.");
    const capRoom = [0, 1, 2].map(
      (i) =>
        Math.round(
          (capSheet(league, team.id, league.season + i).room / cap(league.season + i)) * 1000,
        ) / 1000,
    );
    if (capRoom[1]! < 0.02) reasons.push("Next year's cap is already tight.");
    team.plan = {
      stance,
      season: league.season,
      date: league.date,
      strength: Math.round(now.get(team.id)! * 10) / 10,
      future: Math.round(future.get(team.id)! * 10) / 10,
      capRoom,
      reasons,
    };
  }
}

/** A team's stance (retool if it hasn't been read yet). */
export function stanceOf(league: League, teamId: string): TeamPlan["stance"] {
  return league.teams.find((t) => t.id === teamId)?.plan?.stance ?? "retool";
}
