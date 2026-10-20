/**
 * Division ranks, conference order (playoff seeds 1-7 and everyone after),
 * and notes on how ties were broken.
 */
import type { Game, Team } from "../league/schema";
import type { Rules } from "../rules";
import { pctOf, SeasonTable } from "./standings";
import { Tiebreaker } from "./tiebreakers";

export interface Standings {
  table: SeasonTable;
  tiebreaker: Tiebreaker;
  /** Each division's teams, 1st place first. */
  divisionOrder: Map<string, string[]>;
  divisionRank: Map<string, number>;
  /** Each conference's teams in seeding order; the first `teamsPerConference` make the playoffs. */
  conferenceOrder: Map<string, string[]>;
  seed: Map<string, number>;
  notes: string[];
}

export function computeStandings(
  rules: Rules,
  teams: Team[],
  games: Game[],
  coinSalt: string,
): Standings {
  const table = new SeasonTable(teams, games);
  const notes: string[] = [];
  const record = (id: string) => pctOf(table.record(id));
  const note = (n: { winner: string; over: string[]; reason: string }, context: string) =>
    notes.push(`${n.winner} ahead of ${n.over.join(", ")} for ${context} (${n.reason})`);

  const ordinal = (n: number) =>
    `${n}${n % 100 >= 11 && n % 100 <= 13 ? "th" : (["th", "st", "nd", "rd"][n % 10] ?? "th")}`;

  // Divisions: sort by record, break ties with the division procedure.
  const plain = new Tiebreaker(table, coinSalt);
  const divisionOrder = new Map<string, string[]>();
  const divisionRank = new Map<string, number>();
  for (const conference of rules.structure.conferences) {
    for (const division of conference.divisions) {
      const order: string[] = [];
      const remaining = [...division.teams];
      while (remaining.length > 0) {
        const top = Math.max(...remaining.map(record));
        const group = remaining.filter((t) => record(t) === top);
        const r = plain.order(group, "division");
        r.notes.forEach((n) => note(n, `the ${conference.name} ${division.name} order`));
        order.push(...r.order);
        for (const t of r.order) remaining.splice(remaining.indexOf(t), 1);
      }
      divisionOrder.set(division.id, order);
      order.forEach((t, i) => divisionRank.set(t, i + 1));
    }
  }

  // Conferences: division winners first (seeded with the wild-card procedure), then everyone else.
  const tiebreaker = plain.withDivisionRanks(divisionRank);
  const conferenceOrder = new Map<string, string[]>();
  const seed = new Map<string, number>();
  for (const conference of rules.structure.conferences) {
    const order: string[] = [];
    const seeds = rules.playoffs.teamsPerConference;
    const place = (pool: string[]) => {
      const remaining = [...pool];
      while (remaining.length > 0) {
        const top = Math.max(...remaining.map(record));
        const group = remaining.filter((t) => record(t) === top);
        const r = tiebreaker.best(group, "wildcard");
        const position = order.length + 1;
        const context =
          position <= seeds
            ? `the ${ordinal(position)} seed in ${conference.name}`
            : `${ordinal(position)} place in ${conference.name}`;
        if (group.length > 1)
          note(
            { winner: r.winner, over: group.filter((g) => g !== r.winner), reason: r.reason },
            context,
          );
        order.push(r.winner);
        remaining.splice(remaining.indexOf(r.winner), 1);
      }
    };
    const winners = conference.divisions.map(
      (d) => (divisionOrder.get(d.id) as string[])[0] as string,
    );
    place(winners);
    const others = conference.divisions.flatMap((d) =>
      (divisionOrder.get(d.id) as string[]).slice(1),
    );
    place(others);
    conferenceOrder.set(conference.id, order);
    order.slice(0, rules.playoffs.teamsPerConference).forEach((t, i) => seed.set(t, i + 1));
  }

  return { table, tiebreaker, divisionOrder, divisionRank, conferenceOrder, seed, notes };
}
