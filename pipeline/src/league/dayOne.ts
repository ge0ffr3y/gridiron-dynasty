/**
 * The Day One validation report (Phase 16): for each of the 32 teams, the league as built against
 * the real facts on the day it starts (the day after the 2025 championship): roster, cap space,
 * draft picks owned, pending free agents, the real 2026 schedule, and the head coach. A team
 * passes when each check is inside its tolerance; a miss is listed with its reason.
 */
import {
  capSheet,
  rosterProblems,
  validateSchedule,
  type League,
  type RealPickTrade,
  type RealScheduleGame,
} from "@fgm/sim-core";
import type { ImportedContract } from "./contracts";
import type { RealPerson } from "./roster";
import type { CapValidation } from "./validate";

/** Real rows of the contracts file, as read. */
interface ContractRow {
  team: string | null;
  is_active: boolean | null;
  year_signed: number | null;
  years: number | null;
}

export interface DayOneCheck {
  name: string;
  ours: string | number;
  real: string | number;
  ok: boolean;
  /** Why a check outside its tolerance differs (or what the tolerance is). */
  note: string;
  /** A miss whose reason is known (a cap page archived on another day than the published figure). */
  explained?: boolean;
}

export interface DayOneTeam {
  teamId: string;
  checks: DayOneCheck[];
  ok: boolean;
}

export interface DayOneReport {
  teams: DayOneTeam[];
  /** Whole-league checks (the schedule's rules, roster and cap legality). */
  league: DayOneCheck[];
  /** Teams with no miss at all. */
  passed: number;
  /** Teams whose only misses are explained. */
  explained: number;
  lines: string[];
}

/** Tolerances (the build's own rounding, not the sim's): players released before the cap pages' date, and contracts the two sources date differently. */
export const DAY_ONE = {
  /** Players released between the league's start and each team's cap page may leave a roster short. */
  rosterShort: 3,
  /** Players the contracts file has under a deal into 2026 whom the cap pages leave without one (traded, released, or dated differently). */
  missingContracts: 3,
};

export interface DayOneFacts {
  people: RealPerson[];
  contracts: Map<string, ContractRow[]>;
  /** The contracts file's team names, by league team id. */
  teamNames: Map<string, string>;
  imported: Map<string, ImportedContract>;
  capValidation: CapValidation;
  /** Our names for each team's head coach, by team id (what the staffs file says, renamed). */
  headCoach: Map<string, string>;
  draftOrder: { overall: number; round: number; teamId: string }[];
  pickTrades: RealPickTrade[];
  schedule: RealScheduleGame[];
}

export function validateDayOne(league: League, f: DayOneFacts): DayOneReport {
  const season = league.season;
  const teams: DayOneTeam[] = [];
  const check = (
    out: DayOneCheck[],
    name: string,
    ours: string | number,
    real: string | number,
    ok: boolean,
    note = "",
  ) => out.push({ name, ours, real, ok, note });

  // The real 2025 picks and the trades that moved later ones, counted without our pick objects.
  const picks26 = new Map<string, number>();
  for (const p of f.draftOrder) picks26.set(p.teamId, (picks26.get(p.teamId) ?? 0) + 1);
  const picks27 = new Map<string, number>(
    league.teams.map((t) => [t.id, league.rules.draft.rounds]),
  );
  for (const t of f.pickTrades.filter((x) => x.season === season + 1)) {
    picks27.set(t.from, (picks27.get(t.from) ?? 0) - 1);
    picks27.set(t.to, (picks27.get(t.to) ?? 0) + 1);
  }
  const lastReal = (p: League["players"][number]) =>
    p.contract ? Math.max(...p.contract.years.filter((y) => !y.void).map((y) => y.season)) : null;
  const schedule = new Map<string, string[]>();
  for (const g of f.schedule) {
    schedule.set(g.homeId, [...(schedule.get(g.homeId) ?? []), `${g.week}:${g.awayId}:h`]);
    schedule.set(g.awayId, [...(schedule.get(g.awayId) ?? []), `${g.week}:${g.homeId}:a`]);
  }

  for (const team of league.teams) {
    const checks: DayOneCheck[] = [];
    // Roster: everyone on the real roster, less those released before the cap pages' date.
    const real = f.people.filter((p) => p.teamId === team.id).length;
    const ours = league.players.filter((p) => p.teamId === team.id).length;
    check(
      checks,
      "roster size",
      ours,
      real,
      real - ours >= 0 && real - ours <= DAY_ONE.rosterShort,
      `players released before the team's cap page start as free agents (up to ${DAY_ONE.rosterShort})`,
    );
    // Cap space: the cap report's own comparison with the published Feb 10 figure.
    const cap = f.capValidation.teams.find((t) => t.teamId === team.id);
    if (cap)
      check(
        checks,
        "cap space vs. published",
        Math.round((capSheet(league, team.id, season).room / 1e6) * 10) / 10,
        Math.round(((capSheet(league, team.id, season).room + cap.difference) / 1e6) * 10) / 10,
        cap.withinTolerance,
        cap.withinTolerance ? "within the cap report's tolerance" : cap.why,
      );
    if (cap && !cap.withinTolerance && cap.why) checks[checks.length - 1]!.explained = true;
    // Draft picks.
    const o26 = league.draftPicks.filter(
      (p) => p.season === season && p.ownerTeamId === team.id,
    ).length;
    check(
      checks,
      `${season} picks owned`,
      o26,
      picks26.get(team.id) ?? 0,
      o26 === (picks26.get(team.id) ?? 0),
      "the real draft order, trades and compensatory picks included",
    );
    const o27 = league.draftPicks.filter(
      (p) => p.season === season + 1 && p.ownerTeamId === team.id,
    ).length;
    check(
      checks,
      `${season + 1} picks owned`,
      o27,
      picks27.get(team.id) ?? 0,
      o27 === (picks27.get(team.id) ?? 0),
      "seven, less and plus the picks traded before the start",
    );
    // Contracts: a player the real contracts file has under a deal into 2026 or later must have
    // one in ours too. Only deals signed before the league year count: the file is newer than Feb 9, 2026.
    // (It doesn't list practice-squad or minimum deals, so the other way round proves nothing;
    // those players become the pending free agents.)
    const underContract = f.people.filter(
      (p) =>
        p.teamId === team.id &&
        (f.contracts.get(p.gsis) ?? []).some(
          (r) =>
            r.is_active &&
            r.team !== null &&
            f.teamNames.get(r.team) === team.id &&
            (r.year_signed ?? 9999) < season &&
            (r.year_signed ?? 0) + (r.years ?? 0) - 1 >= season,
        ),
    );
    const lost = underContract.filter((p) => !f.imported.get(p.gsis)?.contract).length;
    const pending = league.players.filter(
      (p) => p.teamId === team.id && !(p.contract && lastReal(p)! >= season),
    ).length;
    check(
      checks,
      "contracts into 2026",
      underContract.length - lost,
      underContract.length,
      lost <= DAY_ONE.missingContracts,
      `${lost} players with a real deal into ${season} start without one (tolerance ${DAY_ONE.missingContracts}); ${pending} players are pending free agents`,
    );
    // The real schedule: every game's week, opponent and side.
    const mine = league.games
      .filter((g) => g.round === "regular" && (g.homeId === team.id || g.awayId === team.id))
      .map(
        (g) =>
          `${g.week}:${g.homeId === team.id ? g.awayId : g.homeId}:${g.homeId === team.id ? "h" : "a"}`,
      )
      .sort();
    const realMine = [...(schedule.get(team.id) ?? [])].sort();
    check(
      checks,
      "schedule (opponent, week, side)",
      mine.length,
      realMine.length,
      mine.length === realMine.length && mine.every((x, i) => x === realMine[i]),
      "the real schedule, all 17 games",
    );
    // The head coach: the staffs file's.
    const hc = league.coaches.find((c) => c.teamId === team.id && c.role === "HC");
    const ourName = hc ? `${hc.firstName} ${hc.lastName}` : "none";
    check(
      checks,
      "head coach",
      ourName,
      f.headCoach.get(team.id) ?? "none",
      ourName === f.headCoach.get(team.id),
      "the end-of-regular-season staff (the sim runs the offseason's changes)",
    );
    teams.push({ teamId: team.id, checks, ok: checks.every((c) => c.ok || c.explained) });
  }

  const leagueChecks: DayOneCheck[] = [];
  const problems = validateSchedule(
    league.rules,
    season,
    league.teams,
    league.games,
    new Map((league.history.at(-1)?.standings ?? []).map((s) => [s.teamId, s.divisionRank])),
  );
  check(
    leagueChecks,
    "schedule follows the rules file",
    problems.length,
    0,
    problems.length === 0,
    problems.slice(0, 3).join("; "),
  );
  const legal = rosterProblems(league);
  check(
    leagueChecks,
    "rosters and cap legal",
    legal.length,
    0,
    legal.length === 0,
    legal.slice(0, 3).join("; "),
  );
  check(leagueChecks, "teams", league.teams.length, 32, league.teams.length === 32);
  check(
    leagueChecks,
    "regular-season games",
    league.games.filter((g) => g.round === "regular").length,
    272,
    league.games.filter((g) => g.round === "regular").length === 272,
  );

  const passed = teams.filter((t) => t.checks.every((c) => c.ok)).length;
  const explained = teams.filter((t) => t.ok).length - passed;
  const lines = [
    "## Day One validation",
    "",
    `${passed} of ${teams.length} teams pass every check, and ${explained} more miss only where the reason is known (the cap page was archived on another day than the published figure). League-wide: ${leagueChecks.filter((c) => c.ok).length} of ${leagueChecks.length}.`,
    "",
    "Team | roster | cap space ($M) | 2026 picks | 2027 picks | contracts | schedule | head coach",
    "--- | --- | --- | --- | --- | --- | --- | ---",
    ...teams.map((t) => {
      const c = (name: string) => {
        const x = t.checks.find((y) => y.name.startsWith(name));
        return x ? `${x.ok ? "✓" : "✗"} ${x.ours}/${x.real}` : "";
      };
      return `${t.teamId} | ${c("roster")} | ${c("cap")} | ${c(`${season} picks`)} | ${c(`${season + 1} picks`)} | ${c("contracts")} | ${c("schedule")} | ${c("head")}`;
    }),
    "",
    "League-wide:",
    ...leagueChecks.map(
      (c) =>
        `- ${c.ok ? "✓" : "✗"} ${c.name}: ${c.ours} (want ${c.real})${c.ok || !c.note ? "" : ` — ${c.note}`}`,
    ),
    "",
    "Misses:",
    ...teams.flatMap((t) =>
      t.checks
        .filter((c) => !c.ok)
        .map((c) => `- ${t.teamId}, ${c.name}: ${c.ours} against ${c.real}. ${c.note}`),
    ),
  ];
  return { teams, league: leagueChecks, passed, explained, lines };
}
