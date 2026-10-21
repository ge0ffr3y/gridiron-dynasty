/**
 * Headless runner: simulates leagues from the command line, for calibration
 * runs and experiments.
 *
 *   npm run sim -- --new-league --seed 42                 summary of a generated league
 *   npm run sim -- --new-league --seed 42 --out l.json    also write the league file
 *   npm run sim -- --seasons 10 --seed 42                 simulate seasons, checking every schedule
 *   npm run sim -- --calibrate [--leagues 4 --seasons 2 --seed 42]   compare simulated seasons with real NFL ranges
 *   npm run sim -- --calibrate --league pipeline/private/out/real-league-2026.json   the same, from the real league
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  GAME_ENGINE_VERSION,
  measurePlayers,
  measureSeason,
  playerScorecard,
  scorecard,
  type MeasuredGame,
} from "@fgm/game-engine";
import {
  POSITIONS,
  SIM_CORE_VERSION,
  advance,
  advanceUntil,
  createLeague,
  validateSchedule,
  checkLegal,
  setTransactionAudit,
  fingerprint,
  playersView,
  serializeLeague,
  teamView,
  parseLeague,
  startRealLeague,
  type League,
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
  const leagueFile = option(args, "--league");
  runCalibration(
    readSeed(args),
    Number(option(args, "--leagues") ?? 4),
    Number(option(args, "--seasons") ?? 2),
    // npm runs this from apps/runner; paths are relative to where the command was typed.
    leagueFile
      ? parseLeague(
          readFileSync(resolve(process.env["INIT_CWD"] ?? process.cwd(), leagueFile), "utf8"),
        )
      : null,
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
    `\nSeed ${seed}: simulating ${count} full League Year${count === 1 ? "" : "s"} (draft, camp, preseason, cuts, 18 weeks, playoffs) snap by snap, checking every roster rule after every move.\n`,
  );
  console.log(
    "season  champion  runner-up  score    best record     pts/team/game  home win%  ties  schedule  drafted  cut  claimed  IR  retired",
  );
  const totals = { points: 0, games: 0, homeWins: 0, ties: 0, problems: 0 };
  // Every transaction is checked against the roster and cap rules; a break stops the run.
  setTransactionAudit(checkLegal);
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
    const before = league.transactions.length;
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
    advance(league); // next offseason (retirements happen here)
    const moves = league.transactions.slice(before);
    const count = (type: string) => moves.filter((m) => m.type === type).length;
    console.log(
      `${h.season}    ${h.championId.padEnd(8)}  ${h.runnerUpId.padEnd(9)}  ${score.padEnd(7)}  ${`${best.teamId} ${best.wins}-${best.losses}-${best.ties}`.padEnd(14)}  ${(points / regular.length / 2).toFixed(1).padStart(13)}  ${((homeWins / regular.length) * 100).toFixed(1).padStart(9)}  ${String(ties).padStart(4)}  ${problems.length === 0 ? "valid   " : `${problems.length} problems`}  ${String(count("drafted")).padStart(7)}  ${String(count("released") + count("claimed")).padStart(4)}  ${String(count("claimed")).padStart(7)}  ${String(moves.filter((m) => m.type === "reserve" && m.text.includes("injured reserve")).length).padStart(3)}  ${String(count("retired")).padStart(7)}`,
    );
    if (problems.length > 0) for (const p of problems.slice(0, 5)) console.log(`        ${p}`);
  }
  setTransactionAudit(null);
  const seconds = Number(process.hrtime.bigint() - started) / 1e9;
  console.log(
    `\n${count} seasons in ${seconds.toFixed(1)} s (${((seconds / count) * 1000).toFixed(0)} ms per season), every roster legal after every move. ` +
      `Average ${(totals.points / totals.games / 2).toFixed(1)} points per team per game, home teams won ${((totals.homeWins / totals.games) * 100).toFixed(1)}%, ` +
      `${totals.ties} ties, ${totals.problems} schedule problems.`,
  );
}

/**
 * Simulates regular seasons in several leagues (each league draws its own
 * talent, like a different real season) and prints the calibration scorecard:
 * each stat is measured per season, then averaged, as the real targets were.
 */
/** `base`: start every league from this file (the real league) instead of generating one. */
function runCalibration(
  seed: number,
  leagues: number,
  seasonsPerLeague: number,
  base: League | null,
): void {
  const started = process.hrtime.bigint();
  const perSeason: Record<string, number>[] = [];
  const perSeasonPlayers: Record<string, number>[] = [];
  let gameCount = 0;
  for (let l = 0; l < leagues; l++) {
    const league = base
      ? startRealLeague(base, { name: `League ${seed + l}`, seed: seed + l })
      : createLeague({ seed: seed + l, name: `League ${seed + l}` });
    for (let i = 0; i < seasonsPerLeague; i++) {
      const games: MeasuredGame[] = [];
      advanceUntil(league, (x) => x.calendar.stage === "regular");
      advanceUntil(league, (x) => x.calendar.stage !== "regular", {
        onGame: (g, output) =>
          games.push({
            homeId: g.homeId,
            awayId: g.awayId,
            output,
            ...(g.weather ? { conditions: g.weather } : {}),
          }),
      });
      perSeason.push(measureSeason(games));
      const positions = new Map(league.players.map((p) => [p.id, p.position]));
      perSeasonPlayers.push(measurePlayers(games, (id) => positions.get(id)));
      gameCount += games.length;
      advanceUntil(league, (x) => x.calendar.stage === "complete");
      advance(league);
    }
  }
  const average = (list: Record<string, number>[]) => {
    const out: Record<string, number> = {};
    for (const key of Object.keys(list[0]!))
      out[key] = list.reduce((sum, v) => sum + (v[key] ?? 0), 0) / list.length;
    return out;
  };
  const lines = scorecard(average(perSeason));
  const playerLines = playerScorecard(average(perSeasonPlayers));
  console.log(
    `\nCalibration: ${perSeason.length} simulated regular seasons (${leagues} ${base ? "real-roster " : ""}league${leagues === 1 ? "" : "s"} from seed ${seed}, ${gameCount} games) vs. real NFL 2022-2025\n`,
  );
  console.log("stat                          simulated        real     real range          ");
  const fmt = (v: number) => (Math.abs(v) < 1.5 ? v.toFixed(3) : v.toFixed(2));
  const print = (list: typeof lines) => {
    for (const line of list) {
      console.log(
        `${line.key.padEnd(28)} ${fmt(line.sim).padStart(10)}  ${fmt(line.real).padStart(10)}   ${`${fmt(line.range[0])} to ${fmt(line.range[1])}`.padEnd(18)}  ${line.pending ? "later" : line.info ? "info" : line.pass ? "ok" : "MISS"}`,
      );
    }
  };
  print(lines);
  const passed = lines.filter((x) => x.pass && !x.pending && !x.info).length;
  const counted = lines.filter((x) => !x.pending && !x.info).length;
  console.log(`\n${passed} of ${counted} league stats inside the real range.`);
  console.log(
    "\nPlayer level (leaderboard values at each rank; snap shares within 6 points of real)\n",
  );
  print(playerLines);
  const playersPassed = playerLines.filter((x) => x.pass).length;
  const total = Number(process.hrtime.bigint() - started) / 1e9;
  console.log(
    `\n${playersPassed} of ${playerLines.length} player-level stats inside the real range (${total.toFixed(1)} s).`,
  );
}
