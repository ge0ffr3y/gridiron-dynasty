/**
 * A team's depth chart: who starts and who backs up at every spot. Arrows
 * move a player up or down; the first change turns the chart from automatic
 * into a custom one, and "Reset to automatic" goes back.
 */
import type { DepthChartView, DepthSlot } from "@fgm/sim-core";
import { ChevronDown, ChevronUp } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "wouter";
import { ErrorNote, InjuryTag, Loading, OverallBadge } from "@/components/shared";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useLeagueKey } from "@/lib/session";
import { cn } from "@/lib/utils";
import { call, useSim } from "@/sim/client";

const SIDES: { id: DepthChartView["slots"][number]["side"]; title: string }[] = [
  { id: "offense", title: "Offense" },
  { id: "defense", title: "Defense" },
  { id: "special", title: "Special teams" },
];

export function DepthChartEditor({ teamId }: { teamId: string }) {
  const view = useSim("depthChartView", { teamId }, useLeagueKey(`depth:${teamId}`));
  const [chart, setChart] = useState<DepthChartView | null>(null);
  // A fresh answer from the worker (e.g. after simming a week) replaces local edits.
  useEffect(() => setChart(null), [view.data]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  if (view.error) return <ErrorNote message={view.error} />;
  const data = chart ?? view.data;
  if (!data) return <Loading />;

  const change = async (run: () => Promise<DepthChartView>) => {
    setBusy(true);
    setError(undefined);
    try {
      setChart(await run());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const move = (slot: DepthSlot, playerId: number, toIndex: number) =>
    change(() => call("moveOnDepthChart", { teamId, slot, playerId, toIndex }));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {data.auto
            ? "Automatic: rebuilt from the roster before every game (best overall at each spot, counting players who know a second position)."
            : "Custom order. New players are added at the bottom of their spots; injured players sit out until they're healthy."}
        </p>
        <Button
          variant="outline"
          size="sm"
          disabled={data.auto || busy}
          onClick={() => change(() => call("resetDepthChart", { teamId }))}
        >
          Reset to automatic
        </Button>
      </div>
      {error && <ErrorNote message={error} />}
      {SIDES.map((side) => (
        <div key={side.id} className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold">{side.title}</h3>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {data.slots
              .filter((s) => s.side === side.id)
              .map((s) => (
                <Card key={s.slot} className="gap-2 py-3">
                  <CardContent className="px-3">
                    <div className="mb-1 flex items-baseline justify-between">
                      <span className="text-sm font-medium">{s.name}</span>
                      <span className="text-xs text-muted-foreground">
                        {s.starters} starter{s.starters === 1 ? "" : "s"}
                      </span>
                    </div>
                    {s.players.length === 0 && (
                      <p className="text-xs text-muted-foreground">
                        Nobody on the roster plays here.
                      </p>
                    )}
                    <ol className="flex flex-col">
                      {s.players.map((p, i) => (
                        <li
                          key={p.id}
                          className={cn(
                            "flex items-center gap-2 py-1 text-sm",
                            i === s.starters - 1 && i < s.players.length - 1 && "border-b",
                            i >= s.starters && "text-muted-foreground",
                          )}
                        >
                          <span className="w-4 text-right text-xs tabular-nums text-muted-foreground">
                            {i + 1}
                          </span>
                          <OverallBadge value={p.overall} />
                          <span className="min-w-0 flex-1 truncate">
                            <Link href={`/player/${p.id}`} className="hover:underline">
                              {p.name}
                            </Link>
                            {p.outOfPosition && (
                              <span className="ml-1 text-xs text-muted-foreground">
                                ({p.position})
                              </span>
                            )}
                            <InjuryTag injury={p.injury} />
                            {p.note && (
                              <span
                                className="ml-1 rounded bg-accent px-1 text-xs text-accent-foreground"
                                title={p.note}
                              >
                                camp
                              </span>
                            )}
                          </span>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-6"
                            aria-label={`Move ${p.name} up`}
                            disabled={busy || i === 0}
                            onClick={() => move(s.slot, p.id, i - 1)}
                          >
                            <ChevronUp className="size-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-6"
                            aria-label={`Move ${p.name} down`}
                            disabled={busy || i === s.players.length - 1}
                            onClick={() => move(s.slot, p.id, i + 1)}
                          >
                            <ChevronDown className="size-4" />
                          </Button>
                        </li>
                      ))}
                    </ol>
                  </CardContent>
                </Card>
              ))}
          </div>
        </div>
      ))}
    </div>
  );
}
