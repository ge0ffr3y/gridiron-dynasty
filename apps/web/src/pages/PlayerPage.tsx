import { HonorsCard } from "@/pages/HistoryPages";
import { Link } from "wouter";
import { ContractPanel } from "@/components/ContractPanel";
import { RatingHistoryChart } from "@/components/RatingHistoryChart";
import { StatTables } from "@/components/StatTables";
import {
  ErrorNote,
  Facts,
  listName,
  Loading,
  PageHeader,
  OverallBadge,
  RatingBar,
  TeamChip,
} from "@/components/shared";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { MoodCard } from "@/components/Morale";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatHeight, formatLeagueDate, ordinal } from "@/lib/format";
import { useLeagueKey } from "@/lib/session";
import { useSim } from "@/sim/client";
import { formatShort } from "@fgm/sim-core";

const DEVELOPMENT_STAGES: Record<string, string> = {
  "league-year": "League Year",
  camp: "camp",
  season: "in season",
};

const INJURY_KINDS: Record<string, string> = {
  game: "In a game",
  practice: "In practice",
  camp: "Training camp",
  "non-football": "Off the field",
};

const GROUP_TITLES = { physical: "Physical", technical: "Technical", mental: "Mental" } as const;

/** The preseason stats worth showing, in plain words. */
const PRESEASON_STATS: Record<string, string> = {
  passCmp: "Completions",
  passAtt: "Pass attempts",
  passYds: "Passing yards",
  passTd: "Passing TDs",
  passInt: "Interceptions thrown",
  rushAtt: "Carries",
  rushYds: "Rushing yards",
  rec: "Catches",
  recYds: "Receiving yards",
  tackles: "Tackles",
  sacks: "Sacks",
  pressures: "Pressures",
  pressuresAllowed: "Pressures allowed",
  defInt: "Interceptions",
  passDef: "Passes defended",
  fgm: "Field goals made",
  punts: "Punts",
};

export function PlayerPage({ playerId }: { playerId: number }) {
  const view = useSim("playerView", { id: playerId }, useLeagueKey(String(playerId)));
  // Long-gone players are history cards now (Phase 13).
  if (view.error && /no player/.test(view.error)) return <FormerPlayerPage id={playerId} />;
  if (view.error) return <ErrorNote message={view.error} />;
  if (!view.data) return <Loading />;
  const p = view.data;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-4">
        <OverallBadge value={p.overall} className="h-14 w-14 text-xl" />
        <div className="min-w-0">
          <h2 className="text-2xl font-semibold tracking-tight">{p.name}</h2>
          {p.retiredAfter === null && (
            <Link href={`/negotiate/${p.id}`} className="text-xs text-primary hover:underline">
              Contract talks
            </Link>
          )}
          <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            {p.team && <TeamChip team={p.team} />}
            <span>
              #{p.jersey} · {p.positionName}
              {p.team && (
                <>
                  {" · "}
                  <Link href={`/team/${p.team.id}`} className="hover:underline">
                    {p.team.city} {p.team.nickname}
                  </Link>
                </>
              )}
            </span>
          </div>
        </div>
      </div>

      <HonorsCard honors={p.honors} />

      <Card>
        <CardContent>
          <Facts
            items={[
              ["Age", p.age],
              ["Born", formatLeagueDate(p.birthDate)],
              ["Height / weight", `${formatHeight(p.heightIn)}, ${p.weightLb} lb`],
              [
                "40-yard dash",
                `${p.fortyTime.toFixed(2)} s${p.fortyMeasured ? "" : " (estimated from tape)"}`,
              ],
              [
                "Experience",
                p.experience === 0
                  ? "Rookie"
                  : `${p.experience} season${p.experience === 1 ? "" : "s"}`,
              ],
              ["College", p.college],
              [
                "Drafted",
                p.drafted
                  ? `${p.drafted.season}, ${ordinal(p.drafted.round)} round (${ordinal(p.drafted.pick)} overall), ${p.drafted.team}`
                  : "Undrafted",
              ],
              [
                "Contract",
                p.contract
                  ? `${p.contract.team}, through ${p.contract.expiresAfterSeason} · ${formatShort(p.contract.averagePerYear)} a year · ${formatShort(p.contract.capHit)} cap hit this year`
                  : "None",
              ],
              [
                "Roster",
                p.retiredAfter !== null
                  ? `Retired after the ${p.retiredAfter} season`
                  : `${listName(p.list)}${p.reserve ? ` since ${formatLeagueDate(p.reserve.since)}, ${p.reserve.gamesMissed} game${p.reserve.gamesMissed === 1 ? "" : "s"} missed${p.reserve.designatedToReturn ? ", designated to return" : ""}` : ""}${p.list === "practice-squad" ? ` · elevated ${p.elevations} of 3 times this season` : ""}`,
              ],
              [
                "Scheme fit",
                p.schemeFit ? `${p.schemeFit.label} in his team's ${p.schemeFit.scheme}` : "—",
              ],
              [
                "Health",
                p.injury ? (
                  <span className="text-destructive">
                    {p.injury.status}: {p.injury.description}; out {p.injury.gamesRemaining} more
                    game{p.injury.gamesRemaining === 1 ? "" : "s"}
                  </span>
                ) : p.knock ? (
                  `Questionable: playing through a ${p.knock.part.toLowerCase()} knock`
                ) : (
                  "Healthy"
                ),
              ],
            ]}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Positions</CardTitle>
          <CardDescription>
            Overall at each position this player knows: the staff's read, likely {p.overallRange[0]}
            –{p.overallRange[1]} at {p.position} ({Math.round(p.confidence * 100)}% confident).
            Potential: likely {p.potential.range[0]}–{p.potential.range[1]}.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-4">
          {p.positionOveralls.map((po) => (
            <div key={po.position} className="flex items-center gap-2 text-sm">
              <OverallBadge value={po.overall} />
              <span className="font-medium">{po.position}</span>
              {po.position !== p.position && (
                <span className="text-xs text-muted-foreground">
                  {Math.round(po.familiarity * 100)}% familiar
                </span>
              )}
            </div>
          ))}
        </CardContent>
      </Card>

      {p.ratingHistory.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Career arc</CardTitle>
            <CardDescription>
              Overall at the end of each season, your staff's read; the open dot is this season so
              far.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <RatingHistoryChart points={p.ratingHistory} />
            {p.development.length > 0 && (
              <div className="flex flex-col gap-1 text-sm">
                <div className="font-medium">This season</div>
                {p.development.map((d) => (
                  <div key={`${d.stage}-${d.date}`}>
                    <span className="tabular-nums">
                      {d.change > 0 ? "+" : ""}
                      {d.change}
                    </span>{" "}
                    <span className="text-muted-foreground">
                      ({DEVELOPMENT_STAGES[d.stage] ?? d.stage}) {d.reason}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <MoodCard player={p} />

      {p.injuryHistory.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Injury history</CardTitle>
            <CardDescription>
              Every injury, newest first, with the games he was expected to miss (0: he played
              through it).
            </CardDescription>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Injury</TableHead>
                  <TableHead>Where</TableHead>
                  <TableHead className="text-right">Games</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {p.injuryHistory.map((h, i) => (
                  <TableRow key={`${h.date}-${i}`}>
                    <TableCell>{formatLeagueDate(h.date)}</TableCell>
                    <TableCell>{h.part}</TableCell>
                    <TableCell>{INJURY_KINDS[h.kind] ?? h.kind}</TableCell>
                    <TableCell className="text-right tabular-nums">{h.games}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {p.preseason && (
        <Card>
          <CardHeader>
            <CardTitle>{p.preseason.season} preseason</CardTitle>
            <CardDescription>
              Preseason games are a showcase for players fighting for a roster spot (starters rest).
              The grade compares his production per snap with other preseason players at his
              position: 50 is typical, and few snaps pull it toward 50.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Facts
              items={[
                [
                  "Showcase grade",
                  p.preseason.grade === null ? "Not graded yet" : p.preseason.grade,
                ],
                ["Snaps", (p.preseason.line.offSnaps ?? 0) + (p.preseason.line.defSnaps ?? 0)],
                ...(Object.entries(p.preseason.line)
                  .filter(([k, v]) => PRESEASON_STATS[k] && v)
                  .map(([k, v]) => [PRESEASON_STATS[k]!, v]) as [string, number][]),
              ]}
            />
          </CardContent>
        </Card>
      )}

      <ContractPanel playerId={playerId} />

      <Card>
        <CardHeader>
          <CardTitle>Stats</CardTitle>
          <CardDescription>Season by season, with career totals.</CardDescription>
        </CardHeader>
        <CardContent>
          <StatTables
            firstColumn="Season"
            rows={[
              ...p.stats.map((s) => ({
                key: `${s.season}-${s.team}`,
                label: `${s.season} ${s.team}`,
                href: `/team/${s.team}`,
                line: s.line,
              })),
              ...(p.stats.length > 1
                ? [{ key: "career", label: "Career", line: p.career, emphasis: true }]
                : []),
            ]}
          />
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {p.attributeGroups.map((group) => (
          <Card key={group.group}>
            <CardHeader>
              <CardTitle>{GROUP_TITLES[group.group]}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              {group.attributes.map((a) => (
                <RatingBar key={a.key} label={a.label} value={a.value} />
              ))}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

/** A long-gone player's history card: who he was, where he played, his peak and career totals. */
function FormerPlayerPage({ id }: { id: number }) {
  const view = useSim("formerPlayerView", { id }, useLeagueKey(`former:${id}`));
  if (view.error) return <ErrorNote message={view.error} />;
  if (!view.data) return <Loading />;
  const c = view.data;
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={c.name}
        subtitle={`${c.position} · ${c.years}${c.retiredAfter !== null ? ` · retired after ${c.retiredAfter}` : ""}`}
      />
      <Card>
        <CardContent>
          <Facts
            items={[
              ["Born", formatLeagueDate(c.birthDate)],
              ["College", c.college],
              [
                "Drafted",
                c.drafted
                  ? `${c.drafted.season}, ${ordinal(c.drafted.round)} round (${ordinal(c.drafted.pick)} overall), ${c.drafted.teamId}`
                  : "Undrafted",
              ],
              ["Teams", c.teams.join(", ") || "None"],
              ["Seasons as a starter", c.seasonsStarted],
              ["Peak", c.peak > 0 ? `${c.peak} (the league office's read)` : "—"],
            ]}
          />
          <p className="mt-4 text-xs text-muted-foreground">
            A history card: players long gone from the league keep their essentials only.
          </p>
        </CardContent>
      </Card>
      <HonorsCard honors={c.honors} />
      <Card>
        <CardHeader>
          <CardTitle>Career totals</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
          {Object.entries(c.career)
            .filter(([, v]) => v)
            .map(([k, v]) => (
              <span key={k}>
                <span className="text-muted-foreground">{k}</span> {Math.round(v as number)}
              </span>
            ))}
        </CardContent>
      </Card>
    </div>
  );
}
