import { Copy, Download, FolderOpen, History, Plus, Shuffle, Trash2, Upload } from "lucide-react";
import { useRef, useState, type FormEvent } from "react";
import { useLocation } from "wouter";
import { ErrorNote, Loading, PageHeader } from "@/components/shared";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input, Label } from "@/components/ui/input";
import { formatLeagueDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useSession } from "@/lib/session";
import { call, useSim } from "@/sim/client";
import type { SavedLeague } from "@/sim/protocol";

function randomSeed(): number {
  // Choosing a seed is a UI convenience, not simulation logic, so browser randomness is fine here.
  return crypto.getRandomValues(new Uint32Array(1))[0]! % 1_000_000;
}

export function HomePage() {
  const leagues = useSim("listLeagues", {}, "list");
  const { league: openLeague, setLeague } = useSession();
  const [, navigate] = useLocation();
  const [creating, setCreating] = useState(false);
  const [toDelete, setToDelete] = useState<SavedLeague | null>(null);
  const [backupsOf, setBackupsOf] = useState<SavedLeague | null>(null);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  async function open(league: SavedLeague) {
    try {
      setLeague(await call("openLeague", { id: league.id }));
      navigate("/league");
    } catch (error) {
      setMessage({ kind: "error", text: (error as Error).message });
    }
  }

  async function exportLeague(league: SavedLeague) {
    try {
      const { fileName, bytes } = await call("exportLeague", { id: league.id });
      const url = URL.createObjectURL(
        new Blob([bytes as Uint8Array<ArrayBuffer>], { type: "application/gzip" }),
      );
      const link = document.createElement("a");
      link.href = url;
      link.download = fileName;
      link.click();
      URL.revokeObjectURL(url);
      setMessage({
        kind: "ok",
        text: `Exported ${fileName} (${(bytes.length / 1024).toFixed(0)} KB).`,
      });
    } catch (error) {
      setMessage({ kind: "error", text: (error as Error).message });
    }
  }

  async function importFile(file: File) {
    try {
      const saved = await call("importLeague", { bytes: new Uint8Array(await file.arrayBuffer()) });
      setMessage({
        kind: "ok",
        text: `Imported "${saved.name}" (fingerprint ${saved.fingerprint}).`,
      });
      leagues.reload();
    } catch (error) {
      setMessage({ kind: "error", text: (error as Error).message });
    }
  }

  async function saveCopy(league: SavedLeague) {
    try {
      const saved = await call("saveCopy", {
        name: `${league.name} (${formatLeagueDate(league.date)})`,
      });
      setMessage({
        kind: "ok",
        text: `Saved a copy: "${saved.name}". Your league carries on as before.`,
      });
      leagues.reload();
    } catch (error) {
      setMessage({ kind: "error", text: (error as Error).message });
    }
  }

  async function confirmDelete() {
    if (!toDelete) return;
    await call("deleteLeague", { id: toDelete.id });
    if (openLeague?.id === toDelete.id) setLeague(null);
    setMessage({ kind: "ok", text: `Deleted "${toDelete.name}".` });
    setToDelete(null);
    leagues.reload();
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Leagues"
        subtitle="Leagues are saved in this browser. Export one to keep a copy or move it."
      >
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => fileInput.current?.click()}>
            <Upload /> Import
          </Button>
          <Button onClick={() => setCreating(true)}>
            <Plus /> New league
          </Button>
        </div>
      </PageHeader>
      <input
        ref={fileInput}
        type="file"
        accept=".fgmleague,application/gzip"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void importFile(file);
          e.target.value = "";
        }}
      />

      {message && (
        <p
          className={
            message.kind === "error" ? "text-sm text-destructive" : "text-sm text-muted-foreground"
          }
          role="status"
        >
          {message.text}
        </p>
      )}

      {leagues.loading && !leagues.data && <Loading what="Loading saved leagues" />}
      {leagues.error && <ErrorNote message={leagues.error} />}
      {leagues.data?.length === 0 && (
        <Card>
          <CardHeader>
            <CardTitle>No leagues yet</CardTitle>
            <CardDescription>
              Create a fictional league: 32 teams with full 90-man offseason rosters, coaching
              staffs, and draft picks. If the real-league file has been built on this computer, you
              can start from it instead.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button onClick={() => setCreating(true)}>
              <Plus /> New league
            </Button>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-3 md:grid-cols-2">
        {leagues.data?.map((league) => (
          <Card key={league.id}>
            <CardHeader>
              <CardTitle>{league.name}</CardTitle>
              <CardDescription>
                {league.kind === "fictional" ? "Fictional league" : "Real league"} ·{" "}
                {formatLeagueDate(league.date)} · {league.teamCount} teams ·{" "}
                {league.playerCount.toLocaleString()} players
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <p className="text-xs text-muted-foreground">
                Seed {league.seed} · fingerprint{" "}
                <span className="font-mono">{league.fingerprint}</span>
              </p>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" onClick={() => void open(league)}>
                  <FolderOpen /> Open
                </Button>
                <Button size="sm" variant="outline" onClick={() => void exportLeague(league)}>
                  <Download /> Export
                </Button>
                {openLeague?.id === league.id && (
                  <Button size="sm" variant="outline" onClick={() => void saveCopy(league)}>
                    <Copy /> Save a copy
                  </Button>
                )}
                <Button size="sm" variant="outline" onClick={() => setBackupsOf(league)}>
                  <History /> Backups
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setToDelete(league)}
                  aria-label={`Delete ${league.name}`}
                >
                  <Trash2 /> Delete
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <BackupsDialog
        league={backupsOf}
        onClose={() => setBackupsOf(null)}
        onRestored={(saved) => {
          setBackupsOf(null);
          setMessage({ kind: "ok", text: `Restored as "${saved.name}".` });
          leagues.reload();
        }}
      />

      <NewLeagueDialog
        open={creating}
        onOpenChange={setCreating}
        onCreated={(saved, mode) => {
          setLeague(saved);
          // A real league opens on "where things stand"; GM Mode's first stop is still the career page.
          navigate(mode === "gm" ? "/career/start" : saved.kind === "real" ? "/start" : "/league");
        }}
      />

      <Dialog open={toDelete !== null} onOpenChange={(o) => !o && setToDelete(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete "{toDelete?.name}"?</DialogTitle>
            <DialogDescription>
              This removes the league from this browser. Export it first if you want a copy.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setToDelete(null)}>
              Keep it
            </Button>
            <Button onClick={() => void confirmDelete()}>Delete league</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function NewLeagueDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (league: SavedLeague, mode: "gm" | "simulation") => void;
}) {
  const [name, setName] = useState("My League");
  const [seed, setSeed] = useState(() => String(randomSeed()));
  const [kind, setKind] = useState<"fictional" | "real">("fictional");
  const [mode, setMode] = useState<"gm" | "simulation">("gm");
  const realAvailable = useSim("realLeagueAvailable", {}, String(open)).data ?? false;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const seedNumber = Number(seed);
    if (!Number.isInteger(seedNumber) || seedNumber < 0) {
      setError("The seed must be a whole number (0 or more).");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const saved = await call("createLeague", { name, seed: seedNumber, kind });
      onOpenChange(false);
      onCreated(saved, mode);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={(e) => void submit(e)} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>New league</DialogTitle>
            <DialogDescription>
              The same seed always plays out the same way. Every team and person in the game is
              fictional.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2" role="radiogroup" aria-label="Kind of league">
            {(
              [
                {
                  value: "fictional",
                  title: "Fictional league",
                  text: "32 generated teams, built from the seed.",
                  disabled: false,
                },
                {
                  value: "real",
                  title: "Real league (2026)",
                  text: realAvailable
                    ? "The real league as it stood after the 2025 season, every name fictional."
                    : "Not built on this computer yet. Build it with: npm run pipeline -- league",
                  disabled: !realAvailable,
                },
              ] as const
            ).map((option) => (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={kind === option.value}
                disabled={option.disabled}
                onClick={() => setKind(option.value)}
                className={cn(
                  "rounded-lg border p-3 text-left text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-60",
                  kind === option.value ? "border-primary bg-primary/10" : "hover:bg-accent",
                )}
              >
                <div className="font-medium">{option.title}</div>
                <div className="text-xs text-muted-foreground">{option.text}</div>
              </button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Mode">
            {(
              [
                { value: "gm", title: "GM Mode", text: "Run one team. Your owner is watching." },
                {
                  value: "simulation",
                  title: "Simulation Mode",
                  text: "All 32 teams run themselves. Watch and tinker.",
                },
              ] as const
            ).map((option) => (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={mode === option.value}
                onClick={() => setMode(option.value)}
                className={cn(
                  "rounded-lg border p-3 text-left text-sm transition-colors",
                  mode === option.value ? "border-primary bg-primary/10" : "hover:bg-accent",
                )}
              >
                <div className="font-medium">{option.title}</div>
                <div className="text-xs text-muted-foreground">{option.text}</div>
              </button>
            ))}
          </div>
          <div className="grid gap-2">
            <Label htmlFor="league-name">League name</Label>
            <Input
              id="league-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={60}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="league-seed">Seed</Label>
            <div className="flex gap-2">
              <Input
                id="league-seed"
                value={seed}
                onChange={(e) => setSeed(e.target.value)}
                inputMode="numeric"
              />
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={() => setSeed(String(randomSeed()))}
                aria-label="Random seed"
              >
                <Shuffle />
              </Button>
            </div>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="submit" disabled={busy}>
              {busy ? "Building league…" : "Create league"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** A league's season backups (kept automatically as each season begins): restore one as a copy. */
function BackupsDialog({
  league,
  onClose,
  onRestored,
}: {
  league: SavedLeague | null;
  onClose: () => void;
  onRestored: (saved: SavedLeague) => void;
}) {
  const backups = useSim("listBackups", { id: league?.id ?? "" }, `backups:${league?.id ?? ""}`);
  const [error, setError] = useState<string | null>(null);
  async function restore(season: number) {
    if (!league) return;
    try {
      onRestored(await call("restoreBackup", { id: league.id, season }));
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <Dialog open={league !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Backups of {league?.name}</DialogTitle>
          <DialogDescription>
            Kept automatically the first time each recent season is saved. Restoring makes a new
            league in the list; this one stays as it is.
          </DialogDescription>
        </DialogHeader>
        {backups.data && backups.data.length === 0 && (
          <p className="text-sm text-muted-foreground">
            None yet: the first is kept when the next season begins.
          </p>
        )}
        <div className="flex flex-col divide-y">
          {backups.data?.map((b) => (
            <div key={b.season} className="flex items-center justify-between gap-3 py-2 text-sm">
              <span>
                {b.season} season · {formatLeagueDate(b.date)}
              </span>
              <Button size="sm" variant="outline" onClick={() => void restore(b.season)}>
                Restore as a copy
              </Button>
            </div>
          ))}
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
      </DialogContent>
    </Dialog>
  );
}
