/**
 * The sideline: who is fresh, who is tired, and who is hurt, for one team
 * during one game. Before every snap it turns the depth chart into the
 * players first in line at each spot (a `Lineup`), so a tired running back
 * gives way to the next man and an injured tackle is replaced by his backup.
 */
import { baseProfile, type Position, type Rng } from "@fgm/foundation";
import { PEOPLE, TUNING } from "./config";
import { weightedPick } from "./sample";
import type { DepthChart, DepthSlot, Lineup, LineupPlayer } from "./types";

/** Position groups for fatigue and injury rates (as in calibration/people.json). */
export type Group = keyof typeof TUNING.fatigue.drain;

export const GROUP_OF: Partial<Record<Position, Group>> = {
  QB: "QB",
  RB: "RB",
  FB: "FB",
  WR: "WR",
  TE: "TE",
  OT: "OL",
  OG: "OL",
  C: "OL",
  EDGE: "EDGE",
  DT: "DT",
  LB: "LB",
  CB: "CB",
  S: "S",
};

/** The slots a unit draws from, in the order they're filled (a starter is never used twice). */
const OFFENSE_SLOTS: DepthSlot[] = ["QB", "LT", "RT", "LG", "RG", "C", "RB", "FB", "TE", "WR"];
const DEFENSE_SLOTS: DepthSlot[] = ["EDGE", "DT", "LB", "CB", "S"];

/** Where to look when a spot runs out of healthy players. */
const FALLBACK: Partial<Record<DepthSlot, DepthSlot[]>> = {
  QB: ["RB", "WR"],
  LT: ["RT", "LG", "RG", "C", "TE", "DT"],
  RT: ["LT", "RG", "LG", "C", "TE", "DT"],
  LG: ["RG", "C", "LT", "RT", "TE", "DT"],
  RG: ["LG", "C", "RT", "LT", "TE", "DT"],
  C: ["LG", "RG", "LT", "RT", "TE", "DT"],
  RB: ["FB", "WR"],
  WR: ["TE", "RB", "CB"],
  TE: ["FB", "WR", "LT"],
  EDGE: ["DT", "LB"],
  DT: ["EDGE", "LB"],
  LB: ["S", "EDGE"],
  CB: ["S", "WR"],
  S: ["CB", "LB"],
  KR: ["RB", "WR", "CB"],
  PR: ["WR", "CB", "RB"],
};

interface PlayerState {
  player: LineupPlayer;
  group: Group | null;
  energy: number;
  resting: boolean;
  /** Out until this snap number (Infinity = the rest of the game). */
  outUntil: number;
  /** How much faster or slower than typical he tires. */
  drainFactor: number;
  offSnaps: number;
  defSnaps: number;
}

export class Sideline {
  private readonly states = new Map<number, PlayerState>();
  /** Scrimmage snaps so far in the game (both teams). */
  private snapCount = 0;
  /** The current lineup; rebuilt only after something changes (a snap, an injury). */
  private cached: Lineup | null = null;

  /** Each spot's players, as states (built once). */
  private readonly bySlot = new Map<DepthSlot, PlayerState[]>();

  constructor(private readonly depth: DepthChart) {
    const F = TUNING.fatigue;
    for (const list of Object.values(depth)) {
      for (const p of list) {
        if (this.states.has(p.id)) continue;
        const group = GROUP_OF[p.position] ?? null;
        const typicalStamina = baseProfile(p.position).stamina;
        this.states.set(p.id, {
          player: p,
          group,
          energy: 1,
          resting: false,
          outUntil: 0,
          drainFactor: Math.max(0.3, 1 - (p.ratings.stamina - typicalStamina) * F.staminaEffect),
          offSnaps: 0,
          defSnaps: 0,
        });
      }
    }
    for (const [slot, list] of Object.entries(depth) as [DepthSlot, LineupPlayer[]][])
      this.bySlot.set(
        slot,
        list.map((p) => this.states.get(p.id)!),
      );
  }

  /** Every player who dressed (for the box score). */
  get roster(): LineupPlayer[] {
    return [...this.states.values()].map((s) => s.player);
  }

  /** Snaps each player was on the field for. */
  snaps(): Map<number, { off: number; def: number }> {
    return new Map([...this.states].map(([id, s]) => [id, { off: s.offSnaps, def: s.defSnaps }]));
  }

  private healthy(p: LineupPlayer): boolean {
    return (this.states.get(p.id)?.outUntil ?? 0) <= this.snapCount;
  }

  /**
   * The next `n` players at a spot: healthy, rested players in depth-chart
   * order, then tired ones (most energy first), then whoever is left from
   * the fallback spots.
   */
  private take(slot: DepthSlot, n: number, used: Set<number>): LineupPlayer[] {
    // Plain loops: this runs before every snap, so it avoids building throwaway lists.
    const out: LineupPlayer[] = [];
    const list = this.bySlot.get(slot)!;
    let tired: PlayerState[] | null = null;
    for (const s of list) {
      if (out.length >= n) return out;
      if (s.outUntil > this.snapCount || used.has(s.player.id)) continue;
      if (s.resting) {
        (tired ??= []).push(s);
        continue;
      }
      used.add(s.player.id);
      out.push(s.player);
    }
    if (tired && out.length < n) {
      tired.sort((a, b) => b.energy - a.energy);
      for (const s of tired) {
        if (out.length >= n) return out;
        used.add(s.player.id);
        out.push(s.player);
      }
    }
    for (const other of FALLBACK[slot] ?? []) {
      for (const s of this.bySlot.get(other)!) {
        if (out.length >= n) return out;
        if (s.outUntil > this.snapCount || used.has(s.player.id)) continue;
        used.add(s.player.id);
        out.push(s.player);
      }
    }
    return out;
  }

  /** Who is first in line at every spot for the next snap. */
  lineup(): Lineup {
    this.cached ??= this.build();
    return this.cached;
  }

  private build(): Lineup {
    const off = new Set<number>();
    const def = new Set<number>();
    const one = (slot: DepthSlot, used: Set<number>) => this.take(slot, 1, used)[0];
    const qb = one("QB", off) ?? this.depth.QB[0] ?? this.anyone();
    const ol = (["LT", "RT", "LG", "RG", "C"] as DepthSlot[]).flatMap((slot) =>
      this.take(slot, 1, off),
    );
    const rb = this.take("RB", 3, off);
    const fb = one("FB", off);
    const te = this.take("TE", 3, off);
    const wr = this.take("WR", 5, off);
    const dl = [...this.take("EDGE", 2, def), ...this.take("DT", 2, def)];
    const lb = this.take("LB", 3, def);
    const cb = this.take("CB", 4, def);
    const s = this.take("S", 3, def);
    const returner = one("KR", new Set()) ?? rb[0] ?? qb;
    return {
      qb,
      rb,
      ...(fb ? { fb } : {}),
      wr,
      te,
      ol,
      dl,
      lb,
      cb,
      s,
      k: this.depth.K[0] ?? this.anyone(),
      p: this.depth.P[0] ?? this.depth.K[0] ?? this.anyone(),
      returner,
    };
  }

  private anyone(): LineupPlayer {
    const first = [...this.states.values()].find((s) => s.outUntil <= this.snapCount);
    return (first ?? [...this.states.values()][0]!).player;
  }

  /**
   * After a scrimmage snap: the players who were on the field tire, everyone
   * else catches his breath.
   */
  afterSnap(onField: LineupPlayer[], unit: "off" | "def"): void {
    const F = TUNING.fatigue;
    this.cached = null;
    const playing = new Set(onField.map((p) => p.id));
    for (const [id, s] of this.states) {
      if (playing.has(id)) {
        if (unit === "off") s.offSnaps += 1;
        else s.defSnaps += 1;
        s.energy -= s.group ? F.drain[s.group] * s.drainFactor : 0;
        if (s.energy < F.tired) s.resting = true;
      } else {
        s.energy = Math.min(1, s.energy + F.recoveryPerSnap);
        if (s.resting && s.energy >= F.ready) s.resting = false;
      }
    }
  }

  /** Counts a snap for the game (call once per snap, for one team). */
  tick(): void {
    this.snapCount += 1;
    this.cached = null;
  }

  /** The chance anyone among these players gets hurt on a snap. */
  injuryChance(onField: LineupPlayer[]): number {
    return onField.reduce((sum, p) => sum + this.risk(p), 0);
  }

  private risk(p: LineupPlayer): number {
    const group = this.states.get(p.id)?.group;
    if (!group) return 0;
    const perSnap = (PEOPLE.injuries.perSnap as Record<string, number>)[group] ?? 0;
    return perSnap * TUNING.injuries.scrimmageScale * (p.injuryRisk ?? 1);
  }

  /** Picks who got hurt, in proportion to each player's risk. */
  pickInjured(rng: Rng, onField: LineupPlayer[]): LineupPlayer {
    return weightedPick(rng, onField, (p) => this.risk(p));
  }

  /** Takes a player out: for a few snaps (if he'll return) or for the rest of the game. */
  injure(id: number, returnsAfterSnaps: number | null): void {
    const s = this.states.get(id);
    if (!s) return;
    s.outUntil = returnsAfterSnaps === null ? Infinity : this.snapCount + returnsAfterSnaps;
    this.cached = null;
  }

  /** Kick-coverage and return players (for injuries on kicks): backups at the hitting positions. */
  kickUnit(): LineupPlayer[] {
    const unit = [
      ...this.depth.LB.slice(1),
      ...this.depth.S.slice(2),
      ...this.depth.CB.slice(2),
      ...this.depth.WR.slice(3),
      ...this.depth.TE.slice(1),
      ...this.depth.RB.slice(1),
    ].filter((p) => this.healthy(p));
    return [...new Map(unit.map((p) => [p.id, p])).values()];
  }
}
