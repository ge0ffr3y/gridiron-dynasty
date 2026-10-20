import { describe, expect, it } from "vitest";
import { addDays, ageOn, daysBetween, fromDayNumber, toDayNumber } from "./dates";

describe("league dates", () => {
  it("counts days like the calendar does", () => {
    expect(toDayNumber("1970-01-01")).toBe(0);
    expect(addDays("2026-02-28", 1)).toBe("2026-03-01");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(daysBetween("2026-02-09", "2027-02-09")).toBe(365);
    for (let n = -700_000; n < 800_000; n += 997) expect(toDayNumber(fromDayNumber(n))).toBe(n);
  });

  it("works out ages on a given day", () => {
    expect(ageOn("2000-02-09", "2026-02-09")).toBe(26);
    expect(ageOn("2000-02-10", "2026-02-09")).toBe(25);
    expect(ageOn("2000-12-31", "2026-02-09")).toBe(25);
  });
});
