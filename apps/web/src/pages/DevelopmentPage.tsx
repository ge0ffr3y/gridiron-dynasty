/**
 * The development report (Phase 9b): this season's biggest risers and
 * fallers at the new League Year, in training camp, and over the season, each
 * with the reason (age, work habits, playing time, a breakout or a bust).
 */
import type { DevelopmentReportView } from "@fgm/sim-core";
import { Link } from "wouter";
import { ErrorNote, Loading, PageHeader } from "@/components/shared";
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

type Entry = DevelopmentReportView["rounds"][number]["risers"][number];

function Changes({ title, entries }: { title: string; entries: Entry[] }) {
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <h3 className="text-sm font-medium">{title}</h3>
      {entries.length === 0 ? (
        <p className="text-sm text-muted-foreground">None.</p>
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Player</TableHead>
                <TableHead>Team</TableHead>
                <TableHead className="text-right">Change</TableHead>
                <TableHead>Why</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {entries.map((e) => (
                <TableRow key={e.id}>
                  <TableCell className="font-medium whitespace-nowrap">
                    <Link href={`/player/${e.id}`} className="hover:underline">
                      {e.name}
                    </Link>{" "}
                    <span className="text-xs text-muted-foreground">{e.position}</span>
                  </TableCell>
                  <TableCell>{e.team ?? "FA"}</TableCell>
                  <TableCell className="text-right whitespace-nowrap tabular-nums">
                    {e.change > 0 ? "+" : ""}
                    {e.change}{" "}
                    <span className="text-xs text-muted-foreground">
                      ({e.before}→{e.after})
                    </span>
                  </TableCell>
                  <TableCell className="min-w-64 text-muted-foreground">{e.reason}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

export function DevelopmentPage() {
  const view = useSim("developmentReportView", {}, useLeagueKey("development"));
  if (view.error) return <ErrorNote message={view.error} />;
  if (!view.data) return <Loading />;
  const d = view.data;
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={`${d.season} player development`}
        subtitle="Young players grow toward their potential, faster with good work habits and real snaps; veterans decline on their position's real age curve, speed first after 30. Most of a year's change comes at the new League Year in March, the rest in training camp."
      />
      {d.rounds.length === 0 && (
        <p className="text-sm text-muted-foreground">
          Nothing yet this season: players develop when the new League Year opens in March.
        </p>
      )}
      {d.rounds.map((r) => (
        <Card key={r.stage}>
          <CardHeader>
            <CardTitle>{r.label}</CardTitle>
            <CardDescription>
              {r.stage === "season"
                ? `Through ${formatLeagueDate(r.date)}.`
                : `${formatLeagueDate(r.date)}. Changes of 3 points or more.`}
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-6 xl:grid-cols-2">
            <Changes title="Biggest risers" entries={r.risers} />
            <Changes title="Biggest fallers" entries={r.fallers} />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
