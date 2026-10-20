/**
 * Browser storage for leagues (IndexedDB via Dexie). The list of leagues,
 * each league's file text, and the play-by-play of its games are kept apart:
 * listing leagues stays fast, and play-by-play (megabytes a season) never
 * slows down saving the league itself.
 */
import type { Play } from "@fgm/game-engine";
import Dexie, { type Table } from "dexie";
import type { SavedLeague } from "./protocol";

export interface PlayLog {
  leagueId: string;
  season: number;
  gameId: number;
  plays: Play[];
}

class LeagueDatabase extends Dexie {
  leagues!: Table<SavedLeague, string>;
  leagueData!: Table<{ id: string; text: string }, string>;
  playLogs!: Table<PlayLog, [string, number, number]>;

  constructor() {
    super("footballgm-sim");
    this.version(1).stores({ leagues: "id, lastOpenedAt", leagueData: "id" });
    this.version(2).stores({
      leagues: "id, lastOpenedAt",
      leagueData: "id",
      playLogs: "[leagueId+season+gameId], leagueId, [leagueId+season]",
    });
  }
}

export const db = new LeagueDatabase();

/** Play-by-play is kept for the current and previous season only. */
export const PLAY_LOG_SEASONS_KEPT = 2;
