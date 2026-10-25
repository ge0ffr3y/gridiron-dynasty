/**
 * Runs an experiment across CPU cores (Phase 17): one run per seed, handed to worker threads, each
 * run's row written to a checkpoint file the moment it finishes, so an interrupted batch picks up
 * where it stopped. A run depends only on its own seed, so the result is the same whatever the
 * number of workers or the order they finish in.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { fork, type ChildProcess } from "node:child_process";
import { ROOT, prepareBase } from "./kinds/common";
import { KINDS } from "./registry";
import { loadSpec, type Spec } from "./spec";

export interface RunOptions {
  /** Worker processes; 0 plays every run in this process (for tests). */
  workers: number;
  /** Plays only this many seeds (the first ones), for a pilot. */
  runs?: number;
  log?: (line: string) => void;
}

export function outputFolder(spec: Spec): string {
  return spec.visibility === "public"
    ? join(ROOT, "experiments", "results")
    : join(ROOT, "pipeline", "private", "experiments");
}

const seedsOf = (spec: Spec, limit?: number) =>
  Array.from(
    { length: Math.min(limit ?? Infinity, spec.runs.count) },
    (_, i) => spec.runs.firstSeed + i,
  );

/** Rows already on disk, by seed. */
function readCheckpoint(file: string): Map<number, unknown> {
  const rows = new Map<number, unknown>();
  if (!existsSync(file)) return rows;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    if (!line.trim()) continue;
    const entry = JSON.parse(line) as { seed: number; row: unknown };
    rows.set(entry.seed, entry.row);
  }
  return rows;
}

export async function runExperiment(
  specPath: string,
  options: RunOptions,
): Promise<{ resultFile: string; rows: number }> {
  const log = options.log ?? ((line: string) => console.log(line));
  const spec = loadSpec(specPath);
  const kind = KINDS[spec.kind];
  const folder = outputFolder(spec);
  mkdirSync(folder, { recursive: true });
  const checkpoint = join(folder, `${spec.id}.runs.jsonl`);
  const done = readCheckpoint(checkpoint);
  const seeds = seedsOf(spec, options.runs);
  const todo = seeds.filter((s) => !done.has(s));
  log(
    `${spec.id}: ${seeds.length} runs of ${spec.seasons} season${spec.seasons === 1 ? "" : "s"}; ${done.size} already done, ${todo.length} to go on ${options.workers || 1} worker${options.workers > 1 ? "s" : ""}.`,
  );
  const started = performance.now();
  let finished = 0;
  const record = (seed: number, row: unknown, seconds: number) => {
    // Rows go through JSON exactly as a resumed run reads them back, so a summary never depends on
    // whether a row came from memory or from the checkpoint file.
    const line = JSON.stringify({ seed, seconds: Math.round(seconds * 10) / 10, row });
    done.set(seed, (JSON.parse(line) as { row: unknown }).row);
    appendFileSync(checkpoint, line + "\n");
    finished += 1;
    const elapsed = (performance.now() - started) / 1000;
    const eta = (elapsed / finished) * (todo.length - finished);
    log(
      `  run ${seed} done in ${seconds.toFixed(0)} s (${finished}/${todo.length}; ${Math.round(elapsed / 60)} min so far, about ${Math.round(eta / 60)} min to go)`,
    );
  };

  if (options.workers <= 0) {
    const base = prepareBase(spec);
    for (const seed of todo) {
      const t = performance.now();
      record(seed, kind.run(spec, base, seed), (performance.now() - t) / 1000);
    }
  } else if (todo.length > 0) {
    await new Promise<void>((resolve, reject) => {
      const queue = [...todo];
      const count = Math.min(options.workers, queue.length);
      let alive = count;
      const workers: ChildProcess[] = [];
      const stopAll = () => {
        for (const x of workers) x.kill();
      };
      const next = (w: ChildProcess) => {
        const seed = queue.shift();
        if (seed === undefined) {
          w.send("stop");
          return;
        }
        w.send({ seed });
      };
      for (let i = 0; i < count; i++) {
        const w = fork(fileURLToPath(new URL("./worker.ts", import.meta.url)), [], {
          execArgv: ["--import", "tsx"],
        });
        workers.push(w);
        w.send({ spec });
        w.on(
          "message",
          (m: {
            ready?: boolean;
            seed?: number;
            row?: unknown;
            seconds?: number;
            error?: string;
          }) => {
            if (m.error) {
              stopAll();
              reject(new Error(`run ${m.seed} failed:\n${m.error}`));
              return;
            }
            if (m.seed !== undefined) record(m.seed, m.row, m.seconds ?? 0);
            next(w);
          },
        );
        w.on("error", (e) => {
          stopAll();
          reject(e);
        });
        w.on("exit", (code) => {
          alive -= 1;
          if (code !== 0 && code !== null && queue.length > 0) {
            stopAll();
            reject(new Error(`a worker stopped early (exit code ${code})`));
            return;
          }
          if (alive === 0) resolve();
        });
      }
    });
  }

  // Summaries are built from the rows in seed order, so they never depend on how the work was split.
  const rows = seeds.map((s) => done.get(s)!);
  const summary = kind.summarize(spec, rows as never[]);
  const resultFile = join(folder, `${spec.id}.json`);
  writeFileSync(resultFile, JSON.stringify({ ...(summary as object), spec }, null, 2) + "\n");
  log(`${spec.id}: wrote ${resultFile}`);
  return { resultFile, rows: rows.length };
}
