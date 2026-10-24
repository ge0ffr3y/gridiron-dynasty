/**
 * The Hall of Fame (Phase 15). Each year after the championship the committee meets, by the rules
 * in the rules file (`hallOfFame`, from the Hall's own bylaws): players who last played at least
 * five full seasons ago, 13 player finalists plus a coach and a contributor (a general manager),
 * each needing 80% approval, three to seven new members a year.
 *
 * A career's case: All-Pro teams (first teams most), Pro Bowls, MVPs and player-of-the-year
 * awards, titles, records still held, peak and longevity. Approval rises with the case on a
 * logistic curve around a bar (judgment, tuned so classes look like real ones: `--history N`).
 * Inductees' primary teams retire their numbers. No random draws.
 */
import { dmath } from "@fgm/foundation";
import type { Coach, Executive, FormerPlayer, League } from "../league/schema";
import { formerPlayerCard } from "../lifecycle/archive";
import { uniformFrom } from "../scouting/noise";
import { addNews, teamName } from "./news";

export const HALL = {
  /** A case's points. */
  points: {
    allPro1: 3,
    allPro2: 1.5,
    proBowl: 0.7,
    mvp: 6,
    poy: 3,
    roy: 1,
    title: 1.5,
    leagueRecord: 2,
    /** Per point of peak overall above 80. */
    peak: 0.6,
    /** Per season as a regular starter. */
    started: 0.4,
  },
  /** Approval is 50% at the bar, and moves this much per point of case. */
  bar: 14,
  spread: 3,
  /**
   * Voters want a longer look at all but the clearest: a first-year candidate's case counts this
   * much less, and each year he waits it counts this much more (real classes are about a third
   * first ballot; judgment, checked by `--history`).
   */
  firstBallotHurdle: 6,
  waitBonus: 1.5,
  /** A coach's case: wins, titles and playoff trips as a head coach. */
  coach: { perWin: 0.12, title: 6, playoffs: 1, bar: 24, spread: 4 },
  /** A general manager's (a contributor): titles and playoff trips, per season run. */
  contributor: { title: 6, playoffs: 1.2, bar: 18, spread: 4 },
};

const nameOf = (x: { firstName: string; lastName: string }) => `${x.firstName} ${x.lastName}`;

interface Case {
  kind: "player" | "coach" | "contributor";
  id: number;
  name: string;
  position: string;
  teams: string[];
  lastSeason: number;
  score: number;
  approval: number;
  reason: string;
  number: number | null;
}

function count(league: League, playerId: number, award: string): number {
  return league.awards.filter((a) => a.playerId === playerId && a.award === award && a.place === 1)
    .length;
}

/** A player's case for the Hall. */
export function playerCase(league: League, card: FormerPlayer): { score: number; reason: string } {
  const P = HALL.points;
  const ap1 = count(league, card.id, "all-pro-1");
  const ap2 = count(league, card.id, "all-pro-2");
  const pb = count(league, card.id, "pro-bowl");
  const mvp = count(league, card.id, "mvp");
  const poy = count(league, card.id, "opoy") + count(league, card.id, "dpoy");
  const roy = count(league, card.id, "oroy") + count(league, card.id, "droy");
  const records = league.records.filter(
    (r) => r.scope === "league" && r.level !== "game" && r.top[0]?.playerId === card.id,
  ).length;
  const score =
    P.allPro1 * ap1 +
    P.allPro2 * ap2 +
    P.proBowl * pb +
    P.mvp * mvp +
    P.poy * poy +
    P.roy * roy +
    P.title * card.titles +
    P.leagueRecord * records +
    P.peak * Math.max(0, card.peak - 80) +
    P.started * card.seasonsStarted;
  const parts: string[] = [];
  if (mvp) parts.push(`${mvp}x MVP`);
  if (poy) parts.push(`${poy}x Player of the Year`);
  if (ap1) parts.push(`${ap1}x first-team All-Pro`);
  if (ap2) parts.push(`${ap2}x second-team All-Pro`);
  if (pb) parts.push(`${pb} Pro Bowls`);
  if (card.titles) parts.push(`${card.titles} title${card.titles === 1 ? "" : "s"}`);
  if (records) parts.push(`holds ${records} league record${records === 1 ? "" : "s"}`);
  parts.push(`${card.seasonsStarted} seasons as a starter`);
  return { score, reason: parts.join(", ") + "." };
}

/** What the committee feels about a case after this many years on the ballot. */
const waitAdjustment = (waited: number) =>
  waited === 0 ? -HALL.firstBallotHurdle : HALL.waitBonus * waited;

const approve = (score: number, bar: number, spread: number) =>
  dmath.logistic((score - bar) / spread);

/** Everyone who could be voted on this year, with their cases. */
function candidates(league: League): Case[] {
  const R = league.rules.hallOfFame;
  const vote = league.season; // the class of next year, voted after this season
  const inHall = new Set(
    league.hallOfFame.flatMap((h) =>
      h.playerId !== null
        ? [`p${h.playerId}`]
        : h.coachId !== null
          ? [`c${h.coachId}`]
          : h.executiveId !== null
            ? [`e${h.executiveId}`]
            : [],
    ),
  );
  const out: Case[] = [];
  // Players: history cards, and retired players not yet carded.
  const cards = [
    // Imported legends' fates were settled in the real league.
    ...league.formerPlayers.filter((c) => !c.legend),
    ...league.players
      .filter((p) => p.retiredAfter !== null)
      .map((p) => formerPlayerCard(league, p)),
  ];
  for (const card of cards) {
    if (inHall.has(`p${card.id}`) || vote - card.lastSeason < R.waitSeasons) continue;
    const c = playerCase(league, card);
    const waited = Math.max(0, vote - card.lastSeason - R.waitSeasons - 1);
    out.push({
      kind: "player",
      id: card.id,
      name: nameOf(card),
      position: card.position,
      teams: card.teams,
      lastSeason: card.lastSeason,
      score: c.score,
      approval: approve(c.score + waitAdjustment(waited), HALL.bar, HALL.spread),
      reason: c.reason,
      number: card.number,
    });
  }
  // Coaches (head coaches) retired long enough. (The bylaws' wait is for players; coaches wait the
  // same here: judgment.)
  const champs = new Map(league.history.map((h) => [h.season, h.championId]));
  const inPlayoffs = new Set(
    league.history.flatMap((h) =>
      h.standings.filter((s) => s.seed !== null).map((s) => `${h.season}:${s.teamId}`),
    ),
  );
  for (const c of league.coaches) {
    if (c.retiredAfter === null || inHall.has(`c${c.id}`) || vote - c.retiredAfter < R.waitSeasons)
      continue;
    const s = coachCase(c, champs, inPlayoffs);
    if (s.wins === 0) continue;
    out.push({
      kind: "coach",
      id: c.id,
      name: nameOf(c),
      position: "HC",
      teams: s.teams,
      lastSeason: c.retiredAfter,
      score: s.score,
      approval: approve(
        s.score + waitAdjustment(Math.max(0, vote - c.retiredAfter - R.waitSeasons - 1)),
        HALL.coach.bar,
        HALL.coach.spread,
      ),
      reason: s.reason,
      number: null,
    });
  }
  for (const e of league.executives) {
    if (e.role !== "GM" || e.person || e.retiredAfter === null || inHall.has(`e${e.id}`)) continue;
    if (vote - e.retiredAfter < R.waitSeasons) continue;
    const s = contributorCase(e, champs);
    if (s.seasons === 0) continue;
    out.push({
      kind: "contributor",
      id: e.id,
      name: nameOf(e),
      position: "GM",
      teams: s.teams,
      lastSeason: e.retiredAfter,
      score: s.score,
      approval: approve(
        s.score + waitAdjustment(Math.max(0, vote - e.retiredAfter - R.waitSeasons - 1)),
        HALL.contributor.bar,
        HALL.contributor.spread,
      ),
      reason: s.reason,
      number: null,
    });
  }
  return out.sort((a, b) => b.score - a.score || a.id - b.id);
}

function coachCase(c: Coach, champs: Map<number, string>, inPlayoffs: Set<string>) {
  let wins = 0;
  let titles = 0;
  let playoffs = 0;
  const teams: string[] = [];
  for (const l of c.career) {
    if (l.role !== "HC" || !l.record) continue;
    wins += l.record.wins;
    if (inPlayoffs.has(`${l.season}:${l.teamId}`)) playoffs += 1;
    if (champs.get(l.season) === l.teamId) titles += 1;
    if (l.teamId && !teams.includes(l.teamId)) teams.push(l.teamId);
  }
  const C = HALL.coach;
  return {
    wins,
    teams,
    score: C.perWin * wins + C.title * titles + C.playoffs * playoffs,
    reason: `${wins} wins as a head coach, ${playoffs} playoff trip${playoffs === 1 ? "" : "s"}, ${titles} title${titles === 1 ? "" : "s"}.`,
  };
}

function contributorCase(e: Executive, champs: Map<number, string>) {
  let titles = 0;
  let playoffs = 0;
  let seasons = 0;
  const teams: string[] = [];
  for (const l of e.career) {
    if (!l.teamId) continue;
    seasons += 1;
    if (l.playoffs) playoffs += 1;
    if (champs.get(l.season) === l.teamId) titles += 1;
    if (!teams.includes(l.teamId)) teams.push(l.teamId);
  }
  const C = HALL.contributor;
  return {
    seasons,
    teams,
    score: C.title * titles + C.playoffs * playoffs,
    reason: `${seasons} seasons running teams, ${playoffs} playoff trip${playoffs === 1 ? "" : "s"}, ${titles} title${titles === 1 ? "" : "s"}.`,
  };
}

/** This year's vote: finalists, then the class. Returns the new members. */
export function hallOfFameVote(league: League): Case[] {
  const R = league.rules.hallOfFame;
  const classYear = league.season + 1;
  if (league.hallOfFame.some((h) => h.inducted === classYear && !h.real)) return [];
  const all = candidates(league);
  const finalists = [
    ...all.filter((c) => c.kind === "player").slice(0, R.playerFinalists),
    ...all.filter((c) => c.kind === "coach").slice(0, R.coachFinalists),
    ...all.filter((c) => c.kind === "contributor").slice(0, R.contributorFinalists),
  ];
  const byApproval = [...finalists].sort((a, b) => b.approval - a.approval || b.score - a.score);
  let elected = byApproval.filter((c) => c.approval >= R.approvalShare).slice(0, R.classMax);
  // The bylaws call for at least the minimum: the next-closest finalists get in.
  if (elected.length < R.classMin) elected = byApproval.slice(0, R.classMin);
  for (const c of elected) {
    const firstEligible = c.lastSeason + R.waitSeasons + 1;
    league.hallOfFame.push({
      kind: c.kind,
      playerId: c.kind === "player" ? c.id : null,
      coachId: c.kind === "coach" ? c.id : null,
      executiveId: c.kind === "contributor" ? c.id : null,
      name: c.name,
      position: c.position,
      teams: c.teams,
      inducted: classYear,
      waited: Math.max(0, classYear - firstEligible),
      reason: c.reason,
      real: false,
    });
    if (c.kind === "player") retireNumber(league, c);
  }
  if (elected.length)
    addNews(league, {
      week: null,
      kind: "hall-of-fame",
      headline: `The Hall of Fame's class of ${classYear}: ${elected.map((c) => c.name).join(", ")}`,
      text: elected.map((c) => `${c.name} (${c.position}): ${c.reason}`).join(" "),
      teamIds: [...new Set(elected.flatMap((c) => c.teams.slice(0, 1)))],
      playerIds: elected.filter((c) => c.kind === "player").map((c) => c.id),
      link: "/history",
    });
  return elected;
}

/**
 * His primary team retires his number if it does that sort of thing (some franchises never do:
 * `RETIRING.teamShare` of them do, by a fixed draw per team), he gave it at least
 * `RETIRING.minSeasons` seasons, and those were most of his career.
 */
export const RETIRING = { teamShare: 0.5, minSeasons: 6, careerShare: 0.6 };

function retireNumber(league: League, c: Case): void {
  if (c.number === null) return;
  const p = league.players.find((x) => x.id === c.id);
  const seasons = new Map<string, number>();
  for (const s of p?.stats ?? []) seasons.set(s.teamId, (seasons.get(s.teamId) ?? 0) + 1);
  const best = [...seasons].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
  const team = best?.[0] ?? c.teams[0];
  if (!team) return;
  if (best) {
    const total = [...seasons.values()].reduce((a, b) => a + b, 0);
    if (best[1] < RETIRING.minSeasons || best[1] / total < RETIRING.careerShare) return;
  }
  if (uniformFrom(`${league.meta.seed}:retires-numbers:${team}`) >= RETIRING.teamShare) return;
  if (league.retiredNumbers.some((r) => r.teamId === team && r.number === c.number)) return;
  league.retiredNumbers.push({
    teamId: team,
    number: c.number,
    name: c.name,
    playerId: c.id,
    season: league.season,
    real: false,
  });
  addNews(league, {
    week: null,
    kind: "hall-of-fame",
    headline: `The ${teamName(league, team)} retire No. ${c.number} for ${c.name}`,
    text: `No ${teamName(league, team)} player will wear ${c.number} again.`,
    teamIds: [team],
    playerIds: [c.id],
    link: `/team/${team}`,
  });
}

/** For reports: do the best careers get in? Players eligible for at least `waited` more years. */
export function hallOfFameAudit(league: League): {
  eligible: number;
  inducted: number;
  /** Of the twenty strongest eligible careers, how many are in. */
  topTwentyIn: number;
  inductedScore: { min: number; mean: number };
  /** The strongest career still out, and his case. */
  bestOut: { name: string; score: number } | null;
} {
  const R = league.rules.hallOfFame;
  // The latest vote was held after the season that just ended (the audit runs once the calendar has turned).
  const lastVote = league.calendar.stage === "offseason" ? league.season - 1 : league.season;
  const inHall = new Set(
    league.hallOfFame.filter((h) => h.playerId !== null).map((h) => h.playerId),
  );
  const cards = [
    ...league.formerPlayers.filter((c) => !c.legend),
    ...league.players
      .filter((p) => p.retiredAfter !== null)
      .map((p) => formerPlayerCard(league, p)),
  ].filter((c) => lastVote - c.lastSeason >= R.waitSeasons);
  const scored = cards
    .map((c) => ({ c, score: playerCase(league, c).score }))
    .sort((a, b) => b.score - a.score || a.c.id - b.c.id);
  const inScores = scored.filter((s) => inHall.has(s.c.id)).map((s) => s.score);
  const out = scored.find((s) => !inHall.has(s.c.id));
  return {
    eligible: scored.length,
    inducted: inScores.length,
    topTwentyIn: scored.slice(0, 20).filter((s) => inHall.has(s.c.id)).length,
    inductedScore: {
      min: inScores.length ? Math.min(...inScores) : 0,
      mean: inScores.length ? inScores.reduce((a, b) => a + b, 0) / inScores.length : 0,
    },
    bestOut: out ? { name: nameOf(out.c), score: out.score } : null,
  };
}
