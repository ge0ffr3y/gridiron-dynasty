/**
 * The balance check (Phase 13b), for `npm run sim -- --frontoffices N`: what each GM type's teams
 * look like and how they do (wins, playoffs, titles, cap hell, roster age, spending, trades), and
 * whether the league's parity matches the real one (calibration/frontoffice.json `parity`).
 */
import { ageOn } from "@fgm/foundation";
import type { League } from "../league/schema";
import { salaryCap } from "../contracts/cap";
import { archetypeOf, gmOf, type Archetype } from "./executives";

/** One team's season, recorded when the season is complete (before the offseason begins). */
export interface TeamSeasonFacts {
  season: number;
  teamId: string;
  archetype: Archetype | "none";
  winShare: number;
  playoffs: boolean;
  title: boolean;
  /** Dead money as a share of the cap this season. */
  deadShare: number;
  /** Average age of the 53 (active roster). */
  age: number;
  /** Free agents signed from other teams this League Year, average yearly value as a share of the cap. */
  faSpend: number;
  trades: number;
  restructures: number;
}

export function teamSeasonFacts(league: League): TeamSeasonFacts[] {
  const season = league.season;
  const last = league.history.at(-1);
  const cap = salaryCap(league.rules.cap, season);
  return league.teams.map((t) => {
    const row = last?.standings.find((s) => s.teamId === t.id);
    const games = row ? row.wins + row.losses + row.ties : 0;
    const gm = gmOf(league, t.id);
    const roster = league.players.filter((p) => p.teamId === t.id && p.roster === "active");
    const dead = t.cap.deadMoney
      .filter((d) => d.season === season)
      .reduce((s, d) => s + d.amount, 0);
    return {
      season,
      teamId: t.id,
      archetype: gm?.gm ? archetypeOf(gm.gm) : "none",
      winShare: games > 0 ? (row!.wins + row!.ties / 2) / games : 0.5,
      playoffs: row?.seed !== null && row?.seed !== undefined,
      title: last?.championId === t.id,
      deadShare: dead / cap,
      age:
        roster.reduce((s, p) => s + ageOn(p.birthDate, league.date), 0) /
        Math.max(1, roster.length),
      faSpend:
        league.freeAgentMoves
          .filter((m) => m.season === season && m.toTeamId === t.id)
          .reduce((s, m) => s + m.averagePerYear, 0) / cap,
      trades: league.tradeHistory.filter((h) => h.season === season && h.teams.includes(t.id))
        .length,
      restructures: league.transactions.filter(
        (x) =>
          x.type === "restructured" && x.teamIds.includes(t.id) && x.date.startsWith(`${season}-`),
      ).length,
    };
  });
}

export interface ParityMeasure {
  winShareSd: number;
  winShareCorrelation: number;
  playoffRepeatRate: number;
  worstToPlayoffsRate: number;
  championsPerDecade: number | null;
  playoffRunsOf5PerTeamDecade: number;
  losingRunsOf4PerTeamDecade: number;
  longestPlayoffRun: number;
  longestLosingRun: number;
}

/** The league's parity over the seasons recorded, measured the way the real one was. */
export function parity(facts: TeamSeasonFacts[]): ParityMeasure {
  const by = new Map<string, TeamSeasonFacts>();
  for (const f of facts) by.set(`${f.teamId}|${f.season}`, f);
  const seasons = [...new Set(facts.map((f) => f.season))].sort((a, b) => a - b);
  const teams = [...new Set(facts.map((f) => f.teamId))].sort();
  const pairs: [number, number][] = [];
  let repeat = 0;
  let inPlayoffs = 0;
  let worst = 0;
  let worstUp = 0;
  for (const t of teams)
    for (const s of seasons) {
      const a = by.get(`${t}|${s}`);
      const b = by.get(`${t}|${s + 1}`);
      if (!a || !b) continue;
      pairs.push([a.winShare, b.winShare]);
      if (a.playoffs) {
        inPlayoffs += 1;
        if (b.playoffs) repeat += 1;
      }
      if (a.winShare <= 5 / 16) {
        worst += 1;
        if (b.playoffs) worstUp += 1;
      }
    }
  const n = pairs.length || 1;
  const mx = pairs.reduce((s, p) => s + p[0], 0) / n;
  const my = pairs.reduce((s, p) => s + p[1], 0) / n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (const [x, y] of pairs) {
    sxy += (x - mx) * (y - my);
    sxx += (x - mx) * (x - mx);
    syy += (y - my) * (y - my);
  }
  const champs: number[] = [];
  for (let i = 0; i + 10 <= seasons.length; i++) {
    const set = new Set(
      facts
        .filter((f) => f.title && f.season >= seasons[i]! && f.season < seasons[i]! + 10)
        .map((f) => f.teamId),
    );
    champs.push(set.size);
  }
  let playoffRuns = 0;
  let losingRuns = 0;
  let longestP = 0;
  let longestL = 0;
  for (const t of teams) {
    let p = 0;
    let l = 0;
    for (const s of [...seasons, seasons.at(-1)! + 1]) {
      const f = by.get(`${t}|${s}`);
      if (f?.playoffs) p += 1;
      else {
        if (p >= 5) playoffRuns += 1;
        longestP = Math.max(longestP, p);
        p = 0;
      }
      if (f && f.winShare < 0.5) l += 1;
      else {
        if (l >= 4) losingRuns += 1;
        longestL = Math.max(longestL, l);
        l = 0;
      }
    }
  }
  const teamDecades = (teams.length * seasons.length) / 10;
  const r3 = (x: number) => Math.round(x * 1000) / 1000;
  const all = facts.map((f) => f.winShare);
  const m = all.reduce((a, b) => a + b, 0) / Math.max(1, all.length);
  const sd = Math.sqrt(all.reduce((a, b) => a + (b - m) * (b - m), 0) / Math.max(1, all.length));
  return {
    winShareSd: r3(sd),
    winShareCorrelation: r3(sxy / Math.sqrt(sxx * syy || 1)),
    playoffRepeatRate: r3(repeat / Math.max(1, inPlayoffs)),
    worstToPlayoffsRate: r3(worstUp / Math.max(1, worst)),
    championsPerDecade: champs.length
      ? r3(champs.reduce((a, b) => a + b, 0) / champs.length)
      : null,
    playoffRunsOf5PerTeamDecade: r3(playoffRuns / Math.max(1, teamDecades)),
    losingRunsOf4PerTeamDecade: r3(losingRuns / Math.max(1, teamDecades)),
    longestPlayoffRun: longestP,
    longestLosingRun: longestL,
  };
}

/** Averages by GM type. */
export function byArchetype(facts: TeamSeasonFacts[]) {
  const groups = new Map<string, TeamSeasonFacts[]>();
  for (const f of facts) groups.set(f.archetype, [...(groups.get(f.archetype) ?? []), f]);
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
  return [...groups]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([archetype, fs]) => ({
      archetype,
      teamSeasons: fs.length,
      winShare: mean(fs.map((f) => f.winShare)),
      playoffs: mean(fs.map((f) => (f.playoffs ? 1 : 0))),
      titles: fs.filter((f) => f.title).length,
      capHell: mean(fs.map((f) => (f.deadShare > 0.15 ? 1 : 0))),
      deadShare: mean(fs.map((f) => f.deadShare)),
      age: mean(fs.map((f) => f.age)),
      faSpend: mean(fs.map((f) => f.faSpend)),
      trades: mean(fs.map((f) => f.trades)),
      restructures: mean(fs.map((f) => f.restructures)),
    }));
}
