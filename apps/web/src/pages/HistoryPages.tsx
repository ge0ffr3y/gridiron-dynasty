/**
 * Season recaps, the record book and the newsfeed (Phase 15).
 */
import { Link, useLocation } from "wouter";
import { ErrorNote, Loading, PageHeader } from "@/components/shared";
import { Select } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatLeagueDate } from "@/lib/format";
import { useLeagueKey } from "@/lib/session";
import { useSim } from "@/sim/client";
import type { NewsView, TreeNode } from "@fgm/sim-core";

const player = (id: number | null, text: string) =>
  id !== null ? (
    <Link href={`/player/${id}`} className="hover:underline">
      {text}
    </Link>
  ) : (
    <>{text}</>
  );

const ROUNDS: Record<string, string> = {
  wildcard: "Wild card",
  divisional: "Divisional",
  conference: "Conference",
  championship: "Championship",
};

/** One season's recap. */
export function SeasonPage({ season }: { season?: number }) {
  const [, navigate] = useLocation();
  const view = useSim("seasonRecapView", { season }, useLeagueKey(`recap:${season}`));
  if (view.error) return <ErrorNote message={view.error} />;
  if (!view.data) return <Loading />;
  const v = view.data;
  const big = v.awards.filter((a) => a.place === 1);
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={`The ${v.season} season`}
        subtitle={
          v.champion
            ? `${v.champion.name} beat ${v.runnerUp?.name ?? "the field"}${v.score ? ` ${v.score}` : ""}.`
            : "Not finished."
        }
      >
        <Select
          value={v.season}
          onChange={(e) => navigate(`/season/${e.target.value}`)}
          aria-label="Season"
          className="w-28"
        >
          {v.seasons.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </Select>
      </PageHeader>

      {big.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Awards</CardTitle>
            <CardDescription>The winners, with the runners-up in the vote.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 text-sm">
            {big.map((a) => {
              const rest = v.awards.filter((x) => x.award === a.award && x.place > 1);
              return (
                <div key={a.award}>
                  <div className="font-medium">{a.label}</div>
                  <div>
                    {player(a.playerId, a.name)}{" "}
                    <span className="text-xs text-muted-foreground">
                      {a.position} · {a.team}
                      {a.share !== null ? ` · ${Math.round(a.share * 50)} of 50 votes` : ""}
                    </span>
                  </div>
                  <div className="text-xs text-muted-foreground">{a.reason}</div>
                  {rest.length > 0 && (
                    <div className="text-xs text-muted-foreground">
                      Next: {rest.map((r) => `${r.name} (${r.team})`).join("; ")}
                    </div>
                  )}
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      {v.recordsBroken.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Records broken</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-1 text-sm">
            {v.recordsBroken.map((r, i) => (
              <div key={i}>
                <span className="font-medium">{r.name}</span> now holds the {r.scope} {r.level}{" "}
                record for {r.stat} ({r.value.toLocaleString()}), past {r.previous}.
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="py-2">
          <CardHeader>
            <CardTitle>Standings</CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto px-2">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Team</TableHead>
                  <TableHead className="text-right">Record</TableHead>
                  <TableHead className="text-right">PF-PA</TableHead>
                  <TableHead>Result</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {v.standings.map((s) => (
                  <TableRow key={s.teamId}>
                    <TableCell>
                      <Link href={`/team/${s.teamId}`} className="hover:underline">
                        {s.name}
                      </Link>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{s.record}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {s.pointsFor}-{s.pointsAgainst}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {s.seed ? `#${s.seed} seed` : ""}
                      {s.exit && s.exit !== "missed" ? ` · ${s.exit}` : ""}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
        <div className="flex flex-col gap-4">
          {v.playoffs.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Playoffs</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-1 text-sm">
                {v.playoffs.map((g, i) => (
                  <div key={i}>
                    <span className="text-xs text-muted-foreground">{ROUNDS[g.round]} · </span>
                    {g.home} {g.score}
                    {g.overtime ? " (OT)" : ""} {g.away}
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
          {v.scores.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Scores</CardTitle>
                <CardDescription>Every regular-season game, week by week.</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-2 text-sm">
                {v.scores.map((w) => (
                  <details key={w.week}>
                    <summary className="cursor-pointer">Week {w.week}</summary>
                    <ul className="mt-1 flex flex-col gap-0.5 pl-4">
                      {w.games.map((g, i) => (
                        <li key={i}>
                          {g.away} {g.awayScore}, {g.home} {g.homeScore}
                          {g.overtime ? " (OT)" : ""}
                        </li>
                      ))}
                    </ul>
                  </details>
                ))}
              </CardContent>
            </Card>
          )}
          {v.allPro.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>All-Pro first team</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-2">
                {v.allPro
                  .filter((a) => a.team === "first")
                  .map((a, i) => (
                    <div key={i}>
                      <span className="text-xs text-muted-foreground">{a.position} </span>
                      {player(a.playerId, a.name)}
                    </div>
                  ))}
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {v.leaders.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Statistical leaders</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
            {v.leaders.slice(0, 9).map((c) => (
              <div key={c.key}>
                <div className="font-medium">{c.label}</div>
                {c.leaders.slice(0, 3).map((r) => (
                  <div key={r.playerId} className="flex justify-between gap-2">
                    <span>{player(r.playerId, r.name)}</span>
                    <span className="tabular-nums text-muted-foreground">{r.value}</span>
                  </div>
                ))}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {v.news.length > 0 && <NewsList items={v.news.map((n) => ({ ...n, teamNames: [] }))} />}
    </div>
  );
}

/** The record book, league or franchise. */
export function RecordsPage({ scope }: { scope?: string }) {
  const [, navigate] = useLocation();
  const view = useSim("recordsView", { scope }, useLeagueKey(`records:${scope}`));
  if (view.error) return <ErrorNote message={view.error} />;
  if (!view.data) return <Loading />;
  const v = view.data;
  const LEVELS: Record<string, string> = {
    game: "Single game",
    season: "Single season",
    career: "Career",
  };
  const levels = ["game", "season", "career"].filter((l) => v.lists.some((x) => x.level === l));
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Record book"
        subtitle="Regular season. Records set before the league began carry a mark, and a broken record keeps its old holder."
      >
        <Select
          value={v.scope}
          onChange={(e) =>
            navigate(e.target.value === "league" ? "/records" : `/records/${e.target.value}`)
          }
          aria-label="Records for"
          className="w-56"
        >
          {v.scopes.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </Select>
      </PageHeader>
      {levels.length === 0 && (
        <p className="text-sm text-muted-foreground">No records yet: the first games set them.</p>
      )}
      {levels.map((level) => (
        <div key={level} className="flex flex-col gap-3">
          <h3 className="text-lg font-semibold">{LEVELS[level]}</h3>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {v.lists
              .filter((l) => l.level === level)
              .map((l) => (
                <Card key={l.stat}>
                  <CardHeader>
                    <CardTitle className="text-base capitalize">{l.label}</CardTitle>
                  </CardHeader>
                  <CardContent className="flex flex-col gap-1 text-sm">
                    {l.top.map((e) => (
                      <div
                        key={`${e.rank}-${e.name}-${e.season}`}
                        className="flex justify-between gap-2"
                      >
                        <span className="min-w-0 truncate">
                          <span className="text-muted-foreground tabular-nums">{e.rank}. </span>
                          {player(e.playerId, e.name)}
                          <span className="text-xs text-muted-foreground">
                            {e.season ? ` ${e.season}` : ""}
                            {e.real ? " ★" : ""}
                          </span>
                        </span>
                        <span className="font-medium tabular-nums">{e.value.toLocaleString()}</span>
                      </div>
                    ))}
                    {l.recentBreaks.length > 0 && (
                      <div className="mt-1 border-t pt-1 text-xs text-muted-foreground">
                        Last broken {l.recentBreaks[0]!.season}: {l.recentBreaks[0]!.name} passed{" "}
                        {l.recentBreaks[0]!.previous}.
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))}
          </div>
        </div>
      ))}
    </div>
  );
}

const KIND: Record<string, string> = {
  trade: "Trade",
  signing: "Signing",
  injury: "Injury",
  record: "Record",
  milestone: "Milestone",
  race: "Race",
  streak: "Streak",
  "hot-seat": "Hot seat",
  coaching: "Coaching",
  "front-office": "Front office",
  award: "Award",
  "hall-of-fame": "Hall of Fame",
  owner: "Owner",
  draft: "Draft",
};

/** A list of news items. */
export function NewsList({
  items,
  title = "Around the league",
}: {
  items: NewsView["items"];
  title?: string;
}) {
  if (items.length === 0) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col divide-y">
        {items.map((n) => (
          <div key={n.id} className="flex gap-3 py-2 text-sm">
            <span className="w-24 shrink-0 text-xs text-muted-foreground tabular-nums">
              {formatLeagueDate(n.date)}
            </span>
            <div className="min-w-0">
              <div className="font-medium">
                {n.link ? (
                  <Link href={n.link} className="hover:underline">
                    {n.headline}
                  </Link>
                ) : (
                  n.headline
                )}{" "}
                <span className="text-xs font-normal text-muted-foreground">{KIND[n.kind]}</span>
              </div>
              <div className="text-xs text-muted-foreground">{n.text}</div>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

/** The newsfeed page. */
export function NewsPage() {
  const view = useSim("newsView", {}, useLeagueKey("news"));
  if (view.error) return <ErrorNote message={view.error} />;
  if (!view.data) return <Loading />;
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Newsfeed"
        subtitle="Storylines from what's happening in the league: trades, signings, streaks, races, hot seats, records."
      />
      {view.data.items.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nothing yet: stories start with the next week.
        </p>
      ) : (
        <NewsList items={view.data.items} title="Latest" />
      )}
    </div>
  );
}

/** A franchise's history (the team page's History tab). */
export function TeamHistory({ teamId }: { teamId: string }) {
  const view = useSim("teamHistoryView", { teamId }, useLeagueKey(`team-history:${teamId}`));
  if (view.error) return <ErrorNote message={view.error} />;
  if (!view.data) return <Loading />;
  const v = view.data;
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        {v.titles} title{v.titles === 1 ? "" : "s"} · {v.playoffTrips} playoff trip
        {v.playoffTrips === 1 ? "" : "s"} in {v.seasons.length} seasons on record ·{" "}
        {v.recordsKept ? (
          <Link href={`/records/${teamId}`} className="underline">
            Franchise records
          </Link>
        ) : (
          <span>
            No franchise record book: this club's real records couldn't be imported, so none is
            kept.
          </span>
        )}
      </p>
      <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        <Card className="py-2">
          <CardContent className="max-h-[32rem] overflow-y-auto px-2">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Season</TableHead>
                  <TableHead>Record</TableHead>
                  <TableHead>Result</TableHead>
                  <TableHead className="hidden sm:table-cell">Head coach</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {v.seasons.map((s) => (
                  <TableRow key={s.season}>
                    <TableCell className="tabular-nums">
                      <Link href={`/season/${s.season}`} className="hover:underline">
                        {s.season}
                      </Link>
                    </TableCell>
                    <TableCell className="tabular-nums">{s.record}</TableCell>
                    <TableCell className={s.result === "Champions" ? "font-medium" : ""}>
                      {s.result}
                    </TableCell>
                    <TableCell className="hidden text-muted-foreground sm:table-cell">
                      {s.coach ?? ""}
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
              <CardTitle>Retired numbers</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-1 text-sm">
              {v.retiredNumbers.length === 0 && <p className="text-muted-foreground">None.</p>}
              {v.retiredNumbers.map((r) => (
                <div key={r.number}>
                  <span className="font-medium tabular-nums">{r.number}</span>{" "}
                  {player(r.playerId, r.name)}
                </div>
              ))}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Hall of Famers</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-1 text-sm">
              {v.hallOfFamers.length === 0 && <p className="text-muted-foreground">None yet.</p>}
              {v.hallOfFamers.map((h) => (
                <div key={h.name}>
                  {player(h.playerId, h.name)}{" "}
                  <span className="text-xs text-muted-foreground">
                    {h.position} · {h.inducted}
                  </span>
                </div>
              ))}
            </CardContent>
          </Card>
          {v.records.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Franchise records</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-1 text-xs">
                {v.records.slice(0, 10).map((r, i) => (
                  <div key={i}>
                    <span className="text-muted-foreground">
                      {r.level} {r.label}:{" "}
                    </span>
                    {r.value.toLocaleString()} · {r.name}
                    {r.season ? ` (${r.season})` : ""}
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

interface Placed {
  node: TreeNode;
  x: number;
  y: number;
  parent: Placed | null;
}

/** A family-tree drawing: the coach on the left, his protégés branching to the right. */
export function CoachTree({ coachId }: { coachId: number }) {
  const view = useSim("coachTreeView", { id: coachId }, useLeagueKey(`tree:${coachId}`));
  if (view.error) return <ErrorNote message={view.error} />;
  if (!view.data) return <Loading />;
  const COL = 190;
  const ROW = 34;
  const placed: Placed[] = [];
  let row = 0;
  const place = (node: TreeNode, depth: number, parent: Placed | null): Placed => {
    const kids = node.children;
    const me: Placed = { node, x: depth * COL, y: 0, parent };
    if (kids.length === 0) {
      me.y = row * ROW;
      row += 1;
    } else {
      const ys = kids.map((k) => place(k, depth + 1, me).y);
      me.y = (Math.min(...ys) + Math.max(...ys)) / 2;
    }
    placed.push(me);
    return me;
  };
  place(view.data, 0, null);
  if (placed.length === 1) return <p className="text-sm text-muted-foreground">No branches yet.</p>;
  const width = Math.max(...placed.map((p) => p.x)) + COL;
  const height = row * ROW + 10;
  return (
    <div className="overflow-x-auto">
      <svg
        width={width}
        height={height}
        role="img"
        aria-label="Coaching tree"
        className="text-foreground"
      >
        {placed
          .filter((p) => p.parent)
          .map((p) => (
            <path
              key={`l${p.node.id}`}
              d={`M${p.parent!.x + 150},${p.parent!.y + 14} C${p.parent!.x + 170},${p.parent!.y + 14} ${p.x - 20},${p.y + 14} ${p.x},${p.y + 14}`}
              fill="none"
              stroke="currentColor"
              strokeOpacity={0.3}
            />
          ))}
        {placed.map((p) => (
          <g key={p.node.id} transform={`translate(${p.x},${p.y})`}>
            <rect
              width={150}
              height={28}
              rx={6}
              fill="var(--card)"
              stroke="currentColor"
              strokeOpacity={p.parent ? 0.25 : 0.6}
            />
            <a href={`#/coach/${p.node.id}`}>
              <text x={8} y={12} fontSize={11} fontWeight={500} fill="currentColor">
                {p.node.name.length > 22 ? `${p.node.name.slice(0, 21)}…` : p.node.name}
              </text>
            </a>
            <text x={8} y={23} fontSize={9} fill="currentColor" fillOpacity={0.6}>
              {p.node.headSeasons > 0
                ? `HC ${p.node.headSeasons} yr, ${p.node.headWins} wins`
                : p.node.now}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}

/** Awards, Hall of Fame and retired number on a player's page. */
export function HonorsCard({ honors }: { honors: import("@fgm/sim-core").Honors }) {
  if (honors.awards.length === 0 && !honors.hallOfFame && !honors.retiredNumber) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Honors</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-1 text-sm">
        {honors.hallOfFame && (
          <div className="font-medium">
            Hall of Fame, class of {honors.hallOfFame.inducted}
            <span className="text-xs font-normal text-muted-foreground">
              {" "}
              {honors.hallOfFame.reason}
            </span>
          </div>
        )}
        {honors.retiredNumber && (
          <div>
            No. {honors.retiredNumber.number} retired by{" "}
            <Link href={`/team/${honors.retiredNumber.teamId}`} className="hover:underline">
              {honors.retiredNumber.teamId}
            </Link>
          </div>
        )}
        {honors.awards.map((a) => (
          <div key={a.label}>
            {a.seasons.length > 1 ? `${a.seasons.length}x ` : ""}
            {a.label} <span className="text-xs text-muted-foreground">{a.seasons.join(", ")}</span>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
