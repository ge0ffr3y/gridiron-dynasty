/**
 * Scouting and draft classes (Phase 11a): every league has a class for its
 * next draft; the combine and pro days measure it; scouts' study and skill
 * tighten a team's read; teams draft from their own boards; the real class
 * is ranked by the real draft and redrawn per game.
 */
import { describe, expect, it } from "vitest";
import { overallAt, type Ratings } from "@fgm/foundation";
import draftData from "../../../../calibration/draft.json";
import { createLeague } from "../generate/league";
import type { League } from "../league/schema";
import { perceiveProspect } from "../perception";
import { parseLeague, serializeLeague } from "../serialize";
import { advance, advanceUntil } from "../season/flow";
import { draftClass, realClass, redrawClass, type RealProspectInput } from "./classes";
import { drillResults, physicalsFromDrills } from "./measurables";
import { scoutingWeeks } from "./study";
import { draftClassView, makeScoutingMove, prospectView, setViewingAs } from "./views";

const BASE = serializeLeague(createLeague({ seed: 61, name: "Scouting" }));
const copy = (): League => parseLeague(BASE);
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

describe("draft classes", () => {
  it("a new league has a class for its first draft: one prospect per pick plus the undrafted pool", () => {
    const league = copy();
    const cls = draftClass(league, league.season);
    const picks = league.draftPicks.filter((p) => p.season === league.season).length;
    expect(cls.length).toBeGreaterThan(picks + 250);
    expect(new Set(cls.map((p) => p.id)).size).toBe(cls.length);
    // Ages on draft day like real drafts (about 21 to 23).
    const ages = cls.map((p) => 2026 - Number(p.birthDate.slice(0, 4)));
    expect(mean(ages)).toBeGreaterThan(21.5);
    expect(mean(ages)).toBeLessThan(23.8);
    // About the real number of combine invites, and nobody measured before the combine.
    const invited = cls.filter((p) => p.invited).length;
    expect(Math.abs(invited - draftData.combine.invitesPerYear)).toBeLessThan(45);
    expect(cls.every((p) => !p.tested)).toBe(true);
    // Scouts already studied the class since September.
    expect(Object.keys(league.teams[0]!.scouting.points).length).toBe(cls.length);
  });

  it("drills follow the real distributions at each position", () => {
    const league = copy();
    const wr = draftClass(league, league.season).filter((p) => p.position === "WR");
    const forty = wr.map((p) => p.measurables.forty).filter((x): x is number => x !== null);
    const real = draftData.combine.measurables.WR.forty;
    expect(Math.abs(mean(forty) - real.mean)).toBeLessThan(0.06);
    // And the drills say something true: faster prospects run faster.
    const fast = wr.filter((p) => p.ratings.speed >= 80 && p.measurables.forty !== null);
    const slow = wr.filter((p) => p.ratings.speed <= 65 && p.measurables.forty !== null);
    expect(mean(fast.map((p) => p.measurables.forty!))).toBeLessThan(
      mean(slow.map((p) => p.measurables.forty!)),
    );
  });

  it("the reverse: real drills turn into physical ratings that make sense", () => {
    const league = copy();
    const cb = draftClass(league, league.season).find((p) => p.position === "CB")!;
    const fast = physicalsFromDrills(
      { forty: 4.3, bench: null, vertical: 40, broadJump: 130, cone: null, shuttle: null },
      "CB",
      cb.ratings,
    );
    const slow = physicalsFromDrills(
      { forty: 4.7, bench: null, vertical: 31, broadJump: 115, cone: null, shuttle: null },
      "CB",
      cb.ratings,
    );
    expect(fast.speed!).toBeGreaterThan(slow.speed! + 10);
    expect(fast.jumping!).toBeGreaterThan(slow.jumping! + 10);
    // Undrilled traits keep the fallback.
    expect(fast.strength).toBe(cb.ratings.strength);
    // Round trip: drills from ratings, ratings back from drills, land near where they started.
    const drills = drillResults(cb.ratings, "CB", "round-trip");
    const back = physicalsFromDrills(drills, "CB", cb.ratings as Ratings);
    if (drills.forty !== null) expect(Math.abs(back.speed! - cb.ratings.speed)).toBeLessThan(20);
  });
});

describe("the combine, pro days and scouting", () => {
  it("the combine measures invitees; pro days measure everyone else by the draft", () => {
    const league = copy();
    advance(league); // through the combine to the new League Year
    const cls = draftClass(league, league.season);
    expect(cls.filter((p) => p.invited).every((p) => p.tested)).toBe(true);
    expect(cls.some((p) => !p.invited && !p.tested)).toBe(true);
    // Everyone sees measured drills on the prospect page; unmeasured shows none.
    const measured = cls.find((p) => p.tested)!;
    expect(
      prospectView(league, measured.id, { kind: "league" }).drills.some((d) => d.value !== null),
    ).toBe(true);
    const unmeasured = cls.find((p) => !p.tested)!;
    expect(
      prospectView(league, unmeasured.id, { kind: "league" }).drills.every((d) => d.value === null),
    ).toBe(true);
  });

  it("scouts study their region and position group most", () => {
    const league = copy();
    const team = league.teams[3]!;
    const [scout, other] = league.coaches.filter(
      (c) => c.teamId === team.id && c.role === "SCOUT",
    ) as [League["coaches"][number], League["coaches"][number]];
    makeScoutingMove(league, {
      kind: "assign",
      teamId: team.id,
      scoutId: scout.id,
      region: "West",
      group: "QB",
    });
    makeScoutingMove(league, {
      kind: "assign",
      teamId: team.id,
      scoutId: other.id,
      region: "Northeast",
      group: "OL",
    });
    const before = { ...team.scouting.points };
    scoutingWeeks(league, 4);
    const gain = (id: number) =>
      (team.scouting.points[String(id)] ?? 0) - (before[String(id)] ?? 0);
    const cls = draftClass(league, league.season);
    const target = cls.filter((p) => p.region === "West" && p.position === "QB");
    // Prospects neither scout is assigned to (only general study).
    const rest = cls.filter(
      (p) =>
        !["West", "Northeast"].includes(p.region) && !["QB", "OT", "OG", "C"].includes(p.position),
    );
    expect(mean(target.map((p) => gain(p.id)))).toBeGreaterThan(
      mean(rest.map((p) => gain(p.id))) * 2,
    );
  });

  it("a better scouting department visibly tightens its read of the same prospect", () => {
    const league = copy();
    const [a, b] = [league.teams[0]!.id, league.teams[1]!.id];
    for (const c of league.coaches.filter((x) => x.role === "SCOUT")) {
      if (c.teamId === a) c.ratings.scouting = 90;
      if (c.teamId === b) c.ratings.scouting = 40;
    }
    makeScoutingMove(league, { kind: "budget", teamId: a, budget: "high" });
    makeScoutingMove(league, { kind: "budget", teamId: b, budget: "low" });
    // The same study on everyone, so only the department differs.
    const pts = league.teams[0]!.scouting.points;
    league.teams[1]!.scouting.points = { ...pts };
    const cls = draftClass(league, league.season);
    const width = (team: string) =>
      mean(
        cls.map((p) => {
          const r = perceiveProspect(league, p, { kind: "team", teamId: team }).range;
          return r[1] - r[0];
        }),
      );
    expect(width(a)).toBeLessThan(width(b) - 1);
  });

  it("views are stable, differ by viewer, and switching 'Viewing as' changes the board", () => {
    const league = copy();
    const office = draftClassView(league, { kind: "league" });
    expect(draftClassView(league, { kind: "league" })).toEqual(office);
    setViewingAs(league, league.teams[2]!.id);
    expect(league.settings.viewingAs).toBe(league.teams[2]!.id);
    const team = draftClassView(league, { kind: "team", teamId: league.teams[2]!.id });
    expect(team.rows.map((r) => r.id)).not.toEqual(office.rows.map((r) => r.id));
    // The consensus rank is the same whoever looks.
    const byId = new Map(office.rows.map((r) => [r.id, r.consensusRank]));
    for (const r of team.rows) expect(r.consensusRank).toBe(byId.get(r.id));
    expect(() => setViewingAs(league, "XXX")).toThrow();
  });
});

describe("draft day", () => {
  it("teams draft the class from their own boards; the rest become free agents", () => {
    const league = copy();
    const cls = draftClass(league, league.season);
    advanceUntil(league, (l) => l.calendar.stage === "after-draft");
    const ids = new Set(cls.map((p) => p.id));
    const rookies = league.players.filter((p) => p.drafted?.season === 2026);
    expect(rookies.length).toBe(league.rules.draft.rounds * league.teams.length);
    expect(rookies.every((p) => ids.has(p.id))).toBe(true);
    // The class is gone from prospects; every member is now a player (drafted, signed or free).
    expect(draftClass(league, 2026)).toEqual([]);
    for (const id of ids) expect(league.players.some((p) => p.id === id)).toBe(true);
    // The next class is ready, with scouts assigned.
    expect(draftClass(league, 2027).length).toBeGreaterThan(400);
    expect(league.teams.every((t) => t.scouting.assignments.length > 0)).toBe(true);
    // Drafted players keep their measured drills.
    expect(rookies.filter((p) => p.measurables !== null).length).toBeGreaterThan(
      rookies.length * 0.8,
    );
    // First-rounders are clearly better than seventh-rounders (on average).
    const ovr = (round: number) =>
      mean(
        rookies
          .filter((p) => p.drafted!.round === round)
          .map((p) => overallAt(p.ratings, p.position)),
      );
    expect(ovr(1)).toBeGreaterThan(ovr(7) + 8);
  }, 300_000);

  it("the same seed drafts the same way", () => {
    const a = copy();
    const b = copy();
    advanceUntil(a, (l) => l.calendar.stage === "after-draft");
    advanceUntil(b, (l) => l.calendar.stage === "after-draft");
    expect(serializeLeague(a)).toBe(serializeLeague(b));
  }, 300_000);
});

describe("the real class", () => {
  const inputs: RealProspectInput[] = Array.from({ length: 40 }, (_, i) => ({
    key: `R${String(i).padStart(3, "0")}`,
    firstName: "Real",
    lastName: `Prospect ${i}`,
    position: i % 2 === 0 ? "WR" : "DT",
    college: "Northern Plains",
    age: 22,
    heightIn: 74,
    weightLb: i % 2 === 0 ? 200 : 300,
    drills: {
      forty: i % 2 === 0 ? 4.4 : 5.0,
      bench: null,
      vertical: null,
      broadJump: null,
      cone: null,
      shuttle: null,
    },
    invited: true,
    pick: i < 30 ? 30 - i : null,
  }));

  it("ranks real prospects by where they were really drafted, then fills the pool", () => {
    const league = copy();
    const cls = realClass(league, inputs, league.season);
    expect(cls.length).toBeGreaterThan(500);
    // Pick 1 is input 29 (pick 30 - 29), at anchor rank 1.
    const first = cls.find((p) => p.anchorRank === 1)!;
    expect(first.lastName).toBe("Prospect 29");
    expect(cls.filter((p) => p.lastName.startsWith("Prospect")).length).toBe(40);
    // Real drills are kept as measured.
    expect(first.measurables.forty).toBe(inputs[29]!.drills.forty);
  });

  it("a new game redraws the hidden spread but keeps the facts", () => {
    const league = copy();
    league.prospects = realClass(league, inputs, league.season);
    const before = JSON.parse(JSON.stringify(league.prospects)) as League["prospects"];
    league.meta.seed += 1;
    redrawClass(league);
    let changed = 0;
    league.prospects.forEach((p, i) => {
      const old = before[i]!;
      expect(p.measurables).toEqual(old.measurables);
      expect(p.anchorRank).toBe(old.anchorRank);
      expect(p.ratings.speed).toBe(old.ratings.speed);
      if (overallAt(p.ratings, p.position) !== overallAt(old.ratings, old.position)) changed += 1;
    });
    expect(changed).toBeGreaterThan(league.prospects.length / 2);
  });
});

describe("saves", () => {
  it("a format-12 save loads with scouting started, and gets its class on its first step", () => {
    const league = copy();
    const old = JSON.parse(serializeLeague(league));
    old.formatVersion = 12;
    delete old.prospects;
    delete old.settings.viewingAs;
    for (const t of old.teams) delete t.scouting;
    for (const p of old.players) delete p.measurables;
    const upgraded = parseLeague(JSON.stringify(old));
    expect(upgraded.prospects).toEqual([]);
    expect(upgraded.settings.viewingAs).toBeNull();
    expect(upgraded.teams.every((t) => t.scouting.budget === "normal")).toBe(true);
    advance(upgraded);
    expect(draftClass(upgraded, upgraded.season).length).toBeGreaterThan(400);
  }, 300_000);
});
