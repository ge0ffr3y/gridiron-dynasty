import type { Rng } from "@fgm/foundation";
import { FIRST_NAMES, LAST_NAMES } from "./names";

/** Draws before a name may repeat (see `next`). */
const MAX_TRIES = 2000;

/** Hands out full names that are unique within a league (while the pool lasts). */
export class NamePicker {
  private readonly used = new Set<string>();

  constructor(private readonly rng: Rng) {}

  /** A name already taken (so a new person doesn't share it). */
  reserve(full: string): void {
    this.used.add(full);
  }

  /**
   * A name not used yet, or, once the pool is nearly spent (200 first x 260 last names), a
   * repeat after `MAX_TRIES` draws: real leagues have players who share a name, and a century of
   * draft classes would otherwise run the pool dry and never stop looking.
   */
  next(): { firstName: string; lastName: string } {
    for (let tries = 0; ; tries++) {
      const firstName = this.rng.pick(FIRST_NAMES);
      const lastName = this.rng.pick(LAST_NAMES);
      const full = `${firstName} ${lastName}`;
      if (!this.used.has(full) || tries >= MAX_TRIES) {
        this.used.add(full);
        return { firstName, lastName };
      }
    }
  }
}
