/**
 * Real-NFL coaching tendencies (Phase 10) from nflverse play-by-play and
 * participation (CC-BY-4.0), 2016-2025 regular seasons. Names are only used
 * in memory (and in the private file for the real league's coaches).
 *
 * For every team-season:
 * - offense: pass rate over expected (nflverse's xpass, neutral situations),
 *   no-huddle share, deep-pass share (20+ air yards), 11-personnel share,
 *   shotgun share;
 * - defense: blitz rate (5+ rushers on dropbacks), man-coverage share, stacked
 *   boxes (8+ on early-down runs);
 * - head coach: 4th-down go rate over expected (against the league's rate in
 *   the same distance and field zone), 2-point attempts per touchdown.
 *
 * calibration/coaching.json keeps, for each tendency, the league mean, how much
 * team-seasons differ (and how much of that is sampling noise), and how stable
 * it is from one season to the next with the same head coach and with a new
 * one. The private file pipeline/private/out/coach-tendencies.json gives the
 * 2025 staffs' own numbers for the real league build.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CACHE, ensure, flag, num, readCsv, RELEASE, ROOT, round } from "./matchups";

const SEASONS = [2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025];
const NEUTRAL_WP: [number, number] = [0.2, 0.8];
/** Plays a team-season needs before a rate counts (else it's skipped). */
const MIN = { plays: 200, dropbacks: 150, fourth: 20, tds: 15, runs: 100 };

type Counts = Record<string, number>;
const add = (c: Counts, k: string, v = 1) => (c[k] = (c[k] ?? 0) + v);

/** 4th-down situation groups for the expected go rate. */
function fourthKey(toGo: number, ytg: number): string {
  const d = toGo <= 1 ? "1" : toGo <= 3 ? "2-3" : toGo <= 6 ? "4-6" : "7+";
  const z = ytg > 60 ? "own" : ytg > 40 ? "mid" : ytg > 20 ? "plus" : "red";
  return `${d}|${z}`;
}

interface TeamSeason {
  season: number;
  team: string;
  coach: string;
  off: Counts;
  def: Counts;
  /** 4th downs: situation key -> [went, total]. */
  fourth: Map<string, [number, number]>;
}

const TENDENCIES = {
  passOverExpected: {
    side: "off",
    label: "Pass rate over expected (neutral situations)",
    rate: (t: TeamSeason) =>
      (t.off.xpassN ?? 0) >= MIN.plays ? (t.off.passMinusX ?? 0) / t.off.xpassN! : null,
    n: (t: TeamSeason) => t.off.xpassN ?? 0,
  },
  noHuddle: {
    side: "off",
    label: "No-huddle share (neutral situations)",
    rate: (t: TeamSeason) => ratio(t.off, "noHuddle", "neutral", MIN.plays),
    n: (t: TeamSeason) => t.off.neutral ?? 0,
  },
  deepShare: {
    side: "off",
    label: "Share of pass attempts thrown 20+ yards",
    rate: (t: TeamSeason) => ratio(t.off, "deep", "attempts", MIN.dropbacks),
    n: (t: TeamSeason) => t.off.attempts ?? 0,
  },
  shotgun: {
    side: "off",
    label: "Shotgun share (neutral situations)",
    rate: (t: TeamSeason) => ratio(t.off, "shotgun", "neutral", MIN.plays),
    n: (t: TeamSeason) => t.off.neutral ?? 0,
  },
  personnel11: {
    side: "off",
    label: "11-personnel share (participation)",
    rate: (t: TeamSeason) => ratio(t.off, "p11", "personnelKnown", MIN.plays),
    n: (t: TeamSeason) => t.off.personnelKnown ?? 0,
  },
  blitz: {
    side: "def",
    label: "Blitz rate: 5+ pass rushers on dropbacks (participation)",
    rate: (t: TeamSeason) => ratio(t.def, "blitz", "rushKnown", MIN.dropbacks),
    n: (t: TeamSeason) => t.def.rushKnown ?? 0,
  },
  manCoverage: {
    side: "def",
    label: "Man-coverage share (participation)",
    rate: (t: TeamSeason) => ratio(t.def, "man", "coverageKnown", MIN.dropbacks),
    n: (t: TeamSeason) => t.def.coverageKnown ?? 0,
  },
  stackedBox: {
    side: "def",
    label: "8+ in the box on early-down runs (participation)",
    rate: (t: TeamSeason) => ratio(t.def, "stacked", "boxKnown", MIN.runs),
    n: (t: TeamSeason) => t.def.boxKnown ?? 0,
  },
  fourthDownGoOverExpected: {
    side: "coach",
    label: "4th-down go rate over expected (same distance and field zone)",
    rate: (t: TeamSeason) =>
      (t.off.fourthN ?? 0) >= MIN.fourth ? t.off.goOverExpected! / t.off.fourthN! : null,
    n: (t: TeamSeason) => t.off.fourthN ?? 0,
  },
  twoPointRate: {
    side: "coach",
    label: "2-point tries per touchdown",
    rate: (t: TeamSeason) => ratio(t.off, "twoPoint", "tds", MIN.tds),
    n: (t: TeamSeason) => t.off.tds ?? 0,
  },
} as const;
type Key = keyof typeof TENDENCIES;

function ratio(c: Counts, top: string, bottom: string, min: number): number | null {
  const n = c[bottom] ?? 0;
  return n >= min ? (c[top] ?? 0) / n : null;
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
const sd = (xs: number[]) => {
  const m = mean(xs);
  return Math.sqrt(mean(xs.map((x) => (x - m) * (x - m))));
};
function correlation(pairs: [number, number][]): number {
  const xs = pairs.map((p) => p[0]);
  const ys = pairs.map((p) => p[1]);
  const mx = mean(xs);
  const my = mean(ys);
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (const [x, y] of pairs) {
    sxy += (x - mx) * (y - my);
    sxx += (x - mx) * (x - mx);
    syy += (y - my) * (y - my);
  }
  return sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : 0;
}

export async function coaching(): Promise<void> {
  const teamSeasons = new Map<string, TeamSeason>();
  const get = (season: number, team: string) => {
    const key = `${season}|${team}`;
    let t = teamSeasons.get(key);
    if (!t) {
      t = { season, team, coach: "", off: {}, def: {}, fourth: new Map() };
      teamSeasons.set(key, t);
    }
    return t;
  };
  const coachGames = new Map<string, Map<string, number>>();

  for (const season of SEASONS) {
    console.log(`Reading ${season}...`);
    // Participation: personnel, rushers, coverage, box, by play.
    const part = new Map<
      string,
      { personnel: string; rushers: number; man: string; box: number }
    >();
    const partPath = await ensure(
      `pbp_participation_${season}.csv`,
      `${RELEASE}/pbp_participation/pbp_participation_${season}.csv`,
    );
    await readCsv(partPath, (r) => {
      part.set(`${r["nflverse_game_id"]}:${r["play_id"]}`, {
        personnel: r["offense_personnel"] ?? "",
        rushers: num(r["number_of_pass_rushers"]),
        man: r["defense_man_zone_type"] ?? "",
        box: num(r["defenders_in_box"]),
      });
    });
    await ensure(`play_by_play_${season}.csv.gz`, `${RELEASE}/pbp/play_by_play_${season}.csv.gz`);
    await readCsv(join(CACHE, `play_by_play_${season}.csv.gz`), (r) => {
      if (r["season_type"] !== "REG") return;
      const off = r["posteam"];
      const def = r["defteam"];
      if (!off || !def || off === "NA") return;
      const o = get(season, off);
      const d = get(season, def);
      // Head coaches, by games.
      const home = r["home_team"]!;
      for (const [team, coach] of [
        [home, r["home_coach"]],
        [r["away_team"], r["away_coach"]],
      ] as [string, string][]) {
        const k = `${season}|${team}`;
        const m = coachGames.get(k) ?? new Map<string, number>();
        const g = `${r["game_id"]}`;
        if (!m.has(`game:${g}`)) {
          m.set(`game:${g}`, 1);
          m.set(coach, (m.get(coach) ?? 0) + 1);
        }
        coachGames.set(k, m);
      }

      const type = r["play_type"];
      const wp = num(r["wp"]);
      const qtr = num(r["qtr"]);
      const neutral =
        (type === "pass" || type === "run") &&
        wp >= NEUTRAL_WP[0] &&
        wp <= NEUTRAL_WP[1] &&
        qtr <= 3 &&
        !flag(r["two_point_attempt"]);
      if (neutral) {
        add(o.off, "neutral");
        if (flag(r["no_huddle"])) add(o.off, "noHuddle");
        if (flag(r["shotgun"])) add(o.off, "shotgun");
        const xpass = num(r["xpass"]);
        if (!Number.isNaN(xpass)) {
          add(o.off, "xpassN");
          add(o.off, "passMinusX", (flag(r["pass"]) ? 1 : 0) - xpass);
        }
      }
      const p = part.get(`${r["game_id"]}:${r["play_id"]}`);
      if ((type === "pass" || type === "run") && p) {
        if (/^\d RB, \d TE, \d WR/.test(p.personnel) || /^\d\d$/.test(p.personnel)) {
          add(o.off, "personnelKnown");
          const rb = Number(p.personnel.match(/(\d) RB/)?.[1] ?? p.personnel[0]);
          const te = Number(p.personnel.match(/(\d) TE/)?.[1] ?? p.personnel[1]);
          if (rb === 1 && te === 1) add(o.off, "p11");
        }
      }
      if (type === "pass" && !flag(r["two_point_attempt"])) {
        const air = num(r["air_yards"]);
        if (!Number.isNaN(air) && flag(r["pass_attempt"]) && !flag(r["sack"])) {
          add(o.off, "attempts");
          if (air >= 20) add(o.off, "deep");
        }
        if (p && !Number.isNaN(p.rushers) && p.rushers > 0) {
          add(d.def, "rushKnown");
          if (p.rushers >= 5) add(d.def, "blitz");
        }
        if (p && (p.man === "MAN_COVERAGE" || p.man === "ZONE_COVERAGE")) {
          add(d.def, "coverageKnown");
          if (p.man === "MAN_COVERAGE") add(d.def, "man");
        }
      }
      if (type === "run" && p && !Number.isNaN(p.box) && num(r["down"]) <= 2) {
        add(d.def, "boxKnown");
        if (p.box >= 8) add(d.def, "stacked");
      }
      // 4th downs (not desperation: before the last 5 minutes, outside garbage time).
      if (
        num(r["down"]) === 4 &&
        qtr <= 4 &&
        !(qtr === 4 && num(r["game_seconds_remaining"]) < 300)
      ) {
        const went = type === "pass" || type === "run";
        const decided = went || type === "punt" || type === "field_goal";
        if (decided && wp >= 0.05 && wp <= 0.95) {
          const k = fourthKey(num(r["ydstogo"]), num(r["yardline_100"]));
          const s = o.fourth.get(k) ?? [0, 0];
          s[0] += went ? 1 : 0;
          s[1] += 1;
          o.fourth.set(k, s);
        }
      }
      if (flag(r["touchdown"]) && r["td_team"] === off && type !== "no_play") add(o.off, "tds");
      if (flag(r["two_point_attempt"])) add(o.off, "twoPoint");
    });
  }

  // Each team-season's head coach: the one who coached most of its games.
  for (const t of teamSeasons.values()) {
    const m = coachGames.get(`${t.season}|${t.team}`);
    if (!m) continue;
    let best = "";
    let n = -1;
    for (const [c, g] of m) if (!c.startsWith("game:") && g > n) [best, n] = [c, g];
    t.coach = best;
  }
  // Expected 4th-down go rate by situation, across the league; then each team's excess.
  const league = new Map<string, [number, number]>();
  for (const t of teamSeasons.values())
    for (const [k, [w, n]] of t.fourth) {
      const s = league.get(k) ?? [0, 0];
      league.set(k, [s[0] + w, s[1] + n]);
    }
  for (const t of teamSeasons.values()) {
    let over = 0;
    let n = 0;
    let noise = 0;
    for (const [k, [w, total]] of t.fourth) {
      const [lw, ln] = league.get(k)!;
      const p = lw / ln;
      over += w - total * p;
      n += total;
      noise += total * p * (1 - p);
    }
    t.off.goOverExpected = over;
    t.off.fourthN = n;
    // Binomial noise of the excess, per 4th down squared (each situation has its own rate).
    t.off.goNoise = noise;
  }

  const list = [...teamSeasons.values()].filter((t) => t.coach);
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(TENDENCIES) as Key[]) {
    const def = TENDENCIES[key];
    const rows = list
      .map((t) => ({ t, v: def.rate(t), n: def.n(t) }))
      .filter((x): x is { t: TeamSeason; v: number; n: number } => x.v !== null);
    const values = rows.map((x) => x.v);
    const m = mean(values);
    // Sampling noise of a rate over n plays: binomial for shares, measured spread for the rest.
    const noiseVar = mean(
      rows.map((x) =>
        key === "fourthDownGoOverExpected"
          ? (x.t.off.goNoise ?? 0) / (x.n * x.n)
          : key === "passOverExpected"
            ? 0.22 / x.n
            : (Math.max(0.0001, m) * Math.max(0.0001, 1 - m)) / x.n,
      ),
    );
    const total = sd(values);
    const byKey = new Map(rows.map((x) => [`${x.t.season}|${x.t.team}`, x]));
    const same: [number, number][] = [];
    const changed: [number, number][] = [];
    for (const x of rows) {
      const prev = byKey.get(`${x.t.season - 1}|${x.t.team}`);
      if (!prev) continue;
      (prev.t.coach === x.t.coach ? same : changed).push([prev.v, x.v]);
    }
    out[key] = {
      side: def.side,
      label: def.label,
      teamSeasons: rows.length,
      seasons: [...new Set(rows.map((x) => x.t.season))].sort(),
      mean: round(m, 4),
      spread: round(total, 4),
      /** Spread with sampling noise taken out: how much teams really differ. */
      trueSpread: round(Math.sqrt(Math.max(0, total * total - noiseVar)), 4),
      yearToYear: {
        sameHeadCoach: round(correlation(same), 3),
        newHeadCoach: round(correlation(changed), 3),
        pairs: [same.length, changed.length],
      },
    };
  }

  // Head-coach changes between seasons (for the carousel, 10b).
  const changesBySeason: Record<number, number> = {};
  for (const t of list) {
    const prev = teamSeasons.get(`${t.season - 1}|${t.team}`);
    if (prev?.coach && prev.coach !== t.coach)
      changesBySeason[t.season] = (changesBySeason[t.season] ?? 0) + 1;
  }

  writeFileSync(
    join(ROOT, "calibration", "coaching.json"),
    JSON.stringify(
      {
        source:
          "nflverse play-by-play and participation 2016-2025 regular seasons (CC-BY-4.0), built by `npm run pipeline -- coaching`.",
        note: "Per team-season tendencies. spread = standard deviation across team-seasons; trueSpread takes out the sampling noise of one season's plays. yearToYear = correlation with the same team's previous season, when the head coach stayed and when he changed.",
        tendencies: out,
        headCoachChanges: changesBySeason,
      },
      null,
      2,
    ) + "\n",
  );

  // Private: the 2025 staffs' own tendencies, for the real league (names never committed).
  const privateOut = join(ROOT, "pipeline", "private", "out");
  mkdirSync(privateOut, { recursive: true });
  const real = Object.fromEntries(
    list
      .filter((t) => t.season === 2025)
      .map((t) => [
        t.team,
        Object.fromEntries(
          (Object.keys(TENDENCIES) as Key[]).map((k) => [
            k,
            { value: TENDENCIES[k].rate(t), n: TENDENCIES[k].n(t) },
          ]),
        ),
      ]),
  );
  // Head coaches' game management over every season they were head coaches.
  const byCoach = new Map<string, TeamSeason[]>();
  for (const t of list) byCoach.set(t.coach, [...(byCoach.get(t.coach) ?? []), t]);
  const coaches = Object.fromEntries(
    [...byCoach].map(([name, seasons]) => {
      let over = 0;
      let n = 0;
      let two = 0;
      let tds = 0;
      for (const t of seasons) {
        over += t.off.goOverExpected ?? 0;
        n += t.off.fourthN ?? 0;
        two += t.off.twoPoint ?? 0;
        tds += t.off.tds ?? 0;
      }
      return [
        name,
        {
          seasons: seasons.map((t) => ({ season: t.season, team: t.team })),
          fourthDownGoOverExpected: { value: n ? over / n : null, n },
          twoPointRate: { value: tds ? two / tds : null, n: tds },
        },
      ];
    }),
  );
  writeFileSync(
    join(privateOut, "coach-tendencies.json"),
    JSON.stringify({ teams2025: real, headCoaches: coaches }, null, 2),
  );

  console.log(`Wrote calibration/coaching.json (${list.length} team-seasons).`);
  for (const key of Object.keys(TENDENCIES) as Key[]) {
    const t = out[key] as {
      mean: number;
      spread: number;
      trueSpread: number;
      yearToYear: { sameHeadCoach: number; newHeadCoach: number };
    };
    console.log(
      `  ${key.padEnd(26)} mean ${t.mean.toFixed(3)}  spread ${t.spread.toFixed(3)} (true ${t.trueSpread.toFixed(3)})  year to year: same coach ${t.yearToYear.sameHeadCoach}, new coach ${t.yearToYear.newHeadCoach}`,
    );
  }
  console.log(`  Head-coach changes: ${JSON.stringify(changesBySeason)}`);
}
