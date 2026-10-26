/**
 * Moods and disputes (Phase 12b): a player's mood card, a team's locker room, and the league's
 * holdouts, hold-ins and trade requests.
 */
import type { DisputeRow, PlayerView } from "@fgm/sim-core";
import { Link } from "wouter";
import { ErrorNote, Loading, MoodTag, OverallBadge } from "@/components/shared";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatLeagueDate, ordinal } from "@/lib/format";
import { useLeagueKey } from "@/lib/session";
import { useSim } from "@/sim/client";

const KIND = {
  holdout: "Holdout",
  "hold-in": "Hold-in",
  "trade-request": "Trade request",
} as const;

const OUTCOME: Record<string, string> = {
  extended: "Extended",
  traded: "Traded",
  reported: "Reported",
  withdrawn: "Withdrawn",
  released: "Left the team",
};

const money = (d: number) => `$${(d / 1e6).toFixed(2)}M`;

/** One mood factor as a bar from the middle: left for what sours him, right for what pleases. */
function FactorBar({ label, points }: { label: string; points: number }) {
  const width = Math.min(50, Math.abs(points) * 2.5);
  return (
    <div className="grid grid-cols-[9rem_1fr_3rem] items-center gap-2 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <div className="relative h-2 rounded bg-muted">
        <div className="absolute inset-y-0 left-1/2 w-px bg-border" />
        <div
          className={`absolute inset-y-0 rounded ${points >= 0 ? "bg-primary" : "bg-destructive"}`}
          style={
            points >= 0 ? { left: "50%", width: `${width}%` } : { right: "50%", width: `${width}%` }
          }
        />
      </div>
      <span className="text-right tabular-nums">
        {points > 0 ? "+" : ""}
        {points.toFixed(1)}
      </span>
    </div>
  );
}

/** The player page's mood card: how he feels, why, and his disputes. */
export function MoodCard({ player }: { player: PlayerView }) {
  const { mood, disputes } = player;
  if (!mood && disputes.length === 0) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Mood</CardTitle>
        <CardDescription>
          How he feels about where he is (50 is content). It moves a little each week. A happy
          player develops a touch faster and plays a little above himself; an unhappy one asks more
          to stay, and an underpaid star may hold out.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {mood && (
          <>
            <div className="flex items-center gap-3">
              <span className="text-3xl font-semibold tabular-nums">{mood.score}</span>
              <MoodTag mood={mood} always />
              <span className="text-sm text-muted-foreground">{mood.reason}</span>
            </div>
            <div className="flex flex-col gap-1.5">
              {mood.factors.map((f) => (
                <FactorBar key={f.key} label={f.label} points={f.points} />
              ))}
            </div>
          </>
        )}
        {disputes.length > 0 && (
          <DisputeTable
            rows={disputes.map((d) => ({
              ...d,
              name: "",
              position: "",
              playerId: player.id,
              teamId: d.team,
            }))}
            showPlayer={false}
          />
        )}
      </CardContent>
    </Card>
  );
}

/** Disputes, newest first: what he wanted, how the team answered, how it ended. */
export function DisputeTable({
  rows,
  showPlayer = true,
}: {
  rows: DisputeRow[];
  showPlayer?: boolean;
}) {
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            {showPlayer && <TableHead>Player</TableHead>}
            <TableHead>Team</TableHead>
            <TableHead>What</TableHead>
            <TableHead>Since</TableHead>
            <TableHead>Outcome</TableHead>
            <TableHead>Why, and the team's answer</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((d, i) => (
            <TableRow key={`${d.playerId}-${d.start}-${i}`}>
              {showPlayer && (
                <TableCell>
                  <Link href={`/player/${d.playerId}`} className="font-medium hover:underline">
                    {d.name}
                  </Link>{" "}
                  <span className="text-muted-foreground">{d.position}</span>
                </TableCell>
              )}
              <TableCell>
                <Link href={`/team/${d.teamId}`} className="hover:underline">
                  {d.teamId}
                </Link>
              </TableCell>
              <TableCell>{KIND[d.kind]}</TableCell>
              <TableCell className="whitespace-nowrap">{formatLeagueDate(d.start)}</TableCell>
              <TableCell className="whitespace-nowrap">
                {d.outcome ? (
                  `${OUTCOME[d.outcome] ?? d.outcome}${d.end ? `, ${formatLeagueDate(d.end)}` : ""}`
                ) : (
                  <span className="text-destructive">Open</span>
                )}
                {d.fines > 0 && (
                  <div className="text-xs text-muted-foreground">Fined {money(d.fines)}</div>
                )}
              </TableCell>
              <TableCell className="min-w-72 whitespace-normal text-xs">
                <div>{d.reason}</div>
                {d.response && <div className="text-muted-foreground">{d.response}</div>}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function MoodList({
  title,
  description,
  rows,
}: {
  title: string;
  description: string;
  rows: {
    id: number;
    name: string;
    position: string;
    age: number;
    overall: number;
    mood: number;
    label: string;
    reason: string;
    leader: boolean;
  }[];
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-2 text-sm">
        {rows.length === 0 && <span className="text-muted-foreground">Nobody.</span>}
        {rows.map((r) => (
          <div key={r.id} className="flex flex-wrap items-center gap-2">
            <OverallBadge value={r.overall} />
            <Link href={`/player/${r.id}`} className="font-medium hover:underline">
              {r.name}
            </Link>
            <span className="text-muted-foreground">
              {r.position}, {r.age}
            </span>
            <MoodTag mood={{ score: r.mood, label: r.label, reason: r.reason }} always />
            <span className="basis-full text-xs text-muted-foreground">{r.reason}</span>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

/** A team's locker room tab. */
export function LockerRoom({ teamId }: { teamId: string }) {
  const view = useSim("lockerRoomView", { teamId }, useLeagueKey(`locker:${teamId}`));
  if (view.error) return <ErrorNote message={view.error} />;
  if (!view.data) return <Loading />;
  const v = view.data;
  const total = v.spread.reduce((s, x) => s + x.count, 0);
  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>
            Chemistry: {v.chemistryLabel} ({v.chemistry.toFixed(1)})
          </CardTitle>
          <CardDescription>
            The players' moods, with the leaders counting more and unhappy big egos dragging it
            down. {ordinal(v.rank)} in the league. On game day it's worth{" "}
            {v.gamePoints >= 0 ? "+" : ""}
            {v.gamePoints.toFixed(2)} rating points to every player (small by design).
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          <div className="flex h-3 overflow-hidden rounded">
            {v.spread.map((s, i) =>
              s.count === 0 ? null : (
                <div
                  key={s.label}
                  title={`${s.label}: ${s.count}`}
                  className={
                    i <= 1 ? "bg-primary" : i === 2 ? "bg-muted-foreground/40" : "bg-destructive"
                  }
                  style={{
                    width: `${(100 * s.count) / Math.max(1, total)}%`,
                    opacity: i === 0 || i === 4 ? 1 : 0.6,
                    marginRight: 2,
                  }}
                />
              ),
            )}
          </div>
          <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
            {v.spread.map((s) => (
              <span key={s.label}>
                {s.label} {s.count}
              </span>
            ))}
          </div>
        </CardContent>
      </Card>
      <div className="grid gap-4 lg:grid-cols-2">
        <MoodList
          title="Leaders"
          description="The players with the most say in the room."
          rows={v.leaders}
        />
        <MoodList
          title="Unhappy"
          description="Players whose mood is below 40, unhappiest first."
          rows={v.unhappy}
        />
      </div>
      {v.disruptive.length > 0 && (
        <MoodList
          title="Disruptive"
          description="Big egos in a bad mood: each one costs the room two points."
          rows={v.disruptive}
        />
      )}
      <Card>
        <CardHeader>
          <CardTitle>Holdouts, hold-ins and trade requests</CardTitle>
          <CardDescription>This team's contract disputes, newest first.</CardDescription>
        </CardHeader>
        <CardContent>
          {v.disputes.length === 0 ? (
            <span className="text-sm text-muted-foreground">None.</span>
          ) : (
            <DisputeTable rows={v.disputes} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/** The league page's card: disputes under way and this year's and last year's. */
export function DisputesCard() {
  const view = useSim("disputesView", {}, useLeagueKey("disputes"));
  if (!view.data) return null;
  const { open, recent } = view.data;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Holdouts and trade requests</CardTitle>
        <CardDescription>
          Underpaid stars may hold out of camp (fined every day) or hold in, and unhappy players may
          ask to be traded. Each team answers with an extension, a trade, or by waiting.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {open.length === 0 && recent.length === 0 && (
          <span className="text-sm text-muted-foreground">None this year or last.</span>
        )}
        {open.length > 0 && (
          <div className="flex flex-col gap-1">
            <h3 className="text-sm font-semibold">Under way</h3>
            <DisputeTable rows={open} />
          </div>
        )}
        {recent.length > 0 && (
          <div className="flex flex-col gap-1">
            <h3 className="text-sm font-semibold">This year and last</h3>
            <DisputeTable rows={recent} />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
