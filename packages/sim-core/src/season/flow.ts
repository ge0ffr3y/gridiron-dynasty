/**
 * Moving through the League Year, one dated event at a time (Phase 8):
 * offseason -> new League Year (March: contracts expire, free agency) -> draft
 * -> training camp -> preseason weeks -> final cuts -> Weeks 1-18 -> wild card
 * -> divisional -> conference -> championship -> season complete -> next year.
 */
import {
  blackMonday,
  hiringRound,
  inSeasonFirings,
  offseasonStaffing,
  recordStaffSeason,
} from "../coaches/carousel";
import { staffInput } from "../coaches/style";
import { STARTERS } from "../generate/config";
import {
  addDays,
  daysBetween,
  POSITIONS,
  overallAt,
  Rng,
  RngStreams,
  streamSeed,
} from "@fgm/foundation";
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
import { gameDepthChart } from "./depthChart";
import {
  applyInjuries,
  freeAgentsHeal,
  offseasonHealing,
  practiceWeek,
  preseasonCampInjuries,
} from "./injuries";
import { conditionsFor, drawWeather } from "./weather";
import { closeLeagueYear, fillRoster, openLeagueYear } from "../contracts/upkeep";
import {
  campDevelopment,
  offseasonDevelopment,
  recordDevelopment,
  recordRatingHistory,
  weeklyDevelopment,
} from "../lifecycle/development";
import { batch } from "../contracts/operations";
import { finishDraft, startDraft } from "../draft/day";
import { awardCompensatoryPicks } from "../draft/compensatory";
import {
  closeFreeAgency,
  FREE_AGENCY,
  freeAgencyRound,
  lateFreeAgency,
  reSigningWindow,
  weeklyExtensions,
} from "../contracts/freeAgency";
import { ensureDraftClass, upcomingDraftYear } from "../scouting/classes";
import { assignScouts, offseasonScouting, pruneStudy, scoutingWeeks } from "../scouting/study";
import { SCOUTING } from "../scouting/config";
import { assignJerseys } from "../roster/jerseys";
import { gradePreseason, playPreseasonWeek, schedulePreseason } from "../roster/preseason";
import { updateMoods } from "../people/morale";
import { updatePlans } from "../front-office/evaluate";
import { archivePlayers } from "../lifecycle/archive";
import { executivesSeasonEnd } from "../front-office/owners";
import { expireOffers, TRADE_MARKET, tradeMarket } from "../front-office/tradeMarket";
import {
  campDisputes,
  endCampDisputes,
  leagueYearDisputes,
  preseasonDisputes,
  weeklyDisputes,
} from "../people/disputes";

/** At the offseason's turning points moods move most of the way to where they're headed. */
const MOOD_SETTLE = 0.6;
import {
  countReserveGames,
  cutdownDay,
  retirePlayers,
  seasonEnds,
  trainingCampOpens,
  weeklyRosterUpkeep,
} from "../roster/upkeep";
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
    weather: null,
  }));
}

/** Lets callers watch games as they're played (e.g. to keep the play-by-play). */
export interface SimHooks {
  onStep?: (label: string) => void;
  onGame?: (game: Game, output: GameOutput) => void;
  /** The placeholder season a new fictional league plays before it has contracts: no roster moves. */
  historyOnly?: boolean;
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
  // Depth charts are set before the week's games, so this week's injuries count from next week.
  const playing = new Set(games.flatMap((g) => [g.homeId, g.awayId]));
  // Practice-squad players elevated for the game (decided before the week).
  const depth = new Map(
    league.teams
      .filter((t) => playing.has(t.id))
      .map((t) => [t.id, gameDepthChart(league, t.id, t.elevated)]),
  );
  const players = new Map(league.players.map((p) => [p.id, p]));
  for (const g of games) {
    const weather = drawWeather(league, g);
    const output = simulateGame(
      {
        // Each team's staff calls its plays and manages its games (Phase 10).
        home: { id: g.homeId, depth: depth.get(g.homeId)!, ...staffInput(league, g.homeId) },
        away: { id: g.awayId, depth: depth.get(g.awayId)!, ...staffInput(league, g.awayId) },
        neutral: g.neutral,
        conditions: conditionsFor(league, g, weather),
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
    g.weather = weather;
    // Season totals are regular-season stats, as in real record books; playoff box scores stay on the games.
    if (g.round === "regular") recordStats(league, g, output.box, players);
    applyInjuries(league, g, output.injuries, players);
    if (!hooks.historyOnly) countReserveGames(league, [g.homeId, g.awayId]);
    // Elevated players go back to the practice squad after the game.
    for (const t of league.teams) if (t.id === g.homeId || t.id === g.awayId) t.elevated = [];
    hooks.onGame?.(g, output);
  }
}

/** True when a game is up next on the calendar (this week or this playoff round) and not played yet. */
export function canPlayNow(league: League, game: Game): boolean {
  if (game.result !== null || game.season !== league.season) return false;
  const cal = league.calendar;
  if (cal.stage === "regular") return game.round === "regular" && game.week === cal.week;
  return game.round === cal.stage;
}

/**
 * Plays one of this week's games right away ("Play and watch"). Every game has
 * its own seed and weather, and depth charts don't change within a week except
 * by the user, so the result is the same as simming it with the rest of the week.
 */
export function playGameNow(league: League, gameId: number, hooks: SimHooks = {}): Game {
  const game = league.games.find((g) => g.id === gameId);
  if (!game || !canPlayNow(league, game)) throw new Error("That game can't be played right now.");
  playGames(league, [game], hooks);
  return game;
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
      weather: null,
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

/** The upcoming draft has a class, and teams that haven't assigned their scouts to it do. */
export function ensureClassAndScouts(league: League): void {
  const year = upcomingDraftYear(league);
  if (league.prospects.some((p) => p.draftYear === year)) return;
  ensureDraftClass(league);
  assignScouts(league);
  // A class that appears late (a new league in February, an older save) gets the study its
  // scouts would have done since September.
  scoutingWeeks(
    league,
    Math.floor(Math.max(0, daysBetween(`${year - 1}-${SCOUTING.studyStarts}`, league.date)) / 7),
  );
}

/** One step's events (see `advance`). */
function advanceOnce(league: League, hooks: SimHooks): string {
  const cal = league.calendar;
  const dates = seasonDates(league.rules, league.season);
  // A save from before Phase 11 gets its draft class on its first step.
  if (!hooks.historyOnly) ensureClassAndScouts(league);
  switch (cal.stage) {
    case "offseason":
      // Scouting through the combine and the first pro days.
      if (!hooks.historyOnly) offseasonScouting(league, league.date, dates.leagueYear);
      // Players develop first, so contracts and free agency see who they are now.
      league.date = addDays(dates.negotiatingPeriod, -1);
      league.development = [];
      recordDevelopment(league, "league-year", offseasonDevelopment(league));
      // Each GM reads where his team stands before deciding whom to keep (Phase 13).
      if (!hooks.historyOnly) updatePlans(league);
      // The re-signing window: teams keep, tag or tender their expiring players (Phase 12).
      if (!hooks.historyOnly) batch(league, () => reSigningWindow(league));
      // The new League Year: last season's deals run out and free agency opens.
      league.date = dates.leagueYear;
      // Compensatory picks for this year's draft, from last year's free agency (Phase 11b).
      if (!hooks.historyOnly) awardCompensatoryPicks(league);
      batch(league, () => openLeagueYear(league));
      cal.stage = "free-agency";
      if (!hooks.historyOnly) {
        // Moods settle over the winter. Trading is open again: requests from players now happy
        // lapse, and teams answer the rest (Phase 12b).
        updateMoods(league, MOOD_SETTLE);
        batch(league, () => leagueYearDisputes(league));
      }
      return "The new League Year opens: free agency day 1";
    case "free-agency": {
      // Free agency: day by day for the first week, then a week at a time, until the draft.
      const lastDay = addDays(dates.draft, -1);
      const fa = league.freeAgency;
      if (fa && league.date < lastDay) {
        const days = fa.day < FREE_AGENCY.dailyDays ? 1 : 7;
        const next = addDays(league.date, days) < lastDay ? addDays(league.date, days) : lastDay;
        league.date = next;
        const signed = batch(league, () => freeAgencyRound(league, days));
        // The trade market from the League Year to the draft (Phase 13).
        if (!hooks.historyOnly) batch(league, () => tradeMarket(league, "spring", days));
        return days === 1
          ? `Free agency day ${fa.day}: ${signed} signing${signed === 1 ? "" : "s"}`
          : `A week of free agency: ${signed} signing${signed === 1 ? "" : "s"}`;
      }
      // Spring scouting: visits and the rest of the pro days.
      if (!hooks.historyOnly) offseasonScouting(league, dates.leagueYear, dates.draft);
      closeFreeAgency(league);
      // Rosters short of bodies fill with minimum deals before the draft.
      batch(league, () => {
        for (const team of league.teams) fillRoster(league, team.id);
      });
      league.date = dates.draft;
      startDraft(league);
      cal.stage = "draft";
      return "Draft day: the first pick is on the clock";
    }
    case "draft": {
      // The picks still to make, the undrafted rush, and the class closes.
      const { drafted, undrafted } = batch(league, () => finishDraft(league));
      cal.stage = "after-draft";
      // Next year's class appears, and every team assigns its scouts to it.
      ensureClassAndScouts(league);
      return `Draft: ${drafted} picks, ${undrafted} undrafted signings`;
    }
    case "after-draft":
      // Late free agency through the summer, then camp.
      batch(league, () => lateFreeAgency(league, dates.leagueYear, dates.trainingCamp));
      // The quiet summer trade market (Phase 13).
      if (!hooks.historyOnly)
        batch(league, () =>
          tradeMarket(league, "summer", daysBetween(dates.draft, dates.trainingCamp)),
        );
      league.date = dates.trainingCamp;
      batch(league, () => trainingCampOpens(league));
      if (!hooks.historyOnly) {
        // The roster after free agency and the draft: the GM reads it again (Phase 13).
        updatePlans(league);
        // Camp: unhappy, underpaid stars may hold out, hold in or ask out (Phase 12b).
        updateMoods(league, MOOD_SETTLE);
        batch(league, () => campDisputes(league));
      }
      if (league.settings.preseasonGames) schedulePreseason(league);
      else league.preseasonGames = [];
      cal.stage = "preseason";
      cal.week = 1;
      return "Training camp opens";
    case "preseason": {
      const weeks = dates.preseasonSaturdays.length;
      if (!league.settings.preseasonGames) {
        league.date = dates.preseasonSaturdays[weeks - 1]!;
        for (let w = 1; w <= weeks; w++) {
          preseasonCampInjuries(league, w, weeks);
          if (!hooks.historyOnly) batch(league, () => preseasonDisputes(league, w));
        }
        cal.stage = "cutdown";
        return "Training camp (no preseason games)";
      }
      const week = cal.week;
      league.date = dates.preseasonSaturdays[week - 1]!;
      batch(league, () => playPreseasonWeek(league, week, hooks));
      preseasonCampInjuries(league, week, weeks);
      if (!hooks.historyOnly) batch(league, () => preseasonDisputes(league, week));
      // Camp trades: depth for late picks, needs filled (Phase 13).
      if (!hooks.historyOnly) batch(league, () => tradeMarket(league, "camp", 7));
      if (week >= weeks) {
        batch(league, () => gradePreseason(league));
        cal.stage = "cutdown";
      } else cal.week = week + 1;
      return `Preseason week ${week} played`;
    }
    case "cutdown":
      // Camp's share of the year's development (a strong preseason helps), then final cuts.
      recordDevelopment(league, "camp", campDevelopment(league));
      // Holdouts and hold-ins still going end: nobody gives up his game checks (Phase 12b).
      if (!hooks.historyOnly) batch(league, () => endCampDisputes(league));
      // Cutdown week: teams move players they can't keep (Phase 13).
      if (!hooks.historyOnly)
        batch(league, () => tradeMarket(league, "camp", 7, TRADE_MARKET.cutdownBoost));
      cutdownDay(league);
      // Week 1's roster moves (injured reserve, elevations) are made now too.
      weeklyRosterUpkeep(league);
      return "Final cuts to 53; practice squads formed";
    case "regular": {
      const week = cal.week;
      playGames(
        league,
        // A game already played with "Play and watch" isn't played again.
        league.games.filter((g) => g.round === "regular" && g.week === week && g.result === null),
        hooks,
      );
      league.date = dates.weekSundays[week - 1] as string;
      // Small in-season changes and the week's practice injuries, after the whole week is played
      // (so every game this week saw the same players, whether simmed with the week or played early).
      if (!hooks.historyOnly) {
        recordDevelopment(league, "season", weeklyDevelopment(league, week));
        practiceWeek(
          league,
          week >= league.rules.schedule.regularSeasonWeeks ? "the playoffs" : `Week ${week + 1}`,
        );
        freeAgentsHeal(league);
        scoutingWeeks(league, 1);
        // The week before the trade deadline, every GM decides whether to buy or sell (Phase 13).
        if (week === league.rules.schedule.tradeDeadlineAfterWeek - 1) updatePlans(league);
        // Extensions for players in their deal's last year (Phase 12).
        batch(league, () => weeklyExtensions(league, week));
        // The in-season trade market, busiest the week of the deadline (Phase 13).
        const deadlineWeek = league.rules.schedule.tradeDeadlineAfterWeek;
        if (week <= deadlineWeek)
          batch(league, () =>
            tradeMarket(
              league,
              "season",
              7,
              week === deadlineWeek ? TRADE_MARKET.deadlineBoost : 1,
            ),
          );
        // Moods move with the week, and very unhappy players may ask out (Phase 12b).
        updateMoods(league);
        batch(league, () => weeklyDisputes(league, week));
        // Rarely, a head coach is fired during the season (Phase 10b).
        inSeasonFirings(league, week);
      }
      if (week >= league.rules.schedule.regularSeasonWeeks) {
        cal.stage = "wildcard";
        addPlayoffRound(league, "wildcard");
        // Black Monday: firings, interviews, and the first hires (Phase 10b).
        if (!hooks.historyOnly) blackMonday(league);
      } else cal.week = week + 1;
      // Next week's roster moves happen now, so every game next week sees the same rosters
      // whether it's simmed with the week or played early.
      if (!hooks.historyOnly) weeklyRosterUpkeep(league);
      return `Week ${week} played`;
    }
    case "wildcard":
    case "divisional":
    case "conference":
    case "championship": {
      const round = cal.stage;
      playGames(
        league,
        league.games.filter((g) => g.round === round && g.result === null),
        hooks,
      );
      league.date = dates.playoffs[round];
      const next = NEXT_ROUND[round];
      if (next) {
        cal.stage = next;
        addPlayoffRound(league, next);
        if (!hooks.historyOnly) {
          practiceWeek(league, `the ${next} round`);
          scoutingWeeks(league, 1);
          weeklyRosterUpkeep(league);
          // Coaches on teams just eliminated can now sign elsewhere.
          hiringRound(league, false);
        }
      } else {
        cal.stage = "complete";
        completeSeason(league);
      }
      return `${round === "championship" ? "Championship" : round[0]!.toUpperCase() + round.slice(1) + " round"} played`;
    }
    case "complete": {
      const ended = league.season;
      // The last coaching hires, coaches a year older, and coaching retirements (Phase 10b).
      if (!hooks.historyOnly) {
        offseasonStaffing(league);
        // GMs' career lines, reputations, contracts and retirements (Phase 13b).
        const last = league.history.at(-1);
        executivesSeasonEnd(
          league,
          new Set((last?.standings ?? []).filter((s) => s.seed !== null).map((s) => s.teamId)),
          last?.championId ?? null,
        );
      }
      seasonEnds(league);
      startNextSeason(league, { agePlayers: true });
      retirePlayers(league, ended);
      // Players long gone become short history cards (Phase 13), so the list stays lean.
      if (!hooks.historyOnly) archivePlayers(league, ended);
      return `The ${league.season} offseason begins`;
    }
  }
}

/**
 * Takes one step forward. Returns a short description of what happened. Afterwards, jersey
 * numbers are kept unique on every team (new arrivals take a free number).
 */
export function advance(league: League, hooks: SimHooks = {}): string {
  const label = advanceOnce(league, hooks);
  if (!hooks.historyOnly) {
    assignJerseys(league);
    // Trade offers to person-run teams that weren't answered in time lapse (Phase 13).
    expireOffers(league);
  }
  return label;
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
    if (g.round === "regular" || g.round === "preseason" || !g.result) continue;
    const loser = loserOf(g) as string;
    if (g.round === "championship") {
      exits.set(loser, "runner-up");
      exits.set(winnerOf(g) as string, "champion");
    } else exits.set(loser, g.round);
  }
  return exits;
}

/** Wraps up a finished season: history entry and the next draft's order. */
/** Closes a season whose games were all played elsewhere (the real league's 2025 season). */
export function completeSeasonFromResults(league: League): void {
  if (league.games.some((g) => !g.result)) throw new Error("every game needs a result");
  completeSeason(league);
}

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
  recordRatingHistory(league);
  recordStaffSeason(league);

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
  // Money: record the year that ended (top salaries, cash, carried-over room).
  closeLeagueYear(league);
  league.season += 1;
  league.rules = rulesFor(league.season);
  // The offseason heals most injuries; long ones carry into camp (Phase 9b).
  offseasonHealing(league);
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
  league.preseasonGames = [];
  // Study on last year's class is done (its rookies have NFL tape now).
  pruneStudy(league);
  // Contracts that ran out, fifth-year options and re-signings wait for the new League Year in March.
}

export { isPlaying } from "./calendar";
