/**
 * Replay review. Some plays are close calls: a catch, an incompletion, the
 * spot near the line to gain, a fumble, an interception, a touchdown. The
 * replay official (the booth) reviews scoring plays, turnovers and anything
 * in the last two minutes of a half or in overtime; otherwise the team the
 * ruling hurt may throw a challenge flag. Calls are reversed at the real
 * rates (calibration/situations.json).
 */
import type { Rng } from "@fgm/foundation";
import { TUNING } from "./config";
import type { ScrimmageResult } from "./scrimmage";

export type Ruling =
  "catch" | "incompletion" | "spot" | "fumble" | "downByContact" | "interception" | "touchdown";

export const RULING_NAMES: Record<Ruling, string> = {
  catch: "pass completion",
  incompletion: "incomplete pass",
  spot: "spot of the ball",
  fumble: "fumble",
  downByContact: "runner was down by contact",
  interception: "interception",
  touchdown: "touchdown",
};

interface Spot {
  down: number;
  toGo: number;
  ytg: number;
}

/** Is this play a close call, and on what? */
export function closeCall(rng: Rng, r: ScrimmageResult, at: Spot): Ruling | null {
  const C = TUNING.review.closeCall;
  const d = r.details;
  const touchdown = !r.turnover && r.gain >= at.ytg;
  const candidates: [Ruling, boolean][] = [
    ["touchdown", touchdown],
    ["interception", d.intercepted === true],
    ["fumble", d.fumble?.lost === true],
    [
      "downByContact",
      !d.fumble &&
        !touchdown &&
        !r.turnover &&
        (d.tacklers?.length ?? 0) > 0 &&
        (d.rusher !== undefined || d.complete === true),
    ],
    ["catch", d.complete === true && !touchdown],
    ["incompletion", r.incomplete && !r.throwAway && (r.airYards ?? 0) > 0],
    ["spot", at.down >= 3 && !touchdown && !r.turnover && Math.abs(r.gain - at.toGo) <= 1],
  ];
  for (const [ruling, applies] of candidates) if (applies && rng.chance(C[ruling])) return ruling;
  return null;
}

/** Whose side the ruling on the field went (the other team would want it overturned). */
export function rulingFavors(ruling: Ruling, r: ScrimmageResult, at: Spot): "offense" | "defense" {
  if (ruling === "spot") return r.gain >= at.toGo ? "offense" : "defense";
  return ruling === "catch" || ruling === "touchdown" || ruling === "downByContact"
    ? "offense"
    : "defense";
}

/** The play as it stands after the call is overturned. */
export function reverse(r: ScrimmageResult, ruling: Ruling, at: Spot): ScrimmageResult {
  const details = { ...r.details };
  const noTurnover = () => {
    delete details.turnover;
    const { turnover: _gone, ...rest } = r;
    void _gone;
    return rest;
  };
  switch (ruling) {
    case "catch": {
      details.complete = false;
      delete details.tacklers;
      delete details.missedTackles;
      delete details.fumble;
      return { ...noTurnover(), details, gain: 0, incomplete: true, outOfBounds: false };
    }
    case "incompletion": {
      details.complete = true;
      delete details.drop;
      delete details.breakup;
      const gain = Math.min(at.ytg, r.airYards ?? 0);
      return { ...r, details, gain, incomplete: false };
    }
    case "spot":
      return { ...r, gain: r.gain >= at.toGo ? at.toGo - 1 : at.toGo };
    case "fumble":
      delete details.fumble;
      return { ...noTurnover(), details };
    case "downByContact": {
      // The ball came out before he was down, and the tackler recovered it.
      const by = (details.rusher ?? details.receiver) as number;
      const recoveredBy = details.tacklers?.[0];
      details.fumble = { by, lost: true, ...(recoveredBy !== undefined ? { recoveredBy } : {}) };
      details.turnover = true;
      return { ...r, details, turnover: { spot: at.ytg - r.gain, returnYards: 0 } };
    }
    case "interception": {
      details.intercepted = false;
      delete details.defender;
      delete details.returnYards;
      return { ...noTurnover(), details, gain: 0, incomplete: true };
    }
    case "touchdown":
      return { ...r, gain: at.ytg - 1 };
  }
}
