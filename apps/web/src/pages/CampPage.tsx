/** This year's camp: preseason standouts, who improved, and the waiver claims at final cuts. */
import { Link } from "wouter";
import { ErrorNote, Loading, PageHeader } from "@/components/shared";
import { Badge } from "@/components/ui/badge";
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

export function CampPage() {
  const view = useSim("campReportView", {}, useLeagueKey("camp"));
  if (view.error) return <ErrorNote message={view.error} />;
  if (!view.data) return <Loading />;
  const c = view.data;
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={`${c.season} training camp`}
        subtitle="Preseason games are a showcase for players fighting for a roster spot: starters rest, and each player's grade compares his production per snap with others at his position (50 is typical)."
      />
      {!c.graded ? (
        <p className="text-sm text-muted-foreground">
          No preseason grades yet: they're set after the last preseason week.
        </p>
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Standouts</CardTitle>
              <CardDescription>
                The best preseason grades. A strong grade adds to camp development for players with
                room to grow, can win a bubble player a spot at final cuts, and settles close
                position battles.
              </CardDescription>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Player</TableHead>
                    <TableHead>Pos</TableHead>
                    <TableHead>Team</TableHead>
                    <TableHead className="text-right">Grade</TableHead>
                    <TableHead>After camp</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {c.standouts.map((s) => (
                    <TableRow key={s.id}>
                      <TableCell className="font-medium">
                        <Link href={`/player/${s.id}`} className="hover:underline">
                          {s.name}
                        </Link>
                        {s.improved && (
                          <Badge variant="secondary" className="ml-2">
                            improved
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell>{s.position}</TableCell>
                      <TableCell>{s.team}</TableCell>
                      <TableCell className="text-right tabular-nums">{s.grade}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {s.madeTeam === null
                          ? "Cuts still to come"
                          : s.madeTeam
                            ? "Made the 53"
                            : "Practice squad, reserve or cut"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
          {c.improved.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Biggest gains in camp ({c.improved.length})</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-1.5 text-sm">
                {c.improved.map((i) => (
                  <div key={i.id}>
                    <Link href={`/player/${i.id}`} className="font-medium hover:underline">
                      {i.name}
                    </Link>{" "}
                    <span className="text-muted-foreground">
                      ({i.team}) {i.reason}
                    </span>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </>
      )}
      <Card>
        <CardHeader>
          <CardTitle>Waiver claims at final cuts ({c.claims.length})</CardTitle>
          <CardDescription>
            Cut players with fewer than four seasons went on waivers; teams claimed in order, worst
            record first.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-1.5 text-sm">
          {c.claims.length === 0 ? (
            <p className="text-muted-foreground">None yet.</p>
          ) : (
            c.claims.map((x, i) => (
              <div key={i}>
                <span className="text-xs tabular-nums text-muted-foreground">
                  {formatLeagueDate(x.date)}
                </span>{" "}
                {x.text}
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
