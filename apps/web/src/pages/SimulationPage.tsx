/**
 * Simulation Mode (Phase 13b): every team run by its AI front office. Sim many seasons with
 * progress and a stop button, then watch the league: power rankings, champions and dynasties,
 * droughts, every GM with his philosophy and stance, and the front-office moves with reasons.
 */
import { Loader2, Play, Square } from "lucide-react";
import { useRef, useState } from "react";
import { Link } from "wouter";
import { ErrorNote, Loading, PageHeader } from "@/components/shared";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
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

const STANCE: Record<string, string> = {
  contend: "Contending",
  retool: "Retooling",
  rebuild: "Rebuilding",
};

function SimSeasons() {
  const { bump } = useSession();
  const [count, setCount] = useState(10);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string>();
  const stop = useRef(false);
  const run = async () => {
    stop.current = false;
    setError(undefined);
    try {
      for (let i = 1; i <= count; i++) {
        if (stop.current) break;
        setStatus(`Season ${i} of ${count}…`);
        await call("simSeason", {}, (label) => setStatus(`Season ${i} of ${count}: ${label}`));
        bump();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setStatus(null);
    }
  };
  return (
    <Card>
      <CardHeader>
        <CardTitle>Sim many seasons</CardTitle>
        <CardDescription>
          Every team's GM, coaches and owner run it: trades, free agency, the draft, firings. Each
          season is saved as it finishes; stop any time (after the season under way).
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap items-center gap-2">
        <Input
          type="number"
          min={1}
          max={100}
          value={count}
          onChange={(e) => setCount(Math.max(1, Math.min(100, Number(e.target.value) || 1)))}
          className="w-24"
          aria-label="Seasons to sim"
          disabled={status !== null}
        />
        {status === null ? (
          <Button onClick={() => void run()}>
            <Play /> Sim {count} season{count === 1 ? "" : "s"}
          </Button>
        ) : (
          <>
            <span className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
              <Loader2 className="size-4 animate-spin" /> {status}
            </span>
            <Button variant="outline" onClick={() => (stop.current = true)}>
              <Square /> Stop after this season
            </Button>
          </>
        )}
        {error && <ErrorNote message={error} />}
      </CardContent>
    </Card>
  );
}

export function SimulationPage() {
  const key = useLeagueKey("simulation");
  const power = useSim("powerRankingsView", {}, key);
  const overview = useSim("leagueOverview", {}, key);
  if (overview.error) return <ErrorNote message={overview.error} />;
  if (!overview.data || !power.data) return <Loading />;
  const o = overview.data;
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Simulation"
        subtitle={`${o.seasons} season${o.seasons === 1 ? "" : "s"} of history. Every team is run by its AI front office.`}
      />
      <SimSeasons />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Power rankings</CardTitle>
            <CardDescription>
              By point margin and record as the season goes on; by the league office's read of each
              roster before it.
            </CardDescription>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">#</TableHead>
                  <TableHead>Team</TableHead>
                  <TableHead className="text-right">Move</TableHead>
                  <TableHead>Why</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {power.data.map((r) => (
                  <TableRow key={r.teamId}>
                    <TableCell className="tabular-nums">{r.rank}</TableCell>
                    <TableCell>
                      <Link href={`/team/${r.teamId}`} className="hover:underline">
                        {r.name}
                      </Link>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {r.moved === null || r.moved === 0
                        ? "–"
                        : r.moved > 0
                          ? `▲${r.moved}`
                          : `▼${-r.moved}`}
                    </TableCell>
                    <TableCell className="whitespace-normal text-xs text-muted-foreground">
                      {r.reason}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader>
              <CardTitle>Champions</CardTitle>
              <CardDescription>Newest first, with the GM who built each one.</CardDescription>
            </CardHeader>
            <CardContent className="flex max-h-72 flex-col gap-1 overflow-y-auto text-sm">
              {o.champions.map((c) => (
                <div key={c.season}>
                  <span className="tabular-nums text-muted-foreground">{c.season}</span>{" "}
                  <Link href={`/team/${c.teamId}`} className="font-medium hover:underline">
                    {c.teamId}
                  </Link>
                  {c.gm && <span className="text-muted-foreground"> · GM {c.gm}</span>}
                </div>
              ))}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Dynasties and droughts</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 text-sm sm:grid-cols-2">
              <div>
                <div className="mb-1 text-xs text-muted-foreground">Most titles</div>
                {o.titlesByTeam.slice(0, 6).map((t) => (
                  <div key={t.teamId}>
                    {t.teamId}: {t.titles} (last {t.lastTitle})
                  </div>
                ))}
                {o.titlesByGmType.length > 0 && (
                  <div className="mt-2 text-xs text-muted-foreground">
                    Titles by GM type:{" "}
                    {o.titlesByGmType.map((t) => `${t.type} ${t.titles}`).join(", ")}
                  </div>
                )}
              </div>
              <div>
                <div className="mb-1 text-xs text-muted-foreground">Playoff streaks · droughts</div>
                {o.streaks.slice(0, 4).map((s) => (
                  <div key={s.teamId}>
                    {s.teamId}: {s.playoffStreak} straight
                  </div>
                ))}
                {[...o.streaks]
                  .sort((a, b) => b.drought - a.drought)
                  .slice(0, 3)
                  .map((s) => (
                    <div key={`d-${s.teamId}`} className="text-muted-foreground">
                      {s.teamId}: {s.drought} seasons out
                    </div>
                  ))}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>General managers</CardTitle>
          <CardDescription>
            Who runs each team, his philosophy, and where he thinks it stands.
          </CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Team</TableHead>
                <TableHead>GM</TableHead>
                <TableHead>Philosophy</TableHead>
                <TableHead className="text-right">Since</TableHead>
                <TableHead>Stance</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {o.gms.map((g) => (
                <TableRow key={g.teamId}>
                  <TableCell>
                    <Link href={`/team/${g.teamId}`} className="hover:underline">
                      {g.teamId}
                    </Link>
                  </TableCell>
                  <TableCell>
                    {g.id >= 0 ? (
                      <Link href={`/executive/${g.id}`} className="hover:underline">
                        {g.name}
                      </Link>
                    ) : (
                      g.name
                    )}
                  </TableCell>
                  <TableCell>{g.type}</TableCell>
                  <TableCell className="text-right tabular-nums">{g.since}</TableCell>
                  <TableCell>{g.stance ? STANCE[g.stance] : "–"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Front-office moves</CardTitle>
          <CardDescription>
            Owners hiring and firing general managers, with their reasons.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 text-sm">
          {o.moves.length === 0 && <span className="text-muted-foreground">None yet.</span>}
          {o.moves.map((m, i) => (
            <div key={`${m.date}-${m.executiveId}-${i}`}>
              <span className="text-muted-foreground">{formatLeagueDate(m.date)}</span> ·{" "}
              <Link href={`/executive/${m.executiveId}`} className="hover:underline">
                {m.text}
              </Link>
              <div className="text-xs text-muted-foreground">Why: {m.reason}</div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
