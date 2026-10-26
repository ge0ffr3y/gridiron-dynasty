/**
 * Roster management (Phase 8b): a team's active roster, practice squad and
 * reserve lists with the moves the league office can make (waive, injured
 * reserve, activate, promote, elevate), plus free agents to sign. Each button
 * says what it does; a move that isn't allowed explains why.
 */
import {
  formatShort,
  POSITIONS,
  type RosterManagementRow,
  type RosterMoveOption,
} from "@fgm/sim-core";
import { useState } from "react";
import { Link } from "wouter";
import { ErrorNote, Facts, InjuryTag, Loading, OverallBadge } from "@/components/shared";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select } from "@/components/ui/input";
import { useLeagueKey, useSession } from "@/lib/session";
import { call, useSim } from "@/sim/client";

function MoveButton({
  move,
  busy,
  onMake,
}: {
  move: RosterMoveOption;
  busy: boolean;
  onMake: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const risky = move.kind === "waive";
  if (confirming)
    return (
      <span className="inline-flex gap-1">
        <Button size="sm" disabled={busy} onClick={onMake}>
          Confirm
        </Button>
        <Button size="sm" variant="outline" onClick={() => setConfirming(false)}>
          Cancel
        </Button>
      </span>
    );
  return (
    <Button
      size="sm"
      variant="outline"
      disabled={!move.available || busy}
      title={move.note}
      onClick={() => (risky ? setConfirming(true) : onMake())}
    >
      {move.label}
    </Button>
  );
}

function Rows({
  rows,
  busy,
  make,
}: {
  rows: RosterManagementRow[];
  busy: boolean;
  make: (row: RosterManagementRow, move: RosterMoveOption) => void;
}) {
  if (rows.length === 0) return <p className="text-sm text-muted-foreground">Nobody.</p>;
  return (
    <div className="flex flex-col divide-y">
      {rows.map((r) => (
        <div key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 py-2 text-sm">
          <span className="w-10 text-xs text-muted-foreground">{r.position}</span>
          <OverallBadge value={r.overall} />
          <span className="min-w-0 flex-1">
            <Link href={`/player/${r.id}`} className="font-medium hover:underline">
              {r.name}
            </Link>
            <span className="ml-2 text-xs text-muted-foreground">
              {r.age} · {formatShort(r.capHit)}
              {r.elevated ? " · elevated this week" : ""}
            </span>
            <InjuryTag injury={r.injury} />
          </span>
          <span className="flex flex-wrap gap-1">
            {r.moves.map((m) => (
              <MoveButton key={m.kind} move={m} busy={busy} onMake={() => make(r, m)} />
            ))}
          </span>
        </div>
      ))}
    </div>
  );
}

export function RosterManager({ teamId }: { teamId: string }) {
  const [position, setPosition] = useState("");
  const view = useSim(
    "rosterManagementView",
    { teamId, freeAgentPosition: position || undefined },
    useLeagueKey(`manage:${teamId}:${position}`),
  );
  const { bump } = useSession();
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string>();
  const [error, setError] = useState<string>();
  if (view.error) return <ErrorNote message={view.error} />;
  if (!view.data) return <Loading />;
  const v = view.data;

  const make = async (row: RosterManagementRow, move: RosterMoveOption) => {
    setBusy(true);
    setError(undefined);
    try {
      const { message } = await call("rosterMove", { teamId, playerId: row.id, kind: move.kind });
      setDone(message);
      bump();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardContent>
          <Facts
            items={[
              [v.inSeason ? "Active roster" : "Roster", `${v.counts.roster} of ${v.counts.limit}`],
              ...(v.inSeason
                ? ([
                    ["Practice squad", `${v.counts.practiceSquad} of ${v.counts.practiceSquadMax}`],
                    ["Elevated this week", `${v.elevatedThisWeek} of ${v.elevationsPerGame}`],
                    ["Injured-reserve returns left", v.reserveReturnsLeft],
                  ] as [string, string | number][])
                : []),
              ["Reserve lists", v.counts.reserve],
              ["Cap room", formatShort(v.room)],
            ]}
          />
          <p className="mt-3 text-sm text-muted-foreground">
            In Simulation Mode the league office can make these moves for any team (in GM Mode, only
            your own). Hover a button to see what it does or why it isn't allowed; every move is
            recorded with its reason.
          </p>
        </CardContent>
      </Card>
      {done && <p className="rounded-md border border-primary/40 bg-accent p-3 text-sm">{done}</p>}
      {error && <ErrorNote message={error} />}
      <Card>
        <CardHeader>
          <CardTitle>{v.inSeason ? "Active roster" : "Roster"}</CardTitle>
        </CardHeader>
        <CardContent>
          <Rows rows={v.active} busy={busy} make={make} />
        </CardContent>
      </Card>
      {v.inSeason && (
        <Card>
          <CardHeader>
            <CardTitle>Practice squad</CardTitle>
            <CardDescription>
              Promote a player to the 53, or elevate up to two for this week's game (each at most
              three times a season).
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Rows rows={v.practiceSquad} busy={busy} make={make} />
          </CardContent>
        </Card>
      )}
      <Card>
        <CardHeader>
          <CardTitle>Reserve lists</CardTitle>
          <CardDescription>
            Injured reserve and the PUP list: they don't count against the 53. Players come back
            once healthy and past the four-game minimum.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Rows rows={v.reserve} busy={busy} make={make} />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Free agents</CardTitle>
          <CardDescription>The best available, by your staff's read.</CardDescription>
          <Select
            value={position}
            onChange={(e) => setPosition(e.target.value)}
            aria-label="Position"
            className="w-40"
          >
            <option value="">All positions</option>
            {POSITIONS.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </Select>
        </CardHeader>
        <CardContent>
          <Rows rows={v.freeAgents} busy={busy} make={make} />
        </CardContent>
      </Card>
    </div>
  );
}
