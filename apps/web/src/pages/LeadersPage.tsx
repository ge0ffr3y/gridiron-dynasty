import { useState } from "react";
import { Link } from "wouter";
import { ErrorNote, Loading, PageHeader } from "@/components/shared";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select } from "@/components/ui/input";
import { useLeagueKey } from "@/lib/session";
import { useSim } from "@/sim/client";

/** The top ten in each category for a regular season. */
export function LeadersPage() {
  const [season, setSeason] = useState<number | undefined>(undefined);
  const view = useSim(
    "leadersView",
    season === undefined ? {} : { season },
    useLeagueKey(`leaders:${season ?? "latest"}`),
  );
  if (view.error) return <ErrorNote message={view.error} />;
  if (!view.data) return <Loading />;
  const data = view.data;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <PageHeader
          title="League leaders"
          subtitle={`${data.season} regular season. EPA is expected points added: how much a player's plays raised his team's chances of scoring.`}
        />
        {data.seasons.length > 1 && (
          <Select
            aria-label="Season"
            value={data.season}
            onChange={(e) => setSeason(Number(e.target.value))}
            className="w-28"
          >
            {data.seasons.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </Select>
        )}
      </div>
      {data.seasons.length === 0 ? (
        <p className="text-sm text-muted-foreground">No games have been played yet.</p>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {data.categories.map((c) => (
            <Card key={c.key} className="gap-2 py-4">
              <CardHeader className="px-4">
                <CardTitle className="text-sm">{c.label}</CardTitle>
                {c.qualifier && (
                  <CardDescription className="text-xs">{c.qualifier}</CardDescription>
                )}
              </CardHeader>
              <CardContent className="px-4">
                {c.leaders.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Nobody qualifies yet.</p>
                ) : (
                  <ol className="flex flex-col gap-1 text-sm">
                    {c.leaders.map((l, i) => (
                      <li key={l.playerId} className="flex items-baseline gap-2">
                        <span className="w-5 text-right text-xs tabular-nums text-muted-foreground">
                          {i + 1}
                        </span>
                        <Link href={`/player/${l.playerId}`} className="truncate hover:underline">
                          {l.name}
                        </Link>
                        <span className="text-xs text-muted-foreground">
                          {l.position}, {l.team}
                        </span>
                        <span className="ml-auto font-medium tabular-nums">{l.value}</span>
                      </li>
                    ))}
                  </ol>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
