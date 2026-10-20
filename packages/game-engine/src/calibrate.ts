/**
 * Measures simulated games the same way the pipeline measured real NFL
 * seasons, and compares them to the real ranges (the scorecard).
 */
import { CALIBRATION_TARGETS } from "./config";
import type { GameOutput, Play } from "./types";

export interface MeasuredGame {
  homeId: string;
  awayId: string;
  output: GameOutput;
}

const DESIGNED = new Set(["run"]);

export function measureSeason(games: MeasuredGame[]): Record<string, number> {
  const c: Record<string, number> = {};
  const add = (key: string, n = 1) => (c[key] = (c[key] ?? 0) + n);
  const teamPoints = new Map<string, number[]>();
  let homeWins = 0;
  let ties = 0;
  for (const g of games) {
    const o = g.output;
    add("points", o.homeScore + o.awayScore);
    if (o.homeScore > o.awayScore) homeWins++;
    if (o.homeScore === o.awayScore) ties++;
    teamPoints.set(g.homeId, [...(teamPoints.get(g.homeId) ?? []), o.homeScore]);
    teamPoints.set(g.awayId, [...(teamPoints.get(g.awayId) ?? []), o.awayScore]);
    add("drives", o.box.home.drives + o.box.away.drives);
    for (const p of o.plays) measurePlay(p, add);
  }
  const teamGames = games.length * 2;
  const ppg = [...teamPoints.values()].map((v) => v.reduce((a, b) => a + b, 0) / v.length);
  const ppgMean = ppg.reduce((a, b) => a + b, 0) / ppg.length;
  const spread = Math.sqrt(ppg.reduce((a, v) => a + (v - ppgMean) * (v - ppgMean), 0) / ppg.length);
  const v = (key: string) => c[key] ?? 0;
  const values: Record<string, number> = {
    pointsPerTeamGame: v("points") / teamGames,
    offensivePlaysPerTeamGame: v("offPlays") / teamGames,
    yardsPerPlay: v("offYards") / v("offPlays"),
    passRate: v("dropbacks") / (v("dropbacks") + v("designedRuns")),
    completionPct: v("completions") / v("attempts"),
    yardsPerAttempt: v("passYards") / v("attempts"),
    sackRate: v("sacks") / (v("attempts") + v("sacks")),
    interceptionRate: v("ints") / v("attempts"),
    fumblesLostPerTeamGame: v("fumblesLost") / teamGames,
    turnoversPerTeamGame: (v("fumblesLost") + v("ints")) / teamGames,
    yardsPerCarry: v("rushYards") / v("rushes"),
    puntsPerTeamGame: v("punts") / teamGames,
    fieldGoalPct: v("fgm") / v("fga"),
    extraPointPct: v("xpm") / v("xpa"),
    thirdDownPct: v("thirdConv") / v("thirdAtt"),
    drivesPerTeamGame: v("drives") / teamGames,
    pointsPerDrive: v("points") / v("drives"),
    fourthDownGoRate: v("fourthGo") / v("fourthDowns"),
    twoPointTriesPerTeamGame: v("twoPointTries") / teamGames,
    homeWinPct: homeWins / games.length,
    tiesPerSeason: (ties * 272) / games.length,
    teamPointsPerGameSpread: spread,
  };
  for (const band of ["18-29", "30-39", "40-49", "50-59"])
    values[`fieldGoalPct ${band}`] = v(`fgm:${band}`) / v(`fga:${band}`);
  return values;
}

function measurePlay(p: Play, add: (key: string, n?: number) => void): void {
  const scrimmage =
    p.kind === "run" ||
    p.kind === "pass" ||
    p.kind === "sack" ||
    p.kind === "scramble" ||
    p.kind === "kneel" ||
    p.kind === "spike";
  if (scrimmage) {
    add("offPlays");
    add("offYards", p.yards);
  }
  if (p.kind === "pass" || p.kind === "sack" || p.kind === "scramble") add("dropbacks");
  if (DESIGNED.has(p.kind)) add("designedRuns");
  if (p.kind === "pass") {
    add("attempts");
    if (p.complete) {
      add("completions");
      add("passYards", p.yards);
    }
    if (p.intercepted) add("ints");
  }
  if (p.kind === "sack") add("sacks");
  if (p.kind === "run" || p.kind === "scramble" || p.kind === "kneel") {
    add("rushes");
    add("rushYards", p.yards);
  }
  if (p.fumble?.lost) add("fumblesLost");
  if (p.kind === "punt") add("punts");
  if (p.kind === "fieldGoal") {
    const d = p.kickDistance ?? 0;
    const band = d < 30 ? "18-29" : d < 40 ? "30-39" : d < 50 ? "40-49" : d < 60 ? "50-59" : "60+";
    add("fga");
    add(`fga:${band}`);
    if (p.good) {
      add("fgm");
      add(`fgm:${band}`);
    }
  }
  if (p.kind === "extraPoint") {
    add("xpa");
    if (p.good) add("xpm");
  }
  if (p.kind === "twoPoint") add("twoPointTries");
  const play = p.kind === "run" || p.kind === "pass" || p.kind === "sack" || p.kind === "scramble";
  if (p.down === 3 && play) {
    add("thirdAtt");
    if (p.firstDown) add("thirdConv");
  }
  if (p.down === 4 && (play || p.kind === "punt" || p.kind === "fieldGoal")) {
    add("fourthDowns");
    if (play) add("fourthGo");
  }
}

export interface ScorecardLine {
  key: string;
  sim: number;
  real: number;
  range: [number, number];
  pass: boolean;
}

export function scorecard(values: Record<string, number>): ScorecardLine[] {
  return Object.entries(CALIBRATION_TARGETS).map(([key, t]) => {
    const sim = values[key] ?? NaN;
    const range = t.range as [number, number];
    return { key, sim, real: t.real, range, pass: sim >= range[0] && sim <= range[1] };
  });
}

/** The core stats the CI test holds to the real ranges. */
export const CORE_STATS = [
  "pointsPerTeamGame",
  "yardsPerPlay",
  "completionPct",
  "sackRate",
  "turnoversPerTeamGame",
  "offensivePlaysPerTeamGame",
];
