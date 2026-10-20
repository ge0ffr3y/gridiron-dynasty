import { Link } from "wouter";
import { ErrorNote, Facts, Loading, RatingBar, TeamChip } from "@/components/shared";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatLeagueDate } from "@/lib/format";
import { useSession } from "@/lib/session";
import { useSim } from "@/sim/client";

export function CoachPage({ coachId }: { coachId: number }) {
  const { league } = useSession();
  const view = useSim("coachView", { id: coachId }, `${league?.id}:${coachId}`);
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
          <CardTitle>Attributes</CardTitle>
          <CardDescription>
            Placeholder coaching attributes; the full coach model arrives in Phase 10.
          </CardDescription>
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
