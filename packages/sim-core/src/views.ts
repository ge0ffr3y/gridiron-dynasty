/**
 * What each screen shows, built from the league. Ratings come only through the
 * perception layer, so screens never see true ratings. Everything returned is
 * plain data that can cross from the worker to the page.
 */
import { ageOn } from "@fgm/foundation";
import { STARTERS } from "./generate/config";
import type { Coach, CoachRole, League, Player, Team } from "./league/schema";
import { perceivePlayer, type Viewer } from "./perception";
import {
  ATTRIBUTES,
  POSITION_INFO,
  POSITIONS,
  type AttributeGroup,
  type Position,
  type Side,
} from "@fgm/foundation";
import { fortyTime } from "@fgm/foundation";
import { LONGEST_STATS, type StatKey, type StatLine } from "@fgm/game-engine";

export interface TeamCard {
  id: string;
  city: string;
  nickname: string;
  abbreviation: string;
  colors: { primary: string; secondary: string };
  conference: string;
  division: string;
  controller: "ai" | "human";
}

export interface RosterRow {
  id: number;
  name: string;
  position: Position;
  side: Side;
  jersey: number;
  age: number;
  heightIn: number;
  weightLb: number;
  experience: number;
  overall: number;
  teamId: string | null;
  teamAbbreviation: string | null;
}

export interface StaffRow {
  id: number;
  name: string;
  role: CoachRole;
  age: number;
  experience: number;
  scheme: string | null;
}

export interface LeagueSummary {
  name: string;
  seed: number;
  kind: "fictional" | "real";
  date: string;
  season: number;
  counts: { teams: number; players: number; coaches: number; draftPicks: number };
  conferences: {
    id: string;
    name: string;
    divisions: { id: string; name: string; teams: (TeamCard & { starterOverall: number })[] }[];
  }[];
  /** Team identities are placeholders until the Phase 6 naming session. */
  placeholderNames: boolean;
  recentTransactions: { date: string; text: string; reason: string }[];
}

export interface TeamView {
  team: TeamCard;
  starterOverall: number;
  /** This season so far: totals from the team's box scores and its stat leaders. */
  season: {
    year: number;
    games: number;
    pointsFor: number;
    pointsAgainst: number;
    yardsFor: number;
    yardsAgainst: number;
    passYards: number;
    rushYards: number;
    turnovers: number;
    takeaways: number;
    leaders: { label: string; player: { id: number; name: string } | null; value: number }[];
  };
  roster: RosterRow[];
  staff: StaffRow[];
  picks: { id: number; season: number; round: number; from: string; overall: number | null }[];
}

export interface PlayerView {
  id: number;
  name: string;
  position: Position;
  positionName: string;
  team: TeamCard | null;
  jersey: number;
  age: number;
  birthDate: string;
  heightIn: number;
  weightLb: number;
  fortyTime: number;
  experience: number;
  college: string;
  drafted: { season: number; round: number; pick: number; team: string } | null;
  overall: number;
  positionOveralls: { position: Position; overall: number; familiarity: number }[];
  confidence: number;
  attributeGroups: {
    group: AttributeGroup;
    attributes: { key: string; label: string; value: number }[];
  }[];
  contract: { team: string; expiresAfterSeason: number } | null;
  /** Season-by-season stats (one row per team played for), newest first, plus career totals. */
  stats: { season: number; team: string; line: StatLine }[];
  career: StatLine;
}

export interface CoachView {
  id: number;
  name: string;
  role: CoachRole;
  roleName: string;
  team: TeamCard | null;
  age: number;
  birthDate: string;
  experience: number;
  attributes: { key: string; label: string; value: number }[];
  offensiveScheme: string | null;
  defensiveScheme: string | null;
}

const ROLE_NAMES: Record<CoachRole, string> = {
  HC: "Head coach",
  OC: "Offensive coordinator",
  DC: "Defensive coordinator",
  STC: "Special teams coordinator",
  SCOUT: "Scout",
};

const COACH_RATING_LABELS: Record<keyof Coach["ratings"], string> = {
  offense: "Offense",
  defense: "Defense",
  development: "Player development",
  leadership: "Leadership",
  gameManagement: "Game management",
  scouting: "Scouting",
};

function teamCard(league: League, team: Team): TeamCard {
  const conference = league.rules.structure.conferences.find((c) => c.id === team.conferenceId);
  const division = conference?.divisions.find((d) => d.id === team.divisionId);
  return {
    id: team.id,
    city: team.city,
    nickname: team.nickname,
    abbreviation: team.abbreviation,
    colors: team.colors,
    conference: conference?.name ?? team.conferenceId,
    division: division ? `${conference?.name ?? ""} ${division.name}`.trim() : team.divisionId,
    controller: team.controller,
  };
}

function findTeam(league: League, id: string | null): Team | undefined {
  return id === null ? undefined : league.teams.find((t) => t.id === id);
}

function rosterRow(league: League, player: Player, viewer: Viewer): RosterRow {
  const team = findTeam(league, player.teamId);
  return {
    id: player.id,
    name: `${player.firstName} ${player.lastName}`,
    position: player.position,
    side: POSITION_INFO[player.position].side,
    jersey: player.jersey,
    age: ageOn(player.birthDate, league.date),
    heightIn: player.heightIn,
    weightLb: player.weightLb,
    experience: player.experience,
    overall: perceivePlayer(league, player, viewer).overall,
    teamId: player.teamId,
    teamAbbreviation: team?.abbreviation ?? null,
  };
}

/** Average overall of a team's starters (by the viewer's perception), one decimal. */
function starterOverall(rows: RosterRow[]): number {
  let sum = 0;
  let count = 0;
  for (const position of POSITIONS) {
    const best = rows.filter((r) => r.position === position).sort((a, b) => b.overall - a.overall);
    for (const row of best.slice(0, STARTERS[position])) {
      sum += row.overall;
      count++;
    }
  }
  return count === 0 ? 0 : Math.round((sum / count) * 10) / 10;
}

export function leagueSummary(league: League, viewer: Viewer): LeagueSummary {
  const rowsByTeam = new Map<string, RosterRow[]>();
  for (const player of league.players) {
    if (player.teamId === null) continue;
    const rows = rowsByTeam.get(player.teamId) ?? [];
    rows.push(rosterRow(league, player, viewer));
    rowsByTeam.set(player.teamId, rows);
  }
  return {
    name: league.meta.name,
    seed: league.meta.seed,
    kind: league.meta.kind,
    date: league.date,
    season: league.season,
    counts: {
      teams: league.teams.length,
      players: league.players.length,
      coaches: league.coaches.length,
      draftPicks: league.draftPicks.length,
    },
    conferences: league.rules.structure.conferences.map((c) => ({
      id: c.id,
      name: c.name,
      divisions: c.divisions.map((d) => ({
        id: d.id,
        name: d.name,
        teams: d.teams.flatMap((id) => {
          const team = findTeam(league, id);
          return team
            ? [
                {
                  ...teamCard(league, team),
                  starterOverall: starterOverall(rowsByTeam.get(id) ?? []),
                },
              ]
            : [];
        }),
      })),
    })),
    placeholderNames: league.meta.kind === "fictional",
    recentTransactions: league.transactions
      .slice(-10)
      .reverse()
      .map((t) => ({ date: t.date, text: t.text, reason: t.reason })),
  };
}

export function teamView(league: League, teamId: string, viewer: Viewer): TeamView {
  const team = findTeam(league, teamId);
  if (!team) throw new Error(`no team ${teamId}`);
  const roster = league.players
    .filter((p) => p.teamId === teamId)
    .map((p) => rosterRow(league, p, viewer));
  const staff = league.coaches
    .filter((c) => c.teamId === teamId)
    .map((c) => ({
      id: c.id,
      name: `${c.firstName} ${c.lastName}`,
      role: c.role,
      age: ageOn(c.birthDate, league.date),
      experience: c.experience,
      scheme: c.offensiveScheme ?? c.defensiveScheme,
    }));
  const picks = league.draftPicks
    .filter((p) => p.ownerTeamId === teamId)
    .map((p) => ({
      id: p.id,
      season: p.season,
      round: p.round,
      from: p.originalTeamId,
      overall: p.overall,
    }));
  return {
    team: teamCard(league, team),
    starterOverall: starterOverall(roster),
    season: teamSeason(league, teamId),
    roster,
    staff,
    picks,
  };
}

/** Adds stat lines together (longest-play stats keep the best). */
export function sumLines(lines: StatLine[]): StatLine {
  const total: StatLine = {};
  for (const line of lines) {
    for (const [key, value] of Object.entries(line) as [StatKey, number][]) {
      const current = total[key];
      total[key] = LONGEST_STATS.includes(key)
        ? Math.max(current ?? value, value)
        : (current ?? 0) + value;
    }
  }
  return total;
}

function teamSeason(league: League, teamId: string): TeamView["season"] {
  const totals = {
    games: 0,
    pointsFor: 0,
    pointsAgainst: 0,
    yardsFor: 0,
    yardsAgainst: 0,
    passYards: 0,
    rushYards: 0,
    turnovers: 0,
    takeaways: 0,
  };
  for (const g of league.games) {
    if (!g.boxScore || g.round !== "regular" || (g.homeId !== teamId && g.awayId !== teamId))
      continue;
    const us = g.homeId === teamId ? g.boxScore.home : g.boxScore.away;
    const them = g.homeId === teamId ? g.boxScore.away : g.boxScore.home;
    totals.games += 1;
    totals.pointsFor += us.points;
    totals.pointsAgainst += them.points;
    totals.yardsFor += us.totalYards;
    totals.yardsAgainst += them.totalYards;
    totals.passYards += us.passYards;
    totals.rushYards += us.rushYards;
    totals.turnovers += us.turnovers;
    totals.takeaways += them.turnovers;
  }
  const lines = league.players.flatMap((p) =>
    p.stats
      .filter((s) => s.season === league.season && s.teamId === teamId)
      .map((s) => ({ player: p, line: s.line })),
  );
  const leader = (label: string, key: StatKey) => {
    let best: { player: Player; value: number } | null = null;
    for (const { player, line } of lines) {
      const value = line[key] ?? 0;
      if (value > 0 && (!best || value > best.value)) best = { player, value };
    }
    return {
      label,
      player: best
        ? { id: best.player.id, name: `${best.player.firstName} ${best.player.lastName}` }
        : null,
      value: best?.value ?? 0,
    };
  };
  return {
    year: league.season,
    ...totals,
    leaders: [
      leader("Passing yards", "passYds"),
      leader("Rushing yards", "rushYds"),
      leader("Receiving yards", "recYds"),
      leader("Tackles", "tackles"),
      leader("Sacks", "sacks"),
      leader("Interceptions", "defInt"),
    ],
  };
}

export function playersView(league: League, viewer: Viewer): RosterRow[] {
  return league.players.map((p) => rosterRow(league, p, viewer));
}

export function playerView(league: League, playerId: number, viewer: Viewer): PlayerView {
  const player = league.players.find((p) => p.id === playerId);
  if (!player) throw new Error(`no player ${playerId}`);
  const team = findTeam(league, player.teamId);
  const seen = perceivePlayer(league, player, viewer);
  const groups: AttributeGroup[] = ["physical", "technical", "mental"];
  const draftTeam = player.drafted ? findTeam(league, player.drafted.teamId) : undefined;
  const contractTeam = player.contract ? findTeam(league, player.contract.teamId) : undefined;
  return {
    id: player.id,
    name: `${player.firstName} ${player.lastName}`,
    position: player.position,
    positionName: POSITION_INFO[player.position].name,
    team: team ? teamCard(league, team) : null,
    jersey: player.jersey,
    age: ageOn(player.birthDate, league.date),
    birthDate: player.birthDate,
    heightIn: player.heightIn,
    weightLb: player.weightLb,
    fortyTime: fortyTime(seen.ratings.speed),
    experience: player.experience,
    college: player.college,
    drafted: player.drafted
      ? {
          ...player.drafted,
          team: draftTeam ? `${draftTeam.city} ${draftTeam.nickname}` : player.drafted.teamId,
        }
      : null,
    overall: seen.overall,
    positionOveralls: seen.positionOveralls,
    confidence: seen.confidence,
    attributeGroups: groups.map((group) => ({
      group,
      attributes: ATTRIBUTES.filter((a) => a.group === group).map((a) => ({
        key: a.key,
        label: a.label,
        value: seen.ratings[a.key],
      })),
    })),
    contract: player.contract
      ? {
          team: contractTeam
            ? `${contractTeam.city} ${contractTeam.nickname}`
            : player.contract.teamId,
          expiresAfterSeason: player.contract.expiresAfterSeason,
        }
      : null,
    stats: [...player.stats]
      .sort((a, b) => b.season - a.season)
      .map((s) => ({ season: s.season, team: s.teamId, line: s.line })),
    career: sumLines(player.stats.map((s) => s.line)),
  };
}

export function coachView(league: League, coachId: number): CoachView {
  const coach = league.coaches.find((c) => c.id === coachId);
  if (!coach) throw new Error(`no coach ${coachId}`);
  const team = findTeam(league, coach.teamId);
  return {
    id: coach.id,
    name: `${coach.firstName} ${coach.lastName}`,
    role: coach.role,
    roleName: ROLE_NAMES[coach.role],
    team: team ? teamCard(league, team) : null,
    age: ageOn(coach.birthDate, league.date),
    birthDate: coach.birthDate,
    experience: coach.experience,
    attributes: (Object.keys(COACH_RATING_LABELS) as (keyof Coach["ratings"])[]).map((key) => ({
      key,
      label: COACH_RATING_LABELS[key],
      value: coach.ratings[key],
    })),
    offensiveScheme: coach.offensiveScheme,
    defensiveScheme: coach.defensiveScheme,
  };
}
