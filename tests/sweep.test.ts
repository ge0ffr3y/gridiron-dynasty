/**
 * The trademark and name sweep (Phase 18). It runs everywhere, including CI, because it needs no
 * private files: the real club nicknames and the names of real players and coaches are checked as
 * hashes (`tests/fixtures/banned.json`, built by `npm run pipeline -- sweep-list`), so this file
 * never has to contain them.
 *
 * What it checks, over every tracked text file (markdown included):
 *   - no real club nickname and no real person's name;
 *   - the league's trademarked championship name nowhere;
 * and in the code the app and the simulation ship (comments aside):
 *   - none of the league's trademarked names for its all-star game or its own initials, and no
 *     mention of the private ratings file.
 */
import { execSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { hashName, normalizeName } from "../pipeline/src/sweep";

const ROOT = join(import.meta.dirname, "..");
const TEXT = /\.(ts|tsx|js|mjs|json|md|css|html|yml|yaml|txt|svg)$|(^|\/)(LICENSE|NOTICE)(\.md)?$/;
// Not scanned: the lock file, the hash list itself and this test (which has to spell the phrases).
const SKIP = new Set(["package-lock.json", "tests/fixtures/banned.json", "tests/sweep.test.ts"]);

const banned = JSON.parse(readFileSync(join(ROOT, "tests", "fixtures", "banned.json"), "utf8")) as {
  nicknames: string[];
  names: string[];
};
const nicknames = new Set(banned.nicknames);
const names = new Set(banned.names);

const files = execSync("git ls-files", { cwd: ROOT, maxBuffer: 64 * 1024 * 1024 })
  .toString()
  .split("\n")
  .filter((f) => f && TEXT.test(f) && !SKIP.has(f) && statSync(join(ROOT, f)).size < 3_000_000);

const read = (f: string) => readFileSync(join(ROOT, f), "utf8");

/** Code with its comments removed, for the checks that only apply to what ships. */
const stripComments = (code: string) =>
  code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

describe("the sweep", () => {
  it("finds the hash list and the files to scan", () => {
    expect(nicknames.size).toBeGreaterThan(20);
    expect(names.size).toBeGreaterThan(10_000);
    expect(files.length).toBeGreaterThan(200);
  });

  it("no tracked file names a real club or a real person", () => {
    const problems: string[] = [];
    for (const f of files) {
      read(f)
        .split("\n")
        .forEach((line, i) => {
          const raw = line.match(/[\p{L}][\p{L}'’.-]*/gu);
          if (!raw) return;
          // "Thomas's" is Thomas.
          const words = raw.map((x) => x.replace(/['’]s$/i, ""));
          for (let w = 0; w < words.length; w++) {
            const one = normalizeName(words[w]!);
            if (one && nicknames.has(hashName(one)))
              problems.push(`${f}:${i + 1}: a real club nickname ("${words[w]}")`);
            // Names are capitalized; skip windows that can't be one.
            if (!/^\p{Lu}/u.test(words[w]!)) continue;
            for (let n = 2; n <= 4 && w + n <= words.length; n++) {
              const span = words.slice(w, w + n);
              if (!span.every((x) => /^\p{Lu}/u.test(x) || /^(de|van|von|la|le|di|st)$/i.test(x)))
                break;
              const joined = normalizeName(span.join(" "));
              if (nicknames.has(hashName(joined)))
                problems.push(`${f}:${i + 1}: a real club nickname ("${span.join(" ")}")`);
              if (names.has(hashName(joined)))
                problems.push(`${f}:${i + 1}: a real person's name ("${span.join(" ")}")`);
            }
          }
        });
    }
    expect(problems).toEqual([]);
  });

  it("no tracked file uses the league's trademarked championship name", () => {
    const problems = files.flatMap((f) =>
      read(f)
        .split("\n")
        .flatMap((line, i) => (/super\s*bowl/i.test(line) ? [`${f}:${i + 1}`] : [])),
    );
    expect(problems).toEqual([]);
  });

  it("the shipped code has no 'Pro Bowl', no 'NFL' and no ratings-file name", () => {
    const shipped = files.filter(
      (f) =>
        /^(apps\/web\/src|packages\/[^/]+\/src)\/.*\.(ts|tsx)$/.test(f) && !/\.test\.tsx?$/.test(f),
    );
    expect(shipped.length).toBeGreaterThan(100);
    const problems: string[] = [];
    for (const f of shipped)
      stripComments(read(f))
        .split("\n")
        .forEach((line, i) => {
          if (/pro\s+bowl/i.test(line)) problems.push(`${f}:${i + 1}: Pro Bowl`);
          if (/\bNFL\b/.test(line)) problems.push(`${f}:${i + 1}: NFL`);
          if (/madden/i.test(line)) problems.push(`${f}:${i + 1}: the ratings file`);
        });
    expect(problems).toEqual([]);
  });

  it("the web app's own text never says 'Pro Bowl' or 'NFL', comments included", () => {
    const problems: string[] = [];
    for (const f of files.filter((x) => x.startsWith("apps/web/src/")))
      read(f)
        .split("\n")
        .forEach((line, i) => {
          if (/pro\s+bowl|\bNFL\b/i.test(line)) problems.push(`${f}:${i + 1}`);
        });
    expect(problems).toEqual([]);
  });
});
