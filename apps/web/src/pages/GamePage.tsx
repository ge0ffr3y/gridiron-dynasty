import { Fragment } from "react";
import { Link, useLocation } from "wouter";
import { LiveTicker } from "@/components/LiveTicker";
import { PlayAndWatchButton } from "@/components/PlayAndWatch";
import { DriveChart, ScoringSummary, WinProbabilityChart } from "@/components/GameCharts";
import { StatTables } from "@/components/StatTables";
import { ErrorNote, Loading, TeamChip } from "@/components/shared";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { cn } from "@/lib/utils";
import { useSim } from "@/sim/client";
import { ROUND_LABELS } from "./SchedulePage";

/** A game's page. With `watch`, it first replays the game live, hiding the result until the end. */
export function GamePage({ gameId, watch = false }: { gameId: number; watch?: boolean }) {
  const view = useSim("gameView", { gameId }, useLeagueKey(String(gameId)));
  const [, navigate] = useLocation();
  if (view.error) return <ErrorNote message={view.error} />;
  if (!view.data) return <Loading />;
  const g = view.data;
  const played = g.homeScore !== null;
  const when =
    g.round === "regular"
      ? `Week ${g.week}`
      : g.round === "preseason"
        ? `Preseason week ${g.week}`
        : `${ROUND_LABELS[g.round]} round`;
  const quarterName = (q: number) => (q <= 4 ? `Quarter ${q}` : "Overtime");
  const header = (
    <div className="flex flex-col gap-0.5 text-sm text-muted-foreground">
      <h1 className="sr-only">
        {g.away.city} {g.away.nickname} at {g.home.city} {g.home.nickname}
      </h1>
      <div>
        {g.season} · {when} · {formatLeagueDate(g.date)} ·{" "}
        {g.neutral ? "Neutral site" : `at ${g.home.city}`}
      </div>
      {g.conditions && <div>{g.conditions}</div>}
    </div>
  );

  if (watch && played && g.plays)
    return (
      <div className="flex flex-col gap-4">
        {header}
        <LiveTicker game={g} plays={g.plays} onFinished={() => navigate(`/game/${g.id}`)} />
      </div>
    );

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-2">
        {header}
        {played && g.plays && (
          <Link
            href={`/game/${g.id}/watch`}
            className="text-sm font-medium text-primary hover:underline"
          >
            Watch it play by play
          </Link>
        )}
      </div>
      <Card>
        <CardContent className="grid grid-cols-[1fr_auto_1fr] items-center gap-4">
          {[g.away, g.home].map((team, i) => {
            const score = i === 0 ? g.awayScore : g.homeScore;
            const other = i === 0 ? g.homeScore : g.awayScore;
            const won = played && score! > other!;
            return (
              <Fragment key={team.id}>
                {i === 1 && (
                  <div className="text-center text-sm text-muted-foreground">
                    {played ? (g.overtime ? "Final (OT)" : "Final") : "vs"}
                  </div>
                )}
                <div
                  className={cn(
                    "flex items-center gap-3",
                    i === 1 && "flex-row-reverse text-right",
                  )}
                >
                  <TeamChip team={team} className="h-9 min-w-14 text-sm" />
                  <div className="min-w-0">
                    <Link
                      href={`/team/${team.id}`}
                      className="block truncate font-medium hover:underline"
                    >
                      {team.city} {team.nickname}
                    </Link>
                    <div
                      className={cn(
                        "text-3xl tabular-nums",
                        won ? "font-bold" : "text-muted-foreground",
                      )}
                    >
                      {score ?? "-"}
                    </div>
                  </div>
                </div>
              </Fragment>
            );
          })}
        </CardContent>
      </Card>

      {!played && (
        <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
          This game hasn't been played yet.
          {g.playable && <PlayAndWatchButton gameId={g.id} />}
        </div>
      )}
      {played && !g.periods && (
        <p className="text-sm text-muted-foreground">
          No box score was kept for this game (it was played in an older version of the game).
        </p>
      )}

      {g.periods && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card className="gap-2 py-3">
            <CardHeader className="px-4">
              <CardTitle className="text-sm">Scoring by quarter</CardTitle>
            </CardHeader>
            <CardContent className="px-2">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Team</TableHead>
                    {g.periods.labels.map((l) => (
                      <TableHead key={l} className="text-right">
                        {l}
                      </TableHead>
                    ))}
                    <TableHead className="text-right">T</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(
                    [
                      [g.away, g.periods.away, g.awayScore],
                      [g.home, g.periods.home, g.homeScore],
                    ] as const
                  ).map(([team, points, total]) => (
                    <TableRow key={team.id}>
                      <TableCell>{team.abbreviation}</TableCell>
                      {points.map((p, i) => (
                        <TableCell key={i} className="text-right tabular-nums">
                          {p}
                        </TableCell>
                      ))}
                      <TableCell className="text-right font-semibold tabular-nums">
                        {total}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
          <Card className="gap-2 py-3">
            <CardHeader className="px-4">
              <CardTitle className="text-sm">Team stats</CardTitle>
            </CardHeader>
            <CardContent className="px-2">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead />
                    <TableHead className="text-right">{g.away.abbreviation}</TableHead>
                    <TableHead className="text-right">{g.home.abbreviation}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {g.teamStats.map((r) => (
                    <TableRow key={r.label}>
                      <TableCell className="text-muted-foreground">{r.label}</TableCell>
                      <TableCell className="text-right tabular-nums">{r.away}</TableCell>
                      <TableCell className="text-right tabular-nums">{r.home}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>
      )}

      {g.periods && (
        <div className="grid gap-4 xl:grid-cols-2">
          {(
            [
              [g.away, g.players.away],
              [g.home, g.players.home],
            ] as const
          ).map(([team, rows]) => (
            <Card key={team.id} className="gap-3 py-4">
              <CardHeader className="px-4">
                <CardTitle className="flex items-center gap-2 text-sm">
                  <TeamChip team={team} /> {team.city} {team.nickname}
                </CardTitle>
              </CardHeader>
              <CardContent className="px-2">
                <StatTables
                  rows={rows.map((r) => ({
                    key: String(r.id),
                    label: r.name,
                    href: `/player/${r.id}`,
                    line: r.line,
                  }))}
                />
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {played && g.charts && g.plays && (
        <>
          <Card className="gap-2 py-3">
            <CardHeader className="px-4">
              <CardTitle className="text-sm">Win probability</CardTitle>
            </CardHeader>
            <CardContent className="px-4">
              <WinProbabilityChart
                charts={g.charts}
                plays={g.plays}
                home={g.home.abbreviation}
                away={g.away.abbreviation}
              />
            </CardContent>
          </Card>
          <Card className="gap-2 py-3">
            <CardHeader className="px-4">
              <CardTitle className="text-sm">Scoring summary</CardTitle>
            </CardHeader>
            <CardContent className="px-4">
              <ScoringSummary
                plays={g.plays}
                home={g.home.abbreviation}
                away={g.away.abbreviation}
              />
            </CardContent>
          </Card>
          <Card className="gap-2 py-3">
            <CardHeader className="px-4">
              <CardTitle className="text-sm">Drives</CardTitle>
            </CardHeader>
            <CardContent className="px-2">
              <DriveChart charts={g.charts} home={g.home.abbreviation} away={g.away.abbreviation} />
            </CardContent>
          </Card>
        </>
      )}

      {played && (
        <Card className="gap-2 py-3">
          <CardHeader className="px-4">
            <CardTitle className="text-sm">Play-by-play</CardTitle>
          </CardHeader>
          <CardContent className="px-2">
            {!g.plays ? (
              <p className="px-2 text-sm text-muted-foreground">
                The play-by-play wasn't kept for this game (it's only kept for this season and last
                season, and not in imported leagues).
              </p>
            ) : (
              <div className="flex flex-col">
                {g.plays.map((p, i) => {
                  const newQuarter = i === 0 || g.plays![i - 1]!.quarter !== p.quarter;
                  const team = p.offense === "home" ? g.home : g.away;
                  return (
                    <Fragment key={i}>
                      {newQuarter && (
                        <div className="mt-3 mb-1 px-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                          {quarterName(p.quarter)}
                        </div>
                      )}
                      <div
                        className={cn(
                          "grid grid-cols-[3rem_2.5rem_1fr] gap-2 rounded px-2 py-1 text-sm sm:grid-cols-[3rem_2.5rem_10rem_1fr]",
                          p.scoring && "bg-primary/10 font-medium",
                        )}
                      >
                        <span className="tabular-nums text-muted-foreground">{p.clock}</span>
                        <span
                          className="text-xs leading-5 font-semibold"
                          style={{ color: "var(--muted-foreground)" }}
                        >
                          {team.abbreviation}
                        </span>
                        <span className="hidden text-muted-foreground sm:block">{p.situation}</span>
                        <span>
                          <span className="sm:hidden text-muted-foreground">
                            {p.situation ? `${p.situation}: ` : ""}
                          </span>
                          {p.text}
                          {p.scoring && (
                            <span className="ml-2 tabular-nums text-muted-foreground">
                              ({g.away.abbreviation} {p.score[1]}, {g.home.abbreviation}{" "}
                              {p.score[0]})
                            </span>
                          )}
                          {p.scheme && (
                            <span className="block text-xs text-muted-foreground">{p.scheme}</span>
                          )}
                          {p.note && (
                            <span className="block text-xs text-muted-foreground">{p.note}</span>
                          )}
                        </span>
                      </div>
                    </Fragment>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
