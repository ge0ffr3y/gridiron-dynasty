/**
 * GM Mode screens (Phase 14): the inbox, the career log and the delegation switches.
 */
import { DELEGATION_AREAS, type DelegationArea, type League } from "../league/schema";
import { AREA_LABELS, personTeam } from "./delegation";
import { POINTER_ANSWERS } from "./answers";
import { ownerMeeting, type OwnerMeeting } from "./start";
import { describeOwner, ownerOf, ownerStyle } from "../front-office/executives";
import { capSheet } from "../contracts/team";
import { updatePlans } from "../front-office/evaluate";
import { describeSide, executiveView, type ExecutiveView } from "../front-office/views";
import { recordOf } from "../coaches/carousel";
import { draftHistoryView } from "../draft/views";
import type { Viewer } from "../perception";
import { jobSecurity, ownerBudget, type JobSecurity } from "./job";
import { currentTips, type Tip } from "./tips";

export interface InboxItem {
  id: number;
  kind: string;
  prompt: string;
  options: { choice: string; label: string; goesTo: string | null }[];
  createdOn: string;
  deadline: string | null;
  /** More about it (a trade offer's pieces). */
  details: string[];
  /** Due now: the next sim step hands it to your staff. */
  dueNow: boolean;
  link: string | null;
}

export interface GmCareerView {
  /** No career: Simulation Mode (anyone may take over a team). */
  active: boolean;
  status: "active" | "fired" | "retired" | null;
  teamId: string | null;
  teamName: string | null;
  gm: { id: number; name: string } | null;
  startedSeason: number | null;
  inbox: InboxItem[];
  log: { date: string; kind: string; by: "you" | "staff" | "owner"; text: string }[];
  delegation: { area: DelegationArea; label: string; staff: string; who: "you" | "staff" }[];
  meeting: OwnerMeeting | null;
  /** Teams you could take over (when you don't run one). */
  jobs: JobRow[];
  /** Your job security and the owner's mood (Phase 14b). */
  security: JobSecurity | null;
  /** Tips for this moment of your first seasons. */
  tips: Tip[];
  /** Offers after a firing. */
  offers: { teamId: string; team: string; reason: string }[];
}

export interface JobRow {
  teamId: string;
  name: string;
  /** Last season's record. */
  record: string;
  playoffs: boolean;
  stance: string;
  owner: string;
  ownerTraits: string[];
  capRoom: number;
}

function details(league: League, offerId: number | undefined): string[] {
  const o = offerId === undefined ? null : league.tradeOffers.find((x) => x.id === offerId);
  if (!o) return [];
  return [
    `You get: ${describeSide(league, o.give).join(", ") || "nothing"}`,
    `You give: ${describeSide(league, o.get).join(", ") || "nothing"}`,
  ];
}

function jobs(league: League): JobRow[] {
  const last = league.history.at(-1);
  // A brand-new league hasn't had its front offices' reads yet: make them on a copy (a screen
  // never changes the league).
  let plans = new Map(league.teams.map((t) => [t.id, t.plan]));
  if (league.teams.some((t) => t.plan === null)) {
    const copy = JSON.parse(JSON.stringify(league)) as League;
    updatePlans(copy);
    plans = new Map(copy.teams.map((t) => [t.id, t.plan]));
  }
  return league.teams
    .map((t) => {
      const s = last?.standings.find((x) => x.teamId === t.id);
      const o = ownerOf(league, t.id);
      return {
        teamId: t.id,
        name: `${t.city} ${t.nickname}`,
        record: s ? `${s.wins}-${s.losses}${s.ties ? `-${s.ties}` : ""}` : "",
        playoffs: s ? s.seed !== null : false,
        stance: plans.get(t.id)?.stance ?? "retool",
        owner: o ? `${o.firstName} ${o.lastName}` : "",
        ownerTraits: describeOwner(ownerStyle(league, t.id)),
        capRoom: capSheet(league, t.id, league.season).room,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

const LABELS: Record<string, string> = {
  accept: "Accept",
  decline: "Decline",
  "re-sign": "Negotiate",
  "franchise-tag": "Franchise tag",
  "transition-tag": "Transition tag",
  tender: "Tender",
  "let-go": "Let him go",
  pick: "Go to the draft room",
  done: "I've made my cuts",
  extend: "Negotiate an extension",
  "play-it-out": "Let him play it out",
  trade: "Shop him",
  wait: "Wait him out",
  hire: "Go to Coaching",
  ok: "Noted",
};

export function gmCareerView(league: League): GmCareerView {
  const c = league.career;
  const teamId = personTeam(league);
  const team = teamId ? league.teams.find((t) => t.id === teamId) : null;
  const me = c ? league.executives.find((e) => e.id === c.executiveId) : null;
  const inbox: InboxItem[] = league.pendingDecisions
    .filter((d) => d.teamId === teamId)
    .sort((a, b) => (a.deadline ?? "9999").localeCompare(b.deadline ?? "9999") || a.id - b.id)
    .map((d) => ({
      id: d.id,
      kind: d.request.kind,
      prompt: d.request.prompt,
      options: d.request.options.map((choice) => ({
        choice,
        label: LABELS[choice] ?? choice,
        goesTo: POINTER_ANSWERS.has(choice)
          ? choice === "trade"
            ? "/trade"
            : (d.request.link ?? null)
          : null,
      })),
      details: details(league, d.request.offerId),
      createdOn: d.createdOn,
      deadline: d.deadline ?? null,
      dueNow: d.deadline != null && d.deadline <= league.date,
      link: d.request.link ?? null,
    }));
  return {
    active: teamId !== null,
    status: c?.status ?? null,
    teamId,
    teamName: team ? `${team.city} ${team.nickname}` : null,
    gm: me ? { id: me.id, name: `${me.firstName} ${me.lastName}` } : null,
    startedSeason: c?.startedSeason ?? null,
    inbox,
    log: [...(c?.log ?? [])].reverse().slice(0, 80),
    delegation: c
      ? DELEGATION_AREAS.map((area) => ({ area, ...AREA_LABELS[area], who: c.delegation[area] }))
      : [],
    meeting: teamId ? ownerMeeting(league) : null,
    jobs: teamId ? [] : jobs(league),
    security: jobSecurity(league),
    tips: currentTips(league),
    offers: (c?.offers ?? []).map((o) => {
      const t = league.teams.find((x) => x.id === o.teamId);
      return { teamId: o.teamId, team: t ? `${t.city} ${t.nickname}` : o.teamId, reason: o.reason };
    }),
  };
}

// ---------------------------------------------------------------------------
// The career page (Phase 14b)

export interface CareerPageView {
  status: "active" | "fired" | "retired" | null;
  teamId: string | null;
  gm: ExecutiveView | null;
  security: JobSecurity | null;
  budget: { budget: number; cash: number } | null;
  seasons: {
    season: number;
    team: string;
    record: string;
    playoffs: boolean;
    champion: boolean;
    inProgress: boolean;
  }[];
  totals: { wins: number; losses: number; ties: number; playoffs: number; titles: number };
  drafts: {
    season: number;
    team: string;
    picks: {
      overall: number;
      round: number;
      id: number;
      name: string;
      position: string;
      grade: string;
      started: number;
    }[];
  }[];
  offers: { teamId: string; team: string; reason: string }[];
  owner: { date: string; text: string }[];
}

export function careerPageView(league: League, viewer: Viewer): CareerPageView {
  const c = league.career;
  const empty: CareerPageView = {
    status: null,
    teamId: null,
    gm: null,
    security: null,
    budget: null,
    seasons: [],
    totals: { wins: 0, losses: 0, ties: 0, playoffs: 0, titles: 0 },
    drafts: [],
    offers: [],
    owner: [],
  };
  if (!c) return empty;
  const me = league.executives.find((e) => e.id === c.executiveId);
  if (!me) return empty;
  const name = (id: string) => {
    const t = league.teams.find((x) => x.id === id);
    return t ? `${t.city} ${t.nickname}` : id;
  };
  const champions = new Map(league.history.map((h) => [h.season, h.championId]));
  const lines = me.career.filter((l) => l.teamId !== null);
  const seasons: CareerPageView["seasons"] = lines.map((l) => ({
    season: l.season,
    team: name(l.teamId!),
    record: l.record
      ? `${l.record.wins}-${l.record.losses}${l.record.ties ? `-${l.record.ties}` : ""}`
      : "",
    playoffs: l.playoffs,
    champion: champions.get(l.season) === l.teamId,
    inProgress: false,
  }));
  const team = personTeam(league);
  if (team && !lines.some((l) => l.season === league.season && l.teamId === team)) {
    const r = recordOf(league, team);
    // Once the championship is played, the season's history entry is written.
    const done = league.history.find((h) => h.season === league.season);
    seasons.push({
      season: league.season,
      team: name(team),
      record: `${r.wins}-${r.losses}${r.ties ? `-${r.ties}` : ""}`,
      playoffs: done ? done.standings.some((s) => s.teamId === team && s.seed !== null) : false,
      champion: done?.championId === team,
      inProgress: !done,
    });
  }
  // A finished season counts before its career line is written (when the calendar turns).
  const finished = seasons.filter(
    (x) => !x.inProgress && !lines.some((l) => l.season === x.season),
  );
  const extra = finished.map((x) => {
    const [w, l, t] = x.record.split("-").map(Number);
    return {
      wins: w ?? 0,
      losses: l ?? 0,
      ties: t ?? 0,
      playoffs: x.playoffs,
      champion: x.champion,
    };
  });
  const lineTotals = lines.reduce(
    (t, l) => ({
      wins: t.wins + (l.record?.wins ?? 0),
      losses: t.losses + (l.record?.losses ?? 0),
      ties: t.ties + (l.record?.ties ?? 0),
      playoffs: t.playoffs + (l.playoffs ? 1 : 0),
      titles: t.titles + (champions.get(l.season) === l.teamId ? 1 : 0),
    }),
    { wins: 0, losses: 0, ties: 0, playoffs: 0, titles: 0 },
  );
  const totals = extra.reduce(
    (t, x) => ({
      wins: t.wins + x.wins,
      losses: t.losses + x.losses,
      ties: t.ties + x.ties,
      playoffs: t.playoffs + (x.playoffs ? 1 : 0),
      titles: t.titles + (x.champion ? 1 : 0),
    }),
    lineTotals,
  );
  // His drafts: each season he ran a team on draft day.
  const ran = new Map(lines.map((l) => [l.season, l.teamId!]));
  if (team && league.calendar.stage !== "offseason" && league.calendar.stage !== "free-agency")
    ran.set(league.season, team);
  const done = new Set(draftHistoryView(league, viewer).seasons);
  const drafts: CareerPageView["drafts"] = [...ran]
    .filter(([season]) => done.has(season))
    .sort((a, b) => b[0] - a[0])
    .map(([season, t]) => ({
      season,
      team: name(t),
      picks: draftHistoryView(league, viewer, season)
        .picks.filter((p) => p.teamId === t)
        .map((p) => ({
          overall: p.overall,
          round: p.round,
          id: p.player.id,
          name: p.player.name,
          position: p.player.position,
          grade: p.grade,
          started: p.started,
        })),
    }));
  return {
    status: c.status,
    teamId: team,
    gm: executiveView(league, me.id),
    security: jobSecurity(league),
    budget: team ? ownerBudget(league, team) : null,
    seasons: seasons.reverse(),
    totals,
    drafts,
    offers: c.offers.map((o) => ({ teamId: o.teamId, team: name(o.teamId), reason: o.reason })),
    owner: c.log
      .filter((l) => l.by === "owner")
      .slice(-30)
      .reverse()
      .map((l) => ({ date: l.date, text: l.text })),
  };
}
