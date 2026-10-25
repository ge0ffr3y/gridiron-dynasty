/** `npm run sim -- --experiment experiments/<file>.json [--workers N] [--runs N]` and `--experiments` (list). */
import { readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { ROOT } from "./kinds/common";
import { runExperiment } from "./pool";
import { publishExperiments } from "./publish";
import { loadSpec } from "./spec";

export function listExperiments(): void {
  const folder = join(ROOT, "experiments");
  for (const f of readdirSync(folder)
    .filter((x) => x.endsWith(".json"))
    .sort()) {
    const spec = loadSpec(join(folder, f));
    console.log(
      `  experiments/${f}: ${spec.title} (${spec.kind}, ${spec.runs.count} runs of ${spec.seasons} season${spec.seasons === 1 ? "" : "s"}, ${spec.visibility})`,
    );
  }
}

export async function experimentCli(
  file: string,
  workers: number,
  runs?: number,
  cwd = process.cwd(),
): Promise<void> {
  await runExperiment(resolve(cwd, file), { workers, ...(runs !== undefined ? { runs } : {}) });
}

export function publishCli(): void {
  const n = publishExperiments();
  console.log(`Published ${n.public} public and ${n.private} private results to the web app.`);
}
