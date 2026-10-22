/**
 * Agents (Phase 12). Every player has an agent, and the agent's style shapes
 * talks: a hardball agent asks more and walks away sooner, a fair one meets
 * in the middle, a relationship-driven one values a good fit and a club that
 * treats his clients well, a money-only one cares about little but the dollars.
 *
 * Agents and agencies are fictional, generated from the league seed. A
 * player's agent follows from a hash of his id, so nothing extra is stored on
 * players and the real league never uses real agents.
 */
import { Rng, streamSeed } from "@fgm/foundation";
import { NamePicker } from "../generate/people";
import type { Agent, League, Player } from "../league/schema";
import { uniformFrom } from "../scouting/noise";

export const AGENTS = {
  /** How many agents represent the league's players. */
  count: 64,
  /** How common each style is (judgment; real agents vary widely). */
  styles: { hardball: 0.25, fair: 0.4, relationship: 0.2, money: 0.15 },
  /** Agency names: [first word, second word], combined by the seed (fictional). */
  agencyWords: [
    [
      "Bluewater",
      "Ironbridge",
      "Northfield",
      "Redstone",
      "Silverline",
      "Tallgrass",
      "Westgate",
      "Harborview",
      "Copperleaf",
      "Granite Peak",
    ],
    [
      "Sports Group",
      "Athlete Partners",
      "Management",
      "Sports Counsel",
      "Player Group",
      "Representation",
    ],
  ] as [string[], string[]],
};

/** The league's agents, the same for every league with this seed. */
export function generateAgents(seed: number): Agent[] {
  const rng = new Rng(streamSeed(seed, "agents"));
  const names = new NamePicker(new Rng(streamSeed(seed, "agent-names")));
  const styles = Object.entries(AGENTS.styles) as [Agent["style"], number][];
  return Array.from({ length: AGENTS.count }, (_, id) => {
    let u = rng.next();
    let style: Agent["style"] = styles[styles.length - 1]![0];
    for (const [s, share] of styles) {
      if (u < share) {
        style = s;
        break;
      }
      u -= share;
    }
    const [first, second] = AGENTS.agencyWords;
    return {
      id,
      ...names.next(),
      agency: `${rng.pick(first)} ${rng.pick(second)}`,
      style,
    };
  });
}

/** A player's agent. */
export function agentOf(league: League, p: Pick<Player, "id">): Agent {
  const agents = league.agents;
  const i = Math.floor(uniformFrom(`${league.meta.seed}:agent:${p.id}`) * agents.length);
  return agents[Math.min(agents.length - 1, i)]!;
}
