/**
 * Front-office screens (Phase 13): a team's front office (GM, owner, where the team stands, the
 * cap outlook, needs, recent trades), the trade offers waiting for a person-run team, and the
 * league office's trades, which the other team's AI must now accept.
 */
import { personTeam } from "../career/delegation";
import { ageOn } from "@fgm/foundation";
import type { League } from "../league/schema";
import { teamNeeds } from "../draft/boards";
import { STARTERS } from "../generate/config";
import { readOverall } from "../perception";
import { pickLabel, previewTradeDeal, type TradeSide } from "../roster/trades";
import {
  ARCHETYPE_LABELS,
  archetypeOf,
  describeGm,
  describeOwner,
  gmOf,
  GM_KNOBS,
  ownerOf,
} from "./executives";
import { answerTrade, executeTrade, type TradeAnswer } from "./tradeAI";

const KNOB_LABELS: Record<(typeof GM_KNOBS)[number], [string, string]> = {
  futureDiscount: ["Builds for later", "Wins now"],
  analytics: ["Scouts and veterans", "The numbers"],
  capAggression: ["Clean books", "Pay later"],
  tradeAppetite: ["Rarely trades", "Loves to deal"],
  loyalty: ["Unsentimental", "Loyal"],
  risk: ["Avoids risk", "Takes risks"],
};

export interface FrontOfficeView {
  teamId: string;
  gm: {
    id: number;
    name: string;
    age: number;
    archetype: string;
    leanings: string[];
    knobs: { key: string; low: string; high: string; value: number }[];
    hiredSeason: number;
    contractThrough: number | null;
  } | null;
  owner: { id: number; name: string; age: number; traits: string[] } | null;
  plan: {
    stance: string;
    reasons: string[];
    strength: number;
    future: number;
    capRoom: { season: number; share: number }[];
    date: string;
  } | null;
  needs: { position: string; need: number }[];
  trades: {
    date: string;
    partner: string;
    gave: number;
    got: number;
    text: string;
  }[];
}

/** A team's front office, as the league office sees it. */
export function frontOfficeView(league: League, teamId: string): FrontOfficeView {
  const gm = gmOf(league, teamId);
  const owner = ownerOf(league, teamId);
  const plan = league.teams.find((t) => t.id === teamId)?.plan ?? null;
  const name = (e: { firstName: string; lastName: string }) => `${e.firstName} ${e.lastName}`;
  return {
    teamId,
    gm:
      gm && gm.gm
        ? {
            id: gm.id,
            name: name(gm),
            age: ageOn(gm.birthDate, league.date),
            archetype: ARCHETYPE_LABELS[archetypeOf(gm.gm)],
            leanings: describeGm(gm.gm),
            knobs: GM_KNOBS.map((k) => ({
              key: k,
              low: KNOB_LABELS[k][0],
              high: KNOB_LABELS[k][1],
              value: gm.gm![k],
            })),
            hiredSeason: gm.hiredSeason,
            contractThrough: gm.contractThrough,
          }
        : null,
    owner:
      owner && owner.owner
        ? {
            id: owner.id,
            name: name(owner),
            age: ageOn(owner.birthDate, league.date),
            traits: describeOwner(owner.owner),
          }
        : null,
    plan: plan
      ? {
          stance: plan.stance,
          reasons: plan.reasons,
          strength: plan.strength,
          future: plan.future,
          capRoom: plan.capRoom.map((share, i) => ({ season: plan.season + i, share })),
          date: plan.date,
        }
      : null,
    needs: [...teamNeeds(league, teamId)]
      .map(([position, need]) => ({ position, need: Math.round(need * 100) / 100 }))
      .filter((n) => n.need > 0.05)
      .sort((a, b) => b.need - a.need || a.position.localeCompare(b.position))
      .slice(0, 6),
    trades: league.tradeHistory
      .filter((h) => h.teams.includes(teamId))
      .slice()
      .reverse()
      .slice(0, 10)
      .map((h) => {
        const i = h.teams[0] === teamId ? 0 : 1;
        const t = league.transactions.find(
          (x) =>
            x.type === "traded" &&
            x.date === h.date &&
            x.teamIds.includes(h.teams[0]) &&
            x.teamIds.includes(h.teams[1]),
        );
        return {
          date: h.date,
          partner: h.teams[1 - i]!,
          gave: h.gave[i]!,
          got: h.got[i]!,
          text: t?.text ?? "",
        };
      }),
  };
}

export interface TradeOfferRow {
  id: number;
  date: string;
  expires: string;
  from: string;
  /** What you'd get and give, in words. */
  get: string[];
  give: string[];
  reason: string;
  status: string;
}

/** A trade side in words: players (position, the viewer's read) and picks. */
export function describeSide(
  league: League,
  side: { players: number[]; picks: number[] },
): string[] {
  return [
    ...side.players.map((id) => {
      const p = league.players.find((x) => x.id === id);
      return p ? `${p.firstName} ${p.lastName} (${p.position})` : `player ${id}`;
    }),
    ...side.picks.map((id) => {
      const d = league.draftPicks.find((x) => x.id === id);
      return d ? pickLabel(league, d) : `pick ${id}`;
    }),
  ];
}

export interface TradeOffersView {
  /** True when a person answers this team's offers (else its AI does, and none arrive). */
  human: boolean;
  offers: TradeOfferRow[];
}

/** Trade offers to a team (open first, then the last few answered). */
export function tradeOffersView(league: League, teamId: string): TradeOffersView {
  const team = league.teams.find((t) => t.id === teamId);
  return {
    human: team?.controller === "human",
    offers: league.tradeOffers
      .filter((o) => o.toTeamId === teamId)
      .sort((a, b) => (a.status === "open" ? 0 : 1) - (b.status === "open" ? 0 : 1) || b.id - a.id)
      .slice(0, 15)
      .map((o) => ({
        id: o.id,
        date: o.date,
        expires: o.expires,
        from: o.fromTeamId,
        get: describeSide(league, o.give),
        give: describeSide(league, o.get),
        reason: o.reason,
        status: o.status,
      })),
  };
}

/** The person's answer to an offer: accepting makes the trade if it's still legal. */
export function respondToOffer(league: League, offerId: number, accept: boolean): string {
  const o = league.tradeOffers.find((x) => x.id === offerId);
  if (!o || o.status !== "open") throw new Error("That offer is no longer open.");
  league.pendingDecisions = league.pendingDecisions.filter((d) => d.request.offerId !== offerId);
  if (!accept) {
    o.status = "declined";
    return `Declined ${o.fromTeamId}'s offer.`;
  }
  const from: TradeSide = { teamId: o.fromTeamId, ...o.give };
  const to: TradeSide = { teamId: o.toTeamId, ...o.get };
  const preview = previewTradeDeal(league, from, to);
  if (!preview.legal) {
    o.status = "expired";
    throw new Error(
      `The trade can't go through any more (${preview.problems.join("; ")}): the offer is withdrawn.`,
    );
  }
  executeTrade(
    league,
    from,
    to,
    "offer",
    `${o.toTeamId} accepted ${o.fromTeamId}'s offer: ${o.reason}`,
  );
  o.status = "accepted";
  return league.transactions.at(-1)!.text;
}

/** The other team's answer to a league-office proposal (`a` proposes, `b` answers). */
export function tradeAnswer(league: League, a: TradeSide, b: TradeSide): TradeAnswer {
  return answerTrade(league, a, b);
}

/** The league office proposes a trade for team `a`; it goes through only if `b`'s GM agrees. */
export function proposeTrade(league: League, a: TradeSide, b: TradeSide): string {
  const answer = answerTrade(league, a, b);
  if (!answer.accept) throw new Error(answer.reason);
  executeTrade(
    league,
    a,
    b,
    "office",
    personTeam(league) === a.teamId
      ? `Your proposal; ${b.teamId}'s GM agreed.`
      : `The league office proposed it for ${a.teamId}; ${b.teamId}'s GM agreed.`,
  );
  return league.transactions.at(-1)!.text;
}

/** Who answers a team's decisions (trade offers today): the AI, or the person playing. */
export function setController(league: League, teamId: string, human: boolean): void {
  const t = league.teams.find((x) => x.id === teamId);
  if (!t) throw new Error(`no team ${teamId}`);
  t.controller = human ? "human" : "ai";
}

// ---------------------------------------------------------------------------
// Simulation Mode (Phase 13b): power rankings, the league overview, people, moves.

export interface PowerRow {
  rank: number;
  teamId: string;
  name: string;
  record: string;
  /** Places moved since last week (positive = up), null before week 2. */
  moved: number | null;
  reason: string;
}

/** Each team's games this season up to a week: wins, losses, ties, points for and against. */
function tally(league: League, teamId: string, throughWeek: number) {
  const r = { w: 0, l: 0, t: 0, pf: 0, pa: 0 };
  for (const g of league.games) {
    if (g.round !== "regular" || !g.result || g.week > throughWeek) continue;
    if (g.homeId !== teamId && g.awayId !== teamId) continue;
    const mine = g.homeId === teamId ? g.result.homeScore : g.result.awayScore;
    const theirs = g.homeId === teamId ? g.result.awayScore : g.result.homeScore;
    r.pf += mine;
    r.pa += theirs;
    if (mine > theirs) r.w += 1;
    else if (mine < theirs) r.l += 1;
    else r.t += 1;
  }
  return r;
}

/** A team's starters' average as the league office reads them (no team's own bias). */
function officeStrength(league: League, teamId: string): number {
  const viewer = { kind: "league" as const };
  const by = new Map<string, number[]>();
  for (const p of league.players) {
    if (p.teamId !== teamId || p.retiredAfter !== null || p.roster !== "active") continue;
    by.set(p.position, [...(by.get(p.position) ?? []), readOverall(league, p, viewer)]);
  }
  let sum = 0;
  let n = 0;
  for (const [pos, list] of by) {
    const best = list.sort((a, b) => b - a).slice(0, STARTERS[pos as keyof typeof STARTERS] ?? 1);
    sum += best.reduce((a, b) => a + b, 0);
    n += best.length;
  }
  return n ? sum / n : 0;
}

function rankings(league: League, throughWeek: number) {
  const zs = (xs: number[]) => {
    const m = xs.reduce((a, b) => a + b, 0) / xs.length;
    const sd = Math.sqrt(xs.reduce((a, b) => a + (b - m) * (b - m), 0) / xs.length) || 1;
    return xs.map((x) => (x - m) / sd);
  };
  const teams = [...league.teams].sort((a, b) => a.id.localeCompare(b.id));
  const t = teams.map((x) => tally(league, x.id, throughWeek));
  const games = t.map((x) => x.w + x.l + x.t);
  const played = Math.max(0, ...games);
  // Early on, the roster says more than the record; by midseason the results do.
  const results = Math.min(1, played / 8);
  const strengths = teams.map((x) => officeStrength(league, x.id));
  const strength = zs(strengths);
  const margin = zs(t.map((x, i) => (games[i] ? (x.pf - x.pa) / games[i]! : 0)));
  const wins = zs(t.map((x, i) => (games[i] ? (x.w + x.t / 2) / games[i]! : 0.5)));
  const score = teams.map(
    (_, i) => (1 - results) * strength[i]! + results * (0.55 * margin[i]! + 0.45 * wins[i]!),
  );
  return teams
    .map((team, i) => ({
      team,
      score: score[i]!,
      t: t[i]!,
      games: games[i]!,
      strengthZ: strength[i]!,
      starters: strengths[i]!,
    }))
    .sort((a, b) => b.score - a.score || a.team.id.localeCompare(b.team.id));
}

/** Power rankings: by point margin and record as the season goes on, by roster before it. */
export function powerRankingsView(league: League): PowerRow[] {
  const week =
    league.calendar.stage === "regular"
      ? league.calendar.week - 1
      : league.games.some((g) => g.round === "regular" && g.result)
        ? league.rules.schedule.regularSeasonWeeks
        : 0;
  const now = rankings(league, week);
  const before = week >= 2 ? rankings(league, week - 1) : null;
  return now.map((x, i) => {
    const prev = before?.findIndex((y) => y.team.id === x.team.id);
    const rec = `${x.t.w}-${x.t.l}${x.t.t ? `-${x.t.t}` : ""}`;
    const perGame = x.games ? (x.t.pf - x.t.pa) / x.games : 0;
    const reason =
      x.games === 0
        ? `No games yet: ranked by the roster (starters ${x.starters.toFixed(1)}${x.team.plan ? `; its GM says ${x.team.plan.stance}` : ""}).`
        : `${rec}, ${perGame >= 0 ? "+" : ""}${perGame.toFixed(1)} points a game; roster ${x.strengthZ >= 0.5 ? "among the best" : x.strengthZ <= -0.5 ? "among the weakest" : "middle of the pack"}.`;
    return {
      rank: i + 1,
      teamId: x.team.id,
      name: `${x.team.city} ${x.team.nickname}`,
      record: rec,
      moved: prev === undefined || prev < 0 ? null : prev - i,
      reason,
    };
  });
}

export interface LeagueOverview {
  seasons: number;
  champions: { season: number; teamId: string; gm: string | null }[];
  titlesByTeam: { teamId: string; titles: number; lastTitle: number }[];
  titlesByGmType: { type: string; titles: number }[];
  /** Longest current playoff streaks and droughts. */
  streaks: { teamId: string; playoffStreak: number; drought: number }[];
  gms: {
    teamId: string;
    id: number;
    name: string;
    type: string;
    since: number;
    stance: string | null;
  }[];
  moves: League["executiveMoves"];
}

/** The league at a glance for Simulation Mode: champions, dynasties, droughts, every GM, moves. */
export function leagueOverview(league: League): LeagueOverview {
  const history = league.history;
  const gmAt = (teamId: string, season: number) => {
    const gm = league.executives.find(
      (e) => e.role === "GM" && e.career.some((c) => c.season === season && c.teamId === teamId),
    );
    return gm;
  };
  const champions = history
    .map((h) => {
      const gm = gmAt(h.championId, h.season);
      return {
        season: h.season,
        teamId: h.championId,
        gm: gm ? `${gm.firstName} ${gm.lastName}` : null,
        type: gm?.gm ? ARCHETYPE_LABELS[archetypeOf(gm.gm)] : null,
      };
    })
    .reverse();
  const titles = new Map<string, { titles: number; lastTitle: number }>();
  for (const h of history) {
    const t = titles.get(h.championId) ?? { titles: 0, lastTitle: 0 };
    t.titles += 1;
    t.lastTitle = Math.max(t.lastTitle, h.season);
    titles.set(h.championId, t);
  }
  const byType = new Map<string, number>();
  for (const c of champions) if (c.type) byType.set(c.type, (byType.get(c.type) ?? 0) + 1);
  const streaks = league.teams.map((t) => {
    let streak = 0;
    let drought = 0;
    for (let i = history.length - 1; i >= 0; i--) {
      const s = history[i]!.standings.find((x) => x.teamId === t.id);
      if (!s || s.seed === null) break;
      streak += 1;
    }
    for (let i = history.length - 1; i >= 0; i--) {
      const s = history[i]!.standings.find((x) => x.teamId === t.id);
      if (!s || s.seed !== null) break;
      drought += 1;
    }
    return { teamId: t.id, playoffStreak: streak, drought };
  });
  return {
    seasons: history.length,
    champions: champions.map(({ type: _t, ...c }) => c),
    titlesByTeam: [...titles]
      .map(([teamId, t]) => ({ teamId, ...t }))
      .sort((a, b) => b.titles - a.titles || b.lastTitle - a.lastTitle),
    titlesByGmType: [...byType]
      .map(([type, n]) => ({ type, titles: n }))
      .sort((a, b) => b.titles - a.titles),
    streaks: streaks.sort(
      (a, b) =>
        b.playoffStreak - a.playoffStreak ||
        b.drought - a.drought ||
        a.teamId.localeCompare(b.teamId),
    ),
    gms: league.teams
      .map((t) => {
        const gm = gmOf(league, t.id);
        return {
          teamId: t.id,
          id: gm?.id ?? -1,
          name: gm ? `${gm.firstName} ${gm.lastName}` : "(open)",
          type: gm?.gm ? ARCHETYPE_LABELS[archetypeOf(gm.gm)] : "",
          since: gm?.hiredSeason ?? 0,
          stance: t.plan?.stance ?? null,
        };
      })
      .sort((a, b) => a.teamId.localeCompare(b.teamId)),
    moves: league.executiveMoves.slice(-60).reverse(),
  };
}

export interface ExecutiveView {
  id: number;
  name: string;
  role: string;
  age: number;
  teamId: string | null;
  retiredAfter: number | null;
  type: string | null;
  leanings: string[];
  knobs: { key: string; low: string; high: string; value: number }[];
  traits: string[];
  reputation: number;
  career: League["executives"][number]["career"];
  moves: League["executiveMoves"];
  /** Trades his teams made while he ran them (GMs). */
  trades: { date: string; teamId: string; gave: number; got: number; text: string }[];
}

/** A GM's or an owner's page. */
export function executiveView(league: League, id: number): ExecutiveView {
  const e = league.executives.find((x) => x.id === id);
  if (!e) throw new Error(`no executive ${id}`);
  const ran = new Map(e.career.map((c) => [c.season, c.teamId]));
  if (e.teamId) ran.set(league.season, e.teamId);
  return {
    id: e.id,
    name: `${e.firstName} ${e.lastName}`,
    role: e.role === "GM" ? "General manager" : "Owner",
    age: ageOn(e.birthDate, league.date),
    teamId: e.teamId,
    retiredAfter: e.retiredAfter,
    type: e.gm ? ARCHETYPE_LABELS[archetypeOf(e.gm)] : null,
    leanings: e.gm ? describeGm(e.gm) : [],
    knobs: e.gm
      ? GM_KNOBS.map((k) => ({
          key: k,
          low: KNOB_LABELS[k][0],
          high: KNOB_LABELS[k][1],
          value: e.gm![k],
        }))
      : [],
    traits: e.owner ? describeOwner(e.owner) : [],
    reputation: e.reputation,
    career: [...e.career].reverse(),
    moves: league.executiveMoves.filter((m) => m.executiveId === id).reverse(),
    trades:
      e.role === "GM"
        ? league.tradeHistory
            .filter((h) => {
              const team = ran.get(h.season);
              return team !== undefined && team !== null && h.teams.includes(team);
            })
            .reverse()
            .slice(0, 20)
            .map((h) => {
              const team = ran.get(h.season)!;
              const i = h.teams[0] === team ? 0 : 1;
              const t = league.transactions.find(
                (x) =>
                  x.type === "traded" &&
                  x.date === h.date &&
                  x.teamIds.includes(h.teams[0]) &&
                  x.teamIds.includes(h.teams[1]),
              );
              return {
                date: h.date,
                teamId: team,
                gave: h.gave[i]!,
                got: h.got[i]!,
                text: t?.text ?? "",
              };
            })
        : [],
  };
}
