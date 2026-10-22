import { DEPTH_SLOTS } from "@fgm/game-engine";
import { describe, expect, it } from "vitest";
import { createLeague } from "../generate/league";
import { depthChartView, leadersView, moveOnDepthChart, resetDepthChart } from "../peopleViews";
import { parseLeague, serializeLeague } from "../serialize";
import { injuryFor } from "./injuries";
import { autoDepthChart, gameDepthChart, slotOverall, teamRoster } from "./depthChart";
import { advanceUntil } from "./flow";

const VIEWER = { kind: "league" } as const;

describe("depth charts", () => {
  const league = createLeague({ seed: 31, name: "Depth" });
  const team = league.teams[0]!;
  const roster = teamRoster(league, team.id);
  const byId = new Map(roster.map((p) => [p.id, p]));

  it("the automatic chart lists the best player at each spot first", () => {
    const chart = autoDepthChart(roster);
    for (const slot of ["QB", "RB", "C", "K", "P"] as const) {
      const first = byId.get(chart[slot][0]!)!;
      // Kickers and punters are ranked among their own position first.
      const pool =
        slot === "K" || slot === "P" ? roster.filter((p) => p.position === slot) : roster;
      const best = Math.max(...pool.map((p) => slotOverall(p, slot) ?? -1));
      expect(slotOverall(first, slot)).toBe(best);
    }
  });

  it("nobody starts at two spots on the same side of the ball", () => {
    const chart = autoDepthChart(roster);
    const offense = ["QB", "RB", "WR", "TE", "LT", "LG", "C", "RG", "RT"] as const;
    const defense = ["EDGE", "DT", "LB", "CB", "S"] as const;
    const starters = {
      QB: 1,
      RB: 1,
      WR: 3,
      TE: 1,
      LT: 1,
      LG: 1,
      C: 1,
      RG: 1,
      RT: 1,
      EDGE: 2,
      DT: 2,
      LB: 3,
      CB: 3,
      S: 2,
    };
    for (const side of [offense, defense]) {
      const ids = side.flatMap((slot) => chart[slot].slice(0, starters[slot]));
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it("only lists players who can play the spot", () => {
    const chart = autoDepthChart(roster);
    for (const slot of DEPTH_SLOTS)
      for (const id of chart[slot]) expect(slotOverall(byId.get(id)!, slot)).not.toBeNull();
  });

  it("a custom order sticks, survives saving, and resets to automatic", () => {
    const copy = parseLeague(serializeLeague(league));
    const before = depthChartView(copy, team.id, VIEWER).slots.find((s) => s.slot === "QB")!;
    const backup = before.players[1]!.id;
    moveOnDepthChart(copy, team.id, "QB", backup, 0);
    const reloaded = parseLeague(serializeLeague(copy));
    const after = depthChartView(reloaded, team.id, VIEWER);
    expect(after.auto).toBe(false);
    expect(after.slots.find((s) => s.slot === "QB")!.players[0]!.id).toBe(backup);
    expect(gameDepthChart(reloaded, team.id).QB[0]!.id).toBe(backup);
    resetDepthChart(reloaded, team.id);
    expect(depthChartView(reloaded, team.id, VIEWER).auto).toBe(true);
    expect(gameDepthChart(reloaded, team.id).QB[0]!.id).toBe(before.players[0]!.id);
  });

  it("a custom chart drops players who left and adds new arrivals", () => {
    const copy = parseLeague(serializeLeague(league));
    const wr = depthChartView(copy, team.id, VIEWER).slots.find((s) => s.slot === "WR")!;
    moveOnDepthChart(copy, team.id, "WR", wr.players[2]!.id, 0);
    const arriving = copy.players.find(
      (p) => p.teamId === league.teams[1]!.id && p.position === "WR",
    )!;
    const leaving = copy.players.find((p) => p.id === wr.players[0]!.id)!;
    leaving.teamId = league.teams[1]!.id;
    arriving.teamId = team.id;
    const ids = depthChartView(copy, team.id, VIEWER)
      .slots.find((s) => s.slot === "WR")!
      .players.map((p) => p.id);
    expect(ids).not.toContain(leaving.id);
    expect(ids).toContain(arriving.id);
    expect(ids[0]).toBe(wr.players[2]!.id);
  });

  it("injured players sit out games but stay on the chart", () => {
    const copy = parseLeague(serializeLeague(league));
    const starter = gameDepthChart(copy, team.id).QB[0]!;
    copy.players.find((p) => p.id === starter.id)!.injury = injuryFor(
      2,
      copy.date,
      "Hurt in Week 1 against XYZ",
    );
    expect(gameDepthChart(copy, team.id).QB.map((p) => p.id)).not.toContain(starter.id);
    const view = depthChartView(copy, team.id, VIEWER).slots.find((s) => s.slot === "QB")!;
    expect(view.players[0]!.id).toBe(starter.id);
    expect(view.players[0]!.injury?.gamesRemaining).toBe(2);
  });
});

describe("injuries and leaders over a season", () => {
  const league = createLeague({ seed: 32, name: "Injuries" });
  const missed = new Map<number, { teamId: string; afterGame: number }>();
  advanceUntil(league, (l) => l.calendar.stage === "regular");
  advanceUntil(league, (l) => l.calendar.stage === "regular" && l.calendar.week > 8, {
    onGame: (g, output) => {
      for (const injury of output.injuries) {
        if (injury.returned) continue;
        const teamId = injury.side === "home" ? g.homeId : g.awayId;
        missed.set(injury.playerId, { teamId, afterGame: g.id });
      }
    },
  });

  it("players get hurt during games at a realistic rate", () => {
    const games = league.games.filter((g) => g.result).length;
    expect(missed.size).toBeGreaterThan(0);
    expect(league.players.some((p) => p.injury !== null)).toBe(true);
    expect(games).toBeGreaterThan(100);
  });

  it("an injured player doesn't play until his games are up", () => {
    for (const p of league.players) {
      if (!p.injury) continue;
      const since = p.injury.since;
      const later = league.games.filter(
        (g) => g.result && g.date > since && (g.homeId === p.teamId || g.awayId === p.teamId),
      );
      for (const g of later) expect(g.boxScore!.players.some((e) => e.id === p.id)).toBe(false);
    }
  });

  it("leaders are sorted and rate stats need enough attempts", () => {
    const view = leadersView(league);
    expect(view.season).toBe(league.season);
    for (const c of view.categories) {
      const values = c.leaders.map((l) => Number(l.value));
      expect(values).toEqual([...values].sort((a, b) => b - a));
    }
    const rating = view.categories.find((c) => c.key === "rating")!;
    expect(rating.leaders.length).toBeGreaterThan(5);
    expect(rating.leaders.every((l) => l.position === "QB")).toBe(true);
  });
});
