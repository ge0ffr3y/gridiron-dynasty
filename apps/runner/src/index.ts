/**
 * Headless runner: simulates leagues from the command line, for calibration
 * runs and experiments. For now it only proves the seeded RNG is deterministic.
 *
 *   npm run sim -- --seed 42
 */
import { GAME_ENGINE_VERSION } from "@fgm/game-engine";
import { RngStreams, SIM_CORE_VERSION } from "@fgm/sim-core";

function readSeed(args: string[]): number {
  const i = args.indexOf("--seed");
  const value = i >= 0 ? Number(args[i + 1]) : 42;
  if (!Number.isInteger(value)) throw new Error("--seed must be a whole number");
  return value;
}

const seed = readSeed(process.argv.slice(2));
const streams = new RngStreams(seed);
const sample = Array.from({ length: 5 }, () => streams.get("league").nextUint32());

console.log(
  `FootballGM Sim runner (sim-core ${SIM_CORE_VERSION}, game-engine ${GAME_ENGINE_VERSION})`,
);
console.log(`Seed ${seed}, first five "league" stream numbers: ${sample.join(", ")}`);
console.log("Nothing to simulate yet: leagues arrive in roadmap Phase 1.");
