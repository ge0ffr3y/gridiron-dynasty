/**
 * The coaching carousel (Phase 10b). Each season:
 * - rarely, a struggling head coach is fired during the season; a coordinator
 *   takes over as interim and a position coach steps up behind him;
 * - on "Black Monday", the day after the regular season, head coaches whose
 *   teams fell short of what their rosters should have won are fired, and
 *   coordinators whose units ranked near the bottom sometimes are;
 * - teams with openings interview candidates (other teams' coordinators and
 *   position coaches, coaches out of work, new faces) under the league's
 *   interview rules (rules.staff), and hire as each playoff round ends: a
 *   coach can't sign until his own season is over, and a team may wait for a
 *   candidate still in the playoffs;
 * - a new head coach keeps or replaces each coordinator; promotions open jobs
 *   below; everything left is filled before the new League Year.
 * Coaches build careers (one line a season, with the head coach they worked
 * under: the coaching tree), reputations, and skills, and they retire.
 * Every move records its reason. Every draw is seeded by the season, team and
 * coach, so results never depend on the order things are done in.
 */
import { addDays, ageOn, dmath, Rng, streamSeed, type LeagueDate } from "@fgm/foundation";
import { generateCoach } from "../generate/coaches";
import { NamePicker } from "../generate/people";
import type { Coach, CoachRole, CoachingMove, League } from "../league/schema";
import { seasonDates } from "../season/calendar";
import { currentStandings, starterStrengths } from "../season/flow";
import { loserOf } from "../season/playoffs";
import {
  CAREERS,
  CAROUSEL,
  COACH_AGE_FALLBACK,
  ROLE_FOCUS,
  ROLE_NAMES,
  STAFF_ROLES,
} from "./config";

const C = CAROUSEL;
const name = (c: Coach) => `${c.firstName} ${c.lastName}`;
const OFFENSE_FEEDERS: CoachRole[] = ["SKILL", "OLC"];
const DEFENSE_FEEDERS: CoachRole[] = ["FRONT", "DBC"];

function rng(league: League, label: string): Rng {
  return new Rng(streamSeed(league.meta.seed, `carousel:${league.season}:${label}`));
}

function log(
  league: League,
  move: Omit<CoachingMove, "season" | "date">,
  date = league.date,
): void {
  league.coachingMoves.push({ season: league.season, date, ...move });
}

function teamName(league: League, teamId: string | null): string {
  const t = league.teams.find((x) => x.id === teamId);
  return t ? `${t.city} ${t.nickname}` : "no team";
}

// --- Records and expectations -----------------------------------------------------------

/** A team's regular-season record so far this season. */
export function recordOf(
  league: League,
  teamId: string,
): { wins: number; losses: number; ties: number } {
  const r = { wins: 0, losses: 0, ties: 0 };
  for (const g of league.games) {
    if (g.round !== "regular" || !g.result || (g.homeId !== teamId && g.awayId !== teamId))
      continue;
    const mine = g.homeId === teamId ? g.result.homeScore : g.result.awayScore;
    const theirs = g.homeId === teamId ? g.result.awayScore : g.result.homeScore;
    if (mine > theirs) r.wins += 1;
    else if (mine < theirs) r.losses += 1;
    else r.ties += 1;
  }
  return r;
}

const winShare = (r: { wins: number; losses: number; ties: number }) => {
  const n = r.wins + r.losses + r.ties;
  return n === 0 ? 0.5 : (r.wins + r.ties / 2) / n;
};

/**
 * What a team's roster should win: its starters' strength against the league's, as a win share.
 * Measured once per league date and remembered (the carousel asks for every team, many times).
 */
const strengthCache = new WeakMap<League, { key: string; strengths: Map<string, number> }>();
export function expectedWinShare(league: League, teamId: string): number {
  const key = `${league.season}:${league.date}:${league.calendar.stage}:${league.calendar.week}`;
  let cached = strengthCache.get(league);
  if (!cached || cached.key !== key) {
    cached = { key, strengths: starterStrengths(league) };
    strengthCache.set(league, cached);
  }
  const strengths = cached.strengths;
  const values = [...strengths.values()];
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const sd =
    Math.sqrt(values.reduce((a, b) => a + (b - mean) * (b - mean), 0) / values.length) || 1;
  return Math.max(
    0.15,
    Math.min(0.85, 0.5 + ((strengths.get(teamId)! - mean) / sd) * EXPECTATION_PER_SD),
  );
}
/** Win share per standard deviation of roster strength (about what real rosters show; judgment). */
const EXPECTATION_PER_SD = 0.12;

/** Losing seasons in a row for a team, ending with the last finished one. */
function losingSeasonsInRow(league: League, teamId: string): number {
  let n = 0;
  for (let i = league.history.length - 1; i >= 0; i--) {
    const s = league.history[i]!.standings.find((x) => x.teamId === teamId);
    if (!s || s.wins >= s.losses) break;
    n += 1;
  }
  return n;
}

/** Seasons a coach has been in his current job with his current team (counting this one). */
function tenure(league: League, c: Coach): number {
  let n = 1;
  for (let i = c.career.length - 1; i >= 0; i--) {
    const e = c.career[i]!;
    if (e.season >= league.season) continue;
    if (e.teamId !== c.teamId || e.role !== c.role) break;
    n += 1;
  }
  return n;
}

/** Is a team's season over (out of the playoffs, or never in them, once the regular season ends)? */
export function seasonOver(league: League, teamId: string | null): boolean {
  if (teamId === null) return true;
  const stage = league.calendar.stage;
  if (stage === "complete" || stage === "offseason") return true;
  if (!["wildcard", "divisional", "conference", "championship"].includes(stage)) return false;
  const seeded = currentStandings(league).seed.has(teamId);
  if (!seeded) return true;
  return league.games.some(
    (g) => g.round !== "regular" && g.round !== "preseason" && g.result && loserOf(g) === teamId,
  );
}

/** The date of a team's last game so far. */
function lastGameDate(league: League, teamId: string): LeagueDate {
  let last = league.date;
  for (const g of league.games)
    if (g.result && (g.homeId === teamId || g.awayId === teamId) && g.date > last) last = g.date;
  return last;
}

// --- Careers ------------------------------------------------------------------------------

/** One line of a coach's career for this season (once). */
function careerLine(league: League, c: Coach, teamId: string | null, role: CoachRole): void {
  if (c.career.some((e) => e.season === league.season && e.teamId === teamId && e.role === role))
    return;
  const hc =
    teamId && role !== "HC"
      ? league.coaches.find((x) => x.teamId === teamId && x.role === "HC")
      : undefined;
  c.career.push({
    season: league.season,
    teamId,
    role,
    underId: hc ? hc.id : null,
    record: role === "HC" && teamId ? recordOf(league, teamId) : null,
  });
}

/** At a season's end: every coach's line, and reputations moved by the season's results. */
export function recordStaffSeason(league: League): void {
  const last = league.history.at(-1);
  const R = C.reputation;
  // Units' ranks: points scored and allowed, 1 = best.
  const byPoints = (key: "pointsFor" | "pointsAgainst", best: 1 | -1) =>
    new Map(
      [...(last?.standings ?? [])]
        .sort((a, b) => best * (b[key] - a[key]) || a.teamId.localeCompare(b.teamId))
        .map((s, i) => [s.teamId, i + 1]),
    );
  const offenseRank = byPoints("pointsFor", 1);
  const defenseRank = byPoints("pointsAgainst", -1);
  const teams = league.teams.length;
  for (const c of [...league.coaches].sort((a, b) => a.id - b.id)) {
    if (c.retiredAfter !== null || c.teamId === null) continue;
    careerLine(league, c, c.teamId, c.role);
    let rep = c.reputation;
    if (c.role === "HC" && last) {
      const s = last.standings.find((x) => x.teamId === c.teamId)!;
      const games = s.wins + s.losses + s.ties;
      rep +=
        (s.wins + s.ties / 2 - expectedWinShare(league, c.teamId) * games) * R.perWinAboveExpected;
      if (s.seed !== null) rep += R.playoffs;
      if (last.championId === c.teamId) rep += R.title;
    }
    if (c.role === "OC") rep += ((teams + 1) / 2 - offenseRank.get(c.teamId)!) * R.unitPerRank;
    if (c.role === "DC") rep += ((teams + 1) / 2 - defenseRank.get(c.teamId)!) * R.unitPerRank;
    rep += (50 - rep) * R.drift;
    c.reputation = Math.round(Math.max(0, Math.min(100, rep)));
  }
}

/** A coach leaves his job (fired, or out at a new head coach's choice). */
function release(league: League, c: Coach, kind: "fired" | "left", reason: string): void {
  const teamId = c.teamId!;
  careerLine(league, c, teamId, c.role);
  log(league, {
    kind,
    coachId: c.id,
    teamId,
    role: c.role,
    text: `${teamName(league, teamId)} ${kind === "fired" ? "fired" : "parted ways with"} ${ROLE_NAMES[c.role].toLowerCase()} ${name(c)}.`,
    reason,
  });
  if (kind === "fired") c.reputation = Math.max(0, c.reputation + C.reputation.fired);
  c.teamId = null;
  c.contractThrough = null;
  c.interim = false;
}

function contractFor(league: League, role: CoachRole, r: Rng): number {
  const span =
    CAREERS.contractYears[role === "HC" || role === "OC" || role === "DC" ? role : "other"];
  return league.season + r.intBetween(span[0], span[1]);
}

/** A coach takes a job (a hire or a promotion). */
function take(
  league: League,
  c: Coach,
  teamId: string,
  role: CoachRole,
  kind: "hired" | "promoted",
  reason: string,
  date = league.date,
): void {
  const from = c.teamId;
  const fromRole = c.role;
  if (from !== null && (from !== teamId || fromRole !== role))
    careerLine(league, c, from, fromRole);
  c.teamId = teamId;
  c.role = role;
  c.interim = false;
  // A season that hasn't started yet counts in the contract.
  c.contractThrough = contractFor(league, role, rng(league, `contract:${c.id}`));
  if (from !== null && fromRole !== role)
    c.reputation = Math.min(100, c.reputation + C.reputation.promoted);
  const was =
    from === null
      ? ""
      : from === teamId
        ? `, promoted from ${ROLE_NAMES[fromRole].toLowerCase()}`
        : ` from the ${teamName(league, from)} (${ROLE_NAMES[fromRole].toLowerCase()})`;
  log(
    league,
    {
      kind,
      coachId: c.id,
      teamId,
      role,
      text: `${teamName(league, teamId)} ${kind === "promoted" ? "promoted" : "hired"} ${name(c)} as ${ROLE_NAMES[role].toLowerCase()}${was}.`,
      reason,
    },
    date,
  );
}

// --- Firing ---------------------------------------------------------------------------------

function firingReason(
  league: League,
  teamId: string,
  r: { wins: number; losses: number; ties: number },
  expected: number,
  streak: number,
): string {
  const games = r.wins + r.losses + r.ties;
  const short = Math.round((expected * games - (r.wins + r.ties / 2)) * 10) / 10;
  const parts = [`${r.wins}-${r.losses}${r.ties ? `-${r.ties}` : ""}`];
  if (short > 0.5) parts.push(`${short} wins below what the roster should have won`);
  if (streak >= 2) parts.push(`${streak} losing seasons in a row`);
  return parts.join("; ") + ".";
}

/** During the season, after a week's games: rarely, a head coach far below expectations goes. */
export function inSeasonFirings(league: League, week: number): void {
  if (week < C.inSeason.fromWeek || week > C.inSeason.toWeek) return;
  for (const team of league.teams) {
    const hc = league.coaches.find((c) => c.teamId === team.id && c.role === "HC");
    if (!hc || hc.interim || tenure(league, hc) <= 1) continue;
    const r = recordOf(league, team.id);
    const games = r.wins + r.losses + r.ties;
    if (games < 3) continue;
    const below = expectedWinShare(league, team.id) - winShare(r);
    const weight = Math.min(1, games / 8);
    const chance = dmath.logistic(C.inSeason.base + C.inSeason.perWinShareBelow * below * weight);
    if (!rng(league, `in-season:${week}:${team.id}`).chance(chance)) continue;
    release(
      league,
      hc,
      "fired",
      `In-season firing after week ${week}: ${firingReason(league, team.id, r, expectedWinShare(league, team.id), losingSeasonsInRow(league, team.id))}`,
    );
    namedInterim(league, team.id);
  }
}

/** A coordinator takes over as interim head coach, and a position coach steps up behind him. */
function namedInterim(league: League, teamId: string): void {
  const staff = league.coaches.filter((c) => c.teamId === teamId);
  const coords = staff
    .filter((c) => c.role === "OC" || c.role === "DC")
    .sort((a, b) => b.ratings.leadership - a.ratings.leadership || a.id - b.id);
  const interim = coords[0];
  if (!interim) return;
  const vacated = interim.role;
  careerLine(league, interim, teamId, vacated);
  interim.role = "HC";
  interim.interim = true;
  log(league, {
    kind: "interim",
    coachId: interim.id,
    teamId,
    role: "HC",
    text: `${name(interim)} (${ROLE_NAMES[vacated].toLowerCase()}) is the ${teamName(league, teamId)}' interim head coach.`,
    reason: `The staff's most respected leader (leadership ${interim.ratings.leadership}).`,
  });
  // His side's best position coach calls the plays for the rest of the season.
  const feeders = vacated === "OC" ? OFFENSE_FEEDERS : DEFENSE_FEEDERS;
  const skill = (c: Coach) => (vacated === "OC" ? c.ratings.offense : c.ratings.defense);
  const step = staff
    .filter((c) => feeders.includes(c.role))
    .sort((a, b) => skill(b) - skill(a) || a.id - b.id)[0];
  if (step) {
    const old = step.role;
    take(
      league,
      step,
      teamId,
      vacated,
      "promoted",
      `Calls the ${vacated === "OC" ? "offense" : "defense"} for the rest of the season (${vacated === "OC" ? "offense" : "defense"} ${skill(step)}).`,
    );
    fillWithNewcomer(league, teamId, old, "Fills the job left by a promotion.");
  }
}

/** Black Monday, the day after the regular season: head coaches and coordinators let go. */
export function blackMonday(league: League): void {
  const day = addDays(seasonDates(league.rules, league.season).weekSundays.at(-1)!, 1);
  // Every move today is dated Black Monday (the calendar itself stays on the last Sunday).
  const sunday = league.date;
  league.date = sunday < day ? day : sunday;
  try {
    blackMondayMoves(league);
  } finally {
    league.date = sunday;
  }
}

function blackMondayMoves(league: League): void {
  for (const team of [...league.teams].sort((a, b) => a.id.localeCompare(b.id))) {
    const hc = league.coaches.find((c) => c.teamId === team.id && c.role === "HC");
    if (!hc) continue;
    const r = recordOf(league, team.id);
    const expected = expectedWinShare(league, team.id);
    const streak = losingSeasonsInRow(league, team.id) + (r.wins < r.losses ? 1 : 0);
    if (hc.interim) {
      // An interim coach usually isn't kept.
      if (rng(league, `interim:${team.id}`).chance(C.interimKept)) {
        hc.interim = false;
        hc.contractThrough = contractFor(league, "HC", rng(league, `contract:${hc.id}`));
        log(league, {
          kind: "hired",
          coachId: hc.id,
          teamId: team.id,
          role: "HC",
          text: `${teamName(league, team.id)} kept interim coach ${name(hc)} as head coach.`,
          reason: `${r.wins}-${r.losses} after taking over; the job is his.`,
        });
      } else
        release(
          league,
          hc,
          "left",
          `The interim job ends with the season (${r.wins}-${r.losses}).`,
        );
      continue;
    }
    const F = C.firing;
    const t = tenure(league, hc);
    const playoffs = currentStandings(league).seed.has(team.id);
    let logOdds =
      F.base +
      F.perWinShareBelow * (expected - winShare(r)) +
      F.perLosingSeasonInRow * Math.max(0, streak - 1);
    if (t <= 2) logOdds += F.newCoachGrace[t - 1]!;
    if (playoffs) logOdds += F.playoffs;
    if (hc.contractThrough !== null && hc.contractThrough <= league.season) logOdds += F.contractUp;
    if (rng(league, `fire:${team.id}`).chance(dmath.logistic(logOdds))) {
      release(league, hc, "fired", firingReason(league, team.id, r, expected, streak));
      continue;
    }
    // Coordinators whose units ranked near the bottom are sometimes let go.
    for (const role of ["OC", "DC"] as const) {
      const c = league.coaches.find((x) => x.teamId === team.id && x.role === role);
      if (!c) continue;
      const rank = unitRank(league, team.id, role);
      const fromBottom = rank - league.teams.length / 2;
      const chance = dmath.logistic(
        C.coordinatorFiring.base + C.coordinatorFiring.perRankFromBottom * fromBottom,
      );
      if (fromBottom > 0 && rng(league, `fire-${role}:${team.id}`).chance(chance)) {
        release(
          league,
          c,
          "fired",
          `The ${role === "OC" ? "offense" : "defense"} ranked ${rank} of ${league.teams.length} in points ${role === "OC" ? "scored" : "allowed"}.`,
        );
      }
    }
  }
  interviewForOpenings(league);
  hiringRound(league, false);
}

/** A unit's rank this season in points scored (offense) or allowed (defense), 1 = best. */
function unitRank(league: League, teamId: string, role: "OC" | "DC"): number {
  const points = new Map<string, [number, number]>();
  for (const g of league.games) {
    if (g.round !== "regular" || !g.result) continue;
    for (const [id, f, a] of [
      [g.homeId, g.result.homeScore, g.result.awayScore],
      [g.awayId, g.result.awayScore, g.result.homeScore],
    ] as [string, number, number][]) {
      const p = points.get(id) ?? [0, 0];
      points.set(id, [p[0] + f, p[1] + a]);
    }
  }
  const sorted = [...points].sort((a, b) =>
    role === "OC"
      ? b[1][0] - a[1][0] || a[0].localeCompare(b[0])
      : a[1][1] - b[1][1] || a[0].localeCompare(b[0]),
  );
  return sorted.findIndex(([id]) => id === teamId) + 1;
}

// --- Hiring ---------------------------------------------------------------------------------

interface Opening {
  teamId: string;
  role: CoachRole;
}

/** Jobs a team is missing (an interim head coach counts as an opening). */
export function openings(league: League): Opening[] {
  const out: Opening[] = [];
  for (const team of league.teams) {
    for (const { role, count } of STAFF_ROLES) {
      const have = league.coaches.filter(
        (c) => c.teamId === team.id && c.role === role && !c.interim,
      ).length;
      for (let i = have; i < count; i++) out.push({ teamId: team.id, role });
    }
  }
  return out;
}

const SIDE_FEEDERS: Partial<Record<CoachRole, CoachRole[]>> = {
  OC: OFFENSE_FEEDERS,
  DC: DEFENSE_FEEDERS,
};

/** Could this coach take this job (ignoring timing)? */
function eligible(league: League, c: Coach, o: Opening): boolean {
  if (c.retiredAfter !== null || (c.teamId === o.teamId && c.role === o.role && !c.interim))
    return false;
  const age = ageOn(c.birthDate, league.date);
  if (age > 68) return false;
  const past = new Set(c.career.map((e) => e.role));
  if (o.role === "HC") {
    if (c.teamId === null)
      return (
        past.has("HC") ||
        past.has("OC") ||
        past.has("DC") ||
        c.role === "HC" ||
        c.role === "OC" ||
        c.role === "DC"
      );
    return (
      ((c.role === "OC" || c.role === "DC") && !c.interim) || (c.interim && c.teamId === o.teamId)
    );
  }
  const feeders = SIDE_FEEDERS[o.role];
  if (feeders) {
    if (c.teamId === null)
      return (
        c.role === o.role ||
        feeders.includes(c.role) ||
        past.has(o.role) ||
        (c.role === "HC" &&
          (o.role === "OC" ? c.offensiveScheme !== null : c.defensiveScheme !== null))
      );
    // A promotion: another team's (or his own team's) position coach on that side.
    return feeders.includes(c.role);
  }
  // Other jobs: coaches out of work in that job.
  return c.teamId === null && c.role === o.role;
}

/** How a team rates a candidate for a job (its own taste included). */
function score(league: League, c: Coach, o: Opening): number {
  const taste = rng(league, `taste:${o.teamId}:${o.role}:${c.id}`).gaussian(0, C.taste);
  const r = c.ratings;
  if (o.role === "HC") {
    const W = C.headCoachScore;
    const calling = Math.max(r.offense, r.defense);
    return (
      W.leadership * r.leadership +
      W.gameManagement * r.gameManagement +
      W.playCalling * calling +
      W.reputation * c.reputation +
      taste
    );
  }
  if (o.role === "OC" || o.role === "DC") {
    const W = C.coordinatorScore;
    return (
      W.playCalling * (o.role === "OC" ? r.offense : r.defense) +
      W.development * r.development +
      W.reputation * c.reputation +
      taste
    );
  }
  return r[ROLE_FOCUS[o.role]] + taste;
}

/** The candidates for an opening, best first (new faces added so there's always a field). */
function candidates(league: League, o: Opening): { c: Coach; score: number }[] {
  return league.coaches
    .filter((c) => eligible(league, c, o))
    .map((c) => ({ c, score: score(league, c, o) }))
    .sort((a, b) => b.score - a.score || a.c.id - b.c.id);
}

/** Adds new faces to the pool for head-coach and coordinator searches. */
function addNewcomers(league: League, o: Opening): void {
  const r = rng(league, `newcomers:${o.teamId}:${o.role}`);
  const names = new NamePicker(r);
  for (const c of league.coaches) names.reserve(`${c.firstName} ${c.lastName}`);
  // Only when the field is thin: the league's own coaches come first.
  const field = league.coaches.filter((c) => eligible(league, c, o)).length;
  const add = Math.max(0, Math.min(C.newcomersPerOpening, C.minimumField - field));
  for (let i = 0; i < add; i++) {
    // Head-coach searches look at college coaches and coordinators; coordinator searches at
    // position coaches from the college and assistant ranks.
    const role: CoachRole =
      o.role === "HC"
        ? r.chance(0.5)
          ? "OC"
          : "DC"
        : o.role === "OC"
          ? r.pick(OFFENSE_FEEDERS)
          : o.role === "DC"
            ? r.pick(DEFENSE_FEEDERS)
            : o.role;
    const c = generateCoach(
      r,
      names,
      league.date,
      league.nextIds.coach++,
      null,
      role,
      COACH_AGE_FALLBACK[role],
    );
    c.contractThrough = null;
    league.coaches.push(c);
  }
}

/** Interviews for every head-coach and coordinator opening: the team's top candidates, dated by the rules. */
function interviewForOpenings(league: League): void {
  const R = league.rules.staff;
  for (const o of openings(league)) {
    if (o.role !== "HC" && o.role !== "OC" && o.role !== "DC") continue;
    if (
      league.coachingMoves.some(
        (m) =>
          m.season === league.season &&
          m.kind === "interviewed" &&
          m.teamId === o.teamId &&
          m.role === o.role,
      )
    )
      continue;
    addNewcomers(league, o);
    for (const { c } of candidates(league, o).slice(0, C.interviews)) {
      // Coaches under contract elsewhere: virtual interviews from a few days after their last game.
      const date =
        c.teamId === null || c.teamId === o.teamId
          ? league.date
          : maxDate(
              league.date,
              addDays(lastGameDate(league, c.teamId), R.interviewDaysAfterLastGame),
            );
      log(
        league,
        {
          kind: "interviewed",
          coachId: c.id,
          teamId: o.teamId,
          role: o.role,
          text: `${teamName(league, o.teamId)} interviewed ${name(c)} (${c.teamId ? `${ROLE_NAMES[c.role].toLowerCase()}, ${teamName(league, c.teamId)}` : "out of work"}) for ${ROLE_NAMES[o.role].toLowerCase()}.`,
          reason: `${c.teamId ? `${ROLE_NAMES[c.role]}, ${c.teamId}` : "Out of work"}; ${c.teamId === null || c.teamId === o.teamId || seasonOver(league, c.teamId) ? "in person" : "virtual (his team is still playing)"}; reputation ${c.reputation}.`,
        },
        date,
      );
    }
  }
}

const maxDate = (a: LeagueDate, b: LeagueDate) => (a > b ? a : b);

/**
 * One round of hiring: each opening takes its best candidate whose season is over (a coach can't
 * sign until then), unless a clearly better one is still in the playoffs and this isn't the final
 * round. Two teams after one coach: he picks the stronger program. Head coaches first, then
 * coordinators (a new head coach decides whom to keep), then everything else in the final round.
 */
export function hiringRound(league: League, final: boolean): void {
  for (const role of ["HC", "OC", "DC"] as const) {
    // Searches that opened since the last round interview first.
    interviewForOpenings(league);
    fillRole(league, role, final);
  }
  if (!final) return;
  for (const { role } of STAFF_ROLES) {
    if (role === "HC" || role === "OC" || role === "DC") continue;
    fillRole(league, role, true);
  }
}

function fillRole(league: League, role: CoachRole, final: boolean): void {
  for (let pass = 0; pass < 6; pass++) {
    const open = openings(league).filter((o) => o.role === role);
    if (open.length === 0) return;
    const wants = new Map<number, { o: Opening; score: number }[]>();
    for (const o of open) {
      const list = candidates(league, o);
      const ready = list.filter((x) => seasonOver(league, x.c.teamId));
      let pick = ready[0];
      if (!pick && (final || role !== "HC")) {
        addNewcomers(league, o);
        pick = candidates(league, o).find((x) => seasonOver(league, x.c.teamId));
      }
      if (!pick) continue;
      // Wait for a clearly better candidate who's still coaching in the playoffs.
      if (
        !final &&
        role === "HC" &&
        list[0] &&
        list[0] !== pick &&
        list[0].score > pick.score + C.waitMargin
      )
        continue;
      const entry = wants.get(pick.c.id) ?? [];
      entry.push({ o, score: pick.score });
      wants.set(pick.c.id, entry);
    }
    if (wants.size === 0) return;
    for (const [coachId, offers] of [...wants].sort((a, b) => a[0] - b[0])) {
      const c = league.coaches.find((x) => x.id === coachId)!;
      // He takes the best program: last season's record, then the team's own rating of him.
      const best = offers.sort(
        (a, b) =>
          attractiveness(league, b.o.teamId) - attractiveness(league, a.o.teamId) ||
          b.score - a.score,
      )[0]!;
      hire(league, c, best.o);
    }
  }
}

/** How appealing a job is: the team's record this season and its roster. */
function attractiveness(league: League, teamId: string): number {
  return winShare(recordOf(league, teamId)) + expectedWinShare(league, teamId);
}

function hire(league: League, c: Coach, o: Opening): void {
  const from = c.teamId;
  const interview = league.coachingMoves.find(
    (m) =>
      m.season === league.season &&
      m.kind === "interviewed" &&
      m.coachId === c.id &&
      m.teamId === o.teamId,
  );
  const why =
    o.role === "HC"
      ? `Leadership ${c.ratings.leadership}, game management ${c.ratings.gameManagement}, reputation ${c.reputation}.`
      : o.role === "OC" || o.role === "DC"
        ? `${o.role === "OC" ? "Offense" : "Defense"} ${o.role === "OC" ? c.ratings.offense : c.ratings.defense}, reputation ${c.reputation}.`
        : `${ROLE_FOCUS[o.role]} ${c.ratings[ROLE_FOCUS[o.role]]}.`;
  // A hire comes a few days after his interview (never before it).
  const date = interview
    ? maxDate(league.date, addDays(interview.date, C.hireDaysAfterInterview))
    : league.date;
  take(league, c, o.teamId, o.role, from === o.teamId ? "promoted" : "hired", why, date);
  // A new head coach decides on his coordinators (a job he left behind opens for the next round).
  if (o.role === "HC") newHeadCoachStaff(league, o.teamId, c);
}

/** A new head coach keeps or replaces each coordinator. */
function newHeadCoachStaff(league: League, teamId: string, hc: Coach): void {
  for (const role of ["OC", "DC"] as const) {
    const c = league.coaches.find((x) => x.teamId === teamId && x.role === role);
    if (!c) continue;
    // He replaces his own side's coordinator more often (he runs that side himself).
    const ownSide = role === "OC" ? hc.offensiveScheme !== null : hc.defensiveScheme !== null;
    const keep = C.newHeadCoachKeepsCoordinator * (ownSide ? 0.5 : 1);
    if (!rng(league, `keep:${teamId}:${role}`).chance(keep))
      release(
        league,
        c,
        "left",
        `New head coach ${name(hc)} chose his own ${ROLE_NAMES[role].toLowerCase()}.`,
      );
  }
}

/** A job filled by a new face (after a promotion mid-season, or when nobody is left). */
function fillWithNewcomer(league: League, teamId: string, role: CoachRole, reason: string): void {
  const r = rng(league, `fill:${teamId}:${role}:${league.coaches.length}`);
  const names = new NamePicker(r);
  for (const c of league.coaches) names.reserve(`${c.firstName} ${c.lastName}`);
  const c = generateCoach(
    r,
    names,
    league.date,
    league.nextIds.coach++,
    null,
    role,
    COACH_AGE_FALLBACK[role],
  );
  league.coaches.push(c);
  take(league, c, teamId, role, "hired", reason);
}

// --- The offseason --------------------------------------------------------------------------

/**
 * Before the new League Year: the last openings filled, coaches a year older (skills grow or
 * slip), contracts renewed for those kept, and retirements (by age, or out of work too long).
 */
export function offseasonStaffing(league: League): void {
  hiringRound(league, true);
  const D = C.development;
  const R = C.retirement;
  // Runs when the season is complete, before the calendar turns to the next one.
  const ended = league.season;
  for (const c of [...league.coaches].sort((a, b) => a.id - b.id)) {
    if (c.retiredAfter !== null) continue;
    const r = rng(league, `offseason:${c.id}`);
    const age = ageOn(c.birthDate, league.date);
    const key = ROLE_FOCUS[c.role];
    const change =
      (age < D.growthUntil ? D.growth : 0) -
      (age >= D.declineFrom ? D.decline : 0) +
      r.gaussian(0, D.noise);
    c.ratings[key] = Math.max(1, Math.min(99, Math.round(c.ratings[key] + change)));
    if (c.teamId !== null) c.experience += 1;
    // Out of work too long, or time to step away.
    const idle = c.teamId === null ? idleSeasons(c, ended) : 0;
    const retire =
      idle >= R.idleSeasons ||
      (c.teamId === null && age > 68) ||
      r.chance(dmath.logistic((age - R.evenOddsAge) / R.yearsPerStep));
    if (retire) {
      const teamId = c.teamId;
      if (teamId) careerLine(league, c, teamId, c.role);
      c.teamId = null;
      c.contractThrough = null;
      c.interim = false;
      c.retiredAfter = ended;
      log(league, {
        kind: "retired",
        coachId: c.id,
        teamId,
        role: c.role,
        text: `${name(c)} (${ROLE_NAMES[c.role].toLowerCase()}) retired.`,
        reason: idle >= R.idleSeasons ? `Out of coaching for ${idle} seasons.` : `At ${age}.`,
      });
      continue;
    }
    // Kept on: a new deal when the old one runs out.
    if (c.teamId !== null && (c.contractThrough === null || c.contractThrough <= ended))
      c.contractThrough = contractFor(league, c.role, r);
  }
  // Jobs opened by retirements.
  hiringRound(league, true);
}

function idleSeasons(c: Coach, ended: number): number {
  const lastJob = [...c.career].reverse().find((e) => e.teamId !== null);
  return lastJob ? Math.max(0, ended - lastJob.season) : 1;
}

export { CAREERS };

// --- Screens and the league office --------------------------------------------------------

export interface CarouselCoach {
  id: number;
  name: string;
  role: CoachRole;
  roleName: string;
  teamId: string | null;
}

function coachRef(c: Coach): CarouselCoach {
  return { id: c.id, name: name(c), role: c.role, roleName: ROLE_NAMES[c.role], teamId: c.teamId };
}

export interface CarouselView {
  season: number;
  /** Firings and departures, oldest first. */
  departures: {
    date: string;
    teamId: string | null;
    coach: CarouselCoach;
    role: string;
    kind: string;
    reason: string;
  }[];
  /** Head-coach and coordinator searches: who was interviewed and who got the job. */
  searches: {
    teamId: string;
    role: CoachRole;
    roleName: string;
    interviews: { date: string; coach: CarouselCoach; note: string }[];
    hired: { date: string; coach: CarouselCoach; text: string; reason: string } | null;
  }[];
  /** Every hire and promotion, oldest first. */
  hires: { date: string; teamId: string; text: string; reason: string }[];
  retirements: { coach: CarouselCoach; reason: string }[];
  /** Jobs still open, with the best candidates (and whether each can sign yet). */
  open: {
    teamId: string;
    role: CoachRole;
    roleName: string;
    candidates: { coach: CarouselCoach; reputation: number; available: boolean; age: number }[];
  }[];
}

/** This season's carousel (or an earlier one's moves). */
export function carouselView(league: League, season = league.season): CarouselView {
  const byId = new Map(league.coaches.map((c) => [c.id, c]));
  const moves = league.coachingMoves.filter((m) => m.season === season);
  const searches = new Map<string, CarouselView["searches"][number]>();
  for (const m of moves) {
    if (m.teamId === null || (m.role !== "HC" && m.role !== "OC" && m.role !== "DC")) continue;
    if (m.kind !== "interviewed" && m.kind !== "hired" && m.kind !== "promoted") continue;
    const key = `${m.teamId}|${m.role}`;
    const s = searches.get(key) ?? {
      teamId: m.teamId,
      role: m.role,
      roleName: ROLE_NAMES[m.role],
      interviews: [],
      hired: null,
    };
    const c = byId.get(m.coachId)!;
    if (m.kind === "interviewed")
      s.interviews.push({ date: m.date, coach: coachRef(c), note: m.reason });
    else s.hired = { date: m.date, coach: coachRef(c), text: m.text, reason: m.reason };
    searches.set(key, s);
  }
  const live = season === league.season;
  return {
    season,
    departures: moves
      .filter((m) => m.kind === "fired" || m.kind === "left" || m.kind === "interim")
      .map((m) => ({
        date: m.date,
        teamId: m.teamId,
        coach: coachRef(byId.get(m.coachId)!),
        role: ROLE_NAMES[m.role],
        kind: m.kind,
        reason: m.reason,
      })),
    searches: [...searches.values()].filter((s) => s.interviews.length > 0 || s.hired),
    hires: moves
      .filter((m) => (m.kind === "hired" || m.kind === "promoted") && m.teamId !== null)
      .map((m) => ({ date: m.date, teamId: m.teamId!, text: m.text, reason: m.reason })),
    retirements: moves
      .filter((m) => m.kind === "retired")
      .map((m) => ({ coach: coachRef(byId.get(m.coachId)!), reason: m.reason })),
    open: live
      ? openings(league).map((o) => ({
          teamId: o.teamId,
          role: o.role,
          roleName: ROLE_NAMES[o.role],
          candidates: candidates(league, o)
            .slice(0, 8)
            .map(({ c }) => ({
              coach: coachRef(c),
              reputation: c.reputation,
              available: seasonOver(league, c.teamId),
              age: ageOn(c.birthDate, league.date),
            })),
        }))
      : [],
  };
}

const OFFICE = "League office decision (until GM Mode, the league office can act for any team).";

/** The league office fires a coach (in season, a head coach is replaced by an interim). */
export function officeFire(league: League, coachId: number): string {
  const c = league.coaches.find((x) => x.id === coachId);
  if (!c || c.teamId === null) throw new Error("That coach isn't on a team.");
  const teamId = c.teamId;
  const wasHead = c.role === "HC" && !c.interim;
  release(league, c, "fired", OFFICE);
  if (wasHead && league.calendar.stage === "regular") namedInterim(league, teamId);
  return `${teamName(league, teamId)} fired ${name(c)}.`;
}

/** The league office hires a candidate for an open job (he must be free to sign). */
export function officeHire(
  league: League,
  teamId: string,
  role: CoachRole,
  coachId: number,
): string {
  const o = openings(league).find((x) => x.teamId === teamId && x.role === role);
  if (!o)
    throw new Error(
      `The ${teamName(league, teamId)} have no opening for ${ROLE_NAMES[role].toLowerCase()}.`,
    );
  const c = league.coaches.find((x) => x.id === coachId);
  if (!c || !eligible(league, c, o)) throw new Error("That coach isn't a candidate for this job.");
  if (!seasonOver(league, c.teamId))
    throw new Error(`${name(c)} can't sign until his team's season is over.`);
  // An interim head coach steps back when the job goes to someone else.
  const interim = league.coaches.find((x) => x.teamId === teamId && x.role === "HC" && x.interim);
  if (role === "HC" && interim && interim.id !== c.id)
    release(league, interim, "left", "A permanent head coach was hired.");
  take(league, c, teamId, role, c.teamId === teamId ? "promoted" : "hired", OFFICE);
  return `${teamName(league, teamId)} hired ${name(c)} as ${ROLE_NAMES[role].toLowerCase()}.`;
}

/** A coach's career and tree for his profile. */
export function careerView(league: League, coachId: number) {
  const c = league.coaches.find((x) => x.id === coachId)!;
  const byId = new Map(league.coaches.map((x) => [x.id, x]));
  const mentorIds = [
    ...new Set(c.career.map((e) => e.underId).filter((x): x is number => x !== null && x !== c.id)),
  ];
  const proteges = league.coaches
    .filter((x) => x.id !== c.id && x.career.some((e) => e.underId === c.id))
    .sort((a, b) => b.reputation - a.reputation || a.id - b.id);
  return {
    reputation: c.reputation,
    contractThrough: c.contractThrough,
    interim: c.interim,
    retiredAfter: c.retiredAfter,
    specialty: c.specialty,
    career: [...c.career].reverse().map((e) => ({
      season: e.season,
      teamId: e.teamId,
      role: ROLE_NAMES[e.role],
      record: e.record,
      under:
        e.underId !== null && byId.get(e.underId)
          ? { id: e.underId, name: name(byId.get(e.underId)!) }
          : null,
    })),
    workedUnder: mentorIds.map((id) => coachRef(byId.get(id)!)),
    coachedUnderHim: proteges.map((x) => ({
      ...coachRef(x),
      current:
        x.retiredAfter !== null
          ? "retired"
          : x.teamId
            ? `${ROLE_NAMES[x.role]}, ${x.teamId}`
            : "out of work",
    })),
  };
}
