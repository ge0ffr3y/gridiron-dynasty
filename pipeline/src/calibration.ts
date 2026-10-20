/**
 * Calibration targets from real NFL play-by-play (nflverse, CC-BY-4.0).
 *
 *   npm run pipeline -- calibration
 *
 * Downloads (once) the 2022-2025 play-by-play files into pipeline/cache/,
 * then writes calibration/targets.json:
 *  - `targets`: league-wide numbers per season, with the real range the
 *    simulation should land in (used by the scorecard and a CI test);
 *  - `reference`: shapes the engine is fitted to (yardage distributions,
 *    pass rate by down and distance, 4th-down habits, kicking by distance).
 * Only regular-season plays count; plays wiped out by penalties are skipped.
 */
import { createReadStream, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createGunzip } from "node:zlib";
import { parse } from "csv-parse";

const SEASONS = [2022, 2023, 2024, 2025];
/** Kickoff rules changed in 2025 (touchback to the 35), so kickoff numbers use 2025 only. */
const KICKOFF_SEASONS = [2025];
const ROOT = join(import.meta.dirname, "..", "..");
const CACHE = join(ROOT, "pipeline", "cache", "nflverse");
const OUT = join(ROOT, "calibration", "targets.json");
const url = (season: number) =>
  `https://github.com/nflverse/nflverse-data/releases/download/pbp/play_by_play_${season}.csv.gz`;

type Row = Record<string, string>;

async function download(season: number): Promise<string> {
  mkdirSync(CACHE, { recursive: true });
  const file = join(CACHE, `play_by_play_${season}.csv.gz`);
  if (existsSync(file)) return file;
  console.log(`Downloading ${season} play-by-play...`);
  const response = await fetch(url(season));
  if (!response.ok) throw new Error(`download failed for ${season}: ${response.status}`);
  writeFileSync(file, Buffer.from(await response.arrayBuffer()));
  return file;
}

async function readRows(file: string, onRow: (row: Row) => void): Promise<void> {
  const parser = createReadStream(file)
    .pipe(createGunzip())
    .pipe(parse({ columns: true, relax_column_count: true }));
  for await (const row of parser) onRow(row as Row);
}

const num = (v: string | undefined) =>
  v === undefined || v === "" || v === "NA" ? NaN : Number(v);
const flag = (v: string | undefined) => v === "1" || v === "1.0" || v === "TRUE";

function quantiles(values: number[], points: number[]): number[] {
  const sorted = [...values].sort((a, b) => a - b);
  return points.map((p) => {
    const i = Math.min(sorted.length - 1, Math.max(0, Math.round(p * (sorted.length - 1))));
    return sorted[i] as number;
  });
}
const QUANTILE_POINTS = [
  0.01, 0.02, 0.05, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 0.95, 0.98, 0.99, 0.995,
];
const mean = (values: number[]) => values.reduce((a, b) => a + b, 0) / Math.max(1, values.length);
const round = (v: number, digits = 4) => Math.round(v * 10 ** digits) / 10 ** digits;

class Counter {
  readonly counts = new Map<string, number>();
  add(key: string, n = 1) {
    this.counts.set(key, (this.counts.get(key) ?? 0) + n);
  }
  get(key: string) {
    return this.counts.get(key) ?? 0;
  }
}

function distanceBucket(togo: number): string {
  return togo <= 1 ? "1" : togo <= 3 ? "2-3" : togo <= 6 ? "4-6" : togo <= 10 ? "7-10" : "11+";
}
function fieldZone(yardline100: number): string {
  return yardline100 > 60
    ? "own-deep"
    : yardline100 > 40
      ? "midfield"
      : yardline100 > 20
        ? "plus-territory"
        : "red-zone";
}

interface SeasonStats {
  season: number;
  values: Record<string, number>;
}

/** Everything we measure for one season (and shapes pooled across seasons). */
async function analyseSeason(season: number, pooled: Pooled): Promise<SeasonStats> {
  const c = new Counter();
  const games = new Map<string, { home: number; away: number }>();
  const drives = new Set<string>();
  const gameTeams = new Map<string, { home: string; away: string }>();

  await readRows(await download(season), (r) => {
    if (r["season_type"] !== "REG") return;
    const gameId = r["game_id"] as string;
    if (!games.has(gameId)) {
      games.set(gameId, { home: num(r["home_score"]), away: num(r["away_score"]) });
      gameTeams.set(gameId, { home: r["home_team"] as string, away: r["away_team"] as string });
    }
    const type = r["play_type"];
    const pos = r["posteam"];
    if (!type || type === "no_play") return;
    if (pos && r["fixed_drive"]) drives.add(`${gameId}:${r["fixed_drive"]}:${pos}`);
    const down = num(r["down"]);
    const togo = num(r["ydstogo"]);
    const yl = num(r["yardline_100"]);
    const yards = num(r["yards_gained"]);
    const sack = flag(r["sack"]);
    const scramble = flag(r["qb_scramble"]);
    const complete = flag(r["complete_pass"]);
    const incomplete = flag(r["incomplete_pass"]);
    const int = flag(r["interception"]);
    const scoreDiff = Math.abs(num(r["posteam_score"]) - num(r["defteam_score"]));
    const qtr = num(r["qtr"]);
    const neutral = qtr <= 3 && scoreDiff <= 10;

    if (type === "pass" || type === "run" || type === "qb_kneel" || type === "qb_spike") {
      c.add("offPlays");
      if (!Number.isNaN(yards)) c.add("offYards", yards);
    }
    if (type === "pass") {
      c.add("dropbacks");
      if (sack) {
        c.add("sacks");
        pooled.sackYards.push(yards);
        if (flag(r["fumble"])) pooled.c.add("sackFumbles");
        pooled.c.add("sacksAll");
      } else {
        c.add("attempts");
        if (complete) {
          c.add("completions");
          c.add("passYards", yards);
        }
        if (int) c.add("ints");
        const air = num(r["air_yards"]);
        if (!Number.isNaN(air)) {
          const depth = air < 10 ? "short" : air < 20 ? "medium" : "deep";
          pooled.c.add(`throws:${depth}`);
          if (complete) {
            pooled.c.add(`completions:${depth}`);
            pooled.air[depth]!.push(air);
            const yac = num(r["yards_after_catch"]);
            if (!Number.isNaN(yac)) pooled.yac[depth]!.push(yac);
            if (flag(r["fumble"])) pooled.c.add("catchFumbles");
            if (flag(r["fumble_lost"])) pooled.c.add("catchFumblesLost");
            pooled.c.add("catches");
          }
          if (int) {
            pooled.c.add(`ints:${depth}`);
            const ret = num(r["return_yards"]);
            if (!Number.isNaN(ret)) pooled.intReturn.push(ret);
            if (flag(r["return_touchdown"])) pooled.c.add("pickSixes");
            pooled.c.add("intsAll");
          }
        }
      }
    }
    // nflverse labels scrambles as runs; they started as dropbacks.
    if (type === "run" && scramble) {
      c.add("dropbacks");
      c.add("scrambles");
      if (!Number.isNaN(yards)) pooled.scrambleYards.push(yards);
      pooled.c.add("scramblesAll");
    }
    if (type === "run" && !scramble) {
      c.add("designedRuns");
      if (yl >= 30 && !Number.isNaN(yards)) pooled.runYards.push(yards);
      pooled.c.add("runsAll");
      if (flag(r["fumble"])) pooled.c.add("runFumbles");
      if (flag(r["fumble_lost"])) pooled.c.add("runFumblesLost");
    }
    if (type === "run" || type === "qb_kneel") {
      c.add("rushes");
      c.add("rushYards", yards);
    }
    if (flag(r["fumble_lost"])) c.add("fumblesLost");
    if ((type === "pass" || type === "run") && neutral && down >= 1 && down <= 3) {
      const key = `${down}:${distanceBucket(togo)}`;
      pooled.c.add(`downPlays:${key}`);
      if (r["qb_dropback"] === "1") pooled.c.add(`downPasses:${key}`);
    }
    if (
      down === 4 &&
      (type === "pass" || type === "run" || type === "punt" || type === "field_goal")
    ) {
      c.add("fourthDowns");
      const key = `${fieldZone(yl)}:${distanceBucket(togo)}`;
      pooled.c.add(`fourth:${key}`);
      if (type === "pass" || type === "run") {
        c.add("fourthGo");
        pooled.c.add(`fourthGo:${key}`);
      }
      if (type === "field_goal") pooled.c.add(`fourthFg:${key}`);
    }
    if (flag(r["third_down_converted"])) c.add("thirdConv");
    if (flag(r["third_down_failed"])) c.add("thirdFail");
    if (type === "punt") {
      c.add("punts");
      pooled.c.add("puntsAll");
      const dist = num(r["kick_distance"]);
      if (!Number.isNaN(dist)) pooled.puntDistance.push(dist);
      if (flag(r["punt_blocked"])) pooled.c.add("puntBlocked");
      if (flag(r["punt_fair_catch"])) pooled.c.add("puntFairCatch");
      if (flag(r["touchback"])) pooled.c.add("puntTouchback");
      if (flag(r["punt_out_of_bounds"])) pooled.c.add("puntOutOfBounds");
      const ret = num(r["return_yards"]);
      if (!Number.isNaN(ret) && !flag(r["punt_fair_catch"]) && !flag(r["touchback"]))
        pooled.puntReturn.push(ret);
    }
    if (type === "field_goal") {
      const dist = num(r["kick_distance"]);
      const made = r["field_goal_result"] === "made";
      c.add("fga");
      if (made) c.add("fgm");
      const band =
        dist < 30
          ? "18-29"
          : dist < 40
            ? "30-39"
            : dist < 50
              ? "40-49"
              : dist < 60
                ? "50-59"
                : "60+";
      c.add(`fga:${band}`);
      if (made) c.add(`fgm:${band}`);
      pooled.fgByDistance.push([dist, made ? 1 : 0]);
    }
    if (type === "extra_point") {
      c.add("xpa");
      if (r["extra_point_result"] === "good") c.add("xpm");
    }
    if (flag(r["two_point_attempt"])) {
      c.add("twoPointTries");
      pooled.c.add("twoPointTries");
      if (r["two_point_conv_result"] === "success") {
        c.add("twoPointGood");
        pooled.c.add("twoPointGood");
      }
    }
    if (flag(r["touchdown"]) && type !== "no_play") pooled.c.add("touchdowns");
    if (type === "kickoff" && KICKOFF_SEASONS.includes(season)) {
      pooled.c.add("kickoffs");
      if (flag(r["touchback"])) pooled.c.add("kickoffTouchbacks");
      if (flag(r["kickoff_out_of_bounds"])) pooled.c.add("kickoffOutOfBounds");
      if (flag(r["return_touchdown"])) pooled.c.add("kickoffReturnTds");
    }
    if (
      r["drive_start_transition"] === "KICKOFF" &&
      KICKOFF_SEASONS.includes(season) &&
      (type === "pass" || type === "run")
    ) {
      // First scrimmage play of a drive that began with a kickoff: where the drive started.
      const key = `${gameId}:${r["fixed_drive"]}`;
      if (!pooled.kickoffDriveSeen.has(key)) {
        pooled.kickoffDriveSeen.add(key);
        pooled.kickoffStart.push(100 - yl);
        // Touchbacks start at the 35 and out-of-bounds kicks at the 40; the rest were returned.
        if (100 - yl !== 35 && 100 - yl !== 40) pooled.kickoffReturnStart.push(100 - yl);
      }
    }
  });

  const g = [...games.values()];
  // How much teams differ: the spread (standard deviation) of teams' season points per game.
  const teamPoints = new Map<string, number[]>();
  for (const [id, x] of games) {
    const [home, away] = [gameTeams.get(id)!.home, gameTeams.get(id)!.away];
    teamPoints.set(home, [...(teamPoints.get(home) ?? []), x.home]);
    teamPoints.set(away, [...(teamPoints.get(away) ?? []), x.away]);
  }
  const ppg = [...teamPoints.values()].map(mean);
  const ppgMean = mean(ppg);
  const ppgSpread = Math.sqrt(mean(ppg.map((v) => (v - ppgMean) ** 2)));
  const teamGameCount = g.length * 2;
  const points = g.reduce((s, x) => s + x.home + x.away, 0);
  const values: Record<string, number> = {
    pointsPerTeamGame: points / teamGameCount,
    offensivePlaysPerTeamGame: c.get("offPlays") / teamGameCount,
    yardsPerPlay: c.get("offYards") / c.get("offPlays"),
    passRate: c.get("dropbacks") / (c.get("dropbacks") + c.get("designedRuns")),
    completionPct: c.get("completions") / c.get("attempts"),
    yardsPerAttempt: c.get("passYards") / c.get("attempts"),
    sackRate: c.get("sacks") / (c.get("attempts") + c.get("sacks")),
    interceptionRate: c.get("ints") / c.get("attempts"),
    fumblesLostPerTeamGame: c.get("fumblesLost") / teamGameCount,
    turnoversPerTeamGame: (c.get("fumblesLost") + c.get("ints")) / teamGameCount,
    yardsPerCarry: c.get("rushYards") / c.get("rushes"),
    puntsPerTeamGame: c.get("punts") / teamGameCount,
    fieldGoalPct: c.get("fgm") / c.get("fga"),
    extraPointPct: c.get("xpm") / c.get("xpa"),
    thirdDownPct: c.get("thirdConv") / (c.get("thirdConv") + c.get("thirdFail")),
    drivesPerTeamGame: drives.size / teamGameCount,
    pointsPerDrive: points / drives.size,
    fourthDownGoRate: c.get("fourthGo") / c.get("fourthDowns"),
    twoPointTriesPerTeamGame: c.get("twoPointTries") / teamGameCount,
    homeWinPct: g.filter((x) => x.home > x.away).length / g.length,
    tiesPerSeason: g.filter((x) => x.home === x.away).length,
    teamPointsPerGameSpread: ppgSpread,
  };
  for (const band of ["18-29", "30-39", "40-49", "50-59"])
    values[`fieldGoalPct ${band}`] = c.get(`fgm:${band}`) / c.get(`fga:${band}`);
  return { season, values };
}

class Pooled {
  readonly c = new Counter();
  readonly runYards: number[] = [];
  readonly sackYards: number[] = [];
  readonly scrambleYards: number[] = [];
  readonly air: Record<string, number[]> = { short: [], medium: [], deep: [] };
  readonly yac: Record<string, number[]> = { short: [], medium: [], deep: [] };
  readonly intReturn: number[] = [];
  readonly puntDistance: number[] = [];
  readonly puntReturn: number[] = [];
  readonly fgByDistance: [number, number][] = [];
  readonly kickoffStart: number[] = [];
  readonly kickoffReturnStart: number[] = [];
  readonly kickoffDriveSeen = new Set<string>();
}

/** Least-squares logistic fit p = 1 / (1 + e^-(a + b*x)) by gradient descent (for FG make rate by distance). */
function fitLogistic(points: [number, number][]): { a: number; b: number } {
  let a = 5;
  let b = -0.1;
  for (let iter = 0; iter < 20000; iter++) {
    let ga = 0;
    let gb = 0;
    for (const [x, y] of points) {
      const p = 1 / (1 + Math.exp(-(a + b * x)));
      ga += y - p;
      gb += (y - p) * x;
    }
    a += (0.5 * ga) / points.length;
    b += (0.0005 * gb) / points.length;
  }
  return { a: round(a, 4), b: round(b, 5) };
}

/** A range a simulated season should land in: the real seasons' spread plus a little room. */
function rangeOf(values: number[], key: string): [number, number] {
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const m = mean(values);
  if (key === "tiesPerSeason") return [Math.max(0, lo - 1), hi + 2];
  const room = 0.25 * (hi - lo) + 0.02 * Math.abs(m);
  // Rates (percentages) can't go past 100%.
  const cap = /Pct|Rate/.test(key) ? 1 : Infinity;
  return [round(lo - room), round(Math.min(cap, hi + room))];
}

export async function calibration(): Promise<void> {
  const pooled = new Pooled();
  const seasons: SeasonStats[] = [];
  for (const season of SEASONS) {
    console.log(`Reading ${season}...`);
    seasons.push(await analyseSeason(season, pooled));
  }
  const keys = Object.keys(seasons[0]!.values);
  const targets = Object.fromEntries(
    keys.map((key) => {
      const values = seasons.map((s) => s.values[key] as number);
      return [
        key,
        {
          real: round(mean(values)),
          bySeason: Object.fromEntries(
            seasons.map((s) => [s.season, round(s.values[key] as number)]),
          ),
          range: rangeOf(values, key),
        },
      ];
    }),
  );

  const p = pooled.c;
  const rate = (a: string, b: string) => round(p.get(a) / Math.max(1, p.get(b)));
  const table = (prefix: string, base: string) => {
    const out: Record<string, number> = {};
    for (const [k, v] of p.counts)
      if (k.startsWith(`${base}:`))
        out[k.slice(base.length + 1)] = round(p.get(`${prefix}:${k.slice(base.length + 1)}`) / v);
    return out;
  };
  const depths = ["short", "medium", "deep"] as const;
  const throws = depths.reduce((s, d) => s + p.get(`throws:${d}`), 0);
  const reference = {
    quantilePoints: QUANTILE_POINTS,
    run: {
      yardQuantiles: quantiles(pooled.runYards, QUANTILE_POINTS),
      meanYards: round(mean(pooled.runYards)),
      fumbleRate: rate("runFumbles", "runsAll"),
      fumbleLostRate: rate("runFumblesLost", "runsAll"),
    },
    pass: {
      depthShare: Object.fromEntries(depths.map((d) => [d, round(p.get(`throws:${d}`) / throws)])),
      completionByDepth: Object.fromEntries(
        depths.map((d) => [d, rate(`completions:${d}`, `throws:${d}`)]),
      ),
      interceptionByDepth: Object.fromEntries(
        depths.map((d) => [d, rate(`ints:${d}`, `throws:${d}`)]),
      ),
      airYardQuantiles: Object.fromEntries(
        depths.map((d) => [d, quantiles(pooled.air[d]!, QUANTILE_POINTS)]),
      ),
      yacQuantiles: Object.fromEntries(
        depths.map((d) => [d, quantiles(pooled.yac[d]!, QUANTILE_POINTS)]),
      ),
      catchFumbleRate: rate("catchFumbles", "catches"),
      catchFumbleLostRate: rate("catchFumblesLost", "catches"),
      sackYardQuantiles: quantiles(pooled.sackYards, QUANTILE_POINTS),
      sackFumbleRate: rate("sackFumbles", "sacksAll"),
      scrambleYardQuantiles: quantiles(pooled.scrambleYards, QUANTILE_POINTS),
      scrambleShareOfDropbacks: round(
        p.get("scramblesAll") / Math.max(1, p.get("scramblesAll") + throws + p.get("sacksAll")),
      ),
      interceptionReturnQuantiles: quantiles(pooled.intReturn, QUANTILE_POINTS),
      pickSixRate: rate("pickSixes", "intsAll"),
    },
    tendencies: {
      note: "Share of plays that are dropbacks, by down and distance, in neutral situations (quarters 1-3, score within 10).",
      passRateByDownDistance: table("downPasses", "downPlays"),
      fourthDownGoRate: table("fourthGo", "fourth"),
      fourthDownFieldGoalRate: table("fourthFg", "fourth"),
    },
    kicking: {
      fieldGoalLogistic: fitLogistic(pooled.fgByDistance),
      puntDistanceQuantiles: quantiles(pooled.puntDistance, QUANTILE_POINTS),
      puntReturnQuantiles: quantiles(pooled.puntReturn, QUANTILE_POINTS),
      puntFairCatchRate: rate("puntFairCatch", "puntsAll"),
      puntTouchbackRate: rate("puntTouchback", "puntsAll"),
      puntOutOfBoundsRate: rate("puntOutOfBounds", "puntsAll"),
      puntBlockedRate: rate("puntBlocked", "puntsAll"),
      kickoffSeasons: KICKOFF_SEASONS,
      kickoffTouchbackRate: rate("kickoffTouchbacks", "kickoffs"),
      kickoffOutOfBoundsRate: rate("kickoffOutOfBounds", "kickoffs"),
      kickoffReturnTdRate: rate("kickoffReturnTds", "kickoffs"),
      kickoffStartQuantiles: quantiles(pooled.kickoffStart, QUANTILE_POINTS),
      kickoffStartMean: round(mean(pooled.kickoffStart)),
      kickoffReturnStartQuantiles: quantiles(pooled.kickoffReturnStart, QUANTILE_POINTS),
      twoPointSuccessRate: rate("twoPointGood", "twoPointTries"),
      twoPointTriesPerTouchdown: rate("twoPointTries", "touchdowns"),
    },
  };

  const output = {
    source:
      "nflverse play-by-play (github.com/nflverse/nflverse-data, CC-BY-4.0), regular seasons " +
      SEASONS.join(", ") +
      ". Plays wiped out by penalties are excluded. Built by `npm run pipeline -- calibration`.",
    seasons: SEASONS,
    targets,
    reference,
  };
  mkdirSync(join(ROOT, "calibration"), { recursive: true });
  writeFileSync(OUT, JSON.stringify(output, null, 2) + "\n");
  console.log(`\nWrote ${OUT}\n`);
  for (const [key, t] of Object.entries(targets)) {
    console.log(
      `${key.padEnd(28)} ${String(t.real).padStart(9)}   range ${t.range[0]} to ${t.range[1]}`,
    );
  }
}
