/**
 * Derived shapes from the real history (Phase 15), committed in calibration/awards.json: no names,
 * only counts. They calibrate the voters (which positions win each award, how many All-Pro and
 * Pro Bowl spots each position gets) and the Hall of Fame report (class sizes).
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "../matchups";
import { pageFile } from "./fetch";
import { tableRows } from "./html";
import { ourPosition, parseAllPro, parseAwards, parseHallOfFame } from "./parse";

export const AWARDS_FILE = join(ROOT, "calibration", "awards.json");

const round = (x: number, d = 3) => Math.round(x * 10 ** d) / 10 ** d;

export function calibrate(): void {
  const awards = parseAwards();
  const winnerMix: Record<string, Record<string, number>> = {};
  const since = 1999;
  for (const award of ["mvp", "opoy", "dpoy", "oroy", "droy", "comeback"]) {
    const wins = awards.filter((a) => a.award === award && a.season >= since);
    const counts: Record<string, number> = {};
    for (const a of wins) {
      const p = ourPosition(a.position) ?? "other";
      counts[p] = (counts[p] ?? 0) + 1;
    }
    winnerMix[award] = Object.fromEntries(
      Object.entries(counts)
        .sort((x, y) => y[1] - x[1])
        .map(([k, v]) => [k, round(v / Math.max(1, wins.length))]),
    );
  }
  // All-Pro first-team spots per position (the last ten seasons' average).
  const slots: Record<string, number> = {};
  const recent = parseAllPro().filter((a) => a.team === "first" && a.season >= 2016);
  const seasons = new Set(recent.map((a) => a.season)).size || 1;
  for (const a of recent) {
    const p = ourPosition(a.position);
    if (p) slots[p] = (slots[p] ?? 0) + 1;
  }
  const allProSlots = Object.fromEntries(
    Object.entries(slots).map(([k, v]) => [k, Math.max(1, Math.round(v / seasons))]),
  );
  // Pro Bowl spots per conference, from the latest roster, if it's fetched.
  const proBowlSlots = readProBowlSlots();
  // Hall of Fame: players inducted a year in the modern era.
  const classes = new Map<number, number>();
  for (const m of parseHallOfFame())
    if (m.kind === "player" && m.inducted >= 2006 && m.inducted <= 2026)
      classes.set(m.inducted, (classes.get(m.inducted) ?? 0) + 1);
  const sizes = [...classes.values()];
  const previous = existsSync(AWARDS_FILE) ? JSON.parse(readFileSync(AWARDS_FILE, "utf8")) : {};
  const out = {
    source:
      "Derived by `npm run pipeline -- history` from the AP award winners since 1999, the AP All-Pro teams 2016-25, the 2025 Pro Bowl rosters and the Hall of Fame's classes 2006-26 (reference pages archived in early 2026). Counts only; no names.",
    winnerMix,
    allProSlots: Object.keys(allProSlots).length ? allProSlots : previous.allProSlots,
    proBowlSlots: Object.keys(proBowlSlots).length ? proBowlSlots : previous.proBowlSlots,
    hallOfFame: {
      playerClassMean: round(sizes.reduce((a, b) => a + b, 0) / Math.max(1, sizes.length), 2),
      playerClassMin: Math.min(...sizes),
      playerClassMax: Math.max(...sizes),
      note: "Players inducted a year, 2006-26 (2020's centennial class was 15). The bylaws' total including coaches and contributors is in rules/2026.json.",
    },
  };
  writeFileSync(AWARDS_FILE, JSON.stringify(out, null, 2) + "\n");
  console.log(`Wrote ${AWARDS_FILE}`);
  console.log(JSON.stringify({ winnerMix, allProSlots, hall: out.hallOfFame }, null, 1));
}

/**
 * Pro Bowl spots per conference in the latest roster. Players marked "+" are replacements for
 * those who couldn't play (the original ballot's size is what's counted); the quarterbacks come
 * out at three a conference, as the league's rosters do.
 */
function readProBowlSlots(): Record<string, number> {
  const file = pageFile("years/2025/probowl.htm");
  if (!existsSync(file)) return {};
  const counts: Record<string, number> = {};
  for (const r of tableRows(readFileSync(file, "utf8"), "pro_bowl")) {
    if (r.player?.text.endsWith("+")) continue;
    const p = ourPosition(r.pos?.text ?? "");
    if (p) counts[p] = (counts[p] ?? 0) + 1;
  }
  return Object.fromEntries(
    Object.entries(counts).map(([k, v]) => [k, Math.max(1, Math.ceil(v / 2))]),
  );
}
