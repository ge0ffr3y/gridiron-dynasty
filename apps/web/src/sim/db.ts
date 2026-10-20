/**
 * Browser storage for leagues (IndexedDB via Dexie). The list of leagues and
 * each league's file text are kept apart so listing leagues stays fast.
 */
import Dexie, { type Table } from "dexie";
import type { SavedLeague } from "./protocol";

class LeagueDatabase extends Dexie {
  leagues!: Table<SavedLeague, string>;
  leagueData!: Table<{ id: string; text: string }, string>;

  constructor() {
    super("footballgm-sim");
    this.version(1).stores({ leagues: "id, lastOpenedAt", leagueData: "id" });
  }
}

export const db = new LeagueDatabase();
