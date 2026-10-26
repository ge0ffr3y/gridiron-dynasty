/**
 * Save size and speed over a long league (Phase 18): plays N seasons headless and, every few
 * seasons, measures what a save costs: the league's size raw and gzipped, how long it takes to
 * serialize, fingerprint and parse, how long the season and the offseason took, and which parts of
 * the league are biggest. The table is what the performance budget in docs/performance.md is
 * checked against.
 */
import { writeFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import {
  advance,
  advanceUntil,
  createLeague,
  fingerprint,
  parseLeague,
  serializeLeague,
} from "@fgm/sim-core";

export interface SavesRow {
  seasons: number;
  season: number;
  rawMB: number;
  gzipMB: number;
  serializeMs: number;
  fingerprintMs: number;
  gzipMs: number;
  parseMs: number;
  /**
   * Seconds for one league year: the offseason (free agency, the draft, camp, cuts) and then the
   * regular season and playoffs, up to the championship.
   */
  yearSeconds: number;
  /** The five biggest top-level parts of the league, in MB. */
  biggest: [string, number][];
}

const ms = (since: bigint) => Number(process.hrtime.bigint() - since) / 1e6;
const round = (v: number, d = 1) => Math.round(v * 10 ** d) / 10 ** d;

export function runSaves(seed: number, count: number, every: number, out?: string): SavesRow[] {
  const league = createLeague({ seed, name: `Saves ${seed}` });
  console.log(
    `\nSaves: ${count} seasons from seed ${seed}, measured every ${every}.\n` +
      "after  season   raw MB  gzip MB  serialize  fingerprint  gzip   parse    league year  biggest parts",
  );
  const rows: SavesRow[] = [];
  let yearSeconds = 0;
  for (let i = 1; i <= count; i++) {
    let t = process.hrtime.bigint();
    advanceUntil(league, (l) => l.calendar.stage === "complete");
    yearSeconds = ms(t) / 1000;
    advance(league); // the step into the next offseason (retirements)
    if (i !== 1 && i % every !== 0 && i !== count) continue;
    t = process.hrtime.bigint();
    const text = serializeLeague(league);
    const serializeMs = ms(t);
    t = process.hrtime.bigint();
    fingerprint(text);
    const fingerprintMs = ms(t);
    t = process.hrtime.bigint();
    const gz = gzipSync(text);
    const gzipMs = ms(t);
    t = process.hrtime.bigint();
    parseLeague(text);
    const parseMs = ms(t);
    const parts = Object.entries(league as unknown as Record<string, unknown>)
      .map(([k, v]) => [k, JSON.stringify(v ?? null).length / 1e6] as [string, number])
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([k, v]) => [k, round(v, 2)] as [string, number]);
    const row: SavesRow = {
      seasons: i,
      season: league.season,
      rawMB: round(text.length / 1e6),
      gzipMB: round(gz.length / 1e6),
      serializeMs: Math.round(serializeMs),
      fingerprintMs: Math.round(fingerprintMs),
      gzipMs: Math.round(gzipMs),
      parseMs: Math.round(parseMs),
      yearSeconds: round(yearSeconds),
      biggest: parts,
    };
    rows.push(row);
    console.log(
      `${String(i).padStart(5)}  ${row.season}  ${String(row.rawMB).padStart(7)}  ${String(row.gzipMB).padStart(7)}  ${String(row.serializeMs).padStart(7)} ms  ${String(row.fingerprintMs).padStart(8)} ms  ${String(row.gzipMs).padStart(4)} ms  ${String(row.parseMs).padStart(5)} ms  ${String(row.yearSeconds).padStart(8)} s  ${parts.map(([k, v]) => `${k} ${v}`).join(", ")}`,
    );
  }
  if (out) writeFileSync(out, JSON.stringify({ seed, rows }, null, 2) + "\n");
  return rows;
}
