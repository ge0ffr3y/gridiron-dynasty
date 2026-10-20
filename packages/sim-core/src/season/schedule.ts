/**
 * Builds a season's 272-game schedule.
 *
 * Step 1 decides WHO plays WHOM and WHERE, from the NFL formula and the
 * rotation tables in the rules. Step 2 decides WHEN: a seeded search moves
 * games between weeks until every team plays once a week, has one bye inside
 * the bye window, no week has too many byes, and the last week is all
 * division games.
 */
import type { Team } from "../league/schema";
import type { Rng } from "@fgm/foundation";
import type { Rules } from "../rules";

export interface Matchup {
  homeId: string;
  awayId: string;
  /** Why these two play (handy for checking the formula). */
  kind: "division" | "same-conference" | "other-conference" | "same-place" | "seventeenth";
}

export interface ScheduledGame extends Matchup {
  week: number;
}

function mod(n: number, m: number): number {
  return ((n % m) + m) % m;
}

/** Teams of one division, in rules order. */
function divisionTeams(rules: Rules, conferenceId: string, divisionName: string): string[] {
  const conference = rules.structure.conferences.find((c) => c.id === conferenceId);
  const division = conference?.divisions.find((d) => d.name === divisionName);
  if (!division) throw new Error(`no division ${conferenceId} ${divisionName}`);
  return division.teams;
}

/** A division's teams ordered by last season's finish (1st place first). */
function byFinish(teams: string[], finish: Map<string, number>): string[] {
  return [...teams].sort(
    (a, b) => (finish.get(a) ?? 9) - (finish.get(b) ?? 9) || teams.indexOf(a) - teams.indexOf(b),
  );
}

/** Four-by-four block: every team plays every team of the other division, two at home and two away. */
function block(season: number, x: string[], y: string[], kind: Matchup["kind"]): Matchup[] {
  const games: Matchup[] = [];
  x.forEach((a, i) =>
    y.forEach((b, j) => {
      const aHome = mod(i + j + season, 2) === 0;
      games.push({ homeId: aHome ? a : b, awayId: aHome ? b : a, kind });
    }),
  );
  return games;
}

/** The pairings that apply to a season, from the rotation tables. */
export function seasonPairings(rules: Rules, season: number) {
  const s = rules.schedule;
  const offset = season - s.rotationBaseSeason;
  const same = s.sameConferenceRotation[mod(offset, s.sameConferenceRotation.length)] as [
    string,
    string,
  ][];
  const other = s.otherConferenceRotation[mod(offset, s.otherConferenceRotation.length)] as [
    string,
    string,
  ][];
  const seventeenth = s.otherConferenceRotation[
    mod(offset + s.seventeenthGameRotationOffset, s.otherConferenceRotation.length)
  ] as [string, string][];
  const [confA, confB] = rules.structure.conferences;
  if (!confA || !confB) throw new Error("the schedule formula needs two conferences");
  const seventeenthHost =
    mod(season, 2) === 0
      ? s.seventeenthGameHostInEvenSeasons
      : s.seventeenthGameHostInEvenSeasons === confA.id
        ? confB.id
        : confA.id;
  return { same, other, seventeenth, seventeenthHost, confA: confA.id, confB: confB.id };
}

/**
 * Every game of the season, with home and away decided.
 * `finish` is each team's place in its division last season (1-4).
 */
export function buildMatchups(
  rules: Rules,
  season: number,
  finish: Map<string, number>,
): Matchup[] {
  const games: Matchup[] = [];
  const p = seasonPairings(rules, season);

  for (const conference of rules.structure.conferences) {
    // Division games: home and away against each rival.
    for (const division of conference.divisions) {
      const t = division.teams;
      for (let i = 0; i < t.length; i++) {
        for (let j = i + 1; j < t.length; j++) {
          games.push({ homeId: t[i] as string, awayId: t[j] as string, kind: "division" });
          games.push({ homeId: t[j] as string, awayId: t[i] as string, kind: "division" });
        }
      }
    }
    // A full same-conference division, and same-place games against the other two.
    for (const [x, y] of p.same) {
      games.push(
        ...block(
          season,
          divisionTeams(rules, conference.id, x),
          divisionTeams(rules, conference.id, y),
          "same-conference",
        ),
      );
    }
    const [[pName, qName], [rName, sName]] = p.same as [[string, string], [string, string]];
    const P = byFinish(divisionTeams(rules, conference.id, pName), finish);
    const Q = byFinish(divisionTeams(rules, conference.id, qName), finish);
    const R = byFinish(divisionTeams(rules, conference.id, rName), finish);
    const S = byFinish(divisionTeams(rules, conference.id, sName), finish);
    for (let k = 0; k < 4; k++) {
      const [pk, qk, rk, sk] = [P[k], Q[k], R[k], S[k]] as [string, string, string, string];
      // A four-team cycle so each team gets one home and one away game.
      const cycle: [string, string][] =
        mod(season, 2) === 0
          ? [
              [pk, rk],
              [rk, qk],
              [qk, sk],
              [sk, pk],
            ]
          : [
              [rk, pk],
              [qk, rk],
              [sk, qk],
              [pk, sk],
            ];
      for (const [home, away] of cycle)
        games.push({ homeId: home, awayId: away, kind: "same-place" });
    }
  }

  // A full other-conference division, and the 17th game against a same-place finisher.
  for (const [aName, bName] of p.other) {
    games.push(
      ...block(
        season,
        divisionTeams(rules, p.confA, aName),
        divisionTeams(rules, p.confB, bName),
        "other-conference",
      ),
    );
  }
  for (const [aName, bName] of p.seventeenth) {
    const A = byFinish(divisionTeams(rules, p.confA, aName), finish);
    const B = byFinish(divisionTeams(rules, p.confB, bName), finish);
    for (let k = 0; k < 4; k++) {
      const [a, b] = [A[k], B[k]] as [string, string];
      games.push(
        p.seventeenthHost === p.confA
          ? { homeId: a, awayId: b, kind: "seventeenth" }
          : { homeId: b, awayId: a, kind: "seventeenth" },
      );
    }
  }
  return games;
}

/**
 * How often the week search makes a random move instead of the best one, to
 * escape dead ends. Measured over 50 seeds: 0.2% lays out a season in about
 * 15 ms; 1% took 50 ms and 5% often failed.
 */
const RANDOM_MOVE_CHANCE = 0.002;

/** Thrown if no valid week layout is found (should never happen; tests check many seeds). */
export class ScheduleError extends Error {}

/**
 * Assigns weeks. Week 18 gets one division game per team; Weeks 1-17 are
 * filled by a min-conflicts search: repeatedly move a game that causes a
 * problem to the week where it causes the fewest problems.
 */
export function assignWeeks(
  rules: Rules,
  matchups: Matchup[],
  teams: Team[],
  rng: Rng,
): ScheduledGame[] {
  const s = rules.schedule;
  const weeks = s.regularSeasonWeeks;
  const index = new Map(teams.map((t, i) => [t.id, i]));
  const n = teams.length;
  const result: ScheduledGame[] = matchups.map((m) => ({ ...m, week: 0 }));

  // Week 18: in each division, pick one of the three ways to pair up its teams.
  const pool = result.map((_, i) => i);
  if (s.finalWeekDivisionOnly) {
    for (const conference of rules.structure.conferences) {
      for (const division of conference.divisions) {
        const [a, b, c, d] = division.teams as [string, string, string, string];
        const pairings: [string, string][][] = [
          [
            [a, b],
            [c, d],
          ],
          [
            [a, c],
            [b, d],
          ],
          [
            [a, d],
            [b, c],
          ],
        ];
        for (const [x, y] of rng.pick(pairings)) {
          const options = pool.filter((i) => {
            const g = result[i] as ScheduledGame;
            return (
              g.kind === "division" &&
              g.week === 0 &&
              ((g.homeId === x && g.awayId === y) || (g.homeId === y && g.awayId === x))
            );
          });
          (result[rng.pick(options)] as ScheduledGame).week = weeks;
        }
      }
    }
  }
  const open = pool.filter((i) => (result[i] as ScheduledGame).week === 0);
  const searchWeeks = s.finalWeekDivisionOnly ? weeks - 1 : weeks;
  const [byeFirst, byeLast] = s.byeWeeks;
  const inWindow = (w: number) => w + 1 >= byeFirst && w + 1 <= byeLast;

  const home = open.map((i) => index.get((result[i] as ScheduledGame).homeId) as number);
  const away = open.map((i) => index.get((result[i] as ScheduledGame).awayId) as number);

  for (let attempt = 0; attempt < 20; attempt++) {
    const week = open.map(() => rng.int(searchWeeks));
    const count = new Int32Array(n * searchWeeks);
    for (let g = 0; g < open.length; g++) {
      count[(home[g] as number) * searchWeeks + (week[g] as number)]!++;
      count[(away[g] as number) * searchWeeks + (week[g] as number)]!++;
    }
    const byes = new Int32Array(searchWeeks);
    for (let t = 0; t < n; t++)
      for (let w = 0; w < searchWeeks; w++) if (count[t * searchWeeks + w] === 0) byes[w]!++;

    // Problems a team has: double-booked weeks, and empty weeks outside the bye window.
    const teamCost = (t: number) => {
      let cost = 0;
      for (let w = 0; w < searchWeeks; w++) {
        const c = count[t * searchWeeks + w] as number;
        if (c > 1) cost += c - 1;
        if (c === 0 && !inWindow(w)) cost += 1;
      }
      return cost;
    };
    const byeCost = () => {
      let cost = 0;
      for (let w = 0; w < searchWeeks; w++)
        cost += Math.max(0, (byes[w] as number) - s.maxByesPerWeek);
      return cost;
    };
    let total = byeCost();
    for (let t = 0; t < n; t++) total += teamCost(t);

    const overMax = (b: number) => Math.max(0, b - s.maxByesPerWeek);
    // Double-booked team-weeks right now (lets us skip searching when there are none).
    let conflicts = 0;
    for (let i = 0; i < count.length; i++)
      if ((count[i] as number) > 1) conflicts += (count[i] as number) - 1;

    // The change in total problems if game g moved to week `to`.
    const delta = (g: number, to: number): number => {
      const from = week[g] as number;
      let d = 0;
      let newByesFrom = 0;
      let lostByesTo = 0;
      for (let side = 0; side < 2; side++) {
        const t = (side === 0 ? home[g] : away[g]) as number;
        const cf = count[t * searchWeeks + from] as number;
        const ct = count[t * searchWeeks + to] as number;
        if (cf > 1) d -= 1;
        else if (!inWindow(from)) d += 1;
        if (ct >= 1) d += 1;
        else if (!inWindow(to)) d -= 1;
        if (cf === 1) newByesFrom++;
        if (ct === 0) lostByesTo++;
      }
      const bf = byes[from] as number;
      const bt = byes[to] as number;
      return d + overMax(bf + newByesFrom) - overMax(bf) + overMax(bt - lostByesTo) - overMax(bt);
    };

    const move = (g: number, to: number) => {
      const from = week[g] as number;
      for (let side = 0; side < 2; side++) {
        const t = (side === 0 ? home[g] : away[g]) as number;
        const cf = --count[t * searchWeeks + from]!;
        const ct = ++count[t * searchWeeks + to]!;
        if (cf >= 1) conflicts--;
        if (ct >= 2) conflicts++;
        if (cf === 0) byes[from]!++;
        if (ct === 1) byes[to]!--;
      }
      week[g] = to;
    };

    const isProblem = (g: number) => {
      const w = week[g] as number;
      return (
        (count[(home[g] as number) * searchWeeks + w] as number) > 1 ||
        (count[(away[g] as number) * searchWeeks + w] as number) > 1
      );
    };

    const choices: number[] = [];
    for (let iter = 0; iter < 200_000 && total > 0; iter++) {
      // Mostly fix a double-booked game; otherwise move any game (needed to fix bye problems).
      let g = rng.int(open.length);
      if (conflicts > 0 && rng.chance(0.9)) {
        while (!isProblem(g)) g = g + 1 === open.length ? 0 : g + 1;
      }
      if (rng.chance(RANDOM_MOVE_CHANCE)) {
        let to = rng.int(searchWeeks - 1);
        if (to >= (week[g] as number)) to++;
        total += delta(g, to);
        move(g, to);
        continue;
      }
      let best = Infinity;
      choices.length = 0;
      for (let w = 0; w < searchWeeks; w++) {
        if (w === week[g]) continue;
        const d = delta(g, w);
        if (d < best) {
          best = d;
          choices.length = 0;
          choices.push(w);
        } else if (d === best) choices.push(w);
      }
      if (best <= 0) {
        total += best;
        move(g, rng.pick(choices));
      }
    }

    if (total === 0) {
      open.forEach((i, g) => ((result[i] as ScheduledGame).week = (week[g] as number) + 1));
      return result;
    }
  }
  throw new ScheduleError("could not lay out the schedule; try another seed");
}
