import {
  Activity,
  BookOpen,
  CalendarDays,
  ClipboardList,
  Handshake,
  Home,
  Moon,
  Shield,
  Sun,
  Trophy,
  Users,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useTheme } from "@/lib/theme";
import { cn } from "@/lib/utils";
import { useSimWorker, type WorkerStatus } from "@/sim/useSimWorker";

type NavItem = { label: string; icon: LucideIcon; phase?: number };

// Screens arrive phase by phase (see docs/roadmap.md); until then they show which phase builds them.
const NAV: NavItem[] = [
  { label: "League", icon: Home },
  { label: "Teams", icon: Shield, phase: 1 },
  { label: "Players", icon: Users, phase: 1 },
  { label: "Schedule", icon: CalendarDays, phase: 2 },
  { label: "Standings", icon: Trophy, phase: 2 },
  { label: "Games", icon: Activity, phase: 3 },
  { label: "Free agency", icon: Handshake, phase: 12 },
  { label: "Draft", icon: ClipboardList, phase: 11 },
  { label: "History", icon: BookOpen, phase: 15 },
];

export function App() {
  const [theme, toggleTheme] = useTheme();
  const worker = useSimWorker();

  return (
    <div className="flex min-h-svh">
      <aside className="hidden w-56 shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground md:flex">
        <div className="px-5 py-4 text-sm font-semibold tracking-tight">FootballGM Sim</div>
        <nav className="flex flex-col gap-0.5 px-2">
          {NAV.map((item) => (
            <NavButton key={item.label} item={item} active={item.label === "League"} />
          ))}
        </nav>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between gap-4 border-b px-4 py-3 md:px-6">
          <h1 className="text-lg font-semibold tracking-tight">FootballGM Sim</h1>
          <Button
            variant="ghost"
            size="icon"
            onClick={toggleTheme}
            aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
          >
            {theme === "dark" ? <Sun /> : <Moon />}
          </Button>
        </header>

        <nav className="flex gap-1 overflow-x-auto border-b px-2 py-2 md:hidden">
          {NAV.map((item) => (
            <NavButton key={item.label} item={item} active={item.label === "League"} compact />
          ))}
        </nav>

        <main className="mx-auto grid w-full max-w-5xl gap-4 p-4 md:grid-cols-3 md:p-6">
          <Card className="md:col-span-2">
            <CardHeader>
              <CardTitle className="text-xl">No league yet</CardTitle>
              <CardDescription>
                A pro football league that starts from the real league after the 2025 season, with
                every name made fictional.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-2">
              <ModeTile
                title="GM Mode"
                text="Take over one franchise: hire coaches, work the cap, sign, trade, and draft. Win, or get fired."
              />
              <ModeTile
                title="Simulation Mode"
                text="Hand all 32 teams to AI front offices and fast-forward a season or a century."
              />
              <div className="sm:col-span-2">
                <Button disabled>New league (arrives in Phase 1)</Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Engine status</CardTitle>
              <CardDescription>The simulation runs in a background worker.</CardDescription>
            </CardHeader>
            <CardContent>
              <WorkerStatusPanel status={worker} />
            </CardContent>
          </Card>
        </main>
      </div>
    </div>
  );
}

function NavButton({
  item,
  active,
  compact,
}: {
  item: NavItem;
  active: boolean;
  compact?: boolean;
}) {
  const Icon = item.icon;
  const disabled = item.phase !== undefined;
  return (
    <button
      type="button"
      disabled={disabled}
      title={disabled ? `Built in roadmap Phase ${item.phase}` : undefined}
      className={cn(
        "flex shrink-0 items-center gap-2 rounded-md px-3 py-2 text-sm",
        active ? "bg-accent font-medium text-accent-foreground" : "text-muted-foreground",
        disabled ? "cursor-not-allowed opacity-60" : "hover:bg-accent",
      )}
    >
      <Icon className="size-4" />
      <span>{item.label}</span>
      {disabled && !compact && <span className="ml-auto text-xs">P{item.phase}</span>}
    </button>
  );
}

function ModeTile({ title, text }: { title: string; text: string }) {
  return (
    <div className="rounded-lg border bg-muted/40 p-4">
      <div className="font-medium">{title}</div>
      <p className="mt-1 text-sm text-muted-foreground">{text}</p>
    </div>
  );
}

function WorkerStatusPanel({ status }: { status: WorkerStatus }) {
  if (status.state === "starting")
    return <p className="text-sm text-muted-foreground">Sim worker: starting…</p>;
  if (status.state === "error") {
    return <p className="text-sm text-destructive">Sim worker: failed ({status.message})</p>;
  }
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
      <dt className="text-muted-foreground">Sim worker</dt>
      <dd className="font-medium text-primary" data-testid="worker-status">
        ready
      </dd>
      <dt className="text-muted-foreground">Determinism</dt>
      <dd>{status.deterministic ? "page and worker agree" : "MISMATCH"}</dd>
      <dt className="text-muted-foreground">sim-core</dt>
      <dd>{status.simCoreVersion}</dd>
      <dt className="text-muted-foreground">game-engine</dt>
      <dd>{status.gameEngineVersion}</dd>
    </dl>
  );
}
