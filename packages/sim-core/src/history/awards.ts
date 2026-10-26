/**
 * Season awards (Phase 15), voted after the regular season the way media voters do: production
 * against the others at a player's position (EPA for quarterbacks, yards and touchdowns for
 * runners and receivers, sacks, takeaways and stops on defense), the team's record, and the
 * voters' habits by position (quarterbacks win most MVPs; edge rushers most DPOYs), fitted to the
 * real winners since 1999 (`calibration/awards.json`). All-Pro teams and the All-Star Game add the
 * league's read of each player (his reputation), which is all voters have for linemen.
 *
 * Every award line keeps a reason; vote shares come from the scores (no random draws).
 */
import { dmath, type Position } from "@fgm/foundation";
import type { StatLine } from "@fgm/game-engine";
import awardsData from "../../../../calibration/awards.json";
import type { AwardKind, League, Player } from "../league/schema";
import { expectedWinShare, recordOf, winShare } from "../coaches/carousel";
import { readOverall } from "../perception";
import { addNews, teamName } from "./news";

type Slots = Partial<Record<Position, number>>;

/** Tuning (judgment, checked by `npm run sim -- --history N` against the real winners' mix). */
export const AWARDS = {
  /** Votes cast for the big awards (like the AP's 50 voters). */
  voters: 50,
  /** How spread out the votes are (lower: the leader takes more). */
  voteSpread: 0.35,
  /** A regular: this many snaps (on his side of the ball) in the season. */
  minSnaps: 350,
  /** Weight of the team's record (win share above .500, x2) per award. */
  teamWeight: { mvp: 1.6, opoy: 0.4, dpoy: 0.3, oroy: 0.3, droy: 0.2, comeback: 0.3 },
  /** Voters' habits by position (added to the production z-score). */
  positionBonus: {
    mvp: { QB: 1.1, RB: 0.0, WR: -0.4, TE: -0.8 },
    opoy: { QB: 1.1, RB: 0.5, WR: -0.4, TE: -0.8 },
    dpoy: { EDGE: 0.2, DT: -0.5, LB: 0.7, CB: -0.2, S: -0.5 },
    oroy: { QB: 1.0, RB: 0.3, WR: -0.4, TE: -0.9 },
    droy: { EDGE: 0.2, DT: -0.2, LB: 0.6, CB: 0.0, S: -0.8 },
    comeback: {
      QB: 1.5,
      RB: 0.1,
      WR: -0.4,
      TE: -0.3,
      EDGE: -0.2,
      DT: -0.4,
      LB: -0.2,
      CB: -0.4,
      S: -0.6,
    },
  } as Record<string, Partial<Record<Position, number>>>,
  /** The MVP rarely wins OPOY too. */
  mvpAlsoOpoy: -0.6,
  /** All-Pro and All-Star Game: weight of production vs. reputation (the league's read). */
  honorProduction: 0.55,
  /** All-Pro slots per team (first and second teams), from the real AP teams. */
  allProSlots: (awardsData.allProSlots ?? {}) as Slots,
  /** All-Star Game spots per conference, from the real rosters. */
  proBowlSlots: (awardsData.proBowlSlots ?? {}) as Slots,
  /** Comeback: last season he played this few games, or produced this far below the norm. */
  comebackGames: 7,
  comebackPoorZ: -0.6,
  /** Coach of the Year: weight of wins above expectation and of improvement on last year. */
  coach: { aboveExpected: 1.0, improvement: 0.7, playoffs: 0.15 },
};

const OFFENSE: Position[] = ["QB", "RB", "WR", "TE"];
const DEFENSE: Position[] = ["EDGE", "DT", "LB", "CB", "S"];

const name = (p: { firstName: string; lastName: string }) => `${p.firstName} ${p.lastName}`;
const n = (v: number | undefined) => Math.round(v ?? 0).toLocaleString("en-US");

/** A season's production score at a position (bigger is better), or null if stats can't say. */
export function production(position: Position, l: StatLine): number | null {
  const g = (k: keyof StatLine) => (l[k] as number | undefined) ?? 0;
  switch (position) {
    case "QB":
      return g("passEpa") + g("rushEpa");
    case "RB":
    case "FB":
      return g("rushYds") + g("recYds") + 60 * (g("rushTd") + g("recTd"));
    case "WR":
    case "TE":
      return g("recYds") + 60 * g("recTd") + 3 * g("rec");
    case "EDGE":
    case "DT":
      return (
        25 * g("sacks") +
        1.2 * g("tackles") +
        8 * g("passDef") +
        40 * g("defInt") +
        50 * g("defTd") +
        20 * g("fumRec")
      );
    case "LB":
      return (
        1.5 * g("tackles") +
        20 * g("sacks") +
        40 * g("defInt") +
        10 * g("passDef") +
        50 * g("defTd") +
        20 * g("fumRec")
      );
    case "CB":
    case "S":
      return (
        45 * g("defInt") +
        14 * g("passDef") +
        g("tackles") +
        50 * g("defTd") +
        10 * g("sacks") +
        20 * g("fumRec")
      );
    case "K":
      return g("fga") >= 10 ? 10 * g("fgm") - 14 * (g("fga") - g("fgm")) + g("xpm") : null;
    case "P":
      return g("punts") >= 20 ? g("puntYds") / g("punts") : null;
    default:
      return null;
  }
}

/** One player's season for the voters. */
interface Ballot {
  p: Player;
  teamId: string;
  line: StatLine;
  prod: number | null;
  /** Production z-score at his position among the regulars. */
  z: number;
  /** The league's read of him, z-scored at his position. */
  rep: number;
  snaps: number;
  rookie: boolean;
}

function seasonLine(p: Player, season: number): StatLine {
  const out: StatLine = {};
  for (const s of p.stats)
    if (s.season === season)
      for (const [k, v] of Object.entries(s.line) as [keyof StatLine, number][])
        (out as Record<string, number>)[k] = ((out as Record<string, number>)[k] ?? 0) + v;
  return out;
}

const mainTeam = (p: Player, season: number) =>
  [...p.stats.filter((s) => s.season === season)].sort(
    (a, b) =>
      (b.line.offSnaps ?? 0) +
      (b.line.defSnaps ?? 0) -
      ((a.line.offSnaps ?? 0) + (a.line.defSnaps ?? 0)),
  )[0]?.teamId ?? p.teamId;

function zScores(values: number[]): (v: number) => number {
  const mean = values.reduce((a, b) => a + b, 0) / Math.max(1, values.length);
  const sd =
    Math.sqrt(
      values.reduce((a, b) => a + (b - mean) * (b - mean), 0) / Math.max(1, values.length),
    ) || 1;
  return (v) => (v - mean) / sd;
}

/** Every regular's season, scored against his position's regulars. */
export function ballots(league: League, season = league.season): Ballot[] {
  const raw = league.players
    .map((p) => {
      const line = seasonLine(p, season);
      const snaps = (line.offSnaps ?? 0) + (line.defSnaps ?? 0);
      const kicker = p.position === "K" || p.position === "P";
      const teamId = mainTeam(p, season);
      if (!teamId) return null;
      const prod = production(p.position, line);
      const regular = kicker
        ? prod !== null
        : (line.offSnaps ?? 0) + (line.defSnaps ?? 0) >= AWARDS.minSnaps;
      if (!regular) return null;
      return {
        p,
        teamId,
        line,
        prod,
        snaps,
        rookie: p.drafted?.season === season || (p.experience === 0 && season === league.season),
        overall: readOverall(league, p, { kind: "league" }),
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);
  const out: Ballot[] = [];
  const byPos = new Map<Position, typeof raw>();
  for (const r of raw) byPos.set(r.p.position, [...(byPos.get(r.p.position) ?? []), r]);
  for (const [, list] of [...byPos].sort((a, b) => a[0].localeCompare(b[0]))) {
    const zp = zScores(list.filter((r) => r.prod !== null).map((r) => r.prod!));
    const zr = zScores(list.map((r) => r.overall));
    for (const r of list)
      out.push({
        p: r.p,
        teamId: r.teamId,
        line: r.line,
        prod: r.prod,
        z: r.prod === null ? zr(r.overall) : zp(r.prod),
        rep: zr(r.overall),
        snaps: r.snaps,
        rookie: r.rookie,
      });
  }
  return out.sort((a, b) => a.p.id - b.p.id);
}

/** The stat line in words, for award reasons. */
export function statSummary(position: Position, l: StatLine): string {
  const g = (k: keyof StatLine) => (l[k] as number | undefined) ?? 0;
  switch (position) {
    case "QB":
      return `${n(g("passYds"))} passing yards, ${g("passTd")} TD, ${g("passInt")} INT`;
    case "RB":
    case "FB":
      return `${n(g("rushYds") + g("recYds"))} yards from scrimmage, ${g("rushTd") + g("recTd")} TD`;
    case "WR":
    case "TE":
      return `${g("rec")} catches, ${n(g("recYds"))} yards, ${g("recTd")} TD`;
    case "K":
      return `${g("fgm")} of ${g("fga")} field goals`;
    case "P":
      return `${(g("puntYds") / Math.max(1, g("punts"))).toFixed(1)} yards a punt`;
    case "OT":
    case "OG":
    case "C":
    case "LS":
      return `${n(g("offSnaps"))} snaps`;
    default: {
      const parts = [`${n(g("tackles"))} tackles`];
      if (g("sacks")) parts.push(`${g("sacks")} sacks`);
      if (g("defInt")) parts.push(`${g("defInt")} INT`);
      if (g("passDef")) parts.push(`${g("passDef")} passes defensed`);
      return parts.join(", ");
    }
  }
}

function record(league: League, teamId: string): string {
  const r = recordOf(league, teamId);
  return `${r.wins}-${r.losses}${r.ties ? `-${r.ties}` : ""}`;
}

/** Vote shares for the leaders (the winner first): softened by the score gaps, never random. */
function shares(scores: number[]): number[] {
  const top = scores.slice(0, 5);
  const w = top.map((s) => dmath.exp((s - top[0]!) / AWARDS.voteSpread));
  const sum = w.reduce((a, b) => a + b, 0);
  return w.map((x) => Math.round((x / sum) * AWARDS.voters) / AWARDS.voters);
}

function teamTerm(league: League, teamId: string, weight: number): number {
  return weight * (winShare(recordOf(league, teamId)) - 0.5) * 2;
}

/** Votes for one player award: the top few with shares and reasons. */
function vote(
  league: League,
  award: AwardKind,
  pool: Ballot[],
  score: (b: Ballot) => number,
): void {
  const ranked = pool
    .map((b) => ({ b, s: score(b) }))
    .sort((a, b) => b.s - a.s || a.b.p.id - b.b.p.id)
    .slice(0, 5);
  if (ranked.length === 0) return;
  const sh = shares(ranked.map((r) => r.s));
  ranked.slice(0, 3).forEach(({ b }, i) =>
    league.awards.push({
      season: league.season,
      award,
      place: i + 1,
      playerId: b.p.id,
      coachId: null,
      name: name(b.p),
      position: b.p.position,
      teamId: b.teamId,
      share: sh[i] ?? 0,
      reason: `${statSummary(b.p.position, b.line)}; ${teamName(league, b.teamId)} ${record(league, b.teamId)}.`,
      real: false,
    }),
  );
}

const bonus = (award: string, pos: Position) => AWARDS.positionBonus[award]?.[pos] ?? -9;

/** All-Pro first and second teams, or each conference's All-Star Game roster. */
function honors(league: League, all: Ballot[]): void {
  const score = (b: Ballot) => AWARDS.honorProduction * b.z + (1 - AWARDS.honorProduction) * b.rep;
  const byPos = new Map<Position, Ballot[]>();
  for (const b of all) byPos.set(b.p.position, [...(byPos.get(b.p.position) ?? []), b]);
  const conferenceOf = new Map(league.teams.map((t) => [t.id, t.conferenceId]));
  for (const [pos, list] of [...byPos].sort((a, b) => a[0].localeCompare(b[0]))) {
    const ranked = [...list].sort((a, b) => score(b) - score(a) || a.p.id - b.p.id);
    const slots = AWARDS.allProSlots[pos] ?? 0;
    ranked.slice(0, slots * 2).forEach((b, i) =>
      league.awards.push({
        season: league.season,
        award: i < slots ? "all-pro-1" : "all-pro-2",
        place: 1,
        playerId: b.p.id,
        coachId: null,
        name: name(b.p),
        position: pos,
        teamId: b.teamId,
        share: null,
        reason: statSummary(pos, b.line),
        real: false,
      }),
    );
    const per = AWARDS.proBowlSlots[pos] ?? 0;
    for (const conf of [...new Set(league.teams.map((t) => t.conferenceId))].sort())
      ranked
        .filter((b) => conferenceOf.get(b.teamId) === conf)
        .slice(0, per)
        .forEach((b) =>
          league.awards.push({
            season: league.season,
            award: "pro-bowl",
            place: 1,
            playerId: b.p.id,
            coachId: null,
            name: name(b.p),
            position: pos,
            teamId: b.teamId,
            share: null,
            reason: statSummary(pos, b.line),
            real: false,
          }),
        );
  }
}

/** Coach of the Year: wins above what the roster should have won, and the turnaround. */
function coachOfTheYear(league: League): void {
  const last = league.history.find((h) => h.season === league.season - 1);
  const C = AWARDS.coach;
  const thisYear = league.history.find((h) => h.season === league.season);
  const ranked = league.teams
    .map((t) => {
      const hc = league.coaches.find((c) => c.teamId === t.id && c.role === "HC");
      const ws = winShare(recordOf(league, t.id));
      const lastWs = last
        ? (() => {
            const s = last.standings.find((x) => x.teamId === t.id)!;
            return winShare({ wins: s.wins, losses: s.losses, ties: s.ties });
          })()
        : ws;
      const playoffs = thisYear?.standings.find((s) => s.teamId === t.id)?.seed != null;
      const s =
        C.aboveExpected * (ws - expectedWinShare(league, t.id)) +
        C.improvement * (ws - lastWs) +
        (playoffs ? C.playoffs : 0);
      return { t, hc, s, ws, lastWs };
    })
    .filter((x) => x.hc)
    .sort((a, b) => b.s - a.s || a.t.id.localeCompare(b.t.id))
    .slice(0, 3);
  const sh = shares(ranked.map((r) => r.s * 4));
  ranked.forEach((r, i) =>
    league.awards.push({
      season: league.season,
      award: "coach",
      place: i + 1,
      playerId: null,
      coachId: r.hc!.id,
      name: `${r.hc!.firstName} ${r.hc!.lastName}`,
      position: "HC",
      teamId: r.t.id,
      share: sh[i] ?? 0,
      reason: `${teamName(league, r.t.id)} went ${record(league, r.t.id)}${last ? ` after ${Math.round(r.lastWs * 17)} wins last season` : ""}.`,
      real: false,
    }),
  );
}

/** Comeback: back from a lost season (injury, or a poor one) to play like a top player. */
function comeback(league: League, all: Ballot[]): void {
  const prev = new Map(ballots(league, league.season - 1).map((b) => [b.p.id, b]));
  const pool = all.filter((b) => {
    if (b.rookie) return false;
    const lastGames = seasonLine(b.p, league.season - 1).gp ?? 0;
    const before = prev.get(b.p.id);
    const hadSeasons = b.p.stats.some((s) => s.season < league.season - 1);
    return (
      hadSeasons &&
      (lastGames < AWARDS.comebackGames || (before && before.z < AWARDS.comebackPoorZ))
    );
  });
  vote(
    league,
    "comeback",
    pool,
    (b) =>
      b.z +
      (AWARDS.positionBonus.comeback?.[b.p.position] ?? -0.5) +
      teamTerm(league, b.teamId, AWARDS.teamWeight.comeback),
  );
}

/** All of this season's awards (after the regular season; announced with the season's end). */
export function seasonAwards(league: League): void {
  if (league.awards.some((a) => a.season === league.season && !a.real)) return;
  const all = ballots(league);
  const off = all.filter((b) => OFFENSE.includes(b.p.position));
  const def = all.filter((b) => DEFENSE.includes(b.p.position));
  const W = AWARDS.teamWeight;
  vote(
    league,
    "mvp",
    off,
    (b) => b.z + bonus("mvp", b.p.position) + teamTerm(league, b.teamId, W.mvp),
  );
  const mvp = league.awards.find(
    (a) => a.season === league.season && a.award === "mvp" && a.place === 1,
  );
  vote(
    league,
    "opoy",
    off,
    (b) =>
      b.z +
      bonus("opoy", b.p.position) +
      teamTerm(league, b.teamId, W.opoy) +
      (b.p.id === mvp?.playerId ? AWARDS.mvpAlsoOpoy : 0),
  );
  vote(
    league,
    "dpoy",
    def,
    (b) => b.z + bonus("dpoy", b.p.position) + teamTerm(league, b.teamId, W.dpoy),
  );
  vote(
    league,
    "oroy",
    off.filter((b) => b.rookie),
    (b) => b.z + bonus("oroy", b.p.position) + teamTerm(league, b.teamId, W.oroy),
  );
  vote(
    league,
    "droy",
    def.filter((b) => b.rookie),
    (b) => b.z + bonus("droy", b.p.position) + teamTerm(league, b.teamId, W.droy),
  );
  comeback(league, all);
  coachOfTheYear(league);
  honors(league, all);
  // The big ones make news.
  const LABEL: Partial<Record<AwardKind, string>> = {
    mvp: "MVP",
    opoy: "Offensive Player of the Year",
    dpoy: "Defensive Player of the Year",
    oroy: "Offensive Rookie of the Year",
    droy: "Defensive Rookie of the Year",
    comeback: "Comeback Player of the Year",
    coach: "Coach of the Year",
  };
  for (const a of league.awards.filter(
    (x) => x.season === league.season && x.place === 1 && LABEL[x.award],
  ))
    addNews(league, {
      week: null,
      kind: "award",
      headline: `${a.name} is the ${league.season} ${LABEL[a.award]}`,
      text: `${a.name} (${a.position}, ${teamName(league, a.teamId)}): ${a.reason}${a.share !== null ? ` ${Math.round(a.share * AWARDS.voters)} of ${AWARDS.voters} votes.` : ""}`,
      teamIds: a.teamId ? [a.teamId] : [],
      playerIds: a.playerId !== null ? [a.playerId] : [],
      link: `/season/${league.season}`,
    });
}

export const AWARD_LABELS: Record<AwardKind, string> = {
  mvp: "MVP",
  opoy: "Offensive Player of the Year",
  dpoy: "Defensive Player of the Year",
  oroy: "Offensive Rookie of the Year",
  droy: "Defensive Rookie of the Year",
  comeback: "Comeback Player of the Year",
  coach: "Coach of the Year",
  "all-pro-1": "All-Pro (first team)",
  "all-pro-2": "All-Pro (second team)",
  "pro-bowl": "All-Star Game",
};

/** All-Star Game selections in these seasons (the fifth-year option's tiers count the first three). */
export function proBowls(league: League, playerId: number, from: number, to: number): number {
  return league.awards.filter(
    (a) => a.award === "pro-bowl" && a.playerId === playerId && a.season >= from && a.season <= to,
  ).length;
}
