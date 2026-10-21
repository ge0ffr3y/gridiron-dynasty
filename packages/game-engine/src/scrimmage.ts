/**
 * Deciding a scrimmage play from the matchups on the field.
 *
 * Runs: the blockers at the hole against the defenders there, the number of
 * men in the box, then the ball carrier against the tackler (broken tackles
 * included). Passes: each rusher against his blocker decides pressure, each
 * receiver against his defender decides who is open, the quarterback reads
 * and throws, and accuracy, catching, coverage and tackling decide the rest.
 *
 * Outcomes are drawn from real NFL shapes (calibration/*.json) and nudged by
 * the matchups. Nothing here changes the game state: it returns what
 * happened, so penalties can be weighed before the play is applied.
 */
import { baseProfile, dmath, type Ratings, type Rng } from "@fgm/foundation";
import {
  AVERAGE_RATING,
  CALIBRATION_TARGETS,
  CHARTING,
  MATCHUPS,
  REAL,
  SITUATIONS,
  TUNING,
} from "./config";
import { COVERAGE_NAMES, pickShare, type Coverage, type Huddle } from "./onfield";
import { adjustProbability, fromQuantiles, shiftedUniform, weightedPick } from "./sample";
import type { LineupPlayer, Play } from "./types";

export type Depth = "short" | "medium" | "deep";
export type PlayDetails = Omit<
  Play,
  "quarter" | "clock" | "offense" | "down" | "toGo" | "yardsToGoal" | "score" | "yards"
>;

/** What a scrimmage play produced, before penalties and before the game state changes. */
export interface ScrimmageResult {
  details: PlayDetails;
  gain: number;
  seconds: number;
  /** The clock stops after the play (an incompletion). */
  incomplete: boolean;
  outOfBounds: boolean;
  /** The ball changed hands: interception or lost fumble. `spot` is in the offense's yards to goal. */
  turnover?: { spot: number; returnYards: number };
  /** For penalties: the quarterback was hit or hurried, or threw it away from the pocket. */
  pressured: boolean;
  throwAway: boolean;
  /** Who the play went to (for pass interference) and how far downfield. */
  target?: LineupPlayer;
  airYards?: number;
}

export interface ScrimmageContext {
  rng: Rng;
  huddle: Huddle;
  ytg: number;
  down: number;
  toGo: number;
  /** Home-field edge for the offense in rating points (negative if the defense is at home). */
  homeEdge: number;
  /** The offense is in a two-minute drill, so the defense plays deep ("prevent"). */
  prevent?: boolean;
  /** What the weather does to this play (Phase 5b); missing = indoors. */
  weather?: { completionLogit: number; catchYardsFactor: number; fumbleFactor: number };
  /** In-game adjustments and momentum: extra quantile shift on runs, extra completion log-odds on passes. */
  runShift?: number;
  passShift?: number;
  note?: string;
}

const Q = REAL.quantilePoints;
const A = AVERAGE_RATING;
const T = TUNING;

const logit = (p: number) => dmath.log(p / (1 - p));
const avg = (players: LineupPlayer[], f: (p: LineupPlayer) => number) =>
  players.length === 0 ? A : players.reduce((s, p) => s + f(p), 0) / players.length;

// Coverage shells: how much easier or harder they are to complete passes against, and how far completions go.
const baseCompletion = CALIBRATION_TARGETS.completionPct.real;
const baseYardsPerCompletion = CALIBRATION_TARGETS.yardsPerAttempt.real / baseCompletion;
const COVERAGE_EFFECT: Record<Coverage, { completion: number; distance: number }> =
  Object.fromEntries(
    (Object.keys(COVERAGE_NAMES) as Coverage[]).map((c) => {
      const o = (
        MATCHUPS.outcomesByCoverage as Record<
          string,
          { completionPct: number; yardsPerAttempt: number }
        >
      )[c];
      if (!o) return [c, { completion: 0, distance: 0 }];
      return [
        c,
        {
          completion: T.pass.coverageWeight * (logit(o.completionPct) - logit(baseCompletion)),
          distance:
            T.pass.coverageWeight *
            dmath.log(o.yardsPerAttempt / o.completionPct / baseYardsPerCompletion),
        },
      ];
    }),
  ) as Record<Coverage, { completion: number; distance: number }>;

const pressured = MATCHUPS.outcomesByPressure.pressured;
const clean = MATCHUPS.outcomesByPressure.clean;
const PRESSURE_COMPLETION = {
  yes: logit(pressured.completionPct) - logit(baseCompletion),
  no: logit(clean.completionPct) - logit(baseCompletion),
};
const PRESSURE_INTERCEPTION = {
  yes: pressured.interceptionRate / CALIBRATION_TARGETS.interceptionRate.real,
  no: clean.interceptionRate / CALIBRATION_TARGETS.interceptionRate.real,
};

// ---------------------------------------------------------------------------
// Runs
// ---------------------------------------------------------------------------

const GAP_NAMES: Record<string, string> = {
  "left-end": "around left end",
  "left-tackle": "off left tackle",
  "left-guard": "up the middle, left side",
  middle: "up the middle",
  "right-guard": "up the middle, right side",
  "right-tackle": "off right tackle",
  "right-end": "around right end",
};

function gapPeople(
  h: Huddle,
  gap: string,
): { blockers: LineupPlayer[]; defenders: LineupPlayer[] } {
  const [lt, rt, lg, rg, c] = h.offense.ol as [
    LineupPlayer,
    LineupPlayer,
    LineupPlayer,
    LineupPlayer,
    LineupPlayer,
  ];
  const te = h.offense.tightEnds;
  const [e1, e2, t1, t2] = [h.defense.dl[0], h.defense.dl[1], h.defense.dl[2], h.defense.dl[3]];
  const lb = h.defense.lb;
  const pick = (...xs: (LineupPlayer | undefined)[]) =>
    xs.filter((x): x is LineupPlayer => x !== undefined);
  switch (gap) {
    case "left-end":
      return { blockers: pick(lt, te[0]), defenders: pick(e2, lb[0]) };
    case "left-tackle":
      return { blockers: pick(lt, lg), defenders: pick(e2, t2, lb[0]) };
    case "left-guard":
      return { blockers: pick(lg, c), defenders: pick(t2, lb[0]) };
    case "right-guard":
      return { blockers: pick(rg, c), defenders: pick(t1, lb[lb.length - 1]) };
    case "right-tackle":
      return { blockers: pick(rt, rg), defenders: pick(e1, t1, lb[lb.length - 1]) };
    case "right-end":
      return { blockers: pick(rt, te[1] ?? te[0]), defenders: pick(e1, lb[lb.length - 1]) };
    default:
      return { blockers: pick(c, lg, rg), defenders: pick(t1, t2, lb[0]) };
  }
}

/** Who makes the tackle on a run: the defenders at the hole first, the secondary on longer runs. */
function runTackler(rng: Rng, h: Huddle, defenders: LineupPlayer[], gain: number): LineupPlayer {
  const backs = [...h.defense.s, ...h.defense.cb];
  const W = T.run.tacklerWeights;
  const pool: [LineupPlayer, number][] =
    gain >= W.longGain.yards
      ? [
          ...backs.map((p) => [p, W.longGain.backs] as [LineupPlayer, number]),
          ...h.defense.lb.map((p) => [p, W.longGain.lb] as [LineupPlayer, number]),
        ]
      : [
          ...defenders.map((p) => [p, W.atTheGap] as [LineupPlayer, number]),
          ...h.defense.lb.map((p) => [p, W.lb] as [LineupPlayer, number]),
          ...h.defense.dl.map((p) => [p, W.dl] as [LineupPlayer, number]),
          ...backs.map((p) => [p, W.backs] as [LineupPlayer, number]),
        ];
  // Better tacklers make more of the tackles.
  return weightedPick(rng, pool, ([p, w]) => w * (0.5 + p.ratings.tackling / 100))[0];
}

function pickBallCarrier(rng: Rng, h: Huddle): LineupPlayer {
  const s = T.rusherShare;
  const [rb1, second] = h.offense.backs;
  const options: [LineupPlayer | undefined, number][] = [
    [rb1, s.rb1 + (second ? 0 : s.rb2)],
    [second, second?.position === "FB" ? s.fb : s.rb2],
    [h.offense.qb, s.qb * (h.offense.qb.ratings.speed / 70)],
    [h.offense.receivers[0], s.wr],
  ];
  const valid = options.filter((o): o is [LineupPlayer, number] => o[0] !== undefined);
  return weightedPick(rng, valid, (o) => o[1])[0];
}

/**
 * Skills are compared with a typical starter at the position that uses them
 * (a typical back's elusiveness, a typical receiver's run after the catch,
 * a typical edge rusher), not with a typical player of any position.
 */
/** A weighted blend of ratings (the weights live in TUNING.skills). */
function blend(r: Ratings, weights: Partial<Record<keyof Ratings, number>>): number {
  let sum = 0;
  for (const key of Object.keys(weights) as (keyof Ratings)[]) sum += (weights[key] ?? 0) * r[key];
  return sum;
}
const runnerSkill = (r: Ratings) => blend(r, T.skills.runner);
const catchRunSkill = (r: Ratings) => blend(r, T.skills.afterCatch);
const REF = {
  runner: runnerSkill(baseProfile("RB")),
  catchRun: catchRunSkill(baseProfile("WR")),
  tackling: baseProfile("LB").tackling,
  passRush: baseProfile("EDGE").passRush,
  qbAwareness: baseProfile("QB").awareness,
  qbAgility: baseProfile("QB").agility,
  qbSpeed: baseProfile("QB").speed,
};
const elusiveness = (p: LineupPlayer) => runnerSkill(p.ratings) - REF.runner;
const afterCatch = (p: LineupPlayer) => catchRunSkill(p.ratings) - REF.catchRun;
const tackling = (p: LineupPlayer) => p.ratings.tackling - REF.tackling;

/**
 * Real run gains for this distance to go: short-yardage runs face stacked
 * fronts but usually get their yard or two; on long yardage the defense is
 * waiting for a pass and gives up more.
 */
function runTable(toGo: number): readonly number[] {
  const t = SITUATIONS.runYardsByDistance;
  return toGo <= 1
    ? t["1"]
    : toGo <= 3
      ? t["2-3"]
      : toGo <= 6
        ? t["4-6"]
        : toGo <= 10
          ? t["7-10"]
          : t["11+"];
}

export function resolveRun(ctx: ScrimmageContext, sneak: boolean): ScrimmageResult {
  const { rng, huddle: h } = ctx;
  const rusher = sneak ? h.offense.qb : pickBallCarrier(rng, h);
  const gap = sneak
    ? "middle"
    : pickShare(
        rng,
        Object.fromEntries(Object.entries(MATCHUPS.runGaps).map(([k, v]) => [k, v.share])),
        "middle",
      );
  const { blockers, defenders } = gapPeople(h, gap);
  const blockEdge =
    avg(blockers, (p) => blend(p.ratings, T.skills.runBlock)) -
    avg(defenders, (p) => blend(p.ratings, T.skills.shedBlock));
  const direction: "left" | "middle" | "right" = gap.startsWith("left")
    ? "left"
    : gap.startsWith("right")
      ? "right"
      : "middle";
  const base = {
    kind: "run" as const,
    rusher: rusher.id,
    direction,
    gap: GAP_NAMES[gap] ?? gap,
    ...(ctx.note ? { note: ctx.note } : {}),
  };

  let gain: number;
  let tackler = runTackler(rng, h, defenders, 0);
  let missed: number | undefined;
  if (sneak) {
    // A sneak gains a yard or two if the middle of the line holds up.
    const success = rng.chance(
      adjustProbability(
        T.run.sneakSuccess,
        blockEdge * T.run.sneakBlockLogit + ctx.homeEdge * T.run.sneakHomeLogit,
      ),
    );
    gain = success ? 1 + rng.int(2) : rng.int(2) - 1 + 0;
    if (!success) gain = Math.min(gain, 0);
  } else {
    const boxKey = h.box <= 5 ? "5-" : h.box >= 8 ? "8+" : String(h.box);
    let shift =
      blockEdge * T.matchup.runQuantileShift +
      elusiveness(rusher) * T.run.carrierShift +
      (T.run.boxShift[boxKey as keyof typeof T.run.boxShift] ?? 0) +
      (T.run.gapShift[gap as keyof typeof T.run.gapShift] ?? 0) +
      T.baseline.runQuantileShift +
      ctx.homeEdge * T.matchup.runQuantileShift +
      (ctx.runShift ?? 0);
    // Broken tackle: the first defender misses and the run goes on.
    const breakChance = adjustProbability(
      T.run.brokenTackle,
      (elusiveness(rusher) - tackling(tackler)) * T.run.brokenTackleLogit,
    );
    if (rng.chance(breakChance)) {
      missed = tackler.id;
      shift += T.run.brokenTackleShift;
    }
    gain = Math.round(
      fromQuantiles(Q, runTable(ctx.toGo), shiftedUniform(rng, shift), T.tails.run),
    );
    tackler = runTackler(rng, h, defenders, gain);
  }
  if (missed === tackler.id) tackler = runTackler(rng, h, defenders, gain + 10);
  const extras = missed !== undefined ? { missedTackles: [missed] } : {};

  // Fumble?
  const fumbleChance = adjustProbability(
    REAL.run.fumbleRate,
    (A - rusher.ratings.ballSecurity) * T.run.fumbleBallSecurityLogit +
      (tackler.ratings.strength - A) * T.run.fumbleHitLogit,
  );
  if (
    gain < ctx.ytg &&
    ctx.ytg - gain < 100 &&
    rng.chance(fumbleChance * (ctx.weather?.fumbleFactor ?? 1))
  ) {
    const lost = rng.chance(T.fumbleLostShare.run);
    if (lost) {
      return {
        details: {
          ...base,
          ...extras,
          tacklers: [tackler.id],
          fumble: { by: rusher.id, lost: true, recoveredBy: tackler.id },
          turnover: true,
        },
        gain,
        seconds: T.playSeconds.run,
        incomplete: false,
        outOfBounds: false,
        turnover: { spot: ctx.ytg - gain, returnYards: 0 },
        pressured: false,
        throwAway: false,
      };
    }
    return {
      details: {
        ...base,
        ...extras,
        tacklers: [tackler.id],
        fumble: { by: rusher.id, lost: false },
      },
      gain,
      seconds: T.playSeconds.run,
      incomplete: false,
      outOfBounds: false,
      pressured: false,
      throwAway: false,
    };
  }
  const outside = gap.endsWith("end") || gap.endsWith("tackle");
  const outOfBounds =
    gain < ctx.ytg && rng.chance(outside ? T.outOfBounds.outsideRun : T.outOfBounds.insideRun);
  return {
    details: {
      ...base,
      ...extras,
      tacklers: gain >= ctx.ytg ? [] : [tackler.id],
      ...(outOfBounds ? { outOfBounds: true } : {}),
      ...(sneak ? { sneak: true } : {}),
    },
    gain,
    seconds: T.playSeconds.run,
    incomplete: false,
    outOfBounds,
    pressured: false,
    throwAway: false,
  };
}

// ---------------------------------------------------------------------------
// Passes
// ---------------------------------------------------------------------------

interface Receiver {
  player: LineupPlayer;
  weight: number;
  defender: LineupPlayer;
  openness: number;
}

const ROUTES_BY_DEPTH: Record<Depth, string[]> = {
  short: ["QUICK OUT", "HITCH/CURL", "SLANT", "SHALLOW CROSS/DRAG", "SWING", "TEXAS/ANGLE"],
  medium: ["IN/DIG", "DEEP OUT", "HITCH/CURL"],
  deep: ["GO", "POST", "CORNER", "WHEEL"],
};

function routeFor(rng: Rng, depth: Depth, screen: boolean): string {
  if (screen) return "SCREEN";
  const routes = MATCHUPS.routes as Record<string, { share: number }>;
  return pickShare(
    rng,
    Object.fromEntries(ROUTES_BY_DEPTH[depth].map((r) => [r, routes[r]?.share ?? 0.01])),
    ROUTES_BY_DEPTH[depth][0]!,
  );
}

/** Who covers whom: man coverage matches corners to receivers, safeties to tight ends, linebackers to backs. */
function coverageAssignments(
  h: Huddle,
  depth: Depth,
): (target: LineupPlayer, index: number) => LineupPlayer {
  const rushing = new Set(h.defense.rushers.map((p) => p.id));
  const free = (list: LineupPlayer[]) => list.filter((p) => !rushing.has(p.id));
  const cb = free(h.defense.cb);
  const s = free(h.defense.s);
  const lb = free(h.defense.lb);
  const anyone = [...cb, ...s, ...lb];
  const fallback = anyone[0] ?? h.defense.cb[0] ?? h.defense.dl[0]!;
  if (h.man) {
    return (target, index) => {
      if (target.position === "WR") return cb[index] ?? s[index - cb.length] ?? fallback;
      if (target.position === "TE") return s[0] ?? lb[0] ?? fallback;
      return lb[0] ?? s[s.length - 1] ?? fallback;
    };
  }
  // Zone: whoever patrols that depth.
  const zone =
    depth === "deep" ? [...s, ...cb] : depth === "medium" ? [...cb, ...s, ...lb] : [...lb, ...cb];
  return (_target, index) => zone[index % Math.max(1, zone.length)] ?? fallback;
}

function routeSkill(p: LineupPlayer, depth: Depth): number {
  const r = p.ratings;
  const skill = blend(r, T.skills.route);
  // Backs and blocking tight ends aren't built for deep routes.
  return p.position === "RB" || p.position === "FB"
    ? skill - (depth === "short" ? 0 : T.pass.backDownfieldPenalty)
    : skill;
}

function coverSkill(p: LineupPlayer, man: boolean): number {
  const r = p.ratings;
  return blend(r, man ? T.skills.manCoverage : T.skills.zoneCoverage);
}

export interface PassOptions {
  depth: Depth;
  playAction: boolean;
  screen: boolean;
}

export function resolvePass(ctx: ScrimmageContext, opts: PassOptions): ScrimmageResult {
  const { rng, huddle: h } = ctx;
  const qb = h.offense.qb;
  const note = ctx.note ? { note: ctx.note } : {};
  const scheme = {
    personnel: h.personnel,
    formation: h.formation,
    coverage: h.coverage,
    rushers: h.rushers,
    ...(opts.playAction ? { playAction: true } : {}),
  };

  // 1. The pass rush: each rusher against his blocker.
  const ol = h.offense.ol;
  const protectors = h.rushers >= 6 && h.offense.backs[0] ? [...ol, h.offense.backs[0]] : ol;
  const edges = h.defense.rushers.map((rusher, i) => {
    const blocker = protectors[i];
    return {
      rusher,
      blocker,
      edge: blocker ? rusher.ratings.passRush - blocker.ratings.passBlocking : T.pass.unblockedEdge,
    };
  });
  const best = edges.reduce((m, e) => Math.max(m, e.edge), -Infinity);
  const mean = edges.reduce((s, e) => s + e.edge, 0) / Math.max(1, edges.length);
  const rushKey = h.rushers <= 3 ? "3-" : h.rushers >= 7 ? "7+" : String(h.rushers);
  const basePressure =
    (MATCHUPS.outcomesByRushers as Record<string, { pressureRate: number }>)[rushKey]
      ?.pressureRate ?? 0.3;
  const pressureChance = opts.screen
    ? 0
    : adjustProbability(
        basePressure,
        T.matchup.pressureLogit *
          (T.pass.bestRusherWeight * best + (1 - T.pass.bestRusherWeight) * mean) -
          ctx.homeEdge * T.matchup.pressureLogit +
          (opts.playAction ? T.pass.playActionPressureLogit : 0) +
          T.baseline.pressureLogit,
      );
  const underPressure = rng.chance(pressureChance);
  const won = underPressure ? weightedPick(rng, edges, (e) => Math.max(1, e.edge + 30)) : undefined;
  const pressurer = won?.rusher;
  // Who lost the rep (recorded only: it draws nothing, so games play out the same).
  const beaten = won?.blocker ? { beaten: won.blocker.id } : {};
  const timeToThrow =
    Math.round(
      fromQuantiles(
        MATCHUPS.timeToThrowQuantiles.points,
        underPressure
          ? MATCHUPS.timeToThrowQuantiles.pressured
          : MATCHUPS.timeToThrowQuantiles.clean,
        rng.next(),
      ) * 10,
    ) / 10;
  const pressureInfo = underPressure && pressurer ? { pressure: pressurer.id, ...beaten } : {};

  // 2. Sack or scramble?
  if (underPressure && pressurer) {
    const pocket =
      (qb.ratings.awareness - REF.qbAwareness) * T.pass.sackAwarenessLogit +
      (qb.ratings.agility - REF.qbAgility) * T.pass.sackAgilityLogit;
    const sackChance = adjustProbability(
      pressured.sackRate * T.baseline.sackRateScale,
      (pressurer.ratings.passRush - REF.passRush) * T.pass.sackPassRushLogit - pocket,
    );
    if (rng.chance(sackChance)) {
      const loss = Math.round(fromQuantiles(Q, REAL.pass.sackYardQuantiles, rng.next()));
      const base = {
        kind: "sack" as const,
        passer: qb.id,
        defender: pressurer.id,
        ...beaten,
        ...scheme,
        ...note,
      };
      if (
        ctx.ytg - loss < 100 &&
        rng.chance(REAL.pass.sackFumbleRate * (ctx.weather?.fumbleFactor ?? 1))
      ) {
        const lost = rng.chance(T.fumbleLostShare.sack);
        return {
          details: lost
            ? {
                ...base,
                fumble: { by: qb.id, lost: true, recoveredBy: pressurer.id },
                turnover: true,
              }
            : { ...base, fumble: { by: qb.id, lost: false } },
          gain: loss,
          seconds: T.playSeconds.sack,
          incomplete: false,
          outOfBounds: false,
          ...(lost ? { turnover: { spot: ctx.ytg - loss, returnYards: 0 } } : {}),
          pressured: true,
          throwAway: false,
        };
      }
      return {
        details: base,
        gain: loss,
        seconds: T.playSeconds.sack,
        incomplete: false,
        outOfBounds: false,
        pressured: true,
        throwAway: false,
      };
    }
  }
  const scrambleBase =
    (MATCHUPS.scrambleRateByPressure as Record<string, number>)[
      underPressure ? "pressured" : "clean"
    ] ?? 0.05;
  if (
    !opts.screen &&
    rng.chance(
      adjustProbability(scrambleBase, (qb.ratings.speed - REF.qbSpeed) * T.matchup.scrambleLogit),
    )
  ) {
    const gain = Math.round(
      fromQuantiles(
        Q,
        REAL.pass.scrambleYardQuantiles,
        shiftedUniform(rng, (qb.ratings.speed - REF.qbSpeed) * T.matchup.scrambleYardsShift),
        T.tails.run,
      ),
    );
    const outOfBounds = gain < ctx.ytg && rng.chance(T.outOfBounds.scramble);
    const tackler = h.defense.lb[0] ?? h.defense.s[0] ?? h.defense.dl[0]!;
    return {
      details: {
        kind: "scramble",
        rusher: qb.id,
        tacklers: gain >= ctx.ytg || outOfBounds ? [] : [tackler.id],
        ...(outOfBounds ? { outOfBounds: true } : {}),
        ...scheme,
        ...pressureInfo,
        ...note,
      },
      gain,
      seconds: T.playSeconds.scramble,
      incomplete: false,
      outOfBounds,
      pressured: underPressure,
      throwAway: false,
    };
  }

  // 3. Throw it away under pressure?
  if (underPressure && rng.chance(T.pass.throwAwayWhenPressured)) {
    const target = h.offense.receivers[0] ?? h.offense.tightEnds[0] ?? qb;
    return {
      details: {
        kind: "pass",
        passer: qb.id,
        receiver: target.id,
        complete: false,
        throwAway: true,
        depth: "short",
        ...scheme,
        ...pressureInfo,
        ...note,
      },
      gain: 0,
      seconds: T.playSeconds.incomplete,
      incomplete: true,
      outOfBounds: false,
      pressured: true,
      throwAway: true,
    };
  }

  // 4. Who's open? Receivers against their defenders; the quarterback reads and picks.
  const depth: Depth = opts.screen ? "short" : opts.depth;
  const cover = coverageAssignments(h, depth);
  const slotWeights = [
    T.targetShare.wr1,
    T.targetShare.wr2,
    T.targetShare.wr3,
    T.targetShare.wr4,
    T.targetShare.wr4,
  ];
  const candidates: Receiver[] = [];
  h.offense.receivers.forEach((p, i) =>
    candidates.push({
      player: p,
      weight: slotWeights[i] ?? 0.03,
      defender: cover(p, i),
      openness: 0,
    }),
  );
  h.offense.tightEnds.forEach((p, i) =>
    candidates.push({
      player: p,
      weight: i === 0 ? T.targetShare.te1 : T.targetShare.te2,
      defender: cover(p, i + 3),
      openness: 0,
    }),
  );
  if (depth === "short")
    h.offense.backs.forEach((p, i) =>
      candidates.push({
        player: p,
        weight: i === 0 ? T.targetShare.rb1 : T.targetShare.rb2,
        defender: cover(p, i + 5),
        openness: 0,
      }),
    );
  if (candidates.length === 0)
    candidates.push({ player: qb, weight: 1, defender: h.defense.cb[0]!, openness: 0 });
  // Blitzes leave fewer defenders in coverage.
  const extraRushers = Math.max(0, h.rushers - 4);
  for (const c of candidates) {
    c.openness =
      routeSkill(c.player, depth) -
      coverSkill(c.defender, h.man) +
      extraRushers * T.pass.opennessPerBlitzer +
      rng.gaussian(0, T.pass.opennessNoise);
  }
  // Better decision-makers find the open man more reliably.
  const read = T.pass.readSharpness * (0.5 + qb.ratings.decisionMaking / 100);
  const chosen = weightedPick(
    rng,
    candidates,
    (c) => c.weight * dmath.exp(Math.max(-20, Math.min(20, c.openness * read))),
  );
  const target = chosen.player;
  const route = routeFor(rng, depth, opts.screen);

  // 5. Completion, interception, or incompletion.
  const accuracy = depth === "short" ? qb.ratings.throwAccuracyShort : qb.ratings.throwAccuracyDeep;
  const cov = COVERAGE_EFFECT[h.coverage];
  const completionShift =
    T.baseline.completionLogit +
    (ctx.down === 3 ? T.baseline.thirdDownCompletionLogit : 0) +
    T.matchup.opennessLogit * chosen.openness +
    T.matchup.accuracyLogit * (accuracy - A) +
    T.matchup.catchLogit * (target.ratings.catching - A) +
    (underPressure ? PRESSURE_COMPLETION.yes : PRESSURE_COMPLETION.no) * T.pass.pressureWeight +
    cov.completion +
    (opts.playAction ? T.pass.playActionCompletionLogit : 0) +
    ctx.homeEdge * T.matchup.completionLogit +
    (ctx.passShift ?? 0) +
    (ctx.weather?.completionLogit ?? 0);
  const baseComplete = opts.screen ? T.pass.screenCompletion : REAL.pass.completionByDepth[depth];
  const pComplete = adjustProbability(baseComplete, completionShift);
  const intShift =
    -T.matchup.opennessLogit * chosen.openness +
    T.matchup.decisionLogit * (A - qb.ratings.decisionMaking) +
    T.matchup.ballSkillsLogit * (chosen.defender.ratings.ballSkills - A) -
    ctx.homeEdge * T.matchup.interceptionLogit;
  const pInt = Math.min(
    T.pass.maxInterceptionChance,
    adjustProbability(
      REAL.pass.interceptionByDepth[depth] *
        T.baseline.interceptionRateScale *
        (underPressure ? PRESSURE_INTERCEPTION.yes : PRESSURE_INTERCEPTION.no),
      intShift,
    ),
  );
  const base = {
    kind: "pass" as const,
    passer: qb.id,
    receiver: target.id,
    depth,
    route,
    ...scheme,
    ...pressureInfo,
    ...note,
  };
  // A ball caught behind the line is a screen or a swing, whatever the first read was.
  const routeAt = (air: number) =>
    air <= 0 && route !== "SCREEN"
      ? target.position === "RB" || target.position === "FB"
        ? "SWING"
        : "SCREEN"
      : route;
  const r = rng.next();

  if (r < pComplete) {
    const distanceShift =
      cov.distance +
      (opts.playAction ? T.pass.playActionDistanceShift : 0) +
      extraRushers * T.pass.distancePerBlitzer +
      (ctx.prevent ? T.clock.preventDistanceShift : 0);
    const air = opts.screen
      ? -rng.intBetween(1, 5)
      : Math.min(
          ctx.ytg + 9,
          Math.round(
            fromQuantiles(Q, REAL.pass.airYardQuantiles[depth], shiftedUniform(rng, distanceShift)),
          ),
        );
    const thrown = { ...base, route: routeAt(air) };
    if (air >= ctx.ytg) {
      return {
        details: { ...thrown, complete: true, airYards: ctx.ytg },
        gain: ctx.ytg,
        seconds: T.playSeconds.pass,
        incomplete: false,
        outOfBounds: false,
        pressured: underPressure,
        throwAway: false,
        target,
        airYards: ctx.ytg,
      };
    }
    // After the catch: the receiver against the nearest defender, who may miss.
    const tacklerFirst = chosen.defender;
    let yacShift =
      (afterCatch(target) - tackling(tacklerFirst)) * T.matchup.yacQuantileShift +
      T.baseline.yacQuantileShift +
      distanceShift * T.pass.yacDistanceShare +
      (opts.screen ? T.pass.screenYacShift : 0);
    let missed: number | undefined;
    if (
      rng.chance(
        adjustProbability(
          T.pass.brokenTackle,
          (afterCatch(target) - tackling(tacklerFirst)) * T.run.brokenTackleLogit,
        ),
      )
    ) {
      missed = tacklerFirst.id;
      yacShift += T.run.brokenTackleShift;
    }
    // Short catches: behind the line (screens, swings) the receiver usually has room to run.
    const yacTable =
      depth === "short"
        ? REAL.pass.yacQuantilesShort[air <= 0 ? "behind" : "ahead"]
        : REAL.pass.yacQuantiles[depth];
    const yac = Math.max(
      0,
      Math.round(fromQuantiles(Q, yacTable, shiftedUniform(rng, yacShift), T.tails.yac)),
    );
    // Wind and rain cut how far a catch goes (real yards per catch).
    const gain = Math.min(ctx.ytg, Math.round((air + yac) * (ctx.weather?.catchYardsFactor ?? 1)));
    const tackler = missed !== undefined ? (h.defense.s[0] ?? tacklerFirst) : tacklerFirst;
    const extras = missed !== undefined ? { missedTackles: [missed] } : {};
    if (
      gain < ctx.ytg &&
      ctx.ytg - gain < 100 &&
      rng.chance(REAL.pass.catchFumbleRate * (ctx.weather?.fumbleFactor ?? 1))
    ) {
      const lost = rng.chance(T.fumbleLostShare.catch);
      return {
        details: lost
          ? {
              ...thrown,
              ...extras,
              complete: true,
              airYards: air,
              tacklers: [tackler.id],
              fumble: { by: target.id, lost: true, recoveredBy: tackler.id },
              turnover: true,
            }
          : {
              ...thrown,
              ...extras,
              complete: true,
              airYards: air,
              tacklers: [tackler.id],
              fumble: { by: target.id, lost: false },
            },
        gain,
        seconds: T.playSeconds.pass,
        incomplete: false,
        outOfBounds: false,
        ...(lost ? { turnover: { spot: ctx.ytg - gain, returnYards: 0 } } : {}),
        pressured: underPressure,
        throwAway: false,
        target,
        airYards: air,
      };
    }
    const outOfBounds = gain < ctx.ytg && rng.chance(T.outOfBounds.completion);
    return {
      details: {
        ...thrown,
        ...extras,
        complete: true,
        airYards: air,
        tacklers: gain >= ctx.ytg || outOfBounds ? [] : [tackler.id],
        ...(outOfBounds ? { outOfBounds: true } : {}),
      },
      gain,
      seconds: T.playSeconds.pass,
      incomplete: false,
      outOfBounds,
      pressured: underPressure,
      throwAway: false,
      target,
      airYards: air,
    };
  }

  const air = opts.screen
    ? -2
    : Math.min(
        ctx.ytg + 9,
        Math.round(fromQuantiles(Q, REAL.pass.airYardQuantiles[depth], rng.next())),
      );
  const thrown = { ...base, route: routeAt(air) };
  if (r < pComplete + pInt) {
    // Intercepted: by the man in coverage, or another defensive back.
    const hawk = rng.chance(T.pass.interceptedByCoverer)
      ? chosen.defender
      : weightedPick(
          rng,
          [...h.defense.cb, ...h.defense.s, ...h.defense.lb],
          (p) =>
            (p.position === "LB" ? T.pass.linebackerBallSkillsWeight : 1) * p.ratings.ballSkills,
        );
    const returnYards = Math.round(
      fromQuantiles(Q, REAL.pass.interceptionReturnQuantiles, rng.next(), T.tails.return),
    );
    return {
      details: {
        ...thrown,
        complete: false,
        intercepted: true,
        airYards: air,
        defender: hawk.id,
        returnYards,
        turnover: true,
      },
      gain: 0,
      seconds: T.playSeconds.pass,
      incomplete: false,
      outOfBounds: false,
      turnover: { spot: ctx.ytg - air, returnYards },
      pressured: underPressure,
      throwAway: false,
      target,
      airYards: air,
    };
  }

  // Incomplete: a drop, a breakup, or just off target.
  const dropChance = adjustProbability(
    T.pass.dropShareOfIncompletions,
    (A - target.ratings.catching) * T.pass.dropLogit,
  );
  const drop = rng.chance(dropChance);
  const breakup =
    !drop &&
    rng.chance(
      adjustProbability(T.pass.breakupShareOfIncompletions, -chosen.openness * T.pass.breakupLogit),
    );
  return {
    details: {
      ...thrown,
      complete: false,
      airYards: air,
      ...(drop ? { drop: true } : {}),
      ...(breakup ? { defender: chosen.defender.id, breakup: true } : {}),
    },
    gain: 0,
    seconds: T.playSeconds.incomplete,
    incomplete: true,
    outOfBounds: false,
    pressured: underPressure,
    throwAway: false,
    target,
    airYards: air,
  };
}

/** Real play-action, screen and RPO rates (FTN charting). */
export const PASS_STYLE = {
  playAction: CHARTING.playActionRate,
  screen: CHARTING.screenRate,
  rpo: CHARTING.rpoRate,
  sneak: CHARTING.qbSneakShareOfShortYardage,
};
