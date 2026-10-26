/**
 * Levers (Phase 17): how an experiment sets up its conditions. A lever writes the same values every
 * time it runs, so it can be re-applied after each simulation step: when an owner fires a general
 * manager or a head coach and the club hires someone new, the newcomer is given the profile again
 * before he decides anything. The simulation itself isn't changed for experiments.
 */
import {
  GM_KNOBS,
  NEUTRAL_GM,
  NEUTRAL_OWNER,
  OVERALL_WEIGHTS,
  coachIn,
  gmOf,
  ownerOf,
  type AttributeKey,
  type League,
  type Player,
} from "@fgm/sim-core";
import type { Group, Lever } from "./spec";

const finite = (v: number | undefined, fallback: number) => (Number.isFinite(v) ? v! : fallback);

/** Applies one lever to one team. */
export function applyLever(league: League, teamId: string, lever: Lever): void {
  switch (lever.type) {
    case "gm": {
      const gm = gmOf(league, teamId);
      if (!gm) return;
      const style = { ...NEUTRAL_GM };
      for (const k of GM_KNOBS) style[k] = finite(lever.knobs[k], 0);
      style.skill = lever.skill;
      gm.gm = style;
      return;
    }
    case "owner": {
      const owner = ownerOf(league, teamId);
      if (!owner) return;
      owner.owner = {
        patience: finite(lever.style.patience, NEUTRAL_OWNER.patience),
        budget: finite(lever.style.budget, NEUTRAL_OWNER.budget),
        meddling: finite(lever.style.meddling, NEUTRAL_OWNER.meddling),
        ambition: finite(lever.style.ambition, NEUTRAL_OWNER.ambition),
      };
      return;
    }
    case "coach": {
      for (const role of lever.roles) {
        const coach = coachIn(league, teamId, role);
        if (!coach) continue;
        for (const [k, v] of Object.entries(lever.ratings))
          if (k in coach.ratings) coach.ratings[k as keyof typeof coach.ratings] = v;
        for (const [k, v] of Object.entries(lever.style))
          if (k in coach.style) coach.style[k as keyof typeof coach.style] = v;
      }
      return;
    }
    case "quarterback": {
      const qb = startingQuarterback(league, teamId);
      if (!qb) return;
      for (const k of Object.keys(OVERALL_WEIGHTS.QB) as AttributeKey[])
        qb.ratings[k] = lever.level;
      return;
    }
  }
}

/** The team's best quarterback by true overall (the depth chart starts him). */
export function startingQuarterback(league: League, teamId: string): Player | undefined {
  let best: Player | undefined;
  let bestScore = -Infinity;
  for (const p of league.players) {
    if (p.teamId !== teamId || p.position !== "QB") continue;
    let score = 0;
    let weight = 0;
    for (const [k, w] of Object.entries(OVERALL_WEIGHTS.QB) as [AttributeKey, number][]) {
      score += p.ratings[k] * w;
      weight += w;
    }
    score /= weight;
    if (score > bestScore) {
      best = p;
      bestScore = score;
    }
  }
  return best;
}

/**
 * Which group each team belongs to in one run: teams are put in a fixed order by a hash of the run's
 * seed and dealt out in turn, so groups are the same size and the split differs run to run.
 */
export function assignTeams(
  teamIds: string[],
  groups: Group[],
  seed: number,
  hash: (label: string) => number,
): Map<string, Group> {
  const order = [...teamIds].sort(
    (a, b) => hash(`${seed}:split:${a}`) - hash(`${seed}:split:${b}`) || a.localeCompare(b),
  );
  return new Map(order.map((id, i) => [id, groups[i % groups.length]!]));
}

/** Applies the baseline levers, then each team's group levers. */
export function applyAll(league: League, baseline: Lever[], assignment: Map<string, Group>): void {
  for (const t of league.teams) {
    for (const lever of baseline) applyLever(league, t.id, lever);
    for (const lever of assignment.get(t.id)?.levers ?? []) applyLever(league, t.id, lever);
  }
}
