/**
 * Real-NFL injury numbers (Phase 9b) from nflverse (CC-BY-4.0): the weekly
 * injury reports, weekly rosters and snap counts, 2016-2025 (2020 left out:
 * its COVID lists mix with injuries). Names are only used in memory.
 *
 * An injury "episode" starts when a player is listed Out, Doubtful or
 * Questionable with a body part, and lasts while he stays listed with that
 * part or sits on injured reserve. Games missed = his team's games he didn't
 * play in during the episode (from snap counts). Players moved straight to
 * injured reserve never appear on a report: their body part is unknown, so
 * each severity's body-part mix comes from the episodes where it is known.
 *
 * Writes calibration/injuries.json:
 * - body parts by severity (games missed);
 * - report statuses per team-week and how often each status still plays;
 * - reinjury: how much a return from an injury raises the chance of another;
 * - episodes per team-season (how many injuries cost games);
 * - injured-reserve placements per team-season, and the reserve lists at Week 1.
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { ensure, readCsv, RELEASE, ROOT, round } from "./matchups";

const SEASONS = [2016, 2017, 2018, 2019, 2021, 2022, 2023, 2024, 2025];
/** Severity buckets (games missed), as in calibration/people.json. */
const BUCKETS = ["0", "1", "2", "3", "4-5", "6-8", "9+"] as const;
/** Injuries this late can't show a full games-missed count, so they're left out of severity. */
const MIN_GAMES_LEFT = 9;
/** Weeks after a return in which a new injury counts as a reinjury. */
const REINJURY_WINDOW = 8;
/** Body parts kept by name; the rest are "Other". */
const KEEP_PARTS = 18;
/** Weekly-roster status codes (nflverse status_description_abbr). */
const IR_CODES = new Set(["R01", "R48"]);
const PUP_CODE = "R04";
const NFI_CODE = "R05";

function bucketOf(games: number): string {
  if (games <= 3) return String(games);
  if (games <= 5) return "4-5";
  if (games <= 8) return "6-8";
  return "9+";
}

/** A report's body part in a standard spelling, or null if it isn't an injury. */
function bodyPart(raw: string | undefined): string | null {
  const s = (raw ?? "").trim();
  if (!s || s === "NA") return null;
  const l = s.toLowerCase();
  if (
    l.startsWith("not injury") ||
    l.includes("illness") ||
    l.includes("personal") ||
    l.includes("rest") ||
    l.includes("covid") ||
    l === "nir" ||
    l.includes("coach")
  )
    return null;
  const first = s.split(/[,/]/)[0]!.trim();
  const word = first.charAt(0).toUpperCase() + first.slice(1).toLowerCase();
  const SAME: Record<string, string> = {
    Rib: "Ribs",
    Quadricep: "Quadriceps",
    Quad: "Quadriceps",
    Hamstrings: "Hamstring",
    Ankles: "Ankle",
    Knees: "Knee",
    "Right knee": "Knee",
    "Left knee": "Knee",
    Head: "Concussion",
    Calves: "Calf",
    Abdominal: "Abdomen",
    Pec: "Pectoral",
  };
  return SAME[word] ?? word;
}

interface Episode {
  gsis: string;
  season: number;
  team: string;
  part: string | null;
  start: number;
  end: number;
  missed: number;
  ir: boolean;
  /** Team games left in the season when it started (including that week's). */
  gamesLeft: number;
  /** Still going when the season ended. */
  open: boolean;
}

const STATUSES = ["Out", "Doubtful", "Questionable"] as const;

/** nflverse has some years only as plain CSV: try the gzipped file, then the plain one. */
async function ensureEither(release: string, name: string): Promise<string> {
  try {
    return await ensure(`${name}.csv.gz`, `${RELEASE}/${release}/${name}.csv.gz`);
  } catch {
    return await ensure(`${name}.csv`, `${RELEASE}/${release}/${name}.csv`);
  }
}

export async function injuries(): Promise<void> {
  const players = new Map<string, string>(); // gsis -> pfr
  await readCsv(await ensure("players.csv.gz", `${RELEASE}/players/players.csv.gz`), (r) => {
    if (r["gsis_id"] && r["pfr_id"]) players.set(r["gsis_id"], r["pfr_id"]);
  });

  const episodes: Episode[] = [];
  const statusCount = new Map<string, number>();
  const statusPlayed = new Map<string, number>();
  let teamWeeks = 0;
  let teamSeasons = 0;
  let activePlayerWeeks = 0;
  const startsByPart = new Map<string, number>();
  const irDuring: number[] = [];
  const irWeek1: number[] = [];
  const pupWeek1: number[] = [];
  const nfiWeek1: number[] = [];

  for (const season of SEASONS) {
    console.log(`Reading ${season}...`);
    // Snap counts: who played each week, and which teams played.
    const played = new Set<string>();
    const teamPlayed = new Set<string>();
    await readCsv(await ensureEither("snap_counts", `snap_counts_${season}`), (r) => {
      if (r["game_type"] !== "REG") return;
      teamPlayed.add(`${r["team"]}|${r["week"]}`);
      const snaps =
        Number(r["offense_snaps"] || 0) +
        Number(r["defense_snaps"] || 0) +
        Number(r["st_snaps"] || 0);
      if (snaps > 0) played.add(`${r["pfr_player_id"]}|${r["week"]}`);
    });
    const weeks = Math.max(...[...teamPlayed].map((k) => Number(k.split("|")[1])));
    const teams = [...new Set([...teamPlayed].map((k) => k.split("|")[0]!))].sort();
    teamWeeks += teamPlayed.size;
    teamSeasons += teams.length;
    const gamesLeftFrom = (team: string, week: number) => {
      let n = 0;
      for (let w = week; w <= weeks; w++) if (teamPlayed.has(`${team}|${w}`)) n += 1;
      return n;
    };

    // Final injury report per player-week.
    const report = new Map<string, { part: string | null; status: string; team: string }>();
    await readCsv(await ensureEither("injuries", `injuries_${season}`), (r) => {
      if (r["game_type"] !== "REG") return;
      const status = r["report_status"] ?? "";
      if (!(STATUSES as readonly string[]).includes(status)) return;
      report.set(`${r["gsis_id"]}|${r["week"]}`, {
        part: bodyPart(r["report_primary_injury"]),
        status,
        team: r["team"] ?? "",
      });
    });

    // Weekly rosters: each player's team and list each week.
    const roster = new Map<string, { team: string; status: string; code: string }>();
    const ids = new Set<string>();
    await readCsv(await ensureEither("weekly_rosters", `roster_weekly_${season}`), (r) => {
      if (r["game_type"] !== "REG" || !r["gsis_id"]) return;
      roster.set(`${r["gsis_id"]}|${r["week"]}`, {
        team: r["team"] ?? "",
        status: r["status"] ?? "",
        code: r["status_description_abbr"] ?? "",
      });
      ids.add(r["gsis_id"]);
    });

    // Reserve lists: on injured reserve at some point (first team), and at Week 1.
    const irTeam = new Map<string, string>();
    const week1 = {
      ir: new Map<string, number>(),
      pup: new Map<string, number>(),
      nfi: new Map<string, number>(),
    };
    for (const id of [...ids].sort()) {
      for (let w = 1; w <= weeks; w++) {
        const row = roster.get(`${id}|${w}`);
        if (!row) continue;
        if (w === 1) {
          const add = (m: Map<string, number>) => m.set(row.team, (m.get(row.team) ?? 0) + 1);
          if (IR_CODES.has(row.code)) add(week1.ir);
          if (row.code === PUP_CODE) add(week1.pup);
          if (row.code === NFI_CODE) add(week1.nfi);
        }
        if (IR_CODES.has(row.code) && !irTeam.has(id)) irTeam.set(id, `${row.team}|${w}`);
      }
    }
    for (const team of teams) {
      irWeek1.push(week1.ir.get(team) ?? 0);
      pupWeek1.push(week1.pup.get(team) ?? 0);
      nfiWeek1.push(week1.nfi.get(team) ?? 0);
      irDuring.push(
        [...irTeam.values()].filter((v) => v.startsWith(`${team}|`) && !v.endsWith("|1")).length,
      );
    }

    // Statuses: how many per team-week, and how often each still played.
    for (const [key, rep] of report) {
      const [gsis, week] = key.split("|") as [string, string];
      if (rep.part === null || !teamPlayed.has(`${rep.team}|${week}`)) continue;
      statusCount.set(rep.status, (statusCount.get(rep.status) ?? 0) + 1);
      const pfr = players.get(gsis);
      if (pfr && played.has(`${pfr}|${week}`))
        statusPlayed.set(rep.status, (statusPlayed.get(rep.status) ?? 0) + 1);
    }

    // Episodes, player by player, week by week.
    for (const gsis of [...ids].sort()) {
      const pfr = players.get(gsis);
      let open: Episode | null = null;
      let wasActive = false;
      const close = (week: number) => {
        if (open) {
          open.end = week - 1;
          episodes.push(open);
        }
        open = null;
      };
      for (let w = 1; w <= weeks; w++) {
        const row = roster.get(`${gsis}|${w}`);
        const rep = report.get(`${gsis}|${w}`);
        // A bye week (no roster row, no report) changes nothing.
        if (!row && !rep) continue;
        const team = rep?.team ?? row?.team ?? "";
        const teamGame = teamPlayed.has(`${team}|${w}`);
        const sat = teamGame && !(pfr && played.has(`${pfr}|${w}`));
        const onIr = row !== undefined && IR_CODES.has(row.code);
        const ep = open as Episode | null;
        if (rep && rep.part !== null) {
          if (ep && (ep.part === rep.part || ep.part === null)) {
            ep.part = rep.part;
            if (sat) ep.missed += 1;
          } else {
            close(w);
            open = {
              gsis,
              season,
              team,
              part: rep.part,
              start: w,
              end: w,
              missed: sat ? 1 : 0,
              ir: false,
              gamesLeft: gamesLeftFrom(team, w),
              open: false,
            };
            startsByPart.set(rep.part, (startsByPart.get(rep.part) ?? 0) + 1);
          }
        } else if (onIr) {
          if (ep) {
            ep.ir = true;
            if (teamGame) ep.missed += 1;
          } else if (wasActive) {
            // Straight to injured reserve: hurt, but never on a report.
            open = {
              gsis,
              season,
              team,
              part: null,
              start: w,
              end: w,
              missed: teamGame ? 1 : 0,
              ir: true,
              gamesLeft: gamesLeftFrom(team, w),
              open: false,
            };
          }
        } else close(w);
        const active = row?.status === "ACT";
        if (active && !open) activePlayerWeeks += 1;
        wasActive = active;
      }
      if (open) {
        (open as Episode).open = true;
        close(weeks + 1);
      }
    }
  }

  // Body parts: the most common by name, the rest as Other; mix within each severity.
  const parts = [...startsByPart]
    .sort((a, b) => b[1] - a[1])
    .slice(0, KEEP_PARTS)
    .map(([p]) => p);
  const named = (p: string | null) => (p === null ? null : parts.includes(p) ? p : "Other");
  const severe = episodes.filter((e) => e.gamesLeft >= MIN_GAMES_LEFT);
  const byBucket: Record<string, Record<string, number>> = {};
  const bucketShares: Record<string, number> = {};
  for (const b of BUCKETS) {
    const inBucket = severe.filter((e) => bucketOf(e.missed) === b);
    bucketShares[b] = round(inBucket.length / severe.length, 4);
    const known = inBucket.filter((e) => e.part !== null);
    const counts = new Map<string, number>();
    for (const e of known) counts.set(named(e.part)!, (counts.get(named(e.part)!) ?? 0) + 1);
    byBucket[b] = Object.fromEntries(
      [...counts].sort((x, y) => y[1] - x[1]).map(([p, n]) => [p, round(n / known.length, 4)]),
    );
  }
  const unknownShare = (b: string) => {
    const inBucket = severe.filter((e) => bucketOf(e.missed) === b);
    return round(inBucket.filter((e) => e.part === null).length / Math.max(1, inBucket.length), 3);
  };

  // Reinjury: after returning from an injury that cost games, a new one within the window.
  const byPlayer = new Map<string, Episode[]>();
  for (const e of episodes) {
    const key = `${e.gsis}|${e.season}`;
    byPlayer.set(key, [...(byPlayer.get(key) ?? []), e]);
  }
  const weeklyRate = (part: string) => (startsByPart.get(part) ?? 0) / activePlayerWeeks;
  const totalRate = [...startsByPart.values()].reduce((a, b) => a + b, 0) / activePlayerWeeks;
  let same = 0;
  let sameExpected = 0;
  let any = 0;
  let anyExpected = 0;
  let returns = 0;
  for (const list of byPlayer.values()) {
    list.sort((a, b) => a.start - b.start);
    list.forEach((e, i) => {
      if (e.open || e.missed < 1 || e.part === null) return;
      const back = e.end + 1;
      const next = list[i + 1];
      returns += 1;
      sameExpected += REINJURY_WINDOW * weeklyRate(e.part);
      anyExpected += REINJURY_WINDOW * totalRate;
      if (next && next.start - back < REINJURY_WINDOW) {
        any += 1;
        if (next.part === e.part) same += 1;
      }
    });
  }

  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
  const statuses = Object.fromEntries(
    STATUSES.map((s) => [
      s,
      {
        perTeamWeek: round((statusCount.get(s) ?? 0) / teamWeeks, 3),
        playRate: round((statusPlayed.get(s) ?? 0) / Math.max(1, statusCount.get(s) ?? 0), 3),
      },
    ]),
  );
  const out = {
    source:
      "nflverse injury reports, weekly rosters and snap counts, 2016-2019 and 2021-2025 regular seasons (CC-BY-4.0), built by `npm run pipeline -- injuries`.",
    note: "An episode starts when a player is listed Out, Doubtful or Questionable with a body part and lasts while he stays listed with it or sits on injured reserve; games missed are his team's games he didn't play. Illness and non-injury listings are left out. Players moved straight to injured reserve have no body part: each severity's mix comes from the episodes where it is known (unknownShare says how many weren't).",
    seasons: SEASONS,
    episodes: {
      perTeamSeason: round(episodes.length / teamSeasons, 2),
      costingGamesPerTeamSeason: round(
        episodes.filter((e) => e.missed >= 1).length / teamSeasons,
        2,
      ),
      severity: {
        note: `Games missed, for episodes starting with at least ${MIN_GAMES_LEFT} team games left.`,
        episodes: severe.length,
        shares: bucketShares,
      },
    },
    bodyParts: {
      parts: [...parts, "Other"],
      bySeverity: byBucket,
      unknownShare: Object.fromEntries(BUCKETS.map((b) => [b, unknownShare(b)])),
    },
    reinjury: {
      note: `After returning from an injury that cost games, a new injury within ${REINJURY_WINDOW} weeks, against the chance for any active player over the same span.`,
      windowWeeks: REINJURY_WINDOW,
      returns,
      samePartRelativeRisk: round(same / sameExpected, 2),
      anyPartRelativeRisk: round(any / anyExpected, 2),
    },
    statuses,
    reserve: {
      note: "Per team-season. Injured reserve includes designated-to-return; 'during the season' counts players first placed after Week 1.",
      injuredReserveAtWeek1: round(sum(irWeek1) / irWeek1.length, 2),
      injuredReserveDuringSeason: round(sum(irDuring) / irDuring.length, 2),
      pupAtWeek1: round(sum(pupWeek1) / pupWeek1.length, 2),
      nfiAtWeek1: round(sum(nfiWeek1) / nfiWeek1.length, 2),
    },
  };
  writeFileSync(join(ROOT, "calibration", "injuries.json"), JSON.stringify(out, null, 2) + "\n");
  console.log(
    `Wrote calibration/injuries.json: ${episodes.length} episodes, ${severe.length} with a full games-missed count.`,
  );
  console.log(
    `  Per team-season: ${out.episodes.perTeamSeason} episodes (${out.episodes.costingGamesPerTeamSeason} costing games); injured reserve ${out.reserve.injuredReserveAtWeek1} at Week 1 + ${out.reserve.injuredReserveDuringSeason} during the season.`,
  );
  console.log(
    `  Reinjury within ${REINJURY_WINDOW} weeks: same part x${out.reinjury.samePartRelativeRisk}, any part x${out.reinjury.anyPartRelativeRisk}.`,
  );
  for (const s of STATUSES)
    console.log(
      `  ${s}: ${statuses[s]!.perTeamWeek} per team-week, played ${(statuses[s]!.playRate * 100).toFixed(0)}%`,
    );
}
