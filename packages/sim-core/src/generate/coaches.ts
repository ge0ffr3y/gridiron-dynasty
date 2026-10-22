import { addDays, Rng, streamSeed, type LeagueDate } from "@fgm/foundation";
import { COACH_SKILL, ROLE_FOCUS, STAFF_ROLES } from "../coaches/config";
import { drawStyle } from "../coaches/style";
import {
  DEFENSIVE_SCHEMES,
  OFFENSIVE_SCHEMES,
  type Coach,
  type CoachRole,
  type League,
} from "../league/schema";
import { NamePicker } from "./people";
import { bounded } from "./util";

const OFFENSIVE_ROLES: CoachRole[] = ["OC", "SKILL", "OLC"];
const DEFENSIVE_ROLES: CoachRole[] = ["DC", "FRONT", "DBC"];

/**
 * One coach, trainer or scout (Phase 10): skills around the league's typical level (better at
 * his job's main one), a style drawn from how much real teams differ, and a scheme for the
 * coaches who run one side of the ball.
 */
export function generateCoach(
  rng: Rng,
  names: NamePicker,
  date: LeagueDate,
  id: number,
  teamId: string | null,
  role: CoachRole,
  ageRange: [number, number],
): Coach {
  const age = rng.intBetween(ageRange[0], ageRange[1]);
  const startedAt = rng.intBetween(23, Math.min(age, 35));
  const birthDate = addDays(`${Number(date.slice(0, 4)) - age}${date.slice(4)}`, -rng.int(365));
  const rate = (key: keyof Coach["ratings"]) =>
    bounded(
      rng.gaussian(
        COACH_SKILL.mean + (ROLE_FOCUS[role] === key ? COACH_SKILL.focusBonus : 0),
        COACH_SKILL.spread,
      ),
      1,
      99,
    );
  // A head coach comes from one side of the ball and brings that side's scheme.
  const hcOffensive = role === "HC" && rng.chance(0.5);
  const { firstName, lastName } = names.next();
  const ratings = {
    offense: rate("offense"),
    defense: rate("defense"),
    development: rate("development"),
    leadership: rate("leadership"),
    gameManagement: rate("gameManagement"),
    scouting: rate("scouting"),
    health: rate("health"),
  };
  const offensive = OFFENSIVE_ROLES.includes(role) || hcOffensive;
  const defensive = DEFENSIVE_ROLES.includes(role) || (role === "HC" && !hcOffensive);
  return {
    id,
    firstName,
    lastName,
    role,
    teamId,
    birthDate,
    experience: age - startedAt,
    ratings,
    style: drawStyle(rng),
    offensiveScheme: offensive ? rng.pick(OFFENSIVE_SCHEMES) : null,
    defensiveScheme: defensive ? rng.pick(DEFENSIVE_SCHEMES) : null,
  };
}

/**
 * Fills every team's staff to STAFF_ROLES with generated people (for the real league's jobs the
 * data doesn't cover, and for saves from before Phase 10). Same seed, same staff.
 */
export function fillStaff(league: League, date: LeagueDate, label: string): void {
  const rng = new Rng(streamSeed(league.meta.seed, `staff:${label}`));
  const names = new NamePicker(rng);
  for (const c of league.coaches) names.reserve(`${c.firstName} ${c.lastName}`);
  for (const team of league.teams) {
    for (const { role, count, age } of STAFF_ROLES) {
      const have = league.coaches.filter((c) => c.teamId === team.id && c.role === role).length;
      for (let i = have; i < count; i++)
        league.coaches.push(
          generateCoach(rng, names, date, league.nextIds.coach++, team.id, role, age),
        );
    }
  }
}
