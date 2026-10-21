/**
 * Real careers (Phase 6b): every current player's regular-season stats,
 * season by season back to 1999 (nflverse player stats), and his injury
 * history (2023-25 game-status reports plus 2025 reserve-list weeks).
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { StatKey } from "@fgm/game-engine";
import type { SeasonStats } from "@fgm/sim-core";
import { CACHE, ensure, num, readCsv, RELEASE, type Row } from "../matchups";
import { leagueTeam, SEASON } from "./inputs";

export const FIRST_STATS_SEASON = 1999;

/** Our stat keys as sums of nflverse columns. Longest plays aren't in the season files. */
const STAT_COLUMNS: Partial<Record<StatKey, string[]>> = {
  gp: ["games"],
  passAtt: ["attempts"],
  passCmp: ["completions"],
  passYds: ["passing_yards"],
  passTd: ["passing_tds"],
  passInt: ["passing_interceptions"],
  sacked: ["sacks_suffered"],
  sackedYds: ["sack_yards_lost"],
  airYds: ["passing_air_yards"],
  passEpa: ["passing_epa"],
  rushAtt: ["carries"],
  rushYds: ["rushing_yards"],
  rushTd: ["rushing_tds"],
  rushEpa: ["rushing_epa"],
  targets: ["targets"],
  rec: ["receptions"],
  recYds: ["receiving_yards"],
  recTd: ["receiving_tds"],
  yac: ["receiving_yards_after_catch"],
  fumbles: ["fumbles_total"],
  fumblesLost: ["fumbles_lost_total"],
  tackles: ["def_tackles_solo", "def_tackle_assists"],
  sacks: ["def_sacks"],
  defInt: ["def_interceptions"],
  intYds: ["def_interception_yards"],
  defTd: ["def_tds"],
  fumRec: ["fumble_recovery_opp"],
  passDef: ["def_pass_defended"],
  fgm: ["fg_made"],
  fga: ["fg_att"],
  fgLong: ["fg_long"],
  xpm: ["pat_made"],
  xpa: ["pat_att"],
  punts: ["pt_att"],
  puntYds: ["pt_yards"],
  kr: ["kickoff_returns"],
  krYds: ["kickoff_return_yards"],
  pr: ["punt_returns"],
  prYds: ["punt_return_yards"],
  twoPt: ["passing_2pt_conversions", "rushing_2pt_conversions", "receiving_2pt_conversions"],
  penalties: ["penalties"],
  penaltyYds: ["penalty_yards"],
};

/** EPA and the like are stored to two decimals, sacks keep their halves; counts are whole. */
const DECIMAL: Set<StatKey> = new Set(["passEpa", "rushEpa", "sacks"]);

export async function careers(gsisIds: Set<string>): Promise<Map<string, SeasonStats[]>> {
  const out = new Map<string, SeasonStats[]>();
  for (let season = FIRST_STATS_SEASON; season <= SEASON; season++) {
    const file = `stats_player_reg_${season}.csv.gz`;
    if (!existsSync(join(CACHE, file))) await ensure(file, `${RELEASE}/stats_player/${file}`);
    await readCsv(join(CACHE, file), (r) => {
      const id = r.player_id ?? "";
      if (!gsisIds.has(id) || !r.recent_team) return;
      const line: SeasonStats["line"] = {};
      for (const [key, columns] of Object.entries(STAT_COLUMNS) as [StatKey, string[]][]) {
        const v = columns.reduce((sum, c) => sum + (num(r[c]) || 0), 0);
        if (v !== 0) line[key] = DECIMAL.has(key) ? Math.round(v * 100) / 100 : Math.round(v);
      }
      if (Object.keys(line).length === 0) return;
      const list = out.get(id) ?? [];
      list.push({ season, teamId: leagueTeam(r.recent_team), line });
      out.set(id, list);
    });
  }
  return out;
}

/** Weeks each player missed or was listed out, per season he played, 2023-25. */
export function injuryHistory(
  reports: Row[],
  rosters2025: Row[],
): Map<string, { missedWeeks: number; seasons: number }> {
  const weeks = new Map<string, Set<string>>();
  const mark = (id: string, key: string) => {
    if (!id) return;
    const set = weeks.get(id) ?? new Set<string>();
    set.add(key);
    weeks.set(id, set);
  };
  for (const r of reports)
    if (r.game_type === "REG" && (r.report_status === "Out" || r.report_status === "Doubtful"))
      mark(r.gsis_id ?? "", `${r.season}-${r.week}`);
  // Players on injured reserve aren't on the weekly game-status report.
  for (const r of rosters2025)
    if (r.game_type === "REG" && r.status === "RES") mark(r.gsis_id ?? "", `${r.season}-${r.week}`);
  const seasonsSeen = new Map<string, Set<string>>();
  for (const r of [...reports, ...rosters2025]) {
    const id = r.gsis_id ?? "";
    if (!id) continue;
    const set = seasonsSeen.get(id) ?? new Set<string>();
    set.add(r.season ?? "");
    seasonsSeen.set(id, set);
  }
  const out = new Map<string, { missedWeeks: number; seasons: number }>();
  for (const [id, set] of weeks)
    out.set(id, { missedWeeks: set.size, seasons: seasonsSeen.get(id)?.size ?? 1 });
  return out;
}

/** Hidden injury traits from history (and Madden's injury and toughness ratings where known). */
export const INJURY_TRAITS = {
  /** Missed weeks per season at which a player counts as fully injury-prone. */
  proneAtWeeks: 8,
  proneness: { base: 30, fromHistory: 50, perMaddenPoint: 0.5, maddenTypical: 85 },
  durability: { base: 55, perToughnessPoint: 0.8, toughnessTypical: 80, fromHistory: -20 },
};

export function injuryTraits(
  history: { missedWeeks: number; seasons: number } | undefined,
  madden?: { injury?: number; toughness?: number },
): { injuryProneness: number; durability: number } {
  const T = INJURY_TRAITS;
  const perSeason = history ? history.missedWeeks / Math.max(1, history.seasons) : 0;
  const share = Math.min(1, perSeason / T.proneAtWeeks);
  const clamp = (v: number) => Math.round(Math.min(99, Math.max(1, v)));
  const injury = madden?.injury;
  const toughness = madden?.toughness;
  return {
    injuryProneness: clamp(
      T.proneness.base +
        T.proneness.fromHistory * share +
        (injury !== undefined
          ? (T.proneness.maddenTypical - injury) * T.proneness.perMaddenPoint
          : 0),
    ),
    durability: clamp(
      T.durability.base +
        (toughness !== undefined
          ? (toughness - T.durability.toughnessTypical) * T.durability.perToughnessPoint
          : 0) +
        T.durability.fromHistory * share,
    ),
  };
}

/**
 * Puts real injury traits on the same scale as generated players' (the engine
 * is calibrated on those): same average and spread, real players' order kept.
 */
export function rescaleTraits(
  traits: Map<string, { injuryProneness: number; durability: number }>,
  target: { injuryProneness: [number, number]; durability: [number, number] },
): void {
  for (const key of ["injuryProneness", "durability"] as const) {
    const values = [...traits.values()].map((t) => t[key]);
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const sd =
      Math.sqrt(values.reduce((a, b) => a + (b - mean) * (b - mean), 0) / values.length) || 1;
    const [toMean, toSd] = target[key];
    for (const t of traits.values())
      t[key] = Math.round(Math.min(99, Math.max(1, toMean + ((t[key] - mean) / sd) * toSd)));
  }
}
