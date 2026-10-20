/**
 * The league file format: JSON with object keys in sorted order, so the same
 * league always produces exactly the same text (and the same fingerprint).
 */
import { LEAGUE_FORMAT, LEAGUE_FORMAT_VERSION, LeagueSchema, type League } from "./league/schema";

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

/** Reads a league file, checking its format and every field. */
export function parseLeague(text: string): League {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("This isn't a league file (it isn't valid JSON).");
  }
  const header = data as { format?: unknown; formatVersion?: unknown } | null;
  if (header?.format !== LEAGUE_FORMAT) throw new Error("This isn't a FootballGM Sim league file.");
  if (header.formatVersion !== LEAGUE_FORMAT_VERSION) {
    throw new Error(
      `This league file is format version ${String(header.formatVersion)}; this version reads ${LEAGUE_FORMAT_VERSION}.`,
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
