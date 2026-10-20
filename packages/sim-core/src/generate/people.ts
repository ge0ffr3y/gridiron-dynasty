import type { Rng } from "../rng";
import { FIRST_NAMES, LAST_NAMES } from "./names";

/** Hands out full names that are unique within a league. */
export class NamePicker {
  private readonly used = new Set<string>();

  constructor(private readonly rng: Rng) {}

  next(): { firstName: string; lastName: string } {
    for (;;) {
      const firstName = this.rng.pick(FIRST_NAMES);
      const lastName = this.rng.pick(LAST_NAMES);
      const full = `${firstName} ${lastName}`;
      if (!this.used.has(full)) {
        this.used.add(full);
        return { firstName, lastName };
      }
    }
  }
}
