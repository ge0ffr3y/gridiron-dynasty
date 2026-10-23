/**
 * Draft day screens (Phase 11b): the draft room, a team's big board, mock
 * drafts and draft history with retro grades. Every rating is a staff's read.
 */
import type { BoardRow, DraftAction, DraftRoomView } from "@fgm/sim-core";
import { ArrowDown, ArrowUp, Pause, Play } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import { ErrorNote, Loading } from "@/components/shared";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useLeagueKey, useSession } from "@/lib/session";
import { call, useSim } from "@/sim/client";
import { RangeCell } from "./DraftPage";

function NeedTag({ need }: { need: number }) {
  if (need < 0.34) return null;
  return (
    <span className="ml-1 rounded border px-1 text-[10px] text-muted-foreground">
      {need >= 0.67 ? "big need" : "need"}
    </span>
  );
}

function BoardTable({
  rows,
  onDraft,
  onMove,
}: {
  rows: BoardRow[];
  onDraft?: (id: number) => void;
  onMove?: (index: number, by: -1 | 1) => void;
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="text-right">#</TableHead>
          <TableHead className="text-right">Cons.</TableHead>
          <TableHead>Name</TableHead>
          <TableHead>Pos</TableHead>
          <TableHead>College</TableHead>
          <TableHead>Ovr</TableHead>
          <TableHead>Potential</TableHead>
          <TableHead>Why here</TableHead>
          {(onDraft || onMove) && <TableHead />}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r, i) => (
          <TableRow key={r.id}>
            <TableCell className="text-right tabular-nums">{r.rank}</TableCell>
            <TableCell className="text-right tabular-nums text-muted-foreground">
              {r.consensusRank}
            </TableCell>
            <TableCell>
              <Link href={`/prospect/${r.id}`} className="font-medium hover:underline">
                {r.name}
              </Link>
            </TableCell>
            <TableCell>
              {r.position}
              <NeedTag need={r.need} />
            </TableCell>
            <TableCell className="text-muted-foreground">{r.college}</TableCell>
            <TableCell>
              <RangeCell value={r.overall} range={r.range} />
            </TableCell>
            <TableCell className="tabular-nums">
              {r.potential[0]}–{r.potential[1]}
            </TableCell>
            <TableCell className="max-w-56 text-xs text-muted-foreground">{r.reason}</TableCell>
            {(onDraft || onMove) && (
              <TableCell className="whitespace-nowrap text-right">
                {onMove && (
                  <>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Move ${r.name} up`}
                      disabled={i === 0}
                      onClick={() => onMove(i, -1)}
                    >
                      <ArrowUp />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Move ${r.name} down`}
                      disabled={i === rows.length - 1}
                      onClick={() => onMove(i, 1)}
                    >
                      <ArrowDown />
                    </Button>
                  </>
                )}
                {onDraft && (
                  <Button size="sm" variant="outline" onClick={() => onDraft(r.id)}>
                    Draft
                  </Button>
                )}
              </TableCell>
            )}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

/** The draft room: the pick on the clock, its board, offers, what's next, and the log. */
export function DraftRoomTab({ viewingTeam }: { viewingTeam: string | null }) {
  const { bump } = useSession();
  const view = useSim("draftRoomView", {}, useLeagueKey("room"));
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [auto, setAuto] = useState(false);
  const autoRef = useRef(auto);
  autoRef.current = auto;

  const act = (action: DraftAction) => {
    setBusy(true);
    return call("draftAction", action)
      .then(
        (r) => setMessage(r.message),
        (e: unknown) => {
          setMessage(String(e));
          setAuto(false);
        },
      )
      .finally(() => {
        setBusy(false);
        bump();
      });
  };

  const v: DraftRoomView | undefined = view.data;
  // Auto-play: one AI pick about every second, stopping when the team you're viewing as is up.
  useEffect(() => {
    if (!auto || busy || !v || v.status !== "live") return;
    if (viewingTeam && v.onClock?.teamId === viewingTeam) {
      setAuto(false);
      return;
    }
    const timer = setTimeout(() => {
      if (autoRef.current) void act({ kind: "sim", until: "next" });
    }, 900);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auto, busy, v]);

  if (view.error) return <ErrorNote message={view.error} />;
  if (!v) return <Loading what="Loading the draft room" />;

  if (v.status === "before")
    return (
      <Card>
        <CardHeader>
          <CardTitle>The {v.draftYear} draft</CardTitle>
          <CardDescription>
            The draft room opens on draft day: use "Sim to draft day" at the top. Then make picks
            one at a time, let the AI pick, or watch it live; teams trade up and down as it goes.
          </CardDescription>
        </CardHeader>
        {v.upcoming.length > 0 && (
          <CardContent className="text-sm">
            <div className="mb-2 font-medium">First picks</div>
            <ol className="grid gap-1 sm:grid-cols-2">
              {v.upcoming.map((p) => (
                <li key={p.overall}>
                  <span className="tabular-nums text-muted-foreground">#{p.overall}</span> {p.team}
                  {p.compensatory && (
                    <span className="text-xs text-muted-foreground"> (comp.)</span>
                  )}
                </li>
              ))}
            </ol>
          </CardContent>
        )}
      </Card>
    );

  return (
    <div className="flex flex-col gap-4">
      {v.onClock ? (
        <Card>
          <CardHeader>
            <CardTitle>
              On the clock: #{v.onClock.overall}, {v.onClock.team}
            </CardTitle>
            <CardDescription>
              Round {v.onClock.round}
              {v.onClock.compensatory ? " (compensatory pick)" : ""} · {v.onClock.clockMinutes}{" "}
              minutes on the clock · {v.onClock.philosophy} · {v.picksMade} of {v.picksTotal} picks
              made
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {v.needs.length > 0 && (
              <div className="text-sm">
                <span className="text-muted-foreground">Needs: </span>
                {v.needs.map((n) => `${n.position} (${Math.round(n.need * 100)}%)`).join(", ")}
              </div>
            )}
            {v.you && v.yours ? (
              <div className="flex flex-wrap items-center gap-2">
                <Button size="sm" disabled={busy} onClick={() => act({ kind: "pick" })}>
                  Make your pick (top of your board)
                </Button>
                <span className="text-xs text-muted-foreground">
                  Or choose anyone with "Draft" on your board below.
                </span>
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                {!v.you && (
                  <Button size="sm" disabled={busy} onClick={() => act({ kind: "pick" })}>
                    Make their pick (top of their board)
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() => setAuto((a) => !a)}
                >
                  {auto ? <Pause /> : <Play />} {auto ? "Pause" : "Watch it live"}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() => act({ kind: "sim", until: "round" })}
                >
                  Sim to the next round
                </Button>
                {!v.you && viewingTeam && v.onClock.teamId !== viewingTeam && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() => act({ kind: "sim", until: "team", teamId: viewingTeam })}
                  >
                    Sim to {viewingTeam}'s pick
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() => act({ kind: "sim", until: "all" })}
                >
                  {v.you ? "Sim to your next pick" : "Sim every pick"}
                </Button>
              </div>
            )}
            {message && <p className="text-xs text-muted-foreground">{message}</p>}
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Every pick is in</CardTitle>
            <CardDescription>
              Use "Sim through the draft" at the top for the undrafted rush; the class then closes
              and next year's appears.
            </CardDescription>
          </CardHeader>
        </Card>
      )}

      {v.offers.length > 0 && (!v.you || v.yours) && (
        <Card>
          <CardHeader>
            <CardTitle>Trade offers for this pick</CardTitle>
            <CardDescription>
              Teams further down that want to move up. Price: their picks' career value over this
              pick's (real draft-day trades: about 1.42).
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 text-sm">
            {v.offers.map((o) => (
              <div key={o.teamId} className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{o.teamId}</span>
                <span>offers {o.picks.map((p) => p.label).join(" + ")}</span>
                <span className="text-muted-foreground">
                  ({o.priceRatio.toFixed(2)}×) for {o.target.name} ({o.target.position})
                  {o.aiAccepts ? " · the AI would take it" : ""}
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() => act({ kind: "accept-offer", teamId: o.teamId })}
                >
                  Accept
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {v.board.length > 0 && v.onClock && (
        <Card>
          <CardHeader>
            <CardTitle>{v.yours ? "Your board" : `${v.onClock.teamId}'s board`}</CardTitle>
            <CardDescription>
              {v.you
                ? v.yours
                  ? 'What\'s left, as your scouts rank it with your needs. "Draft" takes him.'
                  : "What's left, as their scouts rank it with their needs and philosophy."
                : 'What\'s left, as their scouts rank it with their needs and philosophy. "Draft" makes the pick for them (the league office in Simulation Mode).'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <BoardTable
              rows={v.board}
              onDraft={
                !v.you || v.yours ? (id) => act({ kind: "pick", prospectId: id }) : undefined
              }
            />
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 md:grid-cols-[1fr_2fr]">
        <Card>
          <CardHeader>
            <CardTitle>Coming up</CardTitle>
          </CardHeader>
          <CardContent>
            <ol className="flex flex-col gap-1 text-sm">
              {v.upcoming.map((p) => (
                <li key={p.overall}>
                  <span className="tabular-nums text-muted-foreground">#{p.overall}</span> {p.team}
                  {p.compensatory && (
                    <span className="text-xs text-muted-foreground"> (comp.)</span>
                  )}
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Draft log</CardTitle>
            <CardDescription>Every pick and trade, newest first, with the reason.</CardDescription>
          </CardHeader>
          <CardContent className="flex max-h-[32rem] flex-col gap-2 overflow-y-auto text-sm">
            {v.log.length === 0 && <p className="text-muted-foreground">No picks yet.</p>}
            {v.log.map((e, i) => (
              <div key={i}>
                <div className={e.kind === "trade" ? "font-medium" : undefined}>{e.text}</div>
                <div className="text-xs text-muted-foreground">{e.reason}</div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

/** A team's big board, editable by hand (the league office, until GM Mode). */
export function BigBoardTab({ viewingTeam }: { viewingTeam: string | null }) {
  const { bump } = useSession();
  const options = useSim("viewingOptions", {}, useLeagueKey());
  const [picked, setPicked] = useState<string | null>(null);
  const teamId = viewingTeam ?? picked ?? options.data?.teams[0]?.id ?? null;
  const view = useSim("bigBoardView", { teamId: teamId ?? "" }, useLeagueKey(`board:${teamId}`));
  if (!teamId) return <Loading />;
  if (view.error) return <ErrorNote message={view.error} />;
  if (!view.data) return <Loading what="Loading the board" />;
  const b = view.data;
  const save = (ids: number[] | null) =>
    call("setBoard", { teamId, ids }).then(bump, (e: unknown) => alert(String(e)));
  const move = (index: number, by: -1 | 1) => {
    const ids = b.rows.map((r) => r.id);
    const [x] = ids.splice(index, 1);
    ids.splice(index + by, 0, x!);
    void save(ids);
  };
  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>{b.team}'s big board</CardTitle>
          <CardDescription>
            Their scouts' grades plus needs and their philosophy ({b.philosophy.toLowerCase()}).
            Move players to set the board by hand; on draft day the team takes the top player left
            on it. {b.custom ? "This board has been set by hand." : ""}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-3 text-sm">
          {!viewingTeam && (
            <Select value={teamId} aria-label="Team" onChange={(e) => setPicked(e.target.value)}>
              {options.data?.teams.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </Select>
          )}
          <span className="text-muted-foreground">
            Needs:{" "}
            {b.needs.length
              ? b.needs
                  .slice(0, 6)
                  .map((n) => `${n.position} (${Math.round(n.need * 100)}%)`)
                  .join(", ")
              : "none to speak of"}
          </span>
          {b.custom && (
            <Button size="sm" variant="outline" onClick={() => void save(null)}>
              Back to the scouts' board
            </Button>
          )}
        </CardContent>
      </Card>
      <BoardTable rows={b.rows} onMove={move} />
    </div>
  );
}

export function MockDraftTab() {
  const view = useSim("mockDraftView", {}, useLeagueKey("mock"));
  if (view.error) return <ErrorNote message={view.error} />;
  if (!view.data) return <Loading what="Running the mock draft" />;
  const m = view.data;
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">
        The {m.draftYear} mock draft by {m.by}. {m.note}
      </p>
      {m.picks.length > 0 && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="text-right">Pick</TableHead>
              <TableHead>Team</TableHead>
              <TableHead>Prospect</TableHead>
              <TableHead>Pos</TableHead>
              <TableHead>College</TableHead>
              <TableHead className="text-right">Consensus</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {m.picks.map((p) => (
              <TableRow key={p.overall}>
                <TableCell className="text-right tabular-nums">
                  {p.overall}
                  {p.compensatory && <span className="text-xs text-muted-foreground"> c</span>}
                </TableCell>
                <TableCell>
                  <Link href={`/team/${p.teamId}`} className="hover:underline">
                    {p.teamId}
                  </Link>
                </TableCell>
                <TableCell>
                  <Link href={`/prospect/${p.prospect.id}`} className="font-medium hover:underline">
                    {p.prospect.name}
                  </Link>
                </TableCell>
                <TableCell>{p.prospect.position}</TableCell>
                <TableCell className="text-muted-foreground">{p.prospect.college}</TableCell>
                <TableCell className="text-right tabular-nums">{p.consensusRank}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}

const GRADE_STYLE: Record<string, string> = {
  Steal: "font-medium text-primary",
  Hit: "",
  Fair: "text-muted-foreground",
  Miss: "text-muted-foreground",
  Bust: "font-medium text-destructive",
  "Too early": "text-muted-foreground",
};

export function DraftHistoryTab() {
  const [season, setSeason] = useState<number | undefined>(undefined);
  const view = useSim(
    "draftHistoryView",
    season === undefined ? {} : { season },
    useLeagueKey(`history:${season}`),
  );
  if (view.error) return <ErrorNote message={view.error} />;
  if (!view.data) return <Loading what="Loading draft history" />;
  const h = view.data;
  if (h.season === null) return <p className="text-sm text-muted-foreground">{h.note}</p>;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <Select
          value={String(h.season)}
          aria-label="Draft year"
          onChange={(e) => setSeason(Number(e.target.value))}
        >
          {h.seasons.map((s) => (
            <option key={s} value={s}>
              {s} draft
            </option>
          ))}
        </Select>
        <span className="text-muted-foreground">{h.note}</span>
      </div>
      <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="text-right">Pick</TableHead>
              <TableHead>Team</TableHead>
              <TableHead>Player</TableHead>
              <TableHead>Now</TableHead>
              <TableHead className="text-right">Started</TableHead>
              <TableHead className="text-right">Slot avg.</TableHead>
              <TableHead className="text-right">Peak</TableHead>
              <TableHead>Grade</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {h.picks.map((p) => (
              <TableRow key={p.player.id}>
                <TableCell className="text-right tabular-nums">{p.overall}</TableCell>
                <TableCell>{p.teamId}</TableCell>
                <TableCell>
                  <Link href={`/player/${p.player.id}`} className="font-medium hover:underline">
                    {p.player.name}
                  </Link>{" "}
                  <span className="text-xs text-muted-foreground">{p.player.position}</span>
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">{p.now}</TableCell>
                <TableCell className="text-right tabular-nums">{p.started}</TableCell>
                <TableCell className="text-right tabular-nums text-muted-foreground">
                  {p.expected.toFixed(1)}
                </TableCell>
                <TableCell className="text-right tabular-nums">{p.peak ?? "—"}</TableCell>
                <TableCell className={GRADE_STYLE[p.grade]}>{p.grade}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <Card className="self-start">
          <CardHeader>
            <CardTitle>Team grades</CardTitle>
            <CardDescription>
              Seasons started per pick, above or below the slot's real average.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ol className="flex flex-col gap-1 text-sm">
              {h.teams.map((t) => (
                <li key={t.teamId} className="flex justify-between gap-2">
                  <span>
                    <span className="inline-block w-5 font-semibold">{t.grade}</span> {t.team}
                  </span>
                  <span className="tabular-nums text-muted-foreground">
                    {t.score > 0 ? "+" : ""}
                    {t.score.toFixed(2)} ({t.picks})
                  </span>
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
