/**
 * The league stays legal (CLAUDE.md rule 9) as contracts come and go: every
 * team under the cap at the start of every League Year, every rostered player
 * under contract with his own team, and rosters within the limit, for 20
 * seasons. Old saves upgrade with contracts.
 */
import { describe, expect, it } from "vitest";
import { createLeague } from "../generate/league";
import type { League } from "../league/schema";
import { LEAGUE_FORMAT_VERSION } from "../league/schema";
import { parseLeague, serializeLeague } from "../serialize";
import { advanceUntil } from "../season/flow";
import { span } from "./contract";
import { capSheet, teamsOverCap } from "./team";

function legalityProblems(league: League): string[] {
  const problems: string[] = [];
  for (const { teamId, room } of teamsOverCap(league))
    problems.push(`${teamId} over the cap by ${-room}`);
  for (const p of league.players) {
    if (p.teamId === null) continue;
    if (!p.contract) problems.push(`player ${p.id} on ${p.teamId} has no contract`);
    else if (p.contract.teamId !== p.teamId)
      problems.push(`player ${p.id}'s contract is with another team`);
    else if (span(p.contract).lastReal < league.season)
      problems.push(`player ${p.id}'s contract has run out`);
  }
  for (const t of league.teams) {
    const n = league.players.filter((p) => p.teamId === t.id).length;
    if (n > league.rules.roster.offseasonMax) problems.push(`${t.id} has ${n} players`);
  }
  return problems;
}

describe("a league stays legal year after year", () => {
  it("20 seasons: every team under the cap, every player under contract, rosters within limits", () => {
    const league = createLeague({ seed: 81, name: "Legal" });
    expect(legalityProblems(league)).toEqual([]);
    const rooms: number[] = [];
    for (let season = 0; season < 20; season++) {
      advanceUntil(league, (l) => l.calendar.stage === "complete");
      advanceUntil(league, (l) => l.calendar.stage === "offseason");
      expect(legalityProblems(league), `${league.season}`).toEqual([]);
      for (const t of league.teams)
        rooms.push(
          capSheet(league, t.id, league.season).room / capSheet(league, t.id, league.season).cap,
        );
      // Rosters stay deep enough to play.
      for (const t of league.teams)
        expect(league.players.filter((p) => p.teamId === t.id).length, t.id).toBeGreaterThanOrEqual(
          75,
        );
    }
    // Teams use their cap: typical room stays a modest share of it.
    rooms.sort((a, b) => a - b);
    expect(rooms[Math.floor(rooms.length / 2)]!).toBeLessThan(0.35);
    // Every move recorded a reason.
    expect(league.transactions.every((t) => t.reason.length > 0)).toBe(true);
  }, 300_000);

  it("a format-6 save loads with contracts for everyone on a roster, the same every time", () => {
    const league = createLeague({ seed: 82, name: "Old" });
    const old = JSON.parse(serializeLeague(league));
    old.formatVersion = 6;
    for (const t of old.teams) delete t.cap;
    for (const p of old.players)
      p.contract = p.teamId ? { teamId: p.teamId, expiresAfterSeason: 2027 } : null;
    delete old.salaryHistory;
    delete old.rules.cap;
    const text = JSON.stringify(old);
    const upgraded = parseLeague(text);
    expect(upgraded.formatVersion).toBe(LEAGUE_FORMAT_VERSION);
    expect(legalityProblems(upgraded)).toEqual([]);
    expect(upgraded.salaryHistory.length).toBeGreaterThan(0);
    expect(serializeLeague(parseLeague(text))).toBe(serializeLeague(upgraded));
  });
});
