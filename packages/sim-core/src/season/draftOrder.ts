/**
 * Draft order from the season's results (nfl.com tie-breaking procedures,
 * "Procedures for the draft"): non-playoff clubs first, then by the round
 * clubs lost in, the runner-up 31st and the champion 32nd. Within a group the
 * worse record picks first; ties go to the club with the easier schedule,
 * then the division, conference, or interconference procedure. Clubs tied on
 * record rotate within their group each round.
 */
import type { PlayoffExit } from "../league/schema";
import { pctOf } from "./standings";
import type { Standings } from "./seeding";

const EXIT_ORDER: PlayoffExit[] = [
  "missed",
  "wildcard",
  "divisional",
  "conference",
  "runner-up",
  "champion",
];

export interface DraftOrder {
  /** First-round order, 1st pick first. */
  firstRound: string[];
  /** Order for a given round (1-based), with tied clubs rotated. */
  round(n: number): string[];
}

/** Of a tied group, the club that picks first. */
function picksFirst(standings: Standings, group: string[]): string {
  const { table, tiebreaker, divisionRank } = standings;
  const team = (id: string) => table.teamOf(id);
  const sameDivision = group.every(
    (g) => team(g).divisionId === team(group[0] as string).divisionId,
  );
  const sameConference = group.every(
    (g) => team(g).conferenceId === team(group[0] as string).conferenceId,
  );
  // The club the procedure ranks LAST picks first.
  if (sameDivision) return tiebreaker.order(group, "division").order.at(-1) as string;
  if (sameConference) return tiebreaker.order(group, "wildcard").order.at(-1) as string;
  if (group.length === 2) {
    const winner = tiebreaker.best(group, "interconference").winner;
    return group.find((g) => g !== winner) as string;
  }
  // Three or more across conferences: lowest-ranked club in each division, then in each conference, then across the league.
  const lowestPerDivision = new Map<string, string>();
  for (const g of group) {
    const d = team(g).divisionId;
    const current = lowestPerDivision.get(d);
    if (!current || (divisionRank.get(g) as number) > (divisionRank.get(current) as number))
      lowestPerDivision.set(d, g);
  }
  const perConference = new Map<string, string[]>();
  for (const g of lowestPerDivision.values()) {
    const c = team(g).conferenceId;
    perConference.set(c, [...(perConference.get(c) ?? []), g]);
  }
  const lowestPerConference = [...perConference.values()].map((members) =>
    members.length === 1
      ? (members[0] as string)
      : (tiebreaker.order(members, "wildcard").order.at(-1) as string),
  );
  if (lowestPerConference.length === 1) return lowestPerConference[0] as string;
  return picksFirst(standings, lowestPerConference);
}

export function computeDraftOrder(
  standings: Standings,
  exits: Map<string, PlayoffExit>,
): DraftOrder {
  const { table } = standings;
  const pct = (id: string) => pctOf(table.record(id));
  const firstRound: string[] = [];
  const tieGroups: string[][] = [];

  for (const exit of EXIT_ORDER) {
    const members = table.teams.map((t) => t.id).filter((id) => exits.get(id) === exit);
    const remaining = [...members];
    while (remaining.length > 0) {
      const worst = Math.min(...remaining.map(pct));
      const sameRecord = remaining.filter((t) => pct(t) === worst);
      const ordered: string[] = [];
      const pool = [...sameRecord];
      while (pool.length > 0) {
        // Easier schedule picks first; remaining ties use the procedures.
        const easiest = Math.min(...pool.map((t) => table.strengthOfSchedule(t)));
        const tied = pool.filter((t) => table.strengthOfSchedule(t) === easiest);
        const next = tied.length === 1 ? (tied[0] as string) : picksFirst(standings, tied);
        ordered.push(next);
        pool.splice(pool.indexOf(next), 1);
      }
      firstRound.push(...ordered);
      if (ordered.length > 1) tieGroups.push(ordered);
      for (const t of ordered) remaining.splice(remaining.indexOf(t), 1);
    }
  }

  return {
    firstRound,
    round(n: number) {
      const order = [...firstRound];
      for (const group of tieGroups) {
        // Each round the top club of a tied group moves to the bottom.
        const start = order.indexOf(group[0] as string);
        const shift = (n - 1) % group.length;
        const rotated = [...group.slice(shift), ...group.slice(0, shift)];
        order.splice(start, group.length, ...rotated);
      }
      return order;
    },
  };
}
