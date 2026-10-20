import { Link } from "wouter";
import { ErrorNote, Loading, PageHeader, TeamChip } from "@/components/shared";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useLeagueKey } from "@/lib/session";
import { useSim } from "@/sim/client";

export function HistoryPage() {
  const view = useSim("historyView", {}, useLeagueKey());
  if (view.error) return <ErrorNote message={view.error} />;
  if (!view.data) return <Loading />;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="League history"
        subtitle="Every champion so far. Awards and records arrive in a later phase."
      />
      <Card className="py-2">
        <CardContent className="px-2">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Season</TableHead>
                <TableHead>Champion</TableHead>
                <TableHead className="text-right">Score</TableHead>
                <TableHead>Runner-up</TableHead>
                <TableHead className="hidden sm:table-cell">Best record</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {view.data.seasons.map((s) => (
                <TableRow key={s.season}>
                  <TableCell className="tabular-nums">{s.season}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <TeamChip team={s.champion} />
                      <Link href={`/team/${s.champion.id}`} className="font-medium hover:underline">
                        {s.champion.city} {s.champion.nickname}
                      </Link>
                    </div>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {s.score}
                    {s.overtime && " (OT)"}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <TeamChip team={s.runnerUp} />
                      <span className="hidden md:inline">
                        {s.runnerUp.city} {s.runnerUp.nickname}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className="hidden sm:table-cell">
                    <div className="flex items-center gap-2">
                      <TeamChip team={s.bestRecord.team} />
                      <span className="tabular-nums">{s.bestRecord.record}</span>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
