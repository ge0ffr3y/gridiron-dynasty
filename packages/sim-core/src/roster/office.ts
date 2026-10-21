/**
 * Roster management for the screens (Phase 8b). Until GM Mode the league
 * office can make these moves for any team: waive, injured reserve, activate,
 * promote or elevate a practice-squad player, and sign free agents to the 53
 * or the practice squad. Each move shows whether it's allowed now (and why
 * not), what it does to the cap, and is recorded with its reason.
 */
import { ageOn, overallAt, type Position } from "@fgm/foundation";
import { capHit } from "../contracts/contract";
import { batch, previewRelease } from "../contracts/operations";
import { capSheet } from "../contracts/team";
import { scratch } from "../contracts/views";
import type { League, Player, RosterList } from "../league/schema";
import { perceivePlayer, type Viewer } from "../perception";
import { assignJerseys } from "./jerseys";
import { rosterProblems } from "./legality";
import {
  inSeasonRosters,
  isPracticeSquadVeteran,
  onTeam,
  openSpots,
  practiceSquadOpening,
  rosterCount,
  rosterLimit,
} from "./lists";
import {
  activate,
  elevationsLeft,
  minimumDeal,
  placeOnReserve,
  practiceSquadDeal,
  promote,
  reserveReturnsLeft,
  signFreeAgent,
  subjectToWaivers,
  waivePlayer,
} from "./moves";

const OFFICE = "League office move (any team, until GM Mode in Phase 14).";

export type RosterMoveKind =
  "waive" | "injured-reserve" | "activate" | "promote" | "elevate" | "sign" | "sign-practice-squad";

export interface RosterMoveOption {
  kind: RosterMoveKind;
  label: string;
  available: boolean;
  /** Why not, or what it does (waivers, dead money, the limit it uses). */
  note: string;
  /** Change in this League Year's cap room (positive frees room). */
  roomChange: number;
}

export interface RosterManagementRow {
  id: number;
  name: string;
  position: Position;
  age: number;
  overall: number;
  list: RosterList | null;
  injury: { description: string; gamesRemaining: number } | null;
  capHit: number;
  elevated: boolean;
  moves: RosterMoveOption[];
}

export interface RosterManagementView {
  team: { id: string; name: string };
  date: string;
  inSeason: boolean;
  counts: {
    roster: number;
    limit: number;
    practiceSquad: number;
    practiceSquadMax: number;
    reserve: number;
  };
  room: number;
  reserveReturnsLeft: number;
  elevatedThisWeek: number;
  elevationsPerGame: number;
  active: RosterManagementRow[];
  practiceSquad: RosterManagementRow[];
  reserve: RosterManagementRow[];
  /** The best free agents (by the viewer's read), for signing. */
  freeAgents: RosterManagementRow[];
}

const name = (p: Player) => `${p.firstName} ${p.lastName}`;
const option = (
  kind: RosterMoveKind,
  label: string,
  available: boolean,
  note: string,
  roomChange = 0,
): RosterMoveOption => ({ kind, label, available, note, roomChange });

function movesFor(league: League, teamId: string, p: Player): RosterMoveOption[] {
  const r = league.rules.roster;
  const season = league.season;
  const cap = league.rules.cap;
  const moves: RosterMoveOption[] = [];
  const team = league.teams.find((t) => t.id === teamId)!;
  if (p.teamId === teamId && p.contract) {
    const release = previewRelease(league, p.id);
    moves.push(
      option(
        "waive",
        subjectToWaivers(league, p) ? "Waive" : "Release",
        true,
        subjectToWaivers(league, p)
          ? `Goes on waivers: teams can claim him in order (a claim takes his contract, minus bonus money). ${release.deadThisYear ? `Dead money if he clears: $${(release.deadThisYear / 1e6).toFixed(2)}M.` : ""}`
          : `A vested veteran: he becomes a free agent at once. ${release.deadThisYear ? `Dead money: $${(release.deadThisYear / 1e6).toFixed(2)}M.` : ""}`,
        release.savingsThisYear,
      ),
    );
  }
  if (p.teamId === teamId && p.roster === "active" && p.injury) {
    const enough = p.injury.gamesRemaining >= r.reserve.injuredMinGames;
    moves.push(
      option(
        "injured-reserve",
        "Injured reserve",
        enough,
        enough
          ? `Out ${p.injury.gamesRemaining} games: frees his roster spot; he must miss at least ${r.reserve.injuredMinGames}.`
          : `Out only ${p.injury.gamesRemaining} game${p.injury.gamesRemaining === 1 ? "" : "s"}; injured reserve needs ${r.reserve.injuredMinGames} or more.`,
      ),
    );
  }
  if (
    p.teamId === teamId &&
    (p.roster === "injured-reserve" || p.roster === "pup" || p.roster === "nfi")
  ) {
    const min = p.roster === "injured-reserve" ? r.reserve.injuredMinGames : r.reserve.pupMinGames;
    const missed = p.reserve?.gamesMissed ?? 0;
    const why = p.injury
      ? "Still injured."
      : inSeasonRosters(league) && missed < min
        ? `Has missed ${missed} of the ${min} games he must miss.`
        : openSpots(league, teamId) <= 0
          ? "No roster spot: waive someone first."
          : p.roster === "injured-reserve" &&
              inSeasonRosters(league) &&
              !p.reserve?.designatedToReturn &&
              reserveReturnsLeft(league, teamId) <= 0
            ? "No injured-reserve returns left this season."
            : "";
    moves.push(
      option(
        "activate",
        "Activate",
        why === "",
        why ||
          (p.roster === "injured-reserve" &&
          inSeasonRosters(league) &&
          !p.reserve?.designatedToReturn
            ? `Uses one of the season's injured-reserve returns (${reserveReturnsLeft(league, teamId)} left).`
            : "Back to the active roster."),
      ),
    );
  }
  if (p.teamId === teamId && p.roster === "practice-squad") {
    const deal = minimumDeal(league, p, teamId);
    const change = capHit(p.contract!, season, cap) - capHit(deal, season, cap);
    const room = capSheet(league, teamId, season).room;
    const why =
      openSpots(league, teamId) <= 0
        ? "No roster spot: waive someone first."
        : room + change < 0
          ? "Not enough cap room."
          : "";
    moves.push(
      option(
        "promote",
        "Promote to the 53",
        why === "",
        why || "Signs him to a minimum deal for the rest of the season.",
        change,
      ),
    );
    const elevatedAlready = team.elevated.includes(p.id);
    const left = elevationsLeft(league, p);
    const ewhy = !inSeasonRosters(league)
      ? "Only in the season."
      : elevatedAlready
        ? "Already elevated for this week's game."
        : team.elevated.length >= r.practiceSquad.elevationsPerGame
          ? `Already ${r.practiceSquad.elevationsPerGame} elevated this week.`
          : left <= 0
            ? `Elevated ${r.practiceSquad.elevationsPerPlayerPerSeason} times already: he'd have to be signed to the 53.`
            : p.injury
              ? "Injured."
              : "";
    moves.push(
      option(
        "elevate",
        "Elevate for this week",
        ewhy === "",
        ewhy ||
          `Plays this week's game, then returns to the practice squad (${left} of ${r.practiceSquad.elevationsPerPlayerPerSeason} elevations left).`,
      ),
    );
  }
  if (p.teamId === null) {
    const room = capSheet(league, teamId, season).room;
    const deal = minimumDeal(league, p, teamId);
    const why =
      openSpots(league, teamId) <= 0
        ? "No roster spot."
        : room < capHit(deal, season, cap)
          ? "Not enough cap room."
          : "";
    moves.push(
      option(
        "sign",
        "Sign to the roster",
        why === "",
        why || "A one-year minimum deal (only the weeks left, in the season).",
        -capHit(deal, season, cap),
      ),
    );
    if (inSeasonRosters(league)) {
      const ps = practiceSquadDeal(league, p, teamId);
      const pwhy = !practiceSquadOpening(league, teamId, p)
        ? isPracticeSquadVeteran(league, p)
          ? "No practice-squad spot for another veteran (six at most)."
          : "The practice squad is full."
        : room < capHit(ps, season, cap)
          ? "Not enough cap room."
          : "";
      moves.push(
        option(
          "sign-practice-squad",
          "Sign to the practice squad",
          pwhy === "",
          pwhy || "Weekly practice-squad pay for the rest of the season.",
          -capHit(ps, season, cap),
        ),
      );
    }
  }
  return moves;
}

function row(league: League, teamId: string, p: Player, viewer: Viewer): RosterManagementRow {
  const team = league.teams.find((t) => t.id === teamId)!;
  return {
    id: p.id,
    name: name(p),
    position: p.position,
    age: ageOn(p.birthDate, league.date),
    overall: perceivePlayer(league, p, viewer).overall,
    list: p.teamId ? p.roster : null,
    injury: p.injury
      ? { description: p.injury.description, gamesRemaining: p.injury.gamesRemaining }
      : null,
    capHit: p.contract && p.teamId ? capHit(p.contract, league.season, league.rules.cap) : 0,
    elevated: team.elevated.includes(p.id),
    moves: movesFor(league, teamId, p),
  };
}

const byPositionThenOverall = (a: RosterManagementRow, b: RosterManagementRow) =>
  a.position.localeCompare(b.position) || b.overall - a.overall || a.id - b.id;

export function rosterManagementView(
  league: League,
  teamId: string,
  viewer: Viewer,
  options: { freeAgentPosition?: Position } = {},
): RosterManagementView {
  const team = league.teams.find((t) => t.id === teamId);
  if (!team) throw new Error(`no team ${teamId}`);
  const mine = onTeam(league, teamId);
  const fa = league.players
    .filter((p) => p.teamId === null && p.retiredAfter === null)
    .filter((p) => !options.freeAgentPosition || p.position === options.freeAgentPosition)
    .map((p) => ({ p, o: overallAt(p.ratings, p.position) }))
    .sort((a, b) => b.o - a.o || a.p.id - b.p.id)
    .slice(0, 40)
    .map(({ p }) => row(league, teamId, p, viewer));
  return {
    team: { id: team.id, name: `${team.city} ${team.nickname}` },
    date: league.date,
    inSeason: inSeasonRosters(league),
    counts: {
      roster: rosterCount(league, teamId),
      limit: rosterLimit(league),
      practiceSquad: onTeam(league, teamId, "practice-squad").length,
      practiceSquadMax: league.rules.roster.practiceSquad.max,
      reserve: mine.filter((p) => p.roster !== "active" && p.roster !== "practice-squad").length,
    },
    room: capSheet(league, teamId, league.season).room,
    reserveReturnsLeft: reserveReturnsLeft(league, teamId),
    elevatedThisWeek: team.elevated.length,
    elevationsPerGame: league.rules.roster.practiceSquad.elevationsPerGame,
    active: mine
      .filter((p) => p.roster === "active")
      .map((p) => row(league, teamId, p, viewer))
      .sort(byPositionThenOverall),
    practiceSquad: mine
      .filter((p) => p.roster === "practice-squad")
      .map((p) => row(league, teamId, p, viewer))
      .sort(byPositionThenOverall),
    reserve: mine
      .filter((p) => p.roster !== "active" && p.roster !== "practice-squad")
      .map((p) => row(league, teamId, p, viewer))
      .sort(byPositionThenOverall),
    freeAgents: fa,
  };
}

/**
 * Makes a league-office roster move. Refused (with the reason) if it isn't allowed now or would
 * break a roster or cap rule. Returns what happened, in words.
 */
export function makeRosterMove(
  league: League,
  teamId: string,
  playerId: number,
  kind: RosterMoveKind,
): string {
  const p = league.players.find((x) => x.id === playerId);
  if (!p) throw new Error(`no player ${playerId}`);
  const offered = movesFor(league, teamId, p).find((m) => m.kind === kind);
  if (!offered) throw new Error("That move isn't possible for him.");
  if (!offered.available) throw new Error(offered.note);
  const run = (l: League) => {
    const team = l.teams.find((t) => t.id === teamId)!;
    const who = l.players.find((x) => x.id === playerId)!;
    if (kind === "waive") waivePlayer(l, playerId, OFFICE);
    else if (kind === "injured-reserve")
      placeOnReserve(
        l,
        playerId,
        "injured-reserve",
        `${OFFICE} Out ${who.injury!.gamesRemaining} games.`,
      );
    else if (kind === "activate") activate(l, playerId, OFFICE);
    else if (kind === "promote") promote(l, playerId, OFFICE);
    else if (kind === "elevate") {
      who.elevations += 1;
      team.elevated = [...team.elevated, playerId];
    } else if (kind === "sign") signFreeAgent(l, playerId, teamId, "active", OFFICE);
    else if (kind === "sign-practice-squad")
      signFreeAgent(l, playerId, teamId, "practice-squad", OFFICE);
    assignJerseys(l, [teamId]);
  };
  // Tried on a copy first: a move that would break a rule is refused and changes nothing.
  const trial = scratch(league);
  run(trial);
  const problems = rosterProblems(trial).filter((x) => x.startsWith(teamId));
  if (problems.length > 0) throw new Error(problems.join(" "));
  const before = league.transactions.length;
  batch(league, () => run(league));
  const done = league.transactions.slice(before).map((t) => t.text);
  return done.length > 0 ? done.join(" ") : `${name(p)} elevated for this week's game.`;
}
