/**
 * Truth vs. perception (CLAUDE.md, rule 7; Phase 11).
 *
 * Players' true ratings are never shown. Everything a screen shows is what the
 * viewer's staff BELIEVES: the truth plus an error that's fixed for that
 * viewer and player (scouting/noise.ts), scaled by how uncertain the read is
 * today. The read sharpens with:
 * - NFL tape (snaps and seasons): veterans are clear, rookies less so;
 * - being on the viewer's own team (coached every day);
 * - the viewer's scouts (their scouting skill and budget);
 * - for prospects, the study his scouts have put in (assignments, the combine).
 * Physical traits are nearly exact once measured at the combine or a pro day.
 *
 * The league office (Simulation Mode's default view) sees a consensus: a
 * typical scouting department with the league's average study.
 */
import type { League, Player, Prospect } from "./league/schema";
import {
  ATTRIBUTES,
  OVERALL_WEIGHTS,
  overallWithFamiliarity,
  POSITIONS,
  type Position,
  type Ratings,
} from "@fgm/foundation";
import { SCOUTING } from "./scouting/config";
import { normalFrom } from "./scouting/noise";
import { leagueTypical, skillStep } from "./coaches/style";
import { anchorFor } from "./scouting/classes";
import { DRAFT_CLASS } from "./roster/config";

/** Who is looking: a team's staff, or the neutral league office (Simulation Mode). */
export type Viewer = { kind: "league" } | { kind: "team"; teamId: string };

/** The viewer the screens use: the league's "Viewing as" setting. */
export function screenViewer(league: League): Viewer {
  const id = league.settings.viewingAs;
  return id && league.teams.some((t) => t.id === id)
    ? { kind: "team", teamId: id }
    : { kind: "league" };
}

export interface PerceivedPlayer {
  ratings: Ratings;
  /** Overall at the player's listed position. */
  overall: number;
  /** Overall at every position the player knows, best first. */
  positionOveralls: { position: Position; overall: number; familiarity: number }[];
  /** How sure the viewer's staff is, 0-1 (1 = certain). */
  confidence: number;
  /** The overall's likely range (about 80%). */
  range: [number, number];
  /** What he could become: the staff's read of his potential, as a likely range. */
  potential: { estimate: number; range: [number, number] };
  /** How far off a single rating may be (likely range, each way): skills and physical traits. */
  plusMinus: { skills: number; physical: number };
}

/** What a read is based on: a player or a prospect. */
interface Subject {
  id: number;
  position: Position;
  ratings: Ratings;
  familiarity: Partial<Record<Position, number>>;
  potential: number;
  teamId: string | null;
  /** NFL snaps (offense and defense) over his career, and seasons in the league. */
  snaps: number;
  seasons: number;
  /** Physical traits measured (combine, pro day, or an NFL player). */
  measured: boolean;
  prospect: boolean;
  /** What the league expected of him by his draft rank (prospects and unproven rookies), if known. */
  anchor: { overall: number; potential: number } | null;
}

const PHYSICAL = new Set<string>(
  ATTRIBUTES.filter((a) => a.group === "physical").map((a) => a.key),
);

function careerSnaps(p: Player): number {
  let n = 0;
  for (const s of p.stats) n += (s.line.offSnaps ?? 0) + (s.line.defSnaps ?? 0);
  return n;
}

function subjectOf(league: League, p: Player): Subject {
  // A rookie drafted this year is still read partly by where he went, until his tape takes over.
  const rookie = p.drafted && p.drafted.season === league.season && p.experience === 0;
  return {
    id: p.id,
    position: p.position,
    ratings: p.ratings,
    familiarity: p.familiarity,
    potential: p.hidden.potential,
    teamId: p.teamId,
    snaps: careerSnaps(p),
    seasons: p.experience,
    measured: true,
    prospect: false,
    anchor: rookie ? anchorFor(league, p.position, p.drafted!.pick) : null,
  };
}

function prospectSubject(league: League, p: Prospect): Subject {
  return {
    id: p.id,
    position: p.position,
    ratings: p.ratings,
    familiarity: p.familiarity,
    potential: p.hidden.potential,
    teamId: null,
    snaps: 0,
    seasons: 0,
    measured: p.tested,
    prospect: true,
    anchor: anchorFor(league, p.position, p.anchorRank),
  };
}

/** A team's scouting department: how much clearer (below 1) or blurrier its reads are. */
const GM_SKILL = new WeakMap<League, { key: string; mean: number }>();
/** The average judging skill of the league's GMs (cached per date). */
function typicalGmSkill(league: League): number {
  const hit = GM_SKILL.get(league);
  if (hit && hit.key === league.date) return hit.mean;
  const skills = league.executives.flatMap((e) =>
    e.role === "GM" && e.teamId !== null && e.retiredAfter === null && e.gm ? [e.gm.skill] : [],
  );
  const mean = skills.length ? skills.reduce((a, b) => a + b, 0) / skills.length : 55;
  GM_SKILL.set(league, { key: league.date, mean });
  return mean;
}

function departmentFactor(league: League, teamId: string): number {
  const team = league.teams.find((t) => t.id === teamId);
  const scouts = league.coaches.filter((c) => c.teamId === teamId && c.role === "SCOUT");
  const skill = scouts.length
    ? scouts.reduce((a, c) => a + c.ratings.scouting, 0) / scouts.length
    : leagueTypical(league, "SCOUT", "scouting");
  const step = skillStep(skill, leagueTypical(league, "SCOUT", "scouting"));
  // The GM's own eye (Phase 13): a skilled GM sharpens his department's reads a little.
  const gm = league.executives.find(
    (e) => e.role === "GM" && e.teamId === teamId && e.retiredAfter === null,
  )?.gm;
  // Measured against the league's GMs today, so owners hiring skilled GMs over the decades
  // doesn't sharpen the whole league's reads.
  const eye = gm ? 1 - SCOUTING.gmEye * ((gm.skill - typicalGmSkill(league)) / 50) : 1;
  return (
    (1 - step * SCOUTING.skillEffect) * SCOUTING.budget[team?.scouting.budget ?? "normal"] * eye
  );
}

/** Study points on a player: the viewer team's, or the league's average for the office. */
function studyPoints(league: League, viewer: Viewer, id: number): number {
  const key = String(id);
  if (viewer.kind === "team")
    return league.teams.find((t) => t.id === viewer.teamId)?.scouting.points[key] ?? 0;
  let sum = 0;
  for (const t of league.teams) sum += t.scouting.points[key] ?? 0;
  return sum / Math.max(1, league.teams.length);
}

/** How uncertain the viewer's read is (one standard deviation, in rating points). */
export function uncertainty(
  league: League,
  viewer: Viewer,
  s: Subject,
): { skills: number; physical: number; potential: number } {
  const S = SCOUTING;
  const info = s.snaps + s.seasons * S.snapsPerSeason;
  const tape = 1 / Math.sqrt(1 + info / S.snapsToHalve);
  const study = 1 / Math.sqrt(1 + studyPoints(league, viewer, s.id) / S.pointsToHalve);
  const own = viewer.kind === "team" && s.teamId === viewer.teamId ? S.ownTeam : 1;
  const department = viewer.kind === "team" ? departmentFactor(league, viewer.teamId) : 1;
  const scale = tape * study * own * department;
  return {
    skills: S.prospect.skills * scale,
    physical: s.measured ? S.measured : S.prospect.physical * scale,
    potential: S.prospect.potential * scale,
  };
}

/** The length of (a, b): two independent errors combined. */
function hypot(a: number, b: number): number {
  return Math.sqrt(a * a + b * b);
}

/** Each position's share of the overall that comes from skills (not physical traits). */
const SKILL_SHARE = new Map<Position, number>(
  POSITIONS.map((pos) => {
    const w = OVERALL_WEIGHTS[pos];
    let all = 0;
    let skills = 0;
    for (const a of ATTRIBUTES) {
      all += w[a.key] ?? 0;
      if (!PHYSICAL.has(a.key)) skills += w[a.key] ?? 0;
    }
    return [pos, all > 0 ? skills / all : 1];
  }),
);

// Each viewer's wobble on each attribute of a player is a fixed draw (a hash of the league, the
// viewer, the player and the attribute), so it is computed once, not on every read.
const WOBBLES = new WeakMap<League, Map<string, Float64Array>>();
/** The most players' wobbles kept per league; the cache starts over past this (players come and go). */
const WOBBLES_KEPT = 60_000;

function wobblesFor(league: League, wobbleKey: string): Float64Array {
  let all = WOBBLES.get(league);
  if (!all) WOBBLES.set(league, (all = new Map()));
  let draws = all.get(wobbleKey);
  if (!draws) {
    if (all.size >= WOBBLES_KEPT) all.clear();
    draws = new Float64Array(ATTRIBUTES.length);
    for (let i = 0; i < ATTRIBUTES.length; i++)
      draws[i] = normalFrom(`${wobbleKey}:${ATTRIBUTES[i]!.key}`);
    all.set(wobbleKey, draws);
  }
  return draws;
}

/**
 * The viewer's read of a subject. Its error has three parts:
 * - shared by the whole league: for a prospect, the league's expectation of his draft rank
 *   (it misses `consensus.weight` of how he differs, less as he's studied); for others a fixed
 *   draw common to every viewer;
 * - the viewer's own (none for the league office, which averages every department);
 * - each skill's own wobble.
 */
function perceive(league: League, s: Subject, viewer: Viewer): PerceivedPlayer;
function perceive(league: League, s: Subject, viewer: Viewer, overallOnly: true): number;
function perceive(
  league: League,
  s: Subject,
  viewer: Viewer,
  overallOnly = false,
): PerceivedPlayer | number {
  const S = SCOUTING;
  const C = S.consensus;
  const sd = uncertainty(league, viewer, s);
  const seed = league.meta.seed;
  const team = viewer.kind === "team" ? viewer.teamId : null;
  const own = team ? normalFrom(`${seed}:${team}:${s.id}:whole`) : 0;
  const ownPotential = team ? normalFrom(`${seed}:${team}:${s.id}:potential`) : 0;
  const trueOverall = overallWithFamiliarity(s.ratings, s.position, 1);
  // How far the league's read is fooled, in overall points and in room to grow.
  let shift: number;
  let growthShift: number;
  // The typical size of this read's error (overall and room to grow), for its likely range.
  let errorSd: number;
  let growthErrorSd: number;
  const teamPart = team ? C.teamShare : 0;
  if (s.anchor) {
    const w = Math.min(1, C.weight * (sd.skills / S.prospect.skills));
    shift = w * (s.anchor.overall - trueOverall) + sd.skills * teamPart * own;
    growthShift =
      w * (s.anchor.potential - s.anchor.overall - (s.potential - trueOverall)) +
      sd.potential * teamPart * ownPotential;
    errorSd = hypot(w * DRAFT_CLASS.overallSpread, sd.skills * teamPart);
    growthErrorSd = hypot(w * DRAFT_CLASS.growthSpread, sd.potential * teamPart);
  } else {
    const shared = normalFrom(`${seed}:all:${s.id}:whole`);
    const sharedPotential = normalFrom(`${seed}:all:${s.id}:potential`);
    const split = (a: number, b: number) =>
      Math.sqrt(C.sharedShare) * a + (team ? Math.sqrt(1 - C.sharedShare) * b : 0);
    shift = sd.skills * S.wholeShare * split(shared, own);
    growthShift = sd.potential * split(sharedPotential, ownPotential);
    const spread = Math.sqrt(C.sharedShare + (team ? 1 - C.sharedShare : 0));
    errorSd = sd.skills * S.wholeShare * spread;
    growthErrorSd = sd.potential * spread;
  }
  // Skills carry the whole-player shift (scaled so the overall moves by `shift`).
  const skillShift = shift / (SKILL_SHARE.get(s.position) ?? 1);
  const wobbleKey = `${seed}:${team ?? "office"}:${s.id}`;
  const ratings = {} as Ratings;
  const wobbles = wobblesFor(league, wobbleKey);
  for (let i = 0; i < ATTRIBUTES.length; i++) {
    const a = ATTRIBUTES[i]!;
    const wobble = wobbles[i]!;
    const error = PHYSICAL.has(a.key)
      ? sd.physical * wobble
      : skillShift + sd.skills * S.ownShare * wobble;
    ratings[a.key] = Math.max(1, Math.min(99, Math.round(s.ratings[a.key] + error)));
  }
  // Callers that only want the overall skip the rest (positions, ranges, potential).
  if (overallOnly) return overallWithFamiliarity(ratings, s.position, 1);
  const positionOveralls = POSITIONS.flatMap((position) => {
    const familiarity = s.position === position ? 1 : s.familiarity[position];
    return familiarity === undefined
      ? []
      : [
          {
            position,
            overall: overallWithFamiliarity(ratings, position, familiarity),
            familiarity,
          },
        ];
  }).sort(
    (a, b) =>
      b.overall - a.overall || POSITIONS.indexOf(a.position) - POSITIONS.indexOf(b.position),
  );
  const overall = overallWithFamiliarity(ratings, s.position, 1);
  const half = Math.round(SCOUTING.rangeWidth * errorSd);
  const potentialEstimate = Math.max(
    overall,
    Math.min(99, Math.round(overall + (s.potential - trueOverall) + growthShift)),
  );
  const potentialHalf = Math.round(SCOUTING.rangeWidth * hypot(errorSd, growthErrorSd));
  return {
    ratings,
    overall,
    positionOveralls,
    confidence: Math.max(0, Math.min(1, 1 - errorSd / SCOUTING.prospect.skills)),
    range: [Math.max(1, overall - half), Math.min(99, overall + half)],
    plusMinus: {
      skills: Math.round(
        SCOUTING.rangeWidth *
          hypot(errorSd / (SKILL_SHARE.get(s.position) ?? 1), sd.skills * SCOUTING.ownShare),
      ),
      physical: Math.round(SCOUTING.rangeWidth * sd.physical),
    },
    potential: {
      estimate: potentialEstimate,
      range: [
        Math.max(overall, potentialEstimate - potentialHalf),
        Math.min(99, potentialEstimate + potentialHalf),
      ],
    },
  };
}

export function perceivePlayer(league: League, player: Player, viewer: Viewer): PerceivedPlayer {
  return perceive(league, subjectOf(league, player), viewer);
}

/** A team's (or the office's) read of a draft prospect. */
export function perceiveProspect(
  league: League,
  prospect: Prospect,
  viewer: Viewer,
): PerceivedPlayer {
  return perceive(league, prospectSubject(league, prospect), viewer);
}

/**
 * A player's season-by-season overall as the viewer sees it: the true history, shifted by the
 * viewer's current error (so the chart ends where the viewer's read of him is today).
 */
export function perceiveHistory(
  league: League,
  player: Player,
  viewer: Viewer,
): Player["ratingHistory"] {
  const error =
    perceivePlayer(league, player, viewer).overall -
    overallWithFamiliarity(player.ratings, player.position, 1);
  return player.ratingHistory.map((h) => ({
    ...h,
    overall: Math.max(1, Math.min(99, h.overall + error)),
  }));
}

/** A development change (overall before and after) as the viewer sees it: the same error on both. */
export function perceiveChange(
  league: League,
  player: Player,
  viewer: Viewer,
  before: number,
  after: number,
): { before: number; after: number } {
  const error =
    perceivePlayer(league, player, viewer).overall -
    overallWithFamiliarity(player.ratings, player.position, 1);
  return {
    before: Math.max(1, Math.min(99, before + error)),
    after: Math.max(1, Math.min(99, after + error)),
  };
}

// A viewer's read of players' overalls, kept while nothing that changes it moves: the date (games,
// study, scouts) and the development rounds (ratings change only in them), with the player's team
// in each entry (his own team reads him better). Free agency, contract talks and the trade market
// ask for the same reads many times.
const OVERALLS = new WeakMap<League, { key: string; reads: Map<string, number> }>();

/** When cached reads go stale: a new date or a new development round. */
export function readsKey(league: League): string {
  return `${league.date}:${league.development.length}`;
}

/** The viewer's read of a player's overall at his position (cached; see perceivePlayer). */
export function readOverall(league: League, player: Player, viewer: Viewer): number {
  const key = readsKey(league);
  let cache = OVERALLS.get(league);
  if (!cache || cache.key !== key) {
    cache = { key, reads: new Map() };
    OVERALLS.set(league, cache);
  }
  const id = `${viewer.kind === "team" ? viewer.teamId : "office"}:${player.id}:${player.teamId}`;
  let overall = cache.reads.get(id);
  if (overall === undefined) {
    overall = perceive(league, subjectOf(league, player), viewer, true);
    cache.reads.set(id, overall);
  }
  return overall;
}

const FULL_READS = new WeakMap<
  League,
  { key: string; reads: Map<string, { overall: number; potential: number }> }
>();

/** The viewer's read of a player's overall and potential (cached like `readOverall`). */
export function readPlayer(
  league: League,
  player: Player,
  viewer: Viewer,
): { overall: number; potential: number } {
  const key = readsKey(league);
  let cache = FULL_READS.get(league);
  if (!cache || cache.key !== key) {
    cache = { key, reads: new Map() };
    FULL_READS.set(league, cache);
  }
  const id = `${viewer.kind === "team" ? viewer.teamId : "office"}:${player.id}:${player.teamId}`;
  let read = cache.reads.get(id);
  if (!read) {
    const seen = perceivePlayer(league, player, viewer);
    read = { overall: seen.overall, potential: seen.potential.estimate };
    cache.reads.set(id, read);
  }
  return read;
}
