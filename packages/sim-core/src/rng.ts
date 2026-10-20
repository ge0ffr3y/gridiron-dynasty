/**
 * Seeded random number generator (xoshiro128**), plus named streams.
 *
 * This is the ONLY source of randomness the simulation may use.
 * Same seed in -> exactly the same sequence out, on every machine.
 */

/** The four 32-bit numbers that make up the generator's internal state. */
export type RngState = readonly [number, number, number, number];

/** SplitMix32: turns one seed number into well-mixed numbers to fill the state. */
function splitmix32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x9e3779b9) >>> 0;
    let t = a ^ (a >>> 16);
    t = Math.imul(t, 0x21f0aaad);
    t ^= t >>> 15;
    t = Math.imul(t, 0x735a2d97);
    t ^= t >>> 15;
    return t >>> 0;
  };
}

function rotl(x: number, k: number): number {
  return ((x << k) | (x >>> (32 - k))) >>> 0;
}

export class Rng {
  private s0: number;
  private s1: number;
  private s2: number;
  private s3: number;

  constructor(seed: number) {
    const mix = splitmix32(seed);
    this.s0 = mix();
    this.s1 = mix();
    this.s2 = mix();
    this.s3 = mix();
  }

  /** Next random 32-bit unsigned integer. */
  nextUint32(): number {
    const result = Math.imul(rotl(Math.imul(this.s1, 5), 7), 9) >>> 0;
    const t = (this.s1 << 9) >>> 0;

    this.s2 ^= this.s0;
    this.s3 ^= this.s1;
    this.s1 ^= this.s2;
    this.s0 ^= this.s3;
    this.s2 ^= t;
    this.s3 = rotl(this.s3, 11);

    this.s0 >>>= 0;
    this.s1 >>>= 0;
    this.s2 >>>= 0;
    this.s3 >>>= 0;
    return result;
  }

  /** Random number in [0, 1). */
  next(): number {
    return this.nextUint32() / 4294967296;
  }

  /** Random number in [min, max). */
  range(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  /** Random whole number from 0 up to (but not including) maxExclusive. */
  int(maxExclusive: number): number {
    return Math.floor(this.next() * maxExclusive);
  }

  /** Random whole number from min to max, both included. */
  intBetween(min: number, max: number): number {
    return min + this.int(max - min + 1);
  }

  /** True with the given probability (0 to 1). */
  chance(probability: number): boolean {
    return this.next() < probability;
  }

  /** One item from a non-empty list, each equally likely. */
  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new Error("Rng.pick: the list is empty");
    return items[this.int(items.length)] as T;
  }

  /** Shuffles the list in place (Fisher-Yates) and returns it. */
  shuffle<T>(items: T[]): T[] {
    for (let i = items.length - 1; i > 0; i--) {
      const j = this.int(i + 1);
      const tmp = items[i] as T;
      items[i] = items[j] as T;
      items[j] = tmp;
    }
    return items;
  }

  /**
   * Approximately normal (bell-curve) random number.
   *
   * Sums 12 uniform numbers (the Irwin-Hall method) instead of using log/cos,
   * because Math.log and Math.cos can differ in the last digit between browsers.
   * Plain addition is exact everywhere, so every browser gets the same history.
   * Output is limited to within 6 standard deviations of the mean.
   */
  gaussian(mean = 0, stdDev = 1): number {
    let sum = 0;
    for (let i = 0; i < 12; i++) sum += this.next();
    return mean + stdDev * (sum - 6);
  }

  /** Copy of the internal state, so a league can be saved and resumed exactly. */
  getState(): RngState {
    return [this.s0, this.s1, this.s2, this.s3];
  }

  /** Restore a state previously returned by getState(). */
  setState(state: RngState): void {
    [this.s0, this.s1, this.s2, this.s3] = state;
  }
}

/**
 * The streams the simulation uses. Each area of the sim draws from its own
 * stream, so adding a random draw to (say) injuries never reshuffles the
 * schedule, the games, or the draft. Add new names here as systems arrive.
 */
export const RNG_STREAMS = [
  "league",
  "names",
  "schedule",
  "game",
  "injury",
  "development",
  "scouting",
  "draft",
  "ai",
  "negotiation",
  "weather",
] as const;

export type RngStreamName = (typeof RNG_STREAMS)[number];

/** Seed for one named stream: a hash of the name, mixed with the league's seed. */
export function streamSeed(masterSeed: number, name: string): number {
  // FNV-1a hash of the stream name.
  let h = 0x811c9dc5;
  for (let i = 0; i < name.length; i++) {
    h ^= name.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h ^ Math.imul(masterSeed >>> 0, 0x9e3779b1)) >>> 0;
}

/** A league's set of independent random streams, all derived from one seed. */
export class RngStreams {
  private readonly streams = new Map<RngStreamName, Rng>();

  constructor(readonly masterSeed: number) {}

  /** The stream with this name (created on first use). */
  get(name: RngStreamName): Rng {
    let rng = this.streams.get(name);
    if (!rng) {
      rng = new Rng(streamSeed(this.masterSeed, name));
      this.streams.set(name, rng);
    }
    return rng;
  }

  /** Every stream's state, in a fixed order, for saving. */
  getState(): Partial<Record<RngStreamName, RngState>> {
    const state: Partial<Record<RngStreamName, RngState>> = {};
    for (const name of RNG_STREAMS) {
      const rng = this.streams.get(name);
      if (rng) state[name] = rng.getState();
    }
    return state;
  }

  /** Restore states previously returned by getState(). */
  setState(state: Partial<Record<RngStreamName, RngState>>): void {
    for (const name of RNG_STREAMS) {
      const saved = state[name];
      if (saved) this.get(name).setState(saved);
    }
  }
}
