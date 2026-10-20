/**
 * The page's side of the worker: call(method, params) returns a promise of the
 * worker's answer. One worker for the whole app.
 */
import { useCallback, useEffect, useState } from "react";
import type { FromWorker, Method, Params, Result, ToWorker } from "./protocol";

const worker = new Worker(new URL("./sim.worker.ts", import.meta.url), { type: "module" });
const waiting = new Map<
  number,
  { resolve: (value: unknown) => void; reject: (error: Error) => void }
>();
let nextId = 1;

worker.onmessage = (event: MessageEvent<FromWorker>) => {
  const reply = event.data;
  const pending = waiting.get(reply.id);
  if (!pending) return;
  waiting.delete(reply.id);
  if (reply.ok) pending.resolve(reply.result);
  else pending.reject(new Error(reply.error));
};

export function call<M extends Method>(method: M, params: Params<M>): Promise<Result<M>> {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    waiting.set(id, { resolve: resolve as (value: unknown) => void, reject });
    const transfer =
      params && typeof params === "object" && "bytes" in params
        ? [(params.bytes as Uint8Array).buffer]
        : [];
    worker.postMessage({ id, method, params } satisfies ToWorker, transfer as Transferable[]);
  });
}

export type Query<T> = {
  data: T | undefined;
  error: string | undefined;
  loading: boolean;
  reload: () => void;
};

/** Asks the worker for data and re-asks whenever `key` changes. */
export function useSim<M extends Method>(
  method: M,
  params: Params<M>,
  key: string,
): Query<Result<M>> {
  const [state, setState] = useState<{ data?: Result<M>; error?: string; loading: boolean }>({
    loading: true,
  });
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let current = true;
    setState((s) => ({ ...s, loading: true }));
    call(method, params).then(
      (data) => current && setState({ data, loading: false }),
      (error: Error) => current && setState({ error: error.message, loading: false }),
    );
    return () => {
      current = false;
    };
    // `key` stands in for params, which is a new object every render.
  }, [method, key, version]);
  const reload = useCallback(() => setVersion((v) => v + 1), []);
  return { data: state.data, error: state.error, loading: state.loading, reload };
}
