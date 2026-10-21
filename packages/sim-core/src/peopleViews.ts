/**
 * Screens for Phase 4b: the depth chart (and editing it) and league
 * leaders. Ratings come through the perception layer like every screen.
 */
import { DEPTH_SLOTS, type DepthSlot, type StatKey, type StatLine } from "@fgm/game-engine";
import type { Position } from "@fgm/foundation";
import type { League, Player } from "./league/schema";
import { perceivePlayer, type Viewer } from "./perception";
import { campWinners, resolveDepthChart, SLOT_POSITION, teamRoster } from "./season/depthChart";
import { DEPTH_CHART } from "./season/config";
import { sumLines } from "./views";

export type { DepthSlot };

export const SLOT_NAMES: Record<DepthSlot, string> = {
  QB: "Quarterback",
  RB: "Running back",
  FB: "Fullback",
  WR: "Wide receiver",
  TE: "Tight end",
  LT: "Left tackle",
  LG: "Left guard",
  C: "Center",
  RG: "Right guard",
  RT: "Right tackle",
  EDGE: "Edge rusher",
  DT: "Defensive tackle",
  LB: "Linebacker",
  CB: "Cornerback",
  S: "Safety",
  K: "Kicker",
  P: "Punter",
  KR: "Kick returner",
  PR: "Punt returner",
};

export interface DepthEntry {
  id: number;
  name: string;
  position: Position;
  /** Perceived overall at this spot (lower when it isn't his usual position). */
  overall: number;
  /** Playing a spot that isn't his usual position. */
  outOfPosition: boolean;
  injury: { description: string; gamesRemaining: number } | null;
  /** Why he's here when it isn't obvious (e.g. he won a close battle in camp). */
  note: string | null;
}

export interface DepthChartView {
  teamId: string;
  auto: boolean;
  slots: {
    slot: DepthSlot;
    name: string;
    side: "offense" | "defense" | "special";
    /** How many start at this spot. */
    starters: number;
    players: DepthEntry[];
  }[];
}

const SIDE: Record<DepthSlot, "offense" | "defense" | "special"> = {
  QB: "offense",
  RB: "offense",
  FB: "offense",
  WR: "offense",
  TE: "offense",
  LT: "offense",
  LG: "offense",
  C: "offense",
  RG: "offense",
  RT: "offense",
  EDGE: "defense",
  DT: "defense",
  LB: "defense",
  CB: "defense",
  S: "defense",
  K: "special",
  P: "special",
  KR: "special",
  PR: "special",
};

function injuryOf(p: Player): DepthEntry["injury"] {
  return p.injury
    ? { description: p.injury.description, gamesRemaining: p.injury.gamesRemaining }
    : null;
}

export function depthChartView(league: League, teamId: string, viewer: Viewer): DepthChartView {
  const team = league.teams.find((t) => t.id === teamId);
  if (!team) throw new Error(`no team ${teamId}`);
  const roster = teamRoster(league, teamId);
  const byId = new Map(roster.map((p) => [p.id, p]));
  const chart = resolveDepthChart(team, roster, league.season);
  // Close position battles settled in camp (automatic charts only).
  const camp = team.depthChart.auto ? campWinners(roster, league.season) : new Map();
  return {
    teamId,
    auto: team.depthChart.auto,
    slots: DEPTH_SLOTS.map((slot) => ({
      slot,
      name: SLOT_NAMES[slot],
      side: SIDE[slot],
      starters: Math.max(1, DEPTH_CHART.starters[slot]),
      players: chart[slot].map((id) => {
        const p = byId.get(id)!;
        const seen = perceivePlayer(league, p, viewer);
        const atSlot =
          slot === "KR" || slot === "PR"
            ? seen.overall
            : (seen.positionOveralls.find((o) => o.position === SLOT_POSITION[slot])?.overall ??
              seen.overall);
        return {
          id: p.id,
          name: `${p.firstName} ${p.lastName}`,
          position: p.position,
          overall: atSlot,
          outOfPosition: slot !== "KR" && slot !== "PR" && p.position !== SLOT_POSITION[slot],
          injury: injuryOf(p),
          note: camp.get(slot)?.has(p.id)
            ? `Won the job in camp (preseason grade ${p.preseason?.grade})`
            : null,
        };
      }),
    })),
  };
}

/**
 * Moves a player up or down at one spot. The first edit turns the chart from
 * automatic into a custom one (every spot keeps its current order).
 */
export function moveOnDepthChart(
  league: League,
  teamId: string,
  slot: DepthSlot,
  playerId: number,
  toIndex: number,
): void {
  const team = league.teams.find((t) => t.id === teamId);
  if (!team) throw new Error(`no team ${teamId}`);
  const chart = resolveDepthChart(team, teamRoster(league, teamId), league.season);
  const order = chart[slot].filter((id) => id !== playerId);
  if (order.length === chart[slot].length) throw new Error("that player isn't listed at this spot");
  order.splice(Math.max(0, Math.min(order.length, toIndex)), 0, playerId);
  chart[slot] = order;
  team.depthChart = { auto: false, slots: chart };
}

/** Back to the automatic chart. */
export function resetDepthChart(league: League, teamId: string): void {
  const team = league.teams.find((t) => t.id === teamId);
  if (!team) throw new Error(`no team ${teamId}`);
  team.depthChart = { auto: true, slots: {} };
}

// --- League leaders -------------------------------------------------------------

export interface LeaderCategory {
  key: string;
  label: string;
  /** e.g. "Minimum 14 attempts per team game". */
  qualifier?: string;
  leaders: {
    playerId: number;
    name: string;
    position: Position;
    team: string;
    value: string;
  }[];
}

export interface LeadersView {
  season: number;
  seasons: number[];
  categories: LeaderCategory[];
}

const n = (line: StatLine, key: StatKey) => line[key] ?? 0;

function passerRating(line: StatLine): number {
  const att = n(line, "passAtt");
  const clamp = (v: number) => Math.min(2.375, Math.max(0, v));
  const a = clamp((n(line, "passCmp") / att - 0.3) * 5);
  const b = clamp((n(line, "passYds") / att - 3) * 0.25);
  const c = clamp((n(line, "passTd") / att) * 20);
  const d = clamp(2.375 - (n(line, "passInt") / att) * 25);
  return ((a + b + c + d) / 6) * 100;
}

const LEADER_COUNT = 10;
/** Per team game: rate stats need this many attempts (the NFL's passing qualifier). */
const PASS_ATTEMPTS_PER_GAME = 14;
const RUSHES_PER_GAME = 6.25;

/** The season's leaders in each category (regular season). */
export function leadersView(league: League, season?: number): LeadersView {
  const seasons = [...new Set(league.players.flatMap((p) => p.stats.map((s) => s.season)))].sort(
    (a, b) => b - a,
  );
  const year = season ?? seasons[0] ?? league.season;
  const abbr = new Map(league.teams.map((t) => [t.id, t.abbreviation]));
  // A player's season across teams, credited to the last team he played for.
  const rows = league.players.flatMap((p) => {
    const parts = p.stats.filter((s) => s.season === year);
    if (parts.length === 0) return [];
    return [{ player: p, line: sumLines(parts.map((s) => s.line)), team: parts.at(-1)!.teamId }];
  });
  // Team games played this season (for the rate-stat qualifiers).
  const teamGames = new Map<string, number>();
  if (year === league.season) {
    for (const g of league.games) {
      if (g.round !== "regular" || !g.result) continue;
      for (const t of [g.homeId, g.awayId]) teamGames.set(t, (teamGames.get(t) ?? 0) + 1);
    }
  }
  const gamesFor = (team: string) =>
    year === league.season
      ? (teamGames.get(team) ?? 0)
      : // Past seasons' games aren't kept; every team plays every week but its one bye.
        league.rules.schedule.regularSeasonWeeks - 1;

  const category = (
    key: string,
    label: string,
    score: (line: StatLine) => number,
    format: (v: number) => string,
    qualifies: (line: StatLine, team: string) => boolean = () => true,
    qualifier?: string,
  ): LeaderCategory => ({
    key,
    label,
    ...(qualifier ? { qualifier } : {}),
    leaders: rows
      .filter((r) => qualifies(r.line, r.team) && score(r.line) !== 0)
      .map((r) => ({ r, v: score(r.line) }))
      .sort((a, b) => b.v - a.v || a.r.player.id - b.r.player.id)
      .slice(0, LEADER_COUNT)
      .map(({ r, v }) => ({
        playerId: r.player.id,
        name: `${r.player.firstName} ${r.player.lastName}`,
        position: r.player.position,
        team: abbr.get(r.team) ?? r.team,
        value: format(v),
      })),
  });
  const whole = (v: number) => String(Math.round(v));
  const passQualified = (line: StatLine, team: string) =>
    n(line, "passAtt") >= PASS_ATTEMPTS_PER_GAME * gamesFor(team);
  const rushQualified = (line: StatLine, team: string) =>
    n(line, "rushAtt") >= RUSHES_PER_GAME * gamesFor(team);
  const passQualifier = `At least ${PASS_ATTEMPTS_PER_GAME} attempts per team game`;
  return {
    season: year,
    seasons,
    categories: [
      category("passYds", "Passing yards", (l) => n(l, "passYds"), whole),
      category("passTd", "Passing touchdowns", (l) => n(l, "passTd"), whole),
      category(
        "rating",
        "Passer rating",
        passerRating,
        (v) => v.toFixed(1),
        passQualified,
        passQualifier,
      ),
      category(
        "passEpa",
        "EPA per dropback",
        (l) => n(l, "passEpa") / Math.max(1, n(l, "dropbacks")),
        (v) => v.toFixed(2),
        passQualified,
        passQualifier,
      ),
      category("rushYds", "Rushing yards", (l) => n(l, "rushYds"), whole),
      category("rushTd", "Rushing touchdowns", (l) => n(l, "rushTd"), whole),
      category(
        "ypc",
        "Yards per carry",
        (l) => n(l, "rushYds") / Math.max(1, n(l, "rushAtt")),
        (v) => v.toFixed(1),
        rushQualified,
        `At least ${RUSHES_PER_GAME} carries per team game`,
      ),
      category("recYds", "Receiving yards", (l) => n(l, "recYds"), whole),
      category("rec", "Receptions", (l) => n(l, "rec"), whole),
      category("recTd", "Receiving touchdowns", (l) => n(l, "recTd"), whole),
      category("tackles", "Tackles", (l) => n(l, "tackles"), whole),
      category("sacks", "Sacks", (l) => n(l, "sacks"), whole),
      category("pressures", "Pressures", (l) => n(l, "pressures"), whole),
      category("defInt", "Interceptions", (l) => n(l, "defInt"), whole),
      category("passDef", "Passes defensed", (l) => n(l, "passDef"), whole),
      category("fgm", "Field goals", (l) => n(l, "fgm"), whole),
    ],
  };
}
