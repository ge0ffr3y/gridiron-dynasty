/**
 * Reads the fetched history pages (Phase 15) into plain facts: award winners, All-Pro teams, the
 * Hall of Fame, league and franchise record lists. Names here are real: nothing in this file's
 * output is committed except the derived shapes in calibration/awards.json.
 */
import { existsSync, readFileSync } from "node:fs";
import type { AwardKind, Position } from "@fgm/sim-core";
import { FIRST_SEASON, LAST_SEASON, AWARD_PAGES, pageFile } from "./fetch";
import { num, tableRows, type Row } from "./html";

const read = (path: string): string | null =>
  existsSync(pageFile(path)) ? readFileSync(pageFile(path), "utf8") : null;

/** The reference site's position codes, as this league's positions (null: not a position). */
export function ourPosition(code: string): Position | null {
  const c = code.toUpperCase().replace(/\/.*$/, "");
  const table: Record<string, Position | null> = {
    QB: "QB",
    RB: "RB",
    HB: "RB",
    FB: "FB",
    WR: "WR",
    TE: "TE",
    T: "OT",
    OT: "OT",
    G: "OG",
    OG: "OG",
    C: "C",
    OL: "OG",
    DE: "EDGE",
    EDGE: "EDGE",
    DT: "DT",
    NT: "DT",
    DL: "DT",
    LB: "LB",
    OLB: "LB",
    ILB: "LB",
    MLB: "LB",
    CB: "CB",
    DB: "CB",
    S: "S",
    FS: "S",
    SS: "S",
    PK: "K",
    LT: "OT",
    RT: "OT",
    LG: "OG",
    RG: "OG",
    LDE: "EDGE",
    RDE: "EDGE",
    LDT: "DT",
    RDT: "DT",
    LOLB: "LB",
    ROLB: "LB",
    LLB: "LB",
    RLB: "LB",
    LILB: "LB",
    RILB: "LB",
    LCB: "CB",
    RCB: "CB",
    K: "K",
    P: "P",
    LS: "LS",
    KR: null,
    PR: null,
    ST: null,
  };
  return table[c] ?? null;
}

export interface RealAward {
  season: number;
  award: AwardKind;
  /** The reference site's id for the player (null for coaches). */
  pfrId: string | null;
  name: string;
  position: string;
  teamName: string;
  team: string | null;
}

const AWARD_FOR_PAGE: Record<string, AwardKind> = {
  "ap-nfl-mvp-award": "mvp",
  "ap-offensive-player-of-the-year": "opoy",
  "ap-defensive-player-of-the-year": "dpoy",
  "ap-offensive-rookie-of-the-year-award": "oroy",
  "ap-defensive-rookie-of-the-year-award": "droy",
  "ap-comeback-player-award": "comeback",
  "ap-coach-of-the-year": "coach",
};

/** Award winners from 1966 on (NFL only; the old rival league's go with its teams). */
export function parseAwards(): RealAward[] {
  const out: RealAward[] = [];
  for (const page of AWARD_PAGES) {
    const html = read(`awards/${page}.htm`);
    if (!html) continue;
    for (const r of tableRows(html, "awards")) {
      const season = num(r.year_id);
      if (season < FIRST_SEASON || season > LAST_SEASON) continue;
      if (r.league_id && r.league_id.text !== "NFL") continue;
      out.push({
        season,
        award: AWARD_FOR_PAGE[page]!,
        pfrId: r.player?.id ?? null,
        name: r.player?.text ?? "",
        position: r.pos?.text ?? "",
        teamName: r.team?.text ?? "",
        team: r.team?.href?.match(/\/teams\/([a-z]+)\//)?.[1] ?? null,
      });
    }
  }
  return out;
}

export interface RealAllPro {
  season: number;
  team: "first" | "second";
  position: string;
  pfrId: string | null;
  name: string;
  teamCode: string;
}

/** The AP's All-Pro first and second teams, every season since 1966. */
export function parseAllPro(): RealAllPro[] {
  const out: RealAllPro[] = [];
  for (let season = FIRST_SEASON; season <= LAST_SEASON; season++) {
    const html = read(`years/${season}/allpro.htm`);
    if (!html) continue;
    for (const r of tableRows(html, "all_pro")) {
      const s = r.all_pro_string?.text ?? "";
      const team = /AP: 1st Tm/.test(s) ? "first" : /AP: 2nd Tm/.test(s) ? "second" : null;
      if (!team) continue;
      out.push({
        season,
        team,
        position: r.pos?.text ?? "",
        pfrId: r.player?.id ?? null,
        name: r.player?.text ?? "",
        teamCode: r.team?.href?.match(/\/teams\/([a-z]+)\//)?.[1] ?? "",
      });
    }
  }
  return out;
}

export interface RealProBowler {
  season: number;
  pfrId: string | null;
  name: string;
  position: string;
  teamCode: string;
}

/**
 * A season's Pro Bowl players on the original ballot (players marked "+" are replacements, which
 * the CBA's fifth-year option doesn't count): the last three seasons only (fetched pages).
 */
export function parseProBowl(season: number): RealProBowler[] {
  const html = read(`years/${season}/probowl.htm`);
  if (!html) return [];
  return tableRows(html, "pro_bowl")
    .filter((r) => r.player && !r.player.text.endsWith("+"))
    .map((r) => ({
      season,
      pfrId: r.player!.id,
      name: r.player!.text.replace(/[*+%^]/g, "").trim(),
      position: r.pos?.text ?? "",
      teamCode: r.team?.href?.match(/\/teams\/([a-z]+)\//)?.[1] ?? "",
    }));
}

export interface RealHallMember {
  kind: "player" | "coach" | "contributor";
  pfrId: string | null;
  name: string;
  position: string;
  inducted: number;
  firstSeason: number;
  lastSeason: number;
  row: Row;
}

/** Hall of Famers whose careers reached the 1966 season or later. */
export function parseHallOfFame(): RealHallMember[] {
  const html = read("hof/");
  if (!html) return [];
  const make = (id: string, kind: RealHallMember["kind"]) =>
    tableRows(html, id)
      .map((r) => ({
        kind,
        pfrId: r.player?.id ?? null,
        name: r.player?.text ?? "",
        position: kind === "coach" ? "HC" : (r.pos?.text ?? r.role_induction?.text ?? ""),
        inducted: num(r.year_induction),
        firstSeason: num(r.year_min),
        lastSeason: num(r.year_max),
        row: r,
      }))
      .filter((m) => m.name && m.lastSeason >= FIRST_SEASON);
  return [
    ...make("hof_players", "player"),
    ...make("hof_coach", "coach"),
    ...make("hof_exec", "contributor"),
  ];
}
