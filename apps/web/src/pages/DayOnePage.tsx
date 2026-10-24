/**
 * "Where things stand" (Phase 16): the first screen of a new league. Last season's champion, the
 * top of the draft, cap room, the biggest players whose deals ran out, and the coaching and
 * front-office changes made before the first day.
 */
import { Link } from "wouter";
import { ErrorNote, Loading, OverallBadge, PageHeader } from "@/components/shared";
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
import { useLeagueKey } from "@/lib/session";
import { useSim } from "@/sim/client";

const millions = (d: number) => `${d < 0 ? "−" : ""}$${(Math.abs(d) / 1_000_000).toFixed(1)}M`;

export function DayOnePage() {
  const view = useSim("dayOneView", {}, useLeagueKey("dayOne"));
  if (view.error) return <ErrorNote message={view.error} />;
  if (!view.data) return <Loading />;
  const v = view.data;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Where things stand"
        subtitle={`${formatLeagueDate(v.date)}: the first day of the ${v.season} league year.`}
      >
        <Link href="/league" className="text-sm underline">
          League page
        </Link>
      </PageHeader>

      {v.lastSeason && (
        <Card>
          <CardHeader>
            <CardTitle>{v.lastSeason.season} champions</CardTitle>
            <CardDescription>
              {v.lastSeason.champion ?? "No champion recorded"}
              {v.lastSeason.runnerUp &&
                ` beat ${v.lastSeason.runnerUp}${v.lastSeason.score ? `, ${v.lastSeason.score}` : ""}`}
              .
            </CardDescription>
          </CardHeader>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>The top of the draft</CardTitle>
            <CardDescription>Who picks first, trades included.</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableBody>
                {v.draft.map((p) => (
                  <TableRow key={p.overall}>
                    <TableCell className="w-10 text-muted-foreground">#{p.overall}</TableCell>
                    <TableCell>
                      <Link href={`/team/${p.teamId}`} className="hover:underline">
                        {p.team}
                      </Link>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{p.note}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <Link href="/draft" className="mt-3 inline-block text-sm underline">
              Draft room
            </Link>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Cap room</CardTitle>
            <CardDescription>
              The most room to spend, and the teams that must cut before free agency.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 xl:grid-cols-2">
            {(
              [
                ["Most room", v.capRoom.most],
                ["Least room", v.capRoom.least],
              ] as const
            ).map(([label, rows]) => (
              <div key={label}>
                <div className="mb-1 text-xs font-medium uppercase text-muted-foreground">
                  {label}
                </div>
                <Table>
                  <TableBody>
                    {rows.map((r) => (
                      <TableRow key={r.teamId}>
                        <TableCell>
                          <Link href={`/team/${r.teamId}`} className="hover:underline">
                            {r.team}
                          </Link>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {millions(r.room)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Biggest free agents to be</CardTitle>
          <CardDescription>
            Deals that ran out with last season, by what the market would pay. Teams re-sign or tag
            some of them before free agency opens.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Player</TableHead>
                <TableHead>Pos</TableHead>
                <TableHead className="text-right">Age</TableHead>
                <TableHead className="text-right">Overall</TableHead>
                <TableHead>Team</TableHead>
                <TableHead className="text-right">Market a year</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {v.freeAgents.map((p) => (
                <TableRow key={p.id}>
                  <TableCell>
                    <Link href={`/player/${p.id}`} className="font-medium hover:underline">
                      {p.name}
                    </Link>
                  </TableCell>
                  <TableCell>{p.position}</TableCell>
                  <TableCell className="text-right">{p.age}</TableCell>
                  <TableCell className="text-right">
                    <OverallBadge value={p.overall} />
                  </TableCell>
                  <TableCell>
                    <Link href={`/team/${p.teamId}`} className="hover:underline">
                      {p.team}
                    </Link>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{millions(p.market)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>The coaching carousel</CardTitle>
          <CardDescription>
            {v.coaching.length === 0
              ? "No changes before the league began: every staff is as it was."
              : `${v.coaching.filter((c) => c.head && /fired/.test(c.text)).length} head coaches fired and ${v.coaching.filter((c) => c.head && /hired/.test(c.text)).length} hired, then the coordinators who followed. Each new game plays its own carousel.`}
          </CardDescription>
        </CardHeader>
        {v.coaching.length > 0 && (
          <CardContent>
            <ul className="flex flex-col gap-1 text-sm">
              {v.coaching.map((c, i) => (
                <li key={i} title={c.reason}>
                  {c.teamId ? (
                    <Link href={`/team/${c.teamId}`} className="hover:underline">
                      {c.text}
                    </Link>
                  ) : (
                    c.text
                  )}
                </li>
              ))}
            </ul>
            {v.openJobs.length > 0 && (
              <p className="mt-3 text-sm text-muted-foreground">
                Still searching: {v.openJobs.join(", ")}.{" "}
                <Link href="/coaching" className="underline">
                  Coaching page
                </Link>
              </p>
            )}
          </CardContent>
        )}
      </Card>

      {v.frontOffice.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Front offices</CardTitle>
            <CardDescription>General managers who changed before the first day.</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-col gap-1 text-sm">
              {v.frontOffice.map((c, i) => (
                <li key={i} title={c.reason}>
                  {c.text}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
