import { Fragment, useState } from "react";
import { Link } from "wouter";
import type { TeamView } from "@fgm/sim-core";
import { CapSheet } from "@/components/CapSheet";
import { RosterManager } from "@/components/RosterManager";
import { TransactionsPage } from "@/pages/TransactionsPage";
import { DepthChartEditor } from "@/components/DepthChartEditor";
import { RosterTable } from "@/components/RosterTable";
import { LockerRoom } from "@/components/Morale";
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

type Tab = "roster" | "manage" | "depth" | "cap" | "moves" | "stats" | "staff" | "picks" | "locker";

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
            ["manage", "Manage roster"],
            ["depth", "Depth chart"],
            ["cap", "Salary cap"],
            ["moves", "Transactions"],
            ["staff", "Staff"],
            ["locker", "Locker room"],
            ["picks", "Draft picks"],
            ["stats", "Stats"],
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

      {tab === "depth" && <DepthChartEditor teamId={teamId} />}

      {tab === "locker" && <LockerRoom teamId={teamId} />}

      {tab === "cap" && <CapSheet teamId={teamId} />}

      {tab === "manage" && <RosterManager teamId={teamId} />}

      {tab === "moves" && <TransactionsPage teamId={teamId} />}

      {tab === "stats" && (
        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <CardContent>
              <div className="mb-3 font-medium">{view.data.season.year} season so far</div>
              {view.data.season.games === 0 ? (
                <p className="text-sm text-muted-foreground">No games played yet this season.</p>
              ) : (
                <Facts
                  items={[
                    ["Games", view.data.season.games],
                    [
                      "Points for",
                      `${view.data.season.pointsFor} (${(view.data.season.pointsFor / view.data.season.games).toFixed(1)} a game)`,
                    ],
                    [
                      "Points against",
                      `${view.data.season.pointsAgainst} (${(view.data.season.pointsAgainst / view.data.season.games).toFixed(1)} a game)`,
                    ],
                    [
                      "Yards for",
                      `${(view.data.season.yardsFor / view.data.season.games).toFixed(1)} a game`,
                    ],
                    [
                      "Yards against",
                      `${(view.data.season.yardsAgainst / view.data.season.games).toFixed(1)} a game`,
                    ],
                    [
                      "Passing / rushing",
                      `${view.data.season.passYards} / ${view.data.season.rushYards}`,
                    ],
                    ["Turnovers", view.data.season.turnovers],
                    ["Takeaways", view.data.season.takeaways],
                    ...advancedFacts(view.data.season.advanced),
                  ]}
                />
              )}
            </CardContent>
          </Card>
          <Card>
            <CardContent>
              <div className="mb-3 font-medium">Team leaders</div>
              <dl className="grid grid-cols-[auto_1fr_auto] gap-x-4 gap-y-2 text-sm">
                {view.data.season.leaders.map((l) => (
                  <Fragment key={l.label}>
                    <dt className="text-muted-foreground">{l.label}</dt>
                    <dd>
                      {l.player ? (
                        <Link href={`/player/${l.player.id}`} className="hover:underline">
                          {l.player.name}
                        </Link>
                      ) : (
                        "-"
                      )}
                    </dd>
                    <dd className="text-right tabular-nums">{l.player ? l.value : ""}</dd>
                  </Fragment>
                ))}
              </dl>
            </CardContent>
          </Card>
        </div>
      )}

      {tab === "staff" && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Job</TableHead>
              <TableHead>Name</TableHead>
              <TableHead className="text-right">Age</TableHead>
              <TableHead className="text-right">Main skill</TableHead>
              <TableHead>Scheme</TableHead>
              <TableHead>Style, or what he does</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {staff.map((c) => (
              <TableRow key={c.id}>
                <TableCell className="text-muted-foreground">{c.roleName}</TableCell>
                <TableCell>
                  <Link href={`/coach/${c.id}`} className="font-medium hover:underline">
                    {c.name}
                  </Link>
                </TableCell>
                <TableCell className="text-right tabular-nums">{c.age}</TableCell>
                <TableCell className="text-right tabular-nums" title={c.mainSkill.label}>
                  {c.mainSkill.value}
                </TableCell>
                <TableCell>{c.scheme ?? "—"}</TableCell>
                <TableCell className="text-muted-foreground">{c.summary}</TableCell>
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

const signed = (v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(2)}`;
const percent = (v: number) => `${Math.round(v * 100)}%`;

/** EPA, success rate and pressure (shown once games with advanced stats have been played). */
function advancedFacts(a: TeamView["season"]["advanced"]): [string, string][] {
  if (!a) return [];
  return [
    ["Offense EPA per play", signed(a.offenseEpaPerPlay)],
    ["Offense success rate", percent(a.offenseSuccessRate)],
    ["Defense EPA per play allowed", signed(a.defenseEpaPerPlay)],
    ["Defense success rate allowed", percent(a.defenseSuccessRate)],
    [
      "Pressure rate allowed / forced",
      `${percent(a.pressureRateAllowed)} / ${percent(a.pressureRateForced)}`,
    ],
  ];
}
