/**
 * Newsfeed storylines (Phase 15): what the league's logs say happened since the feed last looked
 * (trades, big signings, coaching and front-office changes), and a weekly look at the season
 * (win and losing streaks, the MVP race, hot seats, starters lost for the year). Thresholds are
 * judgment, set so a week has a handful of stories, not dozens.
 */
import type { League, Player } from "../league/schema";
import { salaryCap } from "../contracts/cap";
import { totalValue } from "../contracts/contract";
import { expectedWinShare, recordOf, tenure, winShare } from "../coaches/carousel";
import { roleOn } from "../contracts/freeAgency";
import { addNews, newsWeek, teamName } from "./news";
import { ballots } from "./awards";

export const STORIES = {
  /** A signing makes news at this share of the cap a year (or more). */
  bigSigningShare: 0.05,
  /** Streaks worth a story (and every this many games after). */
  streakFrom: 5,
  /** The MVP race gets a story in these weeks. */
  raceWeeks: [6, 10, 14],
  /** A head coach is on the hot seat this many wins below what his roster should have won... */
  hotSeatWinsBelow: 2,
  /** ...from this week, after this many seasons in the job. */
  hotSeatFromWeek: 9,
  hotSeatTenure: 2,
};

const name = (p: { firstName: string; lastName: string }) => `${p.firstName} ${p.lastName}`;
const money = (d: number) => `$${(d / 1_000_000).toFixed(1)}M`;

/** Stories from the logs since the feed last looked (then it moves its place forward). */
export function newsFromLogs(league: League): void {
  const c = league.newsCursor;
  const cap = salaryCap(league.rules.cap, league.season);
  for (const t of league.transactions) {
    if (t.id <= c.transaction) continue;
    if (t.type === "traded") {
      addNews(league, {
        week: newsWeek(league),
        kind: "trade",
        headline: `Trade: ${t.teamIds.map((id) => teamName(league, id)).join(" and ")}`,
        text: t.text,
        teamIds: t.teamIds,
        playerIds: t.playerIds,
        link: "/transactions",
      });
    } else if (t.type === "signed" || t.type === "extended") {
      const p = league.players.find((x) => x.id === t.playerIds[0]);
      const year = p?.contract?.years.find((y) => y.season >= league.season);
      const real = p?.contract?.years.filter((y) => !y.void).length ?? 0;
      const apy = p?.contract ? totalValue(p.contract) / Math.max(1, real) : 0;
      if (!p || !year || apy < cap * STORIES.bigSigningShare) continue;
      addNews(league, {
        week: newsWeek(league),
        kind: "signing",
        headline:
          t.type === "extended"
            ? `${name(p)} gets an extension from the ${teamName(league, t.teamIds[0]!)}`
            : `${name(p)} signs with the ${teamName(league, t.teamIds[0]!)}`,
        text: `${t.text} About ${money(apy)} a year.`,
        teamIds: t.teamIds,
        playerIds: t.playerIds,
        link: `/player/${p.id}`,
      });
    }
  }
  c.transaction = league.transactions.reduce((m, t) => Math.max(m, t.id), c.transaction);
  for (const m of league.coachingMoves.slice(c.coachingMove)) {
    if (m.role !== "HC" || (m.kind !== "fired" && m.kind !== "hired" && m.kind !== "interim"))
      continue;
    addNews(league, {
      week: newsWeek(league),
      kind: "coaching",
      headline: m.text,
      text: m.reason,
      teamIds: m.teamId ? [m.teamId] : [],
      playerIds: [],
      link: `/coach/${m.coachId}`,
    });
  }
  c.coachingMove = league.coachingMoves.length;
  for (const m of league.executiveMoves.slice(c.executiveMove)) {
    if (m.role !== "GM" || (m.kind !== "fired" && m.kind !== "hired")) continue;
    addNews(league, {
      week: newsWeek(league),
      kind: "front-office",
      headline: m.text,
      text: m.reason,
      teamIds: m.teamId ? [m.teamId] : [],
      playerIds: [],
      link: `/executive/${m.executiveId}`,
    });
  }
  c.executiveMove = league.executiveMoves.length;
}

/** A team's current streak (wins positive, losses negative) in regular-season games. */
function streak(league: League, teamId: string): number {
  const games = league.games
    .filter(
      (g) => g.round === "regular" && g.result && (g.homeId === teamId || g.awayId === teamId),
    )
    .sort((a, b) => a.week - b.week);
  let n = 0;
  for (let i = games.length - 1; i >= 0; i--) {
    const g = games[i]!;
    const mine = g.homeId === teamId ? g.result!.homeScore : g.result!.awayScore;
    const theirs = g.homeId === teamId ? g.result!.awayScore : g.result!.homeScore;
    const won = mine > theirs ? 1 : mine < theirs ? -1 : 0;
    if (won === 0 || (n !== 0 && Math.sign(n) !== won)) break;
    n += won;
  }
  return n;
}

/** After a week's games: streaks, the MVP race, hot seats, starters lost for the season. */
export function weeklyNews(league: League, week: number): void {
  const S = STORIES;
  for (const t of [...league.teams].sort((a, b) => a.id.localeCompare(b.id))) {
    const s = streak(league, t.id);
    const len = Math.abs(s);
    if (len >= S.streakFrom && (len - S.streakFrom) % 2 === 0)
      addNews(league, {
        week,
        kind: "streak",
        headline: `The ${teamName(league, t.id)} have ${s > 0 ? "won" : "lost"} ${len} straight`,
        text: `${teamName(league, t.id)}: ${fmtRecord(league, t.id)} after week ${week}.`,
        teamIds: [t.id],
        playerIds: [],
        link: `/team/${t.id}`,
      });
    if (week >= S.hotSeatFromWeek) {
      const hc = league.coaches.find((c) => c.teamId === t.id && c.role === "HC" && !c.interim);
      if (hc && tenure(league, hc) > S.hotSeatTenure) {
        const r = recordOf(league, t.id);
        const games = r.wins + r.losses + r.ties;
        const below = (expectedWinShare(league, t.id) - winShare(r)) * games;
        const said = league.news.some(
          (n) => n.kind === "hot-seat" && n.season === league.season && n.teamIds[0] === t.id,
        );
        if (below >= S.hotSeatWinsBelow && !said)
          addNews(league, {
            week,
            kind: "hot-seat",
            headline: `${hc.firstName} ${hc.lastName}'s seat is getting hot in ${t.city}`,
            text: `The ${teamName(league, t.id)} are ${fmtRecord(league, t.id)}, about ${Math.round(below)} wins below what their roster should have won.`,
            teamIds: [t.id],
            playerIds: [],
            link: `/coach/${hc.id}`,
          });
      }
    }
  }
  if (S.raceWeeks.includes(week)) mvpRace(league, week);
  lostForSeason(league, week);
}

function fmtRecord(league: League, teamId: string): string {
  const r = recordOf(league, teamId);
  return `${r.wins}-${r.losses}${r.ties ? `-${r.ties}` : ""}`;
}

/** The MVP race: the leaders by the voters' own measure, so far. */
function mvpRace(league: League, week: number): void {
  const all = ballots(league).filter(
    (b) => b.p.position === "QB" || b.p.position === "RB" || b.p.position === "WR",
  );
  const top = all
    .map((b) => ({
      b,
      s:
        b.z +
        (b.p.position === "QB" ? 1 : 0) +
        1.6 * (winShare(recordOf(league, b.teamId)) - 0.5) * 2,
    }))
    .sort((a, b) => b.s - a.s || a.b.p.id - b.b.p.id)
    .slice(0, 3);
  if (top.length === 0) return;
  addNews(league, {
    week,
    kind: "race",
    headline: `MVP race after week ${week}: ${name(top[0]!.b.p)} leads`,
    text:
      top
        .map(
          ({ b }, i) => `${i + 1}. ${name(b.p)} (${b.p.position}, ${teamName(league, b.teamId)})`,
        )
        .join("; ") + ".",
    teamIds: [top[0]!.b.teamId],
    playerIds: top.map(({ b }) => b.p.id),
    link: "/leaders",
  });
}

/** Starters hurt this week who'll miss the rest of the regular season. */
function lostForSeason(league: League, week: number): void {
  const left = league.rules.schedule.regularSeasonWeeks - week;
  for (const p of league.players as Player[]) {
    if (!p.teamId || !p.injury) continue;
    const last = p.injuryHistory.at(-1);
    if (!last || last.date !== league.date || p.injury.gamesRemaining < left || left <= 0) continue;
    if (roleOn(league, p.teamId, p) !== "starter") continue;
    addNews(league, {
      week,
      kind: "injury",
      headline: `${name(p)} is out for the season`,
      text: `The ${teamName(league, p.teamId)} lose their starting ${p.position}: ${last.part}, expected to miss ${p.injury.gamesRemaining} games.`,
      teamIds: [p.teamId],
      playerIds: [p.id],
      link: `/player/${p.id}`,
    });
  }
}
