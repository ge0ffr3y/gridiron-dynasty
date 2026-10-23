/**
 * General managers and owners (Phase 13).
 *
 * Every team has a GM, whose knobs (GmStyleSchema) shape its whole front office: what it pays,
 * whom it drafts, whether it trades, how it handles the cap. Every team has an owner, who judges
 * the GM and the coaches (13b). Fictional leagues get generated executives: each GM starts near
 * one of six archetypes, spread so every league has a mix. The real league's GMs start from
 * their teams' measured habits (pipeline, private) and are renamed like everyone else.
 */
import { addDays, Rng, streamSeed } from "@fgm/foundation";
import { NamePicker } from "../generate/people";
import { GM_ARCHETYPES } from "../league/schema";
import type { Executive, GmStyle, League, OwnerStyle } from "../league/schema";
import { FRONT_OFFICE } from "./config";

export type Archetype = (typeof GM_ARCHETYPES)[number];
type Knob = Exclude<keyof GmStyle, "skill">;
export const GM_KNOBS: Knob[] = [
  "futureDiscount",
  "analytics",
  "capAggression",
  "tradeAppetite",
  "loyalty",
  "risk",
];

const clamp = (x: number, lo = -1, hi = 1) => Math.max(lo, Math.min(hi, x));
const r2 = (x: number) => Math.round(x * 100) / 100;

/** A typical GM (every knob 0): what a team without one, or an old save, behaves like. */
export const NEUTRAL_GM: GmStyle = {
  futureDiscount: 0,
  analytics: 0,
  capAggression: 0,
  tradeAppetite: 0,
  loyalty: 0,
  risk: 0,
  skill: 55,
};
export const NEUTRAL_OWNER: OwnerStyle = { patience: 0, budget: 0, meddling: 0.2, ambition: 0 };

/** The archetype a GM's knobs sit nearest. */
export function archetypeOf(style: GmStyle): Archetype {
  let best: Archetype = "conservative";
  let bestDistance = Infinity;
  for (const a of GM_ARCHETYPES) {
    const c = FRONT_OFFICE.archetypes[a];
    let d = 0;
    for (const k of GM_KNOBS) d += (style[k] - c[k]) * (style[k] - c[k]);
    if (d < bestDistance) {
      bestDistance = d;
      best = a;
    }
  }
  return best;
}

export const ARCHETYPE_LABELS: Record<Archetype, string> = {
  analytics: "Analytics-driven",
  "win-now": "Win-now",
  "draft-and-develop": "Draft-and-develop",
  "cap-aggressive": "Cap-aggressive",
  "trade-happy": "Trade-happy",
  conservative: "Conservative",
};

/** A GM's leanings in words (the knobs far from typical). */
export function describeGm(style: GmStyle): string[] {
  const out: string[] = [];
  const say = (x: number, high: string, low: string) => {
    if (x >= 0.4) out.push(high);
    else if (x <= -0.4) out.push(low);
  };
  say(style.futureDiscount, "Wants to win now", "Patient: builds for later");
  say(style.analytics, "Trusts the numbers", "Trusts his scouts and veterans");
  say(style.capAggression, "Pushes money into later years", "Keeps the books clean");
  say(style.tradeAppetite, "Loves to deal", "Rarely trades");
  say(style.loyalty, "Loyal to his own players", "Unsentimental about his own players");
  say(style.risk, "Takes risks", "Avoids risk");
  return out;
}

/** An owner's character in words. */
export function describeOwner(o: OwnerStyle): string[] {
  const out: string[] = [];
  if (o.patience >= 0.35) out.push("Patient");
  else if (o.patience <= -0.35) out.push("Impatient");
  if (o.budget >= 0.35) out.push("Spends freely");
  else if (o.budget <= -0.35) out.push("Watches the money");
  if (o.meddling >= 0.4) out.push("Meddles");
  if (o.ambition >= 0.35) out.push("Expects to win it all");
  else if (o.ambition <= -0.35) out.push("Modest expectations");
  return out;
}

/** A GM drawn near an archetype. */
export function drawGm(rng: Rng, archetype: Archetype): GmStyle {
  const F = FRONT_OFFICE;
  const c = F.archetypes[archetype];
  const style = { ...NEUTRAL_GM };
  for (const k of GM_KNOBS)
    style[k] = r2(clamp(c[k] * F.centroidShare + rng.gaussian(0, F.knobNoise)));
  style.skill = Math.round(clamp(rng.gaussian(F.gmSkill.mean, F.gmSkill.sd), 20, 95));
  return style;
}

export function drawOwner(rng: Rng): OwnerStyle {
  const F = FRONT_OFFICE;
  return {
    patience: r2(clamp(rng.gaussian(0, F.ownerSpread))),
    budget: r2(clamp(rng.gaussian(0, F.ownerSpread))),
    meddling: r2(rng.range(F.meddling[0], F.meddling[1])),
    ambition: r2(clamp(rng.gaussian(0, F.ownerSpread))),
  };
}

function birthDate(rng: Rng, date: string, ages: [number, number]): string {
  const age = rng.intBetween(ages[0], ages[1]);
  return addDays(`${Number(date.slice(0, 4)) - age}${date.slice(4)}`, -rng.int(365));
}

/**
 * A GM and an owner for every team, the same for every league with this seed. Archetypes are
 * dealt out in turn over a shuffled team order, so every league has a mix.
 */
export function generateExecutives(
  seed: number,
  teamIds: string[],
  season: number,
  date: string,
  firstId = 0,
): Executive[] {
  const F = FRONT_OFFICE;
  const rng = new Rng(streamSeed(seed, "executives"));
  const names = new NamePicker(new Rng(streamSeed(seed, "executive-names")));
  const order = rng.shuffle([...teamIds].sort());
  const offset = rng.int(GM_ARCHETYPES.length);
  const out: Executive[] = [];
  let id = firstId;
  order.forEach((teamId, i) => {
    const archetype = GM_ARCHETYPES[(i + offset) % GM_ARCHETYPES.length]!;
    const tenure = rng.int(8);
    out.push({
      id: id++,
      ...names.next(),
      role: "GM",
      teamId,
      birthDate: birthDate(rng, date, F.gmAge),
      gm: drawGm(rng, archetype),
      owner: null,
      hiredSeason: season - tenure,
      contractThrough: season + rng.intBetween(0, F.contractYears[1] - 1),
      reputation: Math.round(rng.range(35, 65)),
      career: [],
      retiredAfter: null,
    });
    out.push({
      id: id++,
      ...names.next(),
      role: "owner",
      teamId,
      birthDate: birthDate(rng, date, F.ownerAge),
      gm: null,
      owner: drawOwner(rng),
      hiredSeason: season - rng.intBetween(2, 40),
      contractThrough: null,
      reputation: 50,
      career: [],
      retiredAfter: null,
    });
  });
  return out.sort((a, b) => a.id - b.id);
}

/** The team's GM (or null for an old save or a vacancy). */
export function gmOf(league: League, teamId: string): Executive | null {
  return (
    league.executives.find(
      (e) => e.role === "GM" && e.teamId === teamId && e.retiredAfter === null,
    ) ?? null
  );
}

export function ownerOf(league: League, teamId: string): Executive | null {
  return league.executives.find((e) => e.role === "owner" && e.teamId === teamId) ?? null;
}

/** The team's GM knobs (typical when the job is open). */
export function gmStyle(league: League, teamId: string): GmStyle {
  return gmOf(league, teamId)?.gm ?? NEUTRAL_GM;
}

export function ownerStyle(league: League, teamId: string): OwnerStyle {
  return ownerOf(league, teamId)?.owner ?? NEUTRAL_OWNER;
}

/** Measured habits for a real team's front office (private input), and how many seasons back them. */
export interface RealFrontOffice {
  hiredSeason: number;
  gm: Partial<Record<Knob, { value: number; seasons: number }>>;
  owner: Partial<Record<keyof OwnerStyle, number>>;
}

/**
 * The real league's front offices: generated people (fictional names), with each GM's knobs
 * moved to his team's measured habits, pulled toward typical when his tenure is short.
 */
export function applyRealFrontOffices(league: League, real: Record<string, RealFrontOffice>): void {
  for (const [teamId, fo] of Object.entries(real)) {
    const gm = gmOf(league, teamId);
    if (gm?.gm) {
      gm.hiredSeason = fo.hiredSeason;
      for (const k of GM_KNOBS) {
        const m = fo.gm[k];
        if (!m) continue;
        const weight = m.seasons / (m.seasons + FRONT_OFFICE.realShrinkSeasons);
        // Measured knobs replace the drawn ones; the rest keep a little of their draw.
        gm.gm[k] = r2(clamp(m.value * weight));
      }
    }
    const owner = ownerOf(league, teamId);
    if (owner?.owner)
      for (const [k, v] of Object.entries(fo.owner) as [keyof OwnerStyle, number][])
        owner.owner[k] = r2(k === "meddling" ? clamp(v, 0, 1) : clamp(v));
  }
}
