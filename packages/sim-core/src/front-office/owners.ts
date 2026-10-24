/**
 * Owners (Phase 13b): they judge their GM and head coach, and hire and fire them with reasons.
 *
 * - Head coaches: the carousel's firing odds (Phase 10b) move with the owner: patient owners
 *   fire less, ambitious ones more, meddlers act on impulse (`ownerCoachTerm`).
 * - GMs, on Black Monday: results against what the roster should have won, playoff droughts,
 *   losing runs, cap hell, the contract, a new GM's grace, the owner's patience and ambition.
 *   A fired GM is replaced at once from out-of-work GMs and newcomers from the personnel ranks,
 *   chosen by skill, reputation and how they suit the owner. A new GM may bring his own head coach.
 * - During the season, an owner who fires his head coach sometimes lets the GM go too.
 * - At each season's end: a career line for every GM, reputations, contracts renewed, and
 *   retirements (an old GM's team hires a new one).
 * Odds are tuned to the real turnover: about 4.5 new GMs a year (calibration/frontoffice.json),
 * while head-coach changes stay at 7.2 a year between seasons and 1.65 during them.
 */
import { recentSeasons } from "../history/past";
import { offersAfterReviews, reviewPerson } from "../career/job";
import { addDays, ageOn, dmath, Rng, streamSeed } from "@fgm/foundation";
import type { Executive, League } from "../league/schema";
import { GM_ARCHETYPES } from "../league/schema";
import {
  expectedWinShare,
  losingSeasonsInRow,
  recordOf,
  release,
  tenure,
  winShare,
} from "../coaches/carousel";
import { salaryCap } from "../contracts/cap";
import { NamePicker } from "../generate/people";
import { uniformFrom } from "../scouting/noise";
import {
  ARCHETYPE_LABELS,
  archetypeOf,
  describeOwner,
  drawGm,
  gmOf,
  ownerStyle,
} from "./executives";

export const OWNERS = {
  /** Head-coach firing log-odds: per point of impatience (-patience), ambition and meddling. */
  coach: { impatience: 0.6, ambition: 0.4, meddling: 0.5 },
  /** GM firing on Black Monday (log-odds; judgment tuned to about 4.5 changes a year). */
  gm: {
    base: -3.0,
    perWinShareBelow: 6,
    /** Per season without the playoffs beyond the second. */
    perDroughtSeason: 0.45,
    perLosingSeasonInRow: 0.35,
    /** More than this share of the cap in dead money. */
    capHellShare: 0.15,
    capHell: 0.8,
    contractUp: 0.5,
    /** His first and second seasons. */
    grace: [-2.2, -1.1] as [number, number],
    playoffs: -1.5,
    impatience: 0.8,
    ambition: 0.4,
  },
  /** When a head coach is fired in season, the GM goes too with this chance (more if impatient). */
  inSeasonGm: { base: 0.2, impatience: 0.2, minTenure: 3 },
  /** A new GM replaces a head coach he didn't hire with this chance (more if the team lost). */
  newGmNewCoach: 0.3,
  /** Candidates: out-of-work GMs considered, newcomers from the personnel ranks per opening. */
  candidates: 6,
  newcomers: 3,
  newcomerAge: [36, 50] as [number, number],
  newcomerSkill: { mean: 52, sd: 10 },
  newcomerReputation: 40,
  /** Hiring score: skill and reputation, the owner's taste (ambitious owners like win-now GMs,
   * patient ones like builders), and a little spread between owners. */
  score: { skill: 0.5, reputation: 0.5, fit: 10, taste: 6 },
  contractYears: [4, 5] as [number, number],
  /** Season's end: reputation per win share above expected (x100), playoffs, a title, drift. */
  reputation: { perWinAbove: 0.4, playoffs: 3, title: 8, fired: -10, drift: 0.1 },
  /** Retirement: even odds at this age, per this many years; out of work this long retires. */
  retirement: { evenOddsAge: 72, yearsPerStep: 4, idleSeasons: 3 },
} as const;

const name = (e: { firstName: string; lastName: string }) => `${e.firstName} ${e.lastName}`;
const teamName = (league: League, id: string) => {
  const t = league.teams.find((x) => x.id === id);
  return t ? `${t.city} ${t.nickname}` : id;
};

function log(
  league: League,
  move: Omit<League["executiveMoves"][number], "season" | "date">,
): void {
  league.executiveMoves.push({ season: league.season, date: league.date, ...move });
}

/** The owner's push on the carousel's head-coach firing odds (log-odds). */
export function ownerCoachTerm(league: League, teamId: string): number {
  const o = ownerStyle(league, teamId);
  const C = OWNERS.coach;
  // A meddler's impulse: fixed per owner and season (a hash), so it never re-rolls.
  const impulse = uniformFrom(`${league.meta.seed}:meddle:${teamId}:${league.season}`) * 2 - 1;
  return -C.impatience * o.patience + C.ambition * o.ambition + C.meddling * o.meddling * impulse;
}

/** Seasons in a row a team has missed the playoffs, ending with the last finished one. */
function drought(league: League, teamId: string): number {
  let n = 0;
  for (const s of recentSeasons(league, teamId)) {
    if (s.playoffs) break;
    n += 1;
  }
  return n;
}

/** This season's dead money as a share of the cap. */
function deadShare(league: League, teamId: string): number {
  const team = league.teams.find((t) => t.id === teamId)!;
  const dead = team.cap.deadMoney
    .filter((d) => d.season === league.season)
    .reduce((s, d) => s + d.amount, 0);
  return dead / salaryCap(league.rules.cap, league.season);
}

/** Seasons a GM has run his team (counting this one). */
function gmTenure(league: League, gm: Executive): number {
  return league.season - gm.hiredSeason + 1;
}

function rng(league: League, label: string): Rng {
  return new Rng(streamSeed(league.meta.seed, `owners:${league.season}:${label}`));
}

/** The owner's odds of firing his GM on Black Monday, and the reasons he'd give. */
export function gmFiringOdds(
  league: League,
  teamId: string,
  inPlayoffs: Set<string>,
  /** Extra log-odds (the owner's reactions to a person GM's moves, Phase 14b). */
  extra = 0,
): { chance: number; reason: string } {
  const G = OWNERS.gm;
  const gm = gmOf(league, teamId);
  if (!gm) return { chance: 0, reason: "" };
  const o = ownerStyle(league, teamId);
  const r = recordOf(league, teamId);
  const expected = expectedWinShare(league, teamId);
  const below = expected - winShare(r);
  const dry = drought(league, teamId) + (inPlayoffs.has(teamId) ? 0 : 1);
  const losing = losingSeasonsInRow(league, teamId) + (r.wins < r.losses ? 1 : 0);
  const dead = deadShare(league, teamId);
  const t = gmTenure(league, gm);
  let logOdds =
    G.base +
    G.perWinShareBelow * below +
    G.perDroughtSeason * Math.max(0, dry - 2) +
    G.perLosingSeasonInRow * Math.max(0, losing - 1) -
    G.impatience * o.patience +
    G.ambition * o.ambition +
    extra;
  if (dead > G.capHellShare) logOdds += G.capHell;
  if (gm.contractThrough !== null && gm.contractThrough <= league.season) logOdds += G.contractUp;
  if (t <= 2) logOdds += G.grace[t - 1]!;
  if (inPlayoffs.has(teamId)) logOdds += G.playoffs;
  const reasons = [`${r.wins}-${r.losses}${r.ties ? `-${r.ties}` : ""}`];
  if (below > 0.05)
    reasons.push(`${Math.round(below * 17 * 10) / 10} wins below what the roster should have won`);
  if (dry >= 3) reasons.push(`${dry} seasons without the playoffs`);
  if (losing >= 2) reasons.push(`${losing} losing seasons in a row`);
  if (dead > G.capHellShare) reasons.push(`${Math.round(dead * 100)}% of the cap in dead money`);
  const traits = describeOwner(o);
  return {
    chance: dmath.logistic(logOdds),
    reason: `${reasons.join("; ")}.${traits.length ? ` The owner: ${traits.join(", ").toLowerCase()}.` : ""}`,
  };
}

/** Black Monday: each owner judges his GM; fired GMs are replaced at once. */
export function ownerReviews(league: League, inPlayoffs: Set<string>): void {
  for (const team of [...league.teams].sort((a, b) => a.id.localeCompare(b.id))) {
    const gm = gmOf(league, team.id);
    if (!gm) {
      hireGm(league, team.id, "The job was open.");
      continue;
    }
    // The person is judged by the same odds, plus the owner's view of his moves (Phase 14b).
    if (gm.person) {
      if (reviewPerson(league, inPlayoffs)) hireGm(league, team.id, `Replaces ${name(gm)}.`);
      continue;
    }
    const odds = gmFiringOdds(league, team.id, inPlayoffs);
    if (!rng(league, `gm:${team.id}`).chance(odds.chance)) continue;
    fireGm(league, gm, odds.reason);
    hireGm(league, team.id, `Replaces ${name(gm)}.`);
  }
  // A person out of work hears from owners now (Phase 14b).
  offersAfterReviews(league);
}

/** After an in-season head-coach firing: the owner sometimes cleans house. */
export function ownerAfterCoachFiring(league: League, teamId: string, week: number): void {
  const gm = gmOf(league, teamId);
  if (!gm || gm.person || gmTenure(league, gm) < OWNERS.inSeasonGm.minTenure) return;
  const o = ownerStyle(league, teamId);
  const chance = OWNERS.inSeasonGm.base + OWNERS.inSeasonGm.impatience * Math.max(0, -o.patience);
  if (!rng(league, `in-season-gm:${teamId}:${week}`).chance(chance)) return;
  fireGm(
    league,
    gm,
    `Fired with the head coach after week ${week}: the owner wanted a fresh start.`,
  );
  hireGm(league, teamId, `Takes over during the season after ${name(gm)} was fired.`, false);
}

function fireGm(league: League, gm: Executive, reason: string): void {
  const teamId = gm.teamId!;
  gm.career.push({
    season: league.season,
    teamId,
    role: "GM",
    record: recordOf(league, teamId),
    playoffs: false,
  });
  log(league, {
    kind: "fired",
    executiveId: gm.id,
    teamId,
    role: "GM",
    text: `${teamName(league, teamId)} fired general manager ${name(gm)}.`,
    reason,
  });
  gm.reputation = Math.max(0, gm.reputation + OWNERS.reputation.fired);
  gm.teamId = null;
  gm.contractThrough = null;
}

/** How a candidate suits an owner (ambitious owners like win-now GMs; patient ones builders). */
function fit(league: League, teamId: string, c: Executive): number {
  const o = ownerStyle(league, teamId);
  const g = c.gm!;
  return o.ambition * g.futureDiscount - o.patience * g.futureDiscount + o.budget * g.capAggression;
}

/** New GMs from the personnel ranks (generated, fictional). */
function newcomers(league: League, teamId: string): Executive[] {
  const O = OWNERS;
  const r = rng(league, `newcomers:${teamId}:${league.date}`);
  const names = new NamePicker(r);
  for (const e of league.executives) names.reserve(name(e));
  return Array.from({ length: O.newcomers }, () => {
    const archetype = r.pick(GM_ARCHETYPES);
    const gm = drawGm(r, archetype);
    gm.skill = Math.round(
      Math.max(20, Math.min(95, r.gaussian(O.newcomerSkill.mean, O.newcomerSkill.sd))),
    );
    const age = r.intBetween(O.newcomerAge[0], O.newcomerAge[1]);
    return {
      id: -1,
      ...names.next(),
      role: "GM" as const,
      teamId: null,
      birthDate: addDays(
        `${Number(league.date.slice(0, 4)) - age}${league.date.slice(4)}`,
        -r.int(365),
      ),
      gm,
      owner: null,
      hiredSeason: league.season + 1,
      contractThrough: null,
      reputation: O.newcomerReputation,
      career: [],
      retiredAfter: null,
      person: false,
    };
  });
}

/**
 * The owner hires a GM: the best of the out-of-work GMs and a few newcomers, by skill,
 * reputation and fit. A new GM may replace a head coach he didn't hire (`mayReplaceCoach`).
 */
export function hireGm(
  league: League,
  teamId: string,
  why: string,
  mayReplaceCoach = true,
): Executive {
  const O = OWNERS;
  // A club never takes back the general manager it just fired (this season's or last).
  const justFired = new Set(
    league.executiveMoves
      .filter((m) => m.kind === "fired" && m.teamId === teamId && m.season >= league.season - 1)
      .map((m) => m.executiveId),
  );
  const pool = league.executives
    .filter(
      (e) =>
        e.role === "GM" &&
        e.teamId === null &&
        e.retiredAfter === null &&
        e.gm &&
        !justFired.has(e.id),
    )
    .sort((a, b) => b.reputation - a.reputation || a.id - b.id)
    .slice(0, O.candidates);
  const fresh = newcomers(league, teamId);
  const candidates = [...pool, ...fresh];
  const score = (c: Executive) =>
    O.score.skill * c.gm!.skill +
    O.score.reputation * c.reputation +
    O.score.fit * fit(league, teamId, c) +
    O.score.taste *
      (uniformFrom(`${league.meta.seed}:gm-taste:${teamId}:${c.firstName}${c.lastName}`) * 2 - 1);
  const pick = [...candidates].sort(
    (a, b) => score(b) - score(a) || a.lastName.localeCompare(b.lastName),
  )[0]!;
  if (pick.id < 0) {
    pick.id = league.nextIds.executive++;
    league.executives.push(pick);
  }
  const r = rng(league, `gm-contract:${teamId}:${league.date}`);
  pick.teamId = teamId;
  pick.hiredSeason = league.season + (league.calendar.stage === "regular" ? 0 : 1);
  pick.contractThrough =
    pick.hiredSeason + r.intBetween(O.contractYears[0], O.contractYears[1]) - 1;
  const background = pick.career.length > 0 ? "a GM before" : "from the personnel ranks";
  log(league, {
    kind: "hired",
    executiveId: pick.id,
    teamId,
    role: "GM",
    text: `${teamName(league, teamId)} hired ${name(pick)} as general manager (${ARCHETYPE_LABELS[archetypeOf(pick.gm!)].toLowerCase()}).`,
    reason: `${why} The owner's pick of ${candidates.length} candidates: ${background}, judging skill ${pick.gm!.skill}, reputation ${pick.reputation}.`,
  });
  // A new GM may want his own head coach (more likely after a losing season).
  if (mayReplaceCoach) {
    const hc = league.coaches.find((c) => c.teamId === teamId && c.role === "HC");
    if (hc && !hc.interim) {
      const r2 = recordOf(league, teamId);
      const chance = O.newGmNewCoach * (r2.wins < r2.losses ? 1.5 : 0.7);
      if (rng(league, `new-gm-coach:${teamId}`).chance(chance) && tenure(league, hc) >= 1)
        release(
          league,
          hc,
          "left",
          `The new general manager, ${name(pick)}, wanted his own head coach.`,
        );
    }
  }
  return pick;
}

/**
 * At the season's end: career lines, reputations, contracts renewed, retirements (a retiring
 * GM's team hires a new one), and long-idle GMs retire.
 */
export function executivesSeasonEnd(
  league: League,
  playoffTeams: Set<string>,
  champion: string | null,
): void {
  const O = OWNERS;
  const season = league.season;
  for (const gm of league.executives.filter((e) => e.role === "GM" && e.retiredAfter === null)) {
    if (gm.teamId === null) {
      // The person's career ends when he says so (Phase 14).
      if (gm.person) continue;
      const last = gm.career.at(-1)?.season ?? gm.hiredSeason - 1;
      if (season - last >= O.retirement.idleSeasons) {
        gm.retiredAfter = season;
        log(league, {
          kind: "retired",
          executiveId: gm.id,
          teamId: null,
          role: "GM",
          text: `${name(gm)} retired from front-office work.`,
          reason: `Out of a GM job for ${season - last} seasons.`,
        });
      }
      continue;
    }
    const teamId = gm.teamId;
    const r = recordOf(league, teamId);
    const playoffs = playoffTeams.has(teamId);
    gm.career.push({ season, teamId, role: "GM", record: r, playoffs });
    const R = O.reputation;
    let rep =
      gm.reputation + (winShare(r) - expectedWinShare(league, teamId)) * 100 * R.perWinAbove;
    if (playoffs) rep += R.playoffs;
    if (champion === teamId) rep += R.title;
    rep += (50 - rep) * R.drift;
    gm.reputation = Math.round(Math.max(0, Math.min(100, rep)));
    // Contracts: the owner kept him through Black Monday, so a deal that ran out is renewed.
    if (gm.contractThrough !== null && gm.contractThrough <= season)
      gm.contractThrough = season + O.contractYears[0] - 1;
    // Retirement: odds rise with age.
    const age = ageOn(gm.birthDate, league.date);
    const odds = dmath.logistic((age - O.retirement.evenOddsAge) / O.retirement.yearsPerStep);
    if (!gm.person && rng(league, `retire:${gm.id}`).chance(odds)) {
      gm.retiredAfter = season;
      gm.teamId = null;
      gm.contractThrough = null;
      log(league, {
        kind: "retired",
        executiveId: gm.id,
        teamId,
        role: "GM",
        text: `${teamName(league, teamId)} general manager ${name(gm)} retired at ${age}.`,
        reason: `After ${gm.career.filter((c) => c.teamId !== null).length} seasons running teams.`,
      });
      hireGm(league, teamId, `Replaces ${name(gm)}, who retired.`, false);
    }
  }
  // Owners get a line too (their team's record), for their pages.
  for (const o of league.executives.filter((e) => e.role === "owner" && e.teamId)) {
    o.career.push({
      season,
      teamId: o.teamId,
      role: "owner",
      record: recordOf(league, o.teamId!),
      playoffs: playoffTeams.has(o.teamId!),
    });
  }
}
