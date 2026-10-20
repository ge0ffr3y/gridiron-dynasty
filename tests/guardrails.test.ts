/**
 * Guardrails for the simulation packages (see CLAUDE.md, hard rules 1 and 2).
 *
 * sim-core and game-engine must run identically in every browser, in a Web
 * Worker, and in Node, so their source may not touch browser or Node APIs, the
 * real clock, unseeded randomness, or built-in math that can round differently
 * between browsers.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "..");
const SIM_PACKAGES = ["packages/sim-core/src", "packages/game-engine/src"];

// inStrings: the pattern is checked with string contents kept (import paths live in strings).
const FORBIDDEN: { pattern: RegExp; why: string; inStrings?: boolean }[] = [
  { pattern: /\bMath\.random\b/, why: "use the seeded Rng streams" },
  {
    pattern: /\bDate\.now\b|\bnew Date\b|\bperformance\.now\b/,
    why: "league time is the in-game calendar",
  },
  {
    pattern:
      /\bMath\.(exp|expm1|log|log1p|log2|log10|pow|sin|cos|tan|asin|acos|atan|atan2|sinh|cosh|tanh|cbrt|hypot)\b/,
    why: "use the deterministic helpers in sim-core's math.ts (dmath)",
  },
  { pattern: /\*\*/, why: "the ** operator can round differently between browsers; use dmath.pow" },
  {
    pattern: /\b(window|document|localStorage|indexedDB|navigator)\b/,
    why: "no browser APIs in simulation code",
  },
  {
    pattern: /from\s+["']node:|require\(/,
    why: "no Node APIs in simulation code",
    inStrings: true,
  },
];

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...sourceFiles(path));
    else if (path.endsWith(".ts") && !path.endsWith(".test.ts")) out.push(path);
  }
  return out;
}

/** Drops comments, so a rule mentioned in prose doesn't trip the check. */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

/** Also empties string contents (e.g. a log message that says "Math.random"). */
function withoutStrings(code: string): string {
  return code.replace(/(["'`])(?:\\.|(?!\1)[^\\])*\1/g, '""');
}

describe("simulation-package guardrails", () => {
  for (const pkg of SIM_PACKAGES) {
    for (const file of sourceFiles(join(ROOT, pkg))) {
      const name = relative(ROOT, file);
      it(`${name} uses only allowed APIs`, () => {
        const withStrings = withoutComments(readFileSync(file, "utf8"));
        const code = withoutStrings(withStrings);
        const problems = FORBIDDEN.filter(({ pattern, inStrings }) =>
          pattern.test(inStrings ? withStrings : code),
        ).map(({ pattern, why }) => `${pattern} (${why})`);
        expect(problems).toEqual([]);
      });
    }
  }
});
