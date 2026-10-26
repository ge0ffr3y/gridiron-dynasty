import { RngStreams } from "@fgm/foundation";
import {
  ArrowLeftRight,
  FastForward,
  BookOpen,
  CalendarClock,
  Dumbbell,
  FlaskConical,
  Info,
  HeartPulse,
  TrendingUp,
  BriefcaseBusiness,
  ScrollText,
  CalendarDays,
  ClipboardList,
  FolderOpen,
  Handshake,
  Inbox,
  Award,
  Newspaper,
  UserRound,
  BookA,
  Home,
  ListOrdered,
  Medal,
  Moon,
  Shield,
  Sun,
  Trophy,
  Users,
  type LucideIcon,
} from "lucide-react";
import { lazy, Suspense, useRef, type ReactNode } from "react";
import { Link, Route, Router, Switch, useLocation } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { SimControls } from "@/components/SimControls";
import { Loading } from "@/components/shared";
import { Button } from "@/components/ui/button";
import { SessionProvider, useLeagueKey, useSession } from "@/lib/session";
import { useRouteAnnouncer } from "@/lib/routeAnnouncer";
import { useTheme } from "@/lib/theme";
import { cn } from "@/lib/utils";
import { Select } from "@/components/ui/input";
import { HomePage } from "@/pages/HomePage";
import { call, useSim } from "@/sim/client";

// Pages load when first visited, so the first screen's download stays small.
const CalendarPage = lazy(() =>
  import("@/pages/CalendarPage").then((m) => ({ default: m.CalendarPage })),
);
const NewsPage = lazy(() => import("@/pages/HistoryPages").then((m) => ({ default: m.NewsPage })));
const RecordsPage = lazy(() =>
  import("@/pages/HistoryPages").then((m) => ({ default: m.RecordsPage })),
);
const SeasonPage = lazy(() =>
  import("@/pages/HistoryPages").then((m) => ({ default: m.SeasonPage })),
);
const CareerPage = lazy(() =>
  import("@/pages/CareerPages").then((m) => ({ default: m.CareerPage })),
);
const GlossaryPage = lazy(() =>
  import("@/pages/CareerPages").then((m) => ({ default: m.GlossaryPage })),
);
const InboxPage = lazy(() => import("@/pages/CareerPages").then((m) => ({ default: m.InboxPage })));
const StartCareerPage = lazy(() =>
  import("@/pages/CareerPages").then((m) => ({ default: m.StartCareerPage })),
);
const CampPage = lazy(() => import("@/pages/CampPage").then((m) => ({ default: m.CampPage })));
const DraftPage = lazy(() => import("@/pages/DraftPage").then((m) => ({ default: m.DraftPage })));
const FreeAgencyPage = lazy(() =>
  import("@/pages/FreeAgencyPage").then((m) => ({ default: m.FreeAgencyPage })),
);
const NegotiationPage = lazy(() =>
  import("@/pages/NegotiationPage").then((m) => ({ default: m.NegotiationPage })),
);
const ProspectPage = lazy(() =>
  import("@/pages/ProspectPage").then((m) => ({ default: m.ProspectPage })),
);
const CoachingPage = lazy(() =>
  import("@/pages/CoachingPage").then((m) => ({ default: m.CoachingPage })),
);
const DevelopmentPage = lazy(() =>
  import("@/pages/DevelopmentPage").then((m) => ({ default: m.DevelopmentPage })),
);
const InjuriesPage = lazy(() =>
  import("@/pages/InjuriesPage").then((m) => ({ default: m.InjuriesPage })),
);
const CoachPage = lazy(() => import("@/pages/CoachPage").then((m) => ({ default: m.CoachPage })));
const TradePage = lazy(() => import("@/pages/TradePage").then((m) => ({ default: m.TradePage })));
const SimulationPage = lazy(() =>
  import("@/pages/SimulationPage").then((m) => ({ default: m.SimulationPage })),
);
const ExecutivePage = lazy(() =>
  import("@/pages/ExecutivePage").then((m) => ({ default: m.ExecutivePage })),
);
const TransactionsPage = lazy(() =>
  import("@/pages/TransactionsPage").then((m) => ({ default: m.TransactionsPage })),
);
const GamePage = lazy(() => import("@/pages/GamePage").then((m) => ({ default: m.GamePage })));
const DayOnePage = lazy(() =>
  import("@/pages/DayOnePage").then((m) => ({ default: m.DayOnePage })),
);
const AboutPage = lazy(() => import("@/pages/AboutPage").then((m) => ({ default: m.AboutPage })));
const ExperimentPage = lazy(() =>
  import("@/pages/ExperimentsPage").then((m) => ({ default: m.ExperimentPage })),
);
const ExperimentsPage = lazy(() =>
  import("@/pages/ExperimentsPage").then((m) => ({ default: m.ExperimentsPage })),
);
const HistoryPage = lazy(() =>
  import("@/pages/HistoryPage").then((m) => ({ default: m.HistoryPage })),
);
const LeaguePage = lazy(() =>
  import("@/pages/LeaguePage").then((m) => ({ default: m.LeaguePage })),
);
const LeadersPage = lazy(() =>
  import("@/pages/LeadersPage").then((m) => ({ default: m.LeadersPage })),
);
const PlayerPage = lazy(() =>
  import("@/pages/PlayerPage").then((m) => ({ default: m.PlayerPage })),
);
const PlayersPage = lazy(() =>
  import("@/pages/PlayersPage").then((m) => ({ default: m.PlayersPage })),
);
const PlayoffsPage = lazy(() =>
  import("@/pages/PlayoffsPage").then((m) => ({ default: m.PlayoffsPage })),
);
const SchedulePage = lazy(() =>
  import("@/pages/SchedulePage").then((m) => ({ default: m.SchedulePage })),
);
const StandingsPage = lazy(() =>
  import("@/pages/StandingsPage").then((m) => ({ default: m.StandingsPage })),
);
const TeamPage = lazy(() => import("@/pages/TeamPage").then((m) => ({ default: m.TeamPage })));
const TeamsPage = lazy(() => import("@/pages/TeamsPage").then((m) => ({ default: m.TeamsPage })));

type NavItem = {
  label: string;
  icon: LucideIcon;
  href?: string;
  needsLeague?: boolean;
};

const NAV: NavItem[] = [
  { label: "Leagues", icon: FolderOpen, href: "/" },
  { label: "Experiments", icon: FlaskConical, href: "/experiments" },
  { label: "League", icon: Home, href: "/league", needsLeague: true },
  { label: "Inbox", icon: Inbox, href: "/inbox", needsLeague: true },
  { label: "Career", icon: UserRound, href: "/career", needsLeague: true },
  { label: "Teams", icon: Shield, href: "/teams", needsLeague: true },
  { label: "Players", icon: Users, href: "/players", needsLeague: true },
  { label: "Schedule", icon: CalendarDays, href: "/schedule", needsLeague: true },
  { label: "Standings", icon: ListOrdered, href: "/standings", needsLeague: true },
  { label: "Leaders", icon: Medal, href: "/leaders", needsLeague: true },
  { label: "Playoffs", icon: Trophy, href: "/playoffs", needsLeague: true },
  { label: "History", icon: BookOpen, href: "/history", needsLeague: true },
  { label: "Records", icon: Award, href: "/records", needsLeague: true },
  { label: "Newsfeed", icon: Newspaper, href: "/news", needsLeague: true },
  { label: "Calendar", icon: CalendarClock, href: "/calendar", needsLeague: true },
  { label: "Transactions", icon: ScrollText, href: "/transactions", needsLeague: true },
  { label: "Trades", icon: ArrowLeftRight, href: "/trade", needsLeague: true },
  { label: "Simulation", icon: FastForward, href: "/simulation", needsLeague: true },
  { label: "Training camp", icon: Dumbbell, href: "/camp", needsLeague: true },
  { label: "Injuries", icon: HeartPulse, href: "/injuries", needsLeague: true },
  { label: "Development", icon: TrendingUp, href: "/development", needsLeague: true },
  { label: "Coaching", icon: BriefcaseBusiness, href: "/coaching", needsLeague: true },
  { label: "Draft", icon: ClipboardList, href: "/draft", needsLeague: true },
  { label: "Free agency", icon: Handshake, href: "/free-agency", needsLeague: true },
  { label: "Glossary", icon: BookA, href: "/glossary", needsLeague: true },
  { label: "About", icon: Info, href: "/about" },
];

export function App() {
  return (
    <SessionProvider>
      <Router hook={useHashLocation}>
        <Shell />
      </Router>
    </SessionProvider>
  );
}

function Shell() {
  const [theme, toggleTheme] = useTheme();
  const { league } = useSession();
  const main = useRef<HTMLElement>(null);
  useRouteAnnouncer(main);

  return (
    <div className="flex min-h-svh">
      <button
        type="button"
        onClick={() => main.current?.focus()}
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-md focus:border focus:bg-background focus:px-3 focus:py-2 focus:text-sm focus:shadow-md"
      >
        Skip to main content
      </button>
      <aside className="hidden w-56 shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground md:flex">
        <div className="px-5 py-4 text-sm font-semibold tracking-tight">Gridiron Dynasty</div>
        <nav aria-label="Main" className="flex flex-col gap-0.5 px-2">
          {NAV.map((item) => (
            <NavButton key={item.label} item={item} leagueOpen={league !== null} />
          ))}
        </nav>
        <WorkerStatus />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between gap-4 border-b px-4 py-3 md:px-6">
          <div className="truncate text-lg font-semibold tracking-tight">
            {league ? (
              <Link href="/league" className="hover:underline">
                {league.name}
              </Link>
            ) : (
              "Gridiron Dynasty"
            )}
          </div>
          <div className="flex items-center gap-2">
            {league && <ViewingAsSwitch />}
            <Button
              variant="ghost"
              size="icon"
              onClick={toggleTheme}
              aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
            >
              {theme === "dark" ? <Sun /> : <Moon />}
            </Button>
          </div>
        </header>
        {league && (
          <section aria-label="Simulation controls" className="border-b px-4 py-2 md:px-6">
            <SimControls />
          </section>
        )}

        <nav
          aria-label="Main"
          className="flex gap-1 overflow-x-auto border-b px-2 py-2 [mask-image:linear-gradient(to_right,transparent,black_12px,black_calc(100%-24px),transparent)] md:hidden"
        >
          {NAV.filter((item) => item.href).map((item) => (
            <NavButton key={item.label} item={item} leagueOpen={league !== null} compact />
          ))}
        </nav>

        <main
          ref={main}
          id="main-content"
          tabIndex={-1}
          className="mx-auto w-full max-w-6xl p-4 outline-none md:p-6"
        >
          <Suspense fallback={<Loading />}>
            <Switch>
              <Route path="/" component={HomePage} />
              <Route path="/league">
                <NeedsLeague>
                  <LeaguePage />
                </NeedsLeague>
              </Route>
              <Route path="/teams">
                <NeedsLeague>
                  <TeamsPage />
                </NeedsLeague>
              </Route>
              <Route path="/team/:id">
                {(params) => (
                  <NeedsLeague>
                    <TeamPage teamId={params.id} />
                  </NeedsLeague>
                )}
              </Route>
              <Route path="/schedule">
                <NeedsLeague>
                  <SchedulePage />
                </NeedsLeague>
              </Route>
              <Route path="/standings">
                <NeedsLeague>
                  <StandingsPage />
                </NeedsLeague>
              </Route>
              <Route path="/leaders">
                <NeedsLeague>
                  <LeadersPage />
                </NeedsLeague>
              </Route>
              <Route path="/playoffs">
                <NeedsLeague>
                  <PlayoffsPage />
                </NeedsLeague>
              </Route>
              <Route path="/calendar">
                <NeedsLeague>
                  <CalendarPage />
                </NeedsLeague>
              </Route>
              <Route path="/transactions">
                <NeedsLeague>
                  <TransactionsPage />
                </NeedsLeague>
              </Route>
              <Route path="/trade">
                <NeedsLeague>
                  <TradePage />
                </NeedsLeague>
              </Route>
              <Route path="/camp">
                <NeedsLeague>
                  <CampPage />
                </NeedsLeague>
              </Route>
              <Route path="/injuries">
                <NeedsLeague>
                  <InjuriesPage />
                </NeedsLeague>
              </Route>
              <Route path="/coaching">
                <NeedsLeague>
                  <CoachingPage />
                </NeedsLeague>
              </Route>
              <Route path="/development">
                <NeedsLeague>
                  <DevelopmentPage />
                </NeedsLeague>
              </Route>
              <Route path="/about">
                <AboutPage />
              </Route>
              <Route path="/experiments">
                <ExperimentsPage />
              </Route>
              <Route path="/experiments/:id">{(params) => <ExperimentPage id={params.id} />}</Route>
              <Route path="/start">
                <NeedsLeague>
                  <DayOnePage />
                </NeedsLeague>
              </Route>
              <Route path="/history">
                <NeedsLeague>
                  <HistoryPage />
                </NeedsLeague>
              </Route>
              <Route path="/game/:id/watch">
                {(params) => (
                  <NeedsLeague>
                    <GamePage gameId={Number(params.id)} watch />
                  </NeedsLeague>
                )}
              </Route>
              <Route path="/game/:id">
                {(params) => (
                  <NeedsLeague>
                    <GamePage gameId={Number(params.id)} />
                  </NeedsLeague>
                )}
              </Route>
              <Route path="/free-agency">
                <NeedsLeague>
                  <FreeAgencyPage />
                </NeedsLeague>
              </Route>
              <Route path="/negotiate/:id">
                {(params) => (
                  <NeedsLeague>
                    <NegotiationPage playerId={Number(params.id)} />
                  </NeedsLeague>
                )}
              </Route>
              <Route path="/draft">
                <NeedsLeague>
                  <DraftPage />
                </NeedsLeague>
              </Route>
              <Route path="/prospect/:id">
                {(params) => (
                  <NeedsLeague>
                    <ProspectPage prospectId={Number(params.id)} />
                  </NeedsLeague>
                )}
              </Route>
              <Route path="/players">
                <NeedsLeague>
                  <PlayersPage />
                </NeedsLeague>
              </Route>
              <Route path="/player/:id">
                {(params) => (
                  <NeedsLeague>
                    <PlayerPage playerId={Number(params.id)} />
                  </NeedsLeague>
                )}
              </Route>
              <Route path="/simulation">
                <NeedsLeague>
                  <SimulationPage />
                </NeedsLeague>
              </Route>
              <Route path="/executive/:id">
                {(params) => (
                  <NeedsLeague>
                    <ExecutivePage id={Number(params.id)} />
                  </NeedsLeague>
                )}
              </Route>
              <Route path="/inbox">
                <NeedsLeague>
                  <InboxPage />
                </NeedsLeague>
              </Route>
              <Route path="/season/:year">
                {(params) => (
                  <NeedsLeague>
                    <SeasonPage season={Number(params.year)} />
                  </NeedsLeague>
                )}
              </Route>
              <Route path="/records/:scope?">
                {(params) => (
                  <NeedsLeague>
                    <RecordsPage scope={params.scope} />
                  </NeedsLeague>
                )}
              </Route>
              <Route path="/news">
                <NeedsLeague>
                  <NewsPage />
                </NeedsLeague>
              </Route>
              <Route path="/career">
                <NeedsLeague>
                  <CareerPage />
                </NeedsLeague>
              </Route>
              <Route path="/glossary">
                <NeedsLeague>
                  <GlossaryPage />
                </NeedsLeague>
              </Route>
              <Route path="/career/start">
                <NeedsLeague>
                  <StartCareerPage />
                </NeedsLeague>
              </Route>
              <Route path="/coach/:id">
                {(params) => (
                  <NeedsLeague>
                    <CoachPage coachId={Number(params.id)} />
                  </NeedsLeague>
                )}
              </Route>
              <Route>
                <p className="text-sm text-muted-foreground">
                  Page not found.{" "}
                  <Link href="/" className="underline">
                    Back to leagues
                  </Link>
                </p>
              </Route>
            </Switch>
          </Suspense>
        </main>
      </div>
    </div>
  );
}

/** Pages that show a league wait for it to reopen after a reload, or point back to the league list. */
function NeedsLeague({ children }: { children: ReactNode }) {
  const { league, restoring } = useSession();
  if (restoring) return <Loading what="Reopening your league" />;
  if (!league) {
    return (
      <p className="text-sm text-muted-foreground">
        No league is open.{" "}
        <Link href="/" className="underline">
          Open or create one
        </Link>
        .
      </p>
    );
  }
  return <>{children}</>;
}

function NavButton({
  item,
  leagueOpen,
  compact,
}: {
  item: NavItem;
  leagueOpen: boolean;
  compact?: boolean;
}) {
  const [location] = useLocation();
  const Icon = item.icon;
  const disabled = !item.href || (item.needsLeague && !leagueOpen);
  const active =
    item.href !== undefined &&
    (item.href === "/" ? location === "/" : location.startsWith(item.href));
  const className = cn(
    "flex min-h-10 shrink-0 items-center gap-2 rounded-md px-3 py-2 text-sm md:min-h-0",
    active ? "bg-accent font-medium text-accent-foreground" : "text-muted-foreground",
    disabled ? "cursor-not-allowed opacity-60" : "hover:bg-accent",
  );
  const content = (
    <>
      <Icon className="size-4" />
      <span>{item.label}</span>
    </>
  );
  if (disabled) {
    return (
      <span className={className} aria-disabled="true" title="Open a league first">
        {content}
        <span className="sr-only"> (open a league first)</span>
      </span>
    );
  }
  return (
    <Link href={item.href!} className={className} aria-current={active ? "page" : undefined}>
      {content}
    </Link>
  );
}

const HELLO_SEED = 42;

/** Shows that the background worker answers and agrees with the page on seeded numbers. */
function WorkerStatus() {
  const hello = useSim("hello", { seed: HELLO_SEED }, "hello");
  let text = "Sim worker: starting…";
  if (hello.error) text = `Sim worker: failed (${hello.error})`;
  else if (hello.data) {
    const stream = new RngStreams(HELLO_SEED).get("league");
    const agree = hello.data.sample.every((n) => n === stream.nextUint32());
    text = agree ? "Sim worker: ready" : "Sim worker: MISMATCH";
  }
  return (
    <div className="mt-auto px-5 py-4 text-xs text-muted-foreground" data-testid="worker-status">
      {text}
      {hello.data && <div>sim-core {hello.data.simCoreVersion}</div>}
    </div>
  );
}

/**
 * Whose eyes the screens see through (Phase 11): the league office's consensus, or any team's
 * scouts. Every rating on every screen is that staff's read, never the truth.
 */
function ViewingAsSwitch() {
  const { bump } = useSession();
  const options = useSim("viewingOptions", {}, useLeagueKey());
  if (!options.data) return null;
  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="hidden text-muted-foreground sm:inline">Viewing as</span>
      <Select
        value={options.data.current ?? ""}
        aria-label="Viewing as"
        className="max-w-48"
        onChange={(e) => {
          void call("setViewingAs", { teamId: e.target.value || null }).then(bump);
        }}
      >
        <option value="">League office (consensus)</option>
        {options.data.teams.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name}
          </option>
        ))}
      </Select>
    </label>
  );
}
