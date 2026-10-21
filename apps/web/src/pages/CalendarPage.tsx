/** The League Year's dates and deadlines, where the league is now, and what the sim buttons do. */
import { ErrorNote, Loading, PageHeader } from "@/components/shared";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatLeagueDate } from "@/lib/format";
import { useLeagueKey } from "@/lib/session";
import { useSim } from "@/sim/client";

export function CalendarPage() {
  const view = useSim("calendarPageView", {}, useLeagueKey("calendar"));
  if (view.error) return <ErrorNote message={view.error} />;
  if (!view.data) return <Loading />;
  const c = view.data;
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={`${c.season} League Year`}
        subtitle={`Today: ${formatLeagueDate(c.date)} · ${c.stage}`}
      />
      <Card>
        <CardHeader>
          <CardTitle>From here</CardTitle>
          <CardDescription>
            {c.trading.open ? "Trading is open." : c.trading.why} The sim buttons at the top take
            the league to:
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {c.actions.map((a) => (
            <Badge key={a.label} variant="outline">
              {a.label}
            </Badge>
          ))}
        </CardContent>
      </Card>
      <Card className="py-2">
        <CardContent className="flex flex-col divide-y px-4">
          {c.events.map((e) => (
            <div
              key={`${e.date}:${e.label}`}
              className={`flex items-baseline gap-4 py-2 text-sm ${e.past ? "text-muted-foreground" : ""}`}
            >
              <span className="w-28 shrink-0 tabular-nums">{formatLeagueDate(e.date)}</span>
              <span className={e.next ? "font-medium" : undefined}>{e.label}</span>
              {e.next && <Badge variant="secondary">next</Badge>}
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
