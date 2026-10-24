/** A player's honors for his page (Phase 15): awards by kind with their seasons, and the Hall. */
import type { AwardKind, League } from "../league/schema";

export interface Honors {
  awards: { label: string; seasons: number[] }[];
  hallOfFame: { inducted: number; reason: string } | null;
  retiredNumber: { teamId: string; number: number } | null;
}

const ORDER: [AwardKind, string][] = [
  ["mvp", "MVP"],
  ["opoy", "Offensive Player of the Year"],
  ["dpoy", "Defensive Player of the Year"],
  ["oroy", "Offensive Rookie of the Year"],
  ["droy", "Defensive Rookie of the Year"],
  ["comeback", "Comeback Player of the Year"],
  ["all-pro-1", "First-team All-Pro"],
  ["all-pro-2", "Second-team All-Pro"],
  ["pro-bowl", "Pro Bowl"],
];

export function honorsOf(league: League, playerId: number): Honors {
  const mine = league.awards.filter((a) => a.playerId === playerId && a.place === 1);
  const hof = league.hallOfFame.find((h) => h.playerId === playerId);
  const number = league.retiredNumbers.find((r) => r.playerId === playerId);
  return {
    awards: ORDER.flatMap(([kind, label]) => {
      const seasons = mine
        .filter((a) => a.award === kind)
        .map((a) => a.season)
        .sort((a, b) => a - b);
      return seasons.length ? [{ label, seasons }] : [];
    }),
    hallOfFame: hof ? { inducted: hof.inducted, reason: hof.reason } : null,
    retiredNumber: number ? { teamId: number.teamId, number: number.number } : null,
  };
}
