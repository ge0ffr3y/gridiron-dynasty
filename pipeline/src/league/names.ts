/**
 * Fictional names for real people. Each name comes from a hash of the
 * person's id, so rebuilding gives the same names without storing a lookup
 * table. No fictional full name may match any real person in nflverse's
 * player list (every era) or a real coach; a match is redrawn.
 */
import { COLLEGES, FIRST_NAMES, LAST_NAMES, Rng, streamSeed } from "@fgm/sim-core";
import type { Row } from "../matchups";
import { normName } from "./madden";

/** Fixed, so names don't change when the league's seed does. */
const NAME_SEED = 20260209;

export class Renamer {
  private readonly real = new Set<string>();
  private readonly used = new Set<string>();
  /** Redraws forced by a clash with a real name (reported). */
  clashes = 0;

  constructor(realPlayers: Row[], realCoaches: string[]) {
    for (const p of realPlayers) {
      for (const first of [p.first_name, p.common_first_name, p.football_name])
        if (first && p.last_name) this.real.add(normName(`${first} ${p.last_name}`));
      if (p.display_name) this.real.add(normName(p.display_name));
    }
    for (const c of realCoaches) this.real.add(normName(c));
  }

  isReal(first: string, last: string): boolean {
    return this.real.has(normName(`${first} ${last}`));
  }

  /** The fictional name for one person (call in a fixed order: by key). */
  name(key: string): { firstName: string; lastName: string } {
    const rng = new Rng(streamSeed(NAME_SEED, `name:${key}`));
    for (;;) {
      const firstName = rng.pick(FIRST_NAMES);
      const lastName = rng.pick(LAST_NAMES);
      const full = `${firstName} ${lastName}`;
      if (this.used.has(full)) continue;
      if (this.isReal(firstName, lastName)) {
        this.clashes += 1;
        continue;
      }
      this.used.add(full);
      return { firstName, lastName };
    }
  }
}

/** A fictional school for a real one, the same for everyone from that school. */
export function fictionalCollege(real: string): string {
  if (!real) return COLLEGES[0]!;
  const rng = new Rng(streamSeed(NAME_SEED, `college:${normName(real)}`));
  return rng.pick(COLLEGES);
}
