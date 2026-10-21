/**
 * The league file format: JSON with object keys in sorted order, so the same
 * league always produces exactly the same text (and the same fingerprint).
 */
import { LEAGUE_FORMAT, LEAGUE_FORMAT_VERSION, LeagueSchema, type League } from "./league/schema";
import { rulesFor } from "./rules";

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === "object") {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      const v = (value as Record<string, unknown>)[key];
      if (v !== undefined) sorted[key] = sortKeys(v);
    }
    return sorted;
  }
  return value;
}

export function serializeLeague(league: League): string {
  return JSON.stringify(sortKeys(league));
}

/**
 * Brings an older save up to the current format, in place.
 * Version 2 -> 3: players get an empty stats history, games get no box score,
 * and the league's rules gain the game rules (clock, kicks, overtime) from
 * the rules file for its season.
 */
function upgrade(data: Record<string, unknown>): void {
  if (data["formatVersion"] === 2) {
    for (const p of (data["players"] as Record<string, unknown>[]) ?? []) p["stats"] = [];
    for (const g of (data["games"] as Record<string, unknown>[]) ?? []) g["boxScore"] = null;
    const rules = data["rules"] as Record<string, unknown> | undefined;
    if (rules && !rules["game"]) rules["game"] = rulesFor(Number(data["season"])).game;
    data["formatVersion"] = 3;
  }
  // Version 3 -> 4: box scores gain team penalty totals; the rules gain penalty enforcement.
  if (data["formatVersion"] === 3) {
    for (const g of (data["games"] as Record<string, unknown>[]) ?? []) {
      const box = g["boxScore"] as Record<string, Record<string, unknown>> | null;
      if (!box) continue;
      for (const side of ["home", "away"]) {
        if (box[side]) Object.assign(box[side]!, { penalties: 0, penaltyYards: 0 });
      }
    }
    const rules = data["rules"] as { game?: Record<string, unknown> } | undefined;
    if (rules?.game && !rules.game["penalties"])
      rules.game["penalties"] = rulesFor(Number(data["season"])).game.penalties;
    data["formatVersion"] = 4;
  }
}

/** Reads a league file (upgrading older saves), checking its format and every field. */
export function parseLeague(text: string): League {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("This isn't a league file (it isn't valid JSON).");
  }
  const header = data as { format?: unknown; formatVersion?: unknown } | null;
  if (header?.format !== LEAGUE_FORMAT) throw new Error("This isn't a FootballGM Sim league file.");
  upgrade(data as Record<string, unknown>);
  if (header.formatVersion !== LEAGUE_FORMAT_VERSION) {
    const older =
      typeof header.formatVersion === "number" && header.formatVersion < LEAGUE_FORMAT_VERSION;
    throw new Error(
      older
        ? `This league was saved by an older version of the game (save format ${String(header.formatVersion)}) and can't be opened. Create a new league instead.`
        : `This league was saved by a newer version of the game (save format ${String(header.formatVersion)}). Update the game to open it.`,
    );
  }
  const result = LeagueSchema.safeParse(data);
  if (!result.success) {
    const first = result.error.issues.slice(0, 5).map((i) => `${i.path.join(".")}: ${i.message}`);
    throw new Error(`The league file is damaged:\n${first.join("\n")}`);
  }
  return result.data;
}

/** Short fingerprint of a league file's text (FNV-1a, 32-bit), shown on screen to compare leagues. */
export function fingerprint(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}
