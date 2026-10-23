/**
 * The job (Phase 14b): the owner's view of the person, his budget, getting fired, and the offers
 * that follow.
 *
 * The person is judged exactly like an AI GM (`gmFiringOdds`: results against what the roster
 * should win, playoff droughts, losing runs, cap hell, his contract, the owner's patience and
 * ambition), plus `career.standing`: the owner's reactions to his big moves, which fade by half
 * each season. Every draw is the AI's own (same labels), so nothing reshuffles other teams.
 */
import { Rng, streamSeed } from "@fgm/foundation";
import type { Career, League, Offer } from "../league/schema";
import { cashIn } from "../contracts/contract";
import { salaryCap } from "../contracts/cap";
import { capSheet } from "../contracts/team";
import { marketValue } from "../contracts/market";
import { describeOwner, gmOf, ownerOf, ownerStyle } from "../front-office/executives";
import { gmFiringOdds, hireGm } from "../front-office/owners";
import { recordOf } from "../coaches/carousel";
import { uniformFrom } from "../scouting/noise";
import { currentStandings } from "../season/flow";
import { seasonDates } from "../season/calendar";
import { personTeam } from "./delegation";
import { note } from "./inbox";
import { startCareer } from "./start";

/** Judgment numbers (no real data measures an owner's mood): sizes on the firing log-odds. */
export const JOB = {
  /** The owner's standing with you moves by these (log-odds; + is good for you). */
  react: {
    /** Trading away a star (market value this share of the cap or more). */
    starShare: 0.05,
    starTraded: -0.25,
    /** ...unless the team is rebuilding and the owner is patient. */
    starTradedRebuild: 0.05,
    /** A big free-agent deal (this share of the cap a year or more). */
    bigDealShare: 0.08,
    bigDealSpender: 0.1,
    bigDealMiser: -0.2,
    /** Cap hell: more than this share of the cap in dead money. */
    capHellShare: 0.15,
    capHell: -0.3,
    /** Spending past the owner's budget. */
    overBudget: -0.2,
  },
  /** Standing is kept between these and fades this much each season. */
  standingRange: [-1.5, 1] as [number, number],
  seasonFade: 0.5,
  /** The owner's cash budget a League Year: what the league's typical team pays out (the median),
   * times (1 + this x his budget trait). */
  budgetPerTrait: 0.15,
  /** A meddling owner (this much or more) vetoes a deal that runs past budget by this share. */
  vetoMeddling: 0.4,
  vetoOver: 0.05,
  /** In season, from this week: a GM far below expectations may go (chance per week). */
  inSeason: { fromWeek: 9, toWeek: 15, aboveChance: 0.9, perWeek: 0.04 },
  /** Offers after a firing: at most this many; an owner's interest must clear this. */
  offers: { max: 3, minInterest: 0.05, minReputation: 25 },
};

const name = (e: { firstName: string; lastName: string }) => `${e.firstName} ${e.lastName}`;
const teamName = (league: League, id: string) => {
  const t = league.teams.find((x) => x.id === id);
  return t ? `${t.city} ${t.nickname}` : id;
};
const money = (d: number) => `$${(d / 1_000_000).toFixed(1)}M`;

function rng(league: League, label: string): Rng {
  return new Rng(streamSeed(league.meta.seed, `owners:${league.season}:${label}`));
}

function adjust(league: League, by: number, text: string): void {
  const c = league.career!;
  const [lo, hi] = JOB.standingRange;
  c.standing = Math.max(lo, Math.min(hi, c.standing + by));
  note(league, "owner", "owner", text);
}

// ---------------------------------------------------------------------------
// Job security

export interface JobSecurity {
  /** 0-100: 100 = safe, 0 = he'd almost surely fire you today. */
  score: number;
  /** The chance he'd fire you if the season ended now. */
  chance: number;
  reason: string;
  /** The owner's standing with you (his reactions to your moves), in words. */
  standing: string;
}

function playoffTeams(league: League): Set<string> {
  return new Set(currentStandings(league).seed.keys());
}

export function jobSecurity(league: League): JobSecurity | null {
  const team = personTeam(league);
  if (!team) return null;
  const c = league.career!;
  const odds = gmFiringOdds(league, team, playoffTeams(league), -c.standing);
  return {
    score: Math.round((1 - odds.chance) * 100),
    chance: odds.chance,
    reason: odds.reason,
    standing:
      c.standing >= 0.3
        ? "He likes what you're doing."
        : c.standing <= -0.5
          ? "He's unhappy with your moves."
          : c.standing < 0
            ? "He has doubts about some of your moves."
            : "He's keeping an open mind.",
  };
}

// ---------------------------------------------------------------------------
// The owner's budget and reactions

/** What a team pays its players in cash this League Year (salaries and bonuses). */
function cashOf(league: League, teamId: string): number {
  return league.players
    .filter((p) => p.teamId === teamId && p.contract)
    .reduce((s, p) => s + cashIn(p.contract!, league.season), 0);
}

/** The owner's cash budget this League Year, and what the team pays out. */
export function ownerBudget(league: League, teamId: string): { budget: number; cash: number } {
  const o = ownerStyle(league, teamId);
  const all = league.teams.map((t) => cashOf(league, t.id)).sort((a, b) => a - b);
  const median = all[Math.floor(all.length / 2)] ?? salaryCap(league.rules.cap, league.season);
  return {
    budget: Math.round(median * (1 + JOB.budgetPerTrait * o.budget)),
    cash: cashOf(league, teamId),
  };
}

/**
 * A meddling owner refuses a deal that takes cash far past his budget. Returns his reason, or
 * null if he's fine with it.
 */
export function ownerVeto(league: League, teamId: string, offer: Offer): string | null {
  if (personTeam(league) !== teamId) return null;
  const o = ownerStyle(league, teamId);
  if (o.meddling < JOB.vetoMeddling) return null;
  const { budget, cash } = ownerBudget(league, teamId);
  const firstYear = offer.apy + offer.signingBonus;
  if (cash + firstYear <= budget * (1 + JOB.vetoOver)) return null;
  const owner = ownerOf(league, teamId);
  return `${owner ? name(owner) : "The owner"} vetoed it: "We'd pay out ${money(cash + firstYear)} this year against a budget of ${money(budget)}. Not on my dime."`;
}

/** The owner reacts to the person's moves since he last looked (each a log line). */
export function ownerWatch(league: League): void {
  const team = personTeam(league);
  const c = league.career;
  if (!team || !c) return;
  const R = JOB.react;
  const o = ownerStyle(league, team);
  const cap = salaryCap(league.rules.cap, league.season);
  const fresh = league.transactions.filter((t) => t.id > c.seenTransaction);
  if (fresh.length === 0) return;
  c.seenTransaction = Math.max(...fresh.map((t) => t.id));
  const plan = league.teams.find((t) => t.id === team)!.plan;
  for (const t of fresh) {
    if (!t.teamIds.includes(team)) continue;
    if (t.type === "traded") {
      const gone = t.playerIds
        .map((id) => league.players.find((p) => p.id === id))
        .filter((p) => p && p.teamId !== team && marketValue(league, p).share >= R.starShare);
      for (const p of gone) {
        if (plan?.stance === "rebuild" && o.patience > 0)
          adjust(
            league,
            R.starTradedRebuild,
            `Owner: "Trading ${name(p!)} for the future. I can live with that."`,
          );
        else
          adjust(
            league,
            R.starTraded,
            `Owner: "You traded ${name(p!)}? The fans won't like that, and neither do I."`,
          );
      }
    }
    if (t.type === "signed") {
      for (const id of t.playerIds) {
        const p = league.players.find((x) => x.id === id);
        const apy = p?.contract && p.teamId === team ? (p.contract.years[0]?.base ?? 0) : 0;
        if (!p || apy < cap * R.bigDealShare) continue;
        if (o.budget >= 0.35)
          adjust(
            league,
            R.bigDealSpender,
            `Owner: "${name(p)}. That's the kind of move I hired you to make."`,
          );
        else if (o.budget <= -0.35)
          adjust(
            league,
            R.bigDealMiser,
            `Owner: "That's a lot of my money for ${name(p)}. He'd better be worth it."`,
          );
      }
    }
  }
  // Cap hell, and spending past his budget with your own signings: once a League Year each
  // (before March, the League Year still under way is last season's).
  const thisYear = seasonDates(league.rules, league.season).leagueYear;
  const yearBegan =
    league.date < thisYear ? seasonDates(league.rules, league.season - 1).leagueYear : thisYear;
  const said = (key: string) =>
    c.log.some((l) => l.kind === "owner" && l.text.includes(key) && l.date >= yearBegan);
  const sheet = capSheet(league, team, league.season);
  const dead = sheet.deadMoney / sheet.cap;
  if (dead > R.capHellShare && !said("dead money"))
    adjust(
      league,
      R.capHell,
      `Owner: "${Math.round(dead * 100)}% of our cap is dead money. Clean this up."`,
    );
  // Only money you committed counts against you: not the deals you inherited.
  const yourDeal = fresh.some(
    (t) =>
      t.teamIds.includes(team) &&
      (t.type === "signed" || t.type === "extended" || t.type === "tagged") &&
      t.reason.startsWith("Your decision"),
  );
  const { budget, cash } = ownerBudget(league, team);
  if (yourDeal && cash > budget && !said("budget"))
    adjust(
      league,
      R.overBudget,
      `Owner: "We're paying out ${money(cash)} this year, over my budget of ${money(budget)}."`,
    );
}

// ---------------------------------------------------------------------------
// Firing

/** Black Monday: the owner judges the person like any GM. True if he was fired. */
export function reviewPerson(league: League, inPlayoffs: Set<string>): boolean {
  const team = personTeam(league);
  if (!team) return false;
  const c = league.career!;
  const odds = gmFiringOdds(league, team, inPlayoffs, -c.standing);
  // The same draw an AI GM on this team would get.
  if (!rng(league, `gm:${team}`).chance(odds.chance)) return false;
  firePerson(league, `Fired on Black Monday: ${odds.reason}`);
  return true;
}

/** In season, rarely: a GM far below expectations is let go before the year ends. */
export function inSeasonReview(league: League, week: number): boolean {
  const team = personTeam(league);
  const I = JOB.inSeason;
  if (!team || week < I.fromWeek || week > I.toWeek) return false;
  const c = league.career!;
  const odds = gmFiringOdds(league, team, playoffTeams(league), -c.standing);
  if (odds.chance < I.aboveChance) return false;
  const impatience = Math.max(0, -ownerStyle(league, team).patience);
  if (!rng(league, `in-season-person:${week}`).chance(I.perWeek * (1 + impatience))) return false;
  const gm = gmOf(league, team)!;
  firePerson(league, `Fired after week ${week}: ${odds.reason}`);
  hireGm(league, team, `Takes over during the season after ${name(gm)} was fired.`, false);
  offersAfterReviews(league);
  return true;
}

/** The owner fires the person: his team goes back to an AI GM; offers come from other owners. */
export function firePerson(league: League, reason: string): void {
  const team = personTeam(league)!;
  const c = league.career!;
  const me = gmOf(league, team)!;
  me.career.push({
    season: league.season,
    teamId: team,
    role: "GM",
    record: recordOf(league, team),
    playoffs: false,
  });
  league.executiveMoves.push({
    season: league.season,
    date: league.date,
    kind: "fired",
    executiveId: me.id,
    teamId: team,
    role: "GM",
    text: `${teamName(league, team)} fired general manager ${name(me)}.`,
    reason,
  });
  me.reputation = Math.max(0, me.reputation - 10);
  me.teamId = null;
  me.contractThrough = null;
  note(league, "owner", "owner", reason);
  league.pendingDecisions = league.pendingDecisions.filter((d) => d.teamId !== team);
  league.teams.find((t) => t.id === team)!.controller = "ai";
  league.settings.viewingAs = null;
  c.status = "fired";
  c.teamId = null;
  c.firedFrom = team;
  c.standing = 0;
}

// ---------------------------------------------------------------------------
// Offers

/**
 * Owners who'd hire the person now: teams that changed GMs this season (they'd have taken him
 * instead), then teams whose GM is on the hottest seat, by his reputation and each owner's taste.
 */
export function jobOffers(league: League): Career["offers"] {
  const c = league.career!;
  const me = league.executives.find((e) => e.id === c.executiveId)!;
  const changed = new Set(
    league.executiveMoves
      .filter(
        (m) =>
          m.season === league.season &&
          m.role === "GM" &&
          (m.kind === "fired" || m.kind === "retired" || m.kind === "left"),
      )
      .map((m) => m.teamId)
      .filter((t): t is string => t !== null && t !== c.firedFrom),
  );
  const playoffs = playoffTeams(league);
  const rows = league.teams
    .filter((t) => t.id !== c.firedFrom)
    .map((t) => {
      const gm = gmOf(league, t.id);
      const open = changed.has(t.id);
      const seat = gm && !gm.person ? gmFiringOdds(league, t.id, playoffs).chance : 0;
      const taste =
        uniformFrom(`${league.meta.seed}:offer:${t.id}:${me.id}:${league.season}`) - 0.5;
      const interest = (me.reputation - 50) / 100 + taste * 0.5 + (open ? 0.3 : 0) + seat * 0.3;
      return { teamId: t.id, interest, open };
    })
    .sort((a, b) => b.interest - a.interest || a.teamId.localeCompare(b.teamId));
  // Owners interested enough; a GM with any standing left gets at least one call.
  const keen = rows.filter((r) => r.interest >= JOB.offers.minInterest).slice(0, JOB.offers.max);
  const chosen = keen.length || me.reputation < JOB.offers.minReputation ? keen : rows.slice(0, 1);
  return chosen.map((r) => {
    const traits = describeOwner(ownerStyle(league, r.teamId));
    return {
      teamId: r.teamId,
      season: league.season,
      reason: `${r.open ? "Just changed general managers" : "Ready to move on from his GM"}; your reputation ${me.reputation}.${traits.length ? ` The owner: ${traits.join(", ").toLowerCase()}.` : ""}`,
    };
  });
}

/** Called after Black Monday's reviews: a person out of work gets this year's offers. */
export function offersAfterReviews(league: League): void {
  const c = league.career;
  if (!c || c.status !== "fired") return;
  c.offers = jobOffers(league);
  note(
    league,
    "owner",
    "owner",
    c.offers.length
      ? `Job offers: ${c.offers.map((o) => teamName(league, o.teamId)).join(", ")}.`
      : "No team called this year. Wait a season, or retire.",
  );
}

/** The person takes an offer: the team's GM steps aside and the career continues there. */
export function takeJob(league: League, teamId: string): void {
  const c = league.career;
  if (!c || c.status === "active") throw new Error("You already have a job.");
  if (!c.offers.some((o) => o.teamId === teamId))
    throw new Error("That team hasn't offered you a job.");
  const me = league.executives.find((e) => e.id === c.executiveId)!;
  startCareer(league, teamId, { firstName: me.firstName, lastName: me.lastName });
}

/** The person retires: the league carries on in Simulation Mode. */
export function retireCareer(league: League): void {
  const c = league.career;
  if (!c) return;
  const me = league.executives.find((e) => e.id === c.executiveId);
  if (c.status === "active" && c.teamId) {
    // Retiring while employed: the owner hires an AI GM at once.
    const team = c.teamId;
    firePerson(league, "Retired from front-office work.");
    hireGm(league, team, "Replaces a GM who retired.", false);
  }
  c.status = "retired";
  c.offers = [];
  c.teamId = null;
  if (me) me.retiredAfter = league.season;
}

/** At each season's end: the owner's reactions fade (a new year, a fresh start). */
export function careerSeasonEnd(league: League): void {
  const c = league.career;
  if (!c) return;
  c.standing = c.standing * JOB.seasonFade;
}
