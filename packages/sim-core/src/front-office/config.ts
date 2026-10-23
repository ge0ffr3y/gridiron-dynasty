/**
 * Front-office tuning (Phase 13; CLAUDE.md rule 4). Judgment unless a comment names a source;
 * real targets live in calibration/frontoffice.json.
 */
import type { GmStyle } from "../league/schema";

type Knobs = Omit<GmStyle, "skill">;

export const FRONT_OFFICE = {
  /**
   * Where each archetype sits on the GM's knobs (-1..1). A GM is labeled by the nearest one.
   * - analytics: trusts the models, light on loyalty, trades when the numbers say so;
   * - win-now: discounts the future, pushes money later, buys veterans;
   * - draft-and-develop: patient, keeps his picks and his own players, spends carefully;
   * - cap-aggressive: restructures and pushes money into later years to buy talent now;
   * - trade-happy: deals often and takes risks;
   * - conservative: avoids risk, rarely trades, keeps the books clean.
   */
  archetypes: {
    analytics: {
      futureDiscount: 0,
      analytics: 1,
      capAggression: 0,
      tradeAppetite: 0.3,
      loyalty: -0.5,
      risk: 0.1,
    },
    "win-now": {
      futureDiscount: 1,
      analytics: -0.2,
      capAggression: 0.5,
      tradeAppetite: 0.4,
      loyalty: 0,
      risk: 0.4,
    },
    "draft-and-develop": {
      futureDiscount: -1,
      analytics: 0.2,
      capAggression: -0.5,
      tradeAppetite: -0.2,
      loyalty: 0.5,
      risk: -0.2,
    },
    "cap-aggressive": {
      futureDiscount: 0.4,
      analytics: 0,
      capAggression: 1,
      tradeAppetite: 0.2,
      loyalty: -0.1,
      risk: 0.5,
    },
    "trade-happy": {
      futureDiscount: 0.2,
      analytics: 0.2,
      capAggression: 0.2,
      tradeAppetite: 1,
      loyalty: -0.4,
      risk: 0.6,
    },
    conservative: {
      futureDiscount: -0.2,
      analytics: -0.3,
      capAggression: -0.8,
      tradeAppetite: -0.8,
      loyalty: 0.5,
      risk: -1,
    },
  } satisfies Record<string, Knobs>,
  /** A generated GM: this share of his archetype's spot, plus noise of this spread. */
  centroidShare: 0.75,
  knobNoise: 0.3,
  /** GM judging skill (0-100): mean and spread. */
  gmSkill: { mean: 55, sd: 12 },
  /** Ages when generated. */
  gmAge: [38, 62] as [number, number],
  ownerAge: [48, 84] as [number, number],
  /** Owners' traits: spread around typical (-1..1), and meddling's range (0..1). */
  ownerSpread: 0.45,
  meddling: [0, 0.6] as [number, number],
  /** GM contracts, years. */
  contractYears: [3, 5] as [number, number],
  /**
   * Real league (private habits): a measure counts fully after this many seasons of tenure and
   * is pulled toward typical before (as coaches' styles are, Phase 10).
   */
  realShrinkSeasons: 3,
} as const;
