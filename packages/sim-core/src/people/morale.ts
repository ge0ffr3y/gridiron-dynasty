/**
 * Moods and the locker room (Phase 12b).
 *
 * Every player on a team has a mood, 0-100 (50 = content), from what he cares about:
 *  - winning: how his team is doing, weighed by how much winning matters to him;
 *  - role: playing time against what he thinks he deserves (a big ego thinks more);
 *  - pay: what his deal pays against his market value, weighed by how much money matters;
 *  - fit: how well he fits his coaches' scheme;
 *  - leaders: the veterans in his locker room;
 *  - loyalty: loyal players are content more easily;
 *  - dispute: a holdout, hold-in or trade request sours him.
 * Volatile players (low temperament) swing further. The mood moves part of the way toward
 * where these put it each week, so one game doesn't change much.
 *
 * Effects are deliberately small (at most about one rating point): a happy player develops a
 * little faster and plays a touch above himself; a good locker room lifts everyone a little.
 */
import { overallAt } from "@fgm/foundation";
import { STARTERS } from "../generate/config";
import type { League, Player } from "../league/schema";
import { MOOD_FACTORS } from "../league/schema";
import { DEVELOPMENT } from "../lifecycle/config";
import { playerFit } from "../coaches/fit";
import { contractShare, marketValue } from "../contracts/market";

type MoodFactor = (typeof MOOD_FACTORS)[number];

/** Tuning. Judgment, kept small so the scorecard and the long-run balance hold. */
export const MORALE = {
  /** A typical player sits here; effects are measured from it. */
  neutral: 50,
  /** Winning: a perfect record is worth this many points to a player with typical priorities. */
  winning: 10,
  /** Role: stuck behind players he thinks he's better than (points, typical priorities). */
  roleSnubbed: -10,
  /** Role: starting when he expects to. */
  roleStarting: 3,
  /** He thinks of himself this many overall points higher per ego point above 50 (/50). */
  egoSelfView: 3,
  /** Snap share that counts as starting, in season. */
  startingSnaps: 0.5,
  /** Pay: points per 10% of his market value he's underpaid by (typical money priority). */
  payPer10: -2.5,
  /** ...at most this low. */
  payFloor: -20,
  /** Paid above his market value (by 15%+): a small plus. */
  overpaid: 3,
  /** Rookie deals in the first seasons: players expect to be underpaid (share of the effect). */
  earlyRookieDeal: 0.25,
  /** Market values below this share of the cap don't upset anyone (minimum-salary players). */
  payFromShare: 0.01,
  /** Scheme fit (-1..1) is worth this many points. */
  fit: 6,
  /** Leaders: the veterans' average leadership, -1..1, is worth this many points. */
  leaders: 4,
  /** Loyalty (-1..1) is worth this many points. */
  loyalty: 3,
  /** An open dispute. */
  dispute: -12,
  /** Low temperament amplifies everything by up to this share (and high calms it). */
  temperament: 0.3,
  /** Each week the mood moves this share of the way to where it's headed. */
  weeklyShare: 0.35,
  /** Development: growth and decline are this much better at 100 and worse at 0. */
  development: 0.06,
  /** Game day: rating points at a mood of 100 (and minus at 0)... */
  gameMood: 0.6,
  /** ...and from the locker room's chemistry. */
  gameChemistry: 0.4,
  /** Chemistry: a leader counts this much more (per leadership point above 50, /50). */
  leaderWeight: 1,
  /** Chemistry: an unhappy big ego (ego 75+, mood below 35) costs the room this many points. */
  disruptive: 2,
  egoDisruptive: 75,
  moodDisruptive: 35,
} as const;

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));

/** Readable labels for the factors (screens and reasons). */
export const MOOD_LABELS: Record<MoodFactor, string> = {
  winning: "Winning",
  role: "Playing time",
  pay: "Pay",
  fit: "Scheme fit",
  leaders: "Locker-room leaders",
  loyalty: "Loyalty",
  dispute: "Contract dispute",
};

/** A word for a mood score. */
export function moodLabel(score: number): "Thrilled" | "Happy" | "Content" | "Unhappy" | "Angry" {
  if (score >= 70) return "Thrilled";
  if (score >= 56) return "Happy";
  if (score >= 40) return "Content";
  if (score >= 25) return "Unhappy";
  return "Angry";
}

// ---------------------------------------------------------------------------
// What the league looks like this week (cached while nothing changes)

interface Snapshot {
  key: string;
  /** Each team's win share this season (or last, before its first games), and games played. */
  record: Map<string, { share: number; games: number }>;
  /** Each team's veteran leadership, -1..1. */
  leaders: Map<string, number>;
  /** Each team's true overalls by position, best first (how players see themselves vs. teammates). */
  depth: Map<string, Map<string, number[]>>;
  /** Players in an open dispute. */
  disputing: Set<number>;
}
const SNAPSHOTS = new WeakMap<League, Snapshot>();

function snapshot(league: League): Snapshot {
  const key = `${league.date}:${league.transactions.length}:${league.disputes.length}`;
  const hit = SNAPSHOTS.get(league);
  if (hit && hit.key === key) return hit;
  const record = new Map<string, { share: number; games: number }>();
  const tally = new Map<string, { w: number; g: number }>();
  for (const g of league.games) {
    if (g.round !== "regular" || g.season !== league.season || !g.result) continue;
    const { homeScore: h, awayScore: a } = g.result;
    for (const [id, score] of [
      [g.homeId, h > a ? 1 : h === a ? 0.5 : 0],
      [g.awayId, a > h ? 1 : h === a ? 0.5 : 0],
    ] as const) {
      const t = tally.get(id) ?? { w: 0, g: 0 };
      t.w += score;
      t.g += 1;
      tally.set(id, t);
    }
  }
  const last = league.history.at(-1);
  for (const team of league.teams) {
    const t = tally.get(team.id);
    let share = 0.5;
    if (t && t.g > 0) {
      // Early on, last season still colors how things feel.
      const prior = lastSeasonShare(last, team.id);
      const weight = Math.min(1, t.g / 4);
      share = weight * (t.w / t.g) + (1 - weight) * prior;
    } else share = lastSeasonShare(last, team.id);
    record.set(team.id, { share, games: t?.g ?? 0 });
  }

  const leaders = new Map<string, number>();
  const depth = new Map<string, Map<string, number[]>>();
  const byTeam = new Map<string, Player[]>();
  for (const p of league.players) {
    if (p.teamId === null || p.retiredAfter !== null) continue;
    const list = byTeam.get(p.teamId) ?? [];
    list.push(p);
    byTeam.set(p.teamId, list);
  }
  for (const [teamId, players] of byTeam) {
    // The five most experienced players set the tone (ties by id, for determinism).
    const vets = players
      .filter((p) => p.roster !== "practice-squad")
      .sort((a, b) => b.experience - a.experience || a.id - b.id)
      .slice(0, 5);
    const avg = vets.reduce((s, p) => s + p.personality.leadership, 0) / Math.max(1, vets.length);
    leaders.set(teamId, clamp((avg - 50) / 25, -1, 1));
    const positions = new Map<string, number[]>();
    for (const p of players) {
      const list = positions.get(p.position) ?? [];
      list.push(overallAt(p.ratings, p.position));
      positions.set(p.position, list);
    }
    for (const list of positions.values()) list.sort((a, b) => b - a);
    depth.set(teamId, positions);
  }
  const disputing = new Set(league.disputes.filter((d) => d.end === null).map((d) => d.playerId));
  const snap = { key, record, leaders, depth, disputing };
  SNAPSHOTS.set(league, snap);
  return snap;
}

function lastSeasonShare(last: League["history"][number] | undefined, teamId: string): number {
  const row = last?.standings.find((s) => s.teamId === teamId);
  if (!row) return 0.5;
  const games = row.wins + row.losses + row.ties;
  return games > 0 ? (row.wins + row.ties / 2) / games : 0.5;
}

/** Share of a full-time player's snaps he's played this season so far (null before any games). */
function snapShareSoFar(p: Player, season: number, teamGames: number): number | null {
  if (teamGames === 0) return null;
  let snaps = 0;
  let gp = 0;
  for (const s of p.stats) {
    if (s.season !== season) continue;
    snaps += (s.line.offSnaps ?? 0) + (s.line.defSnaps ?? 0);
    gp += s.line.gp ?? 0;
  }
  if (p.position === "K" || p.position === "P" || p.position === "LS") return gp / teamGames;
  return Math.min(1, snaps / (teamGames * DEVELOPMENT.snapsPerGame));
}

// ---------------------------------------------------------------------------
// One player's mood

/** Where his mood is headed now, and why (points by factor). Null without a team. */
export function moodTarget(
  league: League,
  p: Player,
): { score: number; factors: { key: MoodFactor; points: number }[] } | null {
  if (p.teamId === null || p.retiredAfter !== null) return null;
  const M = MORALE;
  const snap = snapshot(league);
  const pr = p.personality;
  const factors: { key: MoodFactor; points: number }[] = [];
  const add = (key: MoodFactor, points: number) => {
    if (Math.abs(points) >= 0.05) factors.push({ key, points });
  };

  // Winning, weighed by how much it matters to him (priorities average 25).
  const rec = snap.record.get(p.teamId) ?? { share: 0.5, games: 0 };
  add("winning", (rec.share - 0.5) * 2 * M.winning * (pr.priorities.winning / 25));

  // Role: does he play as much as he thinks he should? He compares himself with his teammates
  // at his position, seeing himself a little better if he has a big ego.
  const starters = STARTERS[p.position] ?? 1;
  const own = overallAt(p.ratings, p.position) + (M.egoSelfView * (pr.ego - 50)) / 50;
  const others = snap.depth.get(p.teamId)?.get(p.position) ?? [];
  const mine = overallAt(p.ratings, p.position);
  let ahead = 0;
  let skippedSelf = false;
  for (const o of others) {
    if (!skippedSelf && o === mine) {
      skippedSelf = true;
      continue;
    }
    if (o > own) ahead += 1;
  }
  const expectsToStart = ahead < starters && p.roster === "active";
  if (expectsToStart) {
    const share = snapShareSoFar(p, league.season, rec.games);
    // Before games, the depth chart's order (true overall rank) stands in.
    const realRank = others.filter((o) => o > mine).length;
    const starting = share === null ? realRank < starters : share >= M.startingSnaps;
    const roleWeight = pr.priorities.role / 25;
    add("role", (starting ? M.roleStarting : M.roleSnubbed) * roleWeight);
  }

  // Pay against his market value (only for players the market prices above the minimum).
  const c = p.contract;
  if (c && c.type !== "practice-squad") {
    const market = marketValue(league, p);
    if (market.share >= M.payFromShare) {
      const ratio = contractShare(league, c) / market.share;
      const money = pr.priorities.money / 25;
      const egoBoost = 1 + Math.max(0, (pr.ego - 50) / 100);
      const early = c.type === "rookie" && p.experience < 3 ? M.earlyRookieDeal : 1;
      if (ratio < 1)
        add("pay", Math.max(M.payFloor, (1 - ratio) * 10 * M.payPer10 * money * egoBoost * early));
      else if (ratio >= 1.15) add("pay", M.overpaid * money);
    }
  }

  add("fit", playerFit(league, p) * M.fit);
  add("leaders", (snap.leaders.get(p.teamId) ?? 0) * M.leaders);
  add("loyalty", ((pr.loyalty - 50) / 50) * M.loyalty);
  if (snap.disputing.has(p.id)) add("dispute", M.dispute);

  // Volatile players feel everything more.
  const swing = 1 + M.temperament * ((50 - pr.temperament) / 50);
  const total = factors.reduce((s, f) => s + f.points, 0) * swing;
  for (const f of factors) f.points = Math.round(f.points * swing * 10) / 10;
  return { score: clamp(M.neutral + total, 0, 100), factors };
}

/**
 * The weekly update (and at the offseason's turning points): each mood moves `share` of the way
 * to where it's headed; a player new to a team (or with no mood yet) starts there.
 */
export function updateMoods(league: League, share: number = MORALE.weeklyShare): void {
  for (const p of league.players) {
    if (p.teamId === null || p.retiredAfter !== null) {
      p.mood = null;
      continue;
    }
    const target = moodTarget(league, p);
    if (!target) continue;
    const prev = p.mood?.score ?? target.score;
    const score = Math.round((prev + (target.score - prev) * share) * 10) / 10;
    p.mood = { score: clamp(score, 0, 100), factors: target.factors };
  }
}

/** Brings one player's mood fully up to date (after a new deal or a trade, say). */
export function refreshMood(league: League, p: Player): void {
  const target = moodTarget(league, p);
  p.mood = target ? { score: target.score, factors: target.factors } : null;
}

/** One sentence on why he feels as he does (his two biggest factors). */
export function moodReason(p: Player): string {
  if (!p.mood) return "No team yet.";
  const top = [...p.mood.factors]
    .sort((a, b) => Math.abs(b.points) - Math.abs(a.points))
    .slice(0, 2)
    .filter((f) => Math.abs(f.points) >= 1);
  const label = moodLabel(p.mood.score);
  if (top.length === 0) return `${label}: nothing much bothers him.`;
  const parts = top.map(
    (f) => `${MOOD_LABELS[f.key].toLowerCase()} (${f.points > 0 ? "+" : ""}${f.points.toFixed(0)})`,
  );
  return `${label}: mostly ${parts.join(" and ")}.`;
}

// ---------------------------------------------------------------------------
// The locker room

export interface Chemistry {
  /** 0-100, 50 = typical. */
  score: number;
  /** Players with the most leadership, best first. */
  leaders: number[];
  /** Unhappy players, unhappiest first. */
  unhappy: number[];
  /** Unhappy big egos dragging the room down. */
  disruptive: number[];
}

/** A team's chemistry: its players' moods weighted by leadership, less unhappy big egos. */
export function teamChemistry(league: League, teamId: string): Chemistry {
  const M = MORALE;
  const players = league.players.filter(
    (p) => p.teamId === teamId && p.retiredAfter === null && p.roster !== "practice-squad",
  );
  let sum = 0;
  let weights = 0;
  const disruptive: Player[] = [];
  for (const p of players) {
    const mood = p.mood?.score ?? M.neutral;
    const w = 1 + M.leaderWeight * Math.max(0, (p.personality.leadership - 50) / 50);
    sum += mood * w;
    weights += w;
    if (p.personality.ego >= M.egoDisruptive && mood < M.moodDisruptive) disruptive.push(p);
  }
  const avg = weights > 0 ? sum / weights : M.neutral;
  const score = clamp(avg - M.disruptive * disruptive.length, 0, 100);
  // Leaders: leadership, with experience behind it (a veteran's voice carries further).
  const voice = (p: Player) => p.personality.leadership + 3 * Math.min(8, p.experience);
  const leaders = [...players]
    .sort((a, b) => voice(b) - voice(a) || a.id - b.id)
    .slice(0, 5)
    .map((p) => p.id);
  const unhappy = players
    .filter((p) => (p.mood?.score ?? M.neutral) < 40)
    .sort((a, b) => (a.mood?.score ?? 50) - (b.mood?.score ?? 50) || a.id - b.id)
    .map((p) => p.id);
  return {
    score: Math.round(score * 10) / 10,
    leaders,
    unhappy,
    disruptive: disruptive.map((p) => p.id),
  };
}

// ---------------------------------------------------------------------------
// Effects

/** Development multiplier from his mood (1 = neutral). */
export function moraleDevelopment(p: Player): number {
  if (!p.mood) return 1;
  return 1 + MORALE.development * clamp((p.mood.score - MORALE.neutral) / 50, -1, 1);
}

/** Game-day rating points from his mood and his locker room (at most about one point). */
export function moraleGamePoints(p: Player, chemistry: number): number {
  const mood = p.mood?.score ?? MORALE.neutral;
  return (
    MORALE.gameMood * clamp((mood - MORALE.neutral) / 50, -1, 1) +
    MORALE.gameChemistry * clamp((chemistry - MORALE.neutral) / 50, -1, 1)
  );
}
