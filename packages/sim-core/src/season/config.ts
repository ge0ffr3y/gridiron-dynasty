/**
 * Tuning numbers for depth charts and injuries in the league (CLAUDE.md, rule 4).
 * Injury rates during games live in the engine's config; these decide who
 * plays where and what an injury costs afterwards.
 */
import type { DepthSlot } from "@fgm/game-engine";

export const DEPTH_CHART = {
  /** Starters are picked spot by spot in this order, so nobody starts twice on one side of the ball. */
  fillOrder: [
    "QB",
    "C",
    "LT",
    "RT",
    "LG",
    "RG",
    "RB",
    "FB",
    "TE",
    "WR",
    "EDGE",
    "DT",
    "LB",
    "CB",
    "S",
    "K",
    "P",
  ] as DepthSlot[],
  starters: {
    QB: 1,
    RB: 1,
    FB: 1,
    WR: 3,
    TE: 1,
    LT: 1,
    LG: 1,
    C: 1,
    RG: 1,
    RT: 1,
    EDGE: 2,
    DT: 2,
    LB: 3,
    CB: 3,
    S: 2,
    K: 1,
    P: 1,
    KR: 0,
    PR: 0,
  } satisfies Record<DepthSlot, number>,
  /** How many players each spot lists. */
  length: {
    QB: 3,
    RB: 4,
    FB: 2,
    WR: 6,
    TE: 4,
    LT: 3,
    LG: 3,
    C: 3,
    RG: 3,
    RT: 3,
    EDGE: 5,
    DT: 5,
    LB: 5,
    CB: 6,
    S: 5,
    K: 1,
    P: 1,
    KR: 3,
    PR: 3,
  } satisfies Record<DepthSlot, number>,
  /** Returners skip this many top starters at running back, receiver and corner. */
  returnerSkipsStarters: 2,
};

/**
 * Injury-proneness from hidden traits: 1 is typical; each point of
 * proneness above 50 adds a little risk, each point of durability takes some away.
 */
export const INJURY_RISK = {
  typical: 50,
  pronenessEffect: 0.01,
  durabilityEffect: 0.005,
  min: 0.5,
  max: 2,
};

/** Games missed beyond the "9+" bucket of the real data: drawn up to this many. */
export const LONGEST_INJURY_GAMES = 17;

/** Drawing game-day weather (season/weather.ts). */
export const WEATHER = {
  /** Climate's second half (rain/snow shares) starts this week. */
  lateSeasonWeek: 10,
  /** Snow only falls this cold or colder (warmer "snow" falls as rain); rain this cold falls as snow. */
  snowAtMostF: 38,
  freezingF: 30,
  /** A retractable roof opens only without rain or snow, between these temperatures. */
  openRoof: { minF: 55, maxF: 85 },
  /** Shown for games under a roof. */
  indoorTemperatureF: 70,
};
