import { Link } from "wouter";
import { StatTables } from "@/components/StatTables";
import { ErrorNote, Facts, Loading, OverallBadge, RatingBar, TeamChip } from "@/components/shared";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatHeight, formatLeagueDate, ordinal } from "@/lib/format";
import { useLeagueKey } from "@/lib/session";
import { useSim } from "@/sim/client";

const GROUP_TITLES = { physical: "Physical", technical: "Technical", mental: "Mental" } as const;

export function PlayerPage({ playerId }: { playerId: number }) {
  const view = useSim("playerView", { id: playerId }, useLeagueKey(String(playerId)));
  if (view.error) return <ErrorNote message={view.error} />;
  if (!view.data) return <Loading />;
  const p = view.data;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-4">
        <OverallBadge value={p.overall} className="h-14 w-14 text-xl" />
        <div className="min-w-0">
          <h2 className="text-2xl font-semibold tracking-tight">{p.name}</h2>
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

      <Card>
        <CardContent>
          <Facts
            items={[
              ["Age", p.age],
              ["Born", formatLeagueDate(p.birthDate)],
              ["Height / weight", `${formatHeight(p.heightIn)}, ${p.weightLb} lb`],
              ["40-yard dash", `${p.fortyTime.toFixed(2)} s`],
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
                  ? `${p.contract.team}, through ${p.contract.expiresAfterSeason}`
                  : "None",
              ],
              [
                "Health",
                p.injury ? (
                  <span className="text-destructive">
                    Injured: {p.injury.description.toLowerCase()}, out {p.injury.gamesRemaining}{" "}
                    more game{p.injury.gamesRemaining === 1 ? "" : "s"}
                  </span>
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
            Overall at each position this player knows. Your staff's read,{" "}
            {Math.round(p.confidence * 100)}% confident.
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
