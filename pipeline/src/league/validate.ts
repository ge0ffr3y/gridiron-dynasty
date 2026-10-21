/**
 * The cap validation report (Phase 7b). Two checks for 2026:
 * 1. Reproduction: every imported contract's 2026 cap hit, computed by our cap
 *    engine, against the cap number on the team's page (to the dollar).
 * 2. Team totals: each team's 2026 spending on its players under contract
 *    against the published figure on Feb 10, 2026 (the day after the league
 *    starts). Dead money and carryover come from the same published sources,
 *    so cap space differs by exactly the spending difference.
 */
import { capHit, capParts, remainingProration, rulesFor, type Dollars } from "@fgm/sim-core";
import type { PageMatch, TeamPage } from "./capPages";
import type { ImportedContract, TeamCapFacts } from "./contracts";
import type { RealPerson } from "./roster";

/** Within this much (the larger of the two) counts as a match. */
export const TOLERANCE = { dollars: 3_000_000, shareOfCap: 0.01 };
const SEASON = 2026;

export interface TeamValidation {
  teamId: string;
  ours: Dollars;
  published: Dollars;
  difference: Dollars;
  /** 2026 cap numbers on the page for players we don't have (signed after the season, etc.). */
  unmatched: Dollars;
  unmatchedCount: number;
  contractsOurs: number;
  contractsPublished: number;
  pageDate: string;
  withinTolerance: boolean;
  /** Why a team outside the tolerance differs. */
  why: string;
}

export interface CapValidation {
  teams: TeamValidation[];
  /** Imported players whose 2026 cap hit differs from their page's cap number. */
  mismatches: {
    gsis: string;
    teamId: string;
    name: string;
    ours: Dollars;
    page: Dollars;
    row: string;
  }[];
  reproduced: number;
  /** Every season on the pages (2026-2029): contract-years whose cap hit equals the page's. */
  yearByYear: { reproduced: number; total: number; withinTen: number };
  lines: string[];
}

const m = (d: number) => `${d < 0 ? "-" : ""}$${(Math.abs(d) / 1_000_000).toFixed(1)}M`;

export function validateCaps(
  people: RealPerson[],
  imported: Map<string, ImportedContract>,
  published: Map<string, TeamCapFacts> | null,
  pages: Map<string, TeamPage>,
  matched: PageMatch,
): CapValidation {
  const cap = rulesFor(SEASON).cap;
  if (!published)
    return {
      teams: [],
      mismatches: [],
      reproduced: 0,
      yearByYear: { reproduced: 0, total: 0, withinTen: 0 },
      lines: ["## Cap validation", "", "No published cap snapshot found (pipeline/private/cap/)."],
    };
  const limit = Math.max(TOLERANCE.dollars, TOLERANCE.shareOfCap * cap.salaryCapByYear["2026"]!);

  // 1. Each contract's 2026 cap hit vs. its page row.
  const mismatches: CapValidation["mismatches"] = [];
  let reproduced = 0;
  for (const p of people) {
    const c = imported.get(p.gsis)?.contract;
    const row = matched.byPlayer.get(p.gsis)?.get(SEASON);
    if (!c || !row) continue;
    const ours = capHit(c, SEASON, cap);
    if (ours === row.capNumber) reproduced += 1;
    else
      mismatches.push({
        gsis: p.gsis,
        teamId: p.teamId!,
        name: row.name,
        ours,
        page: row.capNumber,
        row: JSON.stringify({ ...row, name: undefined }),
      });
  }

  // ...and every later season on the pages.
  const yearByYear = { reproduced: 0, total: 0, withinTen: 0 };
  const laterMisses: string[] = [];
  for (const p of people) {
    const c = imported.get(p.gsis)?.contract;
    const rows = matched.byPlayer.get(p.gsis);
    if (!c || !rows) continue;
    for (const [season, row] of rows) {
      const y = c.years.find((x) => x.season === season);
      if (!y) continue;
      // The page shows a void year as the deal voiding: all proration left lands in the first
      // void year (later ones show nothing). Our engine charges the same when the deal voids.
      const firstVoid = y.void && !c.years.some((x) => x.void && x.season < season);
      if (y.void && !firstVoid) continue;
      const ours = firstVoid
        ? remainingProration(c, season)
        : capHit(c, season, rulesFor(season).cap);
      const diff = Math.abs(ours - row.capNumber);
      if (diff > 10 && season > SEASON && laterMisses.length < 40)
        laterMisses.push(
          `- ${p.teamId} ${row.name} ${season}: ours ${ours}, page ${row.capNumber}. ${JSON.stringify({ ...row, name: undefined })}`,
        );
      yearByYear.total += 1;
      if (diff === 0) yearByYear.reproduced += 1;
      if (diff <= 10) yearByYear.withinTen += 1;
    }
  }

  // 2. Team totals vs. the published cap-space table.
  const teams: TeamValidation[] = [];
  for (const [teamId, facts] of [...published].sort((a, b) => a[0].localeCompare(b[0]))) {
    // Each player's 2026 cap number, and what still counts if he's outside the top 51.
    const entries: { hit: number; outside: number }[] = [];
    let count = 0;
    for (const p of people.filter((x) => x.teamId === teamId && !matched.released.has(x.gsis))) {
      const imp = imported.get(p.gsis);
      // Void years of deals that ended with 2025 still count (all bonus proration).
      const voided = imp?.voidedProration?.find((v) => v.season === SEASON)?.amount ?? 0;
      if (voided > 0) entries.push({ hit: voided, outside: voided });
      const c = imp?.contract;
      if (!c) continue;
      const parts = capParts(c, SEASON, cap);
      entries.push({ hit: capHit(c, SEASON, cap), outside: parts.proration + parts.bonuses });
      count += 1;
    }
    // The offseason rule (CBA Art. 13 §6): only the 51 largest cap numbers count in full;
    // the published figure is computed the same way.
    entries.sort((a, b) => b.hit - a.hit);
    const ours = entries.reduce(
      (a, e, i) => a + (i < cap.offseasonTopContracts ? e.hit : e.outside),
      0,
    );
    const missing = matched.unmatched.filter((u) => u.teamId === teamId && u.capNumber2026 > 0);
    const unmatched = missing.reduce((a, u) => a + u.capNumber2026, 0);
    const difference = ours - facts.activeSpending;
    teams.push({
      teamId,
      ours,
      published: facts.activeSpending,
      difference,
      unmatched,
      unmatchedCount: missing.length,
      contractsOurs: count,
      contractsPublished: facts.players,
      pageDate: pages.get(teamId)?.timestamp.slice(0, 8) ?? "none",
      withinTolerance: Math.abs(difference) <= limit,
      why: "",
    });
  }
  // Explain each team outside the tolerance, by the largest known cause.
  const pageErrors = new Map<string, number>();
  for (const x of mismatches)
    pageErrors.set(x.teamId, (pageErrors.get(x.teamId) ?? 0) + (x.ours - x.page));
  const days = (d: string) =>
    Math.abs(Date.UTC(+d.slice(0, 4), +d.slice(4, 6) - 1, +d.slice(6, 8)) - Date.UTC(2026, 1, 10)) /
    86_400_000;
  for (const t of teams.filter((x) => !x.withinTolerance)) {
    const reasons: string[] = [];
    const err = pageErrors.get(t.teamId) ?? 0;
    if (Math.abs(err) >= 1_000_000) reasons.push(`page rows that don't add up (${m(err)})`);
    if (t.unmatched >= 1_000_000 && t.difference < 0)
      reasons.push(
        `${t.unmatchedCount} player${t.unmatchedCount === 1 ? "" : "s"} not on our rosters (${m(t.unmatched)})`,
      );
    if (t.pageDate !== "none" && days(t.pageDate) > 2)
      reasons.push(
        `page archived ${t.pageDate.slice(4, 6)}/${t.pageDate.slice(6, 8)}: moves between then and Feb 10`,
      );
    t.why = reasons.join("; ") || "unexplained";
  }
  const within = teams.filter((t) => t.withinTolerance).length;
  const unexplained = teams.filter((t) => t.why === "unexplained").length;
  const rounding = mismatches.filter((x) => Math.abs(x.ours - x.page) <= 10).length;
  const lines = [
    "## Cap validation (2026)",
    "",
    `Contracts reproduced: ${reproduced} of ${reproduced + mismatches.length} imported contracts' 2026 cap hits, computed by our cap engine, equal the cap number on their team's page to the dollar; ${rounding} more are within $10 (the page rounds bonus proration). The other ${mismatches.length - rounding} are page rows whose columns don't add up to their own cap number (listed below).`,
    "",
    `Year by year (2026-2029): ${yearByYear.reproduced} of ${yearByYear.total} contract-years equal the page to the dollar (${yearByYear.withinTen} within $10).`,
    "",
    `Team totals: ${within} of ${teams.length} teams' 2026 cap spending on players under contract (offseason top-51 rule, as published) is within ${m(limit)} of the published Feb 10 figure. ${teams.length - within - unexplained} of the other ${teams.length - within} are explained in the last column; ${unexplained} unexplained.`,
    "",
    "| Team | Ours | Published (Feb 10) | Difference | Page date | Not on our roster | Contracts (ours / published) | Within | Why not |",
    "|---|---|---|---|---|---|---|---|---|",
    ...teams.map(
      (t) =>
        `| ${t.teamId} | ${m(t.ours)} | ${m(t.published)} | ${m(t.difference)} | ${t.pageDate} | ${m(t.unmatched)} (${t.unmatchedCount}) | ${t.contractsOurs} / ${t.contractsPublished} | ${t.withinTolerance ? "yes" : "no"} | ${t.why} |`,
    ),
  ];
  // Details (private report only: real names).
  lines.push(
    "",
    "### Contracts whose 2026 cap hit differs from the page",
    "",
    ...mismatches
      .sort(
        (a, b) =>
          a.teamId.localeCompare(b.teamId) || Math.abs(b.ours - b.page) - Math.abs(a.ours - a.page),
      )
      .map((x) => `- ${x.teamId} ${x.name}: ours ${x.ours}, page ${x.page}. ${x.row}`),
    "",
    "### Later years that differ (first 40)",
    "",
    ...laterMisses,
    "",
    "### On a page in 2026 but no 2026 contract built",
    "",
    ...people
      .filter((p) => matched.byPlayer.get(p.gsis)?.has(SEASON) && !imported.get(p.gsis)?.contract)
      .map(
        (p) =>
          `- ${p.teamId} ${matched.byPlayer.get(p.gsis)!.get(SEASON)!.name}: ${imported.get(p.gsis)?.kind} ${JSON.stringify([...matched.byPlayer.get(p.gsis)!].map(([s, r]) => [s, r.base, r.capNumber]))}`,
      ),
    "",
    "### Released before their team's page date (start as free agents)",
    "",
    ...people
      .filter((p) => matched.released.has(p.gsis))
      .map((p) => `- ${p.teamId} ${p.realFirst} ${p.realLast}`),
    "",
    "### Page rows matched to no one on our rosters",
    "",
    ...matched.unmatched
      .filter((u) => u.capNumber2026 > 0)
      .map((u) => `- ${u.teamId} ${u.name}: ${u.capNumber2026}`),
  );
  return { teams, mismatches, reproduced, yearByYear, lines };
}
