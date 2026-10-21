/**
 * Matchup calibration (Phase 4): formations, personnel, coverages, pass
 * rush, routes, run gaps, penalties and injuries, from real NFL data.
 *
 *   npm run pipeline -- matchups
 *
 * Joins three nflverse files play by play:
 *  - play-by-play (CC-BY-4.0): penalties, run gaps, expected points, injuries;
 *  - participation (CC-BY-4.0, complete from 2023): personnel, formation,
 *    box count, pass rushers, pressure, time to throw, route, coverage;
 *  - FTN charting (CC-BY-SA-4.0): play-action, screens, RPOs, drops...
 * Writes `calibration/matchups.json` (CC-BY) and, separately,
 * `calibration/charting.json` (CC-BY-SA, because the share-alike license of
 * FTN's data carries over to numbers derived from it).
 */
import { createReadStream, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createGunzip } from "node:zlib";
import { parse } from "csv-parse";

export const ROOT = join(import.meta.dirname, "..", "..");
export const CACHE = join(ROOT, "pipeline", "cache", "nflverse");
const PBP_SEASONS = [2022, 2023, 2024, 2025];
/** Participation data is complete from 2023 on. */
const PARTICIPATION_SEASONS = [2023, 2024, 2025];
const CHARTING_SEASONS = [2022, 2023, 2024, 2025];

export type Row = Record<string, string>;
export const RELEASE = "https://github.com/nflverse/nflverse-data/releases/download";

export async function ensure(file: string, url: string): Promise<string> {
  const path = join(CACHE, file);
  if (existsSync(path)) return path;
  mkdirSync(CACHE, { recursive: true });
  console.log(`Downloading ${file}...`);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`download failed: ${url} (${response.status})`);
  writeFileSync(path, Buffer.from(await response.arrayBuffer()));
  return path;
}

export async function readCsv(path: string, onRow: (row: Row) => void): Promise<void> {
  let stream: NodeJS.ReadableStream = createReadStream(path);
  if (path.endsWith(".gz")) stream = stream.pipe(createGunzip());
  for await (const row of stream.pipe(parse({ columns: true, relax_column_count: true })))
    onRow(row as Row);
}

export const num = (v: string | undefined) =>
  v === undefined || v === "" || v === "NA" ? NaN : Number(v);
export const flag = (v: string | undefined) =>
  v === "1" || v === "1.0" || v === "TRUE" || v === "true";
export const round = (v: number, d = 4) => Math.round(v * 10 ** d) / 10 ** d;
export const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
const QUANTILES = [0.05, 0.1, 0.25, 0.5, 0.75, 0.9, 0.95];
function quantiles(values: number[]): number[] {
  const s = [...values].sort((a, b) => a - b);
  return QUANTILES.map((p) => s[Math.min(s.length - 1, Math.round(p * (s.length - 1)))] as number);
}

class Tally {
  readonly m = new Map<string, number>();
  add(key: string, n = 1) {
    this.m.set(key, (this.m.get(key) ?? 0) + n);
  }
  get(key: string) {
    return this.m.get(key) ?? 0;
  }
  /** Shares of each key under a prefix, e.g. share("pers|1st10|") -> { "11": 0.62, ... }. */
  shares(prefix: string, minCount = 0): Record<string, number> {
    const out: Record<string, number> = {};
    let total = 0;
    for (const [k, v] of this.m) if (k.startsWith(prefix)) total += v;
    for (const [k, v] of this.m)
      if (k.startsWith(prefix) && v >= minCount) out[k.slice(prefix.length)] = round(v / total);
    return out;
  }
}

/** "1 RB, 1 TE, 3 WR" or "1 C, 1 QB, 1 RB, 4 T, 1 TE, 3 WR" -> "11" (backs, tight ends). */
function offensePersonnel(text: string): string | null {
  if (!text) return null;
  let backs = 0;
  let ends = 0;
  for (const part of text.split(",")) {
    const [count, pos] = part.trim().split(/\s+/);
    const n = Number(count);
    if (pos === "RB" || pos === "FB") backs += n;
    if (pos === "TE") ends += n;
  }
  return `${backs}${ends}`;
}

/** Safeties on the field (null if unknown). */
function safetyCount(text: string): number | null {
  if (!text) return null;
  let n = 0;
  for (const part of text.split(",")) {
    const [count, pos] = part.trim().split(/\s+/);
    if (["S", "FS", "SS"].includes(pos ?? "")) n += Number(count);
  }
  return n;
}

/** Defensive personnel by number of defensive backs. */
function defensePersonnel(text: string): string | null {
  if (!text) return null;
  let dbs = 0;
  let front = 0;
  for (const part of text.split(",")) {
    const [count, pos] = part.trim().split(/\s+/);
    const n = Number(count);
    if (["CB", "S", "FS", "SS", "DB"].includes(pos ?? "")) dbs += n;
    if (["DE", "DT", "NT", "DL", "OLB", "ILB", "MLB", "LB"].includes(pos ?? "")) front += n;
  }
  if (front >= 8) return "goal-line";
  return dbs <= 4 ? "base" : dbs === 5 ? "nickel" : "dime";
}

function situation(down: number, togo: number, ytg: number): string {
  if (ytg <= 3) return "goal-line";
  if (togo <= 2) return "short";
  if (down === 1 && togo >= 10) return "1st10";
  if (down >= 3 && togo >= 7) return "long";
  return "other";
}

function coverageGroup(c: string): string {
  if (!c) return "";
  if (c === "COVER_0") return "cover0";
  if (c === "COVER_1") return "cover1";
  if (c === "COVER_2") return "cover2";
  if (c === "2_MAN") return "2man";
  if (c === "COVER_3") return "cover3";
  if (c === "COVER_4") return "cover4";
  if (c === "COVER_6") return "cover6";
  return "other";
}

const PRE_SNAP = new Set([
  "False Start",
  "Delay of Game",
  "Illegal Formation",
  "Illegal Shift",
  "Illegal Motion",
  "Defensive Offside",
  "Neutral Zone Infraction",
  "Encroachment",
  "Defensive Too Many Men on Field",
  "Offensive Too Many Men on Field",
  "Illegal Substitution",
]);

interface Participation {
  formation: string;
  personnel: string | null;
  defense: string | null;
  safeties: number | null;
  box: number;
  rushers: number;
  pressure: boolean;
  timeToThrow: number;
  route: string;
  manZone: string;
  coverage: string;
}

export async function matchups(): Promise<void> {
  const t = new Tally();
  const values: Record<string, number[]> = {
    timeToThrow: [],
    timeToThrowPressured: [],
    timeToThrowClean: [],
  };
  const charting = new Tally();
  const ep = new Map<string, number[]>();
  const perSeason: Record<number, Record<string, number>> = {};

  for (const season of PBP_SEASONS) {
    const part = new Map<string, Participation>();
    if (PARTICIPATION_SEASONS.includes(season)) {
      const path = await ensure(
        `pbp_participation_${season}.csv`,
        `${RELEASE}/pbp_participation/pbp_participation_${season}.csv`,
      );
      await readCsv(path, (r) => {
        part.set(`${r["nflverse_game_id"]}:${r["play_id"]}`, {
          formation: r["offense_formation"] ?? "",
          personnel: offensePersonnel(r["offense_personnel"] ?? ""),
          defense: defensePersonnel(r["defense_personnel"] ?? ""),
          safeties: safetyCount(r["defense_personnel"] ?? ""),
          box: num(r["defenders_in_box"]),
          rushers: num(r["number_of_pass_rushers"]),
          pressure: flag(r["was_pressure"]),
          timeToThrow: num(r["time_to_throw"]),
          route: r["route"] ?? "",
          manZone: r["defense_man_zone_type"] ?? "",
          coverage: coverageGroup(r["defense_coverage_type"] ?? ""),
        });
      });
    }
    const ftn = new Map<string, Row>();
    if (CHARTING_SEASONS.includes(season)) {
      const path = await ensure(
        `ftn_charting_${season}.csv`,
        `${RELEASE}/ftn_charting/ftn_charting_${season}.csv`,
      );
      await readCsv(path, (r) => ftn.set(`${r["nflverse_game_id"]}:${r["nflverse_play_id"]}`, r));
    }

    const games = new Set<string>();
    const s = new Tally();
    console.log(`Reading ${season}...`);
    await readCsv(join(CACHE, `play_by_play_${season}.csv.gz`), (r) => {
      if (r["season_type"] !== "REG") return;
      const gameId = r["game_id"] as string;
      games.add(gameId);
      const key = `${gameId}:${r["play_id"]}`;
      const type = r["play_type"] ?? "";
      const desc = r["desc"] ?? "";
      const down = num(r["down"]);
      const togo = num(r["ydstogo"]);
      const ytg = num(r["yardline_100"]);
      const yards = num(r["yards_gained"]);
      const dropback = r["qb_dropback"] === "1";
      const scrimmage = type === "pass" || type === "run";

      // Injuries (counted by mention in the play description).
      const injuries = desc.split("was injured during the play").length - 1;
      if (injuries > 0) s.add("injuries", injuries);

      // Penalties (accepted ones carry the flag).
      if (r["penalty"] === "1" && r["penalty_type"]) {
        const ptype = r["penalty_type"] as string;
        const onOffense = r["penalty_team"] === r["posteam"];
        const phase = PRE_SNAP.has(ptype)
          ? "pre"
          : type === "punt"
            ? "punt"
            : type === "kickoff"
              ? "kickoff"
              : / pass /.test(desc) || type === "pass"
                ? "pass"
                : "run";
        s.add("penalties");
        s.add("penaltyYards", num(r["penalty_yards"]) || 0);
        const id = `${phase}|${onOffense ? "offense" : "defense"}|${ptype}`;
        t.add(`pen|${id}`);
        t.add(`penYards|${id}`, num(r["penalty_yards"]) || 0);
        if (flag(r["first_down_penalty"])) t.add(`penFirstDown|${id}`);
      }
      if (scrimmage || (type === "no_play" && down >= 1)) s.add("snaps");
      if (type === "pass") s.add("passSnaps");
      if (type === "run") s.add("runSnaps");
      if (type === "punt") s.add("punts");
      if (type === "kickoff") s.add("kickoffs");

      // Expected points by down, distance and field position: every play with a down,
      // including punts and field goals (otherwise 4th-and-long states would be missing).
      const epValue = num(r["ep"]);
      const hasDown =
        scrimmage || ["punt", "field_goal", "no_play", "qb_kneel", "qb_spike"].includes(type);
      if (hasDown && down >= 1 && !Number.isNaN(epValue)) {
        // Distance to go: every yard up to 10, then 11-14 and 15+ (the engine uses the same groups).
        const togoGroup = togo <= 10 ? String(Math.max(1, togo)) : togo <= 14 ? "11-14" : "15+";
        const k = `${down}|${togoGroup}|${Math.min(19, Math.floor((ytg - 1) / 5))}`;
        const list = ep.get(k) ?? [];
        list.push(epValue);
        ep.set(k, list);
      }

      // Run gaps and the box.
      const p = part.get(key);
      if (type === "run" && r["qb_scramble"] !== "1" && down >= 1) {
        const loc = r["run_location"] || "middle";
        const gap = loc === "middle" ? "middle" : `${loc}-${r["run_gap"] || "guard"}`;
        t.add(`gap|${gap}`);
        t.add(`gapYards|${gap}`, yards);
        if (p && !Number.isNaN(p.box)) {
          const box = p.box <= 5 ? "5-" : p.box >= 8 ? "8+" : String(p.box);
          t.add(`runBox|${box}`);
          t.add(`runBoxYards|${box}`, yards);
        }
      }

      if (p && scrimmage && down >= 1 && p.personnel) {
        const sit = situation(down, togo, ytg);
        const call = dropback ? "pass" : "run";
        t.add(`pers|${call}|${sit}|${p.personnel}`);
        if (p.formation) t.add(`form|${call}|${p.personnel}|${p.formation}`);
        if (p.defense) t.add(`def|${p.personnel}|${p.defense}`);
        // Sub packages: is the extra defensive back a third safety instead of a third corner?
        if ((p.defense === "nickel" || p.defense === "dime") && p.safeties !== null) {
          t.add(`sub|${p.defense}`);
          if (p.safeties >= 3) t.add(`sub|${p.defense}|threeSafeties`);
        }
        if (!Number.isNaN(p.box))
          t.add(`box|${call}|${p.personnel}|${Math.max(4, Math.min(9, p.box))}`);
        s.add(`personnelPlays`);
        if (p.personnel === "11") s.add("personnel11");
        if (p.formation === "SHOTGUN") s.add("shotgun");
        if (p.formation) s.add("formationKnown");
      }

      const scramble = type === "run" && r["qb_scramble"] === "1";
      if (p && ((type === "pass" && dropback) || scramble)) {
        const sack = r["sack"] === "1";
        const complete = r["complete_pass"] === "1";
        const attempt = !sack && !scramble;
        if (!Number.isNaN(p.rushers) && p.rushers > 0) {
          const rush = p.rushers >= 7 ? "7+" : p.rushers <= 3 ? "3-" : String(p.rushers);
          s.add("rushKnown");
          if (p.rushers >= 5) s.add("blitzes");
          t.add(`rush|${p.coverage || "unknown"}|${rush}`);
          t.add(`rushOut|${rush}|plays`);
          if (p.pressure) t.add(`rushOut|${rush}|pressure`);
          if (sack) t.add(`rushOut|${rush}|sack`);
          if (attempt) {
            t.add(`rushOut|${rush}|att`);
            if (complete) t.add(`rushOut|${rush}|cmp`);
            if (r["interception"] === "1") t.add(`rushOut|${rush}|int`);
            if (complete && yards >= 20) t.add(`rushOut|${rush}|explosive`);
            if (complete) t.add(`rushOut|${rush}|yds`, yards);
          }
        }
        s.add("dropbacksCharted");
        if (p.pressure) s.add("pressures");
        const pk = p.pressure ? "pressured" : "clean";
        t.add(`press|${pk}|plays`);
        if (sack) t.add(`press|${pk}|sack`);
        if (scramble) t.add(`press|${pk}|scramble`);
        if (attempt) {
          t.add(`press|${pk}|att`);
          if (complete) t.add(`press|${pk}|cmp`);
          if (complete && yards >= 20) t.add(`press|${pk}|explosive`);
          if (r["interception"] === "1") t.add(`press|${pk}|int`);
          if (complete) t.add(`press|${pk}|yds`, yards);
        }
        if (!Number.isNaN(p.timeToThrow) && attempt) {
          values.timeToThrow!.push(p.timeToThrow);
          (p.pressure ? values.timeToThrowPressured! : values.timeToThrowClean!).push(
            p.timeToThrow,
          );
        }
        if (p.coverage) {
          s.add("coverageKnown");
          if (p.manZone === "MAN_COVERAGE") s.add("manCoverage");
          t.add(`cov|${p.defense ?? "unknown"}|${p.coverage}`);
          t.add(`covOut|${p.coverage}|plays`);
          if (sack) t.add(`covOut|${p.coverage}|sack`);
          if (attempt) {
            t.add(`covOut|${p.coverage}|att`);
            if (complete) t.add(`covOut|${p.coverage}|cmp`);
            if (complete && yards >= 20) t.add(`covOut|${p.coverage}|explosive`);
            if (r["interception"] === "1") t.add(`covOut|${p.coverage}|int`);
            if (complete) t.add(`covOut|${p.coverage}|yds`, yards);
          }
        }
        if (attempt && p.route) {
          const air = num(r["air_yards"]);
          t.add(`route|${p.route}`);
          if (complete) t.add(`routeCmp|${p.route}`);
          if (!Number.isNaN(air)) t.add(`routeAir|${p.route}`, air);
        }
      }

      // FTN charting (share-alike): play-action, screens, RPOs, drops...
      const f = ftn.get(key);
      if (f && scrimmage && down >= 1) {
        if (dropback) {
          charting.add("dropbacks");
          if (flag(f["is_play_action"])) charting.add("playAction");
          if (flag(f["is_screen_pass"])) charting.add("screens");
          if (flag(f["is_throw_away"])) charting.add("throwAways");
          const pa = flag(f["is_play_action"]) ? "pa" : "nopa";
          charting.add(`${pa}|plays`);
          if (r["sack"] === "1") charting.add(`${pa}|sack`);
          if (r["sack"] !== "1" && r["qb_scramble"] !== "1") {
            charting.add(`${pa}|att`);
            charting.add(`${pa}|yds`, r["complete_pass"] === "1" ? yards : 0);
            charting.add("targets");
            if (flag(f["is_drop"])) charting.add("drops");
            if (flag(f["is_catchable_ball"])) charting.add("catchable");
            if (flag(f["is_contested_ball"])) charting.add("contested");
            if (flag(f["is_interception_worthy"])) charting.add("interceptionWorthy");
          }
        }
        if (flag(f["is_rpo"])) charting.add("rpo");
        charting.add("scrimmagePlays");
        if (togo <= 1 && down >= 3) {
          charting.add("shortYardagePlays");
          if (flag(f["is_qb_sneak"])) charting.add("qbSneaks");
        }
      }
    });

    const teamGames = games.size * 2;
    const ss: Record<string, number> = {
      penaltiesPerTeamGame: s.get("penalties") / teamGames,
      penaltyYardsPerTeamGame: s.get("penaltyYards") / teamGames,
      injuriesPerTeamGame: s.get("injuries") / teamGames,
    };
    if (PARTICIPATION_SEASONS.includes(season)) {
      ss["pressureRate"] = s.get("pressures") / s.get("dropbacksCharted");
      ss["blitzRate"] = s.get("blitzes") / s.get("rushKnown");
      ss["personnel11Share"] = s.get("personnel11") / s.get("personnelPlays");
      ss["shotgunShare"] = s.get("shotgun") / s.get("formationKnown");
      ss["manCoverageShare"] = s.get("manCoverage") / s.get("coverageKnown");
    }
    perSeason[season] = ss;
  }

  // Targets with ranges (real spread across seasons, plus a little room).
  const keys = [...new Set(Object.values(perSeason).flatMap((v) => Object.keys(v)))];
  const targets = Object.fromEntries(
    keys.map((key) => {
      const vals = Object.values(perSeason)
        .map((v) => v[key])
        .filter((v): v is number => v !== undefined);
      const lo = Math.min(...vals);
      const hi = Math.max(...vals);
      const room = 0.25 * (hi - lo) + 0.03 * Math.abs(mean(vals));
      const cap = /Share|Rate/.test(key) ? 1 : Infinity;
      return [
        key,
        {
          real: round(mean(vals)),
          bySeason: Object.fromEntries(
            Object.entries(perSeason)
              .filter(([, v]) => v[key] !== undefined)
              .map(([season, v]) => [season, round(v[key]!)]),
          ),
          range: [round(lo - room), round(Math.min(cap, hi + room))],
        },
      ];
    }),
  );

  // Penalty rates per opportunity.
  const penalties: Record<
    string,
    { phase: string; side: string; perGame: number; yards: number; firstDownShare: number }
  > = {};
  const seasonsCount = PBP_SEASONS.length;
  for (const [k, v] of t.m) {
    if (!k.startsWith("pen|")) continue;
    const [, phase, side, ptype] = k.split("|") as [string, string, string, string];
    const id = `${phase}|${side}|${ptype}`;
    penalties[id] = {
      phase,
      side,
      // Per team per game, averaged over the seasons (272 games, 544 team-games a season).
      perGame: round(v / (544 * seasonsCount), 4),
      yards: round(t.get(`penYards|${id}`) / v, 1),
      firstDownShare: round(t.get(`penFirstDown|${id}`) / v),
    };
  }

  const outcome = (prefix: string, group: string) => ({
    plays: t.get(`${prefix}|${group}|plays`),
    sackRate: round(
      t.get(`${prefix}|${group}|sack`) / Math.max(1, t.get(`${prefix}|${group}|plays`)),
    ),
    pressureRate: round(
      t.get(`${prefix}|${group}|pressure`) / Math.max(1, t.get(`${prefix}|${group}|plays`)),
    ),
    completionPct: round(
      t.get(`${prefix}|${group}|cmp`) / Math.max(1, t.get(`${prefix}|${group}|att`)),
    ),
    yardsPerAttempt: round(
      t.get(`${prefix}|${group}|yds`) / Math.max(1, t.get(`${prefix}|${group}|att`)),
      2,
    ),
    interceptionRate: round(
      t.get(`${prefix}|${group}|int`) / Math.max(1, t.get(`${prefix}|${group}|att`)),
    ),
    explosiveRate: round(
      t.get(`${prefix}|${group}|explosive`) / Math.max(1, t.get(`${prefix}|${group}|att`)),
    ),
  });

  const routes = Object.fromEntries(
    [...t.m.entries()]
      .filter(([k, v]) => k.startsWith("route|") && v > 200)
      .map(([k, v]) => {
        const route = k.slice(6);
        return [
          route,
          {
            share: v,
            completionPct: round(t.get(`routeCmp|${route}`) / v),
            airYards: round(t.get(`routeAir|${route}`) / v, 1),
          },
        ];
      }),
  );
  const routeTotal = Object.values(routes).reduce((a, r) => a + r.share, 0);
  for (const r of Object.values(routes)) r.share = round(r.share / routeTotal);

  const epTable: Record<string, number> = {};
  for (const [k, list] of ep) if (list.length >= 30) epTable[k] = round(mean(list), 3);

  const gapPlays = (g: string) => t.get(`gap|${g}`);
  const reference = {
    personnelBySituation: Object.fromEntries(
      ["run", "pass"].flatMap((call) =>
        ["1st10", "short", "long", "goal-line", "other"].map((sit) => [
          `${call}|${sit}`,
          t.shares(`pers|${call}|${sit}|`, 30),
        ]),
      ),
    ),
    formationByPersonnel: Object.fromEntries(
      ["run", "pass"].flatMap((call) =>
        ["11", "12", "21", "13", "22", "10", "20"].map((pers) => [
          `${call}|${pers}`,
          t.shares(`form|${call}|${pers}|`, 30),
        ]),
      ),
    ),
    threeSafetyShare: {
      note: "Share of nickel (5 DB) and dime (6 DB) snaps where three or more of the defensive backs are safeties.",
      nickel: round(t.get("sub|nickel|threeSafeties") / Math.max(1, t.get("sub|nickel"))),
      dime: round(t.get("sub|dime|threeSafeties") / Math.max(1, t.get("sub|dime"))),
    },
    defenseByPersonnel: Object.fromEntries(
      ["11", "12", "21", "13", "22", "10", "20"].map((pers) => [
        pers,
        t.shares(`def|${pers}|`, 30),
      ]),
    ),
    boxByPersonnel: Object.fromEntries(
      ["run", "pass"].flatMap((call) =>
        ["11", "12", "21", "13", "22", "10"].map((pers) => [
          `${call}|${pers}`,
          t.shares(`box|${call}|${pers}|`, 20),
        ]),
      ),
    ),
    coverageByDefense: Object.fromEntries(
      ["base", "nickel", "dime", "goal-line"].map((d) => [d, t.shares(`cov|${d}|`, 20)]),
    ),
    rushersByCoverage: Object.fromEntries(
      ["cover0", "cover1", "cover2", "2man", "cover3", "cover4", "cover6", "other", "unknown"].map(
        (c) => [c, t.shares(`rush|${c}|`, 20)],
      ),
    ),
    outcomesByRushers: Object.fromEntries(
      ["3-", "4", "5", "6", "7+"].map((r) => [r, outcome("rushOut", r)]),
    ),
    outcomesByPressure: {
      clean: outcome("press", "clean"),
      pressured: outcome("press", "pressured"),
    },
    scrambleRateByPressure: {
      clean: round(t.get("press|clean|scramble") / Math.max(1, t.get("press|clean|plays"))),
      pressured: round(
        t.get("press|pressured|scramble") / Math.max(1, t.get("press|pressured|plays")),
      ),
    },
    outcomesByCoverage: Object.fromEntries(
      ["cover0", "cover1", "cover2", "2man", "cover3", "cover4", "cover6"].map((c) => [
        c,
        outcome("covOut", c),
      ]),
    ),
    timeToThrowQuantiles: {
      points: QUANTILES,
      all: quantiles(values.timeToThrow!),
      clean: quantiles(values.timeToThrowClean!),
      pressured: quantiles(values.timeToThrowPressured!),
    },
    routes,
    runGaps: Object.fromEntries(
      [...t.m.keys()]
        .filter((k) => k.startsWith("gap|"))
        .map((k) => {
          const g = k.slice(4);
          return [
            g,
            { share: gapPlays(g), yardsPerCarry: round(t.get(`gapYards|${g}`) / gapPlays(g), 2) },
          ];
        }),
    ),
    runYardsByBox: Object.fromEntries(
      ["5-", "6", "7", "8+"].map((b) => [
        b,
        {
          share: t.get(`runBox|${b}`),
          yardsPerCarry: round(t.get(`runBoxYards|${b}`) / Math.max(1, t.get(`runBox|${b}`)), 2),
        },
      ]),
    ),
    penalties,
    expectedPoints: {
      note: "Mean nflverse expected points by down | distance to go (1-10, 11-14, 15+) | yards-to-goal band (index = floor((yards to goal - 1) / 5)).",
      table: epTable,
    },
  };
  const gapTotal = Object.values(reference.runGaps).reduce((a, g) => a + g.share, 0);
  for (const g of Object.values(reference.runGaps)) g.share = round(g.share / gapTotal);
  const boxTotal = Object.values(reference.runYardsByBox).reduce((a, g) => a + g.share, 0);
  for (const g of Object.values(reference.runYardsByBox)) g.share = round(g.share / boxTotal);

  writeFileSync(
    join(ROOT, "calibration", "matchups.json"),
    JSON.stringify(
      {
        source: `nflverse play-by-play (${PBP_SEASONS.join(", ")}) and participation (${PARTICIPATION_SEASONS.join(", ")}) data, github.com/nflverse/nflverse-data, CC-BY-4.0. Regular seasons. Built by \`npm run pipeline -- matchups\`.`,
        targets,
        reference,
      },
      null,
      2,
    ) + "\n",
  );

  const c = charting;
  const pa = (k: string) => ({
    sackRate: round(c.get(`${k}|sack`) / Math.max(1, c.get(`${k}|plays`))),
    yardsPerAttempt: round(c.get(`${k}|yds`) / Math.max(1, c.get(`${k}|att`)), 2),
  });
  writeFileSync(
    join(ROOT, "calibration", "charting.json"),
    JSON.stringify(
      {
        source: `FTN charting data via nflverse (${CHARTING_SEASONS.join(", ")}), github.com/nflverse/nflverse-data. Data by FTN Data, licensed CC-BY-SA-4.0; this file of numbers derived from it is shared under the same license (CC-BY-SA-4.0). Built by \`npm run pipeline -- matchups\`.`,
        license: "CC-BY-SA-4.0",
        playActionRate: round(c.get("playAction") / c.get("dropbacks")),
        screenRate: round(c.get("screens") / c.get("dropbacks")),
        rpoRate: round(c.get("rpo") / c.get("scrimmagePlays")),
        throwAwayRate: round(c.get("throwAways") / c.get("dropbacks")),
        dropRate: round(c.get("drops") / c.get("targets")),
        catchableRate: round(c.get("catchable") / c.get("targets")),
        contestedRate: round(c.get("contested") / c.get("targets")),
        interceptionWorthyRate: round(c.get("interceptionWorthy") / c.get("targets")),
        qbSneakShareOfShortYardage: round(
          c.get("qbSneaks") / Math.max(1, c.get("shortYardagePlays")),
        ),
        playAction: pa("pa"),
        noPlayAction: pa("nopa"),
      },
      null,
      2,
    ) + "\n",
  );

  console.log("\nWrote calibration/matchups.json and calibration/charting.json\n");
  for (const [key, v] of Object.entries(targets))
    console.log(
      `${key.padEnd(26)} ${String(v.real).padStart(9)}   range ${v.range[0]} to ${v.range[1]}`,
    );
}
