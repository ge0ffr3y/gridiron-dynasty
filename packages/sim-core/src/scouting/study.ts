/**
 * Scouting the class (Phase 11). Each team's two scouts are assigned a region
 * and a position group. Every week from September to April each scout studies
 * the class: prospects in both his region and his group the most, those in one
 * of them less, everyone a little; a scout whose specialty covers a prospect's
 * position learns more. The combine (invitees) and pro days (the rest) measure
 * prospects for everyone and give every team a look.
 *
 * Study is stored as points per team and prospect (`team.scouting.points`),
 * which perception turns into a tighter read. No random numbers are drawn.
 */
import { daysBetween, overallAt, type Position } from "@fgm/foundation";
import type { League, Prospect, Team } from "../league/schema";
import { onTeam } from "../roster/lists";
import { seasonDates } from "../season/calendar";
import { proDayDate, upcomingDraftYear } from "./classes";
import { REGIONS, SCOUT_GROUPS, SCOUTING } from "./config";
import { uniformFrom } from "./noise";

type Assignment = Team["scouting"]["assignments"][number];

function groupHas(group: string | null, position: Position): boolean {
  if (!group) return false;
  const positions = SCOUT_GROUPS[group];
  return positions !== undefined && (positions.length === 0 || positions.includes(position));
}

/** Position groups ranked by how much a team needs help there (weakest starters first). */
export function groupNeeds(league: League, teamId: string): string[] {
  const players = onTeam(league, teamId);
  const scored = Object.entries(SCOUT_GROUPS)
    .filter(([, positions]) => positions.length > 0)
    .map(([group, positions]) => {
      const best = positions.map((pos) => {
        const at = players
          .filter((p) => p.position === pos)
          .map((p) => overallAt(p.ratings, pos))
          .sort((a, b) => b - a);
        return at[0] ?? 0;
      });
      return { group, need: best.reduce((a, b) => a + b, 0) / best.length };
    });
  return scored
    .sort((a, b) => a.need - b.need || a.group.localeCompare(b.group))
    .map((x) => x.group);
}

/**
 * The AI's assignments for a season: one scout on the biggest need, the other on the next,
 * each in a region picked from a hash (every region is as good as another on average).
 */
export function aiAssignments(league: League, teamId: string): Assignment[] {
  const scouts = league.coaches
    .filter((c) => c.teamId === teamId && c.role === "SCOUT")
    .sort((a, b) => a.id - b.id);
  const needs = groupNeeds(league, teamId);
  return scouts.map((s, i) => ({
    scoutId: s.id,
    region:
      REGIONS[
        Math.floor(
          uniformFrom(`${league.meta.seed}:assign:${league.season}:${teamId}:${i}`) *
            REGIONS.length,
        )
      ]!,
    group: needs[i] ?? null,
  }));
}

/** Every AI team sets its assignments for the coming class (right after the draft). */
export function assignScouts(league: League): void {
  for (const team of league.teams) team.scouting.assignments = aiAssignments(league, team.id);
}

/** One scout's weekly points on a prospect. */
function scoutPoints(
  assignment: Assignment | undefined,
  specialty: string | null,
  prospect: Prospect,
): number {
  const W = SCOUTING.weeklyPoints;
  const inRegion = assignment?.region === prospect.region;
  const inGroup = groupHas(assignment?.group ?? null, prospect.position);
  const base = inRegion && inGroup ? W.both : inRegion || inGroup ? W.one : W.general;
  return groupHas(specialty, prospect.position) ? base * SCOUTING.specialtyBoost : base;
}

function addPoints(team: Team, id: number, points: number): void {
  const key = String(id);
  team.scouting.points[key] = Math.round(((team.scouting.points[key] ?? 0) + points) * 10) / 10;
}

/** `weeks` weeks of study on the upcoming class, by every team's scouts. */
export function scoutingWeeks(league: League, weeks: number): void {
  if (weeks <= 0) return;
  const year = upcomingDraftYear(league);
  const prospects = league.prospects.filter((p) => p.draftYear === year);
  if (prospects.length === 0) return;
  for (const team of league.teams) {
    const scouts = league.coaches.filter((c) => c.teamId === team.id && c.role === "SCOUT");
    // A vacant scout's job still has a scouting staff doing general work.
    const staff = scouts.length > 0 ? scouts : [null];
    for (const p of prospects) {
      let points = 0;
      for (const s of staff) {
        const assignment = s
          ? team.scouting.assignments.find((a) => a.scoutId === s.id)
          : undefined;
        points += scoutPoints(assignment, s?.specialty ?? null, p);
      }
      addPoints(team, p.id, points * weeks);
    }
  }
}

/** Measures a prospect: everyone sees his drills now, and every team gets a look. */
function test(league: League, prospect: Prospect, points: number): void {
  prospect.tested = true;
  for (const team of league.teams) addPoints(team, prospect.id, points);
}

/** The combine: every invitee is measured. */
export function runCombine(league: League): number {
  const year = upcomingDraftYear(league);
  let n = 0;
  for (const p of league.prospects)
    if (p.draftYear === year && p.invited && !p.tested) {
      test(league, p, SCOUTING.testingPoints.combine);
      n += 1;
    }
  return n;
}

/** Pro days through `date`: everyone not at the combine is measured at his school. */
export function runProDays(league: League, date: string): number {
  const year = upcomingDraftYear(league);
  let n = 0;
  for (const p of league.prospects)
    if (p.draftYear === year && !p.invited && !p.tested && proDayDate(league, p) <= date) {
      test(league, p, SCOUTING.testingPoints.proDay);
      n += 1;
    }
  return n;
}

/**
 * The offseason's scouting, as the calendar moves from `from` to `to` (before the draft): weeks
 * of study, the combine when it falls in between, and pro days.
 */
export function offseasonScouting(league: League, from: string, to: string): void {
  const combine = seasonDates(league.rules, upcomingDraftYear(league)).combine;
  scoutingWeeks(league, Math.floor(Math.max(0, daysBetween(from, to)) / 7));
  if (from < combine && combine <= to) runCombine(league);
  runProDays(league, to);
}

/** Study on players no longer prospects is dropped at the new season (rookies have tape by then). */
export function pruneStudy(league: League): void {
  const live = new Set(league.prospects.map((p) => String(p.id)));
  for (const team of league.teams)
    for (const key of Object.keys(team.scouting.points))
      if (!live.has(key)) delete team.scouting.points[key];
}
