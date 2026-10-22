/**
 * Compensatory picks (Phase 11b), following CBA Appendix V and Article 6
 * Section 2(a) (`rules.draft.compensatory`):
 *
 * 1. Compensatory free agents (CFAs): unrestricted free agents who signed with
 *    a new club in last year's free agency, excluding veteran-salary-benefit
 *    deals and cheap one-year deals.
 * 2. Each player's Final Numerical Value: his rank in average yearly
 *    compensation among all players (lowest = 1 point), plus last season's
 *    playing time (1 point per percentage point of snaps, if 25% or more;
 *    kickers and punters by kicks and punts) and honors. CFAs in the top 35%
 *    count.
 * 3. Each club's lost CFAs are cancelled by gained ones in an equal or higher
 *    bracket; a net loss earns picks after rounds 3-7 by the lost player's
 *    bracket (at most 4 a club). An equal loss by count earns one pick after
 *    round 7 if the value lost beats the value gained by more than 300.
 * 4. At most one per club in all; fewer are filled with supplemental picks at
 *    the end of round 7, by draft order.
 *
 * Approximations, noted: honors count once the league names All-Pros (Phase
 * 15), punters get points per punt only (no inside-the-20 stat yet), and a CFA
 * traded before the deadline still counts for the club that signed him.
 */
import type { DraftPick, League, Player } from "../league/schema";
import { recordTransaction } from "../contracts/operations";
import { totalValue } from "../contracts/contract";

type Move = League["freeAgentMoves"][number];

export interface CompensatoryAward {
  teamId: string;
  round: number;
  kind: NonNullable<DraftPick["compensatory"]>;
  /** The lost free agent behind it (formula picks), and his value. */
  playerId: number | null;
  value: number;
  reason: string;
}

/** The one-year contract amount that doesn't count for a season (rises every two years). */
function oneYearExclusion(league: League, season: number): number {
  const E = league.rules.draft.compensatory.oneYearExclusion;
  return E.amount + Math.floor(Math.max(0, season - E.from) / E.everyYears) * E.step;
}

/** Playing-time points for a season (Appendix V): snaps if 25% or more, kicks, punts. */
function playingTimePoints(
  league: League,
  p: Player,
  season: number,
  full: { off: number; def: number },
): number {
  const C = league.rules.draft.compensatory;
  let off = 0;
  let def = 0;
  let fga = 0;
  let fgm = 0;
  let punts = 0;
  for (const s of p.stats)
    if (s.season === season) {
      off += s.line.offSnaps ?? 0;
      def += s.line.defSnaps ?? 0;
      fga += s.line.fga ?? 0;
      fgm += s.line.fgm ?? 0;
      punts += s.line.punts ?? 0;
    }
  if (p.position === "K") return fga * C.kickerPoints.perAttempt + fgm * C.kickerPoints.perMade;
  if (p.position === "P") return punts * C.punterPoints.perPunt;
  const share = Math.max(full.off > 0 ? off / full.off : 0, full.def > 0 ? def / full.def : 0);
  return share >= C.minimumSnapShare ? Math.round(share * 100) : 0;
}

/**
 * Every player's Final Numerical Value for last season, and the share of players ranked at or
 * above him (0 = the very top). CFAs use the average yearly compensation of the deal they signed.
 */
function finalValues(
  league: League,
  season: number,
  moves: Move[],
): { value: Map<number, number>; topShare: Map<number, number> } {
  const cfaApy = new Map(moves.map((m) => [m.playerId, m.averagePerYear]));
  const pool = league.players.filter(
    (p) => p.contract !== null || p.stats.some((s) => s.season === season),
  );
  // A full season's snaps on each side: the most any player played.
  const full = { off: 0, def: 0 };
  for (const p of pool) {
    let off = 0;
    let def = 0;
    for (const s of p.stats)
      if (s.season === season) {
        off += s.line.offSnaps ?? 0;
        def += s.line.defSnaps ?? 0;
      }
    full.off = Math.max(full.off, off);
    full.def = Math.max(full.def, def);
  }
  const apy = (p: Player) =>
    cfaApy.get(p.id) ??
    (p.contract ? Math.round(totalValue(p.contract) / p.contract.years.length) : 0);
  // Salary points: rank by average yearly compensation, lowest first (ties share the lower rank).
  const byApy = [...pool].sort((a, b) => apy(a) - apy(b) || a.id - b.id);
  const value = new Map<number, number>();
  byApy.forEach((p, i) => value.set(p.id, i + 1 + playingTimePoints(league, p, season, full)));
  const ranked = [...pool].sort((a, b) => value.get(b.id)! - value.get(a.id)! || a.id - b.id);
  const topShare = new Map<number, number>();
  ranked.forEach((p, i) => topShare.set(p.id, (i + 1) / ranked.length));
  return { value, topShare };
}

/** The round a lost CFA's pick follows, or null if he isn't in the qualifying share. */
function roundFor(league: League, move: Move, share: number): number | null {
  const C = league.rules.draft.compensatory;
  const bracket = C.roundsByTopShare.find(([top]) => share <= top);
  if (!bracket) return null;
  // A veteran (non-quarterback, 10+ accrued seasons) brings no pick before round 5.
  if (move.accruedSeasons >= C.veteranAccruedSeasons && move.position !== "QB")
    return Math.max(bracket[1], C.veteranEarliestRound);
  return bracket[1];
}

/** The compensatory picks a draft year earns, from the previous League Year's free agency. */
export function compensatoryAwards(league: League, draftYear: number): CompensatoryAward[] {
  const C = league.rules.draft.compensatory;
  const lastYear = draftYear - 1;
  const moves = league.freeAgentMoves.filter((m) => m.season === lastYear);
  if (moves.length === 0) return [];
  const { value, topShare } = finalValues(league, lastYear, moves);
  // Contracts that don't count: veteran-salary-benefit deals and cheap one-year deals.
  const counts = (m: Move) => {
    const p = league.players.find((x) => x.id === m.playerId);
    const vsb = p?.contract?.veteranSalaryBenefit === true && p.contract.teamId === m.toTeamId;
    const cheapOneYear = m.years === 1 && m.averagePerYear <= oneYearExclusion(league, lastYear);
    return !vsb && !cheapOneYear;
  };
  type Cfa = Move & { value: number; round: number };
  const cfas: Cfa[] = moves.filter(counts).flatMap((m) => {
    const round = roundFor(league, m, topShare.get(m.playerId) ?? 1);
    return round === null ? [] : [{ ...m, value: value.get(m.playerId) ?? 0, round }];
  });
  const name = (id: number) => {
    const p = league.players.find((x) => x.id === id);
    return p ? `${p.firstName} ${p.lastName}` : `player ${id}`;
  };

  const awards: CompensatoryAward[] = [];
  for (const team of [...league.teams].sort((a, b) => a.id.localeCompare(b.id))) {
    const lost = cfas.filter((c) => c.fromTeamId === team.id).sort((a, b) => b.value - a.value);
    const gained = cfas.filter((c) => c.toTeamId === team.id).sort((a, b) => b.value - a.value);
    if (lost.length === 0) continue;
    // Cancel each lost CFA (best first) with a gained one in an equal or higher bracket:
    // the same bracket if possible, else the lowest higher one.
    const unused = [...gained];
    const unmatched: Cfa[] = [];
    for (const l of lost) {
      const same = unused.findIndex((g) => g.round === l.round);
      const higher = unused
        .map((g, i) => ({ g, i }))
        .filter(({ g }) => g.round < l.round)
        .sort((a, b) => b.g.round - a.g.round)[0];
      const i = same >= 0 ? same : (higher?.i ?? -1);
      if (i >= 0) unused.splice(i, 1);
      else unmatched.push(l);
    }
    const netLoss = lost.length - gained.length;
    if (netLoss > 0) {
      const earned = unmatched
        .sort((a, b) => a.round - b.round || b.value - a.value)
        .slice(0, Math.min(netLoss, C.maxPerClub));
      for (const l of earned)
        awards.push({
          teamId: team.id,
          round: l.round,
          kind: "formula",
          playerId: l.playerId,
          value: l.value,
          reason: `Net loss of free agents in ${lastYear} (lost ${lost.length}, signed ${gained.length}); for ${name(l.playerId)} (${l.position}), who signed with ${l.toTeamId} at $${(l.averagePerYear / 1_000_000).toFixed(2)}M a year.`,
        });
    } else if (netLoss === 0) {
      const lostValue = lost.reduce((s, c) => s + c.value, 0);
      const gainedValue = gained.reduce((s, c) => s + c.value, 0);
      if (lostValue - gainedValue > C.equalLossPoints)
        awards.push({
          teamId: team.id,
          round: league.rules.draft.rounds,
          kind: "equal-loss",
          playerId: null,
          value: lostValue - gainedValue,
          reason: `Lost as many free agents as it signed in ${lastYear} (${lost.length}), but ${lostValue - gainedValue} points more value (more than ${C.equalLossPoints}).`,
        });
    }
  }
  // At most as many as there are clubs: the lowest (latest round, least value) go first.
  const formula = awards
    .filter((a) => a.kind === "formula")
    .sort((a, b) => a.round - b.round || b.value - a.value || a.teamId.localeCompare(b.teamId));
  const equal = awards
    .filter((a) => a.kind === "equal-loss")
    .sort((a, b) => b.value - a.value || a.teamId.localeCompare(b.teamId));
  const kept = [...formula, ...equal].slice(0, league.teams.length);
  // Fewer than one per club: supplemental picks at the end of round 7, by draft order.
  const order = league.draftPicks
    .filter((p) => p.season === draftYear && p.round === 1 && p.compensatory === null)
    .sort((a, b) => (a.overall ?? 0) - (b.overall ?? 0))
    .map((p) => p.originalTeamId);
  for (let i = 0; kept.length < league.teams.length && i < order.length * 4; i++)
    kept.push({
      teamId: order[i % order.length]!,
      round: league.rules.draft.rounds,
      kind: "supplemental",
      playerId: null,
      value: 0,
      reason:
        "A supplemental pick: fewer compensatory picks were earned than there are clubs, so the rest go to clubs by draft order (CBA Article 6, Section 2(a)).",
    });
  return kept;
}

/**
 * Adds a draft's compensatory picks (at the new League Year) and numbers every pick: each round's
 * regular picks, then its compensatory picks (most valuable lost free agent first); after round
 * 7's, equal-loss picks, then supplemental ones.
 */
export function awardCompensatoryPicks(league: League, draftYear = league.season): number {
  if (league.draftPicks.some((p) => p.season === draftYear && p.compensatory !== null)) return 0;
  const awards = compensatoryAwards(league, draftYear);
  // Free-agent moves older than last year's aren't needed again.
  league.freeAgentMoves = league.freeAgentMoves.filter((m) => m.season >= draftYear - 1);
  if (awards.length === 0) return 0;
  const kindOrder = { formula: 0, "equal-loss": 1, supplemental: 2 } as const;
  const added: (DraftPick & { award: CompensatoryAward })[] = awards.map((award) => ({
    id: league.nextIds.draftPick++,
    season: draftYear,
    round: award.round,
    originalTeamId: award.teamId,
    ownerTeamId: award.teamId,
    overall: null,
    compensatory: award.kind,
    selection: null,
    award,
  }));
  const regular = league.draftPicks
    .filter((p) => p.season === draftYear)
    .sort((a, b) => (a.overall ?? 0) - (b.overall ?? 0) || a.id - b.id);
  const ordered: DraftPick[] = [];
  for (let round = 1; round <= league.rules.draft.rounds; round++) {
    ordered.push(...regular.filter((p) => p.round === round));
    ordered.push(
      ...added
        .filter((p) => p.round === round)
        .sort(
          (a, b) =>
            kindOrder[a.award.kind] - kindOrder[b.award.kind] ||
            b.award.value - a.award.value ||
            a.id - b.id,
        ),
    );
  }
  ordered.forEach((p, i) => (p.overall = i + 1));
  for (const p of added) {
    const { award, ...pick } = p;
    league.draftPicks.push({ ...pick, overall: p.overall });
    recordTransaction(league, {
      type: "compensatory",
      teamIds: [award.teamId],
      playerIds: award.playerId === null ? [] : [award.playerId],
      text: `${award.teamId} was awarded a compensatory pick: round ${award.round}, #${p.overall} overall${award.kind === "supplemental" ? " (supplemental)" : ""}.`,
      reason: award.reason,
    });
  }
  return added.length;
}
