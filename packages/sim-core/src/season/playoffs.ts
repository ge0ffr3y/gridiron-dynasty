/**
 * The playoff bracket: 2v7, 3v6, 4v5 with the top seed on a bye; then the
 * top seed hosts the lowest remaining seed; the higher seed always hosts;
 * the championship is at a neutral site.
 */
import type { Game, PlayoffRound } from "../league/schema";
import type { Rules } from "../rules";
import type { Standings } from "./seeding";

export interface PlayoffMatchup {
  round: PlayoffRound;
  homeId: string;
  awayId: string;
  neutral: boolean;
}

export function winnerOf(game: Game): string | null {
  if (!game.result) return null;
  return game.result.homeScore > game.result.awayScore ? game.homeId : game.awayId;
}

export function loserOf(game: Game): string | null {
  const w = winnerOf(game);
  return w === null ? null : w === game.homeId ? game.awayId : game.homeId;
}

/** Pairs a seeded list the playoff way: best vs worst, next best vs next worst... */
function pairUp(
  seeded: string[],
  seed: Map<string, number>,
  round: PlayoffRound,
): PlayoffMatchup[] {
  const sorted = [...seeded].sort((a, b) => (seed.get(a) as number) - (seed.get(b) as number));
  const games: PlayoffMatchup[] = [];
  for (let i = 0; i < sorted.length / 2; i++) {
    games.push({
      round,
      homeId: sorted[i] as string,
      awayId: sorted[sorted.length - 1 - i] as string,
      neutral: false,
    });
  }
  return games;
}

/** The games of the next playoff round, given the playoff games played so far. */
export function nextRoundMatchups(
  rules: Rules,
  season: number,
  round: PlayoffRound,
  standings: Standings,
  playoffGames: Game[],
): PlayoffMatchup[] {
  const previous: Record<PlayoffRound, PlayoffRound | null> = {
    wildcard: null,
    divisional: "wildcard",
    conference: "divisional",
    championship: "conference",
  };
  const prior = previous[round];
  const winners = new Set(playoffGames.filter((g) => g.round === prior).map(winnerOf));
  const games: PlayoffMatchup[] = [];
  const champions: string[] = [];

  for (const conference of rules.structure.conferences) {
    const seeds = (standings.conferenceOrder.get(conference.id) as string[]).slice(
      0,
      rules.playoffs.teamsPerConference,
    );
    let alive: string[];
    if (round === "wildcard") alive = seeds.slice(rules.playoffs.byesPerConference);
    else if (round === "divisional")
      alive = [
        ...seeds.slice(0, rules.playoffs.byesPerConference),
        ...seeds.filter((t) => winners.has(t)),
      ];
    else alive = seeds.filter((t) => winners.has(t));

    if (round === "championship") champions.push(...alive);
    else games.push(...pairUp(alive, standings.seed, round));
  }

  if (round === "championship") {
    // Neutral site; the "home" side alternates between conferences by season.
    const [a, b] = champions as [string, string];
    const aFirst = season % 2 === 0;
    games.push({ round, homeId: aFirst ? a : b, awayId: aFirst ? b : a, neutral: true });
  }
  return games;
}
