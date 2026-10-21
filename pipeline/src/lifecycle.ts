/**
 * Real-NFL numbers about careers (Phase 9): how players age by position, how
 * long careers last, when players retire, and the league's age mix.
 *
 * Sources (nflverse, CC-BY-4.0): players (birth dates, positions, first and
 * last seasons) and snap counts 2013-2025. Names are never read; players are
 * matched by their ids. Output: calibration/lifecycle.json.
 *
 * Aging uses the "delta method": for the same players in consecutive seasons,
 * the change in their share of their team's snaps, by age. Playing time is the
 * one measure of ability every position has, and coaches play the better
 * players. A pair counts when the player played in both seasons and had a real
 * role in either one (selecting on one season alone picks lucky years, which
 * regress and look like aging). Leaving the league is retirement, measured
 * separately.
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { ensure, mean, num, readCsv, RELEASE, ROOT, round } from "./matchups";

/** nflverse's 2012 snap-count file is an empty stub: snap counts start in 2013. */
const SNAP_SEASONS = Array.from({ length: 13 }, (_, i) => 2013 + i);
/** Careers counted from classes whose players have (almost all) finished. */
const CAREER_CLASSES: [number, number] = [2000, 2012];
const AGES: [number, number] = [21, 40];
/** A player counts in a season's aging pairs if he played this share of snaps (a real role). */
const MIN_SHARE = 0.05;
/** Ages with fewer pairs than this are left out (too noisy). */
const MIN_PAIRS = 25;

/** nflverse positions -> the sim's position groups (EDGE: defensive ends and outside linebackers). */
const GROUP: Record<string, string> = {
  QB: "QB",
  RB: "RB",
  FB: "FB",
  WR: "WR",
  TE: "TE",
  T: "OL",
  OT: "OL",
  G: "OL",
  OG: "OL",
  C: "OL",
  OL: "OL",
  DE: "EDGE",
  OLB: "EDGE",
  DT: "DT",
  NT: "DT",
  DL: "DT",
  LB: "LB",
  ILB: "LB",
  MLB: "LB",
  CB: "CB",
  DB: "CB",
  S: "S",
  FS: "S",
  SS: "S",
  SAF: "S",
  K: "K",
  P: "P",
  LS: "LS",
};

interface Person {
  birth: string;
  group: string;
  rookie: number;
  last: number;
}

function ageOn(birth: string, date: string): number {
  const [by, bm, bd] = birth.split("-").map(Number) as [number, number, number];
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return y - by - (m < bm || (m === bm && d < bd) ? 1 : 0);
}

function quantiles(values: number[], ps = [0.1, 0.25, 0.5, 0.75, 0.9]): number[] {
  const s = [...values].sort((a, b) => a - b);
  return ps.map((p) => s[Math.min(s.length - 1, Math.round(p * (s.length - 1)))] ?? 0);
}

export async function lifecycle(): Promise<void> {
  // People: birth dates and positions, by gsis and by pfr id.
  const people = new Map<string, Person>();
  const byPfr = new Map<string, string>();
  await readCsv(await ensure("players.csv.gz", `${RELEASE}/players/players.csv.gz`), (r) => {
    const group = GROUP[r.position ?? ""];
    if (!group || !r.birth_date || !r.gsis_id) return;
    people.set(r.gsis_id, {
      birth: r.birth_date,
      group,
      rookie: num(r.rookie_season),
      last: num(r.last_season),
    });
    if (r.pfr_id) byPfr.set(r.pfr_id, r.gsis_id);
  });

  // Each player's share of his team's snaps per season (games he missed count as zero).
  const share = new Map<string, Map<number, number>>(); // gsis -> season -> share
  for (const season of SNAP_SEASONS) {
    const file = `snap_counts_${season}.csv.gz`;
    const teamGames = season >= 2021 ? 17 : 16;
    const sums = new Map<string, number>();
    await readCsv(await ensure(file, `${RELEASE}/snap_counts/${file}`), (r) => {
      if (r.game_type !== "REG") return;
      const gsis = byPfr.get(r.pfr_player_id ?? "");
      if (!gsis) return;
      const pct = Math.max(num(r.offense_pct) || 0, num(r.defense_pct) || 0);
      sums.set(gsis, (sums.get(gsis) ?? 0) + pct);
    });
    for (const [gsis, total] of sums) {
      const m = share.get(gsis) ?? new Map<number, number>();
      m.set(season, Math.min(1, total / teamGames));
      share.set(gsis, m);
    }
  }

  // Aging pairs: change in share from season t to t+1, by age in season t.
  const deltas = new Map<string, Map<number, number[]>>(); // group -> age -> deltas
  for (const [gsis, seasons] of share) {
    const p = people.get(gsis);
    if (!p || p.group === "K" || p.group === "P" || p.group === "LS") continue;
    for (const [season, now] of seasons) {
      // Both seasons played (a season lost to injury isn't aging), and a real role in either
      // one: selecting on the first season alone would pick lucky years that regress.
      const next = seasons.get(season + 1);
      if (next === undefined || Math.max(now, next) < MIN_SHARE) continue;
      const age = ageOn(p.birth, `${season}-09-01`);
      if (age < AGES[0] || age > AGES[1]) continue;
      const byAge = deltas.get(p.group) ?? new Map<number, number[]>();
      byAge.set(age, [...(byAge.get(age) ?? []), next - now]);
      deltas.set(p.group, byAge);
    }
  }
  // Quarterbacks: a backup's share stays near zero whatever his ability, so their aging is
  // measured on efficiency instead (expected points per play), among real starters.
  const QB_SEASONS: [number, number] = [2000, 2025];
  const QB_MIN_PLAYS = 200;
  const qbPlays = new Map<string, Map<number, number>>(); // gsis -> season -> EPA per play
  for (let season = QB_SEASONS[0]; season <= QB_SEASONS[1]; season++) {
    const file = `stats_player_reg_${season}.csv.gz`;
    await readCsv(await ensure(file, `${RELEASE}/stats_player/${file}`), (r) => {
      if (people.get(r.player_id ?? "")?.group !== "QB") return;
      const plays = (num(r.attempts) || 0) + (num(r.sacks_suffered) || 0) + (num(r.carries) || 0);
      if (plays < QB_MIN_PLAYS) return;
      const epa = (num(r.passing_epa) || 0) + (num(r.rushing_epa) || 0);
      const m = qbPlays.get(r.player_id!) ?? new Map<number, number>();
      m.set(season, epa / plays);
      qbPlays.set(r.player_id!, m);
    });
  }
  const qbDeltas = new Map<number, number[]>();
  for (const [gsis, seasons] of qbPlays) {
    const p = people.get(gsis)!;
    for (const [season, now] of seasons) {
      const next = seasons.get(season + 1);
      if (next === undefined) continue;
      const age = ageOn(p.birth, `${season}-09-01`);
      if (age < AGES[0] || age > AGES[1]) continue;
      qbDeltas.set(age, [...(qbDeltas.get(age) ?? []), next - now]);
    }
  }
  deltas.set("QB", qbDeltas);
  // How much each measure varies among regulars (to put every position on one scale).
  const spread = new Map<string, number>();
  for (const [group, byAge] of deltas) {
    const levels: number[] = [];
    if (group === "QB") for (const s of qbPlays.values()) levels.push(...s.values());
    else
      for (const [gsis, seasons] of share)
        if (people.get(gsis)?.group === group)
          for (const v of seasons.values()) if (v >= MIN_SHARE) levels.push(v);
    const m = mean(levels);
    spread.set(group, Math.sqrt(mean(levels.map((x) => (x - m) ** 2))) || 1);
    void byAge;
  }

  const aging: Record<string, unknown> = {};
  for (const [group, byAge] of [...deltas].sort((a, b) => a[0].localeCompare(b[0]))) {
    const rows: { age: number; n: number; mean: number; sd: number }[] = [];
    for (let age = AGES[0]; age <= AGES[1]; age++) {
      const d = byAge.get(age) ?? [];
      if (d.length < MIN_PAIRS) continue;
      const m = mean(d);
      rows.push({
        age,
        n: d.length,
        mean: round(m),
        sd: round(Math.sqrt(mean(d.map((x) => (x - m) ** 2)))),
      });
    }
    // Centered: the measure is shared (each year's rookies take snaps from everyone), so on
    // average incumbents lose some; only the shape by age is kept. Then smoothed over three ages
    // and put in standard deviations of the measure among regulars, so positions compare.
    const all = [...byAge.values()].flat();
    const center = mean(all);
    const sd = spread.get(group)!;
    const curve = rows.map((r, i) => {
      const near = rows.slice(Math.max(0, i - 1), i + 2);
      const n = near.reduce((a, x) => a + x.n, 0);
      return {
        age: r.age,
        change: round((near.reduce((a, x) => a + x.mean * x.n, 0) / n - center) / sd, 3),
      };
    });
    // Peak: where the running total of the changes is highest.
    let total = 0;
    let best = -Infinity;
    let peak = curve[0]?.age ?? 27;
    for (const c of curve) {
      total += c.change;
      if (total > best) {
        best = total;
        peak = c.age + 1;
      }
    }
    aging[group] = {
      measure: group === "QB" ? "expected points per play (starters)" : "share of team snaps",
      peakAge: peak,
      spreadAmongRegulars: round(sd),
      curve,
      byAge: rows,
    };
  }

  // Careers: classes 2000-2012 (nearly all finished), seasons from first to last.
  const careers: Record<string, unknown> = {};
  const lengths = new Map<string, number[]>();
  const endAges = new Map<string, number[]>();
  for (const p of people.values()) {
    if (!(p.rookie >= CAREER_CLASSES[0] && p.rookie <= CAREER_CLASSES[1]) || !(p.last >= p.rookie))
      continue;
    lengths.set(p.group, [...(lengths.get(p.group) ?? []), p.last - p.rookie + 1]);
    endAges.set(p.group, [...(endAges.get(p.group) ?? []), ageOn(p.birth, `${p.last}-09-01`)]);
  }
  for (const group of [...lengths.keys()].sort()) {
    const l = lengths.get(group)!;
    const a = endAges.get(group)!;
    careers[group] = {
      players: l.length,
      seasonsMean: round(mean(l), 2),
      seasonsQuantiles: quantiles(l),
      lastSeasonAgeMean: round(mean(a), 2),
      lastSeasonAgeQuantiles: quantiles(a),
      // Share of a class still playing after this many seasons.
      stillPlaying: [1, 2, 3, 4, 5, 6, 8, 10, 12, 15].map((n) => [
        n,
        round(l.filter((x) => x > n).length / l.length, 3),
      ]),
    };
  }

  // The age mix: everyone who played in the last season, by group.
  const ageMix: Record<string, unknown> = {};
  const last = SNAP_SEASONS.at(-1)!;
  const ages = new Map<string, number[]>();
  for (const [gsis, seasons] of share) {
    if (!seasons.has(last)) continue;
    const p = people.get(gsis);
    if (!p) continue;
    ages.set(p.group, [...(ages.get(p.group) ?? []), ageOn(p.birth, `${last}-09-01`)]);
  }
  const all: number[] = [];
  for (const group of [...ages.keys()].sort()) {
    const a = ages.get(group)!;
    all.push(...a);
    ageMix[group] = { players: a.length, mean: round(mean(a), 2), quantiles: quantiles(a) };
  }
  ageMix["ALL"] = { players: all.length, mean: round(mean(all), 2), quantiles: quantiles(all) };

  const out = {
    source:
      "nflverse players and snap counts 2013-2025 (CC-BY-4.0), built by `npm run pipeline -- lifecycle`. " +
      "Aging: change in a player's share of team snaps from one season to the next, by age (players who left the league are excluded). " +
      `Careers: draft classes ${CAREER_CLASSES[0]}-${CAREER_CLASSES[1]}, first to last season played. Age mix: everyone who played in ${last}.`,
    aging,
    careers,
    ageMix,
  };
  writeFileSync(join(ROOT, "calibration", "lifecycle.json"), JSON.stringify(out, null, 2) + "\n");
  console.log(
    `Wrote calibration/lifecycle.json: aging for ${Object.keys(aging).length} groups, careers for ${Object.keys(careers).length}.`,
  );
  for (const [g, a] of Object.entries(aging) as [string, { peakAge: number }][])
    console.log(
      `  ${g.padEnd(5)} peak ${a.peakAge}  career ${(careers[g] as { seasonsMean: number })?.seasonsMean ?? "-"} seasons  last season at ${(careers[g] as { lastSeasonAgeMean: number })?.lastSeasonAgeMean ?? "-"}`,
    );
}
