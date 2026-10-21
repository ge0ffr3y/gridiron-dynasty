/**
 * Penalties: which fouls happen (at real NFL rates for the situation, tilted
 * by a player's awareness and composure), who commits them, and what each
 * one does (the enforcement rules in the rules file). The offended team then
 * accepts or declines, whichever leaves it better off by expected points.
 */
import type { Rng } from "@fgm/foundation";
import { CALIBRATION_TARGETS, MATCHUPS, TUNING } from "./config";
import type { Huddle } from "./onfield";
import { weightedPick } from "./sample";
import type { ScrimmageResult } from "./scrimmage";
import type { GameRules, LineupPlayer, PenaltyRule } from "./types";

export interface Foul {
  type: string;
  rule: PenaltyRule;
  /** Committed by the offense or the defense (of the team that snapped the ball). */
  side: "offense" | "defense";
  player?: LineupPlayer;
}

type Opportunity = "pre" | "run" | "pass" | "punt" | "kickoff";

const COVERAGE_FOULS = new Set([
  "Defensive Pass Interference",
  "Defensive Holding",
  "Illegal Use of Hands",
]);

const DATA = MATCHUPS.penalties as Record<string, { phase: string; side: string; perGame: number }>;
const plays = CALIBRATION_TARGETS.offensivePlaysPerTeamGame.real;
const passRate = CALIBRATION_TARGETS.passRate.real;
const PER_TEAM_GAME: Record<Opportunity, number> = {
  pre: plays + TUNING.penalties.kickSnapsPerTeamGame,
  run: plays * (1 - passRate),
  pass: plays * passRate,
  punt: CALIBRATION_TARGETS.puntsPerTeamGame.real,
  kickoff: TUNING.penalties.kickoffsPerTeamGame,
};

/** Data phase and side for each kind of opportunity (kick returns are recorded against the receiving team). */
function dataKeys(op: Opportunity, type: string, rule: PenaltyRule): string[] {
  if (op === "punt")
    return [`punt|defense|Offensive Holding`, `punt|defense|Illegal Block Above the Waist`];
  if (op === "kickoff")
    return [`kickoff|offense|Offensive Holding`, `kickoff|offense|Illegal Block Above the Waist`];
  return [`${op}|${rule.side}|${type}`];
}

/** Chance per opportunity of each foul type, from real per-game rates. */
function ratesFor(
  rules: GameRules,
  op: Opportunity,
): { type: string; rule: PenaltyRule; chance: number }[] {
  const out: { type: string; rule: PenaltyRule; chance: number }[] = [];
  for (const [type, rule] of Object.entries(rules.penalties.types)) {
    const fits =
      op === "pre"
        ? rule.phase === "pre"
        : op === "punt" || op === "kickoff"
          ? rule.phase === "return"
          : rule.phase === "live" || (rule.phase === "pass" && op === "pass");
    if (!fits) continue;
    const perGame = dataKeys(op, type, rule).reduce((s, k) => s + (DATA[k]?.perGame ?? 0), 0);
    if (perGame > 0)
      out.push({
        type,
        rule,
        // Pre-snap fouls are never declined, so they need no allowance for declines.
        chance:
          (perGame * (op === "pre" ? 1 : TUNING.penalties.generationScale)) / PER_TEAM_GAME[op],
      });
  }
  return out;
}

const cache = new WeakMap<GameRules, Map<Opportunity, ReturnType<typeof ratesFor>>>();
function rates(rules: GameRules, op: Opportunity) {
  let byOp = cache.get(rules);
  if (!byOp) {
    byOp = new Map();
    cache.set(rules, byOp);
  }
  let r = byOp.get(op);
  if (!r) {
    r = ratesFor(rules, op);
    byOp.set(op, r);
  }
  return r;
}

/** Players less aware and less composed commit more fouls. */
const proneness = (p: LineupPlayer) =>
  Math.max(
    TUNING.penalties.proneness.floor,
    TUNING.penalties.proneness.ceiling - (p.ratings.awareness + p.ratings.composure) / 2,
  );

function culprit(
  rng: Rng,
  type: string,
  side: "offense" | "defense",
  h: Huddle,
  result?: ScrimmageResult,
): LineupPlayer | undefined {
  const o = h.offense;
  const d = h.defense;
  const pick = (list: LineupPlayer[]) =>
    list.length ? weightedPick(rng, list, proneness) : undefined;
  if (side === "offense") {
    if (type === "Delay of Game" || type === "Intentional Grounding") return o.qb;
    if (type === "Offensive Pass Interference") return result?.target ?? pick(o.receivers);
    if (type === "Illegal Formation" || type === "Illegal Shift")
      return pick([...o.receivers, ...o.tightEnds, ...o.backs]);
    return pick([...o.ol, ...o.tightEnds]);
  }
  if (
    type === "Defensive Pass Interference" ||
    type === "Defensive Holding" ||
    type === "Illegal Contact"
  ) {
    return pick([...d.cb, ...d.s]);
  }
  if (type === "Roughing the Passer") return pick(d.rushers.length ? d.rushers : d.dl);
  if (["Defensive Offside", "Neutral Zone Infraction", "Encroachment"].includes(type))
    return pick(d.dl);
  if (type === "Defensive Too Many Men on Field") return undefined;
  return pick([...d.dl, ...d.lb, ...d.s, ...d.cb]);
}

/** A foul before the snap (no play)? */
export function preSnapFoul(rng: Rng, rules: GameRules, h: Huddle): Foul | null {
  for (const r of rates(rules, "pre")) {
    if (rng.chance(r.chance))
      return {
        type: r.type,
        rule: r.rule,
        side: r.rule.side,
        player: culprit(rng, r.type, r.rule.side, h),
      };
  }
  return null;
}

/** A foul during a run or pass? Pass interference is far likelier on deep balls; roughing on hits. */
export function liveFoul(
  rng: Rng,
  rules: GameRules,
  h: Huddle,
  kind: "run" | "pass",
  result: ScrimmageResult,
): Foul | null {
  if (result.details.kind === "scramble") kind = "run";
  for (const r of rates(rules, kind)) {
    let chance = r.chance;
    if (r.type === "Defensive Pass Interference" || r.type === "Offensive Pass Interference") {
      const depth = result.details.depth ?? "short";
      chance *=
        result.details.kind === "pass" && !result.throwAway
          ? TUNING.penalties.interferenceByDepth[depth]
          : 0;
    }
    // Coverage fouls are mostly called on throws they spoil.
    if (kind === "pass" && COVERAGE_FOULS.has(r.type)) {
      chance *= result.incomplete
        ? TUNING.penalties.coverageFoulOnIncompletion
        : TUNING.penalties.coverageFoulOnOtherPasses;
    }
    if (r.type === "Roughing the Passer")
      chance *= result.pressured
        ? TUNING.penalties.roughingWhenPressured
        : TUNING.penalties.roughingWhenClean;
    if (r.type === "Intentional Grounding")
      chance = result.throwAway ? TUNING.penalties.groundingOfThrowAways : 0;
    if (rng.chance(chance))
      return {
        type: r.type,
        rule: r.rule,
        side: r.rule.side,
        player: culprit(rng, r.type, r.rule.side, h, result),
      };
  }
  return null;
}

/** A foul by the return team on a punt or kickoff return? */
export function returnFoul(
  rng: Rng,
  rules: GameRules,
  kick: "punt" | "kickoff",
  returners: LineupPlayer[],
): Foul | null {
  for (const r of rates(rules, kick)) {
    if (rng.chance(r.chance))
      return {
        type: r.type,
        rule: r.rule,
        side: "offense",
        player: returners.length ? weightedPick(rng, returners, proneness) : undefined,
      };
  }
  return null;
}

// --- Expected points: how good a down, distance and field position is -----------------

const EP = MATCHUPS.expectedPoints.table as Record<string, number>;

/** Distance-to-go groups in the table: every yard up to 10, then 11-14 and 15+ (as in the pipeline). */
function bucket(toGo: number): string {
  return toGo <= 10 ? String(Math.max(1, toGo)) : toGo <= 14 ? "11-14" : "15+";
}
/** A typical distance for each group (for finding the nearest measured cell). */
const BUCKET_YARDS = (b: string) => (b === "11-14" ? 12.5 : b === "15+" ? 17 : Number(b));
/** Yards of distance-to-go that count as much as one 5-yard field-position band when a cell is missing. */
const TOGO_PER_BAND = 2;

/** The measured cells for each down, for falling back to the nearest one. */
const CELLS = new Map<number, { toGo: number; band: number; value: number }[]>();
for (const [key, value] of Object.entries(EP)) {
  const [d, b, band] = key.split("|");
  const list = CELLS.get(Number(d)) ?? [];
  list.push({ toGo: BUCKET_YARDS(b!), band: Number(band), value });
  CELLS.set(Number(d), list);
}
const lookups = new Map<string, number>();

/** Expected points for the offense with the ball at `ytg` yards to goal. */
export function expectedPoints(down: number, toGo: number, ytg: number): number {
  const d = Math.min(4, Math.max(1, down));
  const band = Math.min(19, Math.floor((Math.max(1, ytg) - 1) / 5));
  const key = `${d}|${bucket(toGo)}|${band}`;
  const exact = EP[key];
  if (exact !== undefined) return exact;
  // A combination too rare to measure: use the nearest measured one.
  const cached = lookups.get(key);
  if (cached !== undefined) return cached;
  const want = BUCKET_YARDS(bucket(toGo));
  let best = 0;
  let bestDistance = Infinity;
  for (const cell of CELLS.get(d) ?? []) {
    const distance = Math.abs(cell.band - band) + Math.abs(cell.toGo - want) / TOGO_PER_BAND;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = cell.value;
    }
  }
  lookups.set(key, best);
  return best;
}

/** Value of a touchdown for the scoring team (seven points, less what the kickoff gives back). */
export const TOUCHDOWN_VALUE = TUNING.penalties.touchdownValue;
