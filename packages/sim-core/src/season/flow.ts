/**
 * Moving through the season, one step at a time:
 * offseason -> preseason -> Weeks 1-18 -> wild card -> divisional ->
 * conference -> championship -> season complete -> next league year.
 */
import { STARTERS } from "../generate/config";
import { addDays, POSITIONS, overallAt, Rng, RngStreams, streamSeed } from "@fgm/foundation";
import type {
  CalendarStage,
  Game,
  League,
  Player,
  PlayoffExit,
  PlayoffRound,
  SeasonHistory,
} from "../league/schema";
import {
  LONGEST_STATS,
  simulateGame,
  type BoxScore,
  type GameOutput,
  type StatKey,
} from "@fgm/game-engine";
import { teamLineup } from "./lineups";
import { rulesFor } from "../rules";
import { generateDraftPicks } from "../generate/players";
import { seasonDates } from "./calendar";
import { computeDraftOrder } from "./draftOrder";
import { loserOf, nextRoundMatchups, winnerOf } from "./playoffs";
import { assignWeeks, buildMatchups } from "./schedule";
import { computeStandings, type Standings } from "./seeding";

/** Coin tosses hash this, so they're fixed for a league and season. */
export function coinSalt(league: League): string {
  return `${league.meta.seed}:${league.season}`;
}

export function currentStandings(league: League): Standings {
  return computeStandings(league.rules, league.teams, league.games, coinSalt(league));
}

/**
 * Average TRUE overall of each team's starters. Simulation uses the truth;
 * screens use perception.
 */
export function starterStrengths(league: League): Map<string, number> {
  const byTeamAndPosition = new Map<string, number[]>();
  for (const p of league.players) {
    if (p.teamId === null) continue;
    const key = `${p.teamId}:${p.position}`;
    const list = byTeamAndPosition.get(key) ?? [];
    list.push(overallAt(p.ratings, p.position));
    byTeamAndPosition.set(key, list);
  }
  const strengths = new Map<string, number>();
  for (const team of league.teams) {
    let sum = 0;
    let count = 0;
    for (const position of POSITIONS) {
      const best = (byTeamAndPosition.get(`${team.id}:${position}`) ?? [])
        .sort((a, b) => b - a)
        .slice(0, STARTERS[position]);
      sum += best.reduce((a, b) => a + b, 0);
      count += best.length;
    }
    strengths.set(team.id, count === 0 ? 0 : sum / count);
  }
  return strengths;
}

function withRng<T>(league: League, use: (streams: RngStreams) => T): T {
  const streams = new RngStreams(league.meta.seed);
  streams.setState(league.rng);
  const result = use(streams);
  league.rng = { ...league.rng, ...streams.getState() };
  return result;
}

/** Builds this season's regular-season games from last season's division finishes. */
export function scheduleSeason(league: League, finish: Map<string, number>): void {
  const dates = seasonDates(league.rules, league.season);
  const matchups = buildMatchups(league.rules, league.season, finish);
  const scheduled = withRng(league, (s) =>
    assignWeeks(league.rules, matchups, league.teams, s.get("schedule")),
  );
  scheduled.sort((a, b) => a.week - b.week || a.homeId.localeCompare(b.homeId));
  league.games = scheduled.map((g, id) => ({
    id,
    season: league.season,
    round: "regular",
    week: g.week,
    date: dates.weekSundays[g.week - 1] as string,
    homeId: g.homeId,
    awayId: g.awayId,
    neutral: false,
    result: null,
    boxScore: null,
  }));
}

/** Lets callers watch games as they're played (e.g. to keep the play-by-play). */
export interface SimHooks {
  onStep?: (label: string) => void;
  onGame?: (game: Game, output: GameOutput) => void;
}

/** Each game's own random seed: games don't depend on the order they're played in. */
export function gameSeed(league: League, game: Game): number {
  return streamSeed(league.meta.seed, `game:${league.season}:${game.id}`);
}

/** Adds a game's player stat lines to each player's season totals. */
function recordStats(
  league: League,
  game: Game,
  box: BoxScore,
  players: Map<number, Player>,
): void {
  for (const entry of box.players) {
    const player = players.get(entry.id);
    if (!player) continue;
    const teamId = entry.side === "home" ? game.homeId : game.awayId;
    let season = player.stats.find((s) => s.season === league.season && s.teamId === teamId);
    if (!season) {
      season = { season: league.season, teamId, line: {} };
      player.stats.push(season);
    }
    for (const [key, value] of Object.entries(entry.line) as [StatKey, number][]) {
      const current = season.line[key];
      season.line[key] = LONGEST_STATS.includes(key)
        ? Math.max(current ?? value, value)
        : (current ?? 0) + value;
    }
  }
}

function playGames(league: League, games: Game[], hooks: SimHooks): void {
  const lineups = new Map(league.teams.map((t) => [t.id, teamLineup(league, t.id)]));
  const players = new Map(league.players.map((p) => [p.id, p]));
  for (const g of games) {
    const output = simulateGame(
      {
        home: { id: g.homeId, lineup: lineups.get(g.homeId)! },
        away: { id: g.awayId, lineup: lineups.get(g.awayId)! },
        neutral: g.neutral,
        playoff: g.round !== "regular",
        rules: league.rules.game,
      },
      new Rng(gameSeed(league, g)),
    );
    g.result = {
      homeScore: output.homeScore,
      awayScore: output.awayScore,
      homeTouchdowns: output.homeTouchdowns,
      awayTouchdowns: output.awayTouchdowns,
      overtime: output.overtime,
    };
    g.boxScore = output.box;
    // Season totals are regular-season stats, as in real record books; playoff box scores stay on the games.
    if (g.round === "regular") recordStats(league, g, output.box, players);
    hooks.onGame?.(g, output);
  }
}

function addPlayoffRound(league: League, round: PlayoffRound): void {
  const standings = currentStandings(league);
  const playoffGames = league.games.filter((g) => g.round !== "regular");
  const date = seasonDates(league.rules, league.season).playoffs[round];
  const week =
    league.rules.schedule.regularSeasonWeeks +
    1 +
    ["wildcard", "divisional", "conference", "championship"].indexOf(round);
  for (const m of nextRoundMatchups(league.rules, league.season, round, standings, playoffGames)) {
    league.games.push({
      id: league.games.length,
      season: league.season,
      week,
      date,
      result: null,
      boxScore: null,
      ...m,
    });
  }
}

const NEXT_ROUND: Record<PlayoffRound, PlayoffRound | null> = {
  wildcard: "divisional",
  divisional: "conference",
  conference: "championship",
  championship: null,
};

/** Takes one step forward. Returns a short description of what happened. */
export function advance(league: League, hooks: SimHooks = {}): string {
  const cal = league.calendar;
  const dates = seasonDates(league.rules, league.season);
  switch (cal.stage) {
    case "offseason":
      cal.stage = "preseason";
      league.date = dates.preseasonStart;
      return "Preseason begins";
    case "preseason":
      cal.stage = "regular";
      cal.week = 1;
      league.date = dates.kickoff;
      return "The regular season begins";
    case "regular": {
      const week = cal.week;
      playGames(
        league,
        league.games.filter((g) => g.round === "regular" && g.week === week),
        hooks,
      );
      league.date = dates.weekSundays[week - 1] as string;
      if (week >= league.rules.schedule.regularSeasonWeeks) {
        cal.stage = "wildcard";
        addPlayoffRound(league, "wildcard");
      } else cal.week = week + 1;
      return `Week ${week} played`;
    }
    case "wildcard":
    case "divisional":
    case "conference":
    case "championship": {
      const round = cal.stage;
      playGames(
        league,
        league.games.filter((g) => g.round === round),
        hooks,
      );
      league.date = dates.playoffs[round];
      const next = NEXT_ROUND[round];
      if (next) {
        cal.stage = next;
        addPlayoffRound(league, next);
      } else {
        cal.stage = "complete";
        completeSeason(league);
      }
      return `${round === "championship" ? "Championship" : round[0]!.toUpperCase() + round.slice(1) + " round"} played`;
    }
    case "complete":
      startNextSeason(league, { agePlayers: true });
      return `The ${league.season} league year begins`;
  }
}

/** Advances until `stop` says so (checked before each step). */
export function advanceUntil(
  league: League,
  stop: (league: League) => boolean,
  hooks: SimHooks = {},
): void {
  for (let guard = 0; guard < 100 && !stop(league); guard++) {
    const label = advance(league, hooks);
    hooks.onStep?.(label);
  }
}

/** Where each team's season ended. */
export function playoffExits(league: League): Map<string, PlayoffExit> {
  const exits = new Map<string, PlayoffExit>(league.teams.map((t) => [t.id, "missed"]));
  for (const g of league.games) {
    if (g.round === "regular" || !g.result) continue;
    const loser = loserOf(g) as string;
    if (g.round === "championship") {
      exits.set(loser, "runner-up");
      exits.set(winnerOf(g) as string, "champion");
    } else exits.set(loser, g.round);
  }
  return exits;
}

/** Wraps up a finished season: history entry and the next draft's order. */
function completeSeason(league: League): void {
  const standings = currentStandings(league);
  const exits = playoffExits(league);
  const order = computeDraftOrder(standings, exits);
  const final = league.games.find((g) => g.round === "championship") as Game;
  const entry: SeasonHistory = {
    season: league.season,
    championId: winnerOf(final) as string,
    runnerUpId: loserOf(final) as string,
    standings: league.teams.map((t) => {
      const r = standings.table.record(t.id);
      return {
        teamId: t.id,
        wins: r.wins,
        losses: r.losses,
        ties: r.ties,
        pointsFor: standings.table.pointsFor(t.id),
        pointsAgainst: standings.table.pointsAgainst(t.id),
        divisionRank: standings.divisionRank.get(t.id) as number,
        seed: standings.seed.get(t.id) ?? null,
        exit: exits.get(t.id) as PlayoffExit,
      };
    }),
    playoffGames: league.games
      .filter((g) => g.round !== "regular" && g.result)
      .map((g) => ({
        round: g.round as PlayoffRound,
        homeId: g.homeId,
        awayId: g.awayId,
        homeScore: g.result!.homeScore,
        awayScore: g.result!.awayScore,
        overtime: g.result!.overtime,
      })),
    draftOrder: order.firstRound,
    tiebreakNotes: standings.notes,
  };
  league.history.push(entry);

  // Number the next draft's picks.
  const draftSeason = league.season + 1;
  const teamCount = league.teams.length;
  for (let round = 1; round <= league.rules.draft.rounds; round++) {
    order.round(round).forEach((teamId, i) => {
      const pick = league.draftPicks.find(
        (p) => p.season === draftSeason && p.round === round && p.originalTeamId === teamId,
      );
      if (pick) pick.overall = (round - 1) * teamCount + i + 1;
    });
  }
}

/** The new league year: next season's schedule, picks, and (optionally) a year of experience. */
export function startNextSeason(league: League, options: { agePlayers: boolean }): void {
  const last = league.history.at(-1);
  if (!last || last.season !== league.season)
    throw new Error("finish the season before starting the next one");
  const championship = seasonDates(league.rules, league.season).playoffs.championship;
  league.season += 1;
  league.rules = rulesFor(league.season);
  league.date = addDays(championship, 1);
  league.calendar = { stage: "offseason", week: 1 };
  if (options.agePlayers) for (const p of league.players) if (p.teamId !== null) p.experience += 1;

  // Picks: the drafts before this one are gone (no draft until Phase 11); add the newest future year.
  league.draftPicks = league.draftPicks.filter((p) => p.season >= league.season);
  const teamIds = league.teams.map((t) => t.id);
  const lastHeld = league.season + league.rules.draft.seasonsOfPicksHeld - 1;
  for (let s = league.season; s <= lastHeld; s++) {
    if (league.draftPicks.some((p) => p.season === s)) continue;
    const picks = generateDraftPicks(
      s,
      1,
      league.rules.draft.rounds,
      teamIds,
      league.nextIds.draftPick,
    );
    league.nextIds.draftPick += picks.length;
    league.draftPicks.push(...picks);
  }

  scheduleSeason(league, new Map(last.standings.map((s) => [s.teamId, s.divisionRank])));
}

/** Stages that count as "the season is under way". */
export function isPlaying(stage: CalendarStage): boolean {
  return stage !== "offseason" && stage !== "preseason" && stage !== "complete";
}
