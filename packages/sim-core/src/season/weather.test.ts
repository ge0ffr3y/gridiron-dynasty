/**
 * Phase 5b: stadiums, game-day weather, and "Play and watch".
 */
import { describe, expect, it } from "vitest";
import { createLeague } from "../generate/league";
import type { Game, League } from "../league/schema";
import { LEAGUE_FORMAT_VERSION } from "../league/schema";
import { parseLeague, serializeLeague } from "../serialize";
import { advance, advanceUntil, canPlayNow, playGameNow } from "./flow";
import { gameView } from "./gameView";
import { scheduleView } from "./views";
import { describeConditions, drawWeather, stadiumFor } from "./weather";

function toWeek1(seed: number): League {
  const league = createLeague({ seed, name: "Weather" });
  advanceUntil(league, (l) => l.calendar.stage === "regular");
  return league;
}

describe("stadiums", () => {
  const league = createLeague({ seed: 5, name: "Stadiums" });

  it("every team has a stadium; Denver is a mile up; domes and retractable roofs exist", () => {
    for (const t of league.teams) expect(t.stadium).toEqual(stadiumFor(t.id));
    expect(stadiumFor("DEN").elevationMeters).toBeGreaterThan(1500);
    const roofs = new Set(league.teams.map((t) => t.stadium.roof));
    expect([...roofs].sort()).toEqual(["dome", "outdoor", "retractable"]);
  });
});

describe("game-day weather", () => {
  const league = toWeek1(6);
  const fakeGame = (homeId: string, week: number, id: number): Game => ({
    ...league.games[0]!,
    id,
    homeId,
    week,
    neutral: false,
  });

  it("is the same every time it's drawn for a game", () => {
    const g = league.games[0]!;
    expect(drawWeather(league, g)).toEqual(drawWeather(league, g));
  });

  it("domes keep the weather out; a cold city gets colder and snowier in December", () => {
    for (let i = 0; i < 40; i++)
      expect(drawWeather(league, fakeGame("DET", 16, i)).indoors).toBe(true);
    const average = (week: number) => {
      let sum = 0;
      let snow = 0;
      for (let i = 0; i < 200; i++) {
        const w = drawWeather(league, fakeGame("GB", week, 1000 * week + i));
        sum += w.temperatureF;
        if (w.precipitation === "snow") snow += 1;
      }
      return { temperature: sum / 200, snow };
    };
    const september = average(1);
    const december = average(16);
    expect(december.temperature).toBeLessThan(september.temperature - 15);
    expect(september.snow).toBe(0);
    expect(december.snow).toBeGreaterThan(0);
  });

  it("is stored on each played game and shown on the game page", () => {
    const copy = parseLeague(serializeLeague(league));
    advance(copy);
    const played = copy.games.filter((g) => g.result);
    expect(played.length).toBeGreaterThan(10);
    for (const g of played) {
      expect(g.weather).not.toBeNull();
      expect(gameView(copy, g.id, null).conditions).toBe(describeConditions(copy, g));
    }
    const domeGame = played.find((g) => stadiumFor(g.homeId).roof === "dome");
    if (domeGame) expect(describeConditions(copy, domeGame)).toMatch(/^Dome/);
    expect(copy.games.filter((g) => !g.result).every((g) => g.weather === null)).toBe(true);
  });
});

describe("Play and watch", () => {
  it("playing one game first gives exactly the same week as simming them all together", () => {
    const together = toWeek1(8);
    const oneFirst = toWeek1(8);
    const pick = oneFirst.games.find((g) => g.round === "regular" && g.week === 1)!;
    playGameNow(oneFirst, pick.id);
    expect(oneFirst.games.find((g) => g.id === pick.id)!.result).not.toBeNull();
    advance(together);
    advance(oneFirst);
    expect(serializeLeague(oneFirst)).toBe(serializeLeague(together));
  }, 90_000);

  it("only this week's unplayed games can be played early", () => {
    const league = toWeek1(9);
    const thisWeek = league.games.find((g) => g.week === 1)!;
    const nextWeek = league.games.find((g) => g.week === 2)!;
    expect(canPlayNow(league, thisWeek)).toBe(true);
    expect(canPlayNow(league, nextWeek)).toBe(false);
    expect(() => playGameNow(league, nextWeek.id)).toThrow(/can't be played/);
    playGameNow(league, thisWeek.id);
    expect(canPlayNow(league, thisWeek)).toBe(false);
    expect(() => playGameNow(league, thisWeek.id)).toThrow(/can't be played/);
    const week = scheduleView(league, { kind: "week", week: 1 });
    const summaries = week.games;
    expect(summaries.filter((g) => g.playable).length).toBe(summaries.length - 1);
  }, 90_000);
});

describe("format 6", () => {
  it("upgrades a format-5 save: stadiums, no weather on old games, current kickoff rules", () => {
    const league = toWeek1(10);
    advance(league);
    const old = JSON.parse(serializeLeague(league));
    old.formatVersion = 5;
    for (const t of old.teams) delete t.stadium;
    for (const g of old.games) delete g.weather;
    old.rules.game.kickoff = { touchbackSpot: 30, shortOrOutOfBoundsSpot: 40 };
    const upgraded = parseLeague(JSON.stringify(old));
    expect(upgraded.formatVersion).toBe(LEAGUE_FORMAT_VERSION);
    expect(upgraded.teams.every((t) => t.stadium.roof !== undefined)).toBe(true);
    expect(upgraded.games.every((g) => g.weather === null)).toBe(true);
    expect(upgraded.rules.game.kickoff).toEqual(league.rules.game.kickoff);
    // Old games without weather still show a game page.
    const played = upgraded.games.find((g) => g.result)!;
    expect(gameView(upgraded, played.id, null).conditions).toBeNull();
  }, 90_000);
});
