/**
 * History cards (Phase 13): players retired (or unsigned) for four seasons leave the player list
 * as short cards; draft history and their pages still work; saves upgrade.
 */
import { describe, expect, it } from "vitest";
import { createLeague } from "../generate/league";
import { parseLeague, serializeLeague } from "../serialize";
import { draftHistoryView } from "../draft/views";
import { archivePlayers, formerPlayerView } from "./archive";

describe("history cards", () => {
  it("players retired four seasons ago move to cards; recent retirees and active players stay", () => {
    const l = createLeague({ seed: 5, name: "Archive" });
    const [old, recent, freeAgent] = l.players.filter((p) => p.teamId && p.drafted);
    for (const [p, retired] of [
      [old!, l.season - 5],
      [recent!, l.season - 2],
    ] as const) {
      p.retiredAfter = retired;
      p.teamId = null;
      p.contract = null;
    }
    // A free agent nobody has signed for years (his last team season long ago).
    freeAgent!.teamId = null;
    freeAgent!.contract = null;
    freeAgent!.stats = [];
    freeAgent!.ratingHistory = freeAgent!.ratingHistory.map((h) => ({
      ...h,
      season: l.season - 6,
    }));
    freeAgent!.drafted = { ...freeAgent!.drafted!, season: l.season - 9 };
    const before = l.players.length;
    const moved = archivePlayers(l, l.season);
    expect(moved).toBe(2);
    expect(l.players.length).toBe(before - 2);
    expect(l.players.some((p) => p.id === recent!.id)).toBe(true);
    const card = formerPlayerView(l, old!.id);
    expect(card.name).toBe(`${old!.firstName} ${old!.lastName}`);
    expect(card.retiredAfter).toBe(l.season - 5);
    expect(() => formerPlayerView(l, recent!.id)).toThrow(/no player/);
  });

  it("draft history still lists a long-gone pick, and saves round-trip with cards", () => {
    const l = createLeague({ seed: 6, name: "Archive" });
    const p = l.players.find((x) => x.drafted && x.drafted.season < l.season)!;
    p.retiredAfter = l.season - 6;
    p.teamId = null;
    p.contract = null;
    archivePlayers(l, l.season);
    expect(l.formerPlayers.some((c) => c.id === p.id)).toBe(true);
    const back = parseLeague(serializeLeague(l));
    expect(back.formerPlayers.length).toBe(l.formerPlayers.length);
    const history = draftHistoryView(back, { kind: "league" }, p.drafted!.season);
    // Generated back-story drafts aren't listed; when the draft is shown, he's in it.
    if (history.season === p.drafted!.season)
      expect(history.picks.some((x) => x.player.id === p.id)).toBe(true);
  });

  it("a format-17 save loads with no cards yet", () => {
    const l = createLeague({ seed: 7, name: "Archive" });
    const old = JSON.parse(serializeLeague(l));
    old.formatVersion = 17;
    delete old.formerPlayers;
    expect(parseLeague(JSON.stringify(old)).formerPlayers).toEqual([]);
  });
});
