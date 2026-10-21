/**
 * Real-NFL numbers about situations (Phase 5a): a win-probability model fitted
 * to real outcomes, 4th-down conversion rates and where punts leave the other
 * team, and situational targets for the scorecard (pass rate by down and
 * distance, 4th-down choices by field zone, 2-point tries, timeouts, points at
 * the end of halves, replay reviews, home and road false starts), plus run
 * gains by distance to go.
 *
 * Source: nflverse play-by-play 2022-2025 (CC-BY-4.0). Output (league-wide
 * numbers only): calibration/situations.json.
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { smoothExpectedPoints } from "@fgm/game-engine";
import { QUANTILE_POINTS, quantiles } from "./calibration";
import { CACHE, flag, num, readCsv, ROOT, round, type Row } from "./matchups";

const SEASONS = [2022, 2023, 2024, 2025];
const TWO_MINUTES = 120;

/** Win-probability features, from the team with the ball's point of view. */
export const WP_FEATURES = [
  "margin",
  "marginLate",
  "expectedPoints",
  "expectedPointsLate",
  "timeoutEdge",
  "timeoutEdgeLate",
  "home",
  "receivesSecondHalf",
] as const;

/**
 * "Late" features grow as time runs out (1 / sqrt(minutes left + 1)), so a
 * lead or a timeout counts for more near the end.
 */
export function wpFeatures(s: {
  margin: number;
  minutesLeft: number;
  expectedPoints: number;
  timeoutEdge: number;
  home: number;
  receivesSecondHalf: number;
}): number[] {
  const late = 1 / Math.sqrt(Math.max(0, s.minutesLeft) + 1);
  return [
    s.margin,
    s.margin * late,
    s.expectedPoints,
    s.expectedPoints * late,
    s.timeoutEdge,
    s.timeoutEdge * late,
    s.home,
    s.receivesSecondHalf,
  ];
}

export const logistic = (z: number) => 1 / (1 + Math.exp(-z));

/** Logistic regression by Newton's method (small and dependency-free). */
export function fitLogistic(x: number[][], y: number[], iterations = 12): number[] {
  const k = x[0]!.length;
  let w = new Array<number>(k).fill(0);
  for (let it = 0; it < iterations; it++) {
    const g = new Array<number>(k).fill(0);
    const h = Array.from({ length: k }, () => new Array<number>(k).fill(0));
    for (let i = 0; i < x.length; i++) {
      const xi = x[i]!;
      const p = logistic(xi.reduce((s, v, j) => s + v * w[j]!, 0));
      const r = y[i]! - p;
      const wt = p * (1 - p);
      for (let a = 0; a < k; a++) {
        g[a]! += r * xi[a]!;
        for (let b = 0; b <= a; b++) h[a]![b]! += wt * xi[a]! * xi[b]!;
      }
    }
    for (let a = 0; a < k; a++) {
      h[a]![a]! += 1e-6;
      for (let b = 0; b < a; b++) h[b]![a] = h[a]![b]!;
    }
    w = w.map((v, i) => v + solve(h, g)[i]!);
  }
  return w;
}

/** Solves a small linear system (Gaussian elimination with partial pivoting). */
function solve(a: number[][], b: number[]): number[] {
  const n = b.length;
  const m = a.map((row, i) => [...row, b[i]!]);
  for (let c = 0; c < n; c++) {
    let pivot = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(m[r]![c]!) > Math.abs(m[pivot]![c]!)) pivot = r;
    [m[c], m[pivot]] = [m[pivot]!, m[c]!];
    for (let r = c + 1; r < n; r++) {
      const f = m[r]![c]! / m[c]![c]!;
      for (let k = c; k <= n; k++) m[r]![k]! -= f * m[c]![k]!;
    }
  }
  const out = new Array<number>(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = m[r]![n]!;
    for (let k = r + 1; k < n; k++) s -= m[r]![k]! * out[k]!;
    out[r] = s / m[r]![r]!;
  }
  return out;
}

class Counter {
  readonly m = new Map<string, number>();
  add(key: string, n = 1) {
    this.m.set(key, (this.m.get(key) ?? 0) + n);
  }
  get(key: string) {
    return this.m.get(key) ?? 0;
  }
}

const distanceGroup = (toGo: number) =>
  toGo <= 10 ? String(Math.max(1, toGo)) : toGo <= 15 ? "11-15" : "16+";
const runBucket = (toGo: number) =>
  toGo <= 1 ? "1" : toGo <= 3 ? "2-3" : toGo <= 6 ? "4-6" : toGo <= 10 ? "7-10" : "11+";
/** Situations for the pass-rate targets. */
function passGroup(down: number, toGo: number): string | null {
  if (down === 1) return "1st down";
  if (down === 2) return toGo <= 3 ? "2nd & short" : toGo >= 7 ? "2nd & long" : "2nd & medium";
  if (down === 3) return toGo <= 3 ? "3rd & short" : toGo >= 7 ? "3rd & long" : "3rd & medium";
  return null;
}
const zone = (ytg: number) =>
  ytg > 60 ? "own-deep" : ytg > 40 ? "midfield" : ytg > 20 ? "plus-territory" : "red-zone";

export async function situations(): Promise<void> {
  const x: number[][] = [];
  const y: number[] = [];
  const nflverseWp: number[] = [];
  const conv = new Counter();
  const puntNext = new Map<number, number[]>();
  const runYards = new Map<string, number[]>();
  const perSeason: Record<string, number>[] = [];
  const noise: Record<string, number>[] = [];

  for (const season of SEASONS) {
    console.log(`Reading ${season}...`);
    const rows: Row[] = [];
    await readCsv(join(CACHE, `play_by_play_${season}.csv.gz`), (r) => {
      if (r["season_type"] === "REG") rows.push(r);
    });
    const c = new Counter();
    const games = new Set<string>();
    // Who received the opening kickoff (so the other team gets the ball after halftime).
    const openingReceiver = new Map<string, string>();
    for (const r of rows) {
      const g = r["game_id"]!;
      games.add(g);
      if (r["play_type"] === "kickoff" && r["game_half"] === "Half1" && !openingReceiver.has(g))
        openingReceiver.set(g, r["posteam"] ?? "");
    }

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i]!;
      const type = r["play_type"] ?? "";
      const team = r["posteam"] ?? "";
      const down = num(r["down"]);
      const toGo = num(r["ydstogo"]);
      const ytg = num(r["yardline_100"]);
      const half = r["game_half"];
      const halfLeft = num(r["half_seconds_remaining"]);
      const home = r["home_team"] === team;
      const twoPoint = flag(r["two_point_attempt"]);

      // Points scored in the last two minutes of each half (regulation).
      if ((half === "Half1" || half === "Half2") && halfLeft <= TWO_MINUTES) {
        const points =
          num(r["posteam_score_post"]) -
          num(r["posteam_score"]) +
          (num(r["defteam_score_post"]) - num(r["defteam_score"]));
        if (points > 0) c.add("endOfHalfPoints", points);
      }
      if (flag(r["timeout"]) && r["timeout_team"]) c.add("timeouts");
      if (flag(r["touchdown"])) c.add("touchdowns");
      if (twoPoint) c.add("twoPointTries");

      // Replay: "X challenged the ... ruling" vs. "The Replay Official reviewed ...".
      if (flag(r["replay_or_challenge"])) {
        const desc = r["desc"] ?? "";
        const kind = / challenged /.test(desc) ? "challenge" : "booth";
        c.add(`${kind}s`);
        if (r["replay_or_challenge_result"] === "reversed") c.add(`${kind}Reversed`);
      }

      // Crowd noise: false starts by home and road offenses.
      if (r["penalty_type"] === "False Start" && r["penalty_team"]) {
        c.add(r["penalty_team"] === r["home_team"] ? "falseStartsHome" : "falseStartsRoad");
      }

      if (!(down >= 1) || twoPoint || !team) continue;
      const scrimmage = type === "pass" || type === "run";

      // Pass rate by down and distance (dropbacks vs. designed runs).
      const group = passGroup(down, toGo);
      if (scrimmage && group) {
        c.add(`plays|${group}`);
        if (flag(r["qb_dropback"])) c.add(`passes|${group}`);
      }
      // 4th-down choices by field zone.
      if (down === 4 && (scrimmage || type === "punt" || type === "field_goal")) {
        const z = zone(ytg);
        c.add(`fourth|${z}`);
        if (scrimmage) c.add(`fourthGo|${z}`);
        if (type === "field_goal") c.add(`fourthFg|${z}`);
      }
      // Conversion rates on 3rd and 4th down by distance.
      if (scrimmage && (down === 3 || down === 4)) {
        const key = `${down}|${distanceGroup(toGo)}`;
        // Inside the 20 the field is compressed: 3rd and 4th downs pooled there (fewer plays).
        const redZone = ytg <= 20 ? [`rz|${distanceGroup(toGo)}`] : [];
        const converted = flag(r["first_down"]) || (flag(r["touchdown"]) && r["td_team"] === team);
        for (const k of [key, ...redZone]) {
          conv.add(`n|${k}`);
          if (converted) conv.add(`ok|${k}`);
        }
      }
      // Designed runs by distance to go.
      if (type === "run" && !flag(r["qb_scramble"]) && !flag(r["qb_kneel"])) {
        const list = runYards.get(runBucket(toGo)) ?? [];
        list.push(num(r["yards_gained"]));
        runYards.set(runBucket(toGo), list);
      }
      // Where a punt leaves the other team: its first snap after the punt.
      if (type === "punt") {
        for (let j = i + 1; j < Math.min(rows.length, i + 6); j++) {
          const q = rows[j]!;
          if (q["game_id"] !== r["game_id"]) break;
          if (num(q["down"]) === 1 && q["posteam"] && q["posteam"] !== team) {
            const band = Math.min(19, Math.floor((ytg - 1) / 5));
            const list = puntNext.get(band) ?? [];
            list.push(num(q["yardline_100"]));
            puntNext.set(band, list);
            break;
          }
        }
      }
      // Win probability training data: snaps in regulation from games with a winner.
      const result = num(r["result"]);
      if (
        (scrimmage || type === "punt" || type === "field_goal") &&
        (half === "Half1" || half === "Half2") &&
        result !== 0 &&
        !Number.isNaN(result)
      ) {
        const won = home ? result > 0 : result < 0;
        const receiver = openingReceiver.get(r["game_id"]!);
        x.push(
          wpFeatures({
            margin: num(r["score_differential"]),
            minutesLeft: num(r["game_seconds_remaining"]) / 60,
            expectedPoints: smoothExpectedPoints(down, toGo, ytg),
            timeoutEdge:
              num(r["posteam_timeouts_remaining"]) - num(r["defteam_timeouts_remaining"]),
            home: r["location"] === "Neutral" ? 0 : home ? 1 : -1,
            receivesSecondHalf: half === "Half1" && receiver ? (receiver === team ? -1 : 1) : 0,
          }),
        );
        y.push(won ? 1 : 0);
        nflverseWp.push(num(r["wp"]));
      }
    }

    const teamGames = games.size * 2;
    const values: Record<string, number> = {
      timeoutsPerTeamGame: c.get("timeouts") / teamGames,
      endOfHalfPointsPerTeamGame: c.get("endOfHalfPoints") / teamGames,
      twoPointTriesPerTouchdown: c.get("twoPointTries") / c.get("touchdowns"),
      challengesPerGame: c.get("challenges") / games.size,
      challengeReversalRate: c.get("challengeReversed") / c.get("challenges"),
      boothReviewsPerGame: c.get("booths") / games.size,
      boothReversalRate: c.get("boothReversed") / c.get("booths"),
      falseStartsHomeOffense: c.get("falseStartsHome") / games.size,
      falseStartsRoadOffense: c.get("falseStartsRoad") / games.size,
    };
    for (const g of [
      "1st down",
      "2nd & short",
      "2nd & medium",
      "2nd & long",
      "3rd & short",
      "3rd & medium",
      "3rd & long",
    ])
      values[`passRate ${g}`] = c.get(`passes|${g}`) / c.get(`plays|${g}`);
    for (const z of ["own-deep", "midfield", "plus-territory", "red-zone"]) {
      values[`fourthDownGoRate ${z}`] = c.get(`fourthGo|${z}`) / c.get(`fourth|${z}`);
      if (z === "plus-territory" || z === "red-zone")
        values[`fourthDownFieldGoalRate ${z}`] = c.get(`fourthFg|${z}`) / c.get(`fourth|${z}`);
    }
    // One season's sampling noise for each line (standard error): binomial for rates,
    // Poisson for counts per game.
    const rateNoise = (hits: number, n: number) => {
      const p = hits / Math.max(1, n);
      return Math.sqrt((p * (1 - p)) / Math.max(1, n));
    };
    const countNoise = (count: number, units: number) => Math.sqrt(count) / units;
    const seasonNoise: Record<string, number> = {
      timeoutsPerTeamGame: countNoise(c.get("timeouts"), teamGames),
      endOfHalfPointsPerTeamGame: countNoise(c.get("endOfHalfPoints"), teamGames),
      twoPointTriesPerTouchdown: rateNoise(c.get("twoPointTries"), c.get("touchdowns")),
      challengesPerGame: countNoise(c.get("challenges"), games.size),
      challengeReversalRate: rateNoise(c.get("challengeReversed"), c.get("challenges")),
      boothReviewsPerGame: countNoise(c.get("booths"), games.size),
      boothReversalRate: rateNoise(c.get("boothReversed"), c.get("booths")),
      falseStartsHomeOffense: countNoise(c.get("falseStartsHome"), games.size),
      falseStartsRoadOffense: countNoise(c.get("falseStartsRoad"), games.size),
    };
    for (const key of Object.keys(values)) {
      if (key in seasonNoise) continue;
      const [prefix, group] = key.startsWith("passRate")
        ? ["passes|", key.slice("passRate ".length)]
        : key.startsWith("fourthDownGoRate")
          ? ["fourthGo|", key.slice("fourthDownGoRate ".length)]
          : ["fourthFg|", key.slice("fourthDownFieldGoalRate ".length)];
      const denominator = key.startsWith("passRate") ? `plays|${group}` : `fourth|${group}`;
      seasonNoise[key] = rateNoise(c.get(`${prefix}${group}`), c.get(denominator));
    }
    noise.push(seasonNoise);
    perSeason.push(values);
  }

  // Fit and check the win-probability model.
  console.log(`Fitting win probability on ${x.length} snaps...`);
  const weights = fitLogistic(x, y);
  const bins = Array.from({ length: 10 }, () => ({ n: 0, predicted: 0, won: 0 }));
  let logLoss = 0;
  let nflverseLogLoss = 0;
  let counted = 0;
  for (let i = 0; i < x.length; i++) {
    const p = logistic(x[i]!.reduce((s, v, j) => s + v * weights[j]!, 0));
    const bin = bins[Math.min(9, Math.floor(p * 10))]!;
    bin.n += 1;
    bin.predicted += p;
    bin.won += y[i]!;
    const clip = (v: number) => Math.min(1 - 1e-6, Math.max(1e-6, v));
    logLoss -= y[i]! ? Math.log(clip(p)) : Math.log(1 - clip(p));
    const nv = nflverseWp[i]!;
    if (!Number.isNaN(nv)) {
      nflverseLogLoss -= y[i]! ? Math.log(clip(nv)) : Math.log(1 - clip(nv));
      counted += 1;
    }
  }

  // Range: the real seasons' spread, widened to at least two standard errors of one
  // season's sampling noise (a realistic sim would often fall outside a narrower range).
  const target = (key: string) => {
    const values = perSeason.map((s) => s[key]!);
    const real = values.reduce((a, b) => a + b, 0) / values.length;
    const se = noise.reduce((a, n) => a + n[key]!, 0) / noise.length;
    return {
      real: round(real),
      range: [round(Math.min(...values, real - 2 * se)), round(Math.max(...values, real + 2 * se))],
    };
  };
  const rate = (key: string) => round(conv.get(`ok|${key}`) / Math.max(1, conv.get(`n|${key}`)));
  const groups = [...Array.from({ length: 10 }, (_, i) => String(i + 1)), "11-15", "16+"];
  const out = {
    source:
      "nflverse play-by-play (2022, 2023, 2024, 2025), github.com/nflverse/nflverse-data, CC-BY-4.0. Regular seasons. Built by `npm run pipeline -- situations`.",
    winProbability: {
      note: "Logistic model of the chance the team with the ball wins (regulation snaps, ties left out). Features in this order; 'late' ones are scaled by 1 / sqrt(minutes left + 1). Expected points use the table in matchups.json.",
      features: WP_FEATURES,
      weights: weights.map((w) => round(w, 6)),
      check: {
        note: "Snaps grouped by predicted chance: how often the team actually won. Log loss per snap for this model and for nflverse's own win probability on the same snaps.",
        bins: bins.map((b) => ({
          snaps: b.n,
          predicted: round(b.predicted / Math.max(1, b.n), 3),
          actual: round(b.won / Math.max(1, b.n), 3),
        })),
        logLoss: round(logLoss / x.length),
        nflverseLogLoss: round(nflverseLogLoss / Math.max(1, counted)),
      },
    },
    conversion: {
      note: "Share of 3rd- and 4th-down runs and passes that gained a first down or scored, by yards to go. redZone: 3rd and 4th downs inside the 20, pooled.",
      third: Object.fromEntries(groups.map((g) => [g, rate(`3|${g}`)])),
      fourth: Object.fromEntries(groups.map((g) => [g, rate(`4|${g}`)])),
      redZone: Object.fromEntries(groups.map((g) => [g, rate(`rz|${g}`)])),
    },
    puntResult: {
      note: "After a punt from each 5-yard band of the punting team's yards to goal (index = floor((yards to goal - 1) / 5)): the receiving team's average yards to goal on its first snap.",
      byBand: Object.fromEntries(
        [...puntNext.entries()]
          .filter(([, v]) => v.length >= 30)
          .sort((a, b) => a[0] - b[0])
          .map(([band, v]) => [String(band), round(v.reduce((a, b) => a + b, 0) / v.length, 1)]),
      ),
    },
    runYardsByDistance: {
      note: "Designed runs (no scrambles or kneels): yards gained at each quantile, by yards to go.",
      points: QUANTILE_POINTS,
      ...Object.fromEntries(
        ["1", "2-3", "4-6", "7-10", "11+"].map((b) => [
          b,
          quantiles(runYards.get(b) ?? [0], QUANTILE_POINTS),
        ]),
      ),
    },
    targetsNote:
      "Each range is the real seasons' lowest to highest, widened where needed to two standard errors of one season's sampling noise.",
    targets: Object.fromEntries(Object.keys(perSeason[0]!).map((k) => [k, target(k)])),
  };
  writeFileSync(join(ROOT, "calibration", "situations.json"), `${JSON.stringify(out, null, 2)}\n`);
  console.log(JSON.stringify({ wp: out.winProbability, targets: out.targets }, null, 1));
  console.log("\nWrote calibration/situations.json\n");
}
