/**
 * Contract disputes (Phase 12b): holdouts, hold-ins and trade requests.
 *
 * When camp opens, an unhappy star who's paid well below his market value may stay away (a
 * holdout: fined every day, CBA Article 42), report but not practice (a hold-in), or ask to be
 * traded. During the season a very unhappy player who matters may ask out. His team answers
 * each one, with a reason: an extension (paying a little above its usual limit to end it), a
 * trade for picks, or waiting him out. Holdouts end by the season at the latest (missing games
 * would cost him his game checks).
 *
 * Real counts (2024 and 2025 camp trackers, judgment from news coverage; no names kept): about
 * three to six stars hold out or hold in each summer, and a few players a year ask to be traded.
 * Every draw is a hash of the seed, the player and the date, so screens never change the future.
 */
import { ageOn, daysBetween, type Dollars } from "@fgm/foundation";
import type { League, Player } from "../league/schema";
import { DISPUTE_KINDS, DISPUTE_OUTCOMES } from "../league/schema";
import { contractShare, marketValue } from "../contracts/market";
import { yearsLeft } from "../contracts/contract";
import { recordTransaction } from "../contracts/operations";
import { roleOn, teamLimit, tryExtension } from "../contracts/freeAgency";
import { shopPlayer } from "../front-office/tradeMarket";
import { tradingOpen } from "../roster/trades";
import { uniformFrom } from "../scouting/noise";
import { MORALE, refreshMood } from "./morale";

type Dispute = League["disputes"][number];
type Kind = (typeof DISPUTE_KINDS)[number];
type Outcome = (typeof DISPUTE_OUTCOMES)[number];

/** Tuning. Counts are tuned to the real ones above with `npm run sim -- --market N`. */
export const DISPUTES = {
  /** Camp: only players the market values at this share of the cap or more (stars)... */
  starShare: 0.05,
  /** ...paid under this share of that value... */
  underpaid: 0.65,
  /** ...with at most this many seasons left on his deal (this one included)... */
  yearsLeft: 2,
  /** ...and in a mood below this. */
  moodBelow: 45,
  /** Base chance such a player disputes at camp, moved by ego and how much money matters. */
  campChance: 0.07,
  /** Share of camp disputes that are full holdouts (more with a big ego); the rest hold in. */
  holdoutShare: 0.3,
  /** Share that come with a trade request instead (more on a losing team). */
  requestShare: 0.2,
  /** In season: a player this unhappy who matters (market value this share of the cap)... */
  requestMood: 20,
  requestMinShare: 0.02,
  /** ...asks to be traded with this chance a week (more with a big ego). */
  requestWeeklyChance: 0.01,
  /** A team first offers up to its usual limit to end a core player's camp dispute... */
  stretch: 1,
  /** ...a little more each preseason week as talks go on... */
  stretchPerWeek: 0.04,
  /** ...and for a trade request, this much over its limit (it's a player it wants to keep). */
  requestStretch: 1.05,
  /** A holdout reports with this chance each preseason week he isn't signed. */
  reportWeekly: 0.3,
  /** Chance a team is willing to trade a player who asked out (each time it looks). */
  tradeWilling: 0.5,
  /** An open trade request lapses at the new League Year if his mood has recovered to this. */
  withdrawMood: 50,
  /** Disputes are kept this many seasons. */
  keepSeasons: 3,
} as const;

const name = (p: Player) => `${p.firstName} ${p.lastName}`;
const money = (d: number) => `$${(d / 1e6).toFixed(2)}M`;

/** Open disputes, by player. */
export function openDisputes(league: League): Map<number, Dispute> {
  const out = new Map<number, Dispute>();
  for (const d of league.disputes) if (d.end === null) out.set(d.playerId, d);
  return out;
}

/** Is he out of practice (holding out or in) right now? */
export function missingPractice(league: League, playerId: number): boolean {
  return league.disputes.some(
    (d) => d.end === null && d.playerId === playerId && d.kind !== "trade-request",
  );
}

/** Camp development for players who missed it: a holdout loses half, a hold-in a quarter. */
export function campAttendance(league: League, p: Player): number {
  const d = league.disputes.find(
    (x) => x.playerId === p.id && x.season === league.season && x.kind !== "trade-request",
  );
  if (!d) return 1;
  return d.kind === "holdout" ? 0.5 : 0.75;
}

function open(league: League, p: Player, kind: Kind, reason: string): Dispute {
  const d: Dispute = {
    playerId: p.id,
    teamId: p.teamId!,
    season: league.season,
    kind,
    start: league.date,
    reason,
    fines: 0,
    end: null,
    outcome: null,
    response: "",
  };
  league.disputes.push(d);
  const what =
    kind === "holdout"
      ? "is holding out of training camp"
      : kind === "hold-in"
        ? "reported to camp but isn't practicing (a hold-in)"
        : "asked to be traded";
  recordTransaction(league, {
    type: "dispute",
    teamIds: [d.teamId],
    playerIds: [p.id],
    text: `${name(p)} (${p.position}, ${d.teamId}) ${what}.`,
    reason,
  });
  return d;
}

function close(league: League, d: Dispute, outcome: Outcome, response: string): void {
  const p = league.players.find((x) => x.id === d.playerId)!;
  d.end = league.date;
  d.outcome = outcome;
  d.response = response;
  if (d.kind === "holdout") {
    // Fined for every day of camp he missed (rookie contracts at the lower rate).
    const perDay =
      p.contract?.type === "rookie"
        ? league.rules.freeAgency.campFinePerDay.rookie
        : league.rules.freeAgency.campFinePerDay.veteran;
    d.fines = Math.max(0, daysBetween(d.start, league.date)) * perDay;
  }
  if (outcome === "traded" || outcome === "extended") {
    // A new deal or a new team changes how he feels at once; their own transactions say why.
    refreshMood(league, p);
    return;
  }
  recordTransaction(league, {
    type: "dispute",
    teamIds: [d.teamId],
    playerIds: [p.id],
    text: `${name(p)}'s ${d.kind === "trade-request" ? "trade request" : d.kind} ended: ${outcome}.`,
    reason: response,
  });
}

/** Why a player is unhappy with his deal, in a sentence. */
function payReason(league: League, p: Player): string {
  const market = marketValue(league, p);
  const share = p.contract ? contractShare(league, p.contract) : 0;
  const cap = market.apy / market.share;
  return `Paid about ${money(share * cap)} a year against a market value of ${money(market.apy)} (${Math.round((100 * share) / market.share)}%); mood ${Math.round(p.mood?.score ?? 50)}.`;
}

// ---------------------------------------------------------------------------
// Camp

/** Players who might dispute their deal when camp opens. */
export function campCandidates(league: League): Player[] {
  const D = DISPUTES;
  const disputing = openDisputes(league);
  return league.players
    .filter(
      (p) =>
        p.teamId !== null &&
        p.contract !== null &&
        p.contract.teamId === p.teamId &&
        p.roster !== "practice-squad" &&
        !disputing.has(p.id) &&
        (p.mood?.score ?? 50) < D.moodBelow &&
        yearsLeft(p.contract, league.season) <= D.yearsLeft &&
        // Rookie deals can't be redone until after the third season (CBA Article 7).
        (p.contract.type !== "rookie" ||
          p.experience >= league.rules.freeAgency.rookieExtensionAfterSeasons) &&
        (p.contract.type === "veteran" ||
          p.contract.type === "extension" ||
          p.contract.type === "rookie"),
    )
    .filter((p) => {
      const market = marketValue(league, p);
      return (
        market.share >= D.starShare &&
        contractShare(league, p.contract!) < D.underpaid * market.share
      );
    })
    .sort((a, b) => a.id - b.id);
}

/** When camp opens: unhappy, underpaid stars hold out, hold in or ask to be traded; teams answer. */
export function campDisputes(league: League): number {
  const D = DISPUTES;
  const seed = league.meta.seed;
  let n = 0;
  for (const p of campCandidates(league)) {
    const pr = p.personality;
    const ego = (pr.ego - 50) / 50;
    const moneyCare = (pr.priorities.money - 25) / 25;
    const mood = ((p.mood?.score ?? 50) - MORALE.neutral) / 50;
    const chance = D.campChance * (1 + 0.5 * ego + 0.3 * moneyCare - mood);
    if (uniformFrom(`${seed}:dispute:${p.id}:${league.season}`) >= chance) continue;
    const winning = p.mood?.factors.find((f) => f.key === "winning")?.points ?? 0;
    const kindRoll = uniformFrom(`${seed}:dispute-kind:${p.id}:${league.season}`);
    const request = D.requestShare * (1 + Math.max(0, -winning) / 5);
    const holdout = D.holdoutShare * (1 + 0.5 * ego);
    const kind: Kind =
      kindRoll < request ? "trade-request" : kindRoll < request + holdout ? "holdout" : "hold-in";
    startDispute(league, p, kind, `Wants a new deal. ${payReason(league, p)}`);
    n += 1;
  }
  return n;
}

/** Opens a dispute and has the team answer it at once (also the league office's door, later). */
export function startDispute(league: League, p: Player, kind: Kind, reason: string): Dispute {
  const d = open(league, p, kind, reason);
  answer(league, d, 0);
  return d;
}

/** Each preseason week: talks continue, holdouts pile up fines and may report. */
export function preseasonDisputes(league: League, week: number): void {
  const seed = league.meta.seed;
  for (const d of [...league.disputes]) {
    if (d.end !== null || d.season !== league.season || d.kind === "trade-request") continue;
    if (!stillHis(league, d)) continue;
    answer(league, d, week);
    if (d.end !== null) continue;
    if (
      d.kind === "holdout" &&
      uniformFrom(`${seed}:reports:${d.playerId}:${league.season}:${week}`) < DISPUTES.reportWeekly
    ) {
      close(
        league,
        d,
        "reported",
        "Reported to camp without a new deal: the fines were adding up.",
      );
    }
  }
}

/** Cutdown day: holdouts and hold-ins still going end; nobody gives up his game checks. */
export function endCampDisputes(league: League): void {
  for (const d of [...league.disputes]) {
    if (d.end !== null || d.kind === "trade-request") continue;
    if (!stillHis(league, d)) continue;
    close(
      league,
      d,
      "reported",
      d.kind === "holdout"
        ? "Reported for the season without a new deal rather than lose his game checks."
        : "Back at practice for the season without a new deal.",
    );
  }
}

// ---------------------------------------------------------------------------
// In season

/** Each regular-season week: very unhappy players who matter may ask out; teams answer. */
export function weeklyDisputes(league: League, week: number): void {
  const D = DISPUTES;
  const seed = league.meta.seed;
  for (const d of [...league.disputes]) {
    if (d.end !== null) continue;
    if (!stillHis(league, d)) continue;
    if (d.kind === "trade-request" && tradingOpen(league).open) answer(league, d, week);
  }
  if (!tradingOpen(league).open) return;
  const disputing = openDisputes(league);
  for (const p of league.players) {
    if (
      p.teamId === null ||
      p.contract === null ||
      p.roster === "practice-squad" ||
      disputing.has(p.id) ||
      (p.mood?.score ?? 50) >= D.requestMood
    )
      continue;
    const chance = D.requestWeeklyChance * (1 + (p.personality.ego - 50) / 50);
    if (uniformFrom(`${seed}:request:${p.id}:${league.season}:${week}`) >= chance) continue;
    if (marketValue(league, p).share < D.requestMinShare) continue;
    const worst = [...(p.mood?.factors ?? [])].sort((a, b) => a.points - b.points)[0];
    const why =
      worst?.key === "role"
        ? "Unhappy with his playing time"
        : worst?.key === "winning"
          ? "Tired of losing"
          : worst?.key === "pay"
            ? "Unhappy with his pay"
            : "Unhappy where he is";
    const d = open(league, p, "trade-request", `${why} (mood ${Math.round(p.mood?.score ?? 50)}).`);
    answer(league, d, week);
  }
}

/**
 * At the new League Year (trading open again): requests from players whose mood recovered
 * lapse, teams answer the rest, and old disputes go.
 */
export function leagueYearDisputes(league: League): void {
  for (const d of [...league.disputes]) {
    if (d.end !== null) continue;
    const p = league.players.find((x) => x.id === d.playerId);
    if (!p || p.teamId !== d.teamId) {
      closeGone(league, d, p);
      continue;
    }
    if ((p.mood?.score ?? 50) >= DISPUTES.withdrawMood)
      close(league, d, "withdrawn", "Happier now: he dropped his trade request.");
    else if (d.kind === "trade-request") answer(league, d, 0);
  }
  league.disputes = league.disputes.filter(
    (d) => d.season > league.season - DISPUTES.keepSeasons || d.end === null,
  );
}

// ---------------------------------------------------------------------------
// The team's answer

/** Is the player still with the team he's in dispute with? Closes it if not. */
function stillHis(league: League, d: Dispute): boolean {
  const p = league.players.find((x) => x.id === d.playerId);
  if (p && p.teamId === d.teamId && p.contract?.teamId === d.teamId) return true;
  closeGone(league, d, p);
  return false;
}

function closeGone(league: League, d: Dispute, p: Player | undefined): void {
  d.end = league.date;
  d.outcome = "released";
  d.response =
    p && p.teamId === null ? "No longer under contract with the team." : "Left the team.";
}

/**
 * The team's answer: extend him (core players, paying a little over its usual limit), trade him
 * if he asked out (or talks failed and it's willing), or wait.
 */
function answer(league: League, d: Dispute, week: number): void {
  const D = DISPUTES;
  const p = league.players.find((x) => x.id === d.playerId)!;
  const teamId = d.teamId;
  const core = roleOn(league, teamId, p) === "starter";
  let talks = "";
  if (core && p.contract && (p.contract.type !== "rookie" || p.experience >= 3)) {
    const stretch =
      d.kind === "trade-request" ? D.requestStretch : D.stretch + D.stretchPerWeek * week;
    const limit: Dollars = Math.round(teamLimit(league, teamId, p) * stretch);
    const done = tryExtension(
      league,
      teamId,
      p,
      limit,
      `Extended to end his ${d.kind === "trade-request" ? "trade request" : d.kind}.`,
    );
    if (done.extended) {
      close(league, d, "extended", `Extended: ${done.reason}`);
      return;
    }
    talks = done.reason;
  }
  const willing =
    d.kind === "trade-request" || !core
      ? uniformFrom(`${league.meta.seed}:trade-willing:${p.id}:${league.date}`) < D.tradeWilling
      : false;
  if (willing && tradingOpen(league).open) {
    const traded = tradeAway(league, p, d);
    if (traded) {
      close(league, d, "traded", traded);
      return;
    }
  }
  d.response = core
    ? `Waiting him out: ${talks || "no deal yet"}${willing ? " No team offered enough in a trade." : ""}`
    : `Waiting him out: not a starter they'd pay more to keep.${willing ? " No team offered enough in a trade." : ""}`;
}

/** Trades him to the team that wants him most, through the trade AI. The reason, or null. */
function tradeAway(league: League, p: Player, d: Dispute): string | null {
  const why = d.kind === "trade-request" ? "He asked out" : `His ${d.kind} dragged on`;
  const text = shopPlayer(league, d.teamId, p, `${d.teamId} moved him: ${why.toLowerCase()}`);
  if (!text || p.teamId === d.teamId) return null;
  // The new team usually signs him to the deal he wanted.
  tryExtension(
    league,
    p.teamId!,
    p,
    Math.round(teamLimit(league, p.teamId!, p) * DISPUTES.requestStretch),
    "Extended after the trade that brought him in.",
  );
  return `${why}. ${text}`;
}

/**
 * Real ranges a year (judgment from the 2024 and 2025 camp trackers and news coverage; counts
 * only): stars holding out or holding in at camp, and players asking to be traded.
 */
export const REAL_DISPUTES = {
  campDisputes: [3, 8] as [number, number],
  tradeRequests: [1, 5] as [number, number],
};

export interface DisputeSeason {
  season: number;
  holdouts: number;
  holdIns: number;
  tradeRequests: number;
  outcomes: Record<Outcome | "open", number>;
  /** Camp fines run up (whole dollars). */
  fines: Dollars;
  /** Players' moods at the end of the report: average and share below 25. */
  mood: { mean: number; angry: number };
}

/** One season's disputes, for the runner's market report. */
export function disputeSeason(league: League, season: number): DisputeSeason {
  const ds = league.disputes.filter((d) => d.season === season);
  const outcomes = { extended: 0, traded: 0, reported: 0, withdrawn: 0, released: 0, open: 0 };
  for (const d of ds) outcomes[d.outcome ?? "open"] += 1;
  const moods = league.players.flatMap((p) => (p.mood ? [p.mood.score] : []));
  return {
    season,
    holdouts: ds.filter((d) => d.kind === "holdout").length,
    holdIns: ds.filter((d) => d.kind === "hold-in").length,
    tradeRequests: ds.filter((d) => d.kind === "trade-request").length,
    outcomes,
    fines: ds.reduce((s, d) => s + d.fines, 0),
    mood: {
      mean: moods.reduce((s, x) => s + x, 0) / Math.max(1, moods.length),
      angry: moods.filter((x) => x < 25).length / Math.max(1, moods.length),
    },
  };
}
