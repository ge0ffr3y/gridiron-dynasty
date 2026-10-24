/**
 * The first day of a league (Phase 16): the "where things stand" view, a save from before it
 * loading with nothing to replay, and a generated league needing no starting carousel.
 */
import { describe, expect, it } from "vitest";
import { runStartingCarousel } from "./coaches/startCarousel";
import { dayOneView } from "./dayOne";
import { createLeague } from "./generate/league";
import { parseLeague, serializeLeague } from "./serialize";

describe("where things stand", () => {
  const league = createLeague({ seed: 21, name: "Day one" });
  const view = dayOneView(league);

  it("shows last season's champion, the top of the draft and the cap room", () => {
    expect(view.lastSeason?.champion).toBeTruthy();
    expect(view.lastSeason?.runnerUp).toBeTruthy();
    expect(view.draft.map((p) => p.overall)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(view.capRoom.most).toHaveLength(6);
    expect(view.capRoom.most[0]!.room).toBeGreaterThanOrEqual(view.capRoom.least[0]!.room);
    expect(view.capRoom.least[0]!.room).toBeLessThanOrEqual(view.capRoom.most.at(-1)!.room);
  });

  it("lists the best players whose deals ran out, best market first", () => {
    // A real league starts with expired deals left empty; do the same to three veterans here.
    const l = createLeague({ seed: 21, name: "Expired" });
    const vets = l.players
      .filter((p) => p.teamId && p.experience > 3 && p.position === "QB")
      .slice(0, 3);
    for (const p of vets) p.contract = null;
    const v = dayOneView(l);
    expect(v.freeAgents.map((p) => p.id).sort()).toEqual(vets.map((p) => p.id).sort());
    const pay = v.freeAgents.map((p) => p.market);
    expect([...pay].sort((a, b) => b - a)).toEqual(pay);
  });

  it("a generated league has no carousel to run and every job filled", () => {
    expect(view.coaching).toEqual([]);
    expect(view.openJobs).toEqual([]);
    const text = serializeLeague(league);
    runStartingCarousel(league);
    expect(serializeLeague(league)).toBe(text);
  });

  it("reads the same twice and never changes the league", () => {
    const text = serializeLeague(league);
    expect(dayOneView(league)).toEqual(view);
    expect(serializeLeague(league)).toBe(text);
  });
});

describe("saves", () => {
  it("a format-20 save loads with no real season to replay", () => {
    const old = JSON.parse(serializeLeague(createLeague({ seed: 22, name: "Old" })));
    old.formatVersion = 20;
    delete old.priorSeason;
    const l = parseLeague(JSON.stringify(old));
    expect(l.priorSeason).toBeNull();
    expect(l.formatVersion).toBeGreaterThanOrEqual(21);
  });
});
