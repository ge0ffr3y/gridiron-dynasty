/**
 * A player's contract, year by year, and the "what if" panel: what a release
 * (before or after June 1), a trade or a restructure would do to his team's cap
 * room this year and next. Until GM Mode the league office can make the moves
 * for any team; each records its reason in the transaction log.
 */
import { formatShort, type CapMoveKind, type CapMovePreview } from "@fgm/sim-core";
import { useState } from "react";
import { Link } from "wouter";
import { ErrorNote, Facts, Loading } from "@/components/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { useLeagueKey, useSession } from "@/lib/session";
import { call, useSim } from "@/sim/client";

const TYPE_NAMES: Record<string, string> = {
  rookie: "Rookie contract",
  veteran: "Veteran contract",
  extension: "Extension",
  tag: "Franchise or transition tag",
  tender: "Restricted free agent tender",
  minimum: "Minimum deal",
  "practice-squad": "Practice-squad deal (weekly pay)",
};

/** Money, with a dash for nothing. */
const money = (amount: number) => (amount === 0 ? "–" : formatShort(amount));

/** A change in room: "+$4.2M" in the primary color, a loss in the destructive color. */
export function RoomChange({ before, after }: { before: number; after: number }) {
  const change = after - before;
  return (
    <span className="tabular-nums">
      {formatShort(after)}{" "}
      <span
        className={
          change > 0 ? "text-primary" : change < 0 ? "text-destructive" : "text-muted-foreground"
        }
      >
        ({change > 0 ? "+" : ""}
        {change === 0 ? "no change" : formatShort(change)})
      </span>
    </span>
  );
}

export function ContractPanel({ playerId }: { playerId: number }) {
  const view = useSim("contractView", { id: playerId }, useLeagueKey(`contract:${playerId}`));
  const { bump } = useSession();
  const [confirming, setConfirming] = useState<CapMoveKind | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string>();
  const [error, setError] = useState<string>();
  if (view.error) return <ErrorNote message={view.error} />;
  if (!view.data) return <Loading />;
  const c = view.data;

  const make = async (move: CapMovePreview) => {
    setBusy(true);
    setError(undefined);
    try {
      const { message } = await call("capMove", { playerId, kind: move.kind });
      setDone(message);
      setConfirming(null);
      bump();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Contract</CardTitle>
          <CardDescription>
            Every League Year of his deal. Cap hit is what counts against the cap; cash is what he's
            paid that year; dead money is what would stay on the cap if he were released before June
            1 that year.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {done && (
            <p className="rounded-md border border-primary/40 bg-accent p-3 text-sm">{done}</p>
          )}
          {c.type === "none" ? (
            <p className="text-sm text-muted-foreground">
              No contract{c.team ? "" : ": he's a free agent"}.
            </p>
          ) : (
            <>
              <Facts
                items={[
                  [
                    "Team",
                    c.team ? (
                      <Link href={`/team/${c.team.id}`} className="hover:underline">
                        {c.team.name}
                      </Link>
                    ) : (
                      "None"
                    ),
                  ],
                  ["Type", TYPE_NAMES[c.type] ?? c.type],
                  ["Signed", formatLeagueDate(c.signedOn)],
                  [
                    "Value",
                    `${formatShort(c.totalValue)} (${formatShort(c.averagePerYear)} a year)`,
                  ],
                  ["Guaranteed at signing", formatShort(c.guaranteedAtSigning)],
                  [
                    "Runs through",
                    `${c.lastSeason}${c.voidYears ? ` (then ${c.voidYears} void year${c.voidYears === 1 ? "" : "s"} that only carry bonus money)` : ""}`,
                  ],
                  ...(c.fifthYearOption
                    ? ([
                        [
                          "Fifth-year option",
                          `${c.fifthYearOption.season}: ${c.fifthYearOption.exercised === null ? "not decided yet" : c.fifthYearOption.exercised ? "exercised" : "declined"}`,
                        ],
                      ] as [string, string][])
                    : []),
                  ...(c.veteranSalaryBenefit
                    ? ([
                        [
                          "Veteran salary benefit",
                          "His minimum salary counts on the cap as a two-year player's.",
                        ],
                      ] as [string, string][])
                    : []),
                ]}
              />
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Season</TableHead>
                      <TableHead className="text-right">Salary</TableHead>
                      <TableHead className="text-right">Bonus proration</TableHead>
                      <TableHead className="text-right">Roster & workout</TableHead>
                      <TableHead className="text-right">Incentives</TableHead>
                      <TableHead className="text-right">Guaranteed</TableHead>
                      <TableHead className="text-right">Cap hit</TableHead>
                      <TableHead className="text-right">Cash</TableHead>
                      <TableHead className="text-right">Dead if cut</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {c.rows.map((r) => (
                      <TableRow
                        key={r.season}
                        className={
                          r.current ? "bg-accent/60" : r.void ? "text-muted-foreground" : undefined
                        }
                      >
                        <TableCell className="font-medium">
                          {r.season}
                          {r.void && (
                            <Badge variant="outline" className="ml-2">
                              void
                            </Badge>
                          )}
                          {r.current && (
                            <Badge variant="secondary" className="ml-2">
                              now
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{money(r.base)}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {money(r.proration)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {money(r.rosterBonus + r.workoutBonus + r.perGameBonus)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {money(r.likelyIncentives)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {money(r.guaranteed)}
                        </TableCell>
                        <TableCell className="text-right font-medium tabular-nums">
                          {money(r.capHit)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{money(r.cash)}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {r.season >= c.season ? money(r.deadIfCut) : ""}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {c.moves.length > 0 && c.team && (
        <Card>
          <CardHeader>
            <CardTitle>What if</CardTitle>
            <CardDescription>
              What each move would do to the cap room of the {c.team.name}, as of{" "}
              {formatLeagueDate(c.date)}. In Simulation Mode the league office can make these moves
              for any team (in GM Mode, only your own); each is recorded with its reason.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {error && <ErrorNote message={error} />}
            {c.moves.map((m) => (
              <div
                key={m.kind}
                className="flex flex-col gap-3 rounded-lg border p-3 md:flex-row md:items-start md:justify-between"
              >
                <div className="flex min-w-0 flex-col gap-1">
                  <div className="font-medium">{m.label}</div>
                  <p className="text-sm text-muted-foreground">{m.note}</p>
                  <div className="mt-1 grid grid-cols-1 gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
                    {m.kind !== "restructure" && (
                      <>
                        <div>
                          <span className="text-muted-foreground">Dead money: </span>
                          <span className="tabular-nums">
                            {formatShort(m.deadThisYear)} in {c.season}
                            {m.deadNextYear > 0 &&
                              `, ${formatShort(m.deadNextYear)} in ${c.season + 1}`}
                          </span>
                        </div>
                        <div />
                      </>
                    )}
                    <div>
                      <span className="text-muted-foreground">Room {c.season}: </span>
                      <RoomChange {...m.roomNow} />
                    </div>
                    <div>
                      <span className="text-muted-foreground">Room {c.season + 1}: </span>
                      <RoomChange {...m.roomNext} />
                    </div>
                  </div>
                </div>
                <div className="flex shrink-0 gap-2">
                  {confirming === m.kind ? (
                    <>
                      <Button size="sm" disabled={busy} onClick={() => make(m)}>
                        Confirm
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy}
                        onClick={() => setConfirming(null)}
                      >
                        Cancel
                      </Button>
                    </>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={!m.available || busy}
                      onClick={() => setConfirming(m.kind)}
                    >
                      {m.kind === "restructure"
                        ? "Restructure"
                        : m.kind === "trade"
                          ? "Trade"
                          : "Release"}
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </>
  );
}
