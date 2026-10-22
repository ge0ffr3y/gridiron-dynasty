import { Link } from "wouter";
import { PhilosophyChart } from "@/components/PhilosophyChart";
import { ErrorNote, Facts, Loading, RatingBar, TeamChip } from "@/components/shared";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatLeagueDate } from "@/lib/format";
import { useLeagueKey } from "@/lib/session";
import { useSim } from "@/sim/client";

export function CoachPage({ coachId }: { coachId: number }) {
  const view = useSim("coachView", { id: coachId }, useLeagueKey(String(coachId)));
  if (view.error) return <ErrorNote message={view.error} />;
  if (!view.data) return <Loading />;
  const c = view.data;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight">{c.name}</h2>
        <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          {c.team && <TeamChip team={c.team} />}
          <span>
            {c.roleName}
            {c.team && (
              <>
                {" · "}
                <Link href={`/team/${c.team.id}`} className="hover:underline">
                  {c.team.city} {c.team.nickname}
                </Link>
              </>
            )}
          </span>
        </div>
      </div>

      <Card>
        <CardContent>
          <Facts
            items={[
              ["Age", c.age],
              ["Born", formatLeagueDate(c.birthDate)],
              ["Years coaching", c.experience],
              ["Offensive scheme", c.offensiveScheme ?? "—"],
              ["Defensive scheme", c.defensiveScheme ?? "—"],
            ]}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Philosophy{c.summary ? `: ${c.summary}` : ""}</CardTitle>
          <CardDescription>
            How he likes to play, against the league average, in points of each real rate (a full
            bar is about as far as the most extreme real teams). His own job's side is in color; the
            rest is how he'd coach if he moved.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <PhilosophyChart lines={c.philosophy} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>In his job</CardTitle>
          <CardDescription>What he does for his team, against a typical staff.</CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="list-disc pl-5 text-sm">
            {c.effects.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Skills</CardTitle>
          <CardDescription>0 to 100; his job's main skill matters most.</CardDescription>
        </CardHeader>
        <CardContent className="flex max-w-xl flex-col gap-2">
          {c.attributes.map((a) => (
            <RatingBar key={a.key} label={a.label} value={a.value} />
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
