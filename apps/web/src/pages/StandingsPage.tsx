import type { StandingRow } from "@fgm/sim-core";
import { Fragment, useState } from "react";
import { Link } from "wouter";
import { ErrorNote, Loading, PageHeader, TeamChip } from "@/components/shared";
import { TabPanel, Tabs, type TabItem } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useLeagueKey } from "@/lib/session";
import { cn } from "@/lib/utils";
import { useSim } from "@/sim/client";

type View = "division" | "conference" | "league";

const STANDINGS_TABS: TabItem<View>[] = [
  { id: "division", label: "Division" },
  { id: "conference", label: "Conference" },
  { id: "league", label: "League" },
];

const COLUMNS: [string, (r: StandingRow) => string | number, string?][] = [
  ["W", (r) => r.wins],
  ["L", (r) => r.losses],
  ["T", (r) => r.ties],
  ["Pct", (r) => r.pct],
  ["PF", (r) => r.pointsFor],
  ["PA", (r) => r.pointsAgainst],
  ["Net", (r) => (r.net > 0 ? `+${r.net}` : r.net)],
  ["Home", (r) => r.home, "hidden md:table-cell"],
  ["Away", (r) => r.away, "hidden md:table-cell"],
  ["Div", (r) => r.division, "hidden sm:table-cell"],
  ["Conf", (r) => r.conference, "hidden sm:table-cell"],
  ["Strk", (r) => r.streak, "hidden lg:table-cell"],
];

function StandingsTable({
  rows,
  seedLine,
  showSeed,
}: {
  rows: StandingRow[];
  seedLine?: number;
  showSeed?: boolean;
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          {showSeed && <TableHead className="w-8 text-right">#</TableHead>}
          <TableHead>Team</TableHead>
          {COLUMNS.map(([label, , cls]) => (
            <TableHead key={label} className={cn("text-right", cls)}>
              {label}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r, i) => (
          <TableRow
            key={r.team.id}
            className={cn(
              seedLine !== undefined && i === seedLine - 1 && "border-b-2 border-b-primary/60",
            )}
          >
            {showSeed && (
              <TableCell className="text-right tabular-nums text-muted-foreground">
                {i + 1}
              </TableCell>
            )}
            <TableCell>
              <div className="flex items-center gap-2">
                <TeamChip team={r.team} />
                <Link href={`/team/${r.team.id}`} className="hover:underline">
                  {r.team.city} {r.team.nickname}
                </Link>
                {r.seed !== null && r.divisionRank === 1 && (
                  <span className="text-xs text-muted-foreground">division leader</span>
                )}
              </div>
            </TableCell>
            {COLUMNS.map(([label, get, cls]) => (
              <TableCell key={label} className={cn("text-right tabular-nums", cls)}>
                {get(r)}
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export function StandingsPage() {
  const [view, setView] = useState<View>("division");
  const standings = useSim("standingsView", {}, useLeagueKey());
  if (standings.error) return <ErrorNote message={standings.error} />;
  if (!standings.data) return <Loading />;
  const s = standings.data;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={`${s.season} standings`} subtitle={s.asOf} />
      <Tabs
        tabs={STANDINGS_TABS}
        value={view}
        onChange={setView}
        label="Standings views"
        idPrefix="standings"
      />
      <TabPanel idPrefix="standings" id={view} className="flex flex-col gap-6">
        {view === "division" && (
          <div className="grid gap-4 xl:grid-cols-2">
            {s.divisions.map((d) => (
              <Card key={`${d.conference}-${d.division}`} className="gap-2 py-3">
                <CardHeader className="px-4">
                  <CardTitle className="text-sm">
                    {d.conference} {d.division}
                  </CardTitle>
                </CardHeader>
                <CardContent className="px-2">
                  <StandingsTable rows={d.rows} />
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {view === "conference" &&
          s.conferences.map((c) => (
            <Card key={c.id} className="gap-2 py-3">
              <CardHeader className="px-4">
                <CardTitle className="text-sm">{c.name}</CardTitle>
                <p className="text-xs text-muted-foreground">
                  The line marks the playoff cut: four division leaders, then three wild cards.
                </p>
              </CardHeader>
              <CardContent className="px-2">
                <StandingsTable rows={c.rows} seedLine={c.playoffTeams} showSeed />
              </CardContent>
            </Card>
          ))}

        {view === "league" && (
          <Card className="py-2">
            <CardContent className="px-2">
              <StandingsTable rows={s.league} showSeed />
            </CardContent>
          </Card>
        )}

        {s.notes.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">How ties were broken</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="flex flex-col gap-1 text-sm text-muted-foreground">
                {s.notes.map((n, i) => (
                  <Fragment key={i}>
                    <li>{n}</li>
                  </Fragment>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}
      </TabPanel>
    </div>
  );
}
