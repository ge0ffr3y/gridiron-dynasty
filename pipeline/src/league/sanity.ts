/**
 * The sanity-check sheet (Phase 6b): the top 10 at every position by our
 * overall, with real names and 2025 numbers next to them, and every team's
 * strength next to its real 2025 record. For the owner's eyes only: it's
 * written to pipeline/private/out/ and never committed.
 */
import { overallAt, POSITIONS, type League } from "@fgm/sim-core";
import type { Row } from "../matchups";
import { num } from "../matchups";
import type { MaddenPlayer } from "./madden";
import type { Adjustment } from "./performance";
import type { RealPerson } from "./roster";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");

/** A short line of 2025 production for a position. */
function production(position: string, s: Row | undefined): string {
  if (!s) return "";
  const v = (k: string) => num(s[k]) || 0;
  switch (position) {
    case "QB":
      return `${v("passing_yards")} yds, ${v("passing_tds")} TD, ${v("passing_interceptions")} INT, EPA/play ${(
        (v("passing_epa") + v("rushing_epa")) /
        Math.max(1, v("attempts") + v("sacks_suffered") + v("carries"))
      ).toFixed(2)}`;
    case "RB":
      return `${v("carries")} car, ${v("rushing_yards")} rush yds, ${v("receiving_yards")} rec yds, ${v("rushing_tds") + v("receiving_tds")} TD`;
    case "WR":
    case "TE":
      return `${v("receptions")}/${v("targets")}, ${v("receiving_yards")} yds, ${v("receiving_tds")} TD`;
    case "EDGE":
    case "DT":
      return `${v("def_sacks")} sacks, ${v("def_qb_hits")} QB hits, ${v("def_tackles_for_loss")} TFL`;
    case "LB":
      return `${v("def_tackles_solo") + v("def_tackle_assists")} tkl, ${v("def_sacks")} sacks, ${v("def_interceptions")} INT`;
    case "CB":
    case "S":
      return `${v("def_interceptions")} INT, ${v("def_pass_defended")} PD, ${v("def_tackles_solo") + v("def_tackle_assists")} tkl`;
    case "K":
      return `${v("fg_made")}/${v("fg_att")} FG, long ${v("fg_long")}`;
    case "P":
      return `${v("pt_att")} punts, ${(v("pt_yards") / Math.max(1, v("pt_att"))).toFixed(1)} avg`;
    default:
      return "";
  }
}

export function sanitySheet(input: {
  league: League;
  people: RealPerson[];
  madden: Map<string, MaddenPlayer>;
  adjustments: Adjustment[];
  stats: Row[];
  games: Row[];
  /** Fictional full name -> real player id (names are unique in the league). */
  keyByName: Map<string, string>;
}): string {
  const { league } = input;
  const byKey = new Map(input.people.map((p) => [p.gsis, p]));
  const stats = new Map(input.stats.map((s) => [s.player_id ?? "", s]));
  const adjusted = new Map(input.adjustments.map((a) => [a.gsis, a]));
  const parts: string[] = [];
  parts.push(`<h1>Real league sanity sheet</h1>
<p>Top 10 at each position by our overall. "Start" is the overall from Madden's start-of-2025 ratings (on our scale);
"2025" is where 2025 production alone would put him; "Ours" is the rating the league uses. Real names appear only here.</p>`);

  // Team strength vs. the real 2025 record.
  const record = new Map<string, [number, number]>();
  for (const g of input.games) {
    if (g.season !== "2025" || g.game_type !== "REG") continue;
    const ids: Record<string, string> = { NYJ: "NYA", NYG: "NYB", LAC: "LAA", LA: "LAB" };
    const h = ids[g.home_team!] ?? g.home_team!;
    const a = ids[g.away_team!] ?? g.away_team!;
    const hw = num(g.home_score) > num(g.away_score);
    const aw = num(g.away_score) > num(g.home_score);
    for (const [t, w, l] of [
      [h, hw, aw],
      [a, aw, hw],
    ] as const) {
      const r = record.get(t) ?? [0, 0];
      record.set(t, [r[0] + (w ? 1 : 0), r[1] + (l ? 1 : 0)]);
    }
  }
  const STARTERS: Record<string, number> = {
    QB: 1,
    RB: 1,
    WR: 3,
    TE: 1,
    OT: 2,
    OG: 2,
    C: 1,
    EDGE: 2,
    DT: 2,
    LB: 2,
    CB: 3,
    S: 2,
  };
  const strength = league.teams
    .map((t) => {
      let sum = 0;
      let count = 0;
      for (const [pos, n] of Object.entries(STARTERS)) {
        const best = league.players
          .filter((p) => p.teamId === t.id && p.position === pos)
          .map((p) => overallAt(p.ratings, p.position))
          .sort((a, b) => b - a)
          .slice(0, n);
        sum += best.reduce((a, b) => a + b, 0);
        count += best.length;
      }
      const qb = league.players
        .filter((p) => p.teamId === t.id && p.position === "QB")
        .map((p) => overallAt(p.ratings, "QB"))
        .sort((a, b) => b - a)[0];
      return { id: t.id, avg: sum / count, qb: qb ?? 0, rec: record.get(t.id) ?? [0, 0] };
    })
    .sort((a, b) => b.avg - a.avg);
  parts.push(
    `<h2>Teams by starters' average</h2><table><tr><th>Team</th><th>Starters</th><th>QB</th><th>Real 2025</th></tr>${strength
      .map(
        (t) =>
          `<tr><td>${t.id}</td><td>${t.avg.toFixed(1)}</td><td>${t.qb}</td><td>${t.rec[0]}-${t.rec[1]}</td></tr>`,
      )
      .join("")}</table>`,
  );

  for (const position of POSITIONS) {
    const top = league.players
      .filter((p) => p.position === position)
      .map((p) => ({ p, key: input.keyByName.get(`${p.firstName} ${p.lastName}`)! }))
      .sort((a, b) => overallAt(b.p.ratings, position) - overallAt(a.p.ratings, position))
      .slice(0, 10);
    parts.push(
      `<h2>${position}</h2><table><tr><th>Real name</th><th>Team</th><th>Age</th><th>Snaps</th><th>Start</th><th>2025</th><th>Ours</th><th>2025 production</th><th>In-game name</th></tr>`,
    );
    for (const { p, key } of top) {
      const real = byKey.get(key)!;
      const a = adjusted.get(key);
      const share = Math.max(
        real.snapShare.offense,
        real.snapShare.defense,
        real.snapShare.special,
      );
      const age = 2026 - Number(p.birthDate.slice(0, 4));
      parts.push(
        `<tr><td>${esc(`${real.otherFirst[0] || real.realFirst} ${real.realLast}`)}</td><td>${p.teamId ?? "FA"}</td><td>${age}</td><td>${Math.round(100 * share)}%</td>` +
          `<td>${a ? a.before : input.madden.has(key) ? overallAt(p.ratings, position) : "-"}</td><td>${a ? a.implied : "-"}</td>` +
          `<td><b>${overallAt(p.ratings, position)}</b></td><td>${esc(production(position, stats.get(key)))}</td><td>${esc(`${p.firstName} ${p.lastName}`)}</td></tr>`,
      );
    }
    parts.push("</table>");
  }
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Sanity sheet</title>
<style>body{font:14px system-ui,sans-serif;margin:24px;max-width:1100px;color:#1a1a1a;background:#fafaf9}table{border-collapse:collapse;margin:8px 0 24px;width:100%}
th,td{border-bottom:1px solid #ddd;padding:4px 8px;text-align:left}th{background:#f0efed}td:nth-child(n+3):not(:nth-child(8)):not(:nth-child(9)){text-align:right}
@media (prefers-color-scheme: dark){body{background:#161615;color:#e8e6e3}th{background:#262624}th,td{border-color:#3a3a38}}</style></head><body>${parts.join("\n")}</body></html>`;
}
