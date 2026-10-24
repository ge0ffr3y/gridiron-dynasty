/**
 * The almanac (Phase 15): every season, franchises by titles, dynasties and droughts, and the
 * Hall of Fame. Season recaps, the record book and the newsfeed hang off it.
 */
import { useState } from "react";
import { Link } from "wouter";
import { ErrorNote, Loading, PageHeader } from "@/components/shared";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useLeagueKey } from "@/lib/session";
import { cn } from "@/lib/utils";
import { useSim } from "@/sim/client";
import type { AlmanacView } from "@fgm/sim-core";

const TABS = [
  ["seasons", "Seasons"],
  ["franchises", "Franchises"],
  ["hall", "Hall of Fame"],
] as const;
type Tab = (typeof TABS)[number][0];

const teamLink = (t: { id: string; name: string } | null) =>
  t ? (
    <Link href={`/team/${t.id}`} className="hover:underline">
      {t.name}
    </Link>
  ) : (
    <span className="text-muted-foreground">-</span>
  );

export function HistoryPage() {
  const view = useSim("almanacView", {}, useLeagueKey("almanac"));
  const [tab, setTab] = useState<Tab>("seasons");
  if (view.error) return <ErrorNote message={view.error} />;
  if (!view.data) return <Loading />;
  const v = view.data;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Almanac"
        subtitle={
          v.seasons.length === 0
            ? "No seasons played yet."
            : `${v.seasons.length} seasons${v.firstSeason ? ` since ${v.firstSeason}` : ""}: champions, awards, records and the Hall of Fame.`
        }
      >
        <div className="flex gap-3 text-sm">
          <Link href="/records" className="underline">
            Record book
          </Link>
          <Link href="/news" className="underline">
            Newsfeed
          </Link>
        </div>
      </PageHeader>
      <div className="flex gap-1 border-b" role="tablist">
        {TABS.map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            className={cn(
              "-mb-px border-b-2 px-3 py-2 text-sm",
              tab === id
                ? "border-primary font-medium"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === "seasons" && <Seasons v={v} />}
      {tab === "franchises" && <Franchises v={v} />}
      {tab === "hall" && <Hall v={v} />}
    </div>
  );
}

function Seasons({ v }: { v: AlmanacView }) {
  return (
    <Card className="py-2">
      <CardContent className="overflow-x-auto px-2">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Season</TableHead>
              <TableHead>Champion</TableHead>
              <TableHead className="text-right">Score</TableHead>
              <TableHead>Runner-up</TableHead>
              <TableHead className="hidden md:table-cell">MVP</TableHead>
              <TableHead className="hidden sm:table-cell">Best record</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {v.seasons.map((s) => (
              <TableRow key={s.season}>
                <TableCell className="tabular-nums">
                  <Link href={`/season/${s.season}`} className="font-medium hover:underline">
                    {s.season}
                  </Link>
                </TableCell>
                <TableCell className="font-medium">{teamLink(s.champion)}</TableCell>
                <TableCell className="text-right tabular-nums">{s.score ?? ""}</TableCell>
                <TableCell>{teamLink(s.runnerUp)}</TableCell>
                <TableCell className="hidden md:table-cell">
                  {s.mvp ? (
                    <span>
                      {s.mvp.playerId !== null ? (
                        <Link href={`/player/${s.mvp.playerId}`} className="hover:underline">
                          {s.mvp.name}
                        </Link>
                      ) : (
                        s.mvp.name
                      )}{" "}
                      <span className="text-xs text-muted-foreground">{s.mvp.position}</span>
                    </span>
                  ) : (
                    ""
                  )}
                </TableCell>
                <TableCell className="hidden tabular-nums sm:table-cell">
                  {s.best ? `${s.best.team.name} ${s.best.record}` : ""}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function Franchises({ v }: { v: AlmanacView }) {
  return (
    <div className="flex flex-col gap-6">
      <Card className="py-2">
        <CardContent className="overflow-x-auto px-2">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Franchise</TableHead>
                <TableHead className="text-right">Titles</TableHead>
                <TableHead className="text-right">Finals lost</TableHead>
                <TableHead className="text-right">Playoffs</TableHead>
                <TableHead className="text-right">Record</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {v.franchises.map((f) => (
                <TableRow key={f.teamId}>
                  <TableCell>
                    <Link href={`/team/${f.teamId}`} className="font-medium hover:underline">
                      {f.name}
                    </Link>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{f.titles}</TableCell>
                  <TableCell className="text-right tabular-nums">{f.finals}</TableCell>
                  <TableCell className="text-right tabular-nums">{f.playoffs}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {f.seasons > 0 ? `${f.wins}-${f.losses}${f.ties ? `-${f.ties}` : ""}` : ""}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Dynasties</CardTitle>
            <CardDescription>Three titles in four seasons, or more.</CardDescription>
          </CardHeader>
          <CardContent className="text-sm">
            {v.dynasties.length === 0 && <p className="text-muted-foreground">None yet.</p>}
            {v.dynasties.map((d) => (
              <div key={`${d.teamId}-${d.from}`}>
                <Link href={`/team/${d.teamId}`} className="hover:underline">
                  {d.name}
                </Link>{" "}
                <span className="text-muted-foreground">
                  {d.from}-{d.to}: {d.titles} titles
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Longest droughts</CardTitle>
            <CardDescription>Seasons since a title.</CardDescription>
          </CardHeader>
          <CardContent className="text-sm">
            {v.droughts.map((d) => (
              <div key={d.teamId}>
                <Link href={`/team/${d.teamId}`} className="hover:underline">
                  {d.name}
                </Link>{" "}
                <span className="text-muted-foreground">
                  {d.since ? `${d.seasons} seasons (last title ${d.since})` : "never won it all"}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Hall({ v }: { v: AlmanacView }) {
  if (v.hallOfFame.length === 0)
    return (
      <p className="text-sm text-muted-foreground">
        No one is in the Hall of Fame yet. Players become eligible five seasons after their last,
        and the committee meets after each season.
      </p>
    );
  const classes = new Map<number, AlmanacView["hallOfFame"]>();
  for (const h of v.hallOfFame) classes.set(h.inducted, [...(classes.get(h.inducted) ?? []), h]);
  return (
    <div className="flex flex-col gap-4">
      {[...classes].map(([year, members]) => (
        <Card key={year}>
          <CardHeader>
            <CardTitle>Class of {year}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 text-sm">
            {members.map((h) => (
              <div key={h.name}>
                {h.playerId !== null ? (
                  <Link href={`/player/${h.playerId}`} className="font-medium hover:underline">
                    {h.name}
                  </Link>
                ) : (
                  <span className="font-medium">{h.name}</span>
                )}{" "}
                <span className="text-xs text-muted-foreground">
                  {h.kind === "player"
                    ? h.position
                    : h.kind === "coach"
                      ? "Coach"
                      : "General manager"}
                  {h.teams.length ? ` · ${h.teams.slice(0, 3).join(", ")}` : ""}
                </span>
                <div className="text-xs text-muted-foreground">{h.reason}</div>
              </div>
            ))}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
