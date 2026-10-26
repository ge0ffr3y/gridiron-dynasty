import { Rng } from "@fgm/foundation";
import { describe, expect, it } from "vitest";
import { rulesFor } from "../rules";
import { createLeague } from "../generate/league";
import { CALENDAR_STAGES, type League } from "../league/schema";
import { parseLeague, serializeLeague } from "../serialize";
import { seasonDates, thursdayAfterLaborDay } from "./calendar";
import { advance, advanceUntil, currentStandings, playoffExits, scheduleSeason } from "./flow";
import { pctOf } from "./standings";
import { seasonPairings } from "./schedule";
import { RULES } from "./testHelpers";
import { validateSchedule } from "./validate";

function finishes(league: League): Map<string, number> {
  const last = league.history.at(-1)!;
  return new Map(last.standings.map((s) => [s.teamId, s.divisionRank]));
}

describe("calendar", () => {
  it("puts the season on the real dates", () => {
    expect(thursdayAfterLaborDay(2025)).toBe("2025-09-04");
    const d2025 = seasonDates(RULES, 2025);
    expect(d2025.weekSundays[17]).toBe("2026-01-04");
    expect(d2025.playoffs.championship).toBe("2026-02-08");
    expect(seasonDates(RULES, 2026).kickoff).toBe("2026-09-10");
  });
});

describe("schedule", () => {
  it("uses the real 2026 division pairings", () => {
    const p = seasonPairings(RULES, 2026);
    expect(p.same).toEqual([
      ["East", "West"],
      ["North", "South"],
    ]);
    expect(p.other).toEqual([
      ["East", "North"],
      ["North", "South"],
      ["South", "East"],
      ["West", "West"],
    ]);
    expect(p.seventeenth).toEqual([
      ["East", "West"],
      ["North", "East"],
      ["South", "North"],
      ["West", "South"],
    ]);
    expect(p.seventeenthHost).toBe("B");
  });

  it("builds valid schedules for 20 straight seasons, from two different seeds", () => {
    // The schedule only depends on the rotation and last season's division finishes, so each
    // season here gets seeded finishes instead of being played (the legality test plays ten).
    for (const seed of [7, 2026]) {
      const league = createLeague({ seed, name: "Validator" });
      const rng = new Rng(seed);
      for (let i = 0; i < 20; i++) {
        expect(
          validateSchedule(
            league.rules,
            league.season,
            league.teams,
            league.games,
            finishes(league),
          ),
        ).toEqual([]);
        const finish = new Map<string, number>();
        for (const c of league.rules.structure.conferences)
          for (const d of c.divisions)
            rng.shuffle([...d.teams]).forEach((id, n) => finish.set(id, n + 1));
        league.season += 1;
        league.rules = rulesFor(league.season);
        league.history.push({
          ...league.history.at(-1)!,
          season: league.season - 1,
          results: [],
          standings: league.history
            .at(-1)!
            .standings.map((s) => ({ ...s, divisionRank: finish.get(s.teamId)! })),
        });
        scheduleSeason(league, finish);
      }
    }
  });

  it("the validator catches a broken schedule", () => {
    const league = createLeague({ seed: 3, name: "Broken" });
    const game = league.games.find((g) => g.week === 1)!;
    const other = league.games.find(
      (g) => g.week === 2 && g.homeId !== game.homeId && g.awayId !== game.awayId,
    )!;
    other.week = 1; // two games for some teams in week 1, none in week 2
    expect(
      validateSchedule(league.rules, league.season, league.teams, league.games, finishes(league))
        .length,
    ).toBeGreaterThan(0);
  });
});

describe("a full season", () => {
  const league = createLeague({ seed: 11, name: "Season" });
  const before = serializeLeague(league);
  advanceUntil(league, (l) => l.calendar.stage === "wildcard");
  const standings = currentStandings(league);

  it("plays every regular-season game", () => {
    const regular = league.games.filter((g) => g.round === "regular");
    expect(regular).toHaveLength(272);
    expect(regular.every((g) => g.result)).toBe(true);
  });

  it("seeds four division winners then three wild cards per conference", () => {
    for (const conference of league.rules.structure.conferences) {
      const order = standings.conferenceOrder.get(conference.id)!;
      const winners = conference.divisions.map((d) => standings.divisionOrder.get(d.id)![0]);
      expect(new Set(order.slice(0, 4))).toEqual(new Set(winners));
      const pct = (id: string) => pctOf(standings.table.record(id));
      // Wild cards are the best non-winners.
      const wildPct = Math.min(...order.slice(4, 7).map(pct));
      expect(order.slice(7).every((t) => pct(t) <= wildPct)).toBe(true);
    }
  });

  it("builds the wild-card round as 2v7, 3v6, 4v5 with the higher seed at home", () => {
    const wildcard = league.games.filter((g) => g.round === "wildcard");
    expect(wildcard).toHaveLength(6);
    for (const g of wildcard) {
      const [h, a] = [standings.seed.get(g.homeId)!, standings.seed.get(g.awayId)!];
      expect(h + a).toBe(9);
      expect(h).toBeLessThan(a);
    }
  });

  it("reseeds: the top seed hosts the lowest remaining seed", () => {
    advance(league);
    const divisional = league.games.filter((g) => g.round === "divisional");
    expect(divisional).toHaveLength(4);
    for (const conference of league.rules.structure.conferences) {
      const mine = divisional.filter(
        (g) => league.teams.find((t) => t.id === g.homeId)!.conferenceId === conference.id,
      );
      const topSeed = standings.conferenceOrder.get(conference.id)![0]!;
      const topGame = mine.find((g) => g.homeId === topSeed)!;
      const others = mine.filter((g) => g !== topGame).flatMap((g) => [g.homeId, g.awayId]);
      expect(Math.max(...others.map((t) => standings.seed.get(t)!))).toBeLessThan(
        standings.seed.get(topGame.awayId)!,
      );
    }
  });

  it("finishes with a neutral-site championship, a champion in History, and a numbered draft", () => {
    advanceUntil(league, (l) => l.calendar.stage === "complete");
    const final = league.games.find((g) => g.round === "championship")!;
    expect(final.neutral).toBe(true);
    const entry = league.history.at(-1)!;
    expect(entry.season).toBe(league.season);
    expect([final.homeId, final.awayId]).toContain(entry.championId);

    // Draft order: non-playoff clubs first (worst record first), runner-up 31st, champion 32nd.
    const exits = playoffExits(league);
    const order = entry.draftOrder;
    expect(order).toHaveLength(32);
    expect(order.slice(0, 18).every((t) => exits.get(t) === "missed")).toBe(true);
    expect(order[30]).toBe(entry.runnerUpId);
    expect(order[31]).toBe(entry.championId);
    const pct = (id: string) => pctOf(standings.table.record(id));
    for (let i = 1; i < 18; i++) expect(pct(order[i]!)).toBeGreaterThanOrEqual(pct(order[i - 1]!));

    const picks = league.draftPicks.filter((p) => p.season === league.season + 1);
    expect(picks.map((p) => p.overall).sort((a, b) => a! - b!)).toEqual(
      Array.from({ length: 224 }, (_, i) => i + 1),
    );
  });

  it("starts the next league year with a new schedule, picks, and a year of experience", () => {
    const vet = league.players[0]!.experience;
    advance(league);
    expect(league.calendar.stage).toBe("offseason");
    expect(league.players[0]!.experience).toBe(vet + 1);
    expect(league.games).toHaveLength(272);
    expect(new Set(league.draftPicks.map((p) => p.season))).toEqual(
      new Set([league.season, league.season + 1, league.season + 2]),
    );
    expect(league.date).toBe("2027-02-15");
    expect(before).not.toBe(serializeLeague(league));
  });
});

describe("determinism and saving", () => {
  it("same seed -> identical history over two seasons; looking at standings changes nothing", () => {
    const a = createLeague({ seed: 5, name: "D" });
    const b = createLeague({ seed: 5, name: "D" });
    for (let i = 0; i < 40; i++) {
      advance(a);
      currentStandings(a); // a viewer checking the standings mid-season
      advance(b);
    }
    expect(serializeLeague(a)).toBe(serializeLeague(b));
  }, 180_000);

  it("save -> load -> save is identical at every stage of a season", () => {
    const league = createLeague({ seed: 9, name: "Stages" });
    const seen = new Set<string>();
    // Through the whole League Year: offseason, free agency, the draft, camp and preseason,
    // final cuts, the season and playoffs, and the season's end.
    // (Free agency takes about a dozen steps since Phase 12: day by day, then weekly.)
    for (let i = 0; i < 80 && seen.size < CALENDAR_STAGES.length; i++) {
      const text = serializeLeague(league);
      expect(serializeLeague(parseLeague(text))).toBe(text);
      seen.add(league.calendar.stage);
      advance(league);
    }
    expect(seen.size).toBe(CALENDAR_STAGES.length);
  }, 300_000);
});
