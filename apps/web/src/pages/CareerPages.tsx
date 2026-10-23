/**
 * GM Mode (Phase 14): taking a job, meeting the owner, and the inbox where decisions wait for
 * you (with deadlines: sim past one and your staff decide), plus what you hand to your staff.
 */
import { useState, type FormEvent } from "react";
import { Link, useLocation } from "wouter";
import { ErrorNote, Loading, PageHeader } from "@/components/shared";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Label } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatLeagueDate } from "@/lib/format";
import { millions as formatMoney } from "@/pages/FreeAgencyPage";
import { useLeagueKey, useSession } from "@/lib/session";
import { cn } from "@/lib/utils";
import { call, useSim } from "@/sim/client";
import type { DelegationArea, InboxItem, JobSecurity, OwnerMeeting, Tip } from "@fgm/sim-core";

const STANCE: Record<string, string> = {
  contend: "Contending",
  retool: "Retooling",
  rebuild: "Rebuilding",
};

const KIND_LABEL: Record<string, string> = {
  "trade-offer": "Trade offer",
  "re-sign": "Expiring contract",
  "draft-pick": "On the clock",
  cutdown: "Final cuts",
  dispute: "Contract dispute",
  extension: "Extension window",
  "coach-vacancy": "Coaching vacancy",
  interview: "Interview request",
  owner: "From the owner",
};

/** Pick a team and take the job. */
export function StartCareerPage() {
  const { bump } = useSession();
  const [, navigate] = useLocation();
  const view = useSim("gmCareerView", {}, useLeagueKey("career"));
  const [teamId, setTeamId] = useState<string | null>(null);
  const [first, setFirst] = useState("");
  const [last, setLast] = useState("");
  const [meeting, setMeeting] = useState<OwnerMeeting | null>(null);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  if (view.error) return <ErrorNote message={view.error} />;
  if (!view.data) return <Loading />;
  if (meeting) return <OwnerMeetingCard meeting={meeting} onDone={() => navigate("/inbox")} />;
  if (view.data.active)
    return (
      <div className="flex flex-col gap-4">
        <PageHeader title="GM Mode" subtitle={`You run the ${view.data.teamName}.`} />
        <p className="text-sm">
          <Link href="/inbox" className="underline">
            Go to your inbox
          </Link>
        </p>
      </div>
    );

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!teamId) return setError("Pick a team first.");
    setBusy(true);
    setError(undefined);
    try {
      setMeeting(await call("startCareer", { teamId, firstName: first, lastName: last }));
      bump();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="flex flex-col gap-6" onSubmit={(e) => void submit(e)}>
      <PageHeader
        title="Take a GM job"
        subtitle="Pick the team you'll run. The other 31 stay in their AI front offices' hands."
      />
      <Card>
        <CardHeader>
          <CardTitle>Your name</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label htmlFor="gm-first">First name</Label>
            <Input
              id="gm-first"
              value={first}
              onChange={(e) => setFirst(e.target.value)}
              maxLength={30}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="gm-last">Last name</Label>
            <Input
              id="gm-last"
              value={last}
              onChange={(e) => setLast(e.target.value)}
              maxLength={30}
            />
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>The openings</CardTitle>
          <CardDescription>
            Last season's record, where the front office thinks the team stands, its owner, and cap
            room this League Year.
          </CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Team</TableHead>
                <TableHead>Last season</TableHead>
                <TableHead>Stance</TableHead>
                <TableHead>Owner</TableHead>
                <TableHead className="text-right">Cap room</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {view.data.jobs.map((j) => (
                <TableRow
                  key={j.teamId}
                  onClick={() => setTeamId(j.teamId)}
                  aria-selected={teamId === j.teamId}
                  className={cn("cursor-pointer", teamId === j.teamId && "bg-primary/10")}
                >
                  <TableCell className="font-medium">
                    <label className="flex cursor-pointer items-center gap-2">
                      <input
                        type="radio"
                        name="team"
                        checked={teamId === j.teamId}
                        onChange={() => setTeamId(j.teamId)}
                      />
                      {j.name}
                    </label>
                  </TableCell>
                  <TableCell className="tabular-nums">
                    {j.record}
                    {j.playoffs ? " · playoffs" : ""}
                  </TableCell>
                  <TableCell>{STANCE[j.stance] ?? j.stance}</TableCell>
                  <TableCell>
                    {j.owner}
                    {j.ownerTraits.length > 0 && (
                      <div className="text-xs text-muted-foreground">
                        {j.ownerTraits.join(", ")}
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatMoney(j.capRoom)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      {error && <ErrorNote message={error} />}
      <div>
        <Button type="submit" disabled={busy || !teamId}>
          {busy ? "Signing your contract…" : "Take the job"}
        </Button>
      </div>
    </form>
  );
}

function OwnerMeetingCard({ meeting, onDone }: { meeting: OwnerMeeting; onDone: () => void }) {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={`Welcome to the ${meeting.team}`}
        subtitle="Your first meeting with the owner."
      />
      <MeetingBody meeting={meeting} />
      <div>
        <Button onClick={onDone}>To your inbox</Button>
      </div>
    </div>
  );
}

function MeetingBody({ meeting }: { meeting: OwnerMeeting }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{meeting.owner}</CardTitle>
        <CardDescription>{meeting.traits.join(", ") || "A typical owner."}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm">
        <p>
          <span className="font-medium">This season: </span>“{meeting.expects}”
        </p>
        <p>
          <span className="font-medium">Money: </span>“{meeting.budget}”
        </p>
        <p className="text-muted-foreground">
          Cap room this League Year: {formatMoney(meeting.capRoom)}.
        </p>
        {meeting.situation.length > 0 && (
          <ul className="list-disc pl-5 text-muted-foreground">
            {meeting.situation.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

/** The inbox: open decisions, what your staff did, and who handles what. */
export function InboxPage() {
  const { bump } = useSession();
  const [, navigate] = useLocation();
  const view = useSim("gmCareerView", {}, useLeagueKey("career"));
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  if (view.error) return <ErrorNote message={view.error} />;
  if (!view.data) return <Loading />;
  const v = view.data;
  if (!v.active && v.status === "fired")
    return (
      <div className="flex flex-col gap-4">
        <PageHeader title="Inbox" subtitle="You're out of a job." />
        <p className="text-sm">
          <Link href="/career" className="underline">
            See your job offers
          </Link>{" "}
          ({v.offers.length}) on your career page.
        </p>
      </div>
    );
  if (!v.active)
    return (
      <div className="flex flex-col gap-4">
        <PageHeader title="Inbox" subtitle="This league runs in Simulation Mode." />
        <p className="text-sm">
          <Link href="/career/start" className="underline">
            Take over a team
          </Link>{" "}
          to play GM Mode.
        </p>
      </div>
    );

  async function answer(item: InboxItem, choice: string, goesTo: string | null) {
    if (goesTo) return navigate(goesTo);
    try {
      const r = await call("answerInbox", { decisionId: item.id, choice });
      setMessage({ ok: true, text: r.message });
    } catch (e) {
      setMessage({ ok: false, text: (e as Error).message });
    } finally {
      // A refused answer can still close the item (an offer that went stale).
      bump();
    }
  }

  async function delegate(area: DelegationArea, who: "you" | "staff") {
    try {
      await call("delegate", { area, who });
      bump();
    } catch (e) {
      setMessage({ ok: false, text: (e as Error).message });
    }
  }

  const groups = new Map<string, InboxItem[]>();
  for (const item of v.inbox) groups.set(item.kind, [...(groups.get(item.kind) ?? []), item]);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Inbox"
        subtitle={`${v.gm?.name ?? "You"}, general manager of the ${v.teamName} since ${v.startedSeason}.`}
      />
      <Tips tips={v.tips} />
      {message && (
        <p className={cn("text-sm", message.ok ? "text-muted-foreground" : "text-destructive")}>
          {message.text}
        </p>
      )}
      {v.inbox.length === 0 ? (
        <Card>
          <CardContent className="py-6 text-sm text-muted-foreground">
            Nothing needs you right now. “Sim to next decision” runs until something does.
          </CardContent>
        </Card>
      ) : (
        [...groups].map(([kind, items]) => (
          <Card key={kind}>
            <CardHeader>
              <CardTitle>
                {KIND_LABEL[kind] ?? kind} ({items.length})
              </CardTitle>
              <CardDescription>
                {items[0]!.deadline
                  ? items.some((i) => i.dueNow)
                    ? "Due now: if you sim on, your staff decide these."
                    : `Decide by ${formatLeagueDate(items[0]!.deadline)}, or your staff will.`
                  : "No deadline."}
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col divide-y">
              {items.map((item) => (
                <div key={item.id} className="flex flex-wrap items-center gap-3 py-2">
                  <div className="min-w-0 flex-1 text-sm">
                    <p>{item.prompt}</p>
                    {item.details.map((d) => (
                      <p key={d} className="text-xs text-muted-foreground">
                        {d}
                      </p>
                    ))}
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {item.options.map((o, i) => (
                      <Button
                        key={o.choice}
                        size="sm"
                        variant={i === 0 ? "default" : "outline"}
                        onClick={() => void answer(item, o.choice, o.goesTo)}
                      >
                        {o.label}
                      </Button>
                    ))}
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        ))
      )}

      {v.meeting && (
        <div className="flex flex-col gap-2">
          <h3 className="text-lg font-semibold">Your owner</h3>
          {v.security && (
            <Card>
              <CardContent className="pt-6">
                <SecurityMeter security={v.security} />
                <Link href="/career" className="mt-2 inline-block text-xs underline">
                  Your career page
                </Link>
              </CardContent>
            </Card>
          )}
          <MeetingBody meeting={v.meeting} />
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Who handles what</CardTitle>
          <CardDescription>
            Areas you keep come to your inbox. Areas you hand over, your staff run the way an AI
            front office would, and the log below says what they did.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col divide-y">
          {v.delegation.map((d) => (
            <div key={d.area} className="flex flex-wrap items-center gap-3 py-2">
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium">{d.label}</div>
                <div className="text-xs text-muted-foreground">{d.staff}</div>
              </div>
              <div
                className="flex overflow-hidden rounded-md border"
                role="radiogroup"
                aria-label={d.label}
              >
                {(["you", "staff"] as const).map((who) => (
                  <button
                    key={who}
                    type="button"
                    role="radio"
                    aria-checked={d.who === who}
                    onClick={() => void delegate(d.area, who)}
                    className={cn(
                      "px-3 py-1 text-xs",
                      d.who === who ? "bg-primary text-primary-foreground" : "hover:bg-accent",
                    )}
                  >
                    {who === "you" ? "You" : "Staff"}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Decision log</CardTitle>
          <CardDescription>
            Newest first: what you decided, and what your staff did.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {v.log.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing yet.</p>
          ) : (
            <ul className="flex flex-col gap-1.5 text-sm">
              {v.log.map((l, i) => (
                <li key={i} className="flex gap-3">
                  <span className="w-24 shrink-0 text-xs text-muted-foreground tabular-nums">
                    {formatLeagueDate(l.date)}
                  </span>
                  <span
                    className={cn(
                      "w-12 shrink-0 text-xs",
                      l.by === "staff" ? "text-muted-foreground" : "font-medium",
                    )}
                  >
                    {l.by === "staff" ? "Staff" : "You"}
                  </span>
                  <span className="min-w-0">{l.text}</span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/** First-season tips for this moment, each dismissible. */
export function Tips({ tips }: { tips: Tip[] }) {
  const { bump } = useSession();
  if (tips.length === 0) return null;
  const dismiss = async (id: string) => {
    await call("dismissTip", { id });
    bump();
  };
  return (
    <div className="flex flex-col gap-2">
      {tips.map((t) => (
        <div key={t.id} className="rounded-lg border border-primary/40 bg-primary/5 p-3 text-sm">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="font-medium">{t.title}</div>
              <p className="mt-1 text-muted-foreground">{t.text}</p>
              {t.link && (
                <Link href={t.link} className="mt-1 inline-block text-xs underline">
                  Take me there
                </Link>
              )}
            </div>
            <div className="flex shrink-0 flex-col gap-1">
              <Button size="sm" variant="outline" onClick={() => void dismiss(t.id)}>
                Got it
              </Button>
              <button
                type="button"
                className="text-xs text-muted-foreground hover:underline"
                onClick={() => void dismiss("all")}
              >
                No more tips
              </button>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

/** A 0-100 meter: green when safe, red when not. */
function SecurityMeter({ security }: { security: JobSecurity }) {
  const tone =
    security.score >= 70 ? "bg-primary" : security.score >= 40 ? "bg-chart-2" : "bg-destructive";
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between text-sm">
        <span className="font-medium">Job security</span>
        <span className="tabular-nums">{security.score} / 100</span>
      </div>
      <div
        className="h-2.5 overflow-hidden rounded bg-muted"
        role="meter"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={security.score}
        aria-label="Job security"
      >
        <div className={cn("h-full rounded", tone)} style={{ width: `${security.score}%` }} />
      </div>
      <p className="text-xs text-muted-foreground">
        If the season ended today: {Math.round(security.chance * 100)}% chance he'd fire you.{" "}
        {security.reason} {security.standing}
      </p>
    </div>
  );
}

/** Your career: job security, the owner, record by season, drafts, trades; offers after a firing. */
export function CareerPage() {
  const { bump } = useSession();
  const [, navigate] = useLocation();
  const view = useSim("careerPageView", {}, useLeagueKey("career-page"));
  const [error, setError] = useState<string>();
  if (view.error) return <ErrorNote message={view.error} />;
  if (!view.data) return <Loading />;
  const v = view.data;
  if (!v.status || !v.gm)
    return (
      <div className="flex flex-col gap-4">
        <PageHeader title="Career" subtitle="This league runs in Simulation Mode." />
        <p className="text-sm">
          <Link href="/career/start" className="underline">
            Take over a team
          </Link>{" "}
          to start a GM career.
        </p>
      </div>
    );

  async function act(fn: () => Promise<unknown>, then?: string) {
    try {
      setError(undefined);
      await fn();
      bump();
      if (then) navigate(then);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const t = v.totals;
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={v.gm.name}
        subtitle={
          v.status === "active"
            ? `General manager of the ${v.seasons[0]?.team ?? v.teamId} · reputation ${v.gm.reputation}`
            : v.status === "fired"
              ? `Out of work · reputation ${v.gm.reputation}`
              : "Retired"
        }
      />
      {error && <ErrorNote message={error} />}
      {v.status === "fired" && (
        <Card>
          <CardHeader>
            <CardTitle>Job offers</CardTitle>
            <CardDescription>
              Take one and your career goes on there. Or wait: the league plays on and new offers
              come after next season's Black Monday. Or retire, and watch in Simulation Mode.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {v.offers.length === 0 && (
              <p className="text-sm text-muted-foreground">No team has called.</p>
            )}
            {v.offers.map((o) => (
              <div key={o.teamId} className="flex flex-wrap items-center gap-3">
                <div className="min-w-0 flex-1 text-sm">
                  <div className="font-medium">{o.team}</div>
                  <div className="text-xs text-muted-foreground">{o.reason}</div>
                </div>
                <Button
                  size="sm"
                  onClick={() => void act(() => call("takeJob", { teamId: o.teamId }), "/inbox")}
                >
                  Take the job
                </Button>
              </div>
            ))}
            <div>
              <Button
                size="sm"
                variant="outline"
                onClick={() => void act(() => call("retireCareer", {}))}
              >
                Retire
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
      {v.security && (
        <Card>
          <CardContent className="flex flex-col gap-4 pt-6">
            <SecurityMeter security={v.security} />
            {v.budget && (
              <p className="text-sm">
                <span className="font-medium">The owner's budget: </span>
                {formatMoney(v.budget.cash)} paid out this League Year of{" "}
                {formatMoney(v.budget.budget)}.
              </p>
            )}
          </CardContent>
        </Card>
      )}
      {v.owner.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>From the owner</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-col gap-1.5 text-sm">
              {v.owner.map((l, i) => (
                <li key={i} className="flex gap-3">
                  <span className="w-24 shrink-0 text-xs text-muted-foreground tabular-nums">
                    {formatLeagueDate(l.date)}
                  </span>
                  <span className="min-w-0">{l.text}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
      <Card>
        <CardHeader>
          <CardTitle>Record</CardTitle>
          <CardDescription>
            {t.wins}-{t.losses}
            {t.ties ? `-${t.ties}` : ""} · {t.playoffs} playoff trip{t.playoffs === 1 ? "" : "s"} ·{" "}
            {t.titles} title{t.titles === 1 ? "" : "s"}
          </CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Season</TableHead>
                <TableHead>Team</TableHead>
                <TableHead>Record</TableHead>
                <TableHead>Result</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {v.seasons.map((s) => (
                <TableRow key={`${s.season}-${s.team}`}>
                  <TableCell className="tabular-nums">{s.season}</TableCell>
                  <TableCell>{s.team}</TableCell>
                  <TableCell className="tabular-nums">{s.record}</TableCell>
                  <TableCell>
                    {s.inProgress
                      ? "In progress"
                      : s.champion
                        ? "Champions"
                        : s.playoffs
                          ? "Playoffs"
                          : "Missed the playoffs"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      {v.drafts.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Your drafts</CardTitle>
            <CardDescription>
              Grades compare seasons started with what real picks at the same slot started.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {v.drafts.map((d) => (
              <div key={d.season}>
                <div className="mb-1 text-sm font-medium">
                  {d.season} · {d.team}
                </div>
                <ul className="grid gap-1 text-sm sm:grid-cols-2">
                  {d.picks.map((p) => (
                    <li key={p.overall}>
                      <span className="tabular-nums text-muted-foreground">#{p.overall}</span>{" "}
                      <Link href={`/player/${p.id}`} className="hover:underline">
                        {p.name}
                      </Link>{" "}
                      <span className="text-xs text-muted-foreground">
                        {p.position} · {p.grade}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
      {v.gm.trades.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Your trades</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-col gap-1.5 text-sm">
              {v.gm.trades.map((tr, i) => (
                <li key={i} className="flex gap-3">
                  <span className="w-24 shrink-0 text-xs text-muted-foreground tabular-nums">
                    {formatLeagueDate(tr.date)}
                  </span>
                  <span className="min-w-0">{tr.text}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
      {v.gm.moves.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Hired and fired</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-col gap-1.5 text-sm">
              {v.gm.moves.map((m, i) => (
                <li key={i}>
                  <span className="text-xs text-muted-foreground">{formatLeagueDate(m.date)}</span>{" "}
                  {m.text} <span className="text-xs text-muted-foreground">{m.reason}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

/** Cap and roster terms in plain English. */
export function GlossaryPage() {
  const view = useSim("glossaryView", {}, useLeagueKey("glossary"));
  if (view.error) return <ErrorNote message={view.error} />;
  if (!view.data) return <Loading />;
  const groups = new Map<string, typeof view.data>();
  for (const e of view.data) groups.set(e.group, [...(groups.get(e.group) ?? []), e]);
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Glossary"
        subtitle="The cap and roster rules in plain English. Numbers are this league's rules."
      />
      {[...groups].map(([group, entries]) => (
        <Card key={group}>
          <CardHeader>
            <CardTitle>{group}</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="flex flex-col gap-3 text-sm">
              {entries.map((e) => (
                <div key={e.term}>
                  <dt className="font-medium">{e.term}</dt>
                  <dd className="text-muted-foreground">{e.text}</dd>
                </div>
              ))}
            </dl>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
