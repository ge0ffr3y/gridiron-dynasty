/**
 * `npm run pipeline -- league`: builds the real league (Phase 6) from public
 * nflverse data and the private Madden ratings file.
 *
 *   download -> rosters and bios -> Madden match -> ratings -> fictional names
 *   -> coaches -> the real 2025 season -> assemble -> check -> write
 *
 * Outputs go to pipeline/private/out/ (git-ignored): the league file, and a
 * report of anything that couldn't be matched. The league file holds no real
 * names; the report does, and never leaves this machine.
 */
import { realCoachCareer, realCoachStyle } from "./coachStyles";
import { realFrontOffices, realGmNames } from "./frontOffices";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import draftData from "../../../calibration/draft.json";
import { join } from "node:path";
import {
  assembleRealLeague,
  fingerprint,
  NamePicker,
  overallAt,
  parseLeague,
  POSITIONS,
  Rng,
  serializeLeague,
  streamSeed,
  TRAIT_MEAN,
  TRAIT_SPREAD,
  type CoachRole,
  type League,
  type RealCoachInput,
  type RealPlayerInput,
  type RealProspectInput,
  type Position,
} from "@fgm/sim-core";
import { readCsv, ROOT } from "../matchups";
import { CACHE } from "../matchups";
import {
  COACHES_FILE,
  download,
  leagueTeam,
  maddenRows,
  OUT,
  OVERRIDES_FILE,
  privateCsv,
  rows,
  SEASON,
} from "./inputs";
import { careers, FIRST_STATS_SEASON, injuryHistory, injuryTraits, rescaleTraits } from "./careers";
import { fetchTeamPages, matchPages, readTeamPages } from "./capPages";
import { capSnapshot, contractAtStart, readContracts, teamNameMap } from "./contracts";
import { matchMadden, parseMadden } from "./madden";
import { validateCaps, type CapValidation } from "./validate";
import { fictionalCollege, Renamer } from "./names";
import { adjustForPerformance, adjustForTeamResults, defenseByPfr } from "./performance";
import { alignSpecialists, buildRatings } from "./ratings";
import { buildRoster, experienceAfter, mapPosition } from "./roster";
import { sanitySheet } from "./sanity";
import { seasonGames } from "./season";

/** The base league's seed. Each new real league in the app gets its own seed on top. */
export const REAL_LEAGUE_SEED = 2026;
export const LEAGUE_FILE = join(OUT, "real-league-2026.json");
/** Where the dev server serves it from (git-ignored). */
export const WEB_COPY = join(ROOT, "apps", "web", "public", "private", "real-league-2026.json");

export async function buildLeague(): Promise<{
  league: League;
  report: string[];
  sheet: string;
  validation: CapValidation;
}> {
  await download();
  const report: string[] = [];
  const [rosterRows, players, stats, snaps, games] = await Promise.all([
    rows("rosters"),
    rows("players"),
    rows("stats"),
    rows("snaps"),
    rows("games"),
  ]);
  const touchdowns = new Map<string, number>();
  await readCsv(join(CACHE, `play_by_play_${SEASON}.csv.gz`), (p) => {
    if (p.touchdown === "1" && p.td_team) {
      const key = `${p.game_id}|${p.td_team}`;
      touchdowns.set(key, (touchdowns.get(key) ?? 0) + 1);
    }
  });

  // Who's in the league.
  const roster = buildRoster({
    rosters: rosterRows,
    players,
    stats,
    snaps,
    archetypeOf: () => undefined,
  });
  const people = roster.people;
  report.push(
    `## Players`,
    `${people.length} players (${people.filter((p) => p.teamId === null).length} free agents).`,
  );

  // Madden ratings, matched by last name and birth date (then full name).
  const overrides = new Map(
    (await privateCsv(OVERRIDES_FILE))
      .filter((o) => o.madden_row && o.gsis)
      .map((o) => [Number(o.madden_row), o.gsis!] as [number, string]),
  );
  const maddenData = await maddenRows();
  const madden = maddenData
    ? matchMadden(parseMadden(maddenData), people, overrides)
    : { byGsis: new Map(), unmatchedMadden: [] };
  // Madden's archetype settles edge rusher vs. off-ball linebacker.
  for (const p of people) {
    const m = madden.byGsis.get(p.gsis);
    if (m) p.position = mapPosition(p.rawPosition, p.weightLb, m.archetype) ?? p.position;
  }

  const ratings = buildRatings(people, madden.byGsis);
  const specialistMoves = alignSpecialists(people, ratings);
  // Move start-of-season ratings toward how each regular actually played in 2025.
  const adjustments = adjustForPerformance(people, ratings.ratings, {
    stats,
    defense: defenseByPfr(await rows("defense"), SEASON),
    ngsRushing: (await rows("ngsRushing")).filter(
      (r) => Number(r.season) === SEASON && r.season_type === "REG" && r.week === "0",
    ),
  });
  report.push(
    `Kickers and punters lined up with the engine's average kicker: ${Object.entries(
      specialistMoves,
    )
      .map(([k, v]) => `${k} ${v >= 0 ? "+" : ""}${v}`)
      .join(", ")}.`,
  );
  report.push(
    `Ratings: ${ratings.fromMadden} from Madden, ${ratings.generated} generated from 2025 role and draft position.`,
  );
  // Team results: regulars on teams that did better than their ratings move up, and vice versa.
  const differential = new Map<string, number>();
  for (const g of seasonGames(games, touchdowns).filter((g) => g.round === "regular")) {
    differential.set(
      g.homeId,
      (differential.get(g.homeId) ?? 0) + (g.homeScore - g.awayScore) / 17,
    );
    differential.set(
      g.awayId,
      (differential.get(g.awayId) ?? 0) + (g.awayScore - g.homeScore) / 17,
    );
  }
  const teamShift = adjustForTeamResults(people, ratings.ratings, differential);
  report.push(
    `Team results moved regulars by ${Math.min(...teamShift.values()).toFixed(1)} to +${Math.max(...teamShift.values()).toFixed(1)} overall.`,
  );

  // Real careers and injury history.
  const career = await careers(new Set(people.map((p) => p.gsis)));
  const injuries = injuryHistory(
    [
      ...(await rows("injuries2023")),
      ...(await rows("injuries2024")),
      ...(await rows("injuries2025")),
    ],
    rosterRows,
  );
  report.push(
    `Career stats for ${career.size} players (seasons since ${FIRST_STATS_SEASON}); injury history for ${injuries.size}.`,
  );

  // Injury traits from history, on the generated players' scale.
  const traits = new Map(
    people.map((p) => [
      p.gsis,
      injuryTraits(injuries.get(p.gsis), {
        injury: madden.byGsis.get(p.gsis)?.values.injury,
        toughness: madden.byGsis.get(p.gsis)?.values.toughness,
      }),
    ]),
  );
  rescaleTraits(traits, {
    injuryProneness: [TRAIT_MEAN - 10, TRAIT_SPREAD],
    durability: [TRAIT_MEAN, TRAIT_SPREAD],
  });

  // Real contracts as of Feb 9, 2026, and each team's published dead money and carryover.
  const contractRows = await readContracts();
  const contractNames = teamNameMap(people, contractRows);
  const pages = readTeamPages(await fetchTeamPages());
  const matched = matchPages(people, pages);
  const imported = new Map(
    people.map((p) => [
      p.gsis,
      contractAtStart(
        p,
        matched.byPlayer.get(p.gsis),
        contractRows.get(p.gsis) ?? [],
        contractNames,
      ),
    ]),
  );
  const snapshot = capSnapshot();
  const kinds = { page: 0, voided: 0, pending: 0, none: 0 };
  for (const p of people) if (p.teamId) kinds[imported.get(p.gsis)!.kind] += 1;
  report.push(
    `Contracts: ${kinds.page} from the teams' archived cap pages (${pages.size} teams), ${kinds.pending + kinds.voided} pending free agents (${kinds.voided} of them with void years still charging their team). ${matched.unmatched.length} page rows matched no one on our rosters. ${matched.released.size} players released before their team's page date start as free agents.`,
  );
  const validation = validateCaps(people, imported, snapshot, pages, matched);

  const missingStarters = people.filter(
    (p) =>
      p.teamId !== null &&
      !madden.byGsis.has(p.gsis) &&
      p.position !== "LS" &&
      Math.max(p.snapShare.offense, p.snapShare.defense) >= 0.5,
  );

  // Fictional names. Real names never leave this function except in the private report.
  const realCoaches = await privateCsv(COACHES_FILE);
  const renamer = new Renamer(players, [
    ...realCoaches.map((c) => c.name ?? ""),
    // The real GMs too (Phase 13): generated executives must not share their names.
    ...realGmNames(),
  ]);
  const playerInputs: RealPlayerInput[] = people.map((p) => ({
    key: p.gsis,
    ...renamer.name(p.gsis),
    position: p.position,
    // Released between the league's start and his team's page date: a free agent.
    teamId: matched.released.has(p.gsis) ? null : p.teamId,
    jersey: Math.min(99, Math.max(0, p.jersey)),
    birthDate: p.birthDate,
    heightIn: p.heightIn,
    weightLb: p.weightLb,
    experience: experienceAfter(p),
    college: fictionalCollege(p.college),
    drafted: p.draft,
    ratings: ratings.ratings.get(p.gsis)!,
    contractThrough: null,
    hidden: traits.get(p.gsis)!,
    stats: career.get(p.gsis) ?? [],
    contract: imported.get(p.gsis)!.contract,
    voidedProration: imported.get(p.gsis)!.voidedProration,
  }));
  const coachInputs: RealCoachInput[] = realCoaches.map((c) => ({
    key: `coach:${c.team}:${c.role}`,
    ...renamer.name(`coach:${c.team}:${c.role}`),
    role: c.role as CoachRole,
    teamId: leagueTeam(c.team!),
    birthDate: null,
    experience: null,
    style: realCoachStyle(c.role!, c.team!, c.name ?? ""),
    // Head coaches' real careers as head coaches (seasons and records since 2000).
    career: c.role === "HC" ? realCoachCareer(c.name ?? "", leagueTeam) : [],
  }));
  report.push(
    `${coachInputs.length} real coaches (head coaches and coordinators) from end-of-2025 staffs; ${coachInputs.filter((c) => c.style).length} with tendencies measured from their real teams.`,
  );

  // The real 2026 draft class (npm run pipeline -- draft), renamed like everyone else, and the
  // real 2026 draft order (who owned each pick on draft day, compensatory picks included).
  const prospectInputs = realProspects(renamer);
  const draftOrder2026 = realDraftOrder();
  report.push(
    prospectInputs.length > 0
      ? `Draft class: ${prospectInputs.length} real 2026 prospects (${prospectInputs.filter((p) => p.pick).length} drafted, ${prospectInputs.filter((p) => p.invited).length} at the combine); the rest of the pool is generated.`
      : "Draft class: no class-2026.json (run npm run pipeline -- draft); the class is generated.",
  );

  // Front offices (Phase 13): measured habits of the 2025 GMs and owners (private).
  const fronts = realFrontOffices();
  report.push(
    fronts
      ? `Front offices: ${Object.keys(fronts).length} GMs with knobs measured from their teams' trades, draft-day moves and dead money; owners' patience from head-coach turnover since 2000.`
      : "Front offices: no front-office-habits.json (run npm run pipeline -- frontoffice); GMs and owners are generated.",
  );

  const league = assembleRealLeague({
    name: "Real league",
    seed: REAL_LEAGUE_SEED,
    season: SEASON,
    source:
      `Built by the pipeline from nflverse data (CC-BY-4.0): end-of-${SEASON} rosters, bios, snap counts and scores; ` +
      `coaching staffs from public team season pages; ratings from a private Madden file mapped onto our scale. Every name is fictional.`,
    players: playerInputs,
    coaches: coachInputs,
    games: seasonGames(games, touchdowns),
    names: new NamePicker(new Rng(streamSeed(REAL_LEAGUE_SEED, "generated-names"))),
    prospects: prospectInputs,
    draftOrder: draftOrder2026,
    ...(fronts ? { frontOffices: fronts } : {}),
    ...(snapshot
      ? {
          teamCaps: Object.fromEntries(
            [...snapshot].map(([id, f]) => {
              // Dead money by season from the team's page; the cap-space table's 2026 figure otherwise.
              const gone = pages.get(id)?.gone;
              const bySeason = new Map<number, number>();
              for (const g of gone ?? [])
                bySeason.set(g.season, (bySeason.get(g.season) ?? 0) + g.capNumber);
              const deadMoney = gone
                ? [...bySeason].map(([season, amount]) => ({ season, amount }))
                : [{ season: 2026, amount: f.deadMoney }];
              return [id, { deadMoney, carryover: Math.max(0, f.carryover) }];
            }),
          ),
        }
      : {}),
  });

  // The real-name check: generated people (special teams coaches, scouts) too.
  let fixed = 0;
  for (const person of [
    ...league.players,
    ...league.coaches,
    ...league.prospects,
    ...league.agents,
    ...league.executives,
  ]) {
    if (!renamer.isReal(person.firstName, person.lastName)) continue;
    Object.assign(
      person,
      renamer.name(
        `fix:${"gm" in person ? "executive" : "role" in person ? "coach" : "draftYear" in person ? "prospect" : "agency" in person ? "agent" : "player"}:${person.id}`,
      ),
    );
    fixed += 1;
  }
  const stillReal = [
    ...league.players,
    ...league.coaches,
    ...league.prospects,
    ...league.agents,
    ...league.executives,
  ].filter((p) => renamer.isReal(p.firstName, p.lastName));
  if (stillReal.length > 0) throw new Error(`${stillReal.length} real names survived renaming`);
  report.push(
    `Real-name check: 0 real names in the league (${renamer.clashes + fixed} drawn names matched a real person and were redrawn).`,
  );

  // Rosters by team and position, for a quick look.
  report.push(
    "",
    "## Rosters",
    "",
    `| Team | Players | ${POSITIONS.join(" | ")} |`,
    `|---|---|${POSITIONS.map(() => "---").join("|")}|`,
  );
  for (const team of league.teams) {
    const list = league.players.filter((p) => p.teamId === team.id);
    report.push(
      `| ${team.id} | ${list.length} | ${POSITIONS.map((pos) => list.filter((p) => p.position === pos).length).join(" | ")} |`,
    );
  }

  // Biggest moves from 2025 performance (real names: private).
  const named = new Map(people.map((p) => [p.gsis, p]));
  const moves = [...adjustments].sort((a, b) => b.after - b.before - (a.after - a.before));
  const line = (a: (typeof adjustments)[number]) => {
    const p = named.get(a.gsis)!;
    return `- ${p.otherFirst[0] || p.realFirst} ${p.realLast} (${p.teamId ?? "FA"} ${a.position}): ${a.before} -> ${a.after} (2025 play says ${a.implied})`;
  };
  report.push(
    "",
    "## 2025 performance",
    "",
    `${adjustments.length} regulars scored on 2025 production. Biggest risers:`,
    ...moves.slice(0, 25).map(line),
    "",
    "Biggest fallers:",
    ...moves.slice(-25).reverse().map(line),
  );

  // The cap validation report: imported contracts vs. the published Feb 10, 2026 figures.
  report.push("", ...validation.lines);

  // The unmatched report (real names: private).
  report.push("", "## Unmatched", "", `Roster rows skipped: ${roster.problems.length}`);
  for (const line of roster.problems) report.push(`- ${line}`);
  report.push(
    "",
    `Starters (half or more of their team's snaps) with no Madden entry: ${missingStarters.length}`,
  );
  for (const p of missingStarters)
    report.push(`- ${p.realFirst} ${p.realLast} (${p.teamId} ${p.position}, ${p.gsis})`);
  const onRosters = madden.unmatchedMadden.filter((m) =>
    people.some((p) => p.realLast.toLowerCase() === m.last.toLowerCase()),
  );
  report.push(
    "",
    `Madden entries not matched: ${madden.unmatchedMadden.length} (most were cut or retired before season's end; ${onRosters.length} share a last name with a rostered player and are worth a look):`,
  );
  for (const m of onRosters)
    report.push(
      `- row ${m.row}: ${m.first} ${m.last} (${m.team}, ${m.position}, born ${m.birthDate})`,
    );

  // Check it round-trips like any save, then write it.
  const text = serializeLeague(league);
  if (serializeLeague(parseLeague(text)) !== text)
    throw new Error("the league file doesn't round-trip");
  report.unshift(`# Real league build`, "", `Fingerprint ${fingerprint(text)}.`, "");
  const keyByName = new Map(
    league.players.map((p) => [`${p.firstName} ${p.lastName}`, ""] as [string, string]),
  );
  for (const input of playerInputs)
    keyByName.set(`${input.firstName} ${input.lastName}`, input.key);
  const sheet = sanitySheet({
    league,
    people,
    madden: madden.byGsis,
    adjustments,
    stats,
    games,
    keyByName,
  });
  return { league, report, sheet, validation };
}

export async function league(): Promise<void> {
  const { league, report, sheet, validation } = await buildLeague();
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "sanity.html"), sheet);
  // The cap validation's numbers, for the local tests (no names).
  writeFileSync(
    join(OUT, "cap-validation.json"),
    JSON.stringify(
      {
        contracts: validation.reproduced + validation.mismatches.length,
        reproduced: validation.reproduced,
        withinTen:
          validation.reproduced +
          validation.mismatches.filter((x) => Math.abs(x.ours - x.page) <= 10).length,
        yearByYear: validation.yearByYear,
        teams: validation.teams.map(({ teamId, difference, withinTolerance, why }) => ({
          teamId,
          difference,
          withinTolerance,
          why,
        })),
      },
      null,
      2,
    ) + "\n",
  );
  writeFileSync(LEAGUE_FILE, serializeLeague(league));
  writeFileSync(join(OUT, "report.md"), report.join("\n") + "\n");
  mkdirSync(join(WEB_COPY, ".."), { recursive: true });
  copyFileSync(LEAGUE_FILE, WEB_COPY);
  const top = league.players
    .filter((p) => p.teamId !== null)
    .sort((a, b) => overallAt(b.ratings, b.position) - overallAt(a.ratings, a.position))
    .slice(0, 5)
    .map((p) => `${p.position} ${overallAt(p.ratings, p.position)}`);
  console.log(report.slice(0, 12).join("\n"));
  console.log(`Top overalls: ${top.join(", ")}`);
  console.log(`Wrote ${LEAGUE_FILE} (and a copy for the web app), and ${join(OUT, "report.md")}.`);
}

/** The real 2026 class from the draft step's private file, renamed, with fictional schools. */
function realProspects(renamer: Renamer): RealProspectInput[] {
  const file = join(OUT, "class-2026.json");
  if (!existsSync(file)) return [];
  type Row = {
    key: string;
    position: Position;
    school: string | null;
    age: number | null;
    heightIn: number | null;
    weightLb: number | null;
    drills: Record<string, number | null>;
    invited: boolean;
    pick: { overall: number } | null;
  };
  const rows = (JSON.parse(readFileSync(file, "utf8")) as Row[]).sort((a, b) =>
    a.key.localeCompare(b.key),
  );
  const sizes = draftData.combine.measurables as unknown as Record<
    string,
    { ht: { mean: number }; wt: { mean: number } }
  >;
  return rows.map((r) => ({
    key: r.key,
    ...renamer.name(`prospect:${r.key}`),
    position: r.position,
    college: fictionalCollege(r.school ?? ""),
    age: r.age,
    // Drafted players who skipped the combine: a typical size at the position.
    heightIn: r.heightIn ?? Math.round(sizes[r.position]?.ht.mean ?? 74),
    weightLb: r.weightLb ?? Math.round(sizes[r.position]?.wt.mean ?? 240),
    drills: {
      forty: r.drills["forty"] ?? null,
      bench: r.drills["bench"] ?? null,
      vertical: r.drills["vertical"] ?? null,
      broadJump: r.drills["broad_jump"] ?? null,
      cone: r.drills["cone"] ?? null,
      shuttle: r.drills["shuttle"] ?? null,
    },
    invited: r.invited,
    pick: r.pick?.overall ?? null,
  }));
}

/** Pro Football Reference team codes (the draft data's) that differ from this league's ids. */
const PFR_TEAM: Record<string, string> = {
  GNB: "GB",
  KAN: "KC",
  LVR: "LV",
  NOR: "NO",
  NWE: "NE",
  SFO: "SF",
  TAM: "TB",
};

/** The real 2026 draft: every pick's number, round and the club that made it. */
function realDraftOrder(): { overall: number; round: number; teamId: string }[] {
  const file = join(OUT, "class-2026.json");
  if (!existsSync(file)) return [];
  const rows = JSON.parse(readFileSync(file, "utf8")) as {
    pick: { round: number; overall: number; team: string } | null;
  }[];
  return rows
    .flatMap((r) => (r.pick ? [r.pick] : []))
    .sort((a, b) => a.overall - b.overall)
    .map((p) => ({
      overall: p.overall,
      round: p.round,
      teamId: leagueTeam(PFR_TEAM[p.team] ?? p.team),
    }));
}
