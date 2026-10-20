/**
 * The game page: score by period, team stats, player stat tables, and the
 * play-by-play as readable text ("2nd & 7 at SEA 34: J. Hammond pass short
 * right to D. Marsh for 12 yards").
 */
import type { BoxScore, Play, Side, StatLine } from "@fgm/game-engine";
import type { Game, League } from "../league/schema";
import { type TeamTag } from "./views";

export interface PlayLine {
  quarter: number;
  clock: string;
  /** "2nd & 7 at SEA 34" (empty for kicks and stoppages). */
  situation: string;
  text: string;
  /** Why a notable call was made. */
  note?: string;
  offense: Side;
  scoring: boolean;
  score: [number, number];
}

export interface PlayerRow {
  id: number;
  name: string;
  line: StatLine;
}

export interface GameView {
  id: number;
  season: number;
  round: Game["round"];
  week: number;
  date: string;
  neutral: boolean;
  home: TeamTag;
  away: TeamTag;
  homeScore: number | null;
  awayScore: number | null;
  overtime: boolean;
  /** Points per period, with labels ("1", "2", "3", "4", "OT"). */
  periods: { labels: string[]; home: number[]; away: number[] } | null;
  teamStats: { label: string; home: string; away: string }[];
  players: Record<Side, PlayerRow[]>;
  /** Null when the play-by-play wasn't kept (older or imported games). */
  plays: PlayLine[] | null;
}

function tag(league: League, id: string): TeamTag {
  const t = league.teams.find((x) => x.id === id)!;
  return {
    id: t.id,
    city: t.city,
    nickname: t.nickname,
    abbreviation: t.abbreviation,
    colors: t.colors,
  };
}

const ordinal = (n: number) => (n === 1 ? "1st" : n === 2 ? "2nd" : n === 3 ? "3rd" : `${n}th`);

function clockText(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function yards(n: number): string {
  if (n === 0) return "for no gain";
  if (n < 0) return `for a loss of ${-n} yard${n === -1 ? "" : "s"}`;
  return `for ${n} yard${n === 1 ? "" : "s"}`;
}

/** "SEA 34", "midfield": where the ball is, named by the side of the field. */
function spot(ytg: number, offense: string, defense: string): string {
  if (ytg === 50) return "midfield";
  return ytg > 50 ? `${offense} ${100 - ytg}` : `${defense} ${ytg}`;
}

/** Turns one play into a sentence. */
export function describePlay(
  p: Play,
  name: (id: number | undefined) => string,
  abbr: Record<Side, string>,
): string {
  const off = abbr[p.offense];
  const def = abbr[p.offense === "home" ? "away" : "home"];
  const td = p.touchdown ? ", TOUCHDOWN" : "";
  const dirText =
    p.direction === "middle" ? "up the middle" : p.direction ? `to the ${p.direction}` : "";
  const tackle = p.tacklers?.length ? ` (${name(p.tacklers[0])})` : "";
  const oob = p.outOfBounds ? ", out of bounds" : "";
  const fumble = p.fumble
    ? p.fumble.lost
      ? `. ${name(p.fumble.by)} FUMBLES, recovered by ${def} ${name(p.fumble.recoveredBy)}`
      : `. ${name(p.fumble.by)} fumbles but ${off} recovers`
    : "";
  switch (p.kind) {
    case "run":
      return `${name(p.rusher)} runs ${dirText} ${yards(p.yards)}${td}${oob}${p.touchdown ? "" : tackle}${fumble}`.replace(
        "  ",
        " ",
      );
    case "scramble":
      return `${name(p.rusher)} scrambles ${yards(p.yards)}${td}${oob}${p.touchdown ? "" : tackle}`;
    case "kneel":
      return `${name(p.rusher)} kneels down`;
    case "spike":
      return `${name(p.passer)} spikes the ball to stop the clock`;
    case "sack":
      return `${name(p.passer)} sacked by ${name(p.defender)} ${yards(p.yards)}${fumble}${p.safety ? ", SAFETY" : ""}`;
    case "pass": {
      const where = `${p.depth ?? ""} ${p.direction ?? ""}`.trim();
      if (p.intercepted) {
        return `${name(p.passer)} pass ${where} intended for ${name(p.receiver)} INTERCEPTED by ${name(p.defender)}${p.touchdown ? `, returned ${p.returnYards} yards for a TOUCHDOWN` : `, returned ${p.returnYards ?? 0} yards`}`;
      }
      if (!p.complete)
        return `${name(p.passer)} pass incomplete ${where} intended for ${name(p.receiver)}`;
      return `${name(p.passer)} pass ${where} to ${name(p.receiver)} ${yards(p.yards)}${td}${oob}${p.touchdown ? "" : tackle}${fumble}`;
    }
    case "punt": {
      const result = p.touchback
        ? "touchback"
        : p.fairCatch
          ? `fair catch by ${name(p.returner)}`
          : p.outOfBounds
            ? "out of bounds"
            : p.touchdown
              ? `returned ${p.returnYards} yards by ${name(p.returner)} for a TOUCHDOWN`
              : p.returner !== undefined
                ? `returned ${p.returnYards ?? 0} yards by ${name(p.returner)}`
                : "BLOCKED";
      return p.kickDistance === 0
        ? `${name(p.kicker)} punt is BLOCKED`
        : `${name(p.kicker)} punts ${p.kickDistance} yards, ${result}`;
    }
    case "fieldGoal":
      return `${name(p.kicker)} ${p.kickDistance}-yard field goal is ${p.good ? "GOOD" : "NO GOOD"}`;
    case "extraPoint":
      return `${name(p.kicker)} extra point is ${p.good ? "good" : "NO GOOD"}`;
    case "twoPoint":
      return p.passer !== undefined
        ? `Two-point try: ${name(p.passer)} pass to ${name(p.receiver)} ${p.good ? "SUCCEEDS" : "fails"}`
        : `Two-point try: ${name(p.rusher)} run ${p.good ? "SUCCEEDS" : "fails"}`;
    case "kickoff": {
      if (p.touchback) return `${name(p.kicker)} kicks off, touchback`;
      if (p.outOfBounds) return `${name(p.kicker)} kicks off out of bounds`;
      return `${name(p.kicker)} kicks off, returned ${p.returnYards ?? 0} yards by ${name(p.returner)}${p.touchdown ? " for a TOUCHDOWN" : ""}`;
    }
    case "timeout":
      return `Timeout, ${abbr[p.team ?? "home"]}`;
    case "twoMinuteWarning":
      return "Two-minute warning";
    case "endOfPeriod":
      return p.quarter >= 5 ? "End of overtime period" : `End of the ${ordinal(p.quarter)} quarter`;
  }
}

function situation(p: Play, abbr: Record<Side, string>): string {
  const scrimmage = [
    "run",
    "pass",
    "sack",
    "scramble",
    "kneel",
    "spike",
    "punt",
    "fieldGoal",
  ].includes(p.kind);
  if (!scrimmage) return "";
  const off = abbr[p.offense];
  const def = abbr[p.offense === "home" ? "away" : "home"];
  const distance = p.toGo === p.yardsToGoal && p.yardsToGoal <= 10 ? "goal" : String(p.toGo);
  return `${ordinal(p.down)} & ${distance} at ${spot(p.yardsToGoal, off, def)}`;
}

function teamStatRows(box: BoxScore): GameView["teamStats"] {
  const t = { home: box.home, away: box.away };
  const row = (label: string, f: (s: BoxScore["home"]) => string) => ({
    label,
    home: f(t.home),
    away: f(t.away),
  });
  const top = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  return [
    row("First downs", (s) => String(s.firstDowns)),
    row("Total yards", (s) => String(s.totalYards)),
    row("Passing yards", (s) => String(s.passYards)),
    row("Completions / attempts", (s) => `${s.passCmp}/${s.passAtt}`),
    row("Sacked (yards)", (s) => `${s.sacked} (${s.sackedYds})`),
    row("Rushing yards", (s) => String(s.rushYards)),
    row("Rushes", (s) => String(s.rushAtt)),
    row("Plays", (s) => String(s.plays)),
    row("Yards per play", (s) => (s.plays ? (s.totalYards / s.plays).toFixed(1) : "0.0")),
    row("Turnovers", (s) => String(s.turnovers)),
    row("Third downs", (s) => `${s.thirdDownConv}/${s.thirdDownAtt}`),
    row("Fourth downs", (s) => `${s.fourthDownConv}/${s.fourthDownAtt}`),
    row("Punts", (s) => String(s.punts)),
    row("Time of possession", (s) => top(s.possessionSeconds)),
  ];
}

export function gameView(league: League, gameId: number, plays: Play[] | null): GameView {
  const g = league.games.find((x) => x.id === gameId);
  if (!g) throw new Error(`no game ${gameId} this season`);
  const players = new Map(league.players.map((p) => [p.id, p]));
  const name = (id: number | undefined) => {
    const p = id === undefined ? undefined : players.get(id);
    return p ? `${p.firstName[0]}. ${p.lastName}` : "someone";
  };
  const abbr: Record<Side, string> = { home: g.homeId, away: g.awayId };
  const box = g.boxScore;
  const periods = box
    ? {
        labels: box.periods.home.map((_, i) =>
          i < 4 ? String(i + 1) : box.periods.home.length > 5 ? `OT${i - 3}` : "OT",
        ),
        home: box.periods.home,
        away: box.periods.away,
      }
    : null;
  const playerRows = (side: Side): PlayerRow[] =>
    (box?.players ?? [])
      .filter((p) => p.side === side && Object.keys(p.line).some((k) => k !== "gp"))
      .map((p) => ({ id: p.id, name: name(p.id), line: p.line }));
  return {
    id: g.id,
    season: g.season,
    round: g.round,
    week: g.week,
    date: g.date,
    neutral: g.neutral,
    home: tag(league, g.homeId),
    away: tag(league, g.awayId),
    homeScore: g.result?.homeScore ?? null,
    awayScore: g.result?.awayScore ?? null,
    overtime: g.result?.overtime ?? false,
    periods,
    teamStats: box ? teamStatRows(box) : [],
    players: { home: playerRows("home"), away: playerRows("away") },
    plays: plays
      ? plays.map((p, i) => {
          const before = i > 0 ? plays[i - 1]!.score : [0, 0];
          return {
            quarter: p.quarter,
            clock: clockText(p.clock),
            situation: situation(p, abbr),
            text: describePlay(p, name, abbr),
            ...(p.note ? { note: p.note } : {}),
            offense: p.offense,
            scoring: p.score[0] !== before[0] || p.score[1] !== before[1],
            score: p.score,
          };
        })
      : null,
  };
}
