/**
 * The real league as built on this machine (Phase 6). The league file, the
 * Madden file and the downloaded nflverse data are never committed, so these
 * tests skip where they're missing (as in CI). Build first with
 * `npm run pipeline -- league`.
 */
import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { parse } from "csv-parse/sync";
import { CORE_STATS, measureSeason, scorecard, type MeasuredGame } from "@fgm/game-engine";
import {
  advanceUntil,
  overallAt,
  rosterProblems,
  parseLeague,
  seasonAndCareerRecords,
  recordsView,
  almanacView,
  serializeLeague,
  startRealLeague,
  type League,
} from "@fgm/sim-core";
import { describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "..");
const LEAGUE_FILE = join(ROOT, "pipeline", "private", "out", "real-league-2026.json");
const CACHE = join(ROOT, "pipeline", "cache", "nflverse");
const MADDEN = join(ROOT, "pipeline", "private", "madden", "ratings-2025.csv");
const ready = existsSync(LEAGUE_FILE) && existsSync(join(CACHE, "players.csv.gz"));
const CAP_VALIDATION = join(ROOT, "pipeline", "private", "out", "cap-validation.json");

/** Cap and roster legality (CLAUDE.md rule 9): every rule, as the sim checks it. */
const capProblems = (league: League) => rosterProblems(league);

type Row = Record<string, string>;
const csv = (file: string): Row[] =>
  parse(gunzipSync(readFileSync(join(CACHE, file))), {
    columns: true,
    relax_column_count: true,
  }) as Row[];
const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\b(jr|sr|ii|iii|iv|v)\b\.?/g, "")
    .replace(/[^a-z ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
const LEAGUE_ID: Record<string, string> = { NYJ: "NYA", NYG: "NYB", LAC: "LAA", LA: "LAB" };
const team = (code: string) => LEAGUE_ID[code] ?? code;

describe.skipIf(!ready)("the real league build", () => {
  const text = ready ? readFileSync(LEAGUE_FILE, "utf8") : "";
  const league: League = ready ? parseLeague(text) : (null as unknown as League);
  const games = ready ? csv("games.csv.gz") : [];

  it("loads like any save and saves back byte for byte", () => {
    expect(serializeLeague(league)).toBe(text);
    expect(league.meta.kind).toBe("real");
    expect(league.season).toBe(2026);
    expect(league.date).toBe("2026-02-09");
  });

  it("has no real names: no player or coach shares a full name with any real player, past or present", () => {
    const real = new Set<string>();
    for (const p of csv("players.csv.gz")) {
      if (p.display_name) real.add(norm(p.display_name));
      for (const first of [p.first_name, p.common_first_name, p.football_name])
        if (first && p.last_name) real.add(norm(`${first} ${p.last_name}`));
    }
    const coaches = join(ROOT, "pipeline", "private", "coaches-2025.csv");
    if (existsSync(coaches))
      for (const c of parse(readFileSync(coaches), { columns: true }) as Row[])
        real.add(norm(c.name!));
    const clashes = [...league.players, ...league.coaches].filter((p) =>
      real.has(norm(`${p.firstName} ${p.lastName}`)),
    );
    expect(clashes).toEqual([]);
  });

  it("every team has a legal offseason roster with every position", () => {
    for (const t of league.teams) {
      const roster = league.players.filter((p) => p.teamId === t.id);
      expect(roster.length).toBeLessThanOrEqual(league.rules.roster.offseasonMax);
      expect(roster.length).toBeGreaterThanOrEqual(53);
      for (const position of [
        "QB",
        "RB",
        "WR",
        "TE",
        "OT",
        "OG",
        "C",
        "EDGE",
        "DT",
        "LB",
        "CB",
        "S",
        "K",
        "P",
      ])
        expect(
          roster.some((p) => p.position === position),
          `${t.id} ${position}`,
        ).toBe(true);
    }
  });

  it("starts cap-legal: every team under the cap, everyone on a roster under contract", () => {
    expect(capProblems(league)).toEqual([]);
  });

  it.skipIf(!existsSync(CAP_VALIDATION))(
    "real contracts reproduce the published cap numbers, and team totals match within tolerance",
    () => {
      const v = JSON.parse(readFileSync(CAP_VALIDATION, "utf8"));
      // Every imported contract's 2026 cap hit against its team's archived cap page.
      expect(v.withinTen / v.contracts).toBeGreaterThan(0.98);
      // Every season on the pages (2026-2029).
      expect(v.yearByYear.withinTen / v.yearByYear.total).toBeGreaterThan(0.95);
      // Team totals against the published Feb 10 figures: nearly all within tolerance, every miss explained.
      const teams = v.teams as { withinTolerance: boolean; why: string }[];
      expect(teams.filter((t) => t.withinTolerance).length).toBeGreaterThanOrEqual(24);
      expect(teams.filter((t) => !t.withinTolerance && t.why === "unexplained")).toEqual([]);
    },
  );

  it("the 2025 season in History is the real one", () => {
    const final = games.find((g) => g.season === "2025" && g.game_type === "SB")!;
    const winner =
      Number(final.home_score) > Number(final.away_score) ? final.home_team! : final.away_team!;
    expect(league.history.at(-1)!.championId).toBe(team(winner));
    const real = games.filter((g) => g.season === "2025" && g.game_type === "REG");
    for (const s of league.history.at(-1)!.standings) {
      const wins = real.filter(
        (g) =>
          (team(g.home_team!) === s.teamId && Number(g.home_score) > Number(g.away_score)) ||
          (team(g.away_team!) === s.teamId && Number(g.away_score) > Number(g.home_score)),
      ).length;
      expect(s.wins, s.teamId).toBe(wins);
    }
  });

  it("the 2026 schedule has every team's real 2026 opponents", () => {
    const pair = (a: string, b: string) => [a, b].sort().join("-");
    const real = games
      .filter((g) => g.season === "2026" && g.game_type === "REG")
      .map((g) => pair(team(g.home_team!), team(g.away_team!)))
      .sort();
    if (real.length === 0) return; // the real schedule isn't out yet
    const ours = league.games.map((g) => pair(g.homeId, g.awayId)).sort();
    expect(ours).toEqual(real);
  });

  it("seasons with the real rosters keep the core stats inside the real ranges (four leagues averaged)", () => {
    const seasons: Record<string, number>[] = [];
    for (const seed of [42, 43, 44, 45]) {
      const copy = startRealLeague(league, { name: "Check", seed });
      const games: MeasuredGame[] = [];
      advanceUntil(copy, (l) => l.calendar.stage === "regular");
      advanceUntil(copy, (l) => l.calendar.stage !== "regular", {
        onGame: (g, output) => games.push({ homeId: g.homeId, awayId: g.awayId, output }),
      });
      seasons.push(measureSeason(games));
      advanceUntil(copy, (l) => l.calendar.stage === "complete");
      expect(copy.history.at(-1)!.season).toBe(2026);
      // Into the next League Year: contracts expire, void years accelerate, teams re-sign and stay
      // legal. (Checked in the offseason, as for fictional leagues: in-season rosters stay at
      // offseason size until Phase 8's cutdowns to 53.)
      advanceUntil(copy, (l) => l.calendar.stage === "offseason");
      expect(copy.season).toBe(2027);
      expect(capProblems(copy), `seed ${seed}`).toEqual([]);
    }
    // One season is noisy (a team's points per game moves about 0.3 by chance; the sack rate about
    // 0.002), so average four.
    const averaged = Object.fromEntries(
      Object.keys(seasons[0]!).map((k) => [
        k,
        seasons.reduce((a, v) => a + (v[k] ?? 0), 0) / seasons.length,
      ]),
    );
    const misses = scorecard(averaged)
      .filter((line) => CORE_STATS.includes(line.key) && !line.pass)
      .map(
        (line) => `${line.key}: ${line.sim.toFixed(3)} (real ${line.range[0]} to ${line.range[1]})`,
      );
    expect(misses).toEqual([]);
  }, 480_000);

  it("the best players at each position are real 2025 regulars", () => {
    for (const position of ["QB", "RB", "WR", "TE", "EDGE", "DT", "LB", "CB", "S"] as const) {
      const top = league.players
        .filter((p) => p.position === position && p.teamId !== null)
        .sort((a, b) => overallAt(b.ratings, position) - overallAt(a.ratings, position))
        .slice(0, 10);
      const regulars = top.filter(
        (p) => (p.stats.find((s) => s.season === 2025)?.line.gp ?? 0) >= 6,
      );
      expect(regulars.length, position).toBeGreaterThanOrEqual(7);
    }
  });

  it("careers carry the real numbers: 2025 totals cover nearly all of the real league's", () => {
    const real = csv("stats_player_reg_2025.csv.gz");
    for (const [key, column] of [
      ["passYds", "passing_yards"],
      ["rushYds", "rushing_yards"],
      ["recYds", "receiving_yards"],
      ["sacks", "def_sacks"],
    ] as const) {
      const ours = league.players.reduce(
        (sum, p) =>
          sum +
          p.stats.filter((s) => s.season === 2025).reduce((a, s) => a + (s.line[key] ?? 0), 0),
        0,
      );
      const total = real.reduce((sum, r) => sum + (Number(r[column]) || 0), 0);
      expect(ours / total, key).toBeGreaterThan(0.9);
      expect(ours / total, key).toBeLessThanOrEqual(1);
    }
    // Long careers go back to 1999 (the first season in the data).
    const seasons = league.players.flatMap((p) => p.stats.map((s) => s.season));
    expect(Math.min(...seasons)).toBeLessThanOrEqual(2010);
  });

  it.skipIf(!existsSync(MADDEN))(
    "rebuilding from the same inputs gives an identical file",
    async () => {
      const { buildLeague } = await import("../pipeline/src/league");
      const { league: rebuilt } = await buildLeague();
      expect(serializeLeague(rebuilt)).toBe(text);
    },
    300_000,
  );

  it.skipIf(!existsSync(join(ROOT, "pipeline", "private", "history", "team-names.json")))(
    "no committed code or data names a real team (nickname) or uses the league's trademarked name",
    () => {
      const { nicknames } = JSON.parse(
        readFileSync(join(ROOT, "pipeline", "private", "history", "team-names.json"), "utf8"),
      ) as { nicknames: string[] };
      const pattern = new RegExp(
        `\\b(${nicknames.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})\\b|super ?bowl`,
        "i",
      );
      const files = execSync("git ls-files", { cwd: ROOT })
        .toString()
        .split("\n")
        .filter((f) => /\.(ts|tsx|json|css|html)$/.test(f) && !f.startsWith("package-lock"));
      const found: string[] = [];
      for (const f of files) {
        const hit = readFileSync(join(ROOT, f), "utf8")
          .split("\n")
          .findIndex((line) => pattern.test(line));
        if (hit >= 0) found.push(`${f}:${hit + 1}`);
      }
      expect(found).toEqual([]);
    },
  );

  it("no committed file contains a 2025 player's or coach's real full name", () => {
    const names = new Set<string>();
    for (const r of csv("roster_weekly_2025.csv.gz")) if (r.full_name) names.add(r.full_name);
    const coaches = join(ROOT, "pipeline", "private", "coaches-2025.csv");
    if (existsSync(coaches))
      for (const c of parse(readFileSync(coaches), { columns: true }) as Row[]) names.add(c.name!);
    const files = execSync("git ls-files", { cwd: ROOT })
      .toString()
      .split("\n")
      .filter((f) => /\.(ts|tsx|md|json|css|html)$/.test(f) && !f.startsWith("package-lock"));
    const found: string[] = [];
    for (const f of files) {
      const content = readFileSync(join(ROOT, f), "utf8");
      for (const n of names) if (n.includes(" ") && content.includes(n)) found.push(`${f}: ${n}`);
    }
    expect(found).toEqual([]);
  }, 120_000);
});

describe.skipIf(!ready)("the real league's past (Phase 15)", () => {
  const league: League = ready ? parseLeague(readFileSync(LEAGUE_FILE, "utf8")) : (null as never);

  it("has every season since the first championship game (1966), with the real champions by franchise", () => {
    expect(league.annals.map((a) => a.season)).toEqual(
      Array.from({ length: 59 }, (_, i) => 1966 + i),
    );
    const titles = new Map<string, number>();
    for (const a of league.annals) titles.set(a.championId!, (titles.get(a.championId!) ?? 0) + 1);
    // Titles 1966-2024 by franchise (a club that moved or renamed is one franchise).
    expect(titles.get("GB")).toBe(4);
    expect(titles.get("PIT")).toBe(6);
    expect(titles.get("NE")).toBe(6);
    expect(titles.get("KC")).toBe(4);
    expect(titles.get("LV")).toBe(3);
    // 2025 is the league's own played-through season, so the almanac has every year once.
    const seasons = almanacView(league).seasons.map((s) => s.season);
    expect(new Set(seasons).size).toBe(seasons.length);
    expect(seasons.at(-1)).toBe(1966);
    expect(seasons[0]).toBe(2025);
  });

  it("has an MVP for every season, the Hall of Fame's classes, retired numbers and award winners tied to current players", () => {
    for (let s = 1966; s <= 2025; s++)
      expect(
        league.awards.some((a) => a.season === s && a.award === "mvp"),
        `${s} MVP`,
      ).toBe(true);
    const classes = new Map<number, number>();
    for (const h of league.hallOfFame.filter((x) => x.kind === "player" && x.inducted >= 2006))
      classes.set(h.inducted, (classes.get(h.inducted) ?? 0) + 1);
    expect(classes.get(2026)).toBe(5);
    expect(league.retiredNumbers.filter((r) => r.teamId === "CHI").length).toBe(14);
    // The 2025 MVP is a player still on a roster, with his fictional name and a page.
    const mvp = league.awards.find((a) => a.season === 2025 && a.award === "mvp")!;
    const player = league.players.find((p) => p.id === mvp.playerId)!;
    expect(`${player.firstName} ${player.lastName}`).toBe(mvp.name);
  });

  it("no real person's name appears anywhere in the league's past", () => {
    const real = new Set<string>();
    for (const r of csv("players.csv.gz")) {
      if (r.display_name) real.add(norm(r.display_name));
      if (r.first_name && r.last_name) real.add(norm(`${r.first_name} ${r.last_name}`));
    }
    const names = [
      ...league.formerPlayers.map((c) => `${c.firstName} ${c.lastName}`),
      ...league.awards.map((a) => a.name),
      ...league.hallOfFame.map((h) => h.name),
      ...league.retiredNumbers.map((r) => r.name),
      ...league.records.flatMap((r) => r.top.map((e) => e.name)),
    ];
    expect(names.filter((n) => real.has(norm(n)))).toEqual([]);
  });

  it("a real record falls: a quarterback passes the single-season mark, the book keeps the old holder, and the feed says so", () => {
    const l = parseLeague(readFileSync(LEAGUE_FILE, "utf8"));
    const list = l.records.find(
      (r) => r.scope === "league" && r.level === "season" && r.stat === "passYds",
    )!;
    const record = list.top[0]!;
    expect(record.real).toBe(true);
    const qb = l.players.find((p) => p.position === "QB" && p.teamId && p.experience > 2)!;
    // He's 40 yards short of the mark this season... then throws for 100 more.
    qb.stats = qb.stats.filter((s) => s.season !== l.season);
    qb.stats.push({ season: l.season, teamId: qb.teamId!, line: { passYds: record.value - 40 } });
    seasonAndCareerRecords(l, [qb]);
    // (He's passed his own club's marks already; the league record is what's still ahead.)
    const leagueStory = (n: { kind: string; headline: string }) =>
      n.kind === "record" && n.headline.includes("the league record");
    expect(l.news.some(leagueStory)).toBe(false);
    qb.stats.find((s) => s.season === l.season)!.line.passYds = record.value + 60;
    seasonAndCareerRecords(l, [qb]);
    const after = recordsView(l).lists.find((x) => x.level === "season" && x.stat === "passYds")!;
    expect(after.top[0]!.name).toBe(`${qb.firstName} ${qb.lastName}`);
    expect(after.top[1]!.name).toBe(record.name);
    expect(after.recentBreaks[0]!.previous).toContain(record.name);
    const story = l.news.find((n) => leagueStory(n) && n.headline.includes(qb.lastName));
    expect(story?.text).toContain(record.name);
  });
});
