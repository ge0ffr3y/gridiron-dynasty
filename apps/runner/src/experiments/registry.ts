/** Which code runs each kind of experiment: `run` plays one seed, `summarize` turns every seed's row into the result. */
import type { Spec } from "./spec";
import type { Base } from "./kinds/common";
import * as playoffs from "./kinds/playoffs";
import * as swap from "./kinds/swap";
import * as teamGroups from "./kinds/teamGroups";
import * as titleOdds from "./kinds/titleOdds";

export interface Kind {
  run(spec: Spec, base: Base, seed: number): unknown;
  summarize(spec: Spec, rows: never[]): unknown;
}

export const KINDS: Record<Spec["kind"], Kind> = {
  "team-groups": teamGroups as unknown as Kind,
  "title-odds": titleOdds as unknown as Kind,
  "playoff-randomness": playoffs as unknown as Kind,
  "swap-study": swap as unknown as Kind,
};
