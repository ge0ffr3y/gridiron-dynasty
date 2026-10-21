/**
 * Creates a complete fictional league from a seed: 32 teams, 90-man rosters,
 * coaching staffs, and draft picks. Same seed -> byte-identical league.
 */
import {
  LEAGUE_FORMAT,
  LEAGUE_FORMAT_VERSION,
  type Coach,
  type League,
  type Player,
  type Team,
} from "../league/schema";
import { POSITIONS } from "@fgm/foundation";
import { RngStreams } from "@fgm/foundation";
import { RULES_BY_SEASON, rulesFor, teamIdsInOrder, type Rules } from "../rules";
import { advanceUntil, scheduleSeason, startNextSeason } from "../season/flow";
import { generateCoach } from "./coaches";
import { ROSTER_MIX, STAFF, TEAM_STRENGTH_SPREAD } from "./config";
import { COLLEGES } from "./names";
import { NamePicker } from "./people";
import { generateDraftPicks, generatePlayer, tierFor } from "./players";
import { PLACEHOLDER_TEAMS } from "./teams";

export interface NewLeagueOptions {
  seed: number;
  name: string;
  season?: number;
}

export function createLeague(options: NewLeagueOptions): League {
  const season = options.season ?? 2026;
  const rules: Rules | undefined = RULES_BY_SEASON[season];
  if (!rules) throw new Error(`no rules file for the ${season} season`);

  const streams = new RngStreams(options.seed);
  const rng = streams.get("league");
  const names = new NamePicker(streams.get("names"));
  const date = rules.startDate;
  const teamIds = teamIdsInOrder(rules);

  const teams: Team[] = [];
  for (const conference of rules.structure.conferences) {
    for (const division of conference.divisions) {
      for (const id of division.teams) {
        const identity = PLACEHOLDER_TEAMS[id];
        if (!identity) throw new Error(`no placeholder identity for team ${id}`);
        teams.push({
          id,
          city: identity.city,
          nickname: identity.nickname,
          abbreviation: id,
          conferenceId: conference.id,
          divisionId: division.id,
          colors: { primary: identity.colors[0], secondary: identity.colors[1] },
          controller: "ai",
          depthChart: { auto: true, slots: {} },
        });
      }
    }
  }

  const ctx = {
    rng,
    names,
    date,
    season,
    teamIds,
    draftRounds: rules.draft.rounds,
    colleges: COLLEGES,
  };
  const players: Player[] = [];
  const coaches: Coach[] = [];
  for (const team of teams) {
    const teamStrength = rng.gaussian(0, TEAM_STRENGTH_SPREAD);
    const jerseys = new Set<number>();
    for (const position of POSITIONS) {
      const count = ROSTER_MIX[position];
      for (let slot = 0; slot < count; slot++) {
        players.push(
          generatePlayer(
            ctx,
            players.length,
            team.id,
            position,
            tierFor(position, slot, count),
            teamStrength,
            jerseys,
          ),
        );
      }
    }
    for (const { role, count, age } of STAFF) {
      for (let i = 0; i < count; i++)
        coaches.push(generateCoach(rng, names, date, coaches.length, team.id, role, age));
    }
  }

  const draftPicks = generateDraftPicks(
    season,
    rules.draft.seasonsOfPicksHeld,
    rules.draft.rounds,
    teamIds,
    0,
  );

  const league: League = {
    format: LEAGUE_FORMAT,
    formatVersion: LEAGUE_FORMAT_VERSION,
    meta: { name: options.name, seed: options.seed, kind: "fictional" },
    rules: rulesFor(season - 1),
    date,
    season: season - 1,
    calendar: { stage: "regular", week: 1 },
    teams,
    players,
    coaches,
    draftPicks,
    games: [],
    history: [],
    transactions: [
      {
        id: 0,
        date,
        type: "league-created",
        teamIds: [],
        playerIds: [],
        text: `${options.name} was founded with ${teams.length} teams.`,
        reason: `A new fictional league was generated from seed ${options.seed}.`,
      },
    ],
    pendingDecisions: [],
    rng: {},
    nextIds: {
      player: players.length,
      coach: coaches.length,
      draftPick: draftPicks.length,
      transaction: 1,
      decision: 0,
    },
  };

  // A fictional league has a past: play a placeholder version of the season
  // before the first one, so schedules, same-place games, the draft order and
  // History all have real results to come from. Finishes for the season
  // before that are drawn at random.
  const scheduleRng = streams.get("schedule");
  const finish = new Map<string, number>();
  for (const conference of rules.structure.conferences) {
    for (const division of conference.divisions) {
      scheduleRng.shuffle([...division.teams]).forEach((t, i) => finish.set(t, i + 1));
    }
  }
  league.rng = streams.getState();
  scheduleSeason(league, finish);
  advanceUntil(league, (l) => l.calendar.stage === "complete");
  startNextSeason(league, { agePlayers: false });
  return league;
}
