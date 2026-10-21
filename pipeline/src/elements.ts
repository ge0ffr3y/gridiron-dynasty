/**
 * Real-NFL numbers for special teams and the elements (Phase 5b):
 * - each team's stadium (roof, surface) and its city's climate by week
 *   (temperature, wind, rain and snow), from game-day weather;
 * - what weather does: field goals vs. wind, cold and rain; completions and
 *   yards per catch vs. wind; fumbles in rain and snow; punts vs. wind;
 *   kicking at Denver's altitude;
 * - kickoffs under the 2025 rules (touchbacks, landing-zone kicks rolling into
 *   the end zone, short kicks, onside kicks), muffs, blocks and fakes;
 * - scorecard targets: dome vs. cold-or-windy scoring and kicking.
 *
 * Source: nflverse play-by-play 2022-2025 (CC-BY-4.0). Output (league-wide
 * numbers and per-city climate, no names): calibration/elements.json.
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { CACHE, flag, num, readCsv, ROOT, round, type Row } from "./matchups";
import { fitLogistic } from "./situations";

const SEASONS = [2022, 2023, 2024, 2025];
/** The dynamic kickoff with touchbacks at the 35 started in 2025; onside rules changed in 2024. */
const KICKOFF_SEASONS = [2025];
const ONSIDE_SEASONS = [2024, 2025];
/** Real team abbreviations that differ from this league's team ids (two cities have two teams). */
const LEAGUE_ID: Record<string, string> = { NYJ: "NYA", NYG: "NYB", LAC: "LAA", LA: "LAB" };
const leagueId = (abbr: string) => LEAGUE_ID[abbr] ?? abbr;
/** Cold: at or below this temperature (F). Windy: at least this wind (mph). */
const COLD = 40;
const WINDY = 15;
/** Denver's elevation (city fact): the one stadium high enough to matter. */
const HIGH_ALTITUDE: Record<string, number> = { DEN: 1609 };
/** Weight of the league-wide rain/snow rate when blending a city's own (in games). */
const PRIOR_GAMES = 10;

interface GameWeather {
  home: string;
  week: number;
  roof: string;
  surface: string;
  /** Outside conditions from the game-day report (every game, even under a roof). */
  temp: number;
  wind: number;
  rain: boolean;
  snow: boolean;
}

function parseWeather(r: Row): GameWeather {
  const text = r["weather"] ?? "";
  const lower = text.toLowerCase();
  const temp = num(r["temp"]) || Number(/Temp:\s*(-?\d+)/.exec(text)?.[1] ?? NaN);
  const windText = /Wind:\s*(?:[A-Za-z]+\s+)?(\d+)\s*mph/i.exec(text)?.[1];
  const wind = num(r["wind"]) || (windText ? Number(windText) : /calm/i.test(text) ? 0 : NaN);
  return {
    home: leagueId(r["home_team"] ?? ""),
    week: num(r["week"]),
    roof: r["roof"] ?? "",
    surface: r["surface"] ?? "",
    temp,
    wind,
    rain: /rain|shower|drizzle|storm/.test(lower),
    snow: /snow|flurr|sleet/.test(lower),
  };
}

/** The weather the players actually felt (nothing under a roof). */
function felt(w: GameWeather) {
  const outside = w.roof === "outdoors" || w.roof === "open";
  return {
    outside,
    wind: outside && !Number.isNaN(w.wind) ? w.wind : 0,
    cold: outside && w.temp <= COLD ? 1 : 0,
    precip: outside && (w.rain || w.snow) ? 1 : 0,
    altitude: outside && HIGH_ALTITUDE[w.home] ? 1 : 0,
  };
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

const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
const sd = (a: number[]) => {
  const m = mean(a);
  return Math.sqrt(mean(a.map((v) => (v - m) * (v - m))));
};
/** Least-squares line y = a + b x. */
function line(xs: number[], ys: number[]): [number, number] {
  const mx = mean(xs);
  const my = mean(ys);
  let sxy = 0;
  let sxx = 0;
  xs.forEach((x, i) => {
    sxy += (x - mx) * (ys[i]! - my);
    sxx += (x - mx) * (x - mx);
  });
  const b = sxx > 0 ? sxy / sxx : 0;
  return [my - b * mx, b];
}

export async function elements(): Promise<void> {
  const games = new Map<string, GameWeather>();
  const roofs = new Map<string, Counter>();
  const surfaces = new Map<string, Counter>();
  const c = new Counter();
  const fg: { x: number[]; y: number }[] = [];
  const passes: { x: number[]; y: number; yards: number }[] = [];
  const punts: { wind: number; altitude: number; gross: number }[] = [];
  const perSeason: Record<string, number>[] = [];

  for (const season of SEASONS) {
    console.log(`Reading ${season}...`);
    const rows: Row[] = [];
    await readCsv(join(CACHE, `play_by_play_${season}.csv.gz`), (r) => {
      if (r["season_type"] === "REG") rows.push(r);
    });
    const s = new Counter();
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i]!;
      const gameId = r["game_id"]!;
      let w = games.get(gameId);
      if (!w) {
        w = parseWeather(r);
        games.set(gameId, w);
        if (r["location"] !== "Neutral") {
          const roof = roofs.get(w.home) ?? new Counter();
          roof.add(w.roof);
          roofs.set(w.home, roof);
          const surface = surfaces.get(w.home) ?? new Counter();
          surface.add(/grass/.test(w.surface) ? "grass" : "turf");
          surfaces.set(w.home, surface);
        }
        const f = felt(w);
        const group = !f.outside
          ? "dome"
          : w.temp <= COLD || w.wind >= WINDY
            ? "coldWindy"
            : "outdoor";
        s.add(`games|${group}`);
        s.add(`points|${group}`, num(r["home_score"]) + num(r["away_score"]));
      }
      const f = felt(w);
      const type = r["play_type"] ?? "";
      const group = !f.outside
        ? "dome"
        : w.temp <= COLD || w.wind >= WINDY
          ? "coldWindy"
          : "outdoor";

      if (type === "field_goal") {
        const made = r["field_goal_result"] === "made" ? 1 : 0;
        fg.push({ x: [1, num(r["kick_distance"]), f.wind, f.cold, f.precip, f.altitude], y: made });
        s.add(`fga|${group}`);
        s.add(`fgm|${group}`, made);
        c.add("fga");
        if (r["field_goal_result"] === "blocked") c.add("fgBlocked");
      }
      if (
        type === "pass" &&
        flag(r["pass_attempt"]) &&
        !flag(r["sack"]) &&
        !flag(r["two_point_attempt"])
      ) {
        const complete = flag(r["complete_pass"]) ? 1 : 0;
        passes.push({
          x: [1, f.wind, f.cold, f.precip],
          y: complete,
          yards: complete ? num(r["yards_gained"]) : NaN,
        });
      }
      if ((type === "pass" || type === "run") && !flag(r["two_point_attempt"])) {
        // Average conditions over real plays (effects are applied relative to these).
        c.add("avg|plays");
        c.add("avg|wind", f.wind);
        c.add("avg|cold", f.cold);
        c.add("avg|rain", f.precip && !w.snow ? 1 : 0);
        c.add("avg|snow", f.precip && w.snow ? 1 : 0);
        c.add("avg|altitude", f.altitude);
        c.add(`plays|${f.precip ? (w.snow ? "snow" : "rain") : "dry"}`);
        if (flag(r["fumble"])) c.add(`fumbles|${f.precip ? (w.snow ? "snow" : "rain") : "dry"}`);
        // Fakes: a run or pass out of punt or field goal formation.
        const desc = r["desc"] ?? "";
        if (/Punt formation/i.test(desc)) {
          c.add("puntFakes");
          if (flag(r["first_down"]) || flag(r["touchdown"])) c.add("puntFakeWins");
        }
        if (/Field Goal formation/i.test(desc)) {
          c.add("fgFakes");
          if (flag(r["first_down"]) || flag(r["touchdown"])) c.add("fgFakeWins");
        }
      }
      if (type === "punt") {
        c.add("punts");
        if (flag(r["punt_blocked"])) c.add("puntBlocked");
        const gross = num(r["kick_distance"]);
        if (!Number.isNaN(gross) && !flag(r["punt_blocked"])) {
          punts.push({ wind: f.wind, altitude: f.altitude, gross });
          const returned =
            !flag(r["touchback"]) &&
            !flag(r["punt_fair_catch"]) &&
            !flag(r["punt_out_of_bounds"]) &&
            !flag(r["punt_downed"]);
          if (returned) {
            c.add("puntReturns");
            if (flag(r["fumble_lost"])) c.add("puntMuffsLost");
          }
          const net = gross - (num(r["return_yards"]) || 0) - (flag(r["touchback"]) ? 20 : 0);
          s.add("punts");
          s.add("puntGross", gross);
          s.add("puntNet", net);
        }
      }
      if (
        type === "kickoff" &&
        ONSIDE_SEASONS.includes(season) &&
        /onside/i.test(r["desc"] ?? "")
      ) {
        s.add("onside");
        c.add("onside");
        if (flag(r["own_kickoff_recovery"])) {
          s.add("onsideRecovered");
          c.add("onsideRecovered");
        }
        const margin = num(r["score_differential"]);
        // From the kicking team's view (posteam on a kickoff is the receiving team).
        c.add(
          `onside|${-margin < 0 ? "trailing" : -margin === 0 ? "tied" : "leading"}|q${Math.min(4, num(r["qtr"]))}`,
        );
      } else if (type === "kickoff" && KICKOFF_SEASONS.includes(season)) {
        c.add("kickoffs");
        // Where the receiving team started: its first snap after the kick.
        let start = NaN;
        for (let j = i + 1; j < Math.min(rows.length, i + 4); j++) {
          const q = rows[j]!;
          if (q["game_id"] !== gameId) break;
          if (num(q["down"]) === 1) {
            start = num(q["yardline_100"]);
            break;
          }
        }
        const kind = flag(r["touchback"])
          ? start === 80
            ? "landingZoneTouchback"
            : "touchback"
          : flag(r["kickoff_out_of_bounds"])
            ? "outOfBounds"
            : num(r["kick_distance"]) < 45 && !(num(r["return_yards"]) > 0)
              ? "short"
              : "returned";
        c.add(`kickoff|${kind}`);
        if (kind === "returned" && flag(r["fumble_lost"])) c.add("kickoffMuffsLost");
        if (kind === "returned") c.add("kickoffReturns");
      }
    }
    const total = (k: string) => s.get(k);
    perSeason.push({
      pointsPerTeamGameDome: total("points|dome") / (2 * total("games|dome")),
      pointsPerTeamGameColdOrWindy: total("points|coldWindy") / (2 * total("games|coldWindy")),
      fieldGoalPctDome: total("fgm|dome") / total("fga|dome"),
      fieldGoalPctColdOrWindy: total("fgm|coldWindy") / total("fga|coldWindy"),
      puntGrossAverage: total("punts") ? total("puntGross") / total("punts") : NaN,
      puntNetAverage: total("punts") ? total("puntNet") / total("punts") : NaN,
    });
  }

  // League-wide rain and snow rates at outdoor stadiums, early and late in the season
  // (snow is a northern thing, so the blend is only toward rates where it's possible).
  const outdoorGames = [...games.values()].filter((g) => roofs.get(g.home)?.get("outdoors"));
  const leagueRate = (key: "rain" | "snow", late: boolean) => {
    const list = outdoorGames.filter((g) => g.week >= 10 === late);
    return list.filter((g) => g[key]).length / Math.max(1, list.length);
  };

  // Stadiums and climate, by this league's team ids.
  const stadiums: Record<string, unknown> = {};
  const climate: Record<string, unknown> = {};
  for (const [team, roof] of roofs) {
    const open = roof.get("open");
    const closed = roof.get("closed");
    const dome = roof.get("dome");
    const outdoors = roof.get("outdoors");
    const kind = open + closed > 0 ? "retractable" : dome > outdoors ? "dome" : "outdoor";
    const surface = surfaces.get(team)!;
    stadiums[team] = {
      roof: kind,
      ...(kind === "retractable" ? { openShare: round(open / (open + closed), 3) } : {}),
      surface: surface.get("grass") >= surface.get("turf") ? "grass" : "turf",
      elevationMeters: HIGH_ALTITUDE[team] ?? 0,
    };
    const home = [...games.values()].filter((g) => g.home === team && !Number.isNaN(g.temp));
    const [a, b] = line(
      home.map((g) => g.week),
      home.map((g) => g.temp),
    );
    const residual = home.map((g) => g.temp - (a + b * g.week));
    const winds = home.filter((g) => !Number.isNaN(g.wind)).map((g) => g.wind);
    const half = (late: boolean) => home.filter((g) => g.week >= 10 === late);
    // About 17 games per half-season per city is a small sample: blend toward the
    // league-wide outdoor rate for that half, as if adding PRIOR_GAMES typical games.
    const share = (list: GameWeather[], key: "rain" | "snow", late: boolean) =>
      round(
        (list.filter((g) => g[key]).length + PRIOR_GAMES * leagueRate(key, late)) /
          (list.length + PRIOR_GAMES),
        3,
      );
    climate[team] = {
      games: home.length,
      tempByWeek: [round(a, 2), round(b, 3)],
      tempSd: round(sd(residual), 2),
      windMean: round(mean(winds), 2),
      windSd: round(sd(winds), 2),
      rain: [share(half(false), "rain", false), share(half(true), "rain", true)],
      snow: [share(half(false), "snow", false), share(half(true), "snow", true)],
    };
  }

  // Effects of the weather.
  const fgFit = fitLogistic(
    fg.map((p) => p.x),
    fg.map((p) => p.y),
  );
  const passFit = fitLogistic(
    passes.map((p) => p.x),
    passes.map((p) => p.y),
  );
  const completions = passes.filter((p) => p.y === 1);
  const ypc = (filter: (p: (typeof passes)[number]) => boolean) =>
    mean(completions.filter(filter).map((p) => p.yards));
  const calmYpc = ypc((p) => p.x[1]! < 5 && p.x[3] === 0);
  const windyYpc = ypc((p) => p.x[1]! >= WINDY && p.x[3] === 0);
  const windyMph = mean(
    completions.filter((p) => p.x[1]! >= WINDY && p.x[3] === 0).map((p) => p.x[1]!),
  );
  const calmMph = mean(completions.filter((p) => p.x[1]! < 5 && p.x[3] === 0).map((p) => p.x[1]!));
  const wetYpc = ypc((p) => p.x[3] === 1);
  const dryOutsideYpc = ypc((p) => p.x[3] === 0 && p.x[1]! < WINDY);
  const [, puntPerMph] = line(
    punts.map((p) => p.wind),
    punts.map((p) => p.gross),
  );
  const puntAltitude =
    mean(punts.filter((p) => p.altitude).map((p) => p.gross)) -
    mean(punts.filter((p) => !p.altitude && p.wind < 5).map((p) => p.gross));
  const fumbleRate = (k: string) => c.get(`fumbles|${k}`) / c.get(`plays|${k}`);

  const target = (key: string) => {
    const values = perSeason.map((s) => s[key]!).filter((v) => !Number.isNaN(v));
    return {
      real: round(mean(values)),
      range: [round(Math.min(...values)), round(Math.max(...values))],
    };
  };
  const kickoffs = c.get("kickoffs");
  const rateTarget = (key: string, hits: number, n: number) => {
    const p = hits / Math.max(1, n);
    const se = Math.sqrt((p * (1 - p)) / Math.max(1, n));
    return {
      [key]: { real: round(p), range: [round(Math.max(0, p - 2 * se)), round(p + 2 * se)] },
    };
  };
  const countTarget = (key: string, count: number, units: number) => {
    const v = count / units;
    const se = Math.sqrt(count) / units;
    return {
      [key]: { real: round(v), range: [round(Math.max(0, v - 2 * se)), round(v + 2 * se)] },
    };
  };
  const kickShare = (k: string) => round(c.get(`kickoff|${k}`) / kickoffs);
  const onsideBy = Object.fromEntries(
    [...c.m].filter(([k]) => k.startsWith("onside|")).map(([k, v]) => [k.slice(7), v]),
  );
  const out = {
    source:
      "nflverse play-by-play (2022-2025), github.com/nflverse/nflverse-data, CC-BY-4.0. Regular seasons. Built by `npm run pipeline -- elements`. Denver's elevation is a city fact. Stadium entries are roof and surface only (no names).",
    stadiums,
    climate: {
      note: "Outside conditions on game day at each home city (including games under a roof): temperature = tempByWeek[0] + tempByWeek[1] x week, spread tempSd; wind mean and spread (mph); share of games with rain or snow in weeks 1-9 and 10-18.",
      ...climate,
    },
    effects: {
      note: `Fitted on real games. Conditions count only outdoors or with the roof open; cold = ${COLD} F or colder, windy = ${WINDY} mph or more. Field goals and completions: log-odds change per mph of wind, and for cold, rain/snow, and altitude. Yards per catch: ratio in wind (per mph) and in rain/snow. Fumbles: rate ratio vs. dry. Punts: yards per mph of wind, and at altitude.`,
      fieldGoal: {
        windPerMph: round(fgFit[2]!, 4),
        cold: round(fgFit[3]!, 4),
        precip: round(fgFit[4]!, 4),
        altitude: round(fgFit[5]!, 4),
      },
      completion: {
        windPerMph: round(passFit[1]!, 4),
        cold: round(passFit[2]!, 4),
        precip: round(passFit[3]!, 4),
      },
      yardsPerCatch: {
        perMphOfWind: round((windyYpc / calmYpc - 1) / Math.max(1, windyMph - calmMph), 5),
        precip: round(wetYpc / dryOutsideYpc, 4),
      },
      fumbles: {
        rain: round(fumbleRate("rain") / fumbleRate("dry"), 3),
        snow: round(fumbleRate("snow") / fumbleRate("dry"), 3),
      },
      punt: { yardsPerMphOfWind: round(puntPerMph, 3), altitudeYards: round(puntAltitude, 2) },
      average: {
        note: "Average conditions over real plays: the league-wide tables already include these, so a game's effects are measured from here.",
        wind: round(c.get("avg|wind") / c.get("avg|plays"), 3),
        cold: round(c.get("avg|cold") / c.get("avg|plays"), 4),
        rain: round(c.get("avg|rain") / c.get("avg|plays"), 4),
        snow: round(c.get("avg|snow") / c.get("avg|plays"), 4),
        altitude: round(c.get("avg|altitude") / c.get("avg|plays"), 4),
      },
    },
    kickoffs: {
      note: `Kickoffs under the 2025 rules (touchback at the 35; a landing-zone kick downed in the end zone at the 20; short kicks and kicks out of bounds at the 40). Onside kicks: ${ONSIDE_SEASONS.join(", ")} (declared kicks, recovered by the kicking team at this rate).`,
      kickoffs,
      touchbackShare: kickShare("touchback"),
      landingZoneTouchbackShare: kickShare("landingZoneTouchback"),
      outOfBoundsShare: kickShare("outOfBounds"),
      shortShare: kickShare("short"),
      returnedShare: kickShare("returned"),
      returnFumbleLostRate: round(
        c.get("kickoffMuffsLost") / Math.max(1, c.get("kickoffReturns")),
        4,
      ),
      onsideAttemptsPerTeamGame: round(c.get("onside") / (272 * ONSIDE_SEASONS.length * 2), 4),
      onsideRecoveryRate: round(c.get("onsideRecovered") / Math.max(1, c.get("onside")), 4),
      onsideSituations: onsideBy,
    },
    punts: {
      blockedRate: round(c.get("puntBlocked") / c.get("punts"), 4),
      returnFumbleLostRate: round(c.get("puntMuffsLost") / Math.max(1, c.get("puntReturns")), 4),
    },
    fieldGoals: { blockedRate: round(c.get("fgBlocked") / c.get("fga"), 4) },
    fakes: {
      note: "Runs and passes out of punt or field goal formation, per punt or field goal attempt, and how often they gained a first down or scored.",
      puntFakeRate: round(c.get("puntFakes") / (c.get("punts") + c.get("puntFakes")), 4),
      puntFakeSuccess: round(c.get("puntFakeWins") / Math.max(1, c.get("puntFakes")), 3),
      fieldGoalFakeRate: round(c.get("fgFakes") / (c.get("fga") + c.get("fgFakes")), 4),
      fieldGoalFakeSuccess: round(c.get("fgFakeWins") / Math.max(1, c.get("fgFakes")), 3),
    },
    targets: {
      ...Object.fromEntries(Object.keys(perSeason[0]!).map((k) => [k, target(k)])),
      // One season of the current kickoff rules: ranges from sampling noise (two standard errors).
      ...rateTarget(
        "kickoffTouchbackRate",
        c.get("kickoff|touchback") + c.get("kickoff|landingZoneTouchback"),
        kickoffs,
      ),
      ...rateTarget("onsideRecoveryRate", c.get("onsideRecovered"), c.get("onside")),
      ...countTarget("onsideAttemptsPerTeamGame", c.get("onside"), 272 * ONSIDE_SEASONS.length * 2),
    },
  };
  writeFileSync(join(ROOT, "calibration", "elements.json"), `${JSON.stringify(out, null, 2)}\n`);
  console.log(
    JSON.stringify(
      {
        effects: out.effects,
        kickoffs: out.kickoffs,
        punts: out.punts,
        fieldGoals: out.fieldGoals,
        fakes: out.fakes,
        targets: out.targets,
      },
      null,
      1,
    ),
  );
  console.log("\nWrote calibration/elements.json\n");
}
