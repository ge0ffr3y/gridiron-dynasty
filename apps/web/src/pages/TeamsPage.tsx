import { Link } from "wouter";
import { ErrorNote, Loading, OverallBadge, PageHeader, TeamChip } from "@/components/shared";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useSession } from "@/lib/session";
import { useSim } from "@/sim/client";

export function TeamsPage() {
  const { league } = useSession();
  const summary = useSim("leagueSummary", {}, league?.id ?? "");
  if (summary.error) return <ErrorNote message={summary.error} />;
  if (!summary.data) return <Loading />;

  const teams = summary.data.conferences
    .flatMap((c) => c.divisions.flatMap((d) => d.teams))
    .sort((a, b) => b.starterOverall - a.starterOverall || a.id.localeCompare(b.id));

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Teams" subtitle="Ranked by the average overall of each team's starters." />
      <Card className="py-2">
        <CardContent className="px-2">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10 text-right">#</TableHead>
                <TableHead>Team</TableHead>
                <TableHead>Division</TableHead>
                <TableHead className="text-right">Starters</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {teams.map((team, i) => (
                <TableRow key={team.id}>
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    {i + 1}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <TeamChip team={team} />
                      <Link href={`/team/${team.id}`} className="font-medium hover:underline">
                        {team.city} {team.nickname}
                      </Link>
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{team.division}</TableCell>
                  <TableCell className="text-right">
                    <span className="mr-2 tabular-nums text-muted-foreground">
                      {team.starterOverall.toFixed(1)}
                    </span>
                    <OverallBadge value={Math.round(team.starterOverall)} />
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
