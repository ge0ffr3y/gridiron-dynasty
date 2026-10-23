/**
 * Player development (Phase 9): once a year at the new League Year (most of it)
 * and again in training camp (the rest), every player moves along his
 * position's real age curve. Young players grow toward their hidden potential,
 * faster with good work habits and real playing time; veterans decline,
 * physical traits first. Each change carries a reason.
 *
 * Sizes are in overall points; the curve shapes come from real players
 * (calibration/lifecycle.json via curves.ts).
 */
import {
  ageOn,
  ATTRIBUTES,
  OVERALL_WEIGHTS,
  overallAt,
  Rng,
  streamSeed,
  type AttributeKey,
  type Position,
} from "@fgm/foundation";
import type { League, Player } from "../league/schema";
import { developmentMultiplier } from "../coaches/effects";
import { moraleDevelopment } from "../people/morale";
import { campAttendance } from "../people/disputes";
import { PRESEASON } from "../roster/config";
import { DEVELOPMENT } from "./config";
import { ageCurve, growthShare, peakAge } from "./curves";

const PHYSICAL = ATTRIBUTES.filter((a) => a.group === "physical").map((a) => a.key);
const NON_PHYSICAL = ATTRIBUTES.filter((a) => a.group !== "physical").map((a) => a.key);

const POSITION_NAMES: Record<Position, string> = {
  QB: "quarterback",
  RB: "running back",
  FB: "fullback",
  WR: "wide receiver",
  TE: "tight end",
  OT: "tackle",
  OG: "guard",
  C: "center",
  EDGE: "edge rusher",
  DT: "defensive tackle",
  LB: "linebacker",
  CB: "cornerback",
  S: "safety",
  K: "kicker",
  P: "punter",
  LS: "long snapper",
};

export type DevelopmentStage = "league-year" | "camp" | "season";

/** One player's change in a development round. */
export interface DevelopmentChange {
  playerId: number;
  before: number;
  after: number;
  reason: string;
}

/** What a player brings to a development round besides his ratings. */
export interface DevelopmentContext {
  age: number;
  /** Share of a full-time player's snaps he played last season (0-1). */
  playingTime: number;
  /** Share of the year's development this round carries (the League Year's 0.7, camp's 0.3). */
  portion: number;
  /** Extra growth a strong camp earns (overall points, before the potential cap). */
  campBonus?: number;
  /** His coaches' development effect and his scheme fit (Phase 10), 1 = typical. */
  coaching?: number;
}

/** Share of a full season's snaps a player played (0-1); specialists by games played. */
export function playingTime(p: Player, season: number, games: number): number {
  const lines = p.stats.filter((s) => s.season === season);
  if (lines.length === 0) return 0;
  let snaps = 0;
  let gp = 0;
  for (const s of lines) {
    snaps += (s.line.offSnaps ?? 0) + (s.line.defSnaps ?? 0);
    gp += s.line.gp ?? 0;
  }
  if (p.position === "K" || p.position === "P" || p.position === "LS")
    return Math.min(1, gp / games);
  return Math.min(1, snaps / (games * DEVELOPMENT.snapsPerGame));
}

/**
 * The year's expected change in overall points before luck. Before his peak a player closes
 * part of the gap to his potential (the share each year follows the real curve's timing),
 * more with good work habits and playing time; past it he declines along his position's
 * real curve, faster if his body is wearing down.
 */
export function expectedChange(p: Player, ctx: DevelopmentContext): number {
  const overall = overallAt(p.ratings, p.position);
  const share = growthShare(p.position, ctx.age);
  if (share > 0) {
    // Young players close part of the gap to their potential each year.
    const room = Math.max(0, p.hidden.potential - overall);
    const habits = 1 + (p.hidden.workEthic - 50) * DEVELOPMENT.workEthicEffect;
    const [low, high] = DEVELOPMENT.playingTimeGrowth;
    const reps = low + (high - low) * ctx.playingTime;
    return room * share * habits * reps * (ctx.coaching ?? 1) * ctx.portion;
  }
  const base = ageCurve(p.position, ctx.age) * DEVELOPMENT.declinePointsPerSd;
  const body = 1 + (50 - p.hidden.durability) * DEVELOPMENT.durabilityEffect;
  return base * body * ctx.portion;
}

/**
 * Moves a player's attributes so his overall changes by about `change` points: the
 * attributes that count at his position move, split between physical traits and skills.
 * Fractions are rounded up or down at random so small changes still add up over time.
 */
export function shiftOverall(p: Player, change: number, physicalShare: number, rng: Rng): void {
  const weights = OVERALL_WEIGHTS[p.position];
  const total = Object.values(weights).reduce((a, w) => a + (w ?? 0), 0);
  const physicalWeight = PHYSICAL.reduce((a, k) => a + (weights[k] ?? 0), 0);
  const skillWeight = total - physicalWeight;
  const share = physicalWeight > 0 ? physicalShare : 0;
  // Each attribute's move such that the weighted average moves by `change`.
  const physicalStep = physicalWeight > 0 ? (share * change * total) / physicalWeight : 0;
  const skillStep = skillWeight > 0 ? ((1 - share) * change * total) / skillWeight : 0;
  const move = (key: AttributeKey, step: number) => {
    // A little spread so attributes don't all move in lockstep.
    const amount = step * rng.range(0.6, 1.4);
    const whole = Math.floor(amount);
    const rounded = whole + (rng.next() < amount - whole ? 1 : 0);
    p.ratings[key] = Math.max(1, Math.min(99, p.ratings[key] + rounded));
  };
  for (const key of NON_PHYSICAL) if ((weights[key] ?? 0) > 0) move(key, skillStep);
  // Physical traits change for everyone (a guard slows down too), not just where they count.
  for (const key of PHYSICAL) move(key, physicalStep);
}

/** A short plain-English reason for a change. */
function describe(p: Player, ctx: DevelopmentContext, change: number, expected: number): string {
  const who = `Age ${ctx.age} ${POSITION_NAMES[p.position]}`;
  const parts: string[] = [];
  const peak = peakAge(p.position);
  if (expected > 0.3) {
    parts.push(ctx.age < peak - 2 ? "still growing" : "nearing his peak");
    if (p.hidden.workEthic >= 70) parts.push("works hard");
    else if (p.hidden.workEthic <= 30) parts.push("doesn't put the work in");
    if (ctx.playingTime >= 0.6) parts.push("learned from a starter's snaps");
    else if (ctx.playingTime < 0.1 && ctx.age < peak) parts.push("few game snaps to learn from");
    if (ctx.campBonus) parts.push("built on a strong preseason");
  } else if (expected < -0.3) {
    parts.push(ctx.age >= 30 ? "lost a step" : "past his peak");
    if (p.hidden.durability <= 30) parts.push("his body is wearing down");
  } else parts.push("at his peak");
  if (change - expected >= 2.5) parts.push("a breakout year");
  else if (expected - change >= 2.5) parts.push("a disappointing year");
  return `${who}: ${parts.join("; ")}.`;
}

/**
 * One development round for one player. Returns the change (before and after overall,
 * reason); the player's ratings and potential are updated.
 */
export function developPlayer(p: Player, ctx: DevelopmentContext, rng: Rng): DevelopmentChange {
  const before = overallAt(p.ratings, p.position);
  const expected = expectedChange(p, ctx) + (ctx.campBonus ?? 0);
  const luck = rng.gaussian(0, DEVELOPMENT.noise * Math.sqrt(ctx.portion));
  let change = expected + luck;
  // Growth stops at potential (luck can carry a player a little past it: a pleasant surprise).
  if (expected > 0 && before + expected > p.hidden.potential)
    change = Math.max(0, p.hidden.potential - before) + luck;
  const [young, old] = DEVELOPMENT.physicalShareOfDecline;
  const physicalShare =
    change >= 0 ? DEVELOPMENT.physicalShareOfGrowth : ctx.age >= 30 ? old : young;
  shiftOverall(p, change, physicalShare, rng);
  const after = overallAt(p.ratings, p.position);

  // Potential: young players who beat (or miss) expectations show a little more (or less)
  // than anyone thought; after the peak it fades toward what he is.
  const peak = peakAge(p.position);
  let potential = p.hidden.potential;
  if (ctx.age < peak) potential += Math.round(luck * DEVELOPMENT.potentialFromLuck);
  else potential -= Math.round(DEVELOPMENT.potentialFadeAfterPeak * ctx.portion);
  p.hidden.potential = Math.max(after, Math.min(99, potential));
  return { playerId: p.id, before, after, reason: describe(p, ctx, after - before, expected) };
}

/** Everyone still playing (on a team or a free agent who hasn't retired). */
function candidates(league: League): Player[] {
  return league.players.filter((p) => p.retiredAfter === null);
}

/**
 * The League Year's development round (most of the year's change), in March before
 * contracts and free agency, so teams decide on what players are now. Last season's
 * playing time counts. Returns the notable changes, biggest first.
 */
export function offseasonDevelopment(league: League): DevelopmentChange[] {
  // Each team plays every week but one (its bye).
  const games = league.rules.schedule.regularSeasonWeeks - 1;
  const changes: DevelopmentChange[] = [];
  for (const p of candidates(league)) {
    const rng = new Rng(streamSeed(league.meta.seed, `development:${league.season}:${p.id}`));
    const change = developPlayer(
      p,
      {
        age: ageOn(p.birthDate, league.date),
        playingTime: playingTime(p, league.season - 1, games),
        portion: DEVELOPMENT.offseasonShare,
        // His coaches and his fit in their scheme (Phase 10).
        coaching: developmentMultiplier(league, p) * moraleDevelopment(p),
      },
      rng,
    );
    changes.push(change);
  }
  return notable(changes);
}

/** Changes big enough to report, biggest first (ties by player id, for a stable order). */
export function notable(changes: DevelopmentChange[]): DevelopmentChange[] {
  return changes
    .filter((c) => Math.abs(c.after - c.before) >= DEVELOPMENT.notableChange)
    .sort(
      (a, b) =>
        Math.abs(b.after - b.before) - Math.abs(a.after - a.before) || a.playerId - b.playerId,
    );
}

/** The camp bonus a preseason standout earns: up to the maximum, scaled by work habits. */
export function campBonus(p: Player, season: number): number {
  const grade = p.preseason?.season === season ? p.preseason.grade : null;
  if (grade === null || grade < PRESEASON.standoutGrade) return 0;
  const habits = Math.min(1, p.hidden.workEthic / PRESEASON.fullBoostWorkEthic);
  return PRESEASON.maxBoost * habits;
}

/**
 * Training camp's development round (the rest of the year's change), after the preseason
 * and before final cuts. A strong preseason adds a little growth for players with room to
 * grow (Phase 8's showcase boost, folded in).
 */
export function campDevelopment(league: League): DevelopmentChange[] {
  const games = league.rules.schedule.regularSeasonWeeks - 1;
  const portion = 1 - DEVELOPMENT.offseasonShare;
  const changes: DevelopmentChange[] = [];
  for (const p of candidates(league)) {
    // Camp is for players in camp: free agents keep their League Year change.
    if (p.teamId === null) continue;
    const rng = new Rng(streamSeed(league.meta.seed, `camp:${league.season}:${p.id}`));
    // A rookie's "last season" was college: count him as a part-timer.
    const rookie = p.experience === 0;
    changes.push(
      developPlayer(
        p,
        {
          age: ageOn(p.birthDate, league.date),
          playingTime: rookie
            ? DEVELOPMENT.rookiePlayingTime
            : playingTime(p, league.season - 1, games),
          portion,
          campBonus: campBonus(p, league.season),
          // A holdout or hold-in missed camp's work (Phase 12b).
          coaching:
            developmentMultiplier(league, p) * moraleDevelopment(p) * campAttendance(league, p),
        },
        rng,
      ),
    );
  }
  return notable(changes);
}

/**
 * In-season changes, after each regular-season week: young players getting real snaps
 * sometimes gain a point; veterans past their peak who aren't playing sometimes lose one.
 * Small and rare, so the season's stats stay calibrated. Returns the players who changed.
 */
export function weeklyDevelopment(league: League, week: number): DevelopmentChange[] {
  const changes: DevelopmentChange[] = [];
  const { growthChance, declineChance, regularShare } = DEVELOPMENT.weekly;
  for (const p of league.players) {
    if (p.teamId === null || p.retiredAfter !== null || p.roster !== "active") continue;
    const line = p.stats.find((s) => s.season === league.season && s.teamId === p.teamId)?.line;
    const snaps = (line?.offSnaps ?? 0) + (line?.defSnaps ?? 0);
    const share = Math.min(1, snaps / (week * DEVELOPMENT.snapsPerGame));
    const age = ageOn(p.birthDate, league.date);
    const peak = peakAge(p.position);
    const specialist = p.position === "K" || p.position === "P" || p.position === "LS";
    if (specialist) continue;
    const before = overallAt(p.ratings, p.position);
    const rng = new Rng(streamSeed(league.meta.seed, `week:${league.season}:${week}:${p.id}`));
    let reason: string | null = null;
    let step = 0;
    if (age < peak && share >= regularShare && before < p.hidden.potential) {
      if (rng.chance(growthChance)) {
        step = 1;
        reason = `Age ${age}: growing with a starter's snaps this season.`;
      }
    } else if (age > peak + 2 && share < DEVELOPMENT.weekly.idleShare) {
      if (rng.chance(declineChance)) {
        step = -1;
        reason = `Age ${age}: fading without game snaps this season.`;
      }
    }
    if (step === 0) continue;
    shiftOverall(p, step, step > 0 ? 0 : DEVELOPMENT.physicalShareOfDecline[1], rng);
    const after = overallAt(p.ratings, p.position);
    if (after !== before) changes.push({ playerId: p.id, before, after, reason: reason! });
  }
  return changes;
}

/** Adds a development round to this season's report (in-season changes add up in one round). */
export function recordDevelopment(
  league: League,
  stage: DevelopmentStage,
  changes: DevelopmentChange[],
): void {
  if (stage !== "season") {
    league.development.push({ season: league.season, stage, date: league.date, changes });
    return;
  }
  let round = league.development.find((r) => r.season === league.season && r.stage === "season");
  if (!round) {
    round = { season: league.season, stage, date: league.date, changes: [] };
    league.development.push(round);
  }
  round.date = league.date;
  for (const c of changes) {
    const prior = round.changes.find((x) => x.playerId === c.playerId);
    if (prior) {
      prior.after = c.after;
      prior.reason = c.reason;
    } else round.changes.push({ ...c });
  }
}

/**
 * At the end of a season: each player in the league that season gets a line in his rating
 * history (overall, age, team, position).
 */
export function recordRatingHistory(league: League): void {
  for (const p of league.players) {
    if (p.retiredAfter !== null) continue;
    const played = p.stats.some((s) => s.season === league.season);
    if (p.teamId === null && !played) continue;
    if (p.ratingHistory.some((h) => h.season === league.season)) continue;
    p.ratingHistory.push({
      season: league.season,
      age: ageOn(p.birthDate, league.date),
      teamId: p.teamId,
      position: p.position,
      overall: overallAt(p.ratings, p.position),
    });
  }
}
