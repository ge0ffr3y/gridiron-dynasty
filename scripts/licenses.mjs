/**
 * Lists the licenses of the software that ships in the web app (Phase 18): every runtime dependency
 * of the web app and the three simulation packages, and theirs in turn, read from node_modules.
 * Writes apps/web/src/lib/licenses.json, which the About page shows.
 *   npm run licenses
 */
import { readFileSync, writeFileSync } from "node:fs";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const roots = ["apps/web", "packages/sim-core", "packages/game-engine", "packages/foundation"];
const ours = new Set([
  "@fgm/foundation",
  "@fgm/game-engine",
  "@fgm/sim-core",
  "@fgm/web",
  "@fgm/runner",
]);

const seen = new Map();
function visit(name, from) {
  if (ours.has(name)) return;
  // Walk up from the dependent's folder to the nearest node_modules that has it (package.json is
  // not always exposed through a package's "exports", so resolve by path).
  let file = null;
  for (let dir = from; ; dir = dirname(dir)) {
    const candidate = join(dir, "node_modules", name, "package.json");
    if (existsSync(candidate)) {
      file = candidate;
      break;
    }
    if (dirname(dir) === dir) break;
  }
  if (!file) return; // an optional dependency that isn't installed here
  const pkg = JSON.parse(readFileSync(file, "utf8"));
  const key = `${pkg.name}@${pkg.version}`;
  if (seen.has(key)) return;
  const license =
    typeof pkg.license === "string"
      ? pkg.license
      : (pkg.license?.type ?? pkg.licenses?.map((l) => l.type).join(" OR ") ?? "unknown");
  seen.set(key, { name: pkg.name, version: pkg.version, license, homepage: pkg.homepage ?? null });
  for (const dep of Object.keys(pkg.dependencies ?? {})) visit(dep, dirname(file));
}

for (const r of roots) {
  const pkg = JSON.parse(readFileSync(join(root, r, "package.json"), "utf8"));
  for (const dep of Object.keys(pkg.dependencies ?? {})) visit(dep, join(root, r));
}
const list = [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
writeFileSync(join(root, "apps/web/src/lib/licenses.json"), JSON.stringify(list, null, 2) + "\n");
const byLicense = {};
for (const l of list) byLicense[l.license] = (byLicense[l.license] ?? 0) + 1;
console.log(`${list.length} packages:`, byLicense);
