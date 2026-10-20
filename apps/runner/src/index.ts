/**
 * Headless runner: simulates leagues from the command line, for calibration
 * runs and experiments.
 *
 *   npm run sim -- --new-league --seed 42                 summary of a generated league
 *   npm run sim -- --new-league --seed 42 --out l.json    also write the league file
 *   npm run sim -- --seasons 10 --seed 42                 simulate seasons, checking every schedule
 *   npm run sim -- --calibrate [--leagues 4 --seasons 2 --seed 42]   compare simulated seasons with real NFL ranges
 */
import { writeFileSync } from "node:fs";
import { GAME_ENGINE_VERSION, measureSeason, scorecard, type MeasuredGame } from "@fgm/game-engine";
import {
  POSITIONS,
  SIM_CORE_VERSION,
  advance,
  advanceUntil,
  createLeague,
  validateSchedule,
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

if (args.includes("--calibrate")) {
  runCalibration(
    readSeed(args),
    Number(option(args, "--leagues") ?? 4),
    Number(option(args, "--seasons") ?? 2),
  );
  process.exit(0);
}

const seasonsArg = option(args, "--seasons");
if (seasonsArg !== undefined) {
  runSeasons(readSeed(args), Number(seasonsArg));
  process.exit(0);
}

if (!args.includes("--new-league")) {
  console.log("Usage:");
  console.log("  npm run sim -- --new-league [--seed N] [--out league.json]");
  console.log("  npm run sim -- --seasons N [--seed N]");
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

/** Simulates many seasons, validating each schedule, and prints a line per season. */
function runSeasons(seed: number, count: number): void {
  if (!Number.isInteger(count) || count < 1)
    throw new Error("--seasons must be a whole number of 1 or more");
  const started = process.hrtime.bigint();
  const league = createLeague({ seed, name: `League ${seed}` });
  console.log(
    `\nSeed ${seed}: simulating ${count} season${count === 1 ? "" : "s"} (placeholder scores until the Phase 3 engine).\n`,
  );
  console.log(
    "season  champion  runner-up  score    best record     pts/team/game  home win%  ties  schedule",
  );
  const totals = { points: 0, games: 0, homeWins: 0, ties: 0, problems: 0 };
  for (let i = 0; i < count; i++) {
    const last = league.history.at(-1)!;
    const finish = new Map(last.standings.map((s) => [s.teamId, s.divisionRank]));
    const problems = validateSchedule(
      league.rules,
      league.season,
      league.teams,
      league.games,
      finish,
    );
    totals.problems += problems.length;
    advanceUntil(league, (l) => l.calendar.stage === "complete");
    const h = league.history.at(-1)!;
    const regular = league.games.filter((g) => g.round === "regular" && g.result);
    const points = regular.reduce((sum, g) => sum + g.result!.homeScore + g.result!.awayScore, 0);
    const homeWins = regular.filter((g) => g.result!.homeScore > g.result!.awayScore).length;
    const ties = regular.filter((g) => g.result!.homeScore === g.result!.awayScore).length;
    totals.points += points;
    totals.games += regular.length;
    totals.homeWins += homeWins;
    totals.ties += ties;
    const best = [...h.standings].sort((a, b) => b.wins + b.ties / 2 - (a.wins + a.ties / 2))[0]!;
    const final = h.playoffGames.find((g) => g.round === "championship")!;
    const score = `${Math.max(final.homeScore, final.awayScore)}-${Math.min(final.homeScore, final.awayScore)}`;
    console.log(
      `${h.season}    ${h.championId.padEnd(8)}  ${h.runnerUpId.padEnd(9)}  ${score.padEnd(7)}  ${`${best.teamId} ${best.wins}-${best.losses}-${best.ties}`.padEnd(14)}  ${(points / regular.length / 2).toFixed(1).padStart(13)}  ${((homeWins / regular.length) * 100).toFixed(1).padStart(9)}  ${String(ties).padStart(4)}  ${problems.length === 0 ? "valid" : `${problems.length} problems`}`,
    );
    if (problems.length > 0) for (const p of problems.slice(0, 5)) console.log(`        ${p}`);
    advance(league); // next league year
  }
  const seconds = Number(process.hrtime.bigint() - started) / 1e9;
  console.log(
    `\n${count} seasons in ${seconds.toFixed(1)} s (${((seconds / count) * 1000).toFixed(0)} ms per season). ` +
      `Average ${(totals.points / totals.games / 2).toFixed(1)} points per team per game, home teams won ${((totals.homeWins / totals.games) * 100).toFixed(1)}%, ` +
      `${totals.ties} ties, ${totals.problems} schedule problems.`,
  );
}

/**
 * Simulates regular seasons in several leagues (each league draws its own
 * talent, like a different real season) and prints the calibration scorecard:
 * each stat is measured per season, then averaged, as the real targets were.
 */
function runCalibration(seed: number, leagues: number, seasonsPerLeague: number): void {
  const started = process.hrtime.bigint();
  const perSeason: Record<string, number>[] = [];
  let gameCount = 0;
  for (let l = 0; l < leagues; l++) {
    const league = createLeague({ seed: seed + l, name: `League ${seed + l}` });
    for (let i = 0; i < seasonsPerLeague; i++) {
      const games: MeasuredGame[] = [];
      advanceUntil(league, (x) => x.calendar.stage === "regular");
      advanceUntil(league, (x) => x.calendar.stage !== "regular", {
        onGame: (g, output) => games.push({ homeId: g.homeId, awayId: g.awayId, output }),
      });
      perSeason.push(measureSeason(games));
      gameCount += games.length;
      advanceUntil(league, (x) => x.calendar.stage === "complete");
      advance(league);
    }
  }
  const averaged: Record<string, number> = {};
  for (const key of Object.keys(perSeason[0]!)) {
    averaged[key] = perSeason.reduce((sum, v) => sum + (v[key] ?? 0), 0) / perSeason.length;
  }
  const lines = scorecard(averaged);
  console.log(
    `\nCalibration: ${perSeason.length} simulated regular seasons (${leagues} league${leagues === 1 ? "" : "s"} from seed ${seed}, ${gameCount} games) vs. real NFL 2022-2025\n`,
  );
  console.log("stat                          simulated        real     real range          ");
  const fmt = (v: number) => (Math.abs(v) < 1.5 ? v.toFixed(3) : v.toFixed(2));
  for (const line of lines) {
    console.log(
      `${line.key.padEnd(28)} ${fmt(line.sim).padStart(10)}  ${fmt(line.real).padStart(10)}   ${`${fmt(line.range[0])} to ${fmt(line.range[1])}`.padEnd(18)}  ${line.pass ? "ok" : "MISS"}`,
    );
  }
  const passed = lines.filter((x) => x.pass).length;
  const total = Number(process.hrtime.bigint() - started) / 1e9;
  console.log(`\n${passed} of ${lines.length} inside the real range (${total.toFixed(1)} s).`);
}
