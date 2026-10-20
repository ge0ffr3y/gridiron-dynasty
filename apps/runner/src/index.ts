/**
 * Headless runner: simulates leagues from the command line, for calibration
 * runs and experiments.
 *
 *   npm run sim -- --new-league --seed 42                 summary of a generated league
 *   npm run sim -- --new-league --seed 42 --out l.json    also write the league file
 */
import { writeFileSync } from "node:fs";
import { GAME_ENGINE_VERSION } from "@fgm/game-engine";
import {
  POSITIONS,
  SIM_CORE_VERSION,
  createLeague,
  fingerprint,
  playersView,
  serializeLeague,
  teamView,
} from "@fgm/sim-core";

function option(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

function readSeed(args: string[]): number {
  const value = Number(option(args, "--seed") ?? 42);
  if (!Number.isInteger(value)) throw new Error("--seed must be a whole number");
  return value;
}

function percentile(sorted: number[], p: number): number {
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? 0;
}

const args = process.argv.slice(2);
console.log(
  `FootballGM Sim runner (sim-core ${SIM_CORE_VERSION}, game-engine ${GAME_ENGINE_VERSION})`,
);

if (!args.includes("--new-league")) {
  console.log("Usage: npm run sim -- --new-league [--seed N] [--out league.json]");
  process.exit(0);
}

const seed = readSeed(args);
const started = process.hrtime.bigint();
const league = createLeague({ seed, name: `League ${seed}` });
const text = serializeLeague(league);
const ms = Number(process.hrtime.bigint() - started) / 1e6;

console.log(
  `\nSeed ${seed}: ${league.teams.length} teams, ${league.players.length} players, ${league.coaches.length} staff, ` +
    `${league.draftPicks.length} draft picks. Built in ${ms.toFixed(0)} ms; file ${(text.length / 1024 / 1024).toFixed(1)} MB, fingerprint ${fingerprint(text)}.`,
);

const viewer = { kind: "league" } as const;
const rows = playersView(league, viewer);
console.log("\nOverall by position (all rostered players):");
console.log("pos    count  best  top10%  median  worst   avg age");
for (const position of POSITIONS) {
  const group = rows.filter((r) => r.position === position);
  const overalls = group.map((r) => r.overall).sort((a, b) => b - a);
  const avgAge = group.reduce((a, r) => a + r.age, 0) / group.length;
  console.log(
    `${position.padEnd(6)} ${String(group.length).padStart(5)}  ${String(overalls[0]).padStart(4)}  ${String(percentile(overalls, 0.1)).padStart(6)}  ${String(percentile(overalls, 0.5)).padStart(6)}  ${String(overalls[overalls.length - 1]).padStart(5)}   ${avgAge.toFixed(1).padStart(7)}`,
  );
}

const strengths = league.teams
  .map((t) => ({
    id: t.id,
    name: `${t.city} ${t.nickname}`,
    starters: teamView(league, t.id, viewer).starterOverall,
  }))
  .sort((a, b) => b.starters - a.starters);
console.log("\nStrongest and weakest teams (average starter overall):");
for (const t of [...strengths.slice(0, 3), ...strengths.slice(-3)])
  console.log(`  ${t.starters.toFixed(1)}  ${t.name}`);

const out = option(args, "--out");
if (out) {
  writeFileSync(out, text);
  console.log(`\nWrote ${out}`);
}
