/// <reference lib="webworker" />
/**
 * The simulation runs here, off the page's main thread, so the UI never
 * freezes while a season simulates. For now it only answers "hello".
 */
import { GAME_ENGINE_VERSION } from "@fgm/game-engine";
import { RngStreams, SIM_CORE_VERSION } from "@fgm/sim-core";
import type { FromWorker, ToWorker } from "./protocol";

declare const self: DedicatedWorkerGlobalScope;

function reply(message: FromWorker): void {
  self.postMessage(message);
}

self.onmessage = (event: MessageEvent<ToWorker>) => {
  const message = event.data;
  try {
    switch (message.type) {
      case "hello": {
        const league = new RngStreams(message.seed).get("league");
        reply({
          type: "ready",
          simCoreVersion: SIM_CORE_VERSION,
          gameEngineVersion: GAME_ENGINE_VERSION,
          seed: message.seed,
          sample: [league.nextUint32(), league.nextUint32(), league.nextUint32()],
        });
        break;
      }
    }
  } catch (error) {
    reply({ type: "error", message: error instanceof Error ? error.message : String(error) });
  }
};
