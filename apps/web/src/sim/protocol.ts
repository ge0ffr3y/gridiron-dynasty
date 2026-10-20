/** Messages between the page and the simulation worker. */

export type ToWorker = { type: "hello"; seed: number };

export type FromWorker =
  | {
      type: "ready";
      simCoreVersion: string;
      gameEngineVersion: string;
      seed: number;
      /** First few numbers from the seed's "league" stream, to prove both sides agree. */
      sample: number[];
    }
  | { type: "error"; message: string };
