/**
 * Headless runner: simulates leagues from the command line, for calibration
 * runs and experiments.
 *
 *   npm run sim -- --new-league --seed 42                 summary of a generated league
 *   npm run sim -- --new-league --seed 42 --out l.json    also write the league file
 *   npm run sim -- --seasons 10 --seed 42                 simulate seasons, checking every schedule
 *   npm run sim -- --calibrate [--leagues 4 --seasons 2 --seed 42]   compare simulated seasons with real NFL ranges
 *   npm run sim -- --calibrate --league pipeline/private/out/real-league-2026.json   the same, from the real league
 *   npm run sim -- --carousel 10 [--seed 42] [--league file]   head-coach changes, firings, hires, retirements vs. real
 *   npm run sim -- --coaching 2 [--seed 42] [--league file]   how much teams differ in style, sim vs. real
 *   npm run sim -- --injuries 3 [--seed 42] [--league file]   injuries, report statuses and reserve lists vs. real
 *   npm run sim -- --lifecycle 30 [--seed 42] [--league file] [--out file]   long run: age mix, starter quality, stars, careers
 *   npm run sim -- --draft 20 [--seed 42] [--league file]   how drafts turn out by round vs. real hit rates
 *   npm run sim -- --market 10 [--seed 42] [--league file]   free agency and contracts vs. the real market
 */
import { readFileSync, writeFileSync } from "node:fs";
import REAL_DRAFT from "../../../calibration/draft.json";
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
  draftOutcomes,
  draftOutcomesByPick,
  marketSeason,
  REAL_MOVEMENT,
  disputeSeason,
  REAL_DISPUTES,
  capSheet,
  salaryCap,
  seasonsStarted,
  validateSchedule,
  checkLegal,
  setTransactionAudit,
  fingerprint,
  playersView,
  serializeLeague,
  teamView,
  parseLeague,
  startRealLeague,
  careerSummary,
  injurySeason,
  teamTendencies,
  tendencySpread,
  type TeamGame,
  lifecycleSnapshot,
  reportCounts,
  REAL_INJURIES,
  realAgeMix,
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

/** A path as the person typed it (npm runs the runner from apps/runner). */
function fromCaller(path: string): string {
  return resolve(process.env["INIT_CWD"] ?? process.cwd(), path);
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

const carouselArg = option(args, "--carousel");
if (carouselArg !== undefined) {
  runCarousel(readSeed(args), Number(carouselArg), option(args, "--league"));
  process.exit(0);
}

const coachingArg = option(args, "--coaching");
if (coachingArg !== undefined) {
  runCoaching(readSeed(args), Number(coachingArg), option(args, "--league"));
  process.exit(0);
}

const injuriesArg = option(args, "--injuries");
if (injuriesArg !== undefined) {
  runInjuries(readSeed(args), Number(injuriesArg), option(args, "--league"));
  process.exit(0);
}

const marketArg = option(args, "--market");
if (marketArg !== undefined) {
  runMarketReport(readSeed(args), Number(marketArg), option(args, "--league"));
  process.exit(0);
}

const draftArg = option(args, "--draft");
if (draftArg !== undefined) {
  runDraftReport(readSeed(args), Number(draftArg), option(args, "--league"));
  process.exit(0);
}

const lifecycleArg = option(args, "--lifecycle");
if (lifecycleArg !== undefined) {
  runLifecycle(
    readSeed(args),
    Number(lifecycleArg),
    option(args, "--league"),
    option(args, "--out"),
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
/**
 * A league to measure from a file: the real league's starting file becomes a new game; any
 * other saved league (say, one 30 seasons on) carries on from where it is, with its own seed.
 */
function fromFile(base: League, seed: number): League {
  if (base.meta.kind === "real") return startRealLeague(base, { name: `League ${seed}`, seed });
  const league = parseLeague(serializeLeague(base));
  league.meta.seed = seed;
  return league;
}

/** `base`: start every league from this file (the real league, or a saved league) instead of generating one. */
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
      ? fromFile(base, seed + l)
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

/**
 * The long run (Phase 9): simulates many seasons and prints, after each, the league's age mix,
 * its starters' average overall, its stars, and the player pool; at the end, career lengths
 * by position next to the real ones.
 */
function runLifecycle(seed: number, count: number, file?: string, out?: string): void {
  if (!Number.isInteger(count) || count < 1)
    throw new Error("--lifecycle must be a whole number of seasons");
  const started = process.hrtime.bigint();
  const league = file
    ? startRealLeague(parseLeague(readFileSync(fromCaller(file), "utf8")), {
        name: "Lifecycle",
        seed,
      })
    : createLeague({ seed, name: `League ${seed}` });
  const first = league.season;
  const real = realAgeMix();
  console.log(
    `\nLifecycle: ${count} seasons from seed ${seed}${file ? " (real league)" : ""}. Real age mix (2025): mean ${real.mean}, percentiles ${real.quantiles.join("/")}\n`,
  );
  console.log(
    "season  age mean  age 10/25/50/75/90   starters  roster  90+  80+  on teams  free agents  retired  drafted",
  );
  for (let i = 0; i < count; i++) {
    const before = league.transactions.length;
    advanceUntil(league, (l) => l.calendar.stage === "complete");
    const s = lifecycleSnapshot(league);
    advance(league); // the next offseason: retirements
    const moves = league.transactions.slice(before);
    const n = (type: string) => moves.filter((m) => m.type === type).length;
    console.log(
      `${s.season}    ${s.age.mean.toFixed(2).padStart(8)}  ${s.age.quantiles.join("/").padEnd(18)}  ${s.starterOverall.toFixed(1).padStart(8)}  ${s.rosterOverall.toFixed(1).padStart(6)}  ${String(s.stars.ninety).padStart(3)}  ${String(s.stars.eighty).padStart(3)}  ${String(s.pool.onTeams).padStart(8)}  ${String(s.pool.freeAgents).padStart(11)}  ${String(n("retired")).padStart(7)}  ${String(n("drafted")).padStart(7)}`,
    );
  }
  // Careers: players who entered in the first seasons of the run (long enough ago to have finished).
  const lastEntry = first + Math.max(0, count - 12);
  console.log(
    `\nCareers of players who entered ${first + 1}-${lastEntry} (seasons from first to last; real: classes 2000-2012):`,
  );
  console.log(
    "group  players  seasons (sim / real)  10/25/50/75/90    last-season age (sim / real)",
  );
  for (const c of careerSummary(league, first + 1, lastEntry))
    console.log(
      `${c.group.padEnd(5)}  ${String(c.players).padStart(7)}  ${c.seasonsMean.toFixed(1).padStart(7)} / ${c.real ? c.real.seasonsMean.toFixed(1) : "-"}        ${c.seasonsQuantiles.join("/").padEnd(15)}  ${c.lastSeasonAgeMean.toFixed(1)} / ${c.real ? c.real.lastSeasonAgeMean.toFixed(1) : "-"}`,
    );
  const seconds = Number(process.hrtime.bigint() - started) / 1e9;
  console.log(`\n${count} seasons in ${seconds.toFixed(0)} s.`);
  // The league as it ended, e.g. to run the scorecard on season 10: --calibrate --league <file>.
  if (out) {
    writeFileSync(fromCaller(out), serializeLeague(league));
    console.log(`Wrote ${out}`);
  }
}

/**
 * Drafts (Phase 11): simulates seasons, then compares how each round's picks turned out with
 * real drafts (calibration/draft.json): starters for 3+ seasons, never started, seasons started.
 * Only classes with long enough careers count: at least `minSeasons` seasons since the draft.
 */
function runDraftReport(seed: number, count: number, file?: string): void {
  if (!Number.isInteger(count) || count < 8)
    throw new Error("--draft needs at least 8 seasons, so classes have careers to judge");
  const started = process.hrtime.bigint();
  const league = file
    ? fromFile(parseLeague(readFileSync(fromCaller(file), "utf8")), seed)
    : createLeague({ seed, name: `League ${seed}` });
  const first = league.season;
  console.log(`\nDrafts: ${count} seasons from seed ${seed}${file ? " (real league)" : ""}\n`);
  console.log(
    "season  picks  compensatory  draft-day trades  price (median)   first-round busts so far",
  );
  const prices: number[] = [];
  let trades = 0;
  let drafts = 0;
  for (let i = 0; i < count; i++) {
    // Draft day: count the picks, compensatory picks and trades.
    advanceUntil(league, (l) => l.calendar.stage === "draft" || l.calendar.stage === "complete");
    const draftLine = { picks: 0, comp: 0, trades: 0, price: "  -" };
    if (league.calendar.stage === "draft") {
      const before = league.transactions.length;
      const day = league.date;
      advance(league);
      const deals = league.transactions
        .slice(before)
        .filter((t) => t.type === "traded" && t.date === day && t.reason.includes("moved up"));
      const ratios = deals
        .map((t) => Number(/worth ([\d.]+) times/.exec(t.reason)?.[1]))
        .filter((x) => x > 0)
        .sort((a, b) => a - b);
      prices.push(...ratios);
      trades += deals.length;
      drafts += 1;
      const picks = league.draftPicks.filter((p) => p.season === league.season);
      draftLine.picks = picks.length;
      draftLine.comp = picks.filter((p) => p.compensatory !== null).length;
      draftLine.trades = deals.length;
      draftLine.price = ratios.length ? ratios[Math.floor(ratios.length / 2)]!.toFixed(2) : "  -";
    }
    advanceUntil(league, (l) => l.calendar.stage === "complete");
    advance(league);
    const busts = league.players.filter(
      (p) =>
        p.drafted?.round === 1 &&
        p.drafted.season >= first &&
        p.drafted.season <= league.season - 4 &&
        seasonsStarted(p) === 0,
    ).length;
    console.log(
      `${league.season - 1}    ${String(draftLine.picks).padStart(5)}  ${String(draftLine.comp).padStart(12)}  ${String(draftLine.trades).padStart(16)}  ${draftLine.price.padStart(14)}   ${String(busts).padStart(8)}`,
    );
  }
  prices.sort((a, b) => a - b);
  const q = (p: number) => prices[Math.floor(p * (prices.length - 1))]?.toFixed(2) ?? "-";
  console.log(
    `\nDraft-day trades: ${(trades / Math.max(1, drafts)).toFixed(1)} a draft (real ${REAL_DRAFT.trades.perDraft}); price median ${q(0.5)}, middle half ${q(0.25)}-${q(0.75)} (real ${REAL_DRAFT.trades.pickOnlyPrice.median}, ${REAL_DRAFT.trades.pickOnlyPrice.p25}-${REAL_DRAFT.trades.pickOnlyPrice.p75}).`,
  );
  const last = league.season - 1;
  const report = (from: number, to: number, label: string) => {
    console.log(`\n${label}: classes ${from}-${to}`);
    console.log(
      "round  picks   starter 3+ (sim / real)   never started (sim / real)   seasons started (sim / real)",
    );
    for (const r of draftOutcomes(league, from, to))
      console.log(
        `${String(r.round).padStart(5)}  ${String(r.players).padStart(5)}   ${pct(r.starter3Plus)} / ${pct(r.real?.starter3Plus)}             ${pct(r.neverStarted)} / ${pct(r.real?.neverStarted)}                ${r.meanSeasonsStarted.toFixed(2)} / ${r.real?.meanSeasonsStarted.toFixed(2) ?? "-"}`,
      );
  };
  report(first, last - 6, "Hit rates by round (6+ seasons since the draft)");
  console.log(`\nBy overall pick (the fairer comparison): classes ${first}-${last - 6}`);
  console.log(
    "picks     players  starter 3+ (sim / real)   never started (sim / real)   seasons started (sim / real)",
  );
  for (const r of draftOutcomesByPick(league, first, last - 6))
    console.log(
      `${r.picks.padEnd(8)}  ${String(r.players).padStart(6)}   ${pct(r.starter3Plus)} / ${pct(r.real?.starter3Plus)}             ${pct(r.neverStarted)} / ${pct(r.real?.neverStarted)}                ${r.meanSeasonsStarted.toFixed(2)} / ${r.real?.meanSeasonsStarted.toFixed(2) ?? "-"}`,
    );
  if (last - 10 >= first) report(first, last - 10, "Full careers (10+ seasons since the draft)");
  const gems = league.players.filter(
    (p) =>
      p.drafted &&
      p.drafted.season >= first &&
      p.drafted.round >= 5 &&
      p.drafted.season <= last - 6 &&
      seasonsStarted(p) >= 3,
  ).length;
  const busts = league.players.filter(
    (p) =>
      p.drafted?.round === 1 &&
      p.drafted.season >= first &&
      p.drafted.season <= last - 6 &&
      seasonsStarted(p) === 0,
  ).length;
  console.log(
    `\nFirst-round busts (never started): ${busts}. Late-round gems (rounds 5-7, started 3+ seasons): ${gems}.`,
  );
  const seconds = Number(process.hrtime.bigint() - started) / 1e9;
  console.log(`${count} seasons in ${seconds.toFixed(0)} s.`);
}

/**
 * Free agency (Phase 12): simulates seasons and prints each League Year's market next to the
 * real one (calibration/market.json): free agents who changed teams, re-signings, extensions,
 * tags, offer sheets, how fast deals came, and top free agents' pay against the real range.
 */
function runMarketReport(seed: number, count: number, file?: string): void {
  if (!Number.isInteger(count) || count < 1)
    throw new Error("--market must be a whole number of seasons");
  const started = process.hrtime.bigint();
  const league = file
    ? fromFile(parseLeague(readFileSync(fromCaller(file), "utf8")), seed)
    : createLeague({ seed, name: `League ${seed}` });
  const real = REAL_MOVEMENT;
  console.log(
    `\nThe market: ${count} League Years from seed ${seed}${file ? " (real league)" : ""}\n`,
  );
  console.log(
    "season  new team (1%+)   re-signed (1%+)   extend   tags  tenders  sheets  days 0-2/3-6/7+   top tiers in real range",
  );
  const totals = {
    newTeam: 0,
    paid: 0,
    resigned: 0,
    resignedPaid: 0,
    ext: 0,
    tags: 0,
    inRange: 0,
    deals: 0,
    seasons: 0,
    camp: 0,
    requests: 0,
    disputeSeasons: 0,
  };
  for (let i = 0; i < count; i++) {
    // Through the next League Year's free agency to the draft, then the rest of the season.
    advanceUntil(league, (l) => l.calendar.stage === "free-agency");
    // Each team's room as free agency opens (share of the cap), the median.
    const rooms = league.teams
      .map(
        (t) =>
          capSheet(league, t.id, league.season).room / salaryCap(league.rules.cap, league.season),
      )
      .sort((a, b) => a - b);
    const medianRoom = rooms[Math.floor(rooms.length / 2)]!;
    // Through late free agency (to camp), as real counts include the whole year's signings.
    advanceUntil(league, (l) => l.calendar.stage === "preseason");
    const s = marketSeason(league, league.season);
    advanceUntil(league, (l) => l.calendar.stage === "complete");
    const disputes = disputeSeason(league, league.season);
    advance(league);
    const f = (x: number) => `${Math.round(x * 100)}%`;
    console.log(
      `${s.season} (room ${Math.round(medianRoom * 100)}%)  ${String(s.freeAgentsNewTeam).padStart(5)} (${String(s.freeAgentsNewTeamPaid1Pct).padStart(3)})    ${String(s.reSigned).padStart(5)} (${String(s.reSignedPaid1Pct).padStart(3)})     ${String(s.extensionsPaid5Pct).padStart(5)}  ${String(s.franchiseTags).padStart(4)}  ${String(s.tenders).padStart(7)}  ${String(s.offerSheets).padStart(6)}  ${f(s.timing.first3Days)}/${f(s.timing.firstWeek)}/${f(s.timing.later)}       ${s.topTierInRange.inRange} of ${s.topTierInRange.deals}`,
    );
    const o = disputes.outcomes;
    console.log(
      `             disputes: ${disputes.holdouts} holdouts, ${disputes.holdIns} hold-ins, ${disputes.tradeRequests} trade requests (extended ${o.extended}, traded ${o.traded}, reported ${o.reported}, withdrawn ${o.withdrawn}, left ${o.released}, open ${o.open}); fines $${(disputes.fines / 1e6).toFixed(2)}M; mood ${disputes.mood.mean.toFixed(1)}, ${f(disputes.mood.angry)} angry`,
    );
    totals.camp += disputes.holdouts + disputes.holdIns;
    totals.requests += disputes.tradeRequests;
    totals.disputeSeasons += 1;
    if (s.freeAgentsNewTeam === 0) continue; // a new league's first year: nobody's deal ran out
    totals.newTeam += s.freeAgentsNewTeam;
    totals.paid += s.freeAgentsNewTeamPaid1Pct;
    totals.resigned += s.reSigned;
    totals.resignedPaid += s.reSignedPaid1Pct;
    totals.ext += s.extensionsPaid5Pct;
    totals.tags += s.franchiseTags;
    totals.inRange += s.topTierInRange.inRange;
    totals.deals += s.topTierInRange.deals;
    totals.seasons += 1;
    if (i === count - 1) {
      console.log(
        "\nThe last year's top free agent at each position (share of the cap) vs. the real range for a year's best:",
      );
      for (const t of s.topByPosition)
        console.log(
          `  ${t.position.padEnd(5)} ${(t.share * 100).toFixed(1).padStart(5)}%   real ${(t.real[0] * 100).toFixed(1)}-${(t.real[1] * 100).toFixed(1)}%`,
        );
    }
  }
  const per = (x: number) => (x / Math.max(1, totals.seasons)).toFixed(1);
  console.log(
    `\nA year on average: ${per(totals.newTeam)} free agents to new teams (real ${real.freeAgentsNewTeam}), ${per(totals.paid)} paid 1%+ of the cap (real ${real.freeAgentsNewTeamPaid1Pct}); ${per(totals.resigned)} re-signed (real ${real.reSigned}), ${per(totals.resignedPaid)} paid 1%+ (real ${real.reSignedPaid1Pct}); ${per(totals.ext)} extensions (real: ${real.extensionsPaid5Pct} worth 5%+ of the cap, ${real.extensions} in all). Top-tier free agents inside the real range: ${totals.inRange} of ${totals.deals} (${Math.round((100 * totals.inRange) / Math.max(1, totals.deals))}%).`,
  );
  const perD = (x: number) => (x / Math.max(1, totals.disputeSeasons)).toFixed(1);
  console.log(
    `Disputes a year: ${perD(totals.camp)} holdouts and hold-ins (real about ${REAL_DISPUTES.campDisputes.join("-")}), ${perD(totals.requests)} trade requests (real about ${REAL_DISPUTES.tradeRequests.join("-")}).`,
  );
  const seconds = Number(process.hrtime.bigint() - started) / 1e9;
  console.log(`${count} League Years in ${seconds.toFixed(0)} s.`);
}

function pct(x: number | undefined): string {
  return x === undefined ? "  -" : `${(x * 100).toFixed(0).padStart(3)}%`;
}

/**
 * Injuries (Phase 9b): simulates seasons and prints, per season, injuries that cost games (in
 * games and at practice), injured-reserve and camp lists, and the weekly injury report, next
 * to the real numbers (calibration/injuries.json).
 */
function runInjuries(seed: number, count: number, file?: string): void {
  const league = file
    ? fromFile(parseLeague(readFileSync(fromCaller(file), "utf8")), seed)
    : createLeague({ seed, name: `League ${seed}` });
  const real = REAL_INJURIES;
  const f = (x: number) => x.toFixed(2).padStart(6);
  console.log(`\nInjuries: ${count} seasons from seed ${seed}${file ? " (from file)" : ""}\n`);
  console.log(
    "season  costing games (game + practice)   IR wk1  IR during  PUP wk1  NFI wk1   Out  Doubt  Q-sits  Q-plays  Q play%",
  );
  const totals = { costing: 0, irWeek1: 0, irDuring: 0, pup: 0, nfi: 0 };
  const report = { Out: 0, Doubtful: 0, Questionable: 0, playingThrough: 0, weeks: 0 };
  const severity: Record<string, number> = {};
  for (let i = 0; i < count; i++) {
    const week = { Out: 0, Doubtful: 0, Questionable: 0, playingThrough: 0, n: 0 };
    for (let guard = 0; guard < 100 && league.calendar.stage !== "complete"; guard++) {
      advance(league);
      // The report each team files before a regular-season game.
      if (league.calendar.stage === "regular") {
        const c = reportCounts(league);
        week.Out += c.Out;
        week.Doubtful += c.Doubtful;
        week.Questionable += c.Questionable;
        week.playingThrough += c.playingThrough;
        week.n += 1;
      }
    }
    const s = injurySeason(league, league.season);
    advance(league);
    totals.costing += s.costingPerTeam.all;
    totals.irWeek1 += s.reserve.irAtWeek1;
    totals.irDuring += s.reserve.irDuring;
    totals.pup += s.reserve.pupAtWeek1;
    totals.nfi += s.reserve.nfiAtWeek1;
    for (const k of ["Out", "Doubtful", "Questionable", "playingThrough"] as const)
      report[k] += week[k];
    report.weeks += week.n;
    for (const [b, v] of Object.entries(s.severity)) severity[b] = (severity[b] ?? 0) + v / count;
    const q = week.Questionable + week.playingThrough;
    console.log(
      `${s.season}    ${f(s.costingPerTeam.all)} (${s.costingPerTeam.game.toFixed(1)} + ${s.costingPerTeam.practice.toFixed(1)})          ${f(s.reserve.irAtWeek1)}  ${f(s.reserve.irDuring)}   ${f(s.reserve.pupAtWeek1)}   ${f(s.reserve.nfiAtWeek1)}  ${f(week.Out / week.n)} ${f(week.Doubtful / week.n)}  ${f(week.Questionable / week.n)}   ${f(week.playingThrough / week.n)}   ${((week.playingThrough / Math.max(1, q)) * 100).toFixed(0).padStart(5)}%`,
    );
    if (i === count - 1) {
      console.log("\nBody parts (all listed injuries this season), sim vs. real:");
      for (const p of s.parts)
        console.log(
          `  ${p.part.padEnd(12)} ${(p.sim * 100).toFixed(1).padStart(5)}%  ${(p.real * 100).toFixed(1).padStart(5)}%`,
        );
    }
  }
  const qReal = real.statuses.Questionable;
  console.log(`\nAverage per team-season vs. real:`);
  console.log(
    `  injuries costing games  ${(totals.costing / count).toFixed(1)}  real ${real.costingPerTeam}`,
  );
  console.log(
    `  injured reserve at Week 1 ${(totals.irWeek1 / count).toFixed(2)}  real ${real.reserve.injuredReserveAtWeek1}; during the season ${(totals.irDuring / count).toFixed(2)}  real ${real.reserve.injuredReserveDuringSeason}`,
  );
  console.log(
    `  PUP at Week 1 ${(totals.pup / count).toFixed(2)}  real ${real.reserve.pupAtWeek1}; NFI ${(totals.nfi / count).toFixed(2)}  real ${real.reserve.nfiAtWeek1}`,
  );
  const w = report.weeks;
  console.log(`Injury report per team-week vs. real:`);
  console.log(
    `  Out ${(report.Out / w).toFixed(2)}  real ${real.statuses.Out.perTeamWeek}; Doubtful ${(report.Doubtful / w).toFixed(2)}  real ${real.statuses.Doubtful.perTeamWeek}`,
  );
  console.log(
    `  Questionable ${((report.Questionable + report.playingThrough) / w).toFixed(2)}  real ${qReal.perTeamWeek}, of whom ${((report.playingThrough / Math.max(1, report.Questionable + report.playingThrough)) * 100).toFixed(0)}% play  real ${(qReal.playRate * 100).toFixed(0)}%`,
  );
  console.log(`Severity of injuries costing games, sim vs. real:`);
  const realCosting = Object.entries(real.severity).filter(([b]) => b !== "0");
  const realTotal = realCosting.reduce((a, [, v]) => a + v, 0);
  for (const [b, v] of realCosting)
    console.log(
      `  ${b.padEnd(4)} ${((severity[b] ?? 0) * 100).toFixed(1).padStart(5)}%  ${((v / realTotal) * 100).toFixed(1).padStart(5)}%`,
    );
}

/**
 * Coaching styles (Phase 10): plays seasons and prints how much teams differ in each tendency
 * (pass rate, deep shots, personnel, blitzes, man coverage, 4th downs), sim vs. real, one
 * season at a time, averaged.
 */
function runCoaching(seed: number, count: number, file?: string): void {
  const league = file
    ? fromFile(parseLeague(readFileSync(fromCaller(file), "utf8")), seed)
    : createLeague({ seed, name: `League ${seed}` });
  const sums = new Map<
    string,
    { sim: number; real: number; simMean: number; realMean: number; label: string }
  >();
  for (let i = 0; i < count; i++) {
    const games: TeamGame[] = [];
    advanceUntil(league, (l) => l.calendar.stage === "regular");
    advanceUntil(league, (l) => l.calendar.stage !== "regular", {
      onGame: (g, output) => games.push({ homeId: g.homeId, awayId: g.awayId, output }),
    });
    for (const line of tendencySpread(teamTendencies(games))) {
      const s = sums.get(line.key) ?? {
        sim: 0,
        real: 0,
        simMean: 0,
        realMean: 0,
        label: line.label,
      };
      s.sim += line.sim / count;
      s.real = line.real;
      s.simMean += line.simMean / count;
      s.realMean = line.realMean;
      sums.set(line.key, s);
    }
    advanceUntil(league, (l) => l.calendar.stage === "complete");
    advance(league);
  }
  console.log(
    `\nHow much teams differ (standard deviation across teams, one season), seed ${seed}, ${count} seasons:\n`,
  );
  console.log("tendency                    sim spread  real spread   sim mean  real mean");
  for (const [key, s] of sums)
    console.log(
      `${key.padEnd(26)}  ${s.sim.toFixed(3).padStart(10)}  ${s.real.toFixed(3).padStart(11)}  ${s.simMean.toFixed(3).padStart(9)}  ${s.realMean.toFixed(3).padStart(9)}`,
    );
}

/**
 * The coaching carousel (Phase 10b): plays seasons and counts head-coach changes the way the
 * real numbers were counted (calibration/coaching.json): a team's opening-day head coach
 * different from last season's, and opening-day coaches gone before the season ended.
 */
function runCarousel(seed: number, count: number, file?: string): void {
  const league = file
    ? fromFile(parseLeague(readFileSync(fromCaller(file), "utf8")), seed)
    : createLeague({ seed, name: `League ${seed}` });
  const real = JSON.parse(
    readFileSync(resolve(import.meta.dirname, "../../../calibration/coaching.json"), "utf8"),
  ).headCoachChanges;
  const hcOf = (l: League) =>
    new Map(l.coaches.filter((c) => c.role === "HC" && c.teamId).map((c) => [c.teamId!, c.id]));
  console.log(`\nCoaching carousel: ${count} seasons from seed ${seed}\n`);
  console.log(
    "season  HC changes  in-season  coordinators out  retirements  out of work  avg HC tenure",
  );
  let previous: Map<string, number> | null = null;
  let totalChanges = 0;
  let totalIn = 0;
  for (let i = 0; i < count; i++) {
    advanceUntil(league, (l) => l.calendar.stage === "regular");
    const opening = hcOf(league);
    const season = league.season;
    const changes = previous ? [...opening].filter(([t, id]) => previous!.get(t) !== id).length : 0;
    advanceUntil(league, (l) => l.calendar.stage === "complete");
    const moves = league.coachingMoves.filter((m) => m.season === season);
    const inSeason = moves.filter((m) => m.kind === "interim").length;
    const coordinators = moves.filter(
      (m) => (m.kind === "fired" || m.kind === "left") && (m.role === "OC" || m.role === "DC"),
    ).length;
    advance(league); // offseason staffing
    const retired = league.coachingMoves.filter(
      (m) => m.season === season && m.kind === "retired",
    ).length;
    const idle = league.coaches.filter((c) => c.teamId === null && c.retiredAfter === null).length;
    const tenures = league.coaches
      .filter((c) => c.role === "HC" && c.teamId)
      .map((c) => {
        let n = 0;
        for (
          let j = c.career.length - 1;
          j >= 0 && c.career[j]!.teamId === c.teamId && c.career[j]!.role === "HC";
          j--
        )
          n += 1;
        return n;
      });
    const avgTenure = tenures.reduce((a, b) => a + b, 0) / tenures.length;
    if (previous) {
      totalChanges += changes;
      totalIn += inSeason;
    }
    console.log(
      `${season}    ${previous ? String(changes).padStart(9) : "        -"}  ${String(inSeason).padStart(9)}  ${String(coordinators).padStart(16)}  ${String(retired).padStart(11)}  ${String(idle).padStart(11)}  ${avgTenure.toFixed(1).padStart(13)}`,
    );
    previous = opening;
  }
  console.log(
    `\nAverage head-coach changes between seasons ${(totalChanges / Math.max(1, count - 1)).toFixed(2)} (real ${real.betweenMean}); during seasons ${(totalIn / Math.max(1, count - 1)).toFixed(2)} (real ${real.duringMean}).`,
  );
}
