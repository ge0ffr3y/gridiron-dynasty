/**
 * The injury model (Phase 9b): severities and body parts from real data,
 * reinjury, knocks played through, report statuses, lasting damage, offseason
 * carryover, and a full season whose injuries and reserve lists land near the
 * real numbers (calibration/injuries.json).
 */
import { Rng } from "@fgm/foundation";
import { describe, expect, it } from "vitest";
import injuryData from "../../../../calibration/injuries.json";
import { createLeague } from "../generate/league";
import type { League, Player } from "../league/schema";
import { injurySeason, REAL_INJURIES, reportCounts } from "../lifecycle/report";
import { developmentReportView, injuryReportView } from "../lifecycle/views";
import { parseLeague, serializeLeague } from "../serialize";
import { gameDepthChart } from "./depthChart";
import { advance } from "./flow";
import {
  drawPart,
  hurt,
  injuryFor,
  offseasonHealing,
  PRACTICE_INJURIES,
  severityFor,
} from "./injuries";
import { INJURY_MODEL } from "./config";

const BASE = serializeLeague(createLeague({ seed: 12, name: "Injuries" }));
const copy = (): League => parseLeague(BASE);
const someone = (league: League, position: string): Player =>
  league.players.find((p) => p.position === position && p.teamId !== null && !p.injury)!;

describe("severity and body parts", () => {
  it("severity follows games missed", () => {
    expect(severityFor(1)).toBe("minor");
    expect(severityFor(3)).toBe("moderate");
    expect(severityFor(6)).toBe("significant");
    expect(severityFor(12)).toBe("severe");
  });

  it("practice injuries fill the real total beyond in-game ones, with valid severities", () => {
    const shares = Object.values(PRACTICE_INJURIES.shares);
    expect(shares.every((v) => v >= 0)).toBe(true);
    expect(shares.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 6);
    expect(PRACTICE_INJURIES.perTeamWeek).toBeCloseTo(
      (injuryData.episodes.costingGamesPerTeamSeason - INJURY_MODEL.inGameCostingPerTeamSeason) /
        INJURY_MODEL.practiceWeeksPerSeason,
      6,
    );
  });

  it("a player back from a hamstring injury hurts his hamstring again more often", () => {
    const league = copy();
    const fresh = someone(league, "WR");
    const back = JSON.parse(JSON.stringify(fresh)) as Player;
    back.injuryHistory = [
      { season: league.season, date: league.date, part: "Hamstring", kind: "game", games: 2 },
    ];
    const date = league.date;
    let base = 0;
    let again = 0;
    for (let seed = 1; seed <= 3000; seed++) {
      if (drawPart(fresh, 2, date, new Rng(seed)) === "Hamstring") base += 1;
      if (drawPart(back, 2, date, new Rng(seed)) === "Hamstring") again += 1;
    }
    expect(again / base).toBeGreaterThan(1.5);
    // Long after his return, no extra risk.
    back.injuryHistory[0]!.date = `${league.season - 2}-01-01`;
    let later = 0;
    for (let seed = 1; seed <= 3000; seed++)
      if (drawPart(back, 2, date, new Rng(seed)) === "Hamstring") later += 1;
    expect(later).toBe(base);
  });
});

describe("getting hurt", () => {
  it("a knock lists him Questionable and he plays, a step slower", () => {
    const league = copy();
    const p = someone(league, "RB");
    hurt(league, p, 0, "practice", "test", new Rng(1));
    expect(p.injury).toBeNull();
    expect(p.knock).not.toBeNull();
    expect(p.injuryHistory.at(-1)!.games).toBe(0);
    const chart = gameDepthChart(league, p.teamId!);
    const inLineup = Object.values(chart)
      .flat()
      .find((x) => x.id === p.id);
    if (inLineup) expect(inLineup.ratings.speed).toBe(p.ratings.speed - INJURY_MODEL.knockPenalty);
  });

  it("an injury that costs games: part, severity, Out, history; he sits", () => {
    const league = copy();
    const p = someone(league, "LB");
    hurt(league, p, 5, "game", "hurt in a test", new Rng(2));
    expect(p.injury).toMatchObject({ severity: "significant", status: "Out", gamesRemaining: 5 });
    expect(injuryData.bodyParts.parts).toContain(p.injury!.part);
    expect(p.injury!.description).toMatch(/significant\), hurt in a test/);
    expect(p.injuryHistory.at(-1)).toMatchObject({ games: 5, kind: "game" });
    const chart = gameDepthChart(league, p.teamId!);
    expect(
      Object.values(chart)
        .flat()
        .some((x) => x.id === p.id),
    ).toBe(false);
  });

  it("a severe leg injury costs speed for good, more at 32 than at 24", () => {
    const loss = (age: number) => {
      const league = copy();
      const p = someone(league, "CB");
      p.birthDate = `${Number(league.date.slice(0, 4)) - age}${league.date.slice(4)}`;
      const before = p.ratings.speed;
      // Find a seed that draws a leg injury for a severe one.
      for (let seed = 1; seed < 200; seed++) {
        const c = JSON.parse(JSON.stringify(p)) as Player;
        hurt(league, c, 12, "game", "test", new Rng(seed));
        if (INJURY_MODEL.lastingDamage.parts.includes(c.injury!.part))
          return before - c.ratings.speed;
      }
      throw new Error("no leg injury drawn");
    };
    expect(loss(24)).toBeGreaterThan(0);
    expect(loss(32)).toBeGreaterThan(loss(24));
  });

  it("the offseason heals short injuries; long ones carry into camp", () => {
    const league = copy();
    const a = someone(league, "OT");
    const b = someone(league, "OG");
    a.injury = injuryFor(3, league.date);
    b.injury = injuryFor(15, league.date);
    offseasonHealing(league);
    expect(a.injury).toBeNull();
    expect(b.injury!.gamesRemaining).toBe(15 - INJURY_MODEL.offseasonRecoveryGames);
  });
});

describe("a season of injuries", () => {
  it("injuries, reserve lists and the weekly report land near the real numbers", () => {
    const league = copy();
    const weeks: ReturnType<typeof reportCounts>[] = [];
    for (let i = 0; i < 80 && league.calendar.stage !== "complete"; i++) {
      advance(league);
      if (league.calendar.stage === "regular") weeks.push(reportCounts(league));
    }
    const s = injurySeason(league, league.season);
    // One season of 32 teams: wide bands around the real values.
    expect(s.costingPerTeam.all).toBeGreaterThan(REAL_INJURIES.costingPerTeam * 0.8);
    expect(s.costingPerTeam.all).toBeLessThan(REAL_INJURIES.costingPerTeam * 1.2);
    expect(s.reserve.irAtWeek1).toBeGreaterThan(1.5);
    expect(s.reserve.irAtWeek1).toBeLessThan(5);
    expect(s.reserve.irDuring).toBeGreaterThan(3.5);
    expect(s.reserve.irDuring).toBeLessThan(9);
    const avg = (k: keyof (typeof weeks)[number]) =>
      weeks.reduce((a, w) => a + w[k], 0) / weeks.length;
    const q = avg("Questionable") + avg("playingThrough");
    expect(avg("playingThrough") / q).toBeGreaterThan(0.5);
    expect(avg("playingThrough") / q).toBeLessThan(0.85);
    expect(avg("Out")).toBeGreaterThan(1);
    expect(avg("Out")).toBeLessThan(3);
    // Every injury has a real body part, and knee, ankle and hamstring lead, as in the real data.
    const parts = new Set<string>(injuryData.bodyParts.parts);
    expect(league.players.every((p) => p.injuryHistory.every((h) => parts.has(h.part)))).toBe(true);
    expect(
      s.parts
        .slice(0, 3)
        .map((x) => x.part)
        .sort(),
    ).toEqual(["Ankle", "Hamstring", "Knee"]);

    // The screens: the report lists active players only, sorted Out first.
    const report = injuryReportView(league, null);
    for (const t of report.teams) {
      const order = t.entries.map((e) => ({ Out: 0, Doubtful: 1, Questionable: 2 })[e.status]);
      expect([...order].sort((a, b) => a - b)).toEqual(order);
    }
    const dev = developmentReportView(league, { kind: "league" });
    expect(dev.rounds.map((r) => r.stage)).toEqual(["league-year", "camp", "season"]);
    for (const r of dev.rounds) {
      expect(r.risers.every((e) => e.change > 0 && e.reason.length > 0)).toBe(true);
      expect(r.fallers.every((e) => e.change < 0)).toBe(true);
    }
  }, 180_000);
});

describe("old saves", () => {
  it("a format-9 save loads: injuries get a part, severity and status", () => {
    const league = copy();
    const old = JSON.parse(serializeLeague(league));
    old.formatVersion = 9;
    const p = old.players.find((x: { teamId: string | null }) => x.teamId !== null);
    p.injury = { description: "Old injury", gamesRemaining: 4, since: league.date };
    for (const x of old.players) {
      delete x.knock;
      delete x.injuryHistory;
    }
    const upgraded = parseLeague(JSON.stringify(old));
    const q = upgraded.players.find((x) => x.id === p.id)!;
    expect(q.injury).toMatchObject({ part: "Other", severity: "significant", status: "Out" });
    expect(q.knock).toBeNull();
    expect(q.injuryHistory).toEqual([]);
  });
});
