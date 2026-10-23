/**
 * Big boards (Phase 11b). Each team ranks the class by its own scouts' read
 * (overall plus some room to grow), plus what it needs (positions where its
 * starters are weak or old) weighed by its philosophy, and its taste for risk
 * (ceiling over a sure thing). A team can also have a board set by hand
 * (`team.scouting.board`), which it follows on draft day.
 *
 * Every entry says why it's where it is (CLAUDE.md rule 8).
 */
import { ageOn, POSITIONS, type Position } from "@fgm/foundation";
import { ROSTER_MIX, STARTERS } from "../generate/config";
import type { League, Prospect } from "../league/schema";
import { perceiveProspect, readOverall, readsKey } from "../perception";
import { onTeam } from "../roster/lists";
import { draftClass } from "../scouting/classes";
import { uniformFrom } from "../scouting/noise";
import { draftValue } from "../scouting/value";
import { DRAFT_DAY } from "./config";
import { gmDraftLeaning } from "../front-office/strategy";

export interface Philosophy {
  /** Board points a full need adds. */
  needPoints: number;
  /** Points per point of room to grow beyond the typical (positive: likes upside). */
  risk: number;
  /** In words, for screens. */
  label: string;
}

/** A team's draft philosophy, from its GM (Phase 13): need vs. talent, and taste for risk. */
export function philosophy(league: League, teamId: string): Philosophy {
  const P = DRAFT_DAY.philosophy;
  const { need: u, risk: r } = gmDraftLeaning(league, teamId);
  const needPoints = P.needPoints[0] + u * (P.needPoints[1] - P.needPoints[0]);
  const risk = r * P.risk;
  const label = `${u > 0.66 ? "Drafts for need" : u < 0.33 ? "Best player available" : "Balances need and talent"}; ${r > 0.33 ? "swings for upside" : r < -0.33 ? "prefers sure things" : "neutral on risk"}`;
  return { needPoints, risk, label };
}

/** How much a team needs each position, 0-1, from its own staff's read of its roster. */
const TEAM_NEEDS = new WeakMap<
  League,
  { key: string; needs: Map<string, Map<Position, number>> }
>();

export function teamNeeds(league: League, teamId: string): Map<Position, number> {
  // Kept while the team's roster and the reads stay the same: the trade market asks often.
  const key = readsKey(league);
  let cache = TEAM_NEEDS.get(league);
  if (!cache || cache.key !== key) {
    cache = { key, needs: new Map() };
    TEAM_NEEDS.set(league, cache);
  }
  let count = 0;
  let ids = 0;
  for (const p of league.players)
    if (p.teamId === teamId && p.retiredAfter === null) {
      count += 1;
      ids += p.id;
    }
  const roster = `${teamId}:${count}:${ids}`;
  const hit = cache.needs.get(roster);
  if (hit) return hit;
  const computed = computeNeeds(league, teamId);
  cache.needs.set(roster, computed);
  return computed;
}

function computeNeeds(league: League, teamId: string): Map<Position, number> {
  const N = DRAFT_DAY.need;
  const viewer = { kind: "team" as const, teamId };
  // A player out for a while (four games or more, or on a reserve list) doesn't fill a need now:
  // his team shops for a replacement (Phase 13b).
  const players = onTeam(league, teamId).filter(
    (p) =>
      p.retiredAfter === null &&
      p.roster !== "injured-reserve" &&
      p.roster !== "pup" &&
      p.roster !== "nfi" &&
      (p.injury?.gamesRemaining ?? 0) < 4,
  );
  const needs = new Map<Position, number>();
  for (const pos of POSITIONS) {
    const at = players
      .filter((p) => p.position === pos)
      .map((p) => ({
        overall: readOverall(league, p, viewer),
        age: ageOn(p.birthDate, league.date),
      }))
      .sort((a, b) => b.overall - a.overall);
    const starters = at.slice(0, STARTERS[pos] ?? 1);
    // Missing starters count as far below the target.
    const level =
      starters.reduce((s, x) => s + x.overall, 0) / Math.max(1, STARTERS[pos] ?? 1) -
      (Math.max(0, (STARTERS[pos] ?? 1) - starters.length) * N.target) /
        Math.max(1, STARTERS[pos] ?? 1);
    let need = Math.max(0, Math.min(1, (N.target - level) / N.scale));
    // Kickers, punters and snappers last longer, so they count as old later.
    const old = pos === "K" || pos === "P" || pos === "LS" ? N.oldAgeSpecialist : N.oldAge;
    if (starters.some((x) => x.age >= old)) need += N.oldAgeNeed;
    // Thin: fewer players than a roster usually carries there (a lone kicker isn't thin).
    if (at.length < ROSTER_MIX[pos]) need += N.thinDepth;
    // Teams rarely spend real draft capital on kickers, punters and snappers.
    const specialist = pos === "K" || pos === "P" || pos === "LS";
    needs.set(pos, Math.min(1, need) * (specialist ? N.specialistWeight : 1));
  }
  return needs;
}

export interface BoardEntry {
  prospect: Prospect;
  /** His value to this team: scouted value plus need and risk. */
  value: number;
  /** Where the team's scouts' read alone (no need) would put him. */
  scouted: number;
  need: number;
  reason: string;
}

// A team's read of the class doesn't change during a draft (it depends on study and the scouts,
// which stay put), so each team's is computed once per league date and reused pick after pick.
type Read = { scouted: number; upside: number };
const READS = new WeakMap<League, { key: string; teams: Map<string, Map<number, Read>> }>();
const NEEDS = new WeakMap<League, Map<string, { key: string; needs: Map<Position, number> }>>();

/** A viewer's read of the class (`teamId` null: the league office's consensus). */
function reads(league: League, teamId: string | null): Map<number, Read> {
  const key = `${league.season}:${league.date}`;
  let cache = READS.get(league);
  if (!cache || cache.key !== key) {
    cache = { key, teams: new Map() };
    READS.set(league, cache);
  }
  let team = cache.teams.get(teamId ?? "office");
  if (!team) {
    team = new Map(
      draftClass(league).map((p) => {
        const seen = perceiveProspect(
          league,
          p,
          teamId === null ? { kind: "league" } : { kind: "team", teamId },
        );
        return [
          p.id,
          {
            scouted: draftValue(seen, p.position),
            // Room to grow beyond the typical prospect's, for the team's taste for risk.
            upside: seen.potential.estimate - seen.overall - DRAFT_DAY.philosophy.typicalGrowth,
          },
        ];
      }),
    );
    cache.teams.set(teamId ?? "office", team);
  }
  return team;
}

/** A team's needs, recomputed only when its roster changes (it drafts or signs someone). */
function cachedNeeds(league: League, teamId: string): Map<Position, number> {
  let cache = NEEDS.get(league);
  if (!cache) {
    cache = new Map();
    NEEDS.set(league, cache);
  }
  const roster = onTeam(league, teamId);
  const key = `${league.date}:${roster.length}:${roster.reduce((s, p) => s + p.id, 0)}`;
  const hit = cache.get(teamId);
  if (hit && hit.key === key) return hit.needs;
  const needs = teamNeeds(league, teamId);
  cache.set(teamId, { key, needs });
  return needs;
}

/**
 * A team's board: the prospects still available (default: this year's class), best first. A
 * board set by hand puts its ranked prospects first, in its order.
 */
export function bigBoard(
  league: League,
  teamId: string,
  available: Prospect[] = draftClass(league),
): BoardEntry[] {
  const team = league.teams.find((t) => t.id === teamId);
  const read = reads(league, teamId);
  const needs = cachedNeeds(league, teamId);
  const style = philosophy(league, teamId);
  const entries = available.map((p): BoardEntry => {
    const r = read.get(p.id) ?? { scouted: 0, upside: 0 };
    const need = needs.get(p.position) ?? 0;
    const risk = style.risk * r.upside;
    const value = r.scouted + need * style.needPoints + risk;
    const why = [
      need >= 0.5 ? `a need at ${p.position}` : null,
      risk > 0.5 ? "upside they like" : risk < -0.5 ? "a little raw for their taste" : null,
    ].filter(Boolean);
    return {
      prospect: p,
      value,
      scouted: r.scouted,
      need,
      reason: why.length ? `Their scouts' grade, plus ${why.join(" and ")}` : "Their scouts' grade",
    };
  });
  entries.sort((a, b) => b.value - a.value || a.prospect.id - b.prospect.id);
  const manual = team?.scouting.board;
  if (!manual?.length) return entries;
  // A board set by hand: its prospects first, in its order; everyone else after, as the scouts rank them.
  const rank = new Map(manual.map((id, i) => [id, i]));
  return [
    ...entries
      .filter((e) => rank.has(e.prospect.id))
      .sort((a, b) => rank.get(a.prospect.id)! - rank.get(b.prospect.id)!)
      .map((e) => ({ ...e, reason: "Ranked by hand on their board" })),
    ...entries.filter((e) => !rank.has(e.prospect.id)),
  ];
}

/** Where the league office's consensus ranks each available prospect (1 = best). */
export function consensusRanks(league: League, available: Prospect[]): Map<number, number> {
  const read = reads(league, null);
  const sorted = [...available].sort(
    (a, b) => (read.get(b.id)?.scouted ?? 0) - (read.get(a.id)?.scouted ?? 0) || a.id - b.id,
  );
  return new Map(sorted.map((p, i) => [p.id, i + 1]));
}
