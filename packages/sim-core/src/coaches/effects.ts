/**
 * What staffs do beyond calling plays (Phase 10): position coaches and the head
 * coach speed or slow development, a player's scheme fit adds to it, the
 * strength coach moves injury risk and the head trainer recovery time. Each is
 * measured against the league's own average coach in that job, so they balance
 * exactly and the league's totals hold.
 */
import type { League, Player } from "../league/schema";
import { POSITION_COACH, STAFF_EFFECTS } from "./config";
import { FIT_DEVELOPMENT, playerFit } from "./fit";
import { coachIn, leagueTypical, staffMultiplier } from "./style";

/** Development speed for a player this year: his position coach, the head coach, and his fit. */
export function developmentMultiplier(league: League, p: Player): number {
  if (p.teamId === null) return 1;
  const coach = coachIn(league, p.teamId, POSITION_COACH[p.position]);
  const hc = coachIn(league, p.teamId, "HC");
  return (
    staffMultiplier(
      coach?.ratings.development,
      STAFF_EFFECTS.positionCoachDevelopment,
      false,
      leagueTypical(league, POSITION_COACH[p.position], "development"),
    ) *
    staffMultiplier(
      hc?.ratings.development,
      STAFF_EFFECTS.headCoachDevelopment,
      false,
      leagueTypical(league, "HC", "development"),
    ) *
    (1 + playerFit(league, p) * FIT_DEVELOPMENT)
  );
}

/** A team's injury risk from its strength and conditioning coach (lower is better). */
export function injuryRiskMultiplier(league: League, teamId: string | null): number {
  if (teamId === null) return 1;
  return staffMultiplier(
    coachIn(league, teamId, "STR")?.ratings.health,
    STAFF_EFFECTS.strengthInjuryRisk,
    true,
    leagueTypical(league, "STR", "health"),
  );
}

/** A team's recovery time from its head trainer (lower is better). */
export function recoveryMultiplier(league: League, teamId: string | null): number {
  if (teamId === null) return 1;
  return staffMultiplier(
    coachIn(league, teamId, "MED")?.ratings.health,
    STAFF_EFFECTS.trainerRecovery,
    true,
    leagueTypical(league, "MED", "health"),
  );
}
