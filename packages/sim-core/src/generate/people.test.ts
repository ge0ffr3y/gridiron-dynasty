/** Names (Phase 13 fix): a full name pool hands out a repeat instead of looking forever. */
import { describe, expect, it } from "vitest";
import { Rng } from "@fgm/foundation";
import { NamePicker } from "./people";
import { FIRST_NAMES, LAST_NAMES } from "./names";

describe("names", () => {
  it("are unique while the pool lasts, and repeat (without hanging) once it's spent", () => {
    const names = new NamePicker(new Rng(1));
    const a = names.next();
    const b = names.next();
    expect(`${a.firstName} ${a.lastName}`).not.toBe(`${b.firstName} ${b.lastName}`);
    const full = new NamePicker(new Rng(2));
    for (const f of FIRST_NAMES) for (const l of LAST_NAMES) full.reserve(`${f} ${l}`);
    const repeat = full.next();
    expect(FIRST_NAMES).toContain(repeat.firstName);
  });
});
