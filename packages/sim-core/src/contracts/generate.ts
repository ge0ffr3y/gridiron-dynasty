/**
 * Contracts for players the real data doesn't cover (Phase 7): every player
 * in a fictional league, re-signings at a new League Year, and older saves.
 *
 * A player's market value comes from his rank at his tag category (Article
 * 10's eleven groups), anchored to the category's top salaries (the franchise
 * tag): the best are paid about like the tag, an average starter around 40%
 * of it, backups near the minimum. Phase 7b refits this to the real market
 * and Phase 12 replaces it with negotiation.
 */
import { dmath, overallAt, type Dollars, type Rng } from "@fgm/foundation";
import type { Contract, ContractYear, League, Player } from "../league/schema";
import type { TagCategory } from "../rules";
import { minimumSalary, rookieSlot, salaryCap, tagCategory } from "./cap";
import { prorationSeasons } from "./contract";
import { capSheet } from "./team";

export const MARKET = {
  /** Starters per team in each tag category (who counts as a starter when ranking). */
  starters: {
    QB: 1,
    RB: 1,
    WR: 3,
    TE: 1,
    OL: 5,
    DE: 2,
    DT: 2,
    LB: 2,
    CB: 3,
    S: 2,
    ST: 2,
  } as Record<TagCategory, number>,
  /** Share of the category's franchise tag at the very top, and how fast it falls off by starter rank. */
  topShare: 1.25,
  falloff: 1.6,
  /** A floor above the minimum for anyone who starts. */
  starterFloorShare: 0.04,
  /** Backups: a small premium over the minimum, by how close they are to starting. */
  backupPremiumOfCap: 0.004,
  /** Contract length by age: younger players sign longer. */
  yearsByAge: [
    [25, 4],
    [28, 3],
    [31, 2],
    [99, 1],
  ] as [number, number][],
  /** Signing bonus as a share of total value, rising with pay. */
  bonusShareMax: 0.45,
  /** Pay above this share of the cap gets guaranteed salary in its first years. */
  guaranteedFromShareOfCap: 0.02,
  guaranteedYears: 2,
  /** Chance a well-paid contract carries void years (to spread its bonus). */
  voidYearChance: 0.25,
  /** Some veteran deals carry a playing-time incentive each year (a share of the yearly value). */
  incentiveChance: 0.2,
  incentiveShare: 0.05,
  incentiveGames: 12,
  /** Room a fictional team keeps under the cap at the start, on average (share of the cap). */
  targetRoomShare: 0.06,
};

const ageOn = (birthDate: string, date: string) => {
  const [by, bm, bd] = birthDate.split("-").map(Number) as [number, number, number];
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return y - by - (m < bm || (m === bm && d < bd) ? 1 : 0);
};

/** Each rostered player's rank (1 = best) at his tag category, by true overall. */
export function marketRanks(league: League): Map<number, { category: TagCategory; rank: number }> {
  const cap = league.rules.cap;
  const groups = new Map<TagCategory, Player[]>();
  for (const p of league.players) {
    if (p.teamId === null) continue;
    const c = tagCategory(cap, p.position);
    groups.set(c, [...(groups.get(c) ?? []), p]);
  }
  const out = new Map<number, { category: TagCategory; rank: number }>();
  for (const [category, list] of groups) {
    list
      .sort(
        (a, b) =>
          overallAt(b.ratings, b.position) - overallAt(a.ratings, a.position) || a.id - b.id,
      )
      .forEach((p, i) => out.set(p.id, { category, rank: i + 1 }));
  }
  return out;
}

/** Average yearly value for a player of this rank at a category, in a League Year. */
export function marketValue(
  league: League,
  season: number,
  category: TagCategory,
  rank: number,
  creditedSeasons: number,
  scale = 1,
): Dollars {
  const cap = league.rules.cap;
  const minimum = minimumSalary(cap, season, creditedSeasons);
  // The category's top-five average (the 2026 franchise tag), grown with the cap.
  const tag = (cap.tags.franchise2026[category] * salaryCap(cap, season)) / salaryCap(cap, 2026);
  const slots = league.teams.length * MARKET.starters[category];
  const q = (rank - 1) / slots;
  if (q < 1) {
    const share = MARKET.topShare * dmath.pow(1 - q, MARKET.falloff) + MARKET.starterFloorShare;
    return Math.max(minimum, Math.round(tag * share * scale));
  }
  // Backups: close to the minimum, a little more for the first ones off the bench.
  const nearness = Math.max(0, 1 - (q - 1));
  return (
    minimum + Math.round(salaryCap(cap, season) * MARKET.backupPremiumOfCap * nearness * scale)
  );
}

function blankYear(season: number, base: Dollars): ContractYear {
  return {
    season,
    base,
    guaranteed: 0,
    injuryGuaranteed: 0,
    vestsOn: null,
    rosterBonus: 0,
    workoutBonus: 0,
    perGameBonus: 0,
    incentives: [],
    void: false,
  };
}

/** A veteran contract worth `apy` a year for `years` years from `season`, with a typical structure. */
export function veteranContract(
  league: League,
  rng: Rng,
  p: Player,
  teamId: string,
  season: number,
  apy: Dollars,
  years: number,
  type: Contract["type"] = "veteran",
): Contract {
  const cap = league.rules.cap;
  const capNow = salaryCap(cap, season);
  const minimum = minimumSalary(cap, season, p.experience);
  const total = apy * years;
  // Big deals carry big bonuses; minimum deals none.
  const payShare = Math.min(1, apy / (capNow * 0.15));
  const bonus =
    apy <= minimum * 1.2
      ? 0
      : Math.round(total * MARKET.bonusShareMax * payShare * rng.range(0.6, 1));
  // Salaries rise a little each year; the first year stays at least the minimum.
  const salaryTotal = total - bonus;
  const weights = Array.from({ length: years }, (_, i) => 1 + 0.1 * i);
  const weightSum = weights.reduce((a, b) => a + b, 0);
  const yearsOut: ContractYear[] = weights.map((w, i) =>
    blankYear(
      season + i,
      Math.max(
        minimumSalary(cap, season + i, p.experience + i),
        Math.round((salaryTotal * w) / weightSum),
      ),
    ),
  );
  if (apy >= capNow * MARKET.guaranteedFromShareOfCap)
    for (const y of yearsOut.slice(0, MARKET.guaranteedYears)) y.guaranteed = y.base;
  // A playing-time incentive: "likely to be earned" if he played that much the season before.
  if (apy > 2 * minimum && rng.chance(MARKET.incentiveChance)) {
    const playedLastYear =
      (p.stats.find((st) => st.season === season - 1)?.line.gp ?? 0) >= MARKET.incentiveGames;
    for (const y of yearsOut)
      y.incentives = [
        {
          amount: Math.round(apy * MARKET.incentiveShare),
          games: MARKET.incentiveGames,
          likely: playedLastYear,
        },
      ];
  }
  let contract: Contract = {
    teamId,
    type,
    signedOn: league.date,
    years: yearsOut,
    bonuses: [],
    fifthYearOption: null,
    veteranSalaryBenefit: false,
  };
  if (bonus > 0) {
    // Some teams spread big bonuses further with void years.
    const voidYears =
      years < cap.maxProrationYears && rng.chance(MARKET.voidYearChance * payShare)
        ? rng.intBetween(1, cap.maxProrationYears - years)
        : 0;
    for (let i = 0; i < voidYears; i++)
      contract.years.push({ ...blankYear(season + years + i, 0), void: true });
    contract = {
      ...contract,
      bonuses: [
        {
          amount: bonus,
          kind: "signing",
          seasons: prorationSeasons(contract, season, cap.maxProrationYears),
          paidIn: season,
        },
      ],
    };
  }
  return contract;
}

/** A rookie contract by draft slot (four years; first-rounders get a fifth-year option). */
export function rookieContract(
  league: League,
  p: Player,
  teamId: string,
  draftSeason: number,
  overallPick: number,
): Contract {
  const rules = league.rules;
  const slot = rookieSlot(rules, draftSeason, overallPick);
  const years = rules.cap.rookieScale.years;
  // Year one at the minimum, then equal raises (each year at least that year's minimum).
  const salaryTotal = slot.total - slot.signingBonus;
  const firstYear = slot.minimums[0]!;
  const step = Math.max(
    0,
    Math.round((salaryTotal - years * firstYear) / ((years * (years - 1)) / 2)),
  );
  const yearsOut = Array.from({ length: years }, (_, i) =>
    blankYear(draftSeason + i, Math.max(slot.minimums[i]!, firstYear + step * i)),
  );
  // Rookie deals for early picks are fully guaranteed; later picks get the bonus only.
  if (overallPick <= 64)
    for (const y of yearsOut.slice(0, overallPick <= 32 ? years : 2)) y.guaranteed = y.base;
  const contract: Contract = {
    teamId,
    type: "rookie",
    signedOn: `${draftSeason}-05-15`,
    years: yearsOut,
    bonuses: [],
    fifthYearOption:
      overallPick <= league.teams.length ? { season: draftSeason + years, exercised: null } : null,
    veteranSalaryBenefit: false,
  };
  if (slot.signingBonus > 0)
    contract.bonuses.push({
      amount: slot.signingBonus,
      kind: "signing",
      seasons: yearsOut.map((y) => y.season).slice(0, rules.cap.maxProrationYears),
      paidIn: draftSeason,
    });
  return contract;
}

/** Years a veteran signs for, by age. */
export function yearsForAge(rng: Rng, age: number): number {
  const base = MARKET.yearsByAge.find(([upTo]) => age <= upTo)![1];
  return Math.max(1, base + (rng.chance(0.3) ? rng.pick([-1, 1]) : 0));
}

/** What a rookie deal costs on the cap this League Year, for budgeting. */
function rookieCost(league: League, p: Player): Dollars {
  const slot = rookieSlot(league.rules, p.drafted!.season, p.drafted!.pick);
  return Math.round(slot.total / league.rules.cap.rookieScale.years);
}

const onRookieDeal = (league: League, p: Player) =>
  !!p.drafted && p.experience < league.rules.cap.rookieScale.years;

/**
 * The multiplier on market value that makes the league's payroll fit its cap:
 * all veterans priced at their market value, plus rookie deals, come to the
 * cap minus the room teams typically keep. Re-signings use it each year, so
 * the market grows with the cap.
 */
export function leagueMarketScale(league: League, season: number): number {
  const ranks = marketRanks(league);
  const cap = league.rules.cap;
  let rookies = 0;
  const veterans: { category: TagCategory; rank: number; cs: number }[] = [];
  for (const p of league.players) {
    if (p.teamId === null) continue;
    if (onRookieDeal(league, p)) rookies += rookieCost(league, p);
    else veterans.push({ ...ranks.get(p.id)!, cs: p.experience });
  }
  const target =
    league.teams.length * salaryCap(cap, season) * (1 - MARKET.targetRoomShare) - rookies;
  let scale = 1;
  for (let i = 0; i < 4; i++) {
    const total = veterans.reduce(
      (a, v) => a + marketValue(league, season, v.category, v.rank, v.cs, scale),
      0,
    );
    scale *= target / Math.max(1, total);
  }
  return scale;
}

/**
 * Gives every rostered player a contract (fictional leagues, older saves):
 * young drafted players a rookie deal by their slot (already partly served),
 * everyone else a veteran deal at his market value, signed in an earlier
 * year so some of it is behind him. Each team's veteran pay is scaled so the
 * team starts with a realistic amount of room (0-12% of the cap), not just
 * the league on average: real teams' payrolls cluster near the cap.
 */
export function generateContracts(league: League, rng: Rng): void {
  const season = league.season;
  const ranks = marketRanks(league);
  const cap = league.rules.cap;
  const capNow = salaryCap(cap, season);
  for (const team of league.teams) {
    const roster = league.players.filter((p) => p.teamId === team.id).sort((a, b) => a.id - b.id);
    const roomShare = rng.range(0, 2 * MARKET.targetRoomShare);
    const rookies = roster.filter((p) => onRookieDeal(league, p));
    const veterans = roster
      .filter((p) => !onRookieDeal(league, p))
      .map((p) => {
        const age = ageOn(p.birthDate, league.date);
        const length = yearsForAge(rng, age + 1);
        return { p, ...ranks.get(p.id)!, length, served: rng.int(length) };
      });
    const budget =
      capNow * (1 - roomShare) - rookies.reduce((a, p) => a + rookieCost(league, p), 0);
    let scale = 1;
    for (let i = 0; i < 4; i++) {
      const total = veterans.reduce(
        (a, v) => a + marketValue(league, season, v.category, v.rank, v.p.experience, scale),
        0,
      );
      scale *= budget / Math.max(1, total);
    }
    for (const p of rookies)
      p.contract = rookieContract(league, p, team.id, p.drafted!.season, p.drafted!.pick);
    for (const v of veterans) {
      const apy = marketValue(league, season, v.category, v.rank, v.p.experience, scale);
      // Signed `served` years ago: the years behind him are dropped, so only what's left shows.
      const full = veteranContract(league, rng, v.p, team.id, season - v.served, apy, v.length);
      full.years = full.years.filter((y) => y.season >= season);
      if (full.years.length === 0) full.years = [blankYear(season, apy)];
      v.p.contract = full;
    }
    // This year's cap hits differ from the yearly values (rising salaries, bonuses spread
    // further, and in the offseason only the top 51 count), so settle the team on its
    // actual cap sheet: scale the veterans' deals until the room is what we chose.
    const target = capNow * (1 - roomShare);
    for (let i = 0; i < 5; i++) {
      const sheet = capSheet(league, team.id, season);
      const vets = new Set(veterans.map((v) => v.p.id));
      const vetCounted = sheet.lines
        .filter((l) => vets.has(l.playerId))
        .reduce((a, l) => a + l.counted, 0);
      const factor = 1 + (target - sheet.total) / Math.max(1, vetCounted);
      for (const v of veterans) v.p.contract = scaleContract(league, v.p, v.p.contract!, factor);
    }
  }
}

/** Every dollar of a contract times `factor` (salaries kept at or above the minimum). */
function scaleContract(league: League, p: Player, c: Contract, factor: number): Contract {
  const cap = league.rules.cap;
  return {
    ...c,
    years: c.years.map((y) => {
      if (y.void) return y;
      const base = Math.max(
        minimumSalary(cap, y.season, p.experience + (y.season - league.season)),
        Math.round(y.base * factor),
      );
      return { ...y, base, guaranteed: Math.min(base, Math.round(y.guaranteed * factor)) };
    }),
    bonuses: c.bonuses.map((b) => ({ ...b, amount: Math.round(b.amount * factor) })),
  };
}
