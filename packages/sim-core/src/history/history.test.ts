/**
 * League history (Phase 15): the record book (a record breaks, news says so, the old holder is
 * kept), awards after a season, the Hall of Fame's rules, retired numbers, All-Star Game selections in the fifth-
 * year option, and the 19-to-20 save upgrade.
 */
import { describe, expect, it } from "vitest";
import { createLeague } from "../generate/league";
import type { League, Player } from "../league/schema";
import { parseLeague, serializeLeague } from "../serialize";
import { advanceUntil } from "../season/flow";
import { assignJerseys } from "../roster/jerseys";
import { fifthYearOptionSalary } from "../contracts/tags";
import { seasonAwards } from "./awards";
import { honorsOf } from "./honors";
import { hallOfFameVote, playerCase, RETIRING } from "./hallOfFame";
import { uniformFrom } from "../scouting/noise";
import { gameRecords, recordList, seasonAndCareerRecords } from "./records";
import { almanacView, coachTreeView, recordsView, seasonRecapView, teamHistoryView } from "./views";
import { applyRealHistory, type RealHistoryInput } from "./real";
import { PAST_YEARS_THAT_COUNT, recentSeasons } from "./past";
import { losingSeasonsInRow } from "../coaches/carousel";

// A league after one full season (its first), at the start of the next offseason.
const AFTER_ONE = (() => {
  const l = createLeague({ seed: 7, name: "History" });
  advanceUntil(l, (x) => x.calendar.stage === "complete");
  return serializeLeague(l);
})();
const afterOne = (): League => parseLeague(AFTER_ONE);

const withStats = (l: League, n: number) =>
  l.players.filter((p) => p.teamId && p.stats.some((s) => s.season === l.season)).slice(0, n);

describe("the record book", () => {
  it("a record falls: the book moves, the old holder is kept, and the newsfeed says so", () => {
    const l = createLeague({ seed: 3, name: "Records" });
    const [a, b] = l.players.filter((p) => p.teamId && p.position === "RB").slice(0, 2) as [
      Player,
      Player,
    ];
    const play = (p: Player, yards: number, week: number) => {
      const game = {
        id: 900 + week,
        season: l.season,
        week,
        date: `2026-09-0${week}`,
        round: "regular",
        homeId: p.teamId!,
        awayId: "ZZZ",
        neutral: false,
      } as never;
      gameRecords(
        l,
        game,
        {
          periods: { home: [], away: [] },
          home: {} as never,
          away: {} as never,
          players: [{ id: p.id, side: "home", line: { rushYds: yards } }],
        },
        new Map([[p.id, p]]),
      );
    };
    play(a, 150, 1);
    const list = recordList(l, "league", "game", "rushYds");
    expect(list.top[0]!.name).toBe(`${a.firstName} ${a.lastName}`);
    expect(list.broken).toHaveLength(0);
    // An old book: make the mark a few seasons old, as a real record would be.
    list.top[0]!.season = l.season - 10;
    list.top[0]!.real = true;
    play(b, 180, 2);
    expect(list.top[0]!.name).toBe(`${b.firstName} ${b.lastName}`);
    expect(list.top[1]!.name).toBe(`${a.firstName} ${a.lastName}`);
    expect(list.broken.at(-1)!.previous.name).toBe(`${a.firstName} ${a.lastName}`);
    expect(l.news.some((n) => n.kind === "record" && n.headline.includes(b.lastName))).toBe(true);
    // A tie doesn't take the record from the holder.
    play(a, 180, 3);
    expect(list.top[0]!.playerId).toBe(b.id);
  });

  it("season and career marks follow a season of play, for the league and each franchise", () => {
    const l = afterOne();
    expect(l.records.length).toBeGreaterThan(100);
    const top = recordList(l, "league", "season", "passYds").top[0]!;
    expect(top.value).toBeGreaterThan(2500);
    const team = recordList(l, top.teamId!, "season", "passYds");
    expect(team.top[0]!.value).toBeGreaterThanOrEqual(top.value - 0.001);
    const view = recordsView(l);
    expect(view.lists.some((x) => x.level === "career")).toBe(true);
    // Re-running a week's check doesn't change the book or duplicate anyone.
    const before = JSON.stringify(l.records);
    seasonAndCareerRecords(l, withStats(l, 50));
    expect(JSON.stringify(l.records)).toBe(before);
  });
});

describe("awards", () => {
  it("a season's awards: every award has winners with reasons, MVPs are mostly quarterbacks", () => {
    const l = afterOne();
    const season = l.awards.filter((a) => a.season === l.season);
    for (const kind of ["mvp", "opoy", "dpoy", "oroy", "droy", "coach"] as const) {
      const winners = season.filter((a) => a.award === kind && a.place === 1);
      expect(winners, kind).toHaveLength(1);
      expect(winners[0]!.reason.length).toBeGreaterThan(10);
    }
    const mvp = season.find((a) => a.award === "mvp" && a.place === 1)!;
    const shares = season.filter((a) => a.award === "mvp").map((a) => a.share ?? 0);
    expect(shares[0]).toBeGreaterThanOrEqual(shares[1] ?? 0);
    expect(shares.reduce((x, y) => x + y, 0)).toBeLessThanOrEqual(1.05);
    expect(["QB", "RB", "WR", "TE"]).toContain(mvp.position);
    // Teams: first and second All-Pro and an All-Star Game selection, and the rookies really were rookies.
    expect(season.filter((a) => a.award === "all-pro-1").length).toBeGreaterThan(20);
    expect(season.filter((a) => a.award === "pro-bowl").length).toBeGreaterThan(40);
    const roy = l.players.find(
      (p) => p.id === season.find((a) => a.award === "oroy" && a.place === 1)!.playerId,
    )!;
    expect(roy.experience).toBeLessThanOrEqual(1);
    // Voting twice in one season changes nothing.
    const n = l.awards.length;
    seasonAwards(l);
    expect(l.awards.length).toBe(n);
    // Honors show on the winner's page.
    expect(honorsOf(l, mvp.playerId!).awards.some((a) => a.label === "MVP")).toBe(true);
  });

  it("All-Star Game selections set the fifth-year option: one at the transition tender, two at the franchise tender", () => {
    const l = afterOne();
    const shares = [0.3, 0.4, 0.2];
    const basic = fifthYearOptionSalary(l, "WR", 2030, shares, 0);
    const one = fifthYearOptionSalary(l, "WR", 2030, shares, 1);
    const two = fifthYearOptionSalary(l, "WR", 2030, shares, 2);
    expect(one).toBeGreaterThan(basic);
    expect(two).toBeGreaterThanOrEqual(one);
    // Many All-Star Game selections can't push it past two's tier.
    expect(fifthYearOptionSalary(l, "WR", 2030, shares, 3)).toBe(two);
  });
});

describe("the Hall of Fame", () => {
  let team = "NYA";
  /** A league whose history cards and awards make a few clear Hall of Famers and many ordinary careers. */
  function crowded(): League {
    const l = afterOne();
    // A franchise that retires numbers (some never do): the team of the test's players.
    const retiring = l.teams.find(
      (t) => uniformFrom(`${l.meta.seed}:retires-numbers:${t.id}`) < RETIRING.teamShare,
    )!.id;
    team = retiring;
    const base = l.players.find((p) => p.teamId)!;
    const card = (id: number, last: number, starts: number, peak: number, titles: number) => ({
      id,
      firstName: "Old",
      lastName: `Timer${id}`,
      position: "QB" as const,
      college: "Test",
      birthDate: "1970-01-01",
      drafted: null,
      experience: starts,
      retiredAfter: last,
      firstSeason: last - starts,
      lastSeason: last,
      lastAge: 38,
      teams: [team],
      seasonsStarted: starts,
      peak,
      career: {},
      number: 12,
      legend: false,
      titles,
    });
    l.formerPlayers.push(
      card(50_001, l.season - 8, 15, 96, 3), // an obvious Hall of Famer
      card(50_002, l.season - 8, 14, 94, 2),
      card(50_003, l.season - 7, 4, 70, 0), // an ordinary career
      card(50_004, l.season - 2, 16, 97, 4), // still waiting: retired only two seasons ago
    );
    for (const id of [50_001, 50_002, 50_004])
      for (let s = 0; s < 8; s++) {
        l.awards.push({
          season: 1990 + s,
          award: "all-pro-1",
          place: 1,
          playerId: id,
          coachId: null,
          name: "x",
          position: "QB",
          teamId: "NYA",
          share: null,
          reason: "",
          real: true,
        });
        l.awards.push({
          season: 1990 + s,
          award: "pro-bowl",
          place: 1,
          playerId: id,
          coachId: null,
          name: "x",
          position: "QB",
          teamId: "NYA",
          share: null,
          reason: "",
          real: true,
        });
      }
    l.awards.push({
      season: 1995,
      award: "mvp",
      place: 1,
      playerId: 50_001,
      coachId: null,
      name: "x",
      position: "QB",
      teamId: "NYA",
      share: 1,
      reason: "",
      real: true,
    });
    void base;
    return l;
  }

  it("follows the bylaws: five seasons' wait, 3 to 7 a class, the great ones in, the ordinary out", () => {
    const l = crowded();
    const R = l.rules.hallOfFame;
    const class1 = hallOfFameVote(l);
    const names = class1.map((c) => c.name);
    expect(class1.length).toBeGreaterThanOrEqual(R.classMin);
    expect(class1.length).toBeLessThanOrEqual(R.classMax);
    expect(names).toContain("Old Timer50001");
    expect(names).toContain("Old Timer50002");
    // Only players who last played at least five seasons ago are on the ballot.
    expect(names).not.toContain("Old Timer50004");
    // The bylaws call for at least three: the next-closest career fills the class.
    expect(names).toContain("Old Timer50003");
    // His number is retired by his team, and the jersey sweep never hands it out again.
    expect(l.retiredNumbers.some((r) => r.number === 12 && r.teamId === team)).toBe(true);
    const nya = l.players.filter((p) => p.teamId === team);
    nya[0]!.jersey = 12;
    nya[1]!.jersey = 12;
    assignJerseys(l, [team]);
    expect(nya.every((p) => p.jersey !== 12)).toBe(true);
    // One class a year.
    expect(hallOfFameVote(l)).toEqual([]);
    expect(almanacView(l).hallOfFame.length).toBe(class1.length);
  });

  it("a career's case grows with honors", () => {
    const l = crowded();
    const great = playerCase(
      l,
      l.formerPlayers.find((c) => c.id === 50_001)!,
    );
    const ordinary = playerCase(
      l,
      l.formerPlayers.find((c) => c.id === 50_003)!,
    );
    expect(great.score).toBeGreaterThan(ordinary.score + 20);
    expect(great.reason).toMatch(/MVP/);
  });
});

describe("history screens", () => {
  it("the almanac, a season recap, a franchise's history and a coaching tree read like a league's past", () => {
    const l = afterOne();
    const almanac = almanacView(l);
    expect(almanac.seasons[0]!.champion).not.toBeNull();
    expect(almanac.franchises.reduce((s, f) => s + f.titles, 0)).toBe(l.history.length);
    const recap = seasonRecapView(l, l.season);
    expect(recap.awards.some((a) => a.award === "mvp")).toBe(true);
    expect(recap.standings.length).toBe(32);
    expect(recap.leaders.length).toBeGreaterThan(5);
    const hist = teamHistoryView(l, l.teams[0]!.id);
    expect(hist.seasons).toHaveLength(l.history.length);
    const hc = l.coaches.find((c) => c.role === "HC")!;
    expect(coachTreeView(l, hc.id).id).toBe(hc.id);
  });
});

describe("saves", () => {
  it("a format-19 save loads with empty history and a newsfeed that starts from now", () => {
    const old = JSON.parse(AFTER_ONE);
    old.formatVersion = 19;
    for (const k of [
      "annals",
      "awards",
      "records",
      "hallOfFame",
      "retiredNumbers",
      "news",
      "newsCursor",
    ])
      delete old[k];
    delete old.nextIds.news;
    for (const f of old.formerPlayers) {
      delete f.number;
      delete f.legend;
      delete f.titles;
    }
    const l = parseLeague(JSON.stringify(old));
    expect(l.awards).toEqual([]);
    expect(l.records).toEqual([]);
    expect(l.news).toEqual([]);
    expect(l.newsCursor.transaction).toBeGreaterThan(0);
  });
});

describe("the real past", () => {
  /** Twelve real seasons for NYA (never in the playoffs, all losing), and a few legends and records. */
  function realPast(): RealHistoryInput {
    const annals = Array.from({ length: 12 }, (_, i) => ({
      season: 2013 + i,
      championId: i % 2 ? "NE" : "GB",
      runnerUpId: "DEN",
      final: [27, 17] as [number, number],
      teams: [
        {
          teamId: "NYA",
          city: "New York",
          wins: 4,
          losses: 13,
          ties: 0,
          pointsFor: 300,
          pointsAgainst: 400,
          playoffs: false,
        },
      ],
      coaches: {},
    }));
    return {
      annals,
      legends: [
        {
          key: "pfr:Old01",
          firstName: "Hank",
          lastName: "Oldfield",
          position: "QB",
          firstSeason: 1970,
          lastSeason: 1985,
          teams: ["NYA"],
          seasonsStarted: 12,
          career: { passYds: 41000 },
          number: 12,
          titles: 1,
        },
      ],
      awards: [
        {
          season: 1980,
          award: "mvp",
          place: 1,
          key: "pfr:Old01",
          name: "Hank Oldfield",
          position: "QB",
          teamId: "NYA",
          reason: "The real league's winner that season.",
        },
      ],
      hallOfFame: [
        {
          kind: "player",
          key: "pfr:Old01",
          name: "Hank Oldfield",
          position: "QB",
          teams: ["NYA"],
          inducted: 1996,
          reason: "5x first-team All-Pro.",
        },
      ],
      retiredNumbers: [
        { teamId: "NYA", number: 12, key: "pfr:Old01", name: "Hank Oldfield", season: 1990 },
      ],
      records: [
        {
          scope: "league",
          level: "game",
          stat: "passYds",
          top: [{ value: 554, key: null, name: "Pre-merger Passer", teamId: "LAB", season: 1951 }],
        },
      ],
    };
  }

  it("imports legends, awards, the Hall, retired numbers and records; they show on the almanac and pages", () => {
    const l = createLeague({ seed: 5, name: "Real" });
    applyRealHistory(l, realPast(), new Map());
    const legend = l.formerPlayers.find((c) => c.lastName === "Oldfield")!;
    expect(legend.legend).toBe(true);
    expect(honorsOf(l, legend.id).awards[0]!.seasons).toEqual([1980]);
    expect(l.awards[0]!.playerId).toBe(legend.id);
    expect(l.hallOfFame[0]!.playerId).toBe(legend.id);
    expect(l.retiredNumbers[0]).toMatchObject({ teamId: "NYA", number: 12, playerId: legend.id });
    // Real standing records keep their holder whatever year they were set.
    const rec = recordsView(l).lists.find((x) => x.level === "game" && x.stat === "passYds")!;
    expect(rec.top[0]).toMatchObject({ value: 554, season: 1951, real: true });
    // The almanac and a franchise page read the real seasons too.
    const almanac = almanacView(l);
    expect(almanac.seasons.at(-1)!.past).toBe(true);
    expect(almanac.franchises.find((f) => f.teamId === "GB")!.titles).toBe(6);
    expect(teamHistoryView(l, "NYA").seasons).toHaveLength(13); // twelve real, plus the league's own 2025
    // The jersey sweep keeps the retired number off the roster.
    const nya = l.players.filter((p) => p.teamId === "NYA");
    nya[0]!.jersey = 12;
    assignJerseys(l, ["NYA"]);
    expect(nya.every((p) => p.jersey !== 12)).toBe(true);
    // A legend isn't on the Hall's ballot (his fate was settled in the real league).
    expect(hallOfFameVote(l).every((c) => c.id !== legend.id)).toBe(true);
  });

  it("owners read only the last ten real seasons: a twelve-year drought counts as ten", () => {
    const l = createLeague({ seed: 5, name: "Real" });
    applyRealHistory(l, realPast(), new Map());
    const past = recentSeasons(l, "NYA").filter((s) => s.season < l.history[0]!.season);
    expect(past.length).toBe(PAST_YEARS_THAT_COUNT);
    expect(past.every((s) => !s.playoffs)).toBe(true);
    expect(Math.min(...past.map((s) => s.season))).toBe(
      l.history[0]!.season - PAST_YEARS_THAT_COUNT,
    );
    // The two seasons before that, though real, are too old to count.
    expect(losingSeasonsInRow(l, "NYA")).toBeLessThanOrEqual(PAST_YEARS_THAT_COUNT + 1);
    // A generated league has no real past: only its own seasons to read.
    const generated = createLeague({ seed: 5, name: "G" });
    expect(recentSeasons(generated, "NYA").length).toBe(generated.history.length);
  });
});
