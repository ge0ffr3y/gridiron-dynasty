import { describe, expect, it } from "vitest";
import { askTeam, answerDecision } from "./decisions";
import { ageOn } from "@fgm/foundation";
import { ROSTER_MIX } from "./generate/config";
import { createLeague } from "./generate/league";
import { perceivePlayer } from "./perception";
import { POSITIONS, type Position } from "@fgm/foundation";
import { overallAt } from "@fgm/foundation";
import { fingerprint, parseLeague, serializeLeague } from "./serialize";
import { leagueSummary, playerView, playersView, teamView } from "./views";

const league = createLeague({ seed: 42, name: "Test League" });
const LEAGUE_VIEW = { kind: "league" } as const;

function mean(values: number[]): number {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function playersAt(position: Position) {
  return league.players.filter((p) => p.position === position);
}

describe("generated league: determinism and saving", () => {
  it("same seed -> byte-identical league file", () => {
    const again = createLeague({ seed: 42, name: "Test League" });
    expect(serializeLeague(again)).toBe(serializeLeague(league));
  });

  it("different seeds give different leagues", () => {
    const other = createLeague({ seed: 43, name: "Test League" });
    expect(fingerprint(serializeLeague(other))).not.toBe(fingerprint(serializeLeague(league)));
  });

  it("save -> load -> save gives the identical file", () => {
    const text = serializeLeague(league);
    expect(serializeLeague(parseLeague(text))).toBe(text);
  });

  it("refuses files that aren't valid leagues", () => {
    expect(() => parseLeague("not json")).toThrow(/isn't a league file/);
    expect(() => parseLeague(JSON.stringify({ hello: 1 }))).toThrow(
      /isn't a FootballGM Sim league file/,
    );
    const damaged = JSON.parse(serializeLeague(league));
    damaged.players[3].ratings.speed = 140;
    expect(() => parseLeague(JSON.stringify(damaged))).toThrow(/players\.3\.ratings\.speed/);
  });
});

describe("generated league: contents", () => {
  it("has 32 teams with 90 players each in the configured position mix", () => {
    expect(league.teams).toHaveLength(32);
    for (const team of league.teams) {
      const roster = league.players.filter((p) => p.teamId === team.id);
      expect(roster).toHaveLength(league.rules.roster.offseasonMax);
      for (const position of POSITIONS) {
        expect(roster.filter((p) => p.position === position)).toHaveLength(ROSTER_MIX[position]);
      }
      const jerseys = new Set(roster.map((p) => p.jersey));
      expect(jerseys.size).toBe(roster.length);
    }
  });

  it("gives every team a six-person staff and its own 21 draft picks", () => {
    for (const team of league.teams) {
      const staff = league.coaches
        .filter((c) => c.teamId === team.id)
        .map((c) => c.role)
        .sort();
      expect(staff).toEqual(["DC", "HC", "OC", "SCOUT", "SCOUT", "STC"]);
      const picks = league.draftPicks.filter((p) => p.ownerTeamId === team.id);
      expect(picks).toHaveLength(21);
      expect(picks.every((p) => p.originalTeamId === team.id)).toBe(true);
    }
  });

  it("uses unique names and ids that all resolve", () => {
    const people = [...league.players, ...league.coaches];
    expect(new Set(people.map((p) => `${p.firstName} ${p.lastName}`)).size).toBe(people.length);
    expect(league.players.map((p) => p.id)).toEqual(league.players.map((_, i) => i));
    const teamIds = new Set(league.teams.map((t) => t.id));
    for (const p of league.players) {
      expect(teamIds.has(p.teamId!)).toBe(true);
      if (p.drafted) expect(teamIds.has(p.drafted.teamId)).toBe(true);
    }
    expect(league.nextIds.player).toBe(league.players.length);
  });

  it("has realistic shapes: linemen heavy, corners light and fast, quarterbacks throw", () => {
    expect(mean(playersAt("OT").map((p) => p.weightLb))).toBeGreaterThan(300);
    expect(mean(playersAt("CB").map((p) => p.weightLb))).toBeLessThan(205);
    expect(mean(playersAt("CB").map((p) => p.ratings.speed))).toBeGreaterThan(
      mean(playersAt("OG").map((p) => p.ratings.speed)) + 30,
    );
    expect(mean(playersAt("QB").map((p) => p.ratings.throwPower))).toBeGreaterThan(
      mean(playersAt("WR").map((p) => p.ratings.throwPower)) + 30,
    );
    for (const p of league.players) {
      const age = ageOn(p.birthDate, league.date);
      expect(age).toBeGreaterThanOrEqual(21);
      expect(age).toBeLessThanOrEqual(41);
      expect(p.hidden.potential).toBeGreaterThanOrEqual(overallAt(p.ratings, p.position));
      const priorities = p.personality.priorities;
      expect(priorities.money + priorities.winning + priorities.role + priorities.location).toBe(
        100,
      );
    }
  });

  it("spreads talent: stars are rare, every position has starters and camp bodies", () => {
    const overalls = league.players.map((p) => overallAt(p.ratings, p.position));
    const stars = overalls.filter((o) => o >= 90).length;
    expect(stars).toBeGreaterThan(0);
    expect(stars).toBeLessThan(league.players.length * 0.02);
    expect(mean(overalls)).toBeGreaterThan(58);
    expect(mean(overalls)).toBeLessThan(70);
  });

  it("rates players best (or nearly) at their own position", () => {
    for (const p of league.players) {
      const seen = perceivePlayer(league, p, LEAGUE_VIEW);
      expect(seen.positionOveralls[0]!.overall - seen.overall).toBeLessThanOrEqual(5);
    }
    const flexible = league.players.filter((p) => Object.keys(p.familiarity).length > 1);
    expect(flexible.length).toBeGreaterThan(200);
  });
});

describe("perception and views", () => {
  it("in Phase 1, what a staff believes equals the truth", () => {
    const player = league.players[100]!;
    const seen = perceivePlayer(league, player, { kind: "team", teamId: "SEA" });
    expect(seen.ratings).toEqual(player.ratings);
    expect(seen.overall).toBe(overallAt(player.ratings, player.position));
    expect(seen.confidence).toBe(1);
  });

  it("builds every screen's data", () => {
    const summary = leagueSummary(league, LEAGUE_VIEW);
    expect(summary.conferences.flatMap((c) => c.divisions)).toHaveLength(8);
    const team = teamView(league, "BUF", LEAGUE_VIEW);
    expect(team.roster).toHaveLength(90);
    expect(team.staff).toHaveLength(6);
    expect(team.starterOverall).toBeGreaterThan(65);
    expect(playersView(league, LEAGUE_VIEW)).toHaveLength(league.players.length);
    const card = playerView(league, 0, LEAGUE_VIEW);
    expect(card.attributeGroups.flatMap((g) => g.attributes)).toHaveLength(28);
    expect(card.fortyTime).toBeGreaterThan(4);
  });
});

describe("decisions: one engine, two modes", () => {
  const request = { kind: "placeholder" as const, prompt: "Pick one", options: ["a", "b"] };

  it("an AI team answers immediately, with a reason", () => {
    const l = createLeague({ seed: 1, name: "AI" });
    const result = askTeam(l, "BUF", request);
    expect(result.status).toBe("answered");
    if (result.status === "answered") expect(result.answer.reason).not.toBe("");
    expect(l.pendingDecisions).toHaveLength(0);
  });

  it("a human team's request waits until answered", () => {
    const l = createLeague({ seed: 1, name: "Human" });
    l.teams.find((t) => t.id === "BUF")!.controller = "human";
    const result = askTeam(l, "BUF", request);
    expect(result.status).toBe("pending");
    expect(l.pendingDecisions).toHaveLength(1);
    expect(() => answerDecision(l, 0, "c", "because")).toThrow(/not one of the options/);
    expect(() => answerDecision(l, 0, "b", " ")).toThrow(/needs a reason/);
    answerDecision(l, 0, "b", "I like b");
    expect(l.pendingDecisions).toHaveLength(0);
  });
});
