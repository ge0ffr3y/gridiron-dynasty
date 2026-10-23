/** A general manager's or an owner's page (Phase 13b): philosophy, career, moves, trades. */
import { Link } from "wouter";
import { ErrorNote, Loading, PageHeader } from "@/components/shared";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatLeagueDate } from "@/lib/format";
import { useLeagueKey } from "@/lib/session";
import { useSim } from "@/sim/client";

export function ExecutivePage({ id }: { id: number }) {
  const view = useSim("executiveView", { id }, useLeagueKey(`exec:${id}`));
  if (view.error) return <ErrorNote message={view.error} />;
  if (!view.data) return <Loading />;
  const e = view.data;
  const seasons = e.career.filter((c) => c.teamId !== null);
  const totals = seasons.reduce(
    (s, c) => ({
      w: s.w + (c.record?.wins ?? 0),
      l: s.l + (c.record?.losses ?? 0),
      p: s.p + (c.playoffs ? 1 : 0),
    }),
    { w: 0, l: 0, p: 0 },
  );
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={e.name}
        subtitle={`${e.role}${e.teamId ? `, ${e.teamId}` : e.retiredAfter ? `, retired after ${e.retiredAfter}` : ", out of work"} · age ${e.age}${e.type ? ` · ${e.type}` : ""} · reputation ${e.reputation}`}
      />
      {e.knobs.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Philosophy</CardTitle>
            <CardDescription>{e.leanings.join(". ") || "Typical in every way."}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {e.knobs.map((k) => (
              <div
                key={k.key}
                className="grid grid-cols-[8rem_1fr_8rem] items-center gap-2 text-xs"
              >
                <span className="text-right text-muted-foreground">{k.low}</span>
                <div className="relative h-2 rounded bg-muted">
                  <div className="absolute inset-y-0 left-1/2 w-px bg-border" />
                  <div
                    className="absolute inset-y-0 rounded bg-primary"
                    style={
                      k.value >= 0
                        ? { left: "50%", width: `${k.value * 50}%` }
                        : { right: "50%", width: `${-k.value * 50}%` }
                    }
                  />
                </div>
                <span className="text-muted-foreground">{k.high}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
      {e.traits.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Character</CardTitle>
            <CardDescription>{e.traits.join(", ")}.</CardDescription>
          </CardHeader>
        </Card>
      )}
      <Card>
        <CardHeader>
          <CardTitle>Career</CardTitle>
          <CardDescription>
            {seasons.length} seasons: {totals.w}-{totals.l}, {totals.p} playoff trips.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-1 text-sm">
          {e.career.map((c) => (
            <div key={`${c.season}-${c.teamId}`}>
              <span className="tabular-nums text-muted-foreground">{c.season}</span>{" "}
              {c.teamId ? (
                <Link href={`/team/${c.teamId}`} className="hover:underline">
                  {c.teamId}
                </Link>
              ) : (
                "out of work"
              )}
              {c.record &&
                ` · ${c.record.wins}-${c.record.losses}${c.record.ties ? `-${c.record.ties}` : ""}`}
              {c.playoffs && " · playoffs"}
            </div>
          ))}
        </CardContent>
      </Card>
      {e.moves.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Hired and fired</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 text-sm">
            {e.moves.map((m, i) => (
              <div key={`${m.date}-${i}`}>
                <span className="text-muted-foreground">{formatLeagueDate(m.date)}</span> · {m.text}
                <div className="text-xs text-muted-foreground">Why: {m.reason}</div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
      {e.trades.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>His trades</CardTitle>
            <CardDescription>
              What he gave and got, in his own eyes (draft-pick value).
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 text-sm">
            {e.trades.map((t, i) => (
              <div key={`${t.date}-${i}`}>
                {t.text}
                <div className="text-xs text-muted-foreground">
                  {formatLeagueDate(t.date)} · gave {t.gave.toFixed(1)}, got {t.got.toFixed(1)}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
