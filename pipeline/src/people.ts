/**
 * Real-NFL numbers about people (Phase 4b): how playing time splits down the
 * depth chart, how often players get hurt in games and how long they miss,
 * and what real season leaderboards look like.
 *
 * Sources (nflverse, CC-BY-4.0): play-by-play 2022-2025 and participation
 * 2023-2025 (who was on the field for each snap). Player names in the raw
 * files are only used to match injuries to players in memory; the output has
 * no names, only league-wide numbers.
 *
 * Output: calibration/people.json.
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { smoothExpectedPoints } from "@fgm/game-engine";
import { CACHE, ensure, flag, num, readCsv, RELEASE, ROOT, round, type Row } from "./matchups";

const PBP_SEASONS = [2022, 2023, 2024, 2025];
const PARTICIPATION_SEASONS = [2023, 2024, 2025];
/** Leaderboard ranks to compare (1 = the leader). */
const RANKS = [1, 2, 3, 5, 10, 20, 32];
/** Qualifying for passer rating: 14 attempts per team game (17 games). */
const RATING_QUALIFIER = 14 * 17;

/** Position groups, matching the sim's depth chart groups. */
const GROUP: Record<string, string> = {
  QB: "QB",
  RB: "RB",
  FB: "FB",
  WR: "WR",
  TE: "TE",
  T: "OL",
  G: "OL",
  C: "OL",
  DE: "EDGE",
  OLB: "EDGE",
  DT: "DT",
  NT: "DT",
  ILB: "LB",
  MLB: "LB",
  LB: "LB",
  CB: "CB",
  FS: "S",
  SS: "S",
  DB: "S",
};
const RANK_DEPTH: Record<string, number> = {
  QB: 2,
  RB: 4,
  FB: 1,
  WR: 6,
  TE: 4,
  OL: 7,
  EDGE: 5,
  DT: 5,
  LB: 4,
  CB: 5,
  S: 4,
};
/** Games-missed buckets for injured players who don't return to the same game. */
const MISSED_BUCKETS = ["0", "1", "2", "3", "4-5", "6-8", "9+"] as const;
const bucketOf = (missed: number) =>
  missed <= 3 ? String(missed) : missed <= 5 ? "4-5" : missed <= 8 ? "6-8" : "9+";
/** Injuries this late can't show a full games-missed count, so they're left out of that table. */
const MIN_GAMES_LEFT = 9;

interface Side {
  ids: string[];
  positions: string[];
  numbers: string[];
}
interface Snap {
  team: string;
  offense: Side;
  defense: Side;
}

function side(ids?: string, positions?: string, numbers?: string): Side {
  const split = (v?: string) => (v ? v.split(";") : []);
  return { ids: split(ids), positions: split(positions), numbers: split(numbers) };
}

/** NFL passer rating. */
function passerRating(att: number, cmp: number, yds: number, td: number, int: number): number {
  const clamp = (v: number) => Math.max(0, Math.min(2.375, v));
  const a = clamp((cmp / att - 0.3) * 5);
  const b = clamp((yds / att - 3) * 0.25);
  const c = clamp((td / att) * 20);
  const d = clamp(2.375 - (int / att) * 25);
  return ((a + b + c + d) / 6) * 100;
}

interface StateRow {
  game: string;
  half: string;
  type: string;
  down: number;
  toGo: number;
  ytg: number;
  team: string;
  touchdownBy: string | null;
  safety: boolean;
  twoPoint: boolean;
}

/** Plays that show where the next down stands (as in the engine's EPA). */
const STATE_TYPES = new Set([
  "pass",
  "run",
  "punt",
  "field_goal",
  "no_play",
  "qb_kneel",
  "qb_spike",
]);

/** EPA of each run and dropback, the way the engine computes it (touchdown 7, safety -2, half end 0). */
function expectedPointsAdded(rows: StateRow[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < rows.length; i++) {
    const p = rows[i]!;
    if ((p.type !== "pass" && p.type !== "run") || p.twoPoint || !(p.down >= 1)) continue;
    const before = smoothExpectedPoints(p.down, p.toGo, p.ytg);
    let after = 0;
    if (p.touchdownBy) after = p.touchdownBy === p.team ? 7 : -7;
    else if (p.safety) after = -2;
    else {
      for (let j = i + 1; j < rows.length; j++) {
        const q = rows[j]!;
        if (q.game !== p.game || q.half !== p.half) break;
        if (!STATE_TYPES.has(q.type) || !(q.down >= 1) || q.twoPoint) continue;
        const ep = smoothExpectedPoints(q.down, q.toGo, q.ytg);
        after = q.team === p.team ? ep : -ep;
        break;
      }
    }
    out.push(after - before);
  }
  return out;
}

class Counter {
  readonly m = new Map<string, number>();
  add(key: string, n = 1) {
    this.m.set(key, (this.m.get(key) ?? 0) + n);
  }
  get(key: string) {
    return this.m.get(key) ?? 0;
  }
}

export async function people(): Promise<void> {
  // --- Snap shares and injuries (participation seasons) ---
  const shareSum = new Counter();
  let teamGames = 0;
  const groupSnaps = new Counter();
  const injuries = new Counter();
  const missed = new Counter();
  let scrimmageInjuries = 0;
  let specialInjuries = 0;
  let unmatched = 0;
  let returnedSameGame = 0;
  let leftGame = 0;
  let missedCounted = 0;
  let participationGames = 0;

  for (const season of PARTICIPATION_SEASONS) {
    console.log(`Reading ${season} participation...`);
    const part = new Map<string, Snap>();
    const path = await ensure(
      `pbp_participation_${season}.csv`,
      `${RELEASE}/pbp_participation/pbp_participation_${season}.csv`,
    );
    await readCsv(path, (r) => {
      part.set(`${r["nflverse_game_id"]}:${r["play_id"]}`, {
        team: r["possession_team"] ?? "",
        offense: side(r["offense_players"], r["offense_positions"], r["offense_numbers"]),
        defense: side(r["defense_players"], r["defense_positions"], r["defense_numbers"]),
      });
    });

    // Each team's games in order, and when each player was last on the field in each game.
    const schedule = new Map<string, { gameId: string; week: number }[]>();
    const lastSeen = new Map<string, Map<string, number>>();
    const injured: { gameId: string; team: string; id: string; playId: number }[] = [];
    // Per team-game: snaps per player and total snaps, offense and defense.
    const snaps = new Map<string, Map<string, { group: string; n: number }>>();
    const totals = new Counter();

    const rows: Row[] = [];
    await readCsv(join(CACHE, `play_by_play_${season}.csv.gz`), (r) => {
      if (r["season_type"] === "REG") rows.push(r);
    });
    for (const r of rows) {
      const gameId = r["game_id"] as string;
      const playId = num(r["play_id"]);
      for (const t of [r["home_team"], r["away_team"]] as string[]) {
        const list = schedule.get(t) ?? [];
        if (!list.some((g) => g.gameId === gameId)) list.push({ gameId, week: num(r["week"]) });
        schedule.set(t, list);
      }
      const snap = part.get(`${gameId}:${r["play_id"]}`);
      if (!snap) continue;
      const seen = lastSeen.get(gameId) ?? new Map<string, number>();
      for (const id of [...snap.offense.ids, ...snap.defense.ids])
        seen.set(id, Math.max(seen.get(id) ?? 0, playId));
      lastSeen.set(gameId, seen);

      const type = r["play_type"] ?? "";
      const kicking = snap.offense.positions.some((p) => p === "K" || p === "P");
      const scrimmage = (type === "pass" || type === "run" || type === "no_play") && !kicking;
      if (scrimmage && snap.offense.ids.length === 11 && snap.defense.ids.length === 11) {
        const defenseTeam = r["posteam"] === r["home_team"] ? r["away_team"] : r["home_team"];
        for (const [team, s, unit] of [
          [snap.team, snap.offense, "off"],
          [defenseTeam, snap.defense, "def"],
        ] as [string, Side, string][]) {
          const key = `${gameId}|${team}|${unit}`;
          totals.add(key);
          const players = snaps.get(key) ?? new Map();
          s.ids.forEach((id, i) => {
            const group = GROUP[s.positions[i] ?? ""];
            if (!group) return;
            const entry = players.get(id) ?? { group, n: 0 };
            entry.n += 1;
            players.set(id, entry);
            groupSnaps.add(group);
          });
          snaps.set(key, players);
        }
      }

      // Injuries: "BAL-80-I.Likely was injured during the play."
      for (const m of (r["desc"] ?? "").matchAll(
        /([A-Z]{2,3})-(\d{1,2})-\S+ was injured during the play/g,
      )) {
        const [, team, number] = m;
        const s = team === snap.team ? snap.offense : snap.defense;
        const i = s.numbers.indexOf(String(Number(number)));
        const id = s.ids[i];
        const group = GROUP[s.positions[i] ?? ""];
        if (i < 0 || !id) {
          unmatched += 1;
          continue;
        }
        if (scrimmage) {
          scrimmageInjuries += 1;
          if (group) injuries.add(group);
        } else specialInjuries += 1;
        injured.push({ gameId, team: team as string, id, playId });
      }
    }

    // Playing time by depth: each team-game's players at a position, most snaps first.
    for (const [key, players] of snaps) {
      const total = totals.get(key);
      if (total < 30) continue;
      if (key.endsWith("|off")) teamGames += 1;
      const byGroup = new Map<string, number[]>();
      for (const { group, n } of players.values()) {
        const list = byGroup.get(group) ?? [];
        list.push(n);
        byGroup.set(group, list);
      }
      for (const [group, counts] of byGroup) {
        counts.sort((a, b) => b - a);
        counts
          .slice(0, RANK_DEPTH[group])
          .forEach((n, rank) => shareSum.add(`${group}|${rank}`, n / total));
      }
    }

    // After an injury: back in the same game? If not, how many games missed?
    for (const inj of injured) {
      const seen = lastSeen.get(inj.gameId)?.get(inj.id) ?? 0;
      if (seen > inj.playId) {
        returnedSameGame += 1;
        continue;
      }
      leftGame += 1;
      const games = (schedule.get(inj.team) ?? []).sort((a, b) => a.week - b.week);
      const at = games.findIndex((g) => g.gameId === inj.gameId);
      const later = games.slice(at + 1);
      if (later.length < MIN_GAMES_LEFT) continue;
      let out = later.findIndex((g) => lastSeen.get(g.gameId)?.has(inj.id));
      if (out < 0) out = later.length;
      missed.add(bucketOf(out));
      missedCounted += 1;
    }
    participationGames += new Set(rows.map((r) => r["game_id"])).size;
  }

  // --- Leaderboards (all play-by-play seasons) ---
  const boards: Record<string, number[][]> = {
    passYds: [],
    passTd: [],
    rushYds: [],
    recYds: [],
    rec: [],
    sacks: [],
    defInt: [],
  };
  const ratings: number[][] = [];
  const advanced: { epa: number; success: number; plays: number }[] = [];
  for (const season of PBP_SEASONS) {
    console.log(`Reading ${season} play-by-play for leaders...`);
    const c: Record<string, Counter> = Object.fromEntries(
      [...Object.keys(boards), "passAtt", "passCmp", "passInt"].map((k) => [k, new Counter()]),
    );
    const adv = { epa: 0, success: 0, plays: 0 };
    advanced.push(adv);
    const states: StateRow[] = [];
    await readCsv(join(CACHE, `play_by_play_${season}.csv.gz`), (r) => {
      if (r["season_type"] !== "REG") return;
      const type = r["play_type"];
      states.push({
        game: r["game_id"] ?? "",
        half: r["game_half"] ?? "",
        type: type ?? "",
        down: num(r["down"]),
        toGo: num(r["ydstogo"]),
        ytg: num(r["yardline_100"]),
        team: r["posteam"] ?? "",
        touchdownBy: flag(r["touchdown"]) ? (r["td_team"] ?? "") : null,
        safety: flag(r["safety"]),
        twoPoint: flag(r["two_point_attempt"]),
      });
      if ((type !== "pass" && type !== "run") || flag(r["two_point_attempt"])) return;
      const passer = r["passer_player_id"];
      if (passer && passer !== "NA" && flag(r["pass_attempt"]) && !flag(r["sack"])) {
        c["passAtt"]!.add(passer);
        if (flag(r["complete_pass"])) c["passCmp"]!.add(passer);
        c["passYds"]!.add(passer, num(r["passing_yards"]) || 0);
        if (flag(r["pass_touchdown"])) c["passTd"]!.add(passer);
        if (flag(r["interception"])) c["passInt"]!.add(passer);
      }
      const rusher = r["rusher_player_id"];
      if (rusher && rusher !== "NA") c["rushYds"]!.add(rusher, num(r["rushing_yards"]) || 0);
      const receiver = r["receiver_player_id"];
      if (receiver && receiver !== "NA" && flag(r["complete_pass"])) {
        c["recYds"]!.add(receiver, num(r["receiving_yards"]) || 0);
        c["rec"]!.add(receiver);
      }
      const sacker = r["sack_player_id"];
      if (sacker && sacker !== "NA") c["sacks"]!.add(sacker);
      for (const half of [r["half_sack_1_player_id"], r["half_sack_2_player_id"]])
        if (half && half !== "NA") c["sacks"]!.add(half, 0.5);
      const hawk = r["interception_player_id"];
      if (hawk && hawk !== "NA") c["defInt"]!.add(hawk);
    });
    // EPA and success measured with the same expected-points table the sim uses.
    const tableEpa = expectedPointsAdded(states);
    for (const epa of tableEpa) {
      adv.epa += epa;
      adv.plays += 1;
      if (epa > 0) adv.success += 1;
    }
    for (const key of Object.keys(boards)) {
      const sorted = [...c[key]!.m.values()].sort((a, b) => b - a);
      boards[key]!.push(RANKS.map((rank) => sorted[rank - 1] ?? 0));
    }
    const qualified: number[] = [];
    for (const [id, att] of c["passAtt"]!.m) {
      if (att < RATING_QUALIFIER) continue;
      qualified.push(
        passerRating(
          att,
          c["passCmp"]!.get(id),
          c["passYds"]!.get(id),
          c["passTd"]!.get(id),
          c["passInt"]!.get(id),
        ),
      );
    }
    qualified.sort((a, b) => b - a);
    ratings.push(qualified);
  }

  const avg = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
  const leaderboards = Object.fromEntries(
    Object.entries(boards).map(([key, seasons]) => [
      key,
      Object.fromEntries(
        RANKS.map((rank, i) => {
          const values = seasons.map((s) => s[i] as number);
          return [
            String(rank),
            { real: round(avg(values), 1), range: [Math.min(...values), Math.max(...values)] },
          ];
        }),
      ),
    ]),
  );
  const ratingAt = (pick: (q: number[]) => number) => {
    const values = ratings.map(pick);
    return {
      real: round(avg(values), 1),
      range: [round(Math.min(...values), 1), round(Math.max(...values), 1)],
    };
  };

  const snapShares = Object.fromEntries(
    Object.entries(RANK_DEPTH).map(([group, depth]) => [
      group,
      Array.from({ length: depth }, (_, rank) =>
        round(shareSum.get(`${group}|${rank}`) / teamGames, 3),
      ),
    ]),
  );
  const perSnap = Object.fromEntries(
    [...new Set(Object.values(GROUP))].map((g) => [
      g,
      round(injuries.get(g) / groupSnaps.get(g), 6),
    ]),
  );

  const out = {
    source:
      "nflverse play-by-play (2022-2025) and participation (2023-2025) data, github.com/nflverse/nflverse-data, CC-BY-4.0. Regular seasons. Built by `npm run pipeline -- people`.",
    snapShares: {
      note: "Average share of a team's scrimmage snaps by depth rank (most snaps first) at each position group. EDGE = DE + OLB, DT = DT + NT.",
      ...snapShares,
    },
    injuries: {
      note: "In-game injuries ('was injured during the play'). perSnap = injuries per player-snap on scrimmage plays by position group.",
      scrimmagePerTeamGame: round(scrimmageInjuries / (participationGames * 2), 3),
      specialTeamsPerTeamGame: round(specialInjuries / (participationGames * 2), 3),
      unmatched,
      perSnap,
      returnSameGameRate: round(returnedSameGame / (returnedSameGame + leftGame), 3),
      gamesMissed: {
        note: `Players who left the game and didn't return to it: regular-season games missed afterwards (injuries with at least ${MIN_GAMES_LEFT} games left).`,
        injuries: missedCounted,
        shares: Object.fromEntries(
          MISSED_BUCKETS.map((b) => [b, round(missed.get(b) / missedCounted, 3)]),
        ),
      },
    },
    advanced: {
      note: "Runs and dropbacks (no penalties wiped out, no 2-point tries): average EPA per play and success rate (share of plays with EPA > 0), per season. EPA here uses the same expected-points table as the sim (calibration/matchups.json), not nflverse's own model, so the two are measured alike.",
      epaPerPlay: advanced.map((a) => round(a.epa / a.plays, 4)),
      successRate: advanced.map((a) => round(a.success / a.plays, 4)),
    },
    leaderboards: {
      note: "Season totals at each leaderboard rank (1 = the leader), averaged over 2022-2025 with the lowest and highest season.",
      ...leaderboards,
      passerRating: {
        qualifier: `${RATING_QUALIFIER} attempts`,
        qualifiers: ratingAt((q) => q.length),
        best: ratingAt((q) => q[0] ?? 0),
        fifth: ratingAt((q) => q[4] ?? 0),
        median: ratingAt((q) => q[Math.floor(q.length / 2)] ?? 0),
        worst: ratingAt((q) => q[q.length - 1] ?? 0),
      },
    },
  };
  writeFileSync(join(ROOT, "calibration", "people.json"), `${JSON.stringify(out, null, 2)}\n`);
  console.log(JSON.stringify(out, null, 1).slice(0, 4000));
  console.log("\nWrote calibration/people.json\n");
}
