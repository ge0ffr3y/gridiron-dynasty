import { CoachTree } from "@/pages/HistoryPages";
import { useState } from "react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { PhilosophyChart } from "@/components/PhilosophyChart";
import { ErrorNote, Facts, Loading, RatingBar, TeamChip } from "@/components/shared";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatLeagueDate } from "@/lib/format";
import { useLeagueKey, useSession } from "@/lib/session";
import { call, useSim } from "@/sim/client";

export function CoachPage({ coachId }: { coachId: number }) {
  const view = useSim("coachView", { id: coachId }, useLeagueKey(String(coachId)));
  const { bump } = useSession();
  const [message, setMessage] = useState<string>();
  const [error, setError] = useState<string>();
  if (view.error) return <ErrorNote message={view.error} />;
  if (!view.data) return <Loading />;
  const c = view.data;
  const fire = async () => {
    setError(undefined);
    try {
      setMessage((await call("coachingMove", { kind: "fire", coachId })).message);
      bump();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{c.name}</h1>
        <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          {c.team && <TeamChip team={c.team} />}
          <span>
            {c.roleName}
            {c.team && (
              <>
                {" · "}
                <Link href={`/team/${c.team.id}`} className="hover:underline">
                  {c.team.city} {c.team.nickname}
                </Link>
              </>
            )}
          </span>
        </div>
      </div>

      {message && (
        <p className="rounded-md border border-primary/40 bg-accent p-3 text-sm">{message}</p>
      )}
      {error && <ErrorNote message={error} />}
      {c.team && (
        <div>
          <Button
            variant="outline"
            size="sm"
            onClick={fire}
            title="League office decision: in Simulation Mode the league office can act for any team. The job then opens on the coaching page."
          >
            Fire (league office)
          </Button>
        </div>
      )}

      <Card>
        <CardContent>
          <Facts
            items={[
              ["Age", c.age],
              ["Born", formatLeagueDate(c.birthDate)],
              ["Years coaching", c.experience],
              ["Offensive scheme", c.offensiveScheme ?? "—"],
              ["Defensive scheme", c.defensiveScheme ?? "—"],
            ]}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Philosophy{c.summary ? `: ${c.summary}` : ""}</CardTitle>
          <CardDescription>
            How he likes to play, against the league average, in points of each real rate (a full
            bar is about as far as the most extreme real teams). His own job's side is in color; the
            rest is how he'd coach if he moved.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <PhilosophyChart lines={c.philosophy} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>In his job</CardTitle>
          <CardDescription>What he does for his team, against a typical staff.</CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="list-disc pl-5 text-sm">
            {c.effects.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Career</CardTitle>
          <CardDescription>
            Reputation {c.career.reputation} of 100
            {c.career.contractThrough !== null &&
              ` · under contract through ${c.career.contractThrough}`}
            {c.career.interim && " · interim head coach"}
            {c.career.retiredAfter !== null && ` · retired after ${c.career.retiredAfter}`}
            {c.career.specialty && ` · scouting specialty: ${c.career.specialty}`}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 text-sm">
          {c.career.career.length === 0 ? (
            <p className="text-muted-foreground">No seasons recorded yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Season</TableHead>
                  <TableHead>Team</TableHead>
                  <TableHead>Job</TableHead>
                  <TableHead>Record</TableHead>
                  <TableHead>Under</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {c.career.career.map((e, i) => (
                  <TableRow key={`${e.season}-${e.teamId}-${i}`}>
                    <TableCell>{e.season}</TableCell>
                    <TableCell>
                      {e.teamId ? (
                        <Link href={`/team/${e.teamId}`} className="hover:underline">
                          {e.teamId}
                        </Link>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                    <TableCell>{e.role}</TableCell>
                    <TableCell className="tabular-nums">
                      {e.record
                        ? `${e.record.wins}-${e.record.losses}${e.record.ties ? `-${e.record.ties}` : ""}`
                        : ""}
                    </TableCell>
                    <TableCell>
                      {e.under && (
                        <Link href={`/coach/${e.under.id}`} className="hover:underline">
                          {e.under.name}
                        </Link>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          {(c.career.workedUnder.length > 0 || c.career.coachedUnderHim.length > 0) && (
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <div className="font-medium">Worked under</div>
                {c.career.workedUnder.length === 0 && <p className="text-muted-foreground">—</p>}
                {c.career.workedUnder.map((m) => (
                  <div key={m.id}>
                    <Link href={`/coach/${m.id}`} className="hover:underline">
                      {m.name}
                    </Link>
                  </div>
                ))}
              </div>
              <div>
                <div className="font-medium">His coaching tree</div>
                {c.career.coachedUnderHim.length === 0 && (
                  <p className="text-muted-foreground">—</p>
                )}
                {c.career.coachedUnderHim.map((p) => (
                  <div key={p.id}>
                    <Link href={`/coach/${p.id}`} className="hover:underline">
                      {p.name}
                    </Link>{" "}
                    <span className="text-muted-foreground">({p.current})</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Coaching tree</CardTitle>
          <CardDescription>
            Coaches who worked under him and went on to coordinate or lead teams, and theirs in
            turn. Click a name to open his page.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <CoachTree coachId={coachId} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Skills</CardTitle>
          <CardDescription>0 to 100; his job's main skill matters most.</CardDescription>
        </CardHeader>
        <CardContent className="flex max-w-xl flex-col gap-2">
          {c.attributes.map((a) => (
            <RatingBar key={a.key} label={a.label} value={a.value} />
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
