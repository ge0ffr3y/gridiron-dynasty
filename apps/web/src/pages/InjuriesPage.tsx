/**
 * The injury report (Phase 9b): each team's players listed Out, Doubtful or
 * Questionable for its next game, with the body part, and how many sit on
 * reserve lists (as in the real report, players on injured reserve aren't
 * listed). Questionable players marked "plays" are playing through a knock.
 */
import type { InjuryReportView } from "@fgm/sim-core";
import { useState } from "react";
import { Link } from "wouter";
import { ErrorNote, Loading, PageHeader } from "@/components/shared";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select } from "@/components/ui/input";
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

type Entry = InjuryReportView["teams"][number]["entries"][number];

/** The status as the report shows it; "Out" carries the warning color, the rest plain text. */
export function StatusTag({ entry }: { entry: Pick<Entry, "status" | "playingThrough"> }) {
  if (entry.status === "Out")
    return (
      <span className="inline-flex items-center rounded border border-destructive/40 px-1.5 text-[11px] font-medium text-destructive">
        Out
      </span>
    );
  return (
    <span className="inline-flex items-center rounded border px-1.5 text-[11px] font-medium">
      {entry.status}
      {entry.playingThrough && <span className="ml-1 text-muted-foreground">· plays</span>}
    </span>
  );
}

function outFor(e: Entry): string {
  if (e.playingThrough) return "expected to play";
  return `${e.gamesRemaining} more game${e.gamesRemaining === 1 ? "" : "s"}`;
}

export function InjuriesPage() {
  const [teamId, setTeamId] = useState("");
  const all = useSim("injuryReportView", {}, useLeagueKey("injuries"));
  const view = useSim(
    "injuryReportView",
    teamId ? { teamId } : {},
    useLeagueKey(`injuries:${teamId}`),
  );
  if (all.error) return <ErrorNote message={all.error} />;
  if (view.error) return <ErrorNote message={view.error} />;
  if (!all.data || !view.data) return <Loading />;
  const r = view.data;
  const rows = r.teams.flatMap((t) => t.entries.map((e) => ({ team: t.teamId, e })));
  const reserve = r.teams.reduce(
    (a, t) => ({
      ir: a.ir + t.reserve.injuredReserve,
      pup: a.pup + t.reserve.pup,
      nfi: a.nfi + t.reserve.nfi,
    }),
    { ir: 0, pup: 0, nfi: 0 },
  );
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={`Injury report: ${r.forWhat}`}
        subtitle="Who each team lists for its next game. Players on injured reserve or the PUP and NFI lists aren't on the report, as in the real one; they're counted below."
      />
      <div className="flex flex-wrap items-center gap-3">
        <Select
          value={teamId}
          onChange={(e) => setTeamId(e.target.value)}
          aria-label="Team"
          className="w-64"
        >
          <option value="">All teams</option>
          {all.data.teams.map((t) => (
            <option key={t.teamId} value={t.teamId}>
              {t.name}
            </option>
          ))}
        </Select>
        <p className="text-sm text-muted-foreground">
          {r.totals.out} out, {r.totals.doubtful} doubtful, {r.totals.questionable} questionable;{" "}
          {reserve.ir} on injured reserve, {reserve.pup} on PUP, {reserve.nfi} on NFI.
        </p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Listed players ({rows.length})</CardTitle>
          <CardDescription>
            Out and Doubtful players almost never play; Questionable ones play about two times in
            three. Those marked "plays" are playing through a knock, a step slower than usual.
          </CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nobody is listed.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  {!teamId && <TableHead>Team</TableHead>}
                  <TableHead>Player</TableHead>
                  <TableHead>Pos</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Injury</TableHead>
                  <TableHead>Out for</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map(({ team, e }) => (
                  <TableRow key={e.id}>
                    {!teamId && (
                      <TableCell>
                        <Link href={`/team/${team}`} className="hover:underline">
                          {team}
                        </Link>
                      </TableCell>
                    )}
                    <TableCell className="font-medium">
                      <Link href={`/player/${e.id}`} className="hover:underline">
                        {e.name}
                      </Link>
                    </TableCell>
                    <TableCell>{e.position}</TableCell>
                    <TableCell>
                      <StatusTag entry={e} />
                    </TableCell>
                    <TableCell className="text-muted-foreground">{e.description}</TableCell>
                    <TableCell className="tabular-nums">{outFor(e)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
