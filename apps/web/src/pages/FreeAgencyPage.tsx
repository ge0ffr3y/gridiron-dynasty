/**
 * The free-agent market (Phase 12): who's available with his market value and
 * ask, which teams are bidding, recent signings with reasons, tags and tenders,
 * and offer sheets waiting to be matched.
 */
import { Link } from "wouter";
import { ErrorNote, Loading, OverallBadge, PageHeader } from "@/components/shared";
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

export const millions = (d: number) =>
  `${d < 0 ? "−" : ""}$${(Math.abs(d) / 1_000_000).toFixed(1)}M`;

export function FreeAgencyPage() {
  const view = useSim("freeAgencyView", {}, useLeagueKey());
  if (view.error) return <ErrorNote message={view.error} />;
  if (!view.data) return <Loading what="Loading the market" />;
  const v = view.data;
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={`${v.season} free agency`}
        subtitle={
          <>
            {v.open
              ? `Free agency is open: day ${v.day}. Teams bid each day for the first week, then each week until the draft.`
              : "Free agency opens with the new League Year in March; the re-signing window comes first."}{" "}
            Market value is what comparable contracts pay; the ask is what his agent wants.
            {v.room !== null && ` Your team can spend about ${millions(v.room)} this League Year.`}
          </>
        }
      />

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Player</TableHead>
            <TableHead>Pos</TableHead>
            <TableHead className="text-right">Age</TableHead>
            <TableHead>Ovr</TableHead>
            <TableHead>Last team</TableHead>
            <TableHead className="text-right">Market</TableHead>
            <TableHead className="text-right">Ask</TableHead>
            <TableHead>Interest</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {v.rows.map((r) => (
            <TableRow key={r.id}>
              <TableCell>
                <Link href={`/negotiate/${r.id}`} className="font-medium hover:underline">
                  {r.name}
                </Link>
              </TableCell>
              <TableCell>{r.position}</TableCell>
              <TableCell className="text-right tabular-nums">{r.age}</TableCell>
              <TableCell>
                <OverallBadge value={r.overall} />
              </TableCell>
              <TableCell className="text-muted-foreground">{r.formerTeam ?? "—"}</TableCell>
              <TableCell className="text-right tabular-nums">{millions(r.market)}</TableCell>
              <TableCell className="text-right tabular-nums">{millions(r.ask)}</TableCell>
              <TableCell className="text-xs">
                {r.offers === 0 ? (
                  <span className="text-muted-foreground">No offers yet</span>
                ) : (
                  <>
                    {r.offers} offer{r.offers === 1 ? "" : "s"}, best {millions(r.bestOffer!)} (
                    {r.bidders.join(", ")})
                  </>
                )}
              </TableCell>
            </TableRow>
          ))}
          {v.rows.length === 0 && (
            <TableRow>
              <TableCell colSpan={8} className="py-6 text-center text-muted-foreground">
                No free agents of note right now.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Signings</CardTitle>
            <CardDescription>
              This League Year's deals, newest first, with the reason.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex max-h-[32rem] flex-col gap-2 overflow-y-auto text-sm">
            {v.signings.length === 0 && <p className="text-muted-foreground">None yet.</p>}
            {v.signings.map((s, i) => (
              <div key={i}>
                <div>
                  <span className="text-xs text-muted-foreground">{formatLeagueDate(s.date)} </span>
                  {s.text}
                </div>
                <div className="text-xs text-muted-foreground">{s.reason}</div>
              </div>
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Tags and tenders</CardTitle>
            <CardDescription>
              Players whose rights a team holds this League Year (CBA Articles 8–10). Others can
              make offer sheets except to exclusive ones.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex max-h-[32rem] flex-col gap-1 overflow-y-auto text-sm">
            {v.offerSheets.map((s) => (
              <div key={s.player} className="font-medium">
                Offer sheet: {s.player} with {s.team} ({millions(s.apy)} a year); {s.prior} has
                until {formatLeagueDate(s.matchBy)} to match.
              </div>
            ))}
            {v.rights.length === 0 && <p className="text-muted-foreground">None this year.</p>}
            {v.rights.map((r) => (
              <div key={r.playerId}>
                <Link href={`/player/${r.playerId}`} className="hover:underline">
                  {r.player}
                </Link>{" "}
                <span className="text-muted-foreground">
                  {r.position}, {r.team}: {r.kind}, {millions(r.amount)}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
