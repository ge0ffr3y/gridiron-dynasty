/**
 * The real league's past (Phase 15): the pipeline hands over seasons from before the league began,
 * award winners, Hall of Famers, retired numbers and the record books, all renamed. People are
 * named by a key: a current player's key is his source id (the league's players are sorted by it),
 * anyone else long gone is a "legend" with a short history card.
 */
import type { Position } from "@fgm/foundation";
import type { StatLine } from "@fgm/game-engine";
import type {
  Annal,
  AwardKind,
  FormerPlayer,
  League,
  RecordLevel,
  RecordStat,
} from "../league/schema";
import { recordList } from "./records";

export interface RealLegend {
  key: string;
  firstName: string;
  lastName: string;
  position: Position;
  firstSeason: number;
  lastSeason: number;
  /** Franchise ids, in order, where known. */
  teams: string[];
  seasonsStarted: number;
  career: StatLine;
  number: number | null;
  titles: number;
}

export interface RealHistoryInput {
  annals: Annal[];
  legends: RealLegend[];
  awards: {
    season: number;
    award: AwardKind;
    place: number;
    /** A current player's key or a legend's; null for a coach. */
    key: string | null;
    name: string;
    position: string;
    teamId: string | null;
    reason: string;
  }[];
  hallOfFame: {
    kind: "player" | "coach" | "contributor";
    key: string | null;
    name: string;
    position: string;
    teams: string[];
    inducted: number;
    reason: string;
  }[];
  retiredNumbers: {
    teamId: string;
    number: number;
    key: string | null;
    name: string;
    season: number | null;
  }[];
  records: {
    scope: string;
    level: RecordLevel;
    stat: RecordStat;
    top: {
      value: number;
      key: string | null;
      name: string;
      teamId: string | null;
      season: number | null;
    }[];
  }[];
}

/** Puts the real past into a new real league. `playerIds` maps a current player's key to his id. */
export function applyRealHistory(
  league: League,
  input: RealHistoryInput,
  playerIds: Map<string, number>,
): void {
  const ids = new Map(playerIds);
  // Legends become history cards (they never play again; the Hall's ballot skips them).
  for (const l of [...input.legends].sort((a, b) => a.key.localeCompare(b.key))) {
    const id = league.nextIds.player++;
    ids.set(l.key, id);
    const card: FormerPlayer = {
      id,
      firstName: l.firstName,
      lastName: l.lastName,
      position: l.position,
      college: "",
      // His birthday isn't in the sources: about 23 when he began.
      birthDate: `${l.firstSeason - 23}-07-01`,
      drafted: null,
      experience: l.lastSeason - l.firstSeason + 1,
      retiredAfter: l.lastSeason,
      firstSeason: l.firstSeason,
      lastSeason: l.lastSeason,
      lastAge: 23 + (l.lastSeason - l.firstSeason),
      teams: l.teams,
      seasonsStarted: l.seasonsStarted,
      peak: 0,
      career: l.career,
      number: l.number,
      legend: true,
      titles: l.titles,
    };
    league.formerPlayers.push(card);
  }
  league.annals = [...input.annals].sort((a, b) => a.season - b.season);
  const id = (key: string | null) => (key === null ? null : (ids.get(key) ?? null));
  for (const a of input.awards)
    league.awards.push({
      season: a.season,
      award: a.award,
      place: a.place,
      playerId: id(a.key),
      coachId: null,
      name: a.name,
      position: a.position,
      teamId: a.teamId,
      share: null,
      reason: a.reason,
      real: true,
    });
  for (const h of input.hallOfFame)
    league.hallOfFame.push({
      kind: h.kind,
      playerId: h.kind === "player" ? id(h.key) : null,
      coachId: null,
      executiveId: null,
      name: h.name,
      position: h.position,
      teams: h.teams,
      inducted: h.inducted,
      waited: null,
      reason: h.reason,
      real: true,
    });
  for (const r of input.retiredNumbers)
    league.retiredNumbers.push({
      teamId: r.teamId,
      number: r.number,
      name: r.name,
      playerId: id(r.key),
      season: r.season,
      real: true,
    });
  for (const r of input.records) {
    const list = recordList(league, r.scope, r.level, r.stat);
    list.top = r.top.map((e) => ({
      value: e.value,
      playerId: id(e.key),
      name: e.name,
      teamId: e.teamId,
      season: e.season,
      date: null,
      real: true,
    }));
  }
  league.hallOfFame.sort((a, b) => a.inducted - b.inducted || a.name.localeCompare(b.name));
}
