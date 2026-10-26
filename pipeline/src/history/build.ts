/**
 * The real league's past, renamed (Phase 15): turns the fetched pages and the scores file into
 * `RealHistoryInput`. Every real person gets a fictional name from the same Renamer as the league's
 * players, keyed by the reference site's player id, so a still-active star keeps the name he has on
 * the roster; long-gone people become "legends" with short history cards. Real names never leave
 * this file's inputs.
 */
import type { StatLine } from "@fgm/game-engine";
import type { RealHistoryInput, RealLegend, Position } from "@fgm/sim-core";
import type { Renamer } from "../league/names";
import { buildAnnals } from "./annals";
import { num, type Row } from "./html";
import { ourPosition, parseAllPro, parseAwards, parseHallOfFame, parseProBowl } from "./parse";
import { buildRecords } from "./records";
import { parseRetired } from "./retired";

/** The reference site's team codes, as this league's franchise ids. */
const CODES: Record<string, string> = {
  crd: "ARI",
  ari: "ARI",
  atl: "ATL",
  rav: "BAL",
  bal: "BAL",
  buf: "BUF",
  car: "CAR",
  chi: "CHI",
  cin: "CIN",
  cle: "CLE",
  dal: "DAL",
  den: "DEN",
  det: "DET",
  gnb: "GB",
  htx: "HOU",
  clt: "IND",
  jax: "JAX",
  kan: "KC",
  rai: "LV",
  sdg: "LAA",
  ram: "LAB",
  mia: "MIA",
  min: "MIN",
  nwe: "NE",
  nor: "NO",
  nyg: "NYB",
  nyj: "NYA",
  phi: "PHI",
  pit: "PIT",
  sfo: "SF",
  sea: "SEA",
  tam: "TB",
  oti: "TEN",
  was: "WAS",
  hou: "TEN",
};
const franchise = (code: string | null): string | null =>
  code ? (CODES[code.toLowerCase()] ?? null) : null;

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z ]/g, "")
    .replace(/\b(jr|sr|ii|iii|iv)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();

/** Career totals from a Hall of Famer's row on the reference page. */
function careerOf(row: Row): StatLine {
  const map: Record<string, string> = {
    g: "gp",
    pass_cmp: "passCmp",
    pass_att: "passAtt",
    pass_yds: "passYds",
    pass_td: "passTd",
    pass_int: "passInt",
    rush_att: "rushAtt",
    rush_yds: "rushYds",
    rush_td: "rushTd",
    rec: "rec",
    rec_yds: "recYds",
    rec_td: "recTd",
    sacks: "sacks",
    def_int: "defInt",
  };
  const out: StatLine = {};
  for (const [col, key] of Object.entries(map)) {
    const v = num(row[col]);
    if (v) (out as Record<string, number>)[key] = v;
  }
  return out;
}

interface Person {
  /** League key: a current player's source id, or `pfr:<id>` / `name:<real name>` for legends. */
  key: string;
  realName: string;
  positions: Map<string, number>;
  seasons: Set<number>;
  teams: Map<string, number>;
  hall: { first: number; last: number; row: Row } | null;
  honors: { season: number; teamId: string | null }[];
}

export interface HistoryContext {
  renamer: Renamer;
  /** Current players: the source id of each (gsis) by his reference-site id. */
  currentByPfr: Map<string, string>;
  /** Current players by his real name (when a list gives no site id), normalized. */
  currentByName: Map<string, string>;
  /** Names already given to current players, by key. */
  names: Map<string, { firstName: string; lastName: string }>;
  report: string[];
}

/** Every real name in the history data, so no fictional name can match one of them. */
export function realHistoryNames(): string[] {
  return [
    ...parseAwards().map((a) => a.name),
    ...parseAllPro().map((a) => a.name),
    ...parseHallOfFame().map((h) => h.name),
    ...parseRetired().map((r) => r.name),
  ];
}

export function buildRealHistory(ctx: HistoryContext): RealHistoryInput {
  const people = new Map<string, Person>();
  const byName = new Map<string, Person>();
  const person = (
    pfrId: string | null,
    realName: string,
    hint?: { position: Position; seasons: number[]; teamId: string | null },
  ): Person => {
    const key = pfrId
      ? (ctx.currentByPfr.get(pfrId) ?? `pfr:${pfrId}`)
      : (byName.get(norm(realName))?.key ??
        ctx.currentByName.get(norm(realName)) ??
        `name:${norm(realName)}`);
    let p = people.get(key);
    if (!p) {
      p = {
        key,
        realName,
        positions: new Map(),
        seasons: new Set(),
        teams: new Map(),
        hall: null,
        honors: [],
      };
      people.set(key, p);
      byName.set(norm(realName), p);
    } else if (!byName.has(norm(realName))) byName.set(norm(realName), p);
    if (hint) {
      p.positions.set(hint.position, (p.positions.get(hint.position) ?? 0) + 0.5);
      for (const s of hint.seasons) {
        p.seasons.add(s);
        p.honors.push({ season: s, teamId: hint.teamId });
      }
      if (hint.teamId) p.teams.set(hint.teamId, (p.teams.get(hint.teamId) ?? 0) + 1);
    }
    return p;
  };
  const note = (p: Person, position: string, season: number, teamId: string | null) => {
    const pos = ourPosition(position) ?? position;
    if (pos) p.positions.set(pos, (p.positions.get(pos) ?? 0) + 1);
    p.seasons.add(season);
    if (teamId) p.teams.set(teamId, (p.teams.get(teamId) ?? 0) + 1);
    p.honors.push({ season, teamId });
  };

  const awards: RealHistoryInput["awards"] = [];
  const rawAwards = parseAwards();
  const rawAllPro = parseAllPro();
  const rawHall = parseHallOfFame();
  const rawRetired = parseRetired();
  // People first, so each gets one name.
  for (const a of rawAwards) {
    const p = a.award === "coach" ? person(null, a.name) : person(a.pfrId, a.name);
    note(p, a.position, a.season, franchise(a.team));
  }
  for (const a of rawAllPro) {
    const p = person(a.pfrId, a.name);
    note(p, a.position, a.season, franchise(a.teamCode));
  }
  for (const h of rawHall) {
    const p = h.kind === "player" ? person(h.pfrId, h.name) : person(null, h.name);
    p.hall = { first: h.firstSeason, last: h.lastSeason, row: h.row };
    if (h.kind === "player") for (let s = h.firstSeason; s <= h.lastSeason; s++) p.seasons.add(s);
    if (h.position)
      p.positions.set(
        ourPosition(h.position) ?? h.position,
        (p.positions.get(ourPosition(h.position) ?? h.position) ?? 0) + 1,
      );
  }
  const retired = rawRetired.map((r) => ({ ...r, person: person(null, r.name) }));
  // Record holders count as people too (a dry pass: names come later, in one fixed order).
  buildRecords(
    {
      person: (pfrId, realName, hint) => {
        const p = person(pfrId, realName, hint);
        return { key: p.key, name: "", known: false };
      },
      report: [],
    },
    franchise,
  );
  // Names: current players have theirs; everyone else is named once, in key order.
  const name = (p: Person) => {
    let n = ctx.names.get(p.key);
    if (!n) {
      n = ctx.renamer.name(p.key);
      ctx.names.set(p.key, n);
    }
    return n;
  };
  const sorted = [...people.values()].sort((a, b) => a.key.localeCompare(b.key));
  for (const p of sorted)
    if (!ctx.currentByPfr.has(p.key.replace(/^pfr:/, "")) && !ctx.names.has(p.key)) name(p);
  const current = (p: Person) => !p.key.startsWith("pfr:") && !p.key.startsWith("name:");
  const fictional = (p: Person) => {
    const n = name(p);
    return `${n.firstName} ${n.lastName}`;
  };

  const champions = new Map<number, string>();
  const annals = buildAnnals();
  for (const a of annals) if (a.championId) champions.set(a.season, a.championId);

  // Legends: everyone who isn't a current player.
  const legends: RealLegend[] = [];
  for (const p of sorted) {
    if (current(p)) continue;
    if (p.key.startsWith("name:")) {
      // A name only (a retired number or a coach): no card unless he's also a player elsewhere.
      continue;
    }
    const n = name(p);
    const pos = [...p.positions].sort((a, b) => b[1] - a[1])[0]?.[0];
    const position = (ourPosition(pos ?? "") ?? (pos as Position | undefined)) as
      Position | undefined;
    if (
      !position ||
      !(
        [
          "QB",
          "RB",
          "FB",
          "WR",
          "TE",
          "OT",
          "OG",
          "C",
          "EDGE",
          "DT",
          "LB",
          "CB",
          "S",
          "K",
          "P",
          "LS",
        ] as string[]
      ).includes(position)
    )
      continue;
    const years = [...p.seasons].sort((a, b) => a - b);
    const first = p.hall?.first ?? years[0] ?? 1966;
    const last = p.hall?.last ?? years.at(-1) ?? first;
    legends.push({
      key: p.key,
      firstName: n.firstName,
      lastName: n.lastName,
      position,
      firstSeason: first,
      lastSeason: last,
      teams: [...p.teams]
        .sort((a, b) => b[1] - a[1])
        .map(([t]) => t)
        .slice(0, 4),
      seasonsStarted: p.hall
        ? num(p.hall.row.years_as_primary_starter) || years.length
        : years.length,
      career: p.hall ? careerOf(p.hall.row) : {},
      number: retired.find((r) => r.person === p)?.number ?? null,
      titles: new Set(
        p.honors
          .filter((h) => h.teamId && champions.get(h.season) === h.teamId)
          .map((h) => h.season),
      ).size,
    });
  }
  const legendKeys = new Set(legends.map((l) => l.key));
  const known = (p: Person) => current(p) || legendKeys.has(p.key);

  for (const a of rawAwards) {
    const p = a.award === "coach" ? person(null, a.name) : person(a.pfrId, a.name);
    awards.push({
      season: a.season,
      award: a.award,
      place: 1,
      key: a.award === "coach" ? null : known(p) ? p.key : null,
      name: fictional(p),
      position: ourPosition(a.position) ?? a.position,
      teamId: franchise(a.team),
      reason: "The real league's winner that season.",
    });
  }
  for (const a of rawAllPro) {
    const p = person(a.pfrId, a.name);
    if (!known(p)) continue;
    awards.push({
      season: a.season,
      award: a.team === "first" ? "all-pro-1" : "all-pro-2",
      place: 1,
      key: p.key,
      name: fictional(p),
      position: ourPosition(a.position) ?? a.position,
      teamId: franchise(a.teamCode),
      reason: "The real league's All-Pro selection that season.",
    });
  }

  // The last three All-Star Game selections, for current players: they set the 2023 draft class's fifth-year options.
  for (const season of [2023, 2024, 2025])
    for (const b of parseProBowl(season)) {
      const key = b.pfrId ? ctx.currentByPfr.get(b.pfrId) : undefined;
      if (!key) continue;
      const n = ctx.names.get(key);
      awards.push({
        season,
        award: "pro-bowl",
        place: 1,
        key,
        name: n ? `${n.firstName} ${n.lastName}` : "",
        position: ourPosition(b.position) ?? b.position,
        teamId: franchise(b.teamCode),
        reason: "Selected to the real All-Star Game on the original ballot.",
      });
    }

  const hallOfFame: RealHistoryInput["hallOfFame"] = rawHall.map((h) => {
    const p = h.kind === "player" ? person(h.pfrId, h.name) : person(null, h.name);
    const r = h.row;
    const bits: string[] = [];
    if (h.kind === "player") {
      if (num(r.all_pros_first_team))
        bits.push(`${num(r.all_pros_first_team)}x first-team All-Pro`);
      if (num(r.pro_bowls)) bits.push(`${num(r.pro_bowls)} All-Star Game selections`);
      if (num(r.years_as_primary_starter))
        bits.push(`${num(r.years_as_primary_starter)} seasons as a starter`);
    } else if (h.kind === "coach") {
      bits.push(`${num(r.wins)} wins as a head coach`);
      if (num(r.championships)) bits.push(`${num(r.championships)} titles`);
    }
    return {
      kind: h.kind,
      key: h.kind === "player" && known(p) ? p.key : null,
      name: fictional(p),
      position:
        h.kind === "player"
          ? (ourPosition(h.position) ?? h.position)
          : h.kind === "coach"
            ? "HC"
            : "GM",
      teams: [...p.teams]
        .sort((a, b) => b[1] - a[1])
        .map(([t]) => t)
        .slice(0, 3),
      inducted: h.inducted,
      reason: bits.length ? bits.join(", ") + "." : "Inducted in the real league.",
    };
  });

  const retiredNumbers: RealHistoryInput["retiredNumbers"] = retired.map((r) => ({
    teamId: r.teamId,
    number: r.number,
    key: known(r.person) ? r.person.key : null,
    name: fictional(r.person),
    season: r.season,
  }));

  const records = buildRecords(
    {
      person: (pfrId, realName, hint) => {
        const p = person(pfrId, realName, hint);
        return { key: p.key, name: fictional(p), known: known(p) };
      },
      report: ctx.report,
    },
    franchise,
  );
  ctx.report.push(
    `History: ${annals.length} real seasons (1966-2024), ${legends.length} legends, ${awards.length} award and All-Pro lines, ${hallOfFame.length} Hall of Famers, ${retiredNumbers.length} retired numbers, ${records.length} record lists.`,
  );
  return { annals, legends, awards, hallOfFame, retiredNumbers, records };
}
