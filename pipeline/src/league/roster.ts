/**
 * Who's in the real league: every team's roster at the end of the 2025
 * season (active, reserve and practice squad), plus players who played in
 * 2025 but finished it unsigned (free agents). Bios come from nflverse's
 * player list; positions are mapped to ours.
 */
import type { Position } from "@fgm/sim-core";
import type { Row } from "../matchups";
import { num } from "../matchups";
import { leagueTeam, SEASON } from "./inputs";

/** Roster statuses that mean "on the team": active, reserve lists, inactive, practice squad. */
const ON_TEAM = new Set(["ACT", "RES", "INA", "DEV"]);

/** One real person, as the import knows him. Real names stay inside the pipeline. */
export interface RealPerson {
  gsis: string;
  pfr: string;
  realFirst: string;
  realLast: string;
  /** Nicknames and common first names ("C.J." for a legal "Coleridge"), for matching. */
  otherFirst: string[];
  /** The nflverse position label (DE, OLB, FS, T, ...). */
  rawPosition: string;
  position: Position;
  teamId: string | null;
  /** End-of-season roster status (FA for free agents). */
  status: string;
  jersey: number;
  birthDate: string;
  heightIn: number;
  weightLb: number;
  /** Seasons before 2025 (a 2025 rookie has 0). */
  yearsBefore: number;
  college: string;
  draft: { season: number; round: number; pick: number; teamId: string } | null;
  /** 2025 regular season: average share of his team's snaps, per side, over 17 games. */
  snapShare: { offense: number; defense: number; special: number };
  games: number;
}

const BASE_POSITION: Record<string, Position> = {
  QB: "QB",
  RB: "RB",
  HB: "RB",
  FB: "FB",
  WR: "WR",
  TE: "TE",
  T: "OT",
  OT: "OT",
  G: "OG",
  OG: "OG",
  C: "C",
  DT: "DT",
  NT: "DT",
  ILB: "LB",
  MLB: "LB",
  LB: "LB",
  CB: "CB",
  DB: "CB",
  FS: "S",
  SS: "S",
  S: "S",
  SAF: "S",
  K: "K",
  P: "P",
  LS: "LS",
};

/** Weight at which a "defensive end" plays inside, as 3-4 ends do. */
const INSIDE_END_WEIGHT = 295;
/** Weight at which an outside linebacker is an edge rusher if nothing else says so. */
const EDGE_OLB_WEIGHT = 245;

/**
 * Our position for a real player. Ends and outside linebackers are the hard
 * part: an "OLB" may be a 3-4 pass rusher (EDGE) or an off-ball linebacker.
 * Madden's archetype settles it when we have one; otherwise weight does.
 */
export function mapPosition(raw: string, weightLb: number, archetype?: string): Position | null {
  if (raw === "DE" || raw === "DL") return weightLb >= INSIDE_END_WEIGHT ? "DT" : "EDGE";
  if (raw === "OLB") {
    if (archetype) return /Rusher/.test(archetype) ? "EDGE" : "LB";
    return weightLb >= EDGE_OLB_WEIGHT ? "EDGE" : "LB";
  }
  return BASE_POSITION[raw] ?? null;
}

function heightInches(v: string | undefined): number {
  if (!v) return NaN;
  if (v.includes("-")) {
    const [ft, inch] = v.split("-").map(Number) as [number, number];
    return ft * 12 + inch;
  }
  return Number(v);
}

export interface RosterInputs {
  rosters: Row[];
  players: Row[];
  stats: Row[];
  snaps: Row[];
  archetypeOf: (gsis: string) => string | undefined;
}

export interface RosterResult {
  people: RealPerson[];
  /** Roster rows we couldn't use, with the reason (the unmatched report). */
  problems: string[];
}

export function buildRoster(input: RosterInputs): RosterResult {
  const problems: string[] = [];
  const bio = new Map(input.players.map((p) => [p.gsis_id ?? "", p]));

  // Each team's roster from its last week of the season (the final for two teams).
  const lastWeek = new Map<string, number>();
  for (const r of input.rosters)
    lastWeek.set(r.team!, Math.max(lastWeek.get(r.team!) ?? 0, Number(r.week)));
  const finalRows = input.rosters.filter(
    (r) => Number(r.week) === lastWeek.get(r.team!) && ON_TEAM.has(r.status ?? ""),
  );

  // Snap shares by pfr id: the average of per-game percentages over a 17-game season.
  const snapShare = new Map<string, { offense: number; defense: number; special: number }>();
  for (const s of input.snaps) {
    if (s.game_type !== "REG") continue;
    const id = s.pfr_player_id ?? "";
    const e = snapShare.get(id) ?? { offense: 0, defense: 0, special: 0 };
    e.offense += (num(s.offense_pct) || 0) / 17;
    e.defense += (num(s.defense_pct) || 0) / 17;
    e.special += (num(s.st_pct) || 0) / 17;
    snapShare.set(id, e);
  }
  const gamesPlayed = new Map(input.stats.map((s) => [s.player_id ?? "", num(s.games) || 0]));

  const people = new Map<string, RealPerson>();
  const add = (r: Row, teamId: string | null, status: string) => {
    const gsis = r.gsis_id ?? "";
    if (!gsis) {
      problems.push(`no player id: ${r.full_name} (${r.team} ${r.position})`);
      return;
    }
    if (people.has(gsis)) return;
    const b = bio.get(gsis);
    const weightLb = num(r.weight) || num(b?.weight);
    const rawPosition = r.depth_chart_position || b?.position || r.position || "";
    const position = mapPosition(rawPosition, weightLb, input.archetypeOf(gsis));
    const birthDate = r.birth_date || b?.birth_date || "";
    const heightIn = heightInches(r.height) || heightInches(b?.height);
    if (!position || !birthDate || !heightIn || !weightLb) {
      problems.push(
        `missing ${!position ? `position (${rawPosition})` : !birthDate ? "birth date" : "size"}: ${gsis}`,
      );
      return;
    }
    const draftTeam = b?.draft_team || r.draft_club || "";
    const draftRound = num(b?.draft_round);
    people.set(gsis, {
      gsis,
      pfr: r.pfr_id || b?.pfr_id || "",
      realFirst: r.first_name || b?.first_name || "",
      realLast: r.last_name || b?.last_name || "",
      otherFirst: [r.football_name, b?.football_name, b?.common_first_name].filter(
        (f): f is string => !!f,
      ),
      rawPosition,
      position,
      teamId,
      status,
      jersey: num(r.jersey_number) || num(b?.jersey_number) || 0,
      birthDate,
      heightIn,
      weightLb,
      yearsBefore: num(r.years_exp) || 0,
      college: r.college || b?.college_name || "",
      draft:
        draftRound > 0 && draftTeam
          ? {
              season: num(b?.draft_year) || num(r.entry_year),
              round: draftRound,
              pick: num(b?.draft_pick) || num(r.draft_number),
              teamId: leagueTeam(draftTeam),
            }
          : null,
      snapShare: snapShare.get(r.pfr_id || b?.pfr_id || "") ?? {
        offense: 0,
        defense: 0,
        special: 0,
      },
      games: gamesPlayed.get(gsis) ?? 0,
    });
  };

  for (const r of finalRows) add(r, leagueTeam(r.team!), r.status!);

  // Free agents: played in 2025, on nobody's roster at the end, and not retired.
  const latestRow = new Map<string, Row>();
  for (const r of input.rosters) {
    const prev = latestRow.get(r.gsis_id ?? "");
    if (!prev || Number(r.week) >= Number(prev.week)) latestRow.set(r.gsis_id ?? "", r);
  }
  for (const [gsis, r] of latestRow) {
    if (!gsis || people.has(gsis) || (gamesPlayed.get(gsis) ?? 0) === 0) continue;
    if (r.status === "RET" || bio.get(gsis)?.status === "RET") continue;
    add(r, null, "FA");
  }

  return {
    people: [...people.values()].sort((a, b) => a.gsis.localeCompare(b.gsis)),
    problems,
  };
}

/** Credited seasons at the start of the 2026 league year. */
export const experienceAfter = (p: RealPerson) => p.yearsBefore + 1;
export { SEASON };
