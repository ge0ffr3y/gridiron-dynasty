/**
 * The real teams behind this league's franchises, read from a private file (real team names never
 * live in committed code): which franchise a real club name belongs to, the city it was in, and
 * the club's page name for its records.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PRIVATE } from "../league/inputs";

const FILE = join(PRIVATE, "history", "team-names.json");

interface TeamNames {
  franchises: { id: string; names: string[]; wiki: string }[];
  nicknames: string[];
}

let cached: TeamNames | null = null;
function load(): TeamNames {
  if (cached) return cached;
  if (!existsSync(FILE))
    throw new Error(
      "pipeline/private/history/team-names.json is missing: it maps the real clubs' names to this league's franchise ids (see docs/rebuild-guide.md).",
    );
  cached = JSON.parse(readFileSync(FILE, "utf8")) as TeamNames;
  return cached;
}

/** The franchise and the city a real club name (as the sources write it) belongs to. */
export function franchiseOf(realName: string): { teamId: string; city: string } {
  const t = load();
  const hit = t.franchises.find((f) => f.names.some((n) => realName.includes(n)));
  if (!hit) throw new Error(`Unknown club in the sources: ${realName}`);
  const matched = hit.names.find((n) => realName.includes(n))!;
  let city = matched;
  for (const nick of [...t.nicknames].sort((a, b) => b.length - a.length))
    city = city.replace(new RegExp(`\\s*${nick.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`), "");
  return { teamId: hit.id, city: city.trim() };
}

/** Is this text the name of one of the clubs? */
export function isClub(text: string): boolean {
  return load().franchises.some((f) => f.names.some((n) => text.includes(n)));
}

/** Each franchise's page name for its records page, by franchise id. */
export function wikiNames(): Record<string, string> {
  return Object.fromEntries(load().franchises.map((f) => [f.id, f.wiki]));
}
