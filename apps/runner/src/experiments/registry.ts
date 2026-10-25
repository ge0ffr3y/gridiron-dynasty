/** Which code runs each kind of experiment: `run` plays one seed, `summarize` turns every seed's row into the result. */
import type { Spec } from "./spec";
import type { Base } from "./kinds/common";
import * as teamGroups from "./kinds/teamGroups";

export interface Kind {
  run(spec: Spec, base: Base, seed: number): unknown;
  summarize(spec: Spec, rows: never[]): unknown;
}

const notYet = (name: string): Kind => ({
  run() {
    throw new Error(`the "${name}" experiment kind isn't written yet`);
  },
  summarize() {
    throw new Error(`the "${name}" experiment kind isn't written yet`);
  },
});

export const KINDS: Record<Spec["kind"], Kind> = {
  "team-groups": teamGroups as unknown as Kind,
  "title-odds": notYet("title-odds"),
  "playoff-randomness": notYet("playoff-randomness"),
  "swap-study": notYet("swap-study"),
};
