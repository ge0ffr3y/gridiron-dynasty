/** Small builders for hand-made season scenarios in tests. */
import type { Game, Team } from "../league/schema";
import { RULES_BY_SEASON, type Rules } from "../rules";

export const RULES = RULES_BY_SEASON[2026] as Rules;

/** The 32 teams from the rules (identities don't matter for standings). */
export function rulesTeams(rules: Rules = RULES): Team[] {
  return rules.structure.conferences.flatMap((c) =>
    c.divisions.flatMap((d) =>
      d.teams.map((id) => ({
        id,
        city: id,
        nickname: id,
        abbreviation: id,
        conferenceId: c.id,
        divisionId: d.id,
        colors: { primary: "#000000", secondary: "#ffffff" },
        controller: "ai" as const,
      })),
    ),
  );
}

/** Game list builder: win(a, b) means a beat b (a at home), 20-10 unless scores given. */
export class Results {
  readonly games: Game[] = [];
  private week = 1;

  win(
    winner: string,
    loser: string,
    score: [number, number] = [20, 10],
    touchdowns: [number, number] = [2, 1],
  ): this {
    return this.add(winner, loser, score[0], score[1], touchdowns);
  }

  tie(a: string, b: string, points = 17): this {
    return this.add(a, b, points, points, [2, 2]);
  }

  private add(home: string, away: string, hs: number, as: number, td: [number, number]): this {
    this.games.push({
      id: this.games.length,
      season: 2026,
      round: "regular",
      week: this.week++,
      date: "2026-09-13",
      homeId: home,
      awayId: away,
      neutral: false,
      boxScore: null,
      result: {
        homeScore: hs,
        awayScore: as,
        homeTouchdowns: td[0],
        awayTouchdowns: td[1],
        overtime: false,
      },
    });
    return this;
  }
}
