import { Trophy } from "lucide-react";
import { Link } from "wouter";
import { GameRow } from "@/components/GameRow";
import { ErrorNote, Loading, PageHeader, TeamChip } from "@/components/shared";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useLeagueKey } from "@/lib/session";
import { useSim } from "@/sim/client";
import { ROUND_LABELS } from "./SchedulePage";

export function PlayoffsPage() {
  const view = useSim("playoffsView", {}, useLeagueKey());
  if (view.error) return <ErrorNote message={view.error} />;
  if (!view.data) return <Loading />;
  const p = view.data;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={`${p.season} playoffs`}
        subtitle={
          p.seedsFinal
            ? "Seven teams per conference; the top seed has a bye."
            : "If the season ended today."
        }
      />

      {p.champion && (
        <Card className="flex-row items-center gap-4 px-5">
          <Trophy className="size-8 text-primary" />
          <div>
            <div className="text-xs text-muted-foreground">{p.season} champion</div>
            <Link href={`/team/${p.champion.id}`} className="text-lg font-semibold hover:underline">
              {p.champion.city} {p.champion.nickname}
            </Link>
          </div>
        </Card>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        {p.conferences.map((c) => (
          <Card key={c.id}>
            <CardHeader>
              <CardTitle>{c.name}</CardTitle>
              <CardDescription>{p.seedsFinal ? "Final seeds" : "Current seeds"}</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-1.5 text-sm">
              {c.seeds.map((s) => (
                <div key={s.team.id} className="flex items-center gap-2">
                  <span className="w-4 text-right tabular-nums text-muted-foreground">
                    {s.seed}
                  </span>
                  <TeamChip team={s.team} />
                  <span className="min-w-0 flex-1 truncate">
                    {s.team.city} {s.team.nickname}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {s.divisionWinner ? "Division" : "Wild card"}
                  </span>
                  <span className="w-12 text-right tabular-nums">{s.record}</span>
                </div>
              ))}
              {!p.seedsFinal && c.hunt.length > 0 && (
                <>
                  <div className="mt-2 text-xs text-muted-foreground">In the hunt</div>
                  {c.hunt.map((h) => (
                    <div key={h.team.id} className="flex items-center gap-2 text-muted-foreground">
                      <span className="w-4" />
                      <TeamChip team={h.team} />
                      <span className="min-w-0 flex-1 truncate">
                        {h.team.city} {h.team.nickname}
                      </span>
                      <span className="w-12 text-right tabular-nums">{h.record}</span>
                    </div>
                  ))}
                </>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      {p.rounds.map((r) => (
        <section key={r.round} className="flex flex-col gap-3">
          <h3 className="font-semibold">{ROUND_LABELS[r.round]}</h3>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {r.games.map((g) => (
              <GameRow key={g.id} game={g} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
