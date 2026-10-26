/**
 * The trade builder: two teams, the players and picks each sends, and both
 * teams' cap room and roster count before and after, checked against the rules
 * before you confirm. The league office proposes for the left team (until GM
 * Mode); the right team's GM answers, with reasons and what it would want
 * instead (Phase 13). Offers from AI teams to a person-run team wait below.
 */
import { formatShort, type TradeAnswer, type TradePreview, type TradeSide } from "@fgm/sim-core";
import { useEffect, useState } from "react";
import { Link } from "wouter";
import { RoomChange } from "@/components/ContractPanel";
import { ErrorNote, Loading, PageHeader } from "@/components/shared";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select } from "@/components/ui/input";
import { useLeagueKey, useSession } from "@/lib/session";
import { call, useSim } from "@/sim/client";

function SidePicker({
  teamId,
  setTeamId,
  side,
  setSide,
  teams,
}: {
  teamId: string;
  setTeamId: (id: string) => void;
  side: TradeSide;
  setSide: (s: TradeSide) => void;
  teams: { id: string; name: string }[];
}) {
  const assets = useSim("tradeAssets", { teamId }, useLeagueKey(`assets:${teamId}`));
  const toggle = (key: "players" | "picks", id: number) =>
    setSide({
      ...side,
      [key]: side[key].includes(id) ? side[key].filter((x) => x !== id) : [...side[key], id],
    });
  return (
    <Card>
      <CardHeader>
        <Select
          value={teamId}
          onChange={(e) => setTeamId(e.target.value)}
          aria-label="Team"
          className="w-full"
        >
          {teams.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </Select>
        <CardDescription>Tick what this team sends.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {assets.error && <ErrorNote message={assets.error} />}
        {!assets.data ? (
          <Loading />
        ) : (
          <>
            <div className="max-h-80 overflow-y-auto rounded-md border">
              {assets.data.players.map((p) => (
                <label
                  key={p.id}
                  className="flex cursor-pointer items-center gap-2 border-b px-2 py-1.5 text-sm last:border-b-0 hover:bg-accent/50"
                >
                  <input
                    type="checkbox"
                    checked={side.players.includes(p.id)}
                    onChange={() => toggle("players", p.id)}
                  />
                  <span className="w-9 shrink-0 text-xs text-muted-foreground">{p.position}</span>
                  <span className="min-w-0 flex-1 truncate">
                    {p.name}
                    {p.list !== "active" && (
                      <span className="ml-1 text-xs text-muted-foreground">({p.list})</span>
                    )}
                  </span>
                  <span className="w-8 text-right tabular-nums">{p.overall}</span>
                  <span className="w-16 text-right text-xs tabular-nums text-muted-foreground">
                    {formatShort(p.capHit)}
                  </span>
                </label>
              ))}
            </div>
            <div className="flex flex-col gap-1">
              <div className="text-sm font-medium">Draft picks</div>
              {assets.data.picks.length === 0 && (
                <p className="text-sm text-muted-foreground">No tradable picks.</p>
              )}
              {assets.data.picks.map((p) => (
                <label key={p.id} className="flex cursor-pointer items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={side.picks.includes(p.id)}
                    onChange={() => toggle("picks", p.id)}
                  />
                  {p.label}
                </label>
              ))}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function TeamImpact({ t }: { t: TradePreview["teams"][number] }) {
  return (
    <div className="flex flex-col gap-1.5 rounded-lg border p-3 text-sm">
      <div className="font-medium">{t.name}</div>
      <div>
        <span className="text-muted-foreground">Gets: </span>
        {[
          ...t.receives.players.map(
            (p) => `${p.name} (${p.position}, ${formatShort(p.capHit)} on their cap this year)`,
          ),
          ...t.receives.picks,
        ].join(", ") || "nothing"}
      </div>
      <div>
        <span className="text-muted-foreground">Cap room this year: </span>
        <RoomChange {...t.roomNow} />
      </div>
      <div>
        <span className="text-muted-foreground">Cap room next year: </span>
        <RoomChange {...t.roomNext} />
      </div>
      {t.deadMoney > 0 && (
        <div>
          <span className="text-muted-foreground">Dead money left behind: </span>
          {formatShort(t.deadMoney)}
        </div>
      )}
      <div>
        <span className="text-muted-foreground">Roster: </span>
        {t.roster.before} → {t.roster.after} (limit {t.roster.limit})
      </div>
    </div>
  );
}

export function TradePage() {
  const teams = useSim("transactionsView", { group: "Trades" }, useLeagueKey("trade-teams"));
  const { bump } = useSession();
  const [a, setA] = useState<TradeSide>({ teamId: "", players: [], picks: [] });
  const [b, setB] = useState<TradeSide>({ teamId: "", players: [], picks: [] });
  const [preview, setPreview] = useState<TradePreview | null>(null);
  const [answer, setAnswer] = useState<TradeAnswer | null>(null);
  const [done, setDone] = useState<string>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const list = teams.data?.teams ?? [];
  useEffect(() => {
    if (list.length >= 2 && !a.teamId) {
      setA({ teamId: list[0]!.id, players: [], picks: [] });
      setB({ teamId: list[1]!.id, players: [], picks: [] });
    }
  }, [list, a.teamId]);
  useEffect(() => {
    if (!a.teamId || !b.teamId) return;
    let live = true;
    call("previewTrade", { a, b }).then(
      (p) => live && setPreview(p),
      (e) => live && setError(String(e)),
    );
    const empty = a.players.length + a.picks.length + b.players.length + b.picks.length === 0;
    if (empty) setAnswer(null);
    else
      call("tradeAnswer", { a, b }).then(
        (x) => live && setAnswer(x),
        (e) => live && setError(String(e)),
      );
    return () => {
      live = false;
    };
  }, [a, b]);
  if (teams.error) return <ErrorNote message={teams.error} />;
  if (!teams.data || !a.teamId) return <Loading />;

  const confirm = async () => {
    setBusy(true);
    setError(undefined);
    try {
      const { message } = await call("makeTrade", { a, b });
      setDone(message);
      setA({ ...a, players: [], picks: [] });
      setB({ ...b, players: [], picks: [] });
      bump();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Trade builder"
        subtitle="Players and draft picks between two teams. In Simulation Mode the league office proposes for the left team; in GM Mode you do. The right team's GM decides, with his reasons."
      />
      {done && (
        <p className="rounded-md border border-primary/40 bg-accent p-3 text-sm">
          {done}{" "}
          <Link href="/transactions" className="underline">
            See the transactions log.
          </Link>
        </p>
      )}
      {error && <ErrorNote message={error} />}
      <div className="grid gap-4 md:grid-cols-2">
        <SidePicker
          teamId={a.teamId}
          setTeamId={(id) => setA({ teamId: id, players: [], picks: [] })}
          side={a}
          setSide={setA}
          teams={list}
        />
        <SidePicker
          teamId={b.teamId}
          setTeamId={(id) => setB({ teamId: id, players: [], picks: [] })}
          side={b}
          setSide={setB}
          teams={list}
        />
      </div>
      <OffersInbox teamId={a.teamId} />
      {preview && (
        <Card>
          <CardHeader>
            <CardTitle>Before you confirm</CardTitle>
            <CardDescription>
              Each player's remaining bonus money stays with his old team as dead money; his new
              team takes the rest of his contract (in the season, only the weeks still to be paid).
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <div className="grid gap-3 md:grid-cols-2">
              <TeamImpact t={preview.teams[0]} />
              <TeamImpact t={preview.teams[1]} />
            </div>
            {preview.problems.length > 0 && (
              <ul className="list-disc pl-5 text-sm text-destructive">
                {preview.problems.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            )}
            {answer && preview.legal && (
              <div
                className={`rounded-md border p-3 text-sm ${answer.accept ? "border-primary/40 bg-accent" : "border-destructive/40"}`}
              >
                <div className="font-medium">
                  {answer.accept ? `${b.teamId}'s GM says yes.` : `${b.teamId}'s GM says no.`}
                </div>
                <div className="text-muted-foreground">{answer.reason}</div>
                <div className="mt-2 grid gap-2 md:grid-cols-2">
                  <ValueList title={`What ${b.teamId} sees coming in`} items={answer.view.gets} />
                  <ValueList title={`What ${b.teamId} sees going out`} items={answer.view.gives} />
                </div>
                {!answer.accept && answer.counterText && (
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <span>{answer.counterText}</span>
                    {answer.counter && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          setA({
                            ...a,
                            players: [...a.players, ...answer.counter!.players],
                            picks: [...a.picks, ...answer.counter!.picks],
                          })
                        }
                      >
                        Add what they asked for
                      </Button>
                    )}
                  </div>
                )}
              </div>
            )}
            <div>
              <Button disabled={!preview.legal || busy || !answer?.accept} onClick={confirm}>
                Make this trade
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function ValueList({
  title,
  items,
}: {
  title: string;
  items: { label: string; value: number; why: string }[];
}) {
  return (
    <div>
      <div className="text-xs font-medium text-muted-foreground">{title}</div>
      {items.length === 0 && <div className="text-xs">Nothing.</div>}
      {items.map((x) => (
        <div key={x.label} className="text-xs">
          <span className="tabular-nums">{x.value.toFixed(1)}</span> {x.label}{" "}
          {x.why !== x.label && <span className="text-muted-foreground">({x.why})</span>}
        </div>
      ))}
    </div>
  );
}

/** Offers from AI teams to the left team, when a person answers its offers. */
function OffersInbox({ teamId }: { teamId: string }) {
  const view = useSim("tradeOffersView", { teamId }, useLeagueKey(`offers:${teamId}`));
  const { bump } = useSession();
  const [message, setMessage] = useState<string>();
  const [error, setError] = useState<string>();
  if (!view.data) return null;
  const { human, offers } = view.data;
  const act = async (fn: () => Promise<{ message: string }>) => {
    setError(undefined);
    try {
      setMessage((await fn()).message);
      bump();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  return (
    <Card>
      <CardHeader>
        <CardTitle>Offers to {teamId}</CardTitle>
        <CardDescription>
          {human
            ? "You answer this team's trade offers: AI teams send them here as they look for deals. Each expires after a week."
            : "This team's GM answers its own offers. Take them over to see AI teams' offers here."}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm">
        <div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => act(() => call("setController", { teamId, human: !human }))}
          >
            {human ? "Hand offers back to its GM" : "Answer this team's offers myself"}
          </Button>
        </div>
        {message && <p className="text-muted-foreground">{message}</p>}
        {error && <ErrorNote message={error} />}
        {human && offers.length === 0 && (
          <p className="text-muted-foreground">
            No offers yet. AI teams look for deals as days pass.
          </p>
        )}
        {offers.map((o) => (
          <div key={o.id} className="rounded-md border p-3">
            <div className="font-medium">
              From {o.from}: you get {o.get.join(", ") || "nothing"}; you give{" "}
              {o.give.join(", ") || "nothing"}.
            </div>
            <div className="text-xs text-muted-foreground">
              {o.reason} · {o.status === "open" ? `open until ${o.expires}` : o.status}
            </div>
            {o.status === "open" && (
              <div className="mt-2 flex gap-2">
                <Button
                  size="sm"
                  onClick={() => act(() => call("respondToOffer", { offerId: o.id, accept: true }))}
                >
                  Accept
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    act(() => call("respondToOffer", { offerId: o.id, accept: false }))
                  }
                >
                  Decline
                </Button>
              </div>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
