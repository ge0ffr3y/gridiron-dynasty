/**
 * The header's sim buttons: where we are in the season and what to do next.
 */
import { Inbox, Loader2, Play } from "lucide-react";
import { Link } from "wouter";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { formatLeagueDate } from "@/lib/format";
import { useLeagueKey, useSession } from "@/lib/session";
import { call, useSim } from "@/sim/client";
import type { SimActionId } from "@fgm/sim-core";

export function SimControls() {
  const { bump } = useSession();
  const calendar = useSim("calendar", {}, useLeagueKey());
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(action: SimActionId) {
    setBusy("Simulating…");
    setError(null);
    try {
      await call("simAction", { action }, (label) => setBusy(label));
      bump();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const c = calendar.data;
  if (!c) return null;
  const [primary, ...others] = c.actions;

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      <div className="mr-1 text-sm leading-tight">
        <div className="font-medium">
          {c.season} · {c.label}
        </div>
        <div className="text-xs text-muted-foreground">{formatLeagueDate(c.date)}</div>
      </div>
      {busy ? (
        <span className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
          <Loader2 className="size-4 animate-spin" /> {busy}
        </span>
      ) : (
        <>
          {primary && (
            <Button size="sm" onClick={() => void run(primary.id)}>
              <Play /> {primary.label}
            </Button>
          )}
          {others.map((a) => (
            <Button key={a.id} size="sm" variant="outline" onClick={() => void run(a.id)}>
              {a.label}
            </Button>
          ))}
        </>
      )}
      {c.inbox && (
        <Link
          href="/inbox"
          className="ml-auto flex items-center gap-1.5 rounded-md border px-2 py-1 text-sm hover:bg-accent"
          title={
            c.inbox.due > 0
              ? "Due now: if you sim on, your staff decide these for you."
              : "Decisions waiting for you"
          }
        >
          <Inbox className="size-4" /> Inbox {c.inbox.open}
          {c.inbox.due > 0 && (
            <span className="rounded bg-destructive px-1.5 text-xs text-white">
              {c.inbox.due} due
            </span>
          )}
        </Link>
      )}
      {error && <span className="text-sm text-destructive">{error}</span>}
    </div>
  );
}
