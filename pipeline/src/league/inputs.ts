/**
 * The real-league import's inputs: public nflverse files (downloaded once into
 * pipeline/cache/) and the private Madden ratings file (pipeline/private/).
 */
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { CACHE, ensure, readCsv, RELEASE, ROOT, type Row } from "../matchups";

export const SEASON = 2025;
export const PRIVATE = join(ROOT, "pipeline", "private");
export const OUT = join(PRIVATE, "out");
export const MADDEN_FILE = join(PRIVATE, "madden", "ratings-2025.csv");
export const COACHES_FILE = join(PRIVATE, "coaches-2025.csv");
export const OVERRIDES_FILE = join(PRIVATE, "overrides.csv");

/** Real team codes that differ from this league's team ids (two cities have two teams). */
const LEAGUE_ID: Record<string, string> = { NYJ: "NYA", NYG: "NYB", LAC: "LAA", LA: "LAB" };
export const leagueTeam = (code: string) => LEAGUE_ID[code] ?? code;

const FILES: Record<string, string> = {
  rosters: `roster_weekly_${SEASON}.csv.gz`,
  players: "players.csv.gz",
  combine: "combine.csv.gz",
  stats: `stats_player_reg_${SEASON}.csv.gz`,
  snaps: `snap_counts_${SEASON}.csv.gz`,
  games: "games.csv.gz",
  pbp: `play_by_play_${SEASON}.csv.gz`,
  defense: "advstats_season_def.csv.gz",
  ngsRushing: "ngs_rushing.csv.gz",
  injuries2023: "injuries_2023.csv.gz",
  injuries2024: "injuries_2024.csv.gz",
  injuries2025: "injuries_2025.csv.gz",
};
const URLS: Record<string, string> = {
  rosters: `${RELEASE}/weekly_rosters/${FILES.rosters}`,
  players: `${RELEASE}/players/${FILES.players}`,
  combine: `${RELEASE}/combine/${FILES.combine}`,
  stats: `${RELEASE}/stats_player/${FILES.stats}`,
  snaps: `${RELEASE}/snap_counts/${FILES.snaps}`,
  games: `${RELEASE}/schedules/${FILES.games}`,
  pbp: `${RELEASE}/pbp/${FILES.pbp}`,
  defense: `${RELEASE}/pfr_advstats/${FILES.defense}`,
  ngsRushing: `${RELEASE}/nextgen_stats/${FILES.ngsRushing}`,
  injuries2023: `${RELEASE}/injuries/${FILES.injuries2023}`,
  injuries2024: `${RELEASE}/injuries/${FILES.injuries2024}`,
  injuries2025: `${RELEASE}/injuries/${FILES.injuries2025}`,
};

export async function download(): Promise<void> {
  for (const key of Object.keys(FILES)) await ensure(FILES[key]!, URLS[key]!);
  mkdirSync(OUT, { recursive: true });
}

export async function rows(key: keyof typeof FILES & string): Promise<Row[]> {
  const out: Row[] = [];
  await readCsv(join(CACHE, FILES[key]!), (r) => out.push(r));
  return out;
}

/** The Madden file, or null when it isn't there (ratings then come from public data only). */
export async function maddenRows(): Promise<Row[] | null> {
  if (!existsSync(MADDEN_FILE)) return null;
  const out: Row[] = [];
  await readCsv(MADDEN_FILE, (r) => out.push(r));
  return out;
}

export async function privateCsv(path: string): Promise<Row[]> {
  if (!existsSync(path)) return [];
  const out: Row[] = [];
  await readCsv(path, (r) => out.push(r));
  return out;
}
