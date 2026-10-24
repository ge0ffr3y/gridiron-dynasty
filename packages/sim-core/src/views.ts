/**
 * What each screen shows, built from the league. Ratings come only through the
 * perception layer, so screens never see true ratings. Everything returned is
 * plain data that can cross from the worker to the page.
 */
import { honorsOf, type Honors } from "./history/honors";
import { capHit, span, totalValue } from "./contracts/contract";
import { ageOn } from "@fgm/foundation";
import { STARTERS } from "./generate/config";
import { stageLabel } from "./season/calendar";
import { careerView } from "./coaches/carousel";
import { ROLE_NAMES, STAFF_ROLES } from "./coaches/config";
import {
  jobEffects,
  mainSkill,
  perceivedFit,
  philosophy,
  styleSummary,
  type PhilosophyLine,
} from "./coaches/views";
import type { Coach, CoachRole, League, Player, RosterList, Team } from "./league/schema";
import { perceiveChange, perceiveHistory, perceivePlayer, type Viewer } from "./perception";
import {
  ATTRIBUTES,
  POSITION_INFO,
  POSITIONS,
  type AttributeGroup,
  type Position,
  type Side,
} from "@fgm/foundation";
import { estimatedForty } from "./scouting/measurables";
import { MOOD_LABELS, moodLabel, moodReason } from "./people/morale";
import { openDisputes } from "./people/disputes";
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
  /** Out injured: how many more of his team's games he'll miss. */
  injury: { description: string; gamesRemaining: number } | null;
  /** Where he's listed on his team (null for free agents). */
  list: RosterList | null;
  /** His fit in his team's scheme, as the viewer's staff sees it (Phase 10). */
  fit: { scheme: string; score: number; label: string } | null;
  /** How he feels (Phase 12b), and a holdout, hold-in or trade request under way. */
  mood: { score: number; label: string; reason: string } | null;
  dispute: "holdout" | "hold-in" | "trade-request" | null;
}

export interface StaffRow {
  id: number;
  name: string;
  role: CoachRole;
  roleName: string;
  age: number;
  experience: number;
  scheme: string | null;
  /** The skill that matters most in his job (Phase 10). */
  mainSkill: { label: string; value: number };
  /** How he coaches (coordinators and head coach), or what his job does. */
  summary: string;
}

export interface LeagueSummary {
  name: string;
  seed: number;
  kind: "fictional" | "real";
  date: string;
  season: number;
  /** Where the League Year stands, in words ("Free agency", "Week 3"). */
  stage: string;
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
    /** Advanced (EPA per play, success rate, pressure) for the offense and against the defense. */
    advanced: {
      offenseEpaPerPlay: number;
      offenseSuccessRate: number;
      defenseEpaPerPlay: number;
      defenseSuccessRate: number;
      pressureRateAllowed: number;
      pressureRateForced: number;
    } | null;
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
  /** True when the 40 was run (combine or pro day); otherwise it's the scouts' estimate from tape. */
  fortyMeasured: boolean;
  experience: number;
  college: string;
  drafted: { season: number; round: number; pick: number; team: string } | null;
  overall: number;
  positionOveralls: { position: Position; overall: number; familiarity: number }[];
  confidence: number;
  /** The overall's likely range, as the viewer's staff sees it. */
  overallRange: [number, number];
  /** The staff's read of what he could become (never the hidden number itself). */
  potential: { estimate: number; range: [number, number] };
  attributeGroups: {
    group: AttributeGroup;
    attributes: { key: string; label: string; value: number }[];
  }[];
  contract: {
    team: string;
    expiresAfterSeason: number;
    capHit: number;
    averagePerYear: number;
  } | null;
  injury: {
    description: string;
    part: string;
    severity: string;
    status: "Out" | "Doubtful" | "Questionable";
    gamesRemaining: number;
    totalGames: number;
    since: string;
  } | null;
  /** A knock he's playing through (listed Questionable). */
  knock: { part: string; since: string } | null;
  /** Awards, Hall of Fame and retired number (Phase 15). */
  honors: Honors;
  /** Every injury, newest first: when, what, where, and games he was expected to miss. */
  injuryHistory: { season: number; date: string; part: string; kind: string; games: number }[];
  /** His overall at the end of each season, oldest first, then where he stands now. */
  ratingHistory: {
    season: number;
    age: number;
    team: string | null;
    position: Position;
    overall: number;
    /** The current season, before it's finished. */
    now: boolean;
  }[];
  /** His fit in his team's scheme, as the viewer's staff sees it (Phase 10). */
  schemeFit: { scheme: string; score: number; label: string } | null;
  /** This season's notable development: the League Year, camp and in-season changes. */
  development: { stage: string; date: string; change: number; reason: string }[];
  /** How he feels about where he is (Phase 12b): 0-100 and what moved it. */
  mood: {
    score: number;
    label: string;
    reason: string;
    factors: { key: string; label: string; points: number }[];
  } | null;
  /** His holdouts, hold-ins and trade requests, newest first (open ones have no end). */
  disputes: {
    season: number;
    kind: "holdout" | "hold-in" | "trade-request";
    team: string;
    start: string;
    end: string | null;
    outcome: string | null;
    reason: string;
    response: string;
    fines: number;
  }[];
  /** Where he's listed with his team (null for free agents), and since when on a reserve list. */
  list: RosterList | null;
  reserve: { since: string; gamesMissed: number; designatedToReturn: boolean } | null;
  /** Game-day elevations from the practice squad this season. */
  elevations: number;
  retiredAfter: number | null;
  /** This year's preseason: his stat line and showcase grade (50 = typical). */
  preseason: { season: number; line: StatLine; grade: number | null } | null;
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
  /** His leanings against the league average (Phase 10), his job's side first. */
  philosophy: PhilosophyLine[];
  /** A few words on how he coaches ("" for jobs without a style). */
  summary: string;
  /** What his job does for his team, in plain English. */
  effects: string[];
  /** His career, reputation and coaching tree (Phase 10b). */
  career: ReturnType<typeof careerView>;
}

const COACH_RATING_LABELS: Record<keyof Coach["ratings"], string> = {
  offense: "Offense",
  defense: "Defense",
  development: "Player development",
  leadership: "Leadership",
  gameManagement: "Game management",
  scouting: "Scouting",
  health: "Health (strength and medical)",
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
    injury: player.injury
      ? { description: player.injury.description, gamesRemaining: player.injury.gamesRemaining }
      : null,
    list: player.teamId ? player.roster : null,
    fit: perceivedFit(league, player, viewer),
    mood: player.mood
      ? {
          score: Math.round(player.mood.score),
          label: moodLabel(player.mood.score),
          reason: moodReason(player),
        }
      : null,
    dispute: openDisputes(league).get(player.id)?.kind ?? null,
  };
}

/** Average overall of a team's starters (by the viewer's perception), one decimal. */
function starterOverall(all: RosterRow[]): number {
  // Starters come from the active roster (not the practice squad or reserve lists).
  const rows = all.filter((r) => r.list === "active" || r.list === null);
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
    stage: stageLabel(league.calendar.stage, league.calendar.week),
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
    // In staff order: head coach, coordinators, position coaches, support staff, scouts.
    .sort(
      (a, b) =>
        STAFF_ROLES.findIndex((r) => r.role === a.role) -
          STAFF_ROLES.findIndex((r) => r.role === b.role) || a.id - b.id,
    )
    .map((c) => {
      const main = mainSkill(c);
      return {
        id: c.id,
        name: `${c.firstName} ${c.lastName}`,
        role: c.role,
        roleName: ROLE_NAMES[c.role],
        age: ageOn(c.birthDate, league.date),
        experience: c.experience,
        scheme: c.role === "DC" ? c.defensiveScheme : (c.offensiveScheme ?? c.defensiveScheme),
        mainSkill: {
          label: COACH_RATING_LABELS[main.key as keyof Coach["ratings"]],
          value: main.value,
        },
        summary: styleSummary(c) || jobEffects(league, c)[0] || "",
      };
    });
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
  const adv = {
    epa: 0,
    plays: 0,
    successes: 0,
    epaAllowed: 0,
    playsAgainst: 0,
    successesAllowed: 0,
    dropbacks: 0,
    pressured: 0,
    dropbacksAgainst: 0,
    pressuresForced: 0,
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
    adv.epa += us.epa;
    adv.plays += us.epaPlays;
    adv.successes += us.successPlays;
    adv.epaAllowed += them.epa;
    adv.playsAgainst += them.epaPlays;
    adv.successesAllowed += them.successPlays;
    adv.dropbacks += us.dropbacks;
    adv.pressured += us.pressured;
    adv.dropbacksAgainst += them.dropbacks;
    adv.pressuresForced += them.pressured;
  }
  const ratio = (a: number, b: number) => (b > 0 ? a / b : 0);
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
    // Games from saves older than Phase 4b have no advanced totals.
    advanced:
      adv.plays === 0
        ? null
        : {
            offenseEpaPerPlay: ratio(adv.epa, adv.plays),
            offenseSuccessRate: ratio(adv.successes, adv.plays),
            defenseEpaPerPlay: ratio(adv.epaAllowed, adv.playsAgainst),
            defenseSuccessRate: ratio(adv.successesAllowed, adv.playsAgainst),
            pressureRateAllowed: ratio(adv.pressured, adv.dropbacks),
            pressureRateForced: ratio(adv.pressuresForced, adv.dropbacksAgainst),
          },
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
  return league.players
    .filter((p) => p.retiredAfter === null)
    .map((p) => rosterRow(league, p, viewer));
}

/** Season-end overalls as the viewer sees them, plus this season so far. */
function ratingHistoryFor(
  league: League,
  player: Player,
  viewer: Viewer,
  overall: number,
): PlayerView["ratingHistory"] {
  const past = perceiveHistory(league, player, viewer).map((h) => ({
    season: h.season,
    age: h.age,
    team: h.teamId,
    position: h.position,
    overall: h.overall,
    now: false,
  }));
  if (player.retiredAfter !== null || past.some((h) => h.season === league.season)) return past;
  return [
    ...past,
    {
      season: league.season,
      age: ageOn(player.birthDate, league.date),
      team: player.teamId,
      position: player.position,
      overall,
      now: true,
    },
  ];
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
    honors: honorsOf(league, player.id),
    team: team ? teamCard(league, team) : null,
    jersey: player.jersey,
    age: ageOn(player.birthDate, league.date),
    birthDate: player.birthDate,
    heightIn: player.heightIn,
    weightLb: player.weightLb,
    fortyTime: player.measurables?.forty ?? estimatedForty(seen.ratings, player.position),
    fortyMeasured: player.measurables?.forty != null,
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
    overallRange: seen.range,
    potential: seen.potential,
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
          expiresAfterSeason: span(player.contract).lastReal,
          capHit: capHit(player.contract, league.season, league.rules.cap),
          averagePerYear: Math.round(
            totalValue(player.contract) /
              Math.max(1, player.contract.years.filter((y) => !y.void).length),
          ),
        }
      : null,
    injury: player.injury,
    knock: player.knock,
    injuryHistory: [...player.injuryHistory].reverse(),
    ratingHistory: ratingHistoryFor(league, player, viewer, seen.overall),
    schemeFit: perceivedFit(league, player, viewer),
    development: league.development
      .filter((r) => r.season === league.season)
      .flatMap((r) =>
        r.changes
          .filter((c) => c.playerId === player.id)
          .map((c) => {
            const d = perceiveChange(league, player, viewer, c.before, c.after);
            return { stage: r.stage, date: r.date, change: d.after - d.before, reason: c.reason };
          }),
      )
      .filter((d) => d.change !== 0),
    mood: player.mood
      ? {
          score: Math.round(player.mood.score),
          label: moodLabel(player.mood.score),
          reason: moodReason(player),
          factors: [...player.mood.factors]
            .sort((a, b) => Math.abs(b.points) - Math.abs(a.points))
            .map((f) => ({ key: f.key, label: MOOD_LABELS[f.key], points: f.points })),
        }
      : null,
    disputes: league.disputes
      .filter((d) => d.playerId === player.id)
      .reverse()
      .map((d) => ({
        season: d.season,
        kind: d.kind,
        team: d.teamId,
        start: d.start,
        end: d.end,
        outcome: d.outcome,
        reason: d.reason,
        response: d.response,
        fines: d.fines,
      })),
    list: player.teamId ? player.roster : null,
    reserve: player.reserve,
    elevations: player.elevations,
    retiredAfter: player.retiredAfter,
    preseason: player.preseason,
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
    philosophy: philosophy(coach),
    summary: styleSummary(coach),
    effects: jobEffects(league, coach),
    career: careerView(league, coach.id),
  };
}
