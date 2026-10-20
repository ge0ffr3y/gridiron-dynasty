import { useState } from "react";
import { Link } from "wouter";
import { RosterTable } from "@/components/RosterTable";
import {
  ErrorNote,
  Facts,
  Loading,
  OverallBadge,
  PageHeader,
  readableTextOn,
} from "@/components/shared";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ordinal } from "@/lib/format";
import { useLeagueKey } from "@/lib/session";
import { useSim } from "@/sim/client";

type Tab = "roster" | "staff" | "picks";

export function TeamPage({ teamId }: { teamId: string }) {
  const view = useSim("teamView", { teamId }, useLeagueKey(String(teamId)));
  const [tab, setTab] = useState<Tab>("roster");
  if (view.error) return <ErrorNote message={view.error} />;
  if (!view.data) return <Loading />;
  const { team, roster, staff, picks, starterOverall } = view.data;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-4">
        <div
          className="flex size-14 shrink-0 items-center justify-center rounded-lg text-lg font-bold"
          style={{
            backgroundColor: team.colors.primary,
            color: readableTextOn(team.colors.primary),
          }}
        >
          {team.abbreviation}
        </div>
        <PageHeader title={`${team.city} ${team.nickname}`} subtitle={team.division} />
      </div>

      <Card>
        <CardContent>
          <Facts
            items={[
              ["Starters' average", <OverallBadge value={Math.round(starterOverall)} />],
              ["Roster", `${roster.length} players`],
              ["Run by", team.controller === "ai" ? "AI front office" : "You"],
            ]}
          />
        </CardContent>
      </Card>

      <div className="flex gap-1 border-b">
        {(
          [
            ["roster", "Roster"],
            ["staff", "Staff"],
            ["picks", "Draft picks"],
          ] as [Tab, string][]
        ).map(([id, label]) => (
          <Button
            key={id}
            variant="ghost"
            size="sm"
            onClick={() => setTab(id)}
            className={
              tab === id
                ? "rounded-b-none border-b-2 border-primary"
                : "rounded-b-none text-muted-foreground"
            }
          >
            {label}
          </Button>
        ))}
      </div>

      {tab === "roster" && <RosterTable rows={roster} />}

      {tab === "staff" && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Role</TableHead>
              <TableHead>Name</TableHead>
              <TableHead className="text-right">Age</TableHead>
              <TableHead className="text-right">Years coaching</TableHead>
              <TableHead>Scheme</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {staff.map((c) => (
              <TableRow key={c.id}>
                <TableCell className="text-muted-foreground">
                  {c.role === "SCOUT" ? "Scout" : c.role}
                </TableCell>
                <TableCell>
                  <Link href={`/coach/${c.id}`} className="font-medium hover:underline">
                    {c.name}
                  </Link>
                </TableCell>
                <TableCell className="text-right tabular-nums">{c.age}</TableCell>
                <TableCell className="text-right tabular-nums">{c.experience}</TableCell>
                <TableCell>{c.scheme ?? "—"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {tab === "picks" && (
        <div className="grid gap-3 sm:grid-cols-3">
          {[...new Set(picks.map((p) => p.season))].map((season) => (
            <Card key={season} className="gap-2 py-4">
              <CardContent className="px-4">
                <div className="mb-2 font-medium">{season} draft</div>
                <ul className="flex flex-col gap-1 text-sm">
                  {picks
                    .filter((p) => p.season === season)
                    .map((p) => (
                      <li key={p.id}>
                        {ordinal(p.round)} round
                        {p.overall !== null && (
                          <span className="text-muted-foreground"> · pick #{p.overall}</span>
                        )}
                        {p.from !== team.id && (
                          <span className="text-muted-foreground"> (from {p.from})</span>
                        )}
                      </li>
                    ))}
                </ul>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
