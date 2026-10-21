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
import { advanceUntil, parseLeague, serializeLeague, type League } from "@fgm/sim-core";
import { describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "..");
const LEAGUE_FILE = join(ROOT, "pipeline", "private", "out", "real-league-2026.json");
const CACHE = join(ROOT, "pipeline", "cache", "nflverse");
const MADDEN = join(ROOT, "pipeline", "private", "madden", "ratings-2025.csv");
const ready = existsSync(LEAGUE_FILE) && existsSync(join(CACHE, "players.csv.gz"));

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

  it("a season plays from start to finish", () => {
    const copy = parseLeague(text);
    advanceUntil(copy, (l) => l.calendar.stage === "complete");
    expect(copy.history.at(-1)!.season).toBe(2026);
  }, 120_000);

  it.skipIf(!existsSync(MADDEN))(
    "rebuilding from the same inputs gives an identical file",
    async () => {
      const { buildLeague } = await import("../pipeline/src/league");
      const { league: rebuilt } = await buildLeague();
      expect(serializeLeague(rebuilt)).toBe(text);
    },
    300_000,
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
