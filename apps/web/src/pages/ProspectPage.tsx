/**
 * A draft prospect's page (Phase 11a): the scouting report in words, his
 * combine or pro-day drills, and every rating with how far off it may be,
 * all as the viewer's scouts see him.
 */
import { Link } from "wouter";
import { ErrorNote, Facts, Loading, OverallBadge } from "@/components/shared";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatHeight, formatLeagueDate, ordinal } from "@/lib/format";
import { useLeagueKey } from "@/lib/session";
import { useSim } from "@/sim/client";

const GROUP_NAMES: Record<string, string> = {
  physical: "Physical",
  technical: "Technical",
  mental: "Mental",
};

/** A rating with its likely range drawn as a lighter band around the bar's end. */
function RangeBar({
  label,
  value,
  plusMinus,
  counts,
}: {
  label: string;
  value: number;
  plusMinus: number;
  counts: boolean;
}) {
  const lo = Math.max(0, value - plusMinus);
  const hi = Math.min(100, value + plusMinus);
  return (
    <div className="grid grid-cols-[minmax(0,8rem)_minmax(3rem,1fr)_4.5rem] items-center gap-2 text-sm">
      <span className={counts ? "truncate" : "truncate text-muted-foreground"}>{label}</span>
      <div className="relative h-1.5 rounded-full bg-muted">
        <div
          className="absolute inset-y-0 left-0 rounded-full bg-primary"
          style={{ width: `${value}%`, opacity: counts ? 0.9 : 0.4 }}
        />
        <div
          className="absolute -inset-y-0.5 rounded-full bg-primary/25"
          style={{ left: `${lo}%`, width: `${hi - lo}%` }}
        />
      </div>
      <span className="text-right tabular-nums">
        {value}
        <span className="text-xs text-muted-foreground"> ±{plusMinus}</span>
      </span>
    </div>
  );
}

export function ProspectPage({ prospectId }: { prospectId: number }) {
  const view = useSim("prospectView", { id: prospectId }, useLeagueKey(String(prospectId)));
  if (view.error)
    return (
      <ErrorNote
        message={`${view.error}. Prospects become players on draft day; find him on the Players page.`}
      />
    );
  if (!view.data) return <Loading />;
  const p = view.data;
  const testing = p.testing.tested
    ? p.testing.invited
      ? "Measured at the combine"
      : "Measured at his pro day"
    : p.testing.invited
      ? `Invited to the combine (${formatLeagueDate(p.testing.combine)})`
      : `Pro day ${formatLeagueDate(p.testing.proDay!)}`;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-4">
        <OverallBadge value={p.overall} className="h-14 w-14 text-xl" />
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight">{p.name}</h1>
          <div className="mt-1 text-sm text-muted-foreground">
            {p.positionName} · {p.college} ·{" "}
            <Link href="/draft" className="hover:underline">
              {p.draftYear} draft prospect
            </Link>
          </div>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Scouting report</CardTitle>
          <CardDescription>
            {p.viewer[0]!.toUpperCase() + p.viewer.slice(1)}'s read.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-1.5 text-sm">
          {p.report.map((line) => (
            <p key={line}>{line}</p>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardContent>
          <Facts
            items={[
              ["Overall (likely)", `${p.overall} (${p.range[0]}–${p.range[1]})`],
              ["Potential (likely)", `${p.potential.range[0]}–${p.potential.range[1]}`],
              ["Confidence", `${Math.round(p.confidence * 100)}%`],
              ["Board rank", `${ordinal(p.viewerRank)} of ${p.classSize}`],
              ["Consensus rank", ordinal(p.consensusRank)],
              ["Age", p.age],
              ["Height / weight", `${formatHeight(p.heightIn)}, ${p.weightLb} lb`],
              ["Region", p.region],
              ["Testing", testing],
              ...(p.study !== null
                ? ([["Your scouts' study", `${Math.round(p.study)} points`]] as [string, string][])
                : []),
            ]}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Drills</CardTitle>
          <CardDescription>
            {p.testing.tested
              ? "His results, and how they rank among real prospects at his position since 2010 (higher is better). A dash: he skipped that drill."
              : `Not measured yet. On tape his 40 looks like about ${p.estimatedForty.toFixed(2)} s.`}
          </CardDescription>
        </CardHeader>
        {p.testing.tested && (
          <CardContent>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3">
              {p.drills.map((d) => (
                <div key={d.key}>
                  <dt className="text-xs text-muted-foreground">{d.label}</dt>
                  <dd className="font-medium tabular-nums">
                    {d.value === null ? (
                      "—"
                    ) : (
                      <>
                        {d.value} {d.unit}
                        {d.percentile !== null && (
                          <span className="text-xs font-normal text-muted-foreground">
                            {" "}
                            · {ordinal(d.percentile)} percentile
                          </span>
                        )}
                      </>
                    )}
                  </dd>
                </div>
              ))}
            </dl>
          </CardContent>
        )}
      </Card>

      <div className="grid gap-4 md:grid-cols-3">
        {p.attributeGroups.map((g) => (
          <Card key={g.group}>
            <CardHeader>
              <CardTitle>{GROUP_NAMES[g.group]}</CardTitle>
              <CardDescription>
                The band shows the likely range. Dimmed: doesn't count at his position.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-1.5">
              {g.attributes.map((a) => (
                <RangeBar
                  key={a.key}
                  label={a.label}
                  value={a.value}
                  plusMinus={a.plusMinus}
                  counts={a.counts}
                />
              ))}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
