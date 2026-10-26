/**
 * The list behind the CI name sweep (Phase 18): hashes of the real club nicknames and of the names
 * of real players and coaches (everyone in the nflverse players file and the 2025 coaching staffs,
 * and everyone linked on the archived history pages). `tests/sweep.test.ts` checks that no tracked
 * file contains one. Only hashes are written, never the names, so the list is safe to commit and the
 * test needs no private files.
 *
 *   npm run pipeline -- sweep-list
 */
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CACHE, readCsv, type Row } from "./matchups";
import { HISTORY } from "./history/fetch";
import { PRIVATE } from "./league/inputs";
import { text as plainText } from "./history/html";

/** A name as the sweep compares it: lower case, no accents, punctuation or generational suffix. */
export function normalizeName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[.'’]/g, "")
    .replace(/-/g, " ")
    .replace(/[^a-z ]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/ (jr|sr|ii|iii|iv|v)$/, "");
}

/** The short hash the list stores. */
export const hashName = (normalized: string) =>
  createHash("sha256").update(normalized).digest("hex").slice(0, 12);

export const FIXTURE = join(import.meta.dirname, "..", "..", "tests", "fixtures", "banned.json");

export async function sweepList(): Promise<void> {
  const names = new Set<string>();
  const add = (raw: string | undefined) => {
    const n = normalizeName(raw ?? "");
    const words = n.split(" ");
    // A first and last name, each at least two letters: single words aren't names.
    if (words.length >= 2 && words.length <= 4 && words.every((w) => w.length >= 2)) names.add(n);
  };
  await readCsv(join(CACHE, "players.csv.gz"), (r: Row) => add(r.display_name));
  const coaches = join(PRIVATE, "coaches-2025.csv");
  if (existsSync(coaches))
    for (const line of readFileSync(coaches, "utf8").split("\n").slice(1)) add(line.split(",")[2]);
  const pages = join(HISTORY, "pages");
  if (existsSync(pages))
    for (const f of readdirSync(pages).filter((x) => x.endsWith(".html"))) {
      const html = readFileSync(join(pages, f), "utf8");
      for (const m of html.matchAll(
        /<a [^>]*href="\/(?:players|coaches)\/[^"]+"[^>]*>([^<]+)<\/a>/g,
      ))
        add(plainText(m[1]!).replace(/[*+^]/g, ""));
    }
  const teamNames = JSON.parse(readFileSync(join(HISTORY, "team-names.json"), "utf8")) as {
    nicknames: string[];
  };
  const nicknames = new Set(teamNames.nicknames.map(normalizeName));
  const body = {
    note: "Hashes (first 12 hex digits of SHA-256 of the normalized text) of the real club nicknames and of real player and coach names, built by `npm run pipeline -- sweep-list`. tests/sweep.test.ts checks that no tracked file contains one. The names themselves are not stored.",
    nicknames: [...nicknames].map(hashName).sort(),
    names: [...names].map(hashName).sort(),
  };
  writeFileSync(FIXTURE, JSON.stringify(body) + "\n");
  console.log(
    `Wrote ${FIXTURE}: ${body.nicknames.length} nicknames and ${body.names.length} names (hashes only).`,
  );
}
