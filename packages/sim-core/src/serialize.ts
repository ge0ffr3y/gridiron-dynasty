/**
 * The league file format: JSON with object keys in sorted order, so the same
 * league always produces exactly the same text (and the same fingerprint).
 */
import { emptyHistory } from "./history/state";
import { COACH_SKILL, ROLE_FOCUS } from "./coaches/config";
import { drawStyle } from "./coaches/style";
import { careerStart, fillStaff } from "./generate/coaches";
import { severityFor } from "./season/injuries";
import { Rng, streamSeed } from "@fgm/foundation";
import { generateContracts } from "./contracts/generate";
import { seedSalaryHistory } from "./contracts/tags";
import { emptyTeamCap } from "./contracts/team";
import {
  LEAGUE_FORMAT,
  LEAGUE_FORMAT_VERSION,
  LeagueSchema,
  type CoachRole,
  type League,
} from "./league/schema";
import { rulesFor } from "./rules";
import { emptyScouting } from "./scouting/config";
import { generateExecutives } from "./front-office/executives";
import { generateAgents } from "./people/agents";
import { stadiumFor } from "./season/weather";

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === "object") {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      const v = (value as Record<string, unknown>)[key];
      if (v !== undefined) sorted[key] = sortKeys(v);
    }
    return sorted;
  }
  return value;
}

export function serializeLeague(league: League): string {
  return JSON.stringify(sortKeys(league));
}

/**
 * Brings an older save up to the current format, in place.
 * Version 2 -> 3: players get an empty stats history, games get no box score,
 * and the league's rules gain the game rules (clock, kicks, overtime) from
 * the rules file for its season.
 */
function upgrade(data: Record<string, unknown>): void {
  if (data["formatVersion"] === 2) {
    for (const p of (data["players"] as Record<string, unknown>[]) ?? []) p["stats"] = [];
    for (const g of (data["games"] as Record<string, unknown>[]) ?? []) g["boxScore"] = null;
    const rules = data["rules"] as Record<string, unknown> | undefined;
    if (rules && !rules["game"]) rules["game"] = rulesFor(Number(data["season"])).game;
    data["formatVersion"] = 3;
  }
  // Version 3 -> 4: box scores gain team penalty totals; the rules gain penalty enforcement.
  if (data["formatVersion"] === 3) {
    for (const g of (data["games"] as Record<string, unknown>[]) ?? []) {
      const box = g["boxScore"] as Record<string, Record<string, unknown>> | null;
      if (!box) continue;
      for (const side of ["home", "away"]) {
        if (box[side]) Object.assign(box[side]!, { penalties: 0, penaltyYards: 0 });
      }
    }
    const rules = data["rules"] as { game?: Record<string, unknown> } | undefined;
    if (rules?.game && !rules.game["penalties"])
      rules.game["penalties"] = rulesFor(Number(data["season"])).game.penalties;
    data["formatVersion"] = 4;
  }
  // Version 4 -> 5: automatic depth charts, no injuries, and advanced box score totals (zero for old games).
  if (data["formatVersion"] === 4) {
    for (const t of (data["teams"] as Record<string, unknown>[]) ?? [])
      t["depthChart"] = { auto: true, slots: {} };
    for (const p of (data["players"] as Record<string, unknown>[]) ?? []) p["injury"] = null;
    for (const g of (data["games"] as Record<string, unknown>[]) ?? []) {
      const box = g["boxScore"] as Record<string, Record<string, unknown>> | null;
      if (!box) continue;
      for (const side of ["home", "away"]) {
        if (box[side])
          Object.assign(box[side]!, {
            epa: 0,
            epaPlays: 0,
            successPlays: 0,
            dropbacks: 0,
            pressured: 0,
          });
      }
    }
    data["formatVersion"] = 5;
  }
  // Version 5 -> 6: stadiums on teams, weather on games (none for games already played),
  // and the 2026 kickoff rules (landing zone, onside kicks).
  if (data["formatVersion"] === 5) {
    for (const t of (data["teams"] as Record<string, unknown>[]) ?? [])
      t["stadium"] = stadiumFor(String(t["id"]));
    for (const g of (data["games"] as Record<string, unknown>[]) ?? []) g["weather"] = null;
    const rules = data["rules"] as { game?: Record<string, unknown> } | undefined;
    if (rules?.game) rules.game["kickoff"] = rulesFor(Number(data["season"])).game.kickoff;
    data["formatVersion"] = 6;
  }
  // Version 6 -> 7: contracts and the salary cap. Old contract stubs go; real
  // contracts are generated once the file is read (see parseLeague).
  if (data["formatVersion"] === 6) {
    for (const t of (data["teams"] as Record<string, unknown>[]) ?? []) t["cap"] = emptyTeamCap();
    for (const p of (data["players"] as Record<string, unknown>[]) ?? []) p["contract"] = null;
    data["salaryHistory"] = [];
    const rules = data["rules"] as Record<string, unknown> | undefined;
    if (rules) rules["cap"] = rulesFor(Number(data["season"])).cap;
    data["formatVersion"] = 7;
    data[NEEDS_CONTRACTS] = true;
  }
  // Version 7 -> 8: the full calendar and roster rules. Everyone on a team is on its active
  // roster; no preseason games yet; the rules gain the roster and calendar blocks.
  if (data["formatVersion"] === 7) {
    for (const p of (data["players"] as Record<string, unknown>[]) ?? [])
      Object.assign(p, {
        roster: "active",
        reserve: null,
        elevations: 0,
        retiredAfter: null,
        preseason: null,
      });
    for (const t of (data["teams"] as Record<string, unknown>[]) ?? [])
      Object.assign(t, { reserveReturns: [], elevated: [] });
    data["preseasonGames"] = [];
    data["settings"] = { preseasonGames: true };
    const fresh = rulesFor(Number(data["season"]));
    const rules = data["rules"] as Record<string, unknown> | undefined;
    if (rules) Object.assign(rules, { roster: fresh.roster, calendar: fresh.calendar });
    data["formatVersion"] = 8;
  }
  // Version 8 -> 9: player development. No rating history or development rounds yet.
  if (data["formatVersion"] === 8) {
    for (const p of (data["players"] as Record<string, unknown>[]) ?? []) p["ratingHistory"] = [];
    data["development"] = [];
    data["formatVersion"] = 9;
  }
  // Version 9 -> 10: the injury model. A current injury gets a body part we don't know, a
  // severity from its length, and an Out status; no knocks or injury history yet.
  if (data["formatVersion"] === 9) {
    for (const p of (data["players"] as Record<string, unknown>[]) ?? []) {
      const injury = p["injury"] as Record<string, unknown> | null;
      if (injury) {
        const games = Number(injury["gamesRemaining"]);
        Object.assign(injury, {
          part: "Other",
          severity: severityFor(games),
          kind: "game",
          totalGames: games,
          status: "Out",
        });
      }
      p["knock"] = null;
      p["injuryHistory"] = [];
    }
    data["formatVersion"] = 10;
  }
  // Version 10 -> 11: the coach model. Each coach gets a health skill and a style drawn as for
  // generated coaches (seeded by the league and the coach); the new jobs are filled after
  // validation (see parseLeague).
  if (data["formatVersion"] === 10) {
    const seed = Number((data["meta"] as Record<string, unknown>)?.["seed"] ?? 0);
    for (const c of (data["coaches"] as Record<string, unknown>[]) ?? []) {
      const rng = new Rng(streamSeed(seed, `coach-upgrade:${String(c["id"])}`));
      const ratings = c["ratings"] as Record<string, number>;
      ratings["health"] = Math.max(
        1,
        Math.min(99, Math.round(rng.gaussian(COACH_SKILL.mean, COACH_SKILL.spread))),
      );
      c["style"] = drawStyle(rng);
    }
    data["formatVersion"] = 11;
    data[NEEDS_STAFF] = true;
  }
  // Version 11 -> 12: coaching careers. Every coach starts a career record now, partway through
  // a contract, with a reputation from his experience and skill; no carousel moves yet.
  if (data["formatVersion"] === 11) {
    const seed = Number((data["meta"] as Record<string, unknown>)?.["seed"] ?? 0);
    const year = Number(String(data["date"]).slice(0, 4));
    for (const c of (data["coaches"] as Record<string, unknown>[]) ?? []) {
      const rng = new Rng(streamSeed(seed, `coach-career:${String(c["id"])}`));
      const role = c["role"] as CoachRole;
      const ratings = c["ratings"] as Record<string, number>;
      Object.assign(
        c,
        careerStart(
          rng,
          role,
          Number(c["experience"]),
          ratings[ROLE_FOCUS[role]] ?? 58,
          year,
          c["teamId"] !== null,
        ),
      );
    }
    data["coachingMoves"] = [];
    const rules = data["rules"] as Record<string, unknown> | undefined;
    if (rules) rules["staff"] = rulesFor(Number(data["season"])).staff;
    data["formatVersion"] = 12;
  }
  // Version 12 -> 13: scouting. Teams start with no scouting assignments or study, the screens
  // view as the league office, and no draft class exists until the next season starts.
  if (data["formatVersion"] === 12) {
    for (const t of (data["teams"] as Record<string, unknown>[]) ?? [])
      t["scouting"] = emptyScouting();
    const settings = data["settings"] as Record<string, unknown> | undefined;
    if (settings) settings["viewingAs"] = null;
    data["prospects"] = [];
    for (const p of (data["players"] as Record<string, unknown>[]) ?? []) p["measurables"] = null;
    data["formatVersion"] = 13;
  }
  // Version 13 -> 14: draft day. Picks are regular and unused, no hand-set boards, and free-agent
  // moves start being recorded at the next League Year (no compensatory picks until then).
  if (data["formatVersion"] === 13) {
    for (const p of (data["draftPicks"] as Record<string, unknown>[]) ?? []) {
      p["compensatory"] = null;
      p["selection"] = null;
    }
    for (const t of (data["teams"] as Record<string, unknown>[]) ?? [])
      (t["scouting"] as Record<string, unknown>)["board"] = null;
    data["freeAgentMoves"] = [];
    const rules = data["rules"] as Record<string, unknown> | undefined;
    if (rules) rules["draft"] = rulesFor(Number(data["season"])).draft;
    data["formatVersion"] = 14;
  }
  // Version 14 -> 15: free agency and negotiation (Phase 12). Agents from the seed, no talks or
  // free agency under way, no tenders held, and the free-agency rules.
  if (data["formatVersion"] === 14) {
    const seed = Number((data["meta"] as Record<string, unknown>)?.["seed"] ?? 0);
    data["agents"] = generateAgents(seed);
    data["negotiations"] = [];
    data["freeAgency"] = null;
    for (const p of (data["players"] as Record<string, unknown>[]) ?? []) p["rights"] = null;
    const rules = data["rules"] as Record<string, unknown> | undefined;
    if (rules) rules["freeAgency"] = rulesFor(Number(data["season"])).freeAgency;
    data["formatVersion"] = 15;
  }
  // Version 15 -> 16: moods and disputes (Phase 12b). Moods start unset (the next weekly update
  // fills them in) and there are no disputes yet.
  if (data["formatVersion"] === 15) {
    for (const p of (data["players"] as Record<string, unknown>[]) ?? []) p["mood"] = null;
    data["disputes"] = [];
    data["formatVersion"] = 16;
  }
  // Version 16 -> 17: front offices (Phase 13). Generated GMs and owners from the seed, no team
  // plans yet (the GM reads the team at the next turning point), no trade memory or offers.
  if (data["formatVersion"] === 16) {
    const seed = Number((data["meta"] as Record<string, unknown>)?.["seed"] ?? 0);
    const teams = (data["teams"] as Record<string, unknown>[]) ?? [];
    for (const t of teams) t["plan"] = null;
    const executives = generateExecutives(
      seed,
      teams.map((t) => String(t["id"])),
      Number(data["season"]),
      String(data["date"]),
    );
    data["executives"] = executives;
    data["executiveMoves"] = [];
    data["tradeHistory"] = [];
    data["tradeOffers"] = [];
    const ids = data["nextIds"] as Record<string, unknown>;
    ids["executive"] = executives.length;
    ids["tradeOffer"] = 0;
    data["formatVersion"] = 17;
  }
  // Version 17 -> 18: long-gone players move to short history cards (Phase 13). None yet: the
  // next season's end moves them.
  if (data["formatVersion"] === 17) {
    data["formerPlayers"] = [];
    data["formatVersion"] = 18;
  }
  // Version 18 -> 19: GM Mode (Phase 14). Older saves open in Simulation Mode (no career);
  // every executive is an AI one.
  if (data["formatVersion"] === 18) {
    data["career"] = null;
    for (const e of (data["executives"] as Record<string, unknown>[]) ?? []) e["person"] = false;
    data["formatVersion"] = 19;
  }
  // Version 19 -> 20: league history (Phase 15). Older saves start their awards, record book, Hall
  // of Fame and newsfeed from here on; the newsfeed starts after what's already happened.
  if (data["formatVersion"] === 19) {
    Object.assign(data, emptyHistory());
    const ids = (data["transactions"] as { id: number }[]) ?? [];
    data["newsCursor"] = {
      transaction: ids.reduce((m, t) => Math.max(m, t.id), 0),
      coachingMove: ((data["coachingMoves"] as unknown[]) ?? []).length,
      executiveMove: ((data["executiveMoves"] as unknown[]) ?? []).length,
    };
    (data["nextIds"] as Record<string, number>)["news"] = 0;
    for (const f of (data["formerPlayers"] as Record<string, unknown>[]) ?? []) {
      f["number"] = null;
      f["legend"] = false;
      f["titles"] = 0;
    }
    data["formatVersion"] = 20;
  }
}

/** Set on an upgraded save whose teams still need their Phase 10 staff (removed before validation). */
const NEEDS_STAFF = "__needsStaff";

/** Set on an upgraded save whose players still need contracts (removed before validation). */
const NEEDS_CONTRACTS = "__needsContracts";

/** Reads a league file (upgrading older saves), checking its format and every field. */
export function parseLeague(text: string): League {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("This isn't a league file (it isn't valid JSON).");
  }
  const header = data as { format?: unknown; formatVersion?: unknown } | null;
  if (header?.format !== LEAGUE_FORMAT) throw new Error("This isn't a FootballGM Sim league file.");
  upgrade(data as Record<string, unknown>);
  if (header.formatVersion !== LEAGUE_FORMAT_VERSION) {
    const older =
      typeof header.formatVersion === "number" && header.formatVersion < LEAGUE_FORMAT_VERSION;
    throw new Error(
      older
        ? `This league was saved by an older version of the game (save format ${String(header.formatVersion)}) and can't be opened. Create a new league instead.`
        : `This league was saved by a newer version of the game (save format ${String(header.formatVersion)}). Update the game to open it.`,
    );
  }
  const needsContracts = (data as Record<string, unknown>)[NEEDS_CONTRACTS] === true;
  delete (data as Record<string, unknown>)[NEEDS_CONTRACTS];
  const needsStaff = (data as Record<string, unknown>)[NEEDS_STAFF] === true;
  delete (data as Record<string, unknown>)[NEEDS_STAFF];
  const result = LeagueSchema.safeParse(data);
  if (!result.success) {
    const first = result.error.issues.slice(0, 5).map((i) => `${i.path.join(".")}: ${i.message}`);
    throw new Error(`The league file is damaged:\n${first.join("\n")}`);
  }
  if (needsContracts) {
    // Seeded by the league, so loading the same old save always gives the same contracts.
    generateContracts(result.data, new Rng(streamSeed(result.data.meta.seed, "contracts:upgrade")));
    seedSalaryHistory(result.data);
  }
  if (needsStaff) fillStaff(result.data, result.data.date, "upgrade");
  return result.data;
}

/** Short fingerprint of a league file's text (FNV-1a, 32-bit), shown on screen to compare leagues. */
export function fingerprint(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}
