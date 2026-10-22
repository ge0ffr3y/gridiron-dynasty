/**
 * The coaching carousel (Phase 10b): this season's firings and why, each
 * head-coach and coordinator search with its interviews and hire, every hire
 * and promotion, retirements, and the jobs still open. Until GM Mode the
 * league office can hire a candidate for any open job (he must be free to
 * sign: his own team's season over).
 */
import type { CarouselView } from "@fgm/sim-core";
import { useState } from "react";
import { Link } from "wouter";
import { ErrorNote, Loading, PageHeader } from "@/components/shared";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatLeagueDate } from "@/lib/format";
import { useLeagueKey, useSession } from "@/lib/session";
import { call, useSim } from "@/sim/client";

type Coach = CarouselView["searches"][number]["interviews"][number]["coach"];

function CoachLink({ coach }: { coach: Coach }) {
  return (
    <Link href={`/coach/${coach.id}`} className="font-medium hover:underline">
      {coach.name}
    </Link>
  );
}

export function CoachingPage() {
  const view = useSim("carouselView", {}, useLeagueKey("carousel"));
  const { bump } = useSession();
  const [message, setMessage] = useState<string>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  if (view.error) return <ErrorNote message={view.error} />;
  if (!view.data) return <Loading />;
  const v = view.data;

  const hire = async (teamId: string, role: Coach["role"], coachId: number) => {
    setBusy(true);
    setError(undefined);
    try {
      const r = await call("coachingMove", { kind: "hire", teamId, role, coachId });
      setMessage(r.message);
      bump();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={`${v.season} coaching carousel`}
        subtitle="Head coaches whose teams fall short of what their rosters should win are fired on Black Monday (and, rarely, during the season). Teams interview other clubs' coordinators and position coaches, coaches out of work, and new faces; a coach can't sign until his own team's season is over."
      />
      {message && (
        <p className="rounded-md border border-primary/40 bg-accent p-3 text-sm">{message}</p>
      )}
      {error && <ErrorNote message={error} />}

      {v.open.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Open jobs ({v.open.length})</CardTitle>
            <CardDescription>
              The best candidates for each, as that team rates them. The league office can hire any
              candidate who's free to sign.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {v.open.map((o) => (
              <div key={`${o.teamId}-${o.role}`} className="flex flex-col gap-1.5">
                <div className="text-sm font-medium">
                  <Link href={`/team/${o.teamId}`} className="hover:underline">
                    {o.teamId}
                  </Link>{" "}
                  · {o.roleName}
                </div>
                {o.candidates.length === 0 && (
                  <p className="text-sm text-muted-foreground">
                    Nobody out of work in this job yet: it's filled from the assistant ranks before
                    the new League Year.
                  </p>
                )}
                <ul className="flex flex-col gap-1 text-sm">
                  {o.candidates.map((c) => (
                    <li key={c.coach.id} className="flex flex-wrap items-center gap-2">
                      <CoachLink coach={c.coach} />
                      <span className="text-muted-foreground">
                        {c.coach.teamId ? `${c.coach.roleName}, ${c.coach.teamId}` : "out of work"}{" "}
                        · age {c.age} · reputation {c.reputation}
                        {!c.available && " · still coaching in the playoffs"}
                      </span>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-6 px-2 text-xs"
                        disabled={busy || !c.available}
                        title={
                          c.available
                            ? "Hire him for this job"
                            : "He can't sign until his team's season is over"
                        }
                        onClick={() => hire(o.teamId, o.role, c.coach.id)}
                      >
                        Hire
                      </Button>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Firings and departures ({v.departures.length})</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-1.5 text-sm">
          {v.departures.length === 0 && (
            <p className="text-muted-foreground">
              None yet: firings come on Black Monday, after the regular season.
            </p>
          )}
          {v.departures.map((d) => (
            <div key={`${d.date}-${d.coach.id}-${d.kind}`}>
              <span className="text-muted-foreground">{formatLeagueDate(d.date)} · </span>
              {d.teamId && (
                <Link href={`/team/${d.teamId}`} className="hover:underline">
                  {d.teamId}
                </Link>
              )}{" "}
              {d.kind === "fired"
                ? "fired"
                : d.kind === "interim"
                  ? "named interim head coach"
                  : "parted ways with"}{" "}
              {d.kind !== "interim" && <>{d.role.toLowerCase()} </>}
              <CoachLink coach={d.coach} />
              <span className="text-muted-foreground">: {d.reason}</span>
            </div>
          ))}
        </CardContent>
      </Card>

      {v.searches.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Searches</CardTitle>
            <CardDescription>
              Head-coach and coordinator searches: who was interviewed, and who got the job.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-2">
            {v.searches.map((s) => (
              <div
                key={`${s.teamId}-${s.role}`}
                className="flex flex-col gap-1 rounded-lg border p-3 text-sm"
              >
                <div className="font-medium">
                  {s.teamId} · {s.roleName}
                </div>
                {s.interviews.map((i) => (
                  <div key={i.coach.id} className="text-muted-foreground">
                    {formatLeagueDate(i.date)}: <CoachLink coach={i.coach} /> (
                    {i.coach.teamId && i.coach.teamId !== s.teamId
                      ? `${i.coach.roleName}, ${i.coach.teamId}`
                      : i.coach.roleName}
                    ) · {i.note}
                  </div>
                ))}
                {s.hired ? (
                  <div>
                    Hired {formatLeagueDate(s.hired.date)}: <CoachLink coach={s.hired.coach} />
                    <span className="text-muted-foreground"> · {s.hired.reason}</span>
                  </div>
                ) : (
                  <div className="text-muted-foreground">Still searching.</div>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Hires and promotions ({v.hires.length})</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-1.5 text-sm">
          {v.hires.length === 0 && <p className="text-muted-foreground">None yet.</p>}
          {v.hires.map((h, i) => (
            <div key={`${h.date}-${i}`}>
              <span className="text-muted-foreground">{formatLeagueDate(h.date)} · </span>
              {h.text}
              <span className="text-muted-foreground"> {h.reason}</span>
            </div>
          ))}
        </CardContent>
      </Card>

      {v.retirements.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Retirements ({v.retirements.length})</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-1 text-sm">
            {v.retirements.map((r) => (
              <div key={r.coach.id}>
                <CoachLink coach={r.coach} />
                <span className="text-muted-foreground">
                  {" "}
                  ({r.coach.roleName.toLowerCase()}): {r.reason}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
