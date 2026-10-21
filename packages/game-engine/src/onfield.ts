/**
 * Before the snap: who is on the field and what each side calls.
 *
 * The offense picks a personnel group and a formation, the defense answers
 * with a package, a number of men in the box, a coverage shell, and how many
 * rush the passer. Every choice is drawn at real NFL rates for the situation
 * (calibration/matchups.json), so formations and coverages show up as often
 * as they do on Sundays.
 */
import type { Rng } from "@fgm/foundation";
import { MATCHUPS } from "./config";
import type { Lineup, LineupPlayer } from "./types";

export type Formation = "SHOTGUN" | "UNDER CENTER" | "PISTOL";
export type DefensePackage = "base" | "nickel" | "dime" | "goal-line";
export type Coverage =
  "cover0" | "cover1" | "cover2" | "2man" | "cover3" | "cover4" | "cover6" | "other";

/** Man coverages (the rest are zone). */
export const MAN_COVERAGES: Coverage[] = ["cover0", "cover1", "2man"];

export const COVERAGE_NAMES: Record<Coverage, string> = {
  cover0: "Cover 0",
  cover1: "Cover 1",
  cover2: "Cover 2",
  "2man": "2-Man",
  cover3: "Cover 3",
  cover4: "Cover 4",
  cover6: "Cover 6",
  other: "a mixed coverage",
};

export interface Huddle {
  /** Backs then tight ends, e.g. "11", "12", "21". */
  personnel: string;
  formation: Formation;
  package: DefensePackage;
  box: number;
  coverage: Coverage;
  man: boolean;
  rushers: number;
  offense: {
    qb: LineupPlayer;
    /** Left tackle, right tackle, left guard, right guard, center. */
    ol: LineupPlayer[];
    backs: LineupPlayer[];
    tightEnds: LineupPlayer[];
    receivers: LineupPlayer[];
  };
  defense: {
    /** Edge, edge, tackle, tackle. */
    dl: LineupPlayer[];
    lb: LineupPlayer[];
    cb: LineupPlayer[];
    s: LineupPlayer[];
    /** Who rushes the passer on a pass play (linemen first, then blitzers). */
    rushers: LineupPlayer[];
  };
}

/** Optional style for a defense (e.g. a blitz-happy coordinator); Phase 10 coaches set this. */
export interface DefenseStyle {
  /** Added to the chance of sending five or more rushers. */
  extraBlitz?: number;
}

/** One key of a table of shares, chosen in proportion to the shares. */
export function pickShare(
  rng: Rng,
  shares: Record<string, number> | undefined,
  fallback: string,
): string {
  if (!shares) return fallback;
  const entries = Object.entries(shares).filter(([, v]) => v > 0);
  const total = entries.reduce((a, [, v]) => a + v, 0);
  if (total <= 0) return fallback;
  let r = rng.next() * total;
  for (const [k, v] of entries) {
    r -= v;
    if (r < 0) return k;
  }
  return entries[entries.length - 1]![0];
}

export function situationKey(down: number, toGo: number, yardsToGoal: number): string {
  if (yardsToGoal <= 3) return "goal-line";
  if (toGo <= 2) return "short";
  if (down === 1 && toGo >= 10) return "1st10";
  if (down >= 3 && toGo >= 7) return "long";
  return "other";
}

const PACKAGES: Record<DefensePackage, { lb: number; cb: number; s: number }> = {
  base: { lb: 3, cb: 2, s: 2 },
  nickel: { lb: 2, cb: 3, s: 2 },
  dime: { lb: 1, cb: 4, s: 2 },
  "goal-line": { lb: 3, cb: 2, s: 2 },
};

/** Can this offense field the personnel group? (backs, tight ends; receivers fill the rest of five) */
function feasible(code: string, lineup: Lineup): boolean {
  const backs = Number(code[0]);
  const ends = Number(code[1]);
  const backsAvailable = lineup.rb.length + (lineup.fb ? 1 : 0);
  const receivers = 5 - backs - ends;
  return (
    backs <= backsAvailable &&
    ends <= lineup.te.length &&
    receivers >= 0 &&
    receivers <= lineup.wr.length
  );
}

export function chooseHuddle(
  rng: Rng,
  call: "run" | "pass",
  s: { down: number; toGo: number; yardsToGoal: number },
  offense: Lineup,
  defense: Lineup,
  style: DefenseStyle = {},
): Huddle {
  const sit = situationKey(s.down, s.toGo, s.yardsToGoal);
  let personnel = pickShare(
    rng,
    (MATCHUPS.personnelBySituation as Record<string, Record<string, number>>)[`${call}|${sit}`],
    "11",
  );
  if (personnel.length !== 2 || !feasible(personnel, offense)) personnel = "11";
  const formation = pickShare(
    rng,
    (MATCHUPS.formationByPersonnel as Record<string, Record<string, number>>)[
      `${call}|${personnel}`
    ],
    call === "pass" ? "SHOTGUN" : "UNDER CENTER",
  ) as Formation;
  const pkg = pickShare(
    rng,
    (MATCHUPS.defenseByPersonnel as Record<string, Record<string, number>>)[personnel],
    "nickel",
  ) as DefensePackage;
  const box = Number(
    pickShare(
      rng,
      (MATCHUPS.boxByPersonnel as Record<string, Record<string, number>>)[`${call}|${personnel}`],
      "6",
    ),
  );
  let coverage = pickShare(
    rng,
    (MATCHUPS.coverageByDefense as Record<string, Record<string, number>>)[pkg],
    "cover3",
  ) as Coverage;
  if (!(coverage in COVERAGE_NAMES)) coverage = "other";

  // How many rush: real rates for the coverage, nudged toward blitzes by the defense's style.
  const rushShares = {
    ...((MATCHUPS.rushersByCoverage as Record<string, Record<string, number>>)[coverage] ?? {
      "4": 1,
    }),
  };
  if (style.extraBlitz) {
    for (const k of ["5", "6", "7+"]) rushShares[k] = (rushShares[k] ?? 0) + style.extraBlitz / 3;
  }
  const rushKey = pickShare(rng, rushShares, "4");
  const rushers = rushKey === "3-" ? 3 : rushKey === "7+" ? 7 : Number(rushKey);

  // The eleven on each side.
  const backs = Number(personnel[0]);
  const ends = Number(personnel[1]);
  const backfield: LineupPlayer[] = [];
  if (backs >= 1 && offense.rb[0]) backfield.push(offense.rb[0]);
  if (backs >= 2) backfield.push(offense.fb ?? offense.rb[1] ?? offense.rb[0]!);
  // In nickel and dime, the extra defensive back is sometimes a third safety (at the real rate).
  const threeSafeties =
    (pkg === "nickel" || pkg === "dime") && rng.chance(MATCHUPS.threeSafetyShare[pkg]);
  const base = PACKAGES[pkg];
  const counts = threeSafeties ? { ...base, cb: base.cb - 1, s: base.s + 1 } : base;
  const dl = defense.dl.slice(0, 4);
  const lb = defense.lb.slice(0, counts.lb);
  const cb = defense.cb.slice(0, counts.cb);
  const safeties = defense.s.slice(0, counts.s);
  const blitzers = [...lb, ...safeties, ...cb];
  const rushing = [
    ...dl.slice(0, Math.min(4, rushers)),
    ...blitzers.slice(0, Math.max(0, rushers - 4)),
  ];

  return {
    personnel,
    formation,
    package: pkg,
    box,
    coverage,
    man: MAN_COVERAGES.includes(coverage),
    rushers: rushing.length,
    offense: {
      qb: offense.qb,
      ol: offense.ol.slice(0, 5),
      backs: backfield,
      tightEnds: offense.te.slice(0, ends),
      receivers: offense.wr.slice(0, 5 - backs - ends),
    },
    defense: { dl, lb, cb, s: safeties, rushers: rushing },
  };
}
