/**
 * Checks a season's schedule against every rule of the formula and the
 * week layout. Returns a list of problems (empty = valid).
 */
import type { Game, Team } from "../league/schema";
import type { Rules } from "../rules";
import { seasonPairings } from "./schedule";

export function validateSchedule(
  rules: Rules,
  season: number,
  teams: Team[],
  games: Pick<Game, "homeId" | "awayId" | "week" | "round">[],
  finish: Map<string, number>,
): string[] {
  const problems: string[] = [];
  const regular = games.filter((g) => g.round === "regular");
  const s = rules.schedule;
  const team = new Map(teams.map((t) => [t.id, t]));
  const divisionName = (id: string) => {
    const t = team.get(id) as Team;
    const conference = rules.structure.conferences.find((c) => c.id === t.conferenceId);
    return conference?.divisions.find((d) => d.id === t.divisionId)?.name ?? "?";
  };
  const p = seasonPairings(rules, season);
  const partner = (pairs: [string, string][], name: string, side: 0 | 1) =>
    pairs.find((pair) => pair[side] === name)?.[side === 0 ? 1 : 0];
  const sameConfPartner = (name: string) => partner(p.same, name, 0) ?? partner(p.same, name, 1);

  const expectedGames = regular.length === (teams.length * (s.regularSeasonWeeks - 1)) / 2;
  if (!expectedGames)
    problems.push(
      `expected ${(teams.length * (s.regularSeasonWeeks - 1)) / 2} games, found ${regular.length}`,
    );

  for (const t of teams) {
    const mine = regular.filter((g) => g.homeId === t.id || g.awayId === t.id);
    const opponent = (g: (typeof mine)[number]) => (g.homeId === t.id ? g.awayId : g.homeId);
    const isHome = (g: (typeof mine)[number]) => g.homeId === t.id;
    const name = divisionName(t.id);
    const fail = (msg: string) => problems.push(`${t.id}: ${msg}`);

    if (mine.length !== s.regularSeasonWeeks - 1) fail(`plays ${mine.length} games`);

    // Division: each rival twice, once home and once away.
    for (const rival of teams.filter((o) => o.divisionId === t.divisionId && o.id !== t.id)) {
      const vs = mine.filter((g) => opponent(g) === rival.id);
      if (vs.length !== 2 || vs.filter(isHome).length !== 1)
        fail(`division games with ${rival.id} are not home-and-away`);
    }

    // Full same-conference division and full other-conference division: 2 home, 2 away each.
    const fullBlock = (opponents: Team[], label: string) => {
      const vs = mine.filter((g) => opponents.some((o) => o.id === opponent(g)));
      if (vs.length !== 4 || opponents.some((o) => !vs.some((g) => opponent(g) === o.id)))
        fail(`doesn't play all of ${label}`);
      else if (vs.filter(isHome).length !== 2) fail(`${label} games are not 2 home / 2 away`);
    };
    const samePartner = sameConfPartner(name);
    fullBlock(
      teams.filter((o) => o.conferenceId === t.conferenceId && divisionName(o.id) === samePartner),
      `${samePartner} (same conference)`,
    );
    const inA = t.conferenceId === p.confA;
    const otherPartner = partner(p.other, name, inA ? 0 : 1);
    fullBlock(
      teams.filter((o) => o.conferenceId !== t.conferenceId && divisionName(o.id) === otherPartner),
      `${otherPartner} (other conference)`,
    );

    // Same-place games against the two remaining same-conference divisions: 1 home, 1 away.
    const remaining = rules.structure.conferences
      .find((c) => c.id === t.conferenceId)!
      .divisions.map((d) => d.name)
      .filter((d) => d !== name && d !== samePartner);
    const samePlace = mine.filter((g) => {
      const o = team.get(opponent(g)) as Team;
      return o.conferenceId === t.conferenceId && remaining.includes(divisionName(o.id));
    });
    if (
      samePlace.length !== 2 ||
      samePlace.some((g) => finish.get(opponent(g)) !== finish.get(t.id))
    ) {
      fail("same-place games are wrong");
    } else if (samePlace.filter(isHome).length !== 1)
      fail("same-place games are not 1 home / 1 away");

    // The 17th game: same-place finisher from the designated other-conference division, hosted by the right conference.
    const seventeenthDivision = partner(p.seventeenth, name, inA ? 0 : 1);
    const seventeenth = mine.filter((g) => {
      const o = team.get(opponent(g)) as Team;
      return o.conferenceId !== t.conferenceId && divisionName(o.id) === seventeenthDivision;
    });
    if (seventeenth.length !== 1 || finish.get(opponent(seventeenth[0]!)) !== finish.get(t.id))
      fail("17th game is wrong");
    else if (isHome(seventeenth[0]!) !== (t.conferenceId === p.seventeenthHost))
      fail("17th game has the wrong host");

    // Weeks: once a week, one bye inside the window.
    const byWeek = new Map<number, number>();
    for (const g of mine) byWeek.set(g.week, (byWeek.get(g.week) ?? 0) + 1);
    for (const [w, c] of byWeek) if (c > 1) fail(`plays ${c} games in week ${w}`);
    const byeWeeks: number[] = [];
    for (let w = 1; w <= s.regularSeasonWeeks; w++) if (!byWeek.has(w)) byeWeeks.push(w);
    if (byeWeeks.length !== 1) fail(`has ${byeWeeks.length} byes`);
    else if (byeWeeks[0]! < s.byeWeeks[0] || byeWeeks[0]! > s.byeWeeks[1])
      fail(`bye in week ${byeWeeks[0]} is outside the window`);
  }

  for (let w = 1; w <= s.regularSeasonWeeks; w++) {
    const playing = new Set(
      regular.filter((g) => g.week === w).flatMap((g) => [g.homeId, g.awayId]),
    );
    const off = teams.length - playing.size;
    if (off > s.maxByesPerWeek && off !== teams.length)
      problems.push(`week ${w}: ${off} teams on bye`);
  }
  if (s.finalWeekDivisionOnly) {
    const last = regular.filter((g) => g.week === s.regularSeasonWeeks);
    if (last.some((g) => team.get(g.homeId)?.divisionId !== team.get(g.awayId)?.divisionId)) {
      problems.push(`week ${s.regularSeasonWeeks} has a non-division game`);
    }
  }
  return problems;
}
