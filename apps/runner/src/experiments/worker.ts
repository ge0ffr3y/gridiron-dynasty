/**
 * One worker process: gets the spec, loads the start once, then plays the seeds it is sent, one at a
 * time. (A separate process rather than a thread: each run's module state stays its own, and `tsx`
 * loads the TypeScript the same way it does for the main script.)
 */
import { prepareBase, type Base } from "./kinds/common";
import { KINDS } from "./registry";
import type { Spec } from "./spec";

type Message = { spec: Spec } | { seed: number } | "stop";

let spec: Spec | undefined;
let base: Base | undefined;

process.on("message", (message: Message) => {
  if (message === "stop") process.exit(0);
  if ("spec" in message) {
    spec = message.spec;
    base = prepareBase(spec);
    process.send!({ ready: true });
    return;
  }
  const started = performance.now();
  try {
    const row = KINDS[spec!.kind].run(spec!, base!, message.seed);
    process.send!({ seed: message.seed, row, seconds: (performance.now() - started) / 1000 });
  } catch (e) {
    process.send!({ seed: message.seed, error: (e as Error).stack ?? String(e) });
  }
});
