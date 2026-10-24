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

/** A league as it stood when a season began (Phase 14b). */
export interface Backup {
  leagueId: string;
  season: number;
  date: string;
  savedAt: number;
  text: string;
}

/** Season backups kept per league. */
export const BACKUPS_KEPT = 3;

class LeagueDatabase extends Dexie {
  leagues!: Table<SavedLeague, string>;
  leagueData!: Table<{ id: string; text: string }, string>;
  playLogs!: Table<PlayLog, [string, number, number]>;
  backups!: Table<Backup, [string, number]>;

  constructor() {
    super("footballgm-sim");
    this.version(1).stores({ leagues: "id, lastOpenedAt", leagueData: "id" });
    this.version(2).stores({
      leagues: "id, lastOpenedAt",
      leagueData: "id",
      playLogs: "[leagueId+season+gameId], leagueId, [leagueId+season]",
    });
    // Phase 14b: a backup of each league at the start of each season (the last few kept).
    this.version(3).stores({
      leagues: "id, lastOpenedAt",
      leagueData: "id",
      playLogs: "[leagueId+season+gameId], leagueId, [leagueId+season]",
      backups: "[leagueId+season], leagueId",
    });
  }
}

export const db = new LeagueDatabase();

/** Play-by-play is kept for the current and previous season only. */
export const PLAY_LOG_SEASONS_KEPT = 2;
