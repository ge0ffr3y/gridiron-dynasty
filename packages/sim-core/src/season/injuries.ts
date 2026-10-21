/**
 * Injuries between games. The engine decides who gets hurt during a game
 * and whether he came back; here a player who didn't come back is given a
 * number of games to miss, drawn from how long real NFL players missed after
 * leaving a game hurt (calibration/people.json). The full injury model
 * (types, recovery, reinjury) is Phase 9.
 */
import { Rng, streamSeed } from "@fgm/foundation";
import { PEOPLE, type GameInjury } from "@fgm/game-engine";
import type { Game, League, Player } from "../league/schema";
import { LONGEST_INJURY_GAMES } from "./config";

/** Games missed: a bucket of the real distribution, then a number inside it. */
export function drawGamesMissed(rng: Rng): number {
  const shares = PEOPLE.injuries.gamesMissed.shares as Record<string, number>;
  let r = rng.next();
  let bucket = "0";
  for (const [key, share] of Object.entries(shares)) {
    bucket = key;
    r -= share;
    if (r < 0) break;
  }
  if (bucket.endsWith("+"))
    return rng.intBetween(Number(bucket.slice(0, -1)), LONGEST_INJURY_GAMES);
  const [low, high] = bucket.split("-").map(Number) as [number, number?];
  return high === undefined ? low : rng.intBetween(low, high);
}

/**
 * After a game: players already hurt are one game closer to returning, and
 * anyone who left this game hurt starts his own countdown.
 */
export function applyInjuries(
  league: League,
  game: Game,
  injuries: GameInjury[],
  players: Map<number, Player>,
): void {
  for (const p of players.values()) {
    if (!p.injury || (p.teamId !== game.homeId && p.teamId !== game.awayId)) continue;
    p.injury.gamesRemaining -= 1;
    if (p.injury.gamesRemaining <= 0) p.injury = null;
  }
  // Each game has its own seed, so a game's injuries don't depend on the order games are played.
  const rng = new Rng(streamSeed(league.meta.seed, `injury:${league.season}:${game.id}`));
  for (const injury of injuries) {
    if (injury.returned) continue;
    const player = players.get(injury.playerId);
    if (!player) continue;
    const games = drawGamesMissed(rng);
    if (games === 0) continue;
    const opponent = injury.side === "home" ? game.awayId : game.homeId;
    const when = game.round === "regular" ? `Week ${game.week}` : `the ${game.round} round`;
    player.injury = {
      description: `Hurt in ${when} against ${league.teams.find((t) => t.id === opponent)?.abbreviation ?? opponent}`,
      gamesRemaining: games,
      since: game.date,
    };
  }
}
