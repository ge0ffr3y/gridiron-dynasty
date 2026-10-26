/**
 * Exhibition games (Phase 17): two teams play one game on a neutral field with the lineups and
 * staffs they have today, and nothing in the league changes (no stats, injuries or box score are
 * stored). Experiments use them to measure how strong a team really is, by playing it many times.
 */
import { simulateGame, type GameOutput } from "@fgm/game-engine";
import { Rng } from "@fgm/foundation";
import { staffInput } from "../coaches/style";
import type { League } from "../league/schema";
import { gameDepthChart } from "./depthChart";

export interface ExhibitionRig {
  /** One game: the output is the engine's, and the league is untouched. */
  play(homeId: string, awayId: string, seed: number, playoff?: boolean): GameOutput;
}

/**
 * Builds every team's depth chart and staff once (injured players stay off the field). Make a new
 * rig after changing a roster or staff; a rig never changes the league it reads.
 */
export function exhibitionRig(league: League): ExhibitionRig {
  const teams = new Map(
    league.teams.map((t) => [
      t.id,
      { id: t.id, depth: gameDepthChart(league, t.id, []), ...staffInput(league, t.id) },
    ]),
  );
  return {
    play(homeId, awayId, seed, playoff = false) {
      const home = teams.get(homeId);
      const away = teams.get(awayId);
      if (!home || !away) throw new Error(`no such team: ${homeId} or ${awayId}`);
      return simulateGame(
        { home, away, neutral: true, playoff, rules: league.rules.game },
        new Rng(seed),
      );
    },
  };
}
