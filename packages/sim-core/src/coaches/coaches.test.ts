/**
 * Coaches (Phase 10a): two identical rosters with opposite staffs play visibly
 * differently; changing coordinators moves scheme fits; staff effects are
 * neutral on average; every team has its full staff; old saves upgrade.
 */
import { Rng } from "@fgm/foundation";
import { simulateGame, type GameOutput, type TeamInput } from "@fgm/game-engine";
import { describe, expect, it } from "vitest";
import { createLeague } from "../generate/league";
import type { Coach, League } from "../league/schema";
import { parseLeague, serializeLeague } from "../serialize";
import { gameDepthChart } from "../season/depthChart";
import { STAFF_ROLES } from "./config";
import { developmentMultiplier } from "./effects";
import { fitScore, playerFit, SCHEME_EMPHASIS } from "./fit";
import { STYLE_SPREAD, staffInput } from "./style";

const BASE = serializeLeague(createLeague({ seed: 31, name: "Coaches" }));
const copy = (): League => parseLeague(BASE);

/** A staff leaning hard one way: every tendency two real spreads from average. */
function lean(league: League, teamId: string, sign: 1 | -1): void {
  for (const role of ["HC", "OC", "DC"] as const) {
    const c = league.coaches.find((x) => x.teamId === teamId && x.role === role)!;
    for (const key of Object.keys(STYLE_SPREAD) as (keyof typeof STYLE_SPREAD)[])
      c.style[key] = sign * 2 * STYLE_SPREAD[key];
  }
}

describe("coaching staffs", () => {
  it("every team has its full staff of twelve", () => {
    const league = copy();
    for (const t of league.teams)
      for (const { role, count } of STAFF_ROLES)
        expect(league.coaches.filter((c) => c.teamId === t.id && c.role === role).length).toBe(
          count,
        );
  });

  it("two identical rosters with opposite staffs play visibly differently", () => {
    const league = copy();
    const team = league.teams[0]!.id;
    const opponent = league.teams[1]!.id;
    const bold = copy();
    const calm = copy();
    lean(bold, team, 1);
    lean(calm, team, -1);
    const stats = (l: League) => {
      const depth = gameDepthChart(l, team);
      const other = gameDepthChart(l, opponent);
      let pass = 0;
      let plays = 0;
      let fourthGo = 0;
      let fourth = 0;
      let blitz = 0;
      let dropbacks = 0;
      for (let seed = 1; seed <= 120; seed++) {
        const out: GameOutput = simulateGame(
          {
            home: { id: team, depth, ...staffInput(l, team) } as TeamInput,
            away: { id: opponent, depth: other, ...staffInput(l, opponent) } as TeamInput,
            neutral: false,
            playoff: false,
            rules: l.rules.game,
          },
          new Rng(seed),
        );
        for (const p of out.plays) {
          const scrimmage =
            p.kind === "run" || p.kind === "pass" || p.kind === "sack" || p.kind === "scramble";
          if (p.offense === "home" && scrimmage && p.quarter <= 3) {
            plays += 1;
            if (p.kind !== "run") pass += 1;
          }
          if (p.offense === "home" && p.down === 4 && p.quarter <= 3) {
            fourth += 1;
            if (scrimmage) fourthGo += 1;
          }
          if (p.offense === "away" && p.kind !== "run" && scrimmage && p.rushers !== undefined) {
            dropbacks += 1;
            if (p.rushers >= 5) blitz += 1;
          }
        }
      }
      return { passRate: pass / plays, goRate: fourthGo / fourth, blitzRate: blitz / dropbacks };
    };
    const a = stats(bold);
    const b = stats(calm);
    // Four real spreads apart: well past the noise of 120 games.
    expect(a.passRate - b.passRate).toBeGreaterThan(0.08);
    expect(a.goRate - b.goRate).toBeGreaterThan(0.05);
    expect(a.blitzRate - b.blitzRate).toBeGreaterThan(0.12);
  }, 300_000);

  it("changing the offensive coordinator moves scheme fits, some up and some down", () => {
    const league = copy();
    const team = league.teams[2]!.id;
    const oc = league.coaches.find((c) => c.teamId === team && c.role === "OC")!;
    const players = league.players.filter(
      (p) => p.teamId === team && ["QB", "WR", "OT", "OG", "RB"].includes(p.position),
    );
    oc.offensiveScheme = "Air Raid";
    const before = new Map(players.map((p) => [p.id, playerFit(league, p)]));
    oc.offensiveScheme = "Power Run";
    const after = new Map(players.map((p) => [p.id, playerFit(league, p)]));
    const up = players.filter((p) => after.get(p.id)! > before.get(p.id)! + 0.05).length;
    const down = players.filter((p) => after.get(p.id)! < before.get(p.id)! - 0.05).length;
    expect(up).toBeGreaterThan(2);
    expect(down).toBeGreaterThan(2);
    // A fit moves how well he plays: his game-day ratings follow it.
    const qb = players.find((p) => p.position === "QB" && p.roster === "active")!;
    const lineupQb = gameDepthChart(league, team).QB[0]!;
    if (lineupQb.id === qb.id && Math.abs(after.get(qb.id)!) > 0.1)
      expect(lineupQb.ratings.awareness).not.toBe(qb.ratings.awareness + 0);
  });

  it("a prized-skill profile fits its scheme; a typical starter is neutral", () => {
    const league = copy();
    const wr = league.players.find((p) => p.position === "WR")!;
    const fast = { ...wr.ratings, speed: 99, routeRunning: 95, release: 95, catching: 60 };
    expect(fitScore(fast, "WR", "Air Raid")).toBeGreaterThan(0.3);
    expect(fitScore(fast, "WR", "Air Raid")).toBeLessThanOrEqual(1);
    for (const scheme of Object.keys(SCHEME_EMPHASIS) as (keyof typeof SCHEME_EMPHASIS)[])
      expect(fitScore(wr.ratings, "K", scheme)).toBe(0);
  });

  it("staff effects are neutral on average across the league", () => {
    const league = copy();
    const on = league.players.filter((p) => p.teamId !== null && p.roster === "active");
    const mean = on.reduce((a, p) => a + developmentMultiplier(league, p), 0) / on.length;
    expect(mean).toBeGreaterThan(0.98);
    expect(mean).toBeLessThan(1.02);
    const fits = on.map((p) => playerFit(league, p));
    expect(Math.abs(fits.reduce((a, b) => a + b, 0) / fits.length)).toBeLessThan(0.08);
  });

  it("a format-10 save loads with full staffs and styles, the same every time", () => {
    const league = copy();
    const old = JSON.parse(serializeLeague(league));
    old.formatVersion = 10;
    old.coaches = old.coaches.filter((c: Coach) =>
      ["HC", "OC", "DC", "STC", "SCOUT"].includes(c.role),
    );
    for (const c of old.coaches) {
      delete c.style;
      delete c.ratings.health;
    }
    const text = JSON.stringify(old);
    const upgraded = parseLeague(text);
    expect(upgraded.coaches.length).toBe(league.teams.length * 12);
    expect(upgraded.coaches.every((c) => typeof c.style.blitz === "number")).toBe(true);
    expect(serializeLeague(parseLeague(text))).toBe(serializeLeague(upgraded));
  });
});
