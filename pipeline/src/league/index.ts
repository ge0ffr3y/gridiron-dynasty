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
import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
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
import { matchMadden, parseMadden } from "./madden";
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

export async function buildLeague(): Promise<{ league: League; report: string[]; sheet: string }> {
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

  const missingStarters = people.filter(
    (p) =>
      p.teamId !== null &&
      !madden.byGsis.has(p.gsis) &&
      p.position !== "LS" &&
      Math.max(p.snapShare.offense, p.snapShare.defense) >= 0.5,
  );

  // Fictional names. Real names never leave this function except in the private report.
  const realCoaches = await privateCsv(COACHES_FILE);
  const renamer = new Renamer(
    players,
    realCoaches.map((c) => c.name ?? ""),
  );
  const playerInputs: RealPlayerInput[] = people.map((p) => ({
    key: p.gsis,
    ...renamer.name(p.gsis),
    position: p.position,
    teamId: p.teamId,
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
  }));
  const coachInputs: RealCoachInput[] = realCoaches.map((c) => ({
    key: `coach:${c.team}:${c.role}`,
    ...renamer.name(`coach:${c.team}:${c.role}`),
    role: c.role as CoachRole,
    teamId: leagueTeam(c.team!),
    birthDate: null,
    experience: null,
  }));
  report.push(
    `${coachInputs.length} real coaches (head coaches and coordinators) from end-of-2025 staffs.`,
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
  });

  // The real-name check: generated people (special teams coaches, scouts) too.
  let fixed = 0;
  for (const person of [...league.players, ...league.coaches]) {
    if (!renamer.isReal(person.firstName, person.lastName)) continue;
    Object.assign(
      person,
      renamer.name(`fix:${"role" in person ? "coach" : "player"}:${person.id}`),
    );
    fixed += 1;
  }
  const stillReal = [...league.players, ...league.coaches].filter((p) =>
    renamer.isReal(p.firstName, p.lastName),
  );
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
  return { league, report, sheet };
}

export async function league(): Promise<void> {
  const { league, report, sheet } = await buildLeague();
  writeFileSync(join(OUT, "sanity.html"), sheet);
  mkdirSync(OUT, { recursive: true });
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
