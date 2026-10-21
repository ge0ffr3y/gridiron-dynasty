import { Link } from "wouter";
import { ErrorNote, Facts, Loading, OverallBadge, PageHeader, TeamChip } from "@/components/shared";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatLeagueDate } from "@/lib/format";
import { useLeagueKey } from "@/lib/session";
import { useSim } from "@/sim/client";

export function LeaguePage() {
  const key = useLeagueKey();
  const summary = useSim("leagueSummary", {}, key);
  const calendar = useSim("calendar", {}, key);
  const history = useSim("historyView", {}, key);
  if (summary.error) return <ErrorNote message={summary.error} />;
  if (!summary.data) return <Loading />;
  const s = summary.data;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={s.name}
        subtitle={`${s.season} · ${s.stage} · ${formatLeagueDate(s.date)}`}
      />

      <Card>
        <CardContent>
          <Facts
            items={[
              ["Teams", s.counts.teams],
              ["Players", s.counts.players.toLocaleString()],
              ["Coaches & scouts", s.counts.coaches],
              ["Draft picks held", s.counts.draftPicks],
              ["Seed", s.seed],
              ["File fingerprint", <span className="font-mono">{s.saved.fingerprint}</span>],
            ]}
          />
          {s.placeholderNames && (
            <p className="mt-4 text-xs text-muted-foreground">
              Conference and team names are placeholders; the real names get chosen in a later
              phase.
            </p>
          )}
        </CardContent>
      </Card>

      {calendar.data && (
        <Card>
          <CardHeader>
            <CardTitle>
              {calendar.data.season} season · {calendar.data.label}
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 text-sm">
            {history.data?.seasons[0] && (
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground">
                  {history.data.seasons[0].season} champion:
                </span>
                <TeamChip team={history.data.seasons[0].champion} />
                <Link
                  href={`/team/${history.data.seasons[0].champion.id}`}
                  className="font-medium hover:underline"
                >
                  {history.data.seasons[0].champion.city}{" "}
                  {history.data.seasons[0].champion.nickname}
                </Link>
                <span className="text-muted-foreground">
                  ({history.data.seasons[0].score} over{" "}
                  {history.data.seasons[0].runnerUp.abbreviation})
                </span>
              </div>
            )}
            <div className="flex flex-wrap gap-3">
              <Link href="/schedule" className="underline">
                Schedule
              </Link>
              <Link href="/standings" className="underline">
                Standings
              </Link>
              <Link href="/playoffs" className="underline">
                Playoff picture
              </Link>
            </div>
          </CardContent>
        </Card>
      )}

      {s.conferences.map((conference) => (
        <section key={conference.id} className="flex flex-col gap-3">
          <h3 className="text-lg font-semibold">{conference.name}</h3>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {conference.divisions.map((division) => (
              <Card key={division.id} className="gap-2 py-4">
                <CardHeader className="px-4">
                  <CardTitle className="text-sm">{division.name}</CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col gap-2 px-4">
                  {division.teams.map((team) => (
                    <div key={team.id} className="flex items-center gap-2 text-sm">
                      <TeamChip team={team} />
                      <Link
                        href={`/team/${team.id}`}
                        className="min-w-0 flex-1 truncate hover:underline"
                      >
                        {team.city} {team.nickname}
                      </Link>
                      <OverallBadge value={Math.round(team.starterOverall)} />
                    </div>
                  ))}
                </CardContent>
              </Card>
            ))}
          </div>
        </section>
      ))}
      <p className="text-xs text-muted-foreground">
        The number beside each team is its starters' average overall.
      </p>

      <Card>
        <CardHeader>
          <CardTitle>League news</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 text-sm">
          {s.recentTransactions.map((t, i) => (
            <div key={i}>
              <span className="text-muted-foreground">{formatLeagueDate(t.date)}</span> · {t.text}
              <div className="text-xs text-muted-foreground">Why: {t.reason}</div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
