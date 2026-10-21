/**
 * A team's salary cap sheet: room for this League Year and the next three,
 * every contract's cap hit by year (with the offseason top-51 rule marked),
 * and the dead money left by players already gone.
 */
import { formatShort } from "@fgm/sim-core";
import { Link } from "wouter";
import { ErrorNote, Loading, OverallBadge } from "@/components/shared";
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
import { useLeagueKey } from "@/lib/session";
import { useSim } from "@/sim/client";

const money = (amount: number) => (amount === 0 ? "–" : formatShort(amount));

export function CapSheet({ teamId }: { teamId: string }) {
  const view = useSim("capSheetView", { teamId }, useLeagueKey(`cap:${teamId}`));
  if (view.error) return <ErrorNote message={view.error} />;
  if (!view.data) return <Loading />;
  const s = view.data;
  const now = s.years[0]!;

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Cap room</CardTitle>
          <CardDescription>
            {now.topContractsRule
              ? `Offseason: only the top ${s.topContracts} contracts count in full this year (the rest count only their bonus money). Later years show every contract signed so far.`
              : "Every contract counts in full during the season. Later years show every contract signed so far."}{" "}
            June 1 designations left: {s.juneFirstDesignationsLeft}.
          </CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>League Year</TableHead>
                <TableHead className="text-right">Cap</TableHead>
                <TableHead className="text-right">Carried over</TableHead>
                <TableHead className="text-right">Contracts</TableHead>
                <TableHead className="text-right">Dead money</TableHead>
                <TableHead className="text-right">Room</TableHead>
                <TableHead className="text-right">Players signed</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {s.years.map((y) => (
                <TableRow key={y.season}>
                  <TableCell className="font-medium">{y.season}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatShort(y.cap)}</TableCell>
                  <TableCell className="text-right tabular-nums">{money(y.carryover)}</TableCell>
                  <TableCell className="text-right tabular-nums">{money(y.contracts)}</TableCell>
                  <TableCell className="text-right tabular-nums">{money(y.deadMoney)}</TableCell>
                  <TableCell
                    className={`text-right font-medium tabular-nums ${y.room < 0 ? "text-destructive" : ""}`}
                  >
                    {formatShort(y.room)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{y.players}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Contracts</CardTitle>
          <CardDescription>
            Cap hit by League Year. Open a player for his full contract and the "what if" panel
            (release, June 1 release, trade, restructure).
          </CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Player</TableHead>
                <TableHead>Pos</TableHead>
                <TableHead className="text-right">Age</TableHead>
                <TableHead className="text-right">Ovr</TableHead>
                {s.years.map((y) => (
                  <TableHead key={y.season} className="text-right">
                    {y.season}
                  </TableHead>
                ))}
                <TableHead className="text-right">Dead if cut</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {s.players.map((p) => (
                <TableRow
                  key={p.id}
                  className={p.inTopContracts ? undefined : "text-muted-foreground"}
                >
                  <TableCell className="font-medium">
                    <Link href={`/player/${p.id}`} className="hover:underline">
                      {p.name}
                    </Link>
                    {!p.inTopContracts && (
                      <Badge variant="outline" className="ml-2">
                        outside top {s.topContracts}
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell>{p.position}</TableCell>
                  <TableCell className="text-right tabular-nums">{p.age}</TableCell>
                  <TableCell className="text-right">
                    <OverallBadge value={p.overall} />
                  </TableCell>
                  {p.capHits.map((hit, i) => (
                    <TableCell key={i} className="text-right tabular-nums">
                      {money(hit)}
                    </TableCell>
                  ))}
                  <TableCell className="text-right tabular-nums">{money(p.deadIfCut)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Dead money</CardTitle>
          <CardDescription>
            Cap charges for players no longer on the team: bonus money that sped up when they were
            released or traded, and guarantees still owed.
          </CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {s.deadMoney.length === 0 ? (
            <p className="text-sm text-muted-foreground">None.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>League Year</TableHead>
                  <TableHead>Player</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Why</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {s.deadMoney.map((d, i) => (
                  <TableRow key={i}>
                    <TableCell>{d.season}</TableCell>
                    <TableCell>{d.name ?? "Moves before the league began"}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatShort(d.amount)}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{d.reason}</TableCell>
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
