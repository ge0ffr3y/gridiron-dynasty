/**
 * Keeping saves small (Phase 18): old log lines go, nothing that is read does, scores of past games
 * are kept, and a save from before the change still opens.
 */
import { describe, expect, it } from "vitest";
import { createLeague } from "../generate/league";
import { seasonRecapView } from "../history/views";
import { parseLeague, serializeLeague } from "../serialize";
import { advance, advanceUntil } from "../season/flow";
import { KEEP, pruneLogs } from "./prune";

// One played season, at the start of the next offseason.
const league = createLeague({ seed: 41, name: "Prune" });
advanceUntil(league, (l) => l.calendar.stage === "complete");
advance(league);
const saved = serializeLeague(league);

const tx = (id: number, date: string, type: "drafted" | "signed" = "signed") => ({
  id,
  date,
  type,
  teamIds: [],
  playerIds: [],
  text: "x",
  reason: "y",
});

describe("a season's scores are kept", () => {
  it("every regular-season game's score is in the history, and the recap reads them", () => {
    const h = league.history.at(-1)!;
    expect(h.results).toHaveLength(272);
    const [week, home, away, homeScore, awayScore, overtime] = h.results[0]!;
    expect(week).toBe(1);
    expect(home).not.toBe(away);
    expect(Number.isInteger(homeScore + awayScore)).toBe(true);
    expect([0, 1]).toContain(overtime);
    const recap = seasonRecapView(league, h.season);
    expect(recap.scores).toHaveLength(18);
    expect(recap.scores.reduce((n, w) => n + w.games.length, 0)).toBe(272);
  });
});

describe("pruning the logs", () => {
  it("keeps this season and the two before, remembers which drafts were held, and keeps the news in step", () => {
    const l = parseLeague(saved);
    const season = l.season;
    const old = `${season - 5}-04-20`;
    const kept = `${season - 2}-04-20`;
    const base = l.transactions.length;
    l.transactions.push(tx(1e6, old, "drafted"), tx(1e6 + 1, old), tx(1e6 + 2, kept));
    // Coaching moves from long ago go too, and the cursor moves back by as many.
    const move = l.coachingMoves[0] ?? {
      season: 1,
      date: "2020-01-01",
      kind: "hired" as const,
      coachId: 0,
      teamId: null,
      role: "HC" as const,
      text: "x",
      reason: "y",
    };
    l.coachingMoves = [
      { ...move, season: season - KEEP.moveSeasons - 3 },
      { ...move, season: season - KEEP.moveSeasons - 2 },
      { ...move, season },
    ];
    l.newsCursor.coachingMove = 3;
    pruneLogs(l);
    expect(l.transactions.every((t) => t.date >= `${season - 2}-01-01`)).toBe(true);
    expect(l.transactions.some((t) => t.id === 1e6 + 2)).toBe(true);
    expect(l.transactions.some((t) => t.id === 1e6)).toBe(false);
    expect(l.transactions.length).toBeLessThanOrEqual(base + 3);
    expect(l.draftsHeld).toContain(season - 5);
    expect(l.coachingMoves).toHaveLength(1);
    expect(l.newsCursor.coachingMove).toBe(1);
    // Pruning twice changes nothing more.
    const again = JSON.stringify(l);
    pruneLogs(l);
    expect(JSON.stringify(l)).toBe(again);
  });

  it("a league that keeps playing stays small: a season's log is dropped three seasons on", () => {
    const l = parseLeague(saved);
    l.season += 3;
    pruneLogs(l);
    expect(l.transactions.length).toBe(0);
  });
});

describe("saves", () => {
  it("a format-21 save opens with no scores and its drafts held, read from its transactions", () => {
    const old = JSON.parse(saved);
    old.formatVersion = 21;
    delete old.draftsHeld;
    for (const h of old.history) delete h.results;
    const l = parseLeague(JSON.stringify(old));
    expect(l.history.every((h) => h.results.length === 0)).toBe(true);
    expect(l.draftsHeld.length).toBeGreaterThan(0);
    expect(l.formatVersion).toBeGreaterThanOrEqual(22);
  });
});
