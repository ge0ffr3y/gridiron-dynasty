import { describe, expect, it } from "vitest";
import { createLeague } from "../generate/league";
import { parseLeague, serializeLeague } from "../serialize";
import { advanceUntil } from "./flow";

describe("game stats in the league", () => {
  const league = createLeague({ seed: 21, name: "Stats" });
  advanceUntil(league, (l) => l.calendar.stage === "regular");
  advanceUntil(league, (l) => l.calendar.stage === "regular" && l.calendar.week > 4);

  it("stores a box score on every played game", () => {
    const played = league.games.filter((g) => g.result);
    expect(played.length).toBeGreaterThan(50);
    for (const g of played) {
      expect(g.boxScore).not.toBeNull();
      expect(g.boxScore!.home.points).toBe(g.result!.homeScore);
      expect(g.boxScore!.away.points).toBe(g.result!.awayScore);
    }
  });

  it("player season totals equal the sum of their box scores", () => {
    const totals = new Map<number, Record<string, number>>();
    for (const g of league.games.filter((x) => x.round === "regular")) {
      for (const entry of g.boxScore?.players ?? []) {
        const t = totals.get(entry.id) ?? {};
        for (const [k, v] of Object.entries(entry.line))
          if (!k.endsWith("Long")) t[k] = (t[k] ?? 0) + v;
        totals.set(entry.id, t);
      }
    }
    let checked = 0;
    for (const p of league.players) {
      const season = p.stats.filter((s) => s.season === league.season);
      const fromBoxes = totals.get(p.id) ?? {};
      const stored: Record<string, number> = {};
      for (const s of season)
        for (const [k, v] of Object.entries(s.line))
          if (!k.endsWith("Long")) stored[k] = (stored[k] ?? 0) + v;
      expect(stored).toEqual(fromBoxes);
      if (Object.keys(stored).length > 0) checked++;
    }
    expect(checked).toBeGreaterThan(500);
  });

  it("saves and loads with stats identically", () => {
    const text = serializeLeague(league);
    expect(serializeLeague(parseLeague(text))).toBe(text);
  });

  it("upgrades a save from the previous format", () => {
    const old = JSON.parse(serializeLeague(createLeague({ seed: 3, name: "Old" })));
    old.formatVersion = 2;
    for (const p of old.players) delete p.stats;
    for (const g of old.games) delete g.boxScore;
    delete old.rules.game;
    const upgraded = parseLeague(JSON.stringify(old));
    expect(upgraded.formatVersion).toBe(3);
    expect(upgraded.players.every((p) => p.stats.length === 0)).toBe(true);
    expect(upgraded.games.every((g) => g.boxScore === null)).toBe(true);
    expect(upgraded.rules.game.quarterMinutes).toBe(15);
  });
});
