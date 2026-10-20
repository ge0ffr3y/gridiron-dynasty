/**
 * The play-by-play engine: one game, snap by snap.
 *
 * Field position is "yards to goal" for the team with the ball (75 = own 25).
 * Every random draw comes from the game's own seeded generator, so the same
 * inputs and seed always produce the same game, play for play.
 */
import { dmath, type Rng } from "@fgm/foundation";
import { buildBoxScore } from "./boxscore";
import { AVERAGE_RATING, CALIBRATION_TARGETS, REAL, TUNING } from "./config";
import {
  callPlay,
  goForTwo,
  otherSide,
  tempo,
  wantsTimeout,
  type Call,
  type Situation,
} from "./playcall";
import { adjustProbability, fromQuantiles, shiftedUniform, weightedPick } from "./sample";
import type {
  GameInput,
  GameOutput,
  Lineup,
  LineupPlayer,
  OvertimeRules,
  Play,
  Side,
} from "./types";
import { unitsOf, type Units } from "./units";

const Q = REAL.quantilePoints;
const SACK_PER_DROPBACK =
  CALIBRATION_TARGETS.sackRate.real * (1 - REAL.pass.scrambleShareOfDropbacks);
const MAX_PLAYS = 400;

type Depth = "short" | "medium" | "deep";

/** Where the overtime stands under the both-teams-possess rule. */
type OvertimePhase = "first" | "second" | "sudden";

export class GameError extends Error {}

class Game {
  private readonly lineup: Record<Side, Lineup>;
  private readonly units: Record<Side, Units>;
  readonly plays: Play[] = [];

  quarter = 1;
  clock: number;
  offense: Side = "home";
  down = 1;
  toGo = 10;
  ytg = 75;
  score: Record<Side, number> = { home: 0, away: 0 };
  touchdowns: Record<Side, number> = { home: 0, away: 0 };
  timeouts: Record<Side, number>;
  clockRunning = false;
  /** The last play went out of bounds while the clock keeps running (it restarts on the spot). */
  restartsOnSpot = false;
  warningGiven = false;
  openingReceiver: Side = "home";
  over = false;
  overtime: {
    active: boolean;
    rules: OvertimeRules;
    first: Side;
    phase: OvertimePhase;
    periods: number;
  };
  possessionSeconds: Record<Side, number> = { home: 0, away: 0 };
  drives: Record<Side, number> = { home: 0, away: 0 };
  periodPoints: Record<Side, number[]> = { home: [0], away: [0] };

  constructor(
    private readonly input: GameInput,
    private readonly rng: Rng,
  ) {
    this.lineup = { home: input.home.lineup, away: input.away.lineup };
    this.units = { home: unitsOf(input.home.lineup), away: unitsOf(input.away.lineup) };
    if (!input.neutral) {
      // Home-field advantage: the home team plays a little above its ratings.
      const h = this.units.home;
      for (const key of Object.keys(h) as (keyof Units)[]) h[key] += TUNING.homeFieldEdge;
    }
    this.clock = input.rules.quarterMinutes * 60;
    this.timeouts = { home: input.rules.timeoutsPerHalf, away: input.rules.timeoutsPerHalf };
    const ot = input.playoff ? input.rules.overtime.playoffs : input.rules.overtime.regularSeason;
    this.overtime = { active: false, rules: ot, first: "home", phase: "first", periods: 0 };
  }

  // --- Helpers -------------------------------------------------------------------

  get defense(): Side {
    return otherSide(this.offense);
  }

  private margin(side: Side): number {
    return this.score[side] - this.score[otherSide(side)];
  }

  private situation(): Situation {
    const k = this.units[this.offense];
    return {
      quarter: this.quarter,
      clock: this.clock,
      down: this.down,
      toGo: this.toGo,
      yardsToGoal: this.ytg,
      margin: this.margin(this.offense),
      offenseTimeouts: this.timeouts[this.offense],
      defenseTimeouts: this.timeouts[this.defense],
      clockRunning: this.clockRunning,
      overtime: this.overtime.active,
      fieldGoalRange:
        TUNING.fieldGoal.maxDistance +
        (k.kickPower - AVERAGE_RATING) * TUNING.fieldGoal.rangePerPowerPoint,
      // On the second overtime possession, a trailing team can't give the ball back.
      mustScore:
        this.overtime.active && this.overtime.phase === "second" && this.margin(this.offense) < 0,
    };
  }

  /** Is this a period whose last minutes stop the clock on out-of-bounds plays? */
  private outOfBoundsStopsClock(): boolean {
    const late = this.input.rules.outOfBoundsStopsClockLastSeconds;
    if (this.quarter === 2) return this.clock <= late.firstHalf;
    if (this.quarter >= 4) return this.clock <= late.secondHalf;
    return false;
  }

  private warningApplies(): boolean {
    return (
      this.input.rules.twoMinuteWarning &&
      !this.overtime.active &&
      (this.quarter === 2 || this.quarter === 4) &&
      !this.warningGiven
    );
  }

  private record(
    play: Omit<Play, "quarter" | "clock" | "offense" | "down" | "toGo" | "yardsToGoal" | "score">,
    at: { clock: number; offense?: Side; down?: number; toGo?: number; ytg?: number },
  ): Play {
    const full: Play = {
      quarter: this.quarter,
      clock: at.clock,
      offense: at.offense ?? this.offense,
      down: at.down ?? this.down,
      toGo: at.toGo ?? this.toGo,
      yardsToGoal: at.ytg ?? this.ytg,
      ...play,
      score: [this.score.home, this.score.away],
    };
    this.plays.push(full);
    if (this.plays.length > MAX_PLAYS) throw new GameError("game ran too long");
    return full;
  }

  /** Runs time off the clock, stopping at the two-minute warning. Returns false if the period ended. */
  private runOff(seconds: number, side: Side): boolean {
    const before = this.clock;
    let after = Math.max(0, before - seconds);
    if (this.warningApplies() && before > 120 && after < 120) after = 120;
    this.possessionSeconds[side] += before - after;
    this.clock = after;
    if (this.warningApplies() && before > 120 && after === 120) {
      this.warningGiven = true;
      this.clockRunning = false;
      this.record({ kind: "twoMinuteWarning", yards: 0 }, { clock: 120 });
    }
    return this.clock > 0;
  }

  /** Time a play takes; if it crosses 2:00 the warning comes right after it. */
  private playTime(seconds: number, side: Side): void {
    const before = this.clock;
    this.clock = Math.max(0, before - seconds);
    this.possessionSeconds[side] += before - this.clock;
    if (this.warningApplies() && before > 120 && this.clock <= 120) this.pendingWarning = true;
  }
  private pendingWarning = false;

  private flushWarning(): void {
    if (!this.pendingWarning) return;
    this.pendingWarning = false;
    this.warningGiven = true;
    this.clockRunning = false;
    this.record({ kind: "twoMinuteWarning", yards: 0 }, { clock: this.clock });
  }

  private addPoints(side: Side, points: number): void {
    this.score[side] += points;
    const periods = this.periodPoints[side];
    periods[periods.length - 1] = (periods[periods.length - 1] as number) + points;
  }

  private newPossession(side: Side, ytg: number): void {
    this.offense = side;
    this.ytg = Math.min(99, Math.max(1, ytg));
    this.down = 1;
    this.toGo = Math.min(10, this.ytg);
    this.clockRunning = false;
    this.restartsOnSpot = false;
    this.drives[side] += 1;
    if (this.overtime.active) this.overtimePossessionChange(side);
  }

  // --- Overtime -----------------------------------------------------------------------

  /** Called whenever a new possession starts in overtime. */
  private overtimePossessionChange(side: Side): void {
    const ot = this.overtime;
    if (!ot.rules.bothTeamsPossess || ot.phase === "sudden") return;
    if (ot.phase === "first" && side !== ot.first) ot.phase = "second";
    else if (ot.phase === "second" && side === ot.first) {
      // The second team's possession is over.
      ot.phase = "sudden";
      if (this.score.home !== this.score.away) this.over = true;
    }
  }

  /** After any score in overtime: does the game end? */
  private overtimeScoreCheck(scorer: Side, byDefense: boolean): void {
    const ot = this.overtime;
    if (!ot.active || this.score.home === this.score.away) return;
    if (!ot.rules.bothTeamsPossess || ot.phase === "sudden") {
      this.over = true;
      return;
    }
    // A defensive score on the first possession ends it; so does the second team taking the lead.
    if (ot.phase === "first" && byDefense) this.over = true;
    if (ot.phase === "second" && this.margin(scorer) > 0 && scorer !== ot.first) this.over = true;
  }

  // --- Kicks and scores --------------------------------------------------------------

  private kickoff(kicking: Side, fromSafety = false): void {
    const receiving = otherSide(kicking);
    const rules = this.input.rules.kickoff;
    const kicker = this.lineup[kicking].k;
    const returner = this.lineup[receiving].returner;
    const k = REAL.kicking;
    const at = {
      clock: this.clock,
      offense: kicking,
      down: 0,
      toGo: 0,
      ytg: fromSafety ? 100 - this.input.rules.safetyFreeKickFrom : 65,
    };
    const r = this.rng.next();
    if (!fromSafety && r < k.kickoffTouchbackRate) {
      this.record({ kind: "kickoff", yards: 0, kicker: kicker.id, touchback: true }, at);
      this.newPossession(receiving, 100 - rules.touchbackSpot);
      return;
    }
    if (!fromSafety && r < k.kickoffTouchbackRate + k.kickoffOutOfBoundsRate) {
      this.record({ kind: "kickoff", yards: 0, kicker: kicker.id, outOfBounds: true }, at);
      this.newPossession(receiving, 100 - rules.shortOrOutOfBoundsSpot);
      return;
    }
    const speedShift = (returner.ratings.speed - 85) * 0.003;
    let start = Math.round(
      fromQuantiles(
        Q,
        k.kickoffReturnStartQuantiles,
        shiftedUniform(this.rng, speedShift),
        TUNING.tails.return,
      ),
    );
    if (fromSafety) start = Math.min(60, start + 12);
    // Where the returner caught it (for return yardage): in or near his own end zone.
    const catchSpot = fromSafety ? 15 + this.rng.int(15) : this.rng.int(10) - 2;
    const touchdown =
      this.rng.chance(
        k.kickoffReturnTdRate / (1 - k.kickoffTouchbackRate - k.kickoffOutOfBoundsRate),
      ) || start >= 100;
    this.playTime(TUNING.playSeconds.kickoffReturn, receiving);
    if (touchdown) {
      this.addPoints(receiving, 6);
      this.touchdowns[receiving] += 1;
      this.record(
        {
          kind: "kickoff",
          yards: 0,
          kicker: kicker.id,
          returner: returner.id,
          returnYards: 100 - catchSpot,
          touchdown: receiving,
        },
        at,
      );
      this.afterTouchdown(receiving, false);
      return;
    }
    this.record(
      {
        kind: "kickoff",
        yards: 0,
        kicker: kicker.id,
        returner: returner.id,
        returnYards: Math.max(0, start - catchSpot),
        tacklers: [this.tackler(kicking, "pass").id],
      },
      at,
    );
    this.newPossession(receiving, 100 - start);
  }

  /**
   * Touchdown scored by `side`: try for one or two, then kick off.
   * `byDefense`: scored by the team without the ball (interception or punt return).
   */
  private afterTouchdown(side: Side, byDefense: boolean): void {
    this.overtimeScoreCheck(side, byDefense);
    if (this.over) return;
    const margin = this.margin(side);
    const decision = goForTwo(this.rng, this.quarter, this.clock, margin);
    const units = this.units[side];
    const at = { clock: this.clock, offense: side, down: 0, toGo: 0 };
    if (decision.go) {
      const lineup = this.lineup[side];
      const edge =
        (units.passer + units.rusher) / 2 -
        (this.units[otherSide(side)].coverage + this.units[otherSide(side)].runDefense) / 2;
      const good = this.rng.chance(
        adjustProbability(REAL.kicking.twoPointSuccessRate, edge * TUNING.matchup.twoPointLogit),
      );
      const pass = this.rng.chance(0.6);
      const target = pass ? this.pickTarget(side) : this.pickRusher(side);
      if (good) this.addPoints(side, 2);
      this.record(
        pass
          ? {
              kind: "twoPoint",
              yards: 0,
              good,
              passer: lineup.qb.id,
              receiver: target.id,
              ...(decision.note ? { note: decision.note } : {}),
            }
          : {
              kind: "twoPoint",
              yards: 0,
              good,
              rusher: target.id,
              ...(decision.note ? { note: decision.note } : {}),
            },
        { ...at, ytg: this.input.rules.twoPointSpot },
      );
    } else {
      const ytg = this.input.rules.extraPointSpot;
      const good = this.rng.chance(this.fieldGoalChance(side, ytg + TUNING.fieldGoal.snapYards));
      if (good) this.addPoints(side, 1);
      this.record(
        {
          kind: "extraPoint",
          yards: 0,
          good,
          kicker: this.lineup[side].k.id,
          kickDistance: ytg + TUNING.fieldGoal.snapYards,
        },
        { ...at, ytg },
      );
    }
    this.overtimeScoreCheck(side, false);
    if (!this.over) this.kickoff(side);
  }

  private fieldGoalChance(side: Side, distance: number): number {
    const { a, b } = REAL.kicking.fieldGoalLogistic;
    const u = this.units[side];
    const base = dmath.logistic(a + b * distance);
    const k = TUNING.averageKicker;
    const skill = u.kickAccuracy - k + (distance > 45 ? (u.kickPower - k) * 0.4 : 0);
    return adjustProbability(base, skill * TUNING.matchup.fieldGoalLogit);
  }

  /** After a safety (points already added): the conceding team free-kicks. */
  private afterSafety(conceding: Side): void {
    const scorer = otherSide(conceding);
    this.overtimeScoreCheck(scorer, true);
    if (!this.over) this.kickoff(conceding, true);
  }

  // --- Choosing players ----------------------------------------------------------------

  private pickRusher(side: Side): LineupPlayer {
    const l = this.lineup[side];
    const s = TUNING.rusherShare;
    const options: [LineupPlayer | undefined, number][] = [
      [l.rb[0], s.rb1],
      [l.rb[1], s.rb2],
      [l.qb, s.qb * (l.qb.ratings.speed / 70)],
      [l.wr[0], s.wr],
      [l.te[0], s.fb],
    ];
    const valid = options.filter((o): o is [LineupPlayer, number] => o[0] !== undefined);
    return weightedPick(this.rng, valid, (o) => o[1])[0];
  }

  private pickTarget(side: Side): LineupPlayer {
    const l = this.lineup[side];
    const s = TUNING.targetShare;
    const options: [LineupPlayer | undefined, number][] = [
      [l.wr[0], s.wr1],
      [l.wr[1], s.wr2],
      [l.wr[2], s.wr3],
      [l.wr[3], s.wr4],
      [l.te[0], s.te1],
      [l.te[1], s.te2],
      [l.rb[0], s.rb1],
      [l.rb[1], s.rb2],
    ];
    const valid = options.filter((o): o is [LineupPlayer, number] => o[0] !== undefined);
    // Better receivers get a bit more of the ball.
    return weightedPick(this.rng, valid, (o) => o[1] * (0.6 + o[0].overall / 190))[0];
  }

  private tackler(defense: Side, kind: "run" | "pass"): LineupPlayer {
    const l = this.lineup[defense];
    const share = TUNING.tackleShare[kind];
    const pool: [LineupPlayer, number][] = [
      ...l.dl.map((p) => [p, share.dl / Math.max(1, l.dl.length)] as [LineupPlayer, number]),
      ...l.lb.map((p) => [p, share.lb / Math.max(1, l.lb.length)] as [LineupPlayer, number]),
      ...l.cb.map((p) => [p, share.cb / Math.max(1, l.cb.length)] as [LineupPlayer, number]),
      ...l.s.map((p) => [p, share.s / Math.max(1, l.s.length)] as [LineupPlayer, number]),
    ];
    return weightedPick(this.rng, pool, (o) => o[1] * (0.5 + o[0].ratings.tackling / 100))[0];
  }

  private passRusher(defense: Side): LineupPlayer {
    const l = this.lineup[defense];
    return weightedPick(
      this.rng,
      [...l.dl, ...l.lb],
      (p) => (p.position === "EDGE" ? 2 : p.position === "LB" ? 0.4 : 1) * p.ratings.passRush,
    );
  }

  private ballHawk(defense: Side): LineupPlayer {
    const l = this.lineup[defense];
    return weightedPick(
      this.rng,
      [...l.cb, ...l.s, ...l.lb],
      (p) => (p.position === "LB" ? 0.4 : 1) * p.ratings.ballSkills,
    );
  }

  // --- The snap ------------------------------------------------------------------------

  /** One snap: clock management, the call, and the result. */
  snap(): void {
    // Before the snap: timeouts and the time that runs off while the clock is running.
    if (this.clockRunning) {
      const s = this.situation();
      const defense = this.defense;
      if (this.timeouts[this.offense] > 0 && wantsTimeout("offense", s)) {
        this.callTimeout(this.offense);
      } else if (this.timeouts[defense] > 0 && wantsTimeout("defense", s)) {
        this.callTimeout(defense);
      }
    }
    if (this.clockRunning) {
      const seconds = this.restartsOnSpot ? TUNING.tempo.afterOutOfBounds : tempo(this.situation());
      if (!this.runOff(seconds, this.offense)) return; // the period ended before the snap
    }
    const call = callPlay(this.rng, this.situation());
    this.resolve(call);
    this.flushWarning();
  }

  private callTimeout(side: Side): void {
    this.timeouts[side] -= 1;
    this.clockRunning = false;
    this.record(
      {
        kind: "timeout",
        yards: 0,
        team: side,
        note: side === this.offense ? "Offense stops the clock" : "Defense stops the clock",
      },
      { clock: this.clock },
    );
  }

  private resolve(call: Call): void {
    switch (call.kind) {
      case "run":
        return this.run(call.inside, call.note);
      case "pass":
        return this.dropback(call.depth, call.note);
      case "punt":
        return this.punt(call.note);
      case "fieldGoal":
        return this.fieldGoal(call.note);
      case "kneel":
        return this.kneel(call.note);
      case "spike":
        return this.spike(call.note);
    }
  }

  /** Moves the ball after a scrimmage play and handles downs, scores and safeties. */
  private advance(
    gain: number,
    play: Omit<
      Play,
      "quarter" | "clock" | "offense" | "down" | "toGo" | "yardsToGoal" | "score" | "yards"
    >,
    at: { clock: number },
    stopsClock: boolean,
  ): void {
    const offense = this.offense;
    const before = { down: this.down, toGo: this.toGo, ytg: this.ytg };
    const newYtg = this.ytg - gain;
    if (newYtg <= 0) {
      this.addPoints(offense, 6);
      this.touchdowns[offense] += 1;
      this.record(
        { ...play, yards: this.ytg, touchdown: offense, firstDown: true },
        { ...at, ...before },
      );
      this.afterTouchdown(offense, false);
      return;
    }
    if (newYtg >= 100) {
      this.addPoints(otherSide(offense), 2);
      this.record({ ...play, yards: gain, safety: true }, { ...at, ...before });
      this.afterSafety(offense);
      return;
    }
    const firstDown = gain >= this.toGo;
    const turnoverOnDowns = !firstDown && this.down === 4;
    this.record(
      {
        ...play,
        yards: gain,
        ...(firstDown ? { firstDown: true } : {}),
        ...(turnoverOnDowns ? { turnoverOnDowns: true } : {}),
      },
      { ...at, ...before },
    );
    if (turnoverOnDowns) {
      this.newPossession(this.defense, 100 - newYtg);
      return;
    }
    this.ytg = newYtg;
    if (firstDown) {
      this.down = 1;
      this.toGo = Math.min(10, newYtg);
    } else {
      this.down += 1;
      this.toGo -= gain;
    }
    this.clockRunning = !stopsClock;
  }

  /** A fumble or interception: the defense takes over at `ytgOffenseFrame` and may return it. */
  private turnover(ytgOffenseFrame: number): void {
    this.newPossession(this.defense, 100 - ytgOffenseFrame);
  }

  private run(inside: boolean, note?: string): void {
    const at = { clock: this.clock };
    const off = this.units[this.offense];
    const def = this.units[this.defense];
    const rusher = this.pickRusher(this.offense);
    const rusherSkill = rusher.position === "QB" ? rusher.ratings.speed : off.rusher;
    const edge =
      0.5 * (off.runBlocking - AVERAGE_RATING) +
      0.5 * (rusherSkill - AVERAGE_RATING) -
      (def.runDefense - AVERAGE_RATING);
    const u = shiftedUniform(
      this.rng,
      edge * TUNING.matchup.runQuantileShift + TUNING.baseline.runQuantileShift,
    );
    const gain = Math.round(fromQuantiles(Q, REAL.run.yardQuantiles, u, TUNING.tails.run));
    this.playTime(TUNING.playSeconds.run, this.offense);
    const direction: "left" | "middle" | "right" = inside
      ? "middle"
      : this.rng.chance(0.5)
        ? "left"
        : "right";
    const outOfBounds =
      gain < this.ytg &&
      this.rng.chance(inside ? TUNING.outOfBounds.insideRun : TUNING.outOfBounds.outsideRun);
    const base = { kind: "run" as const, rusher: rusher.id, direction, ...(note ? { note } : {}) };

    // Fumble?
    const fumbleChance = adjustProbability(
      REAL.run.fumbleRate,
      (AVERAGE_RATING - rusher.ratings.ballSecurity) * 0.03,
    );
    if (gain < this.ytg && this.ytg - gain < 100 && this.rng.chance(fumbleChance)) {
      const lost = this.rng.chance(TUNING.fumbleLostShare.run);
      const recoverer = this.tackler(this.defense, "run");
      if (lost) {
        const at2 = { clock: at.clock, down: this.down, toGo: this.toGo, ytg: this.ytg };
        this.record(
          {
            ...base,
            yards: gain,
            tacklers: [recoverer.id],
            fumble: { by: rusher.id, lost: true, recoveredBy: recoverer.id },
            turnover: true,
          },
          at2,
        );
        this.turnover(this.ytg - gain);
        return;
      }
      this.advance(
        gain,
        {
          ...base,
          tacklers: [this.tackler(this.defense, "run").id],
          fumble: { by: rusher.id, lost: false },
        },
        at,
        false,
      );
      return;
    }
    const tacklers = gain >= this.ytg ? [] : [this.tackler(this.defense, "run").id];
    this.advance(
      gain,
      { ...base, tacklers, ...(outOfBounds ? { outOfBounds: true } : {}) },
      at,
      outOfBounds && this.outOfBoundsStopsClock(),
    );
    this.restartsOnSpot = outOfBounds && !this.outOfBoundsStopsClock();
  }

  private dropback(depth: Depth, note?: string): void {
    const at = { clock: this.clock };
    const off = this.units[this.offense];
    const def = this.units[this.defense];
    const qb = this.lineup[this.offense].qb;
    this.restartsOnSpot = false;

    // Sack?
    const sackEdge =
      def.passRush -
      AVERAGE_RATING -
      (off.passProtection - AVERAGE_RATING) -
      0.3 * (qb.ratings.awareness - AVERAGE_RATING);
    if (
      this.rng.chance(
        adjustProbability(
          SACK_PER_DROPBACK * TUNING.baseline.sackRateScale,
          sackEdge * TUNING.matchup.sackLogit,
        ),
      )
    ) {
      const sacker = this.passRusher(this.defense);
      const loss = Math.round(fromQuantiles(Q, REAL.pass.sackYardQuantiles, this.rng.next()));
      this.playTime(TUNING.playSeconds.sack, this.offense);
      const base = {
        kind: "sack" as const,
        passer: qb.id,
        defender: sacker.id,
        ...(note ? { note } : {}),
      };
      if (this.ytg - loss < 100 && this.rng.chance(REAL.pass.sackFumbleRate)) {
        const lost = this.rng.chance(TUNING.fumbleLostShare.sack);
        if (lost) {
          this.record(
            {
              ...base,
              yards: loss,
              fumble: { by: qb.id, lost: true, recoveredBy: sacker.id },
              turnover: true,
            },
            { clock: at.clock },
          );
          this.turnover(this.ytg - loss);
          return;
        }
        this.advance(loss, { ...base, fumble: { by: qb.id, lost: false } }, at, false);
        return;
      }
      this.advance(loss, base, at, false);
      return;
    }

    // Scramble?
    const scrambleChance = adjustProbability(
      REAL.pass.scrambleShareOfDropbacks,
      (qb.ratings.speed - 70) * TUNING.matchup.scrambleLogit,
    );
    if (this.rng.chance(scrambleChance)) {
      const gain = Math.round(
        fromQuantiles(
          Q,
          REAL.pass.scrambleYardQuantiles,
          shiftedUniform(this.rng, (qb.ratings.speed - 70) * 0.003),
          TUNING.tails.run,
        ),
      );
      this.playTime(TUNING.playSeconds.scramble, this.offense);
      const outOfBounds = gain < this.ytg && this.rng.chance(TUNING.outOfBounds.scramble);
      const tacklers =
        gain >= this.ytg || outOfBounds ? [] : [this.tackler(this.defense, "pass").id];
      this.advance(
        gain,
        {
          kind: "scramble",
          rusher: qb.id,
          tacklers,
          ...(outOfBounds ? { outOfBounds: true } : {}),
          ...(note ? { note } : {}),
        },
        at,
        outOfBounds && this.outOfBoundsStopsClock(),
      );
      this.restartsOnSpot = outOfBounds && !this.outOfBoundsStopsClock();
      return;
    }

    // The throw.
    const target = this.pickTarget(this.offense);
    const direction = this.rng.pick(["left", "middle", "right"] as const);
    const passEdge =
      0.6 * (off.passer - AVERAGE_RATING) +
      0.4 * (off.receivers - AVERAGE_RATING) -
      (def.coverage - AVERAGE_RATING) +
      0.3 * (target.overall - off.receivers);
    const pComplete = adjustProbability(
      REAL.pass.completionByDepth[depth],
      passEdge * TUNING.matchup.completionLogit +
        TUNING.baseline.completionLogit +
        (this.down === 3 ? TUNING.baseline.thirdDownCompletionLogit : 0),
    );
    const pInt = adjustProbability(
      REAL.pass.interceptionByDepth[depth] * TUNING.baseline.interceptionRateScale,
      (def.coverage - AVERAGE_RATING - (off.passer - AVERAGE_RATING)) *
        TUNING.matchup.interceptionLogit,
    );
    const r = this.rng.next();
    const base = {
      kind: "pass" as const,
      passer: qb.id,
      receiver: target.id,
      depth,
      direction,
      ...(note ? { note } : {}),
    };

    if (r < pComplete) {
      // Caught. Air yards can't go past the back of the end zone.
      const air = Math.min(
        this.ytg + 9,
        Math.round(fromQuantiles(Q, REAL.pass.airYardQuantiles[depth], this.rng.next())),
      );
      this.playTime(TUNING.playSeconds.pass, this.offense);
      if (air >= this.ytg) {
        this.advance(this.ytg, { ...base, complete: true, airYards: this.ytg }, at, true);
        return;
      }
      const yacEdge = off.receivers - AVERAGE_RATING - (def.tackling - AVERAGE_RATING);
      const yac = Math.max(
        0,
        Math.round(
          fromQuantiles(
            Q,
            REAL.pass.yacQuantiles[depth],
            shiftedUniform(
              this.rng,
              yacEdge * TUNING.matchup.yacQuantileShift + TUNING.baseline.yacQuantileShift,
            ),
            TUNING.tails.yac,
          ),
        ),
      );
      const gain = air + yac;
      if (gain < this.ytg && this.ytg - gain < 100 && this.rng.chance(REAL.pass.catchFumbleRate)) {
        const lost = this.rng.chance(TUNING.fumbleLostShare.catch);
        const recoverer = this.tackler(this.defense, "pass");
        if (lost) {
          this.record(
            {
              ...base,
              yards: gain,
              complete: true,
              airYards: air,
              tacklers: [recoverer.id],
              fumble: { by: target.id, lost: true, recoveredBy: recoverer.id },
              turnover: true,
            },
            { clock: at.clock },
          );
          this.turnover(this.ytg - gain);
          return;
        }
        this.advance(
          gain,
          {
            ...base,
            complete: true,
            airYards: air,
            tacklers: [recoverer.id],
            fumble: { by: target.id, lost: false },
          },
          at,
          false,
        );
        return;
      }
      const outOfBounds = gain < this.ytg && this.rng.chance(TUNING.outOfBounds.completion);
      const tacklers =
        gain >= this.ytg || outOfBounds ? [] : [this.tackler(this.defense, "pass").id];
      this.advance(
        gain,
        {
          ...base,
          complete: true,
          airYards: air,
          tacklers,
          ...(outOfBounds ? { outOfBounds: true } : {}),
        },
        at,
        outOfBounds && this.outOfBoundsStopsClock(),
      );
      this.restartsOnSpot = outOfBounds && !this.outOfBoundsStopsClock();
      return;
    }

    if (r < pComplete + pInt) {
      // Intercepted.
      const air = Math.min(
        this.ytg + 9,
        Math.round(fromQuantiles(Q, REAL.pass.airYardQuantiles[depth], this.rng.next())),
      );
      const hawk = this.ballHawk(this.defense);
      const spotOffenseFrame = this.ytg - air;
      // The defense's field position after the catch: in the end zone it's a touchback unless returned out.
      let defenseYtg = spotOffenseFrame <= 0 ? 100 : 100 - spotOffenseFrame;
      const returnYards = Math.round(
        fromQuantiles(
          Q,
          REAL.pass.interceptionReturnQuantiles,
          this.rng.next(),
          TUNING.tails.return,
        ),
      );
      this.playTime(TUNING.playSeconds.pass, this.offense);
      const defense = this.defense;
      if (defenseYtg - returnYards <= 0) {
        this.addPoints(defense, 6);
        this.touchdowns[defense] += 1;
        this.record(
          {
            ...base,
            yards: 0,
            intercepted: true,
            airYards: air,
            defender: hawk.id,
            returnYards: defenseYtg,
            turnover: true,
            touchdown: defense,
          },
          { clock: at.clock },
        );
        this.offense = defense;
        this.drives[defense] += 1;
        this.afterTouchdown(defense, true);
        return;
      }
      defenseYtg -= returnYards;
      if (defenseYtg >= 100) defenseYtg = 80; // touchback
      this.record(
        {
          ...base,
          yards: 0,
          intercepted: true,
          airYards: air,
          defender: hawk.id,
          returnYards,
          turnover: true,
          tacklers: [this.tackler(this.offense, "pass").id],
        },
        { clock: at.clock },
      );
      this.newPossession(defense, defenseYtg);
      return;
    }

    // Incomplete: the clock stops.
    this.playTime(TUNING.playSeconds.incomplete, this.offense);
    this.advance(0, { ...base, complete: false }, at, true);
  }

  private punt(note?: string): void {
    const at = { clock: this.clock };
    const k = REAL.kicking;
    const punter = this.lineup[this.offense].p;
    const receiving = this.defense;
    const returner = this.lineup[receiving].returner;
    this.playTime(TUNING.playSeconds.punt, this.offense);
    const base = { kind: "punt" as const, kicker: punter.id, ...(note ? { note } : {}) };
    if (this.rng.chance(k.puntBlockedRate)) {
      this.record({ ...base, yards: 0, kickDistance: 0, turnover: true }, at);
      this.newPossession(receiving, Math.max(1, 100 - Math.min(99, this.ytg + 7)));
      return;
    }
    const gross = Math.round(
      fromQuantiles(
        Q,
        k.puntDistanceQuantiles,
        shiftedUniform(this.rng, (punter.ratings.kickPower - AVERAGE_RATING) * 0.004),
      ),
    );
    const landing = this.ytg - gross; // receiving team's own yard line where it lands
    if (landing <= 0) {
      this.record({ ...base, yards: 0, kickDistance: gross, touchback: true }, at);
      this.newPossession(receiving, 100 - this.input.rules.puntTouchbackSpot);
      return;
    }
    const fairCatch = this.rng.chance(k.puntFairCatchRate);
    const outOfBounds = !fairCatch && this.rng.chance(k.puntOutOfBoundsRate);
    if (fairCatch || outOfBounds) {
      this.record(
        {
          ...base,
          yards: 0,
          kickDistance: gross,
          ...(fairCatch ? { fairCatch: true, returner: returner.id } : { outOfBounds: true }),
        },
        at,
      );
      this.newPossession(receiving, 100 - landing);
      return;
    }
    const ret = Math.round(
      fromQuantiles(
        Q,
        k.puntReturnQuantiles,
        shiftedUniform(this.rng, (returner.ratings.speed - 85) * 0.003),
        TUNING.tails.return,
      ),
    );
    if (landing + ret >= 100) {
      this.addPoints(receiving, 6);
      this.touchdowns[receiving] += 1;
      this.record(
        {
          ...base,
          yards: 0,
          kickDistance: gross,
          returner: returner.id,
          returnYards: 100 - landing,
          touchdown: receiving,
        },
        at,
      );
      this.offense = receiving;
      this.drives[receiving] += 1;
      this.afterTouchdown(receiving, true);
      return;
    }
    this.record(
      {
        ...base,
        yards: 0,
        kickDistance: gross,
        returner: returner.id,
        returnYards: ret,
        tacklers: [this.tackler(this.offense, "pass").id],
      },
      at,
    );
    this.newPossession(receiving, 100 - Math.max(1, landing + ret));
  }

  private fieldGoal(note?: string): void {
    const at = { clock: this.clock };
    const distance = this.ytg + TUNING.fieldGoal.snapYards;
    const kicker = this.lineup[this.offense].k;
    const good = this.rng.chance(this.fieldGoalChance(this.offense, distance));
    this.playTime(TUNING.playSeconds.fieldGoal, this.offense);
    // Points go on the board before the play is recorded, so its score is the score after it.
    if (good) this.addPoints(this.offense, 3);
    this.record(
      {
        kind: "fieldGoal",
        yards: 0,
        good,
        kicker: kicker.id,
        kickDistance: distance,
        ...(note ? { note } : {}),
      },
      at,
    );
    if (good) {
      const scorer = this.offense;
      this.overtimeScoreCheck(scorer, false);
      if (!this.over) this.kickoff(scorer);
      return;
    }
    // Missed: the other team takes over at the spot of the kick, or its own 20 if that's farther upfield.
    const spot = this.ytg + 7;
    this.newPossession(this.defense, spot <= 20 ? 80 : 100 - spot);
  }

  private kneel(note?: string): void {
    const at = { clock: this.clock };
    this.playTime(TUNING.playSeconds.kneel, this.offense);
    this.advance(
      -1,
      { kind: "kneel", rusher: this.lineup[this.offense].qb.id, ...(note ? { note } : {}) },
      at,
      false,
    );
  }

  private spike(note?: string): void {
    const at = { clock: this.clock };
    this.playTime(TUNING.playSeconds.spike, this.offense);
    this.advance(
      0,
      { kind: "spike", passer: this.lineup[this.offense].qb.id, ...(note ? { note } : {}) },
      at,
      true,
    );
  }

  // --- Periods -------------------------------------------------------------------------

  endPeriod(): void {
    this.record({ kind: "endOfPeriod", yards: 0 }, { clock: 0 });
    const rules = this.input.rules;
    if (this.overtime.active) {
      const ot = this.overtime;
      ot.periods += 1;
      if (
        this.score.home !== this.score.away ||
        (ot.rules.maxPeriods !== null && ot.periods >= ot.rules.maxPeriods)
      ) {
        this.over = true;
        return;
      }
      this.quarter += 1;
      this.clock = ot.rules.periodMinutes * 60;
      this.clockRunning = false;
      this.periodPoints.home.push(0);
      this.periodPoints.away.push(0);
      if (ot.periods % 2 === 0)
        this.timeouts = { home: ot.rules.timeouts, away: ot.rules.timeouts };
      return;
    }
    if (this.quarter === 4) {
      if (this.score.home !== this.score.away) {
        this.over = true;
        return;
      }
      this.startOvertime();
      return;
    }
    this.quarter += 1;
    this.clock = rules.quarterMinutes * 60;
    this.clockRunning = false;
    this.warningGiven = false;
    this.periodPoints.home.push(0);
    this.periodPoints.away.push(0);
    if (this.quarter === 3) {
      // Halftime: new timeouts, and the team that received first kicks off.
      this.timeouts = { home: rules.timeoutsPerHalf, away: rules.timeoutsPerHalf };
      this.kickoff(this.openingReceiver);
    }
  }

  private startOvertime(): void {
    const ot = this.overtime;
    ot.active = true;
    ot.periods = 0;
    this.quarter = 5;
    this.clock = ot.rules.periodMinutes * 60;
    this.clockRunning = false;
    this.warningGiven = true;
    this.timeouts = { home: ot.rules.timeouts, away: ot.rules.timeouts };
    this.periodPoints.home.push(0);
    this.periodPoints.away.push(0);
    ot.first = this.rng.chance(0.5) ? "home" : "away";
    ot.phase = "first";
    this.kickoff(otherSide(ot.first));
  }

  play(): void {
    // Coin toss: the winner defers, so the loser receives the opening kickoff.
    this.openingReceiver = this.rng.chance(0.5) ? "home" : "away";
    this.kickoff(otherSide(this.openingReceiver));
    while (!this.over) {
      if (this.clock <= 0) {
        this.endPeriod();
        continue;
      }
      this.snap();
    }
  }

  output(): GameOutput {
    const box = buildBoxScore(this.plays, this.lineup, {
      periods: this.periodPoints,
      possessionSeconds: this.possessionSeconds,
      drives: this.drives,
    });
    return {
      homeScore: this.score.home,
      awayScore: this.score.away,
      homeTouchdowns: this.touchdowns.home,
      awayTouchdowns: this.touchdowns.away,
      overtime: this.overtime.active,
      plays: this.plays,
      box,
    };
  }
}

/** Simulates one game. Same input and same random state: the identical game. */
export function simulateGame(input: GameInput, rng: Rng): GameOutput {
  const game = new Game(input, rng);
  game.play();
  return game.output();
}
