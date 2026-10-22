/**
 * The coaching carousel (Phase 10b): after a season every team has a full
 * staff and one head coach, nobody coaches two teams, nobody signs before his
 * own team's season is over, every move has a reason, careers record the head
 * coach each assistant worked under, and the league office can fire and hire.
 */
import { describe, expect, it } from "vitest";
import { createLeague } from "../generate/league";
import type { League } from "../league/schema";
import { parseLeague, serializeLeague } from "../serialize";
import { advance, advanceUntil } from "../season/flow";
import { carouselView, officeFire, officeHire, openings } from "./carousel";
import { STAFF_ROLES } from "./config";

// One full season, through the offseason staffing.
const AFTER = (() => {
  const league = createLeague({ seed: 61, name: "Carousel" });
  advanceUntil(league, (l) => l.calendar.stage === "complete");
  return serializeLeague(league);
})();
const copy = (): League => parseLeague(AFTER);

describe("the coaching carousel", () => {
  it("after the season and the offseason hires, every team has a full staff", () => {
    const league = copy();
    advance(league); // offseason staffing, then the new season
    for (const t of league.teams)
      for (const { role, count } of STAFF_ROLES)
        expect(
          league.coaches.filter((c) => c.teamId === t.id && c.role === role && !c.interim).length,
          `${t.id} ${role}`,
        ).toBe(count);
    expect(openings(league)).toEqual([]);
    // Each coach on one team at most, and retired coaches on none.
    expect(league.coaches.filter((c) => c.retiredAfter !== null && c.teamId !== null)).toEqual([]);
  }, 300_000);

  it("firings and hires carry reasons; a coach signs only after his own season is over", () => {
    const league = copy();
    const moves = league.coachingMoves.filter((m) => m.season === league.season);
    expect(moves.length).toBeGreaterThan(0);
    for (const m of moves) expect(m.reason.length, m.text).toBeGreaterThan(0);
    for (const m of moves.filter((x) => x.kind === "fired" && x.role === "HC"))
      expect(m.reason).toMatch(/\d+-\d+/);
    // A coach hired away from another team: his old team's last game came before the hire.
    for (const m of moves.filter((x) => x.kind === "hired" && x.text.includes(" from the "))) {
      const c = league.coaches.find((x) => x.id === m.coachId)!;
      const old = [...c.career]
        .reverse()
        .find((e) => e.season === league.season && e.teamId !== m.teamId);
      if (!old?.teamId) continue;
      const lastGame = league.games
        .filter((g) => g.result && (g.homeId === old.teamId || g.awayId === old.teamId))
        .map((g) => g.date)
        .sort()
        .at(-1)!;
      expect(m.date >= lastGame, `${m.text} on ${m.date}, his team played ${lastGame}`).toBe(true);
    }
  });

  it("careers record each season's job and the head coach above it", () => {
    const league = copy();
    for (const c of league.coaches.filter((x) => x.teamId !== null && x.role === "OC")) {
      // His latest line this season (an interim head coach also has a head-coach line).
      const line = [...c.career]
        .reverse()
        .find((e) => e.season === league.season && e.teamId === c.teamId && e.role === "OC");
      if (!line) continue; // hired after the season
      expect(line.underId).not.toBeNull();
    }
    const hc = league.coaches.find(
      (c) =>
        c.role === "HC" && c.teamId !== null && c.career.some((e) => e.season === league.season),
    )!;
    const line = hc.career.find((e) => e.season === league.season)!;
    expect(line.record!.wins + line.record!.losses + line.record!.ties).toBe(17);
  });

  it("the league office can fire a coach and hire a candidate who's free to sign", () => {
    const league = copy();
    const team = league.teams[5]!.id;
    const dc = league.coaches.find((c) => c.teamId === team && c.role === "DC")!;
    officeFire(league, dc.id);
    expect(openings(league).some((o) => o.teamId === team && o.role === "DC")).toBe(true);
    const view = carouselView(league);
    const job = view.open.find((o) => o.teamId === team && o.role === "DC")!;
    const pick = job.candidates.find((c) => c.available)!;
    expect(() => officeHire(league, team, "OC", pick.coach.id)).toThrow(/no opening/);
    officeHire(league, team, "DC", pick.coach.id);
    expect(league.coaches.find((c) => c.id === pick.coach.id)!.teamId).toBe(team);
    expect(openings(league).some((o) => o.teamId === team && o.role === "DC")).toBe(false);
  });

  it("the same seed gives the same carousel", () => {
    const a = copy();
    const b = copy();
    advance(a);
    advance(b);
    expect(serializeLeague(a)).toBe(serializeLeague(b));
  }, 300_000);

  it("a format-11 save loads with careers started and the staff rules", () => {
    const league = copy();
    const old = JSON.parse(serializeLeague(league));
    old.formatVersion = 11;
    delete old.coachingMoves;
    delete old.rules.staff;
    for (const c of old.coaches)
      for (const k of [
        "career",
        "contractThrough",
        "reputation",
        "interim",
        "retiredAfter",
        "specialty",
      ])
        delete c[k];
    const upgraded = parseLeague(JSON.stringify(old));
    expect(upgraded.coachingMoves).toEqual([]);
    expect(upgraded.rules.staff.interviewDaysAfterLastGame).toBe(3);
    expect(upgraded.coaches.every((c) => c.career.length === 0 && c.reputation >= 0)).toBe(true);
    expect(upgraded.coaches.filter((c) => c.role === "SCOUT").every((c) => c.specialty)).toBe(true);
  });
});
