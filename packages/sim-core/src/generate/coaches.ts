import { addDays, type LeagueDate } from "@fgm/foundation";
import { DEFENSIVE_SCHEMES, OFFENSIVE_SCHEMES, type Coach, type CoachRole } from "../league/schema";
import type { Rng } from "@fgm/foundation";
import { COACH_RATING, COACH_ROLE_BONUS } from "./config";
import type { NamePicker } from "./people";
import { bounded } from "./util";

/** The rating that matters most for each role. */
const ROLE_FOCUS: Record<CoachRole, keyof Coach["ratings"]> = {
  HC: "leadership",
  OC: "offense",
  DC: "defense",
  STC: "gameManagement",
  SCOUT: "scouting",
};

/** One coach or scout, with placeholder attributes (the full model is Phase 10). */
export function generateCoach(
  rng: Rng,
  names: NamePicker,
  date: LeagueDate,
  id: number,
  teamId: string,
  role: CoachRole,
  ageRange: [number, number],
): Coach {
  const age = rng.intBetween(ageRange[0], ageRange[1]);
  const startedAt = rng.intBetween(23, Math.min(age, 35));
  const birthDate = addDays(`${Number(date.slice(0, 4)) - age}${date.slice(4)}`, -rng.int(365));
  const rate = (key: keyof Coach["ratings"]) =>
    bounded(
      rng.gaussian(
        COACH_RATING[0] + (ROLE_FOCUS[role] === key ? COACH_ROLE_BONUS : 0),
        COACH_RATING[1],
      ),
      1,
      99,
    );
  // A head coach comes from one side of the ball and brings that side's scheme.
  const hcOffensive = role === "HC" && rng.chance(0.5);
  const { firstName, lastName } = names.next();
  return {
    id,
    firstName,
    lastName,
    role,
    teamId,
    birthDate,
    experience: age - startedAt,
    ratings: {
      offense: rate("offense"),
      defense: rate("defense"),
      development: rate("development"),
      leadership: rate("leadership"),
      gameManagement: rate("gameManagement"),
      scouting: rate("scouting"),
    },
    offensiveScheme: role === "OC" || hcOffensive ? rng.pick(OFFENSIVE_SCHEMES) : null,
    defensiveScheme:
      role === "DC" || (role === "HC" && !hcOffensive) ? rng.pick(DEFENSIVE_SCHEMES) : null,
  };
}
