import { RngStreams } from "@fgm/sim-core";
import { useEffect, useState } from "react";
import type { FromWorker, ToWorker } from "./protocol";

export type WorkerStatus =
  | { state: "starting" }
  | { state: "ready"; simCoreVersion: string; gameEngineVersion: string; deterministic: boolean }
  | { state: "error"; message: string };

const HELLO_SEED = 42;

/** Starts the simulation worker and reports whether it answered. */
export function useSimWorker(): WorkerStatus {
  const [status, setStatus] = useState<WorkerStatus>({ state: "starting" });

  useEffect(() => {
    const worker = new Worker(new URL("./sim.worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (event: MessageEvent<FromWorker>) => {
      const reply = event.data;
      if (reply.type === "error") {
        setStatus({ state: "error", message: reply.message });
        return;
      }
      // The page draws the same numbers itself: worker and page must agree exactly.
      const league = new RngStreams(reply.seed).get("league");
      const local = reply.sample.map(() => league.nextUint32());
      setStatus({
        state: "ready",
        simCoreVersion: reply.simCoreVersion,
        gameEngineVersion: reply.gameEngineVersion,
        deterministic: local.every((n, i) => n === reply.sample[i]),
      });
    };
    worker.onerror = (event) =>
      setStatus({ state: "error", message: event.message || "worker failed to start" });
    worker.postMessage({ type: "hello", seed: HELLO_SEED } satisfies ToWorker);
    return () => worker.terminate();
  }, []);

  return status;
}
