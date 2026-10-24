/**
 * Starting a GM Mode career (Phase 14): the person becomes a team's general manager. The AI GM he
 * replaces steps aside (and joins the pool of GMs other owners may hire); the team's decisions
 * come to the person's inbox from now on, in the areas he keeps.
 */
import { addDays } from "@fgm/foundation";
import type { Career, Executive, League } from "../league/schema";
import { describeOwner, gmOf, ownerOf, ownerStyle } from "../front-office/executives";
import { OWNERS } from "../front-office/owners";
import { capSheet } from "../contracts/team";
import { updatePlans } from "../front-office/evaluate";
import { DEFAULT_DELEGATION, personTeam } from "./delegation";

const teamName = (league: League, id: string) => {
  const t = league.teams.find((x) => x.id === id);
  return t ? `${t.city} ${t.nickname}` : id;
};

/** The age a new GM is when his career starts (his birthday only shows on his page). */
const START_AGE = 40;

export interface OwnerMeeting {
  team: string;
  owner: string;
  traits: string[];
  /** What he expects this season, in his words. */
  expects: string;
  /** How he feels about spending. */
  budget: string;
  /** The team's situation as the outgoing front office saw it. */
  situation: string[];
  capRoom: number;
}

/** The person takes over `teamId` as its general manager. */
export function startCareer(
  league: League,
  teamId: string,
  who: { firstName: string; lastName: string },
): OwnerMeeting {
  if (personTeam(league)) throw new Error("You already run a team.");
  const team = league.teams.find((t) => t.id === teamId);
  if (!team) throw new Error(`no team ${teamId}`);
  if (!who.firstName.trim() || !who.lastName.trim()) throw new Error("Your GM needs a name.");
  // The AI GM steps aside (he may be hired elsewhere).
  const old = gmOf(league, teamId);
  if (old) {
    old.teamId = null;
    old.contractThrough = null;
    league.executiveMoves.push({
      season: league.season,
      date: league.date,
      kind: "left",
      executiveId: old.id,
      teamId,
      role: "GM",
      text: `${teamName(league, teamId)} general manager ${old.firstName} ${old.lastName} stepped aside.`,
      reason: `The owner hired ${who.firstName.trim()} ${who.lastName.trim()} to run the team.`,
    });
  }
  // A returning person (an earlier career in this league) keeps his record.
  let me = league.executives.find((e) => e.person) ?? null;
  if (!me) {
    me = {
      id: league.nextIds.executive++,
      firstName: who.firstName.trim(),
      lastName: who.lastName.trim(),
      role: "GM",
      teamId: null,
      birthDate: addDays(league.date, -Math.round(START_AGE * 365.25)),
      gm: null,
      owner: null,
      hiredSeason: league.season,
      contractThrough: null,
      reputation: 50,
      career: [],
      retiredAfter: null,
      person: true,
    } satisfies Executive;
    league.executives.push(me);
  }
  me.teamId = teamId;
  me.hiredSeason = league.season;
  me.contractThrough = league.season + OWNERS.contractYears[0] - 1;
  me.retiredAfter = null;
  league.executiveMoves.push({
    season: league.season,
    date: league.date,
    kind: "hired",
    executiveId: me.id,
    teamId,
    role: "GM",
    text: `${teamName(league, teamId)} hired ${me.firstName} ${me.lastName} as general manager.`,
    reason: "GM Mode: you took the job.",
  });
  team.controller = "human";
  // Screens see through your staff's eyes (your scouts' reads, your board).
  league.settings.viewingAs = teamId;
  const career: Career = league.career ?? {
    teamId,
    executiveId: me.id,
    startedSeason: league.season,
    status: "active",
    delegation: { ...DEFAULT_DELEGATION },
    log: [],
    tipsSeen: [],
    offers: [],
    standing: 0,
    seenTransaction: 0,
    firedFrom: null,
  };
  career.teamId = teamId;
  career.executiveId = me.id;
  career.status = "active";
  career.offers = [];
  career.standing = 0;
  // The owner reacts to moves from today on.
  career.seenTransaction = league.transactions.reduce((m, t) => Math.max(m, t.id), 0);
  league.career = career;
  return ownerMeeting(league);
}

/** What the owner tells the person: his character, what he expects, his budget. */
export function ownerMeeting(league: League): OwnerMeeting {
  const teamId = personTeam(league);
  if (!teamId) throw new Error("You don't run a team.");
  const owner = ownerOf(league, teamId);
  const o = ownerStyle(league, teamId);
  let plan = league.teams.find((t) => t.id === teamId)!.plan;
  if (!plan) {
    // A brand-new league: the front office's read, made on a copy.
    const copy = JSON.parse(JSON.stringify(league)) as League;
    updatePlans(copy);
    plan = copy.teams.find((t) => t.id === teamId)!.plan;
  }
  const stance = plan?.stance ?? "retool";
  const bar = o.ambition >= 0.35 ? "high" : o.ambition <= -0.35 ? "low" : "middle";
  const expects =
    stance === "contend"
      ? bar === "low"
        ? "This roster should make the playoffs. Get us there."
        : "We have the roster to win it all. I expect a deep playoff run."
      : stance === "rebuild"
        ? bar === "high"
          ? "Rebuild if you must, but I want to see us competing soon, not in five years."
          : "Build it the right way: through the draft. Show me progress."
        : bar === "high"
          ? "We're close. I expect us in the playoff hunt this year."
          : "Get us back to winning football: a winning record would be a good start.";
  const budget =
    o.budget >= 0.35
      ? "Spend what it takes, up to the cap. Money won't be what holds us back."
      : o.budget <= -0.35
        ? "Watch the money. I won't pay big bonuses for players who don't move the needle."
        : "Spend wisely. I'll back a big deal if it's the right one.";
  return {
    team: teamName(league, teamId),
    owner: owner ? `${owner.firstName} ${owner.lastName}` : "The owner",
    traits: describeOwner(o),
    expects,
    budget,
    situation: plan?.reasons ?? [],
    capRoom: capSheet(league, teamId, league.season).room,
  };
}
