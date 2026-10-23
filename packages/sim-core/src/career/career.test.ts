/**
 * GM Mode (Phase 14a): taking a job, the inbox with deadlines, staff stepping in, delegation,
 * and three seasons played as one team through the same functions the screens call.
 */
import { afterEach, describe, expect, it } from "vitest";
import { createLeague } from "../generate/league";
import type { League } from "../league/schema";
import { parseLeague, serializeLeague } from "../serialize";
import { advance, advanceUntil } from "../season/flow";
import { runAction } from "../season/actions";
import { batch, setTransactionAudit } from "../contracts/operations";
import { checkLegal, rosterProblems } from "../roster/legality";
import { getUnderCap } from "../contracts/upkeep";
import { draftAction, onTheClock } from "../draft/day";
import { makeOffer } from "../contracts/marketViews";
import { askAsOffer, demandFor } from "../contracts/negotiation";
import { onTeam } from "../roster/lists";
import { makeRosterMove } from "../roster/office";
import { gmOf } from "../front-office/executives";
import { DELEGATION_AREAS } from "../league/schema";
import { assertYourTeam, personTeam, staffDecides } from "./delegation";
import { inbox } from "./inbox";
import { answerInbox } from "./answers";
import { delegate } from "./staff";
import { startCareer } from "./start";
import { gmCareerView } from "./views";

afterEach(() => setTransactionAudit(null));

const DAY_ONE = serializeLeague(createLeague({ seed: 7, name: "GM" }));
const fresh = (): League => parseLeague(DAY_ONE);
const TEAM = "NYA";

describe("starting a career", () => {
  it("the person becomes the team's GM; the old GM steps aside; screens see through his staff", () => {
    const l = fresh();
    const old = gmOf(l, TEAM)!;
    const meeting = startCareer(l, TEAM, { firstName: "Pat", lastName: "Doe" });
    expect(personTeam(l)).toBe(TEAM);
    expect(l.teams.find((t) => t.id === TEAM)!.controller).toBe("human");
    const me = gmOf(l, TEAM)!;
    expect(me.person).toBe(true);
    expect(me.gm).toBeNull();
    expect(old.teamId).toBeNull();
    expect(l.settings.viewingAs).toBe(TEAM);
    expect(meeting.expects.length).toBeGreaterThan(10);
    expect(meeting.budget.length).toBeGreaterThan(10);
    expect(() => startCareer(l, "ARI", { firstName: "A", lastName: "B" })).toThrow(/already/);
    // The career survives a save and load.
    const back = parseLeague(serializeLeague(l));
    expect(back.career?.teamId).toBe(TEAM);
  });

  it("GM Mode: you act only for your own team", () => {
    const l = fresh();
    expect(() => assertYourTeam(l, "ARI")).not.toThrow(); // Simulation Mode: anyone
    startCareer(l, TEAM, { firstName: "Pat", lastName: "Doe" });
    expect(() => assertYourTeam(l, "ARI")).toThrow(/your own team/);
    expect(() => assertYourTeam(l, TEAM)).not.toThrow();
  });

  it("a format-18 save opens in Simulation Mode", () => {
    const old = JSON.parse(DAY_ONE);
    old.formatVersion = 18;
    delete old.career;
    for (const e of old.executives) delete e.person;
    const l = parseLeague(JSON.stringify(old));
    expect(l.career).toBeNull();
    expect(l.executives.every((e) => e.person === false)).toBe(true);
    expect(gmCareerView(l).active).toBe(false);
    expect(gmCareerView(l).jobs.length).toBe(l.teams.length);
  });
});

describe("the inbox and the staff", () => {
  it("the draft stops at your pick; draft-room sims stop there too; sim on and your scouts pick", () => {
    const l = fresh();
    startCareer(l, TEAM, { firstName: "Pat", lastName: "Doe" });
    advanceUntil(l, (x) => x.calendar.stage === "draft");
    advance(l);
    expect(onTheClock(l)?.ownerTeamId).toBe(TEAM);
    expect(inbox(l).map((d) => d.request.kind)).toEqual(["draft-pick"]);
    expect(() => draftAction(l, { kind: "sim", until: "all" })).toThrow(/on the clock/);
    // You pick; the draft-room "sim" then stops at your next pick.
    draftAction(l, { kind: "pick" });
    draftAction(l, { kind: "sim", until: "all" });
    expect(onTheClock(l)?.ownerTeamId).toBe(TEAM);
    // Sim on without picking: the staff pick and say so.
    advance(l);
    expect(l.career!.log.some((x) => x.by === "staff" && /Your scouts picked/.test(x.text))).toBe(
      true,
    );
  });

  it("a delegated area never queues a decision, and handing one over settles what's open", () => {
    const l = fresh();
    startCareer(l, TEAM, { firstName: "Pat", lastName: "Doe" });
    delegate(l, "draft", "staff");
    expect(staffDecides(l, TEAM, "draft")).toBe(true);
    advanceUntil(l, (x) => x.calendar.stage === "after-draft");
    expect(l.pendingDecisions.some((d) => d.request.kind === "draft-pick")).toBe(false);
    expect(
      l.players.filter((p) => p.drafted?.teamId === TEAM && p.drafted.season === 2026).length,
    ).toBeGreaterThan(3);
  });

  it("a fully delegated person-run team plays like an AI team: legal, nothing asked of him", () => {
    const l = fresh();
    startCareer(l, TEAM, { firstName: "Pat", lastName: "Doe" });
    for (const area of DELEGATION_AREAS) delegate(l, area, "staff");
    setTransactionAudit(checkLegal);
    let seasons = 0;
    for (let i = 0; i < 200 && seasons < 2; i++) {
      advance(l);
      if (l.calendar.stage === "complete") seasons += 1;
      expect(rosterProblems(l), l.date).toEqual([]);
      expect(inbox(l)).toEqual([]);
    }
    expect(seasons).toBe(2);
    // His staff re-signed someone, drafted, and made the cuts, as an AI team would.
    expect(l.transactions.some((t) => t.type === "signed" && t.teamIds.includes(TEAM))).toBe(true);
    expect(onTeam(l, TEAM, "active").length).toBeLessThanOrEqual(53);
  }, 300_000);
});

describe("three seasons as one team", () => {
  it("answering the inbox through the screens' functions keeps every roster legal", () => {
    const l = fresh();
    startCareer(l, TEAM, { firstName: "Pat", lastName: "Doe" });
    // Keep final cuts too, to make them by hand.
    delegate(l, "cutdown", "you");
    setTransactionAudit(checkLegal);
    const seen = new Set<string>();
    let signedFreeAgent = false;
    let acceptedTrade = false;
    for (let stop = 0; stop < 400 && l.season < 2029; stop++) {
      runAction(l, "next-decision");
      expect(rosterProblems(l), l.date).toEqual([]);
      // Nothing is ever left past its deadline: the staff took anything you let lapse.
      expect(inbox(l).filter((d) => d.deadline != null && d.deadline < l.date)).toEqual([]);
      // Once in each free agency, sign the best free agent we can afford at his ask.
      if (l.calendar.stage === "free-agency" && !signedFreeAgent) {
        const fa = l.players
          .filter((p) => p.teamId === null && p.retiredAfter === null && !p.rights)
          .slice(0, 40);
        for (const p of fa) {
          try {
            const r = makeOffer(l, p.id, TEAM, askAsOffer(demandFor(l, p, TEAM)));
            if (r.decision === "accept") {
              signedFreeAgent = true;
              break;
            }
          } catch {
            // over the cap or no roster spot: try the next one
          }
        }
      }
      for (const d of inbox(l)) {
        const kind = d.request.kind;
        seen.add(kind);
        if (kind === "draft-pick")
          batch(l, () => {
            draftAction(l, { kind: "pick" });
            getUnderCap(l, TEAM);
          });
        else if (kind === "re-sign") {
          const p = l.players.find((x) => x.id === d.request.playerId)!;
          let done = false;
          try {
            done =
              makeOffer(l, p.id, TEAM, askAsOffer(demandFor(l, p, TEAM))).decision === "accept";
          } catch {
            done = false;
          }
          if (!done) answerInbox(l, d.id, "let-go");
        } else if (kind === "trade-offer") {
          try {
            answerInbox(l, d.id, acceptedTrade ? "decline" : "accept");
            acceptedTrade = true;
          } catch {
            // the trade broke a rule by now: it's gone either way
          }
        } else if (kind === "cutdown") {
          // Cut the lowest-paid, least valuable players the screen offers.
          batch(l, () => {
            const extra = onTeam(l, TEAM, "active").length - l.rules.roster.regularSeasonMax;
            const cuts = onTeam(l, TEAM, "active")
              .sort((a, b) => a.id - b.id)
              .reverse()
              .slice(0, Math.max(0, extra) + 10);
            let left = extra;
            for (const p of cuts) {
              if (left <= 0) break;
              try {
                makeRosterMove(l, TEAM, p.id, "waive");
                left -= 1;
              } catch {
                // not waivable (dead money too big, or a rule): next
              }
            }
          });
          if (onTeam(l, TEAM, "active").length <= l.rules.roster.regularSeasonMax)
            answerInbox(l, d.id, "done");
        } else if (kind === "extension") answerInbox(l, d.id, "play-it-out");
        else if (kind === "dispute") answerInbox(l, d.id, "wait");
      }
    }
    expect(l.season).toBe(2029);
    for (const kind of ["draft-pick", "re-sign", "trade-offer", "cutdown", "extension"])
      expect(seen.has(kind), kind).toBe(true);
    expect(signedFreeAgent).toBe(true);
    // The career log has both your decisions and your staff's.
    expect(l.career!.log.some((x) => x.by === "you")).toBe(true);
    expect(l.history.length).toBeGreaterThanOrEqual(4);
  }, 600_000);
});
