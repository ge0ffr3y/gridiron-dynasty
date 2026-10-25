/**
 * Experiments (Phase 17): questions answered by running the league many times. The list shows what has
 * been run; each result page gives the question, how it was set up, a chart with 95% intervals, the
 * numbers behind it, and the written conclusion. Results come from files the runner wrote.
 */
import type { ReactNode } from "react";
import { Link } from "wouter";
import { ErrorNote, Loading, PageHeader } from "@/components/shared";
import { IntervalPlot, SERIES_COLORS, TrajectoryChart } from "@/components/ExperimentCharts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  useExperiment,
  useExperimentIndex,
  type Interval,
  type PlayoffResult,
  type SwapResult,
  type TeamGroupsResult,
  type TitleOddsResult,
} from "@/lib/experiments";

const pct = (v: number, digits = 1) => `${(v * 100).toFixed(digits)}%`;
/** A difference of two shares, in percentage points, with its sign. */
const points = (v: number) => `${v >= 0 ? "+" : "−"}${Math.abs(v * 100).toFixed(1)} pts`;
const plain = (v: number) => (Math.abs(v) < 10 ? v.toFixed(2) : v.toFixed(1));
const signed = (v: number) => `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(2)}`;
const range = (i: Interval, f: (v: number) => string) => `${f(i.lo)} to ${f(i.hi)}`;
/** Does the interval for a difference leave out zero? */
const clear = (i: Interval) => i.lo > 0 || i.hi < 0;

const KIND_LABEL: Record<string, string> = {
  "team-groups": "Compared across 32 teams",
  "title-odds": "Replayed from one start",
  "playoff-randomness": "Playoff replays",
  "swap-study": "One team, changed",
};

export function ExperimentsPage() {
  const { entries } = useExperimentIndex();
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Experiments"
        subtitle="Questions answered by running the league hundreds of times, with a 95% interval on every number."
      />
      {entries === null ? (
        <Loading />
      ) : entries.length === 0 ? (
        <Card>
          <CardContent className="pt-6 text-sm text-muted-foreground">
            No results yet. Run one with{" "}
            <code>npm run sim -- --experiment experiments/&lt;file&gt;.json</code> and publish it
            with <code>npm run sim -- --publish-experiments</code>.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {entries.map((e) => (
            <Link key={e.id} href={`/experiments/${e.id}`}>
              <Card className="h-full cursor-pointer transition-colors hover:bg-accent/40">
                <CardHeader>
                  <CardTitle className="text-base">{e.title}</CardTitle>
                  <CardDescription>{e.question}</CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col gap-2 text-sm">
                  <div className="text-xs text-muted-foreground">
                    {KIND_LABEL[e.kind]} · {e.runs.toLocaleString()} runs
                    {e.seasons > 1 ? ` of ${e.seasons} seasons` : ""}
                    {e.visibility === "private" ? " · private (this computer only)" : ""}
                  </div>
                  {e.conclusion ? (
                    <p>{e.conclusion.split("\n")[0]}</p>
                  ) : (
                    <p className="text-muted-foreground">No conclusion written yet.</p>
                  )}
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

export function ExperimentPage({ id }: { id: string }) {
  const result = useExperiment(id);
  if (result === undefined) return <Loading />;
  if (result === null)
    return (
      <ErrorNote message="That experiment has no result on this computer. Run it and publish it first." />
    );
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={result.title} subtitle={result.question}>
        <Link href="/experiments" className="text-sm underline">
          All experiments
        </Link>
      </PageHeader>
      {result.kind === "team-groups" && <TeamGroupsView r={result} />}
      {result.kind === "title-odds" && <TitleOddsView r={result} />}
      {result.kind === "playoff-randomness" && <PlayoffView r={result} />}
      {result.kind === "swap-study" && <SwapView r={result} />}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Conclusion</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 text-sm">
          {result.conclusion ? (
            result.conclusion.split("\n").map((p, i) => <p key={i}>{p}</p>)
          ) : (
            <p className="text-muted-foreground">Not written yet.</p>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">How it was run</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          {result.runs.toLocaleString()} runs
          {result.seasons > 1 ? ` of ${result.seasons} seasons each` : ""}, from a{" "}
          {result.spec.start.type === "real" ? "real-league" : "generated"} start. Each run has its
          own seed, so the same file gives the same answer. Intervals are 95%: if you ran the
          experiment again, about 19 times in 20 the true figure would fall inside them.
          {result.spec.hold && result.spec.groups.length > 0
            ? " Managers and coaches who were fired and replaced were given the group's profile again, so it held all the way."
            : ""}
        </CardContent>
      </Card>
    </div>
  );
}

/** An estimate over its interval, stacked so a narrow table doesn't run off the page. */
function Gain({ i, f }: { i: Interval; f: (v: number) => string }) {
  return (
    <>
      <div className={clear(i) ? "font-medium" : ""}>{f(i.mean)}</div>
      <div className="text-xs text-muted-foreground">{range(i, f)}</div>
    </>
  );
}

function Section({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
        {note && <CardDescription>{note}</CardDescription>}
      </CardHeader>
      <CardContent className="flex flex-col gap-4">{children}</CardContent>
    </Card>
  );
}

function describeLever(l: Record<string, unknown>): string {
  const bits = (o: unknown) =>
    Object.entries((o as Record<string, number>) ?? {})
      .map(([k, v]) => `${k} ${v}`)
      .join(", ");
  switch (l.type) {
    case "gm":
      return `General manager: ${bits(l.knobs) || "all knobs neutral"}; skill ${l.skill}`;
    case "owner":
      return `Owner: ${bits(l.style) || "typical"}`;
    case "coach":
      return `${(l.roles as string[]).join(", ")}: ${[bits(l.ratings), bits(l.style)].filter(Boolean).join("; ")}`;
    case "quarterback":
      return `Quarterback: every passing attribute at ${l.level}`;
    default:
      return String(l.type);
  }
}

function Design({ groups }: { groups: TeamGroupsResult["spec"]["groups"] }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {groups.map((g, i) => (
        <div key={g.name} className="rounded-lg border p-3 text-sm">
          <div className="mb-1 flex items-center gap-2 font-medium">
            <span
              className="inline-block size-3 rounded-full"
              style={{ background: SERIES_COLORS[i] }}
            />
            {g.label}
          </div>
          <ul className="text-xs text-muted-foreground">
            {g.levers.length === 0 ? <li>Nothing changed</li> : null}
            {g.levers.map((l, k) => (
              <li key={k}>{describeLever(l as Record<string, unknown>)}</li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

const METRIC_LABEL: Record<string, string> = {
  winShare: "Win share, all seasons",
  titleShare: "Titles (share of team-seasons)",
  playoffRate: "Made the playoffs",
  winShareSpread: "Season-to-season swing",
  bestThreeYears: "Best three-season stretch",
  worstThreeYears: "Worst three-season stretch",
  deadMoneyShare: "Dead money (share of cap)",
  freeAgentSpend: "Free-agent spending (share of cap)",
  trades: "Trades a year",
};
const metricLabel = (name: string) => {
  const band = /^winShareYears(\d+)to(\d+)$/.exec(name);
  if (band)
    return band[1] === band[2]
      ? `Win share, year ${band[1]}`
      : `Win share, years ${band[1]}-${band[2]}`;
  return METRIC_LABEL[name] ?? name;
};
const metricFormat = (name: string) => (name === "trades" ? plain : (v: number) => pct(v, 2));

function TeamGroupsView({ r }: { r: TeamGroupsResult }) {
  const first = r.groups[0]!;
  const bandNames = r.bands.map(([a, b]) => `winShareYears${a}to${b}`);
  // Stretches and swings need at least three seasons to mean anything.
  const winRows = [
    "winShare",
    ...bandNames,
    ...(r.seasons >= 3 ? ["bestThreeYears", "worstThreeYears", "winShareSpread"] : []),
  ];
  const rateRows = ["playoffRate", "titleShare"];
  const moneyRows = ["deadMoneyShare", "freeAgentSpend", "trades"];
  return (
    <>
      <Section
        title="The groups"
        note="Each run splits the 32 teams of one league evenly between these, at random, and compares them inside that league."
      >
        <Design groups={r.spec.groups} />
      </Section>
      {r.differences.map((d) => {
        const g = r.groups.find((x) => x.name === d.group)!;
        const plot = (names: string[], f: (v: number) => string, label: string) => (
          <IntervalPlot
            ariaLabel={label}
            zero={0}
            format={f}
            rows={names
              .filter((m) => d.metrics[m])
              .map((m) => ({
                label: metricLabel(m),
                interval: d.metrics[m]!,
                color: SERIES_COLORS[1]!,
                note: clear(d.metrics[m]!)
                  ? "The interval leaves out zero."
                  : "The interval includes zero: no clear difference.",
              }))}
          />
        );
        return (
          <Section
            key={d.group}
            title={`${g.label} minus ${first.label}`}
            note="A dot is the average difference over all runs; the whisker is its 95% interval. The dashed line is no difference."
          >
            <div className="text-sm font-medium">Wins</div>
            {plot(
              winRows,
              points,
              "Difference in win share between the groups, with 95% intervals",
            )}
            <div className="text-sm font-medium">Playoffs and titles</div>
            {plot(rateRows, points, "Difference in playoff and title rates, with 95% intervals")}
            <div className="text-sm font-medium">Money and activity</div>
            {plot(
              ["deadMoneyShare", "freeAgentSpend"],
              points,
              "Difference in dead money and free-agent spending as shares of the cap",
            )}
            {plot(["trades"], signed, "Difference in trades a year")}
          </Section>
        );
      })}
      {r.seasons > 2 && (
        <Section
          title="Win share, season by season"
          note="Average win share of each group's teams, with a 95% band across runs. Hover for a season."
        >
          <TrajectoryChart
            ariaLabel="Average win share of each group by season"
            series={r.groups.map((g, i) => ({
              name: g.name,
              label: g.label,
              color: SERIES_COLORS[i]!,
              points: g.series,
            }))}
            format={(v) => pct(v, 1)}
            xLabel={(i) => `Season ${i + 1}`}
          />
          {r.differences.map((d) => (
            <TrajectoryChart
              key={d.group}
              ariaLabel={`Difference in win share by season, ${d.group} minus ${d.versus}`}
              series={[
                {
                  name: "difference",
                  label: `${d.group} minus ${d.versus}`,
                  color: SERIES_COLORS[2]!,
                  points: d.series,
                },
              ]}
              format={(v) => points(v)}
              xLabel={(i) => `Season ${i + 1}`}
            />
          ))}
        </Section>
      )}
      <Section title="The numbers">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Measure</TableHead>
              {r.groups.map((g) => (
                <TableHead key={g.name} className="text-right">
                  {g.name}
                </TableHead>
              ))}
              {r.differences.map((d) => (
                <TableHead key={d.group} className="text-right">
                  Difference (95% interval)
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {[...winRows, ...rateRows, ...moneyRows].map((m) => {
              const f = metricFormat(m);
              const df = m === "trades" ? signed : points;
              return (
                <TableRow key={m}>
                  <TableCell>{metricLabel(m)}</TableCell>
                  {r.groups.map((g) => (
                    <TableCell key={g.name} className="text-right tabular-nums">
                      {g.metrics[m] ? f(g.metrics[m]!.mean) : ""}
                    </TableCell>
                  ))}
                  {r.differences.map((d) => (
                    <TableCell key={d.group} className="text-right tabular-nums">
                      {d.metrics[m] ? <Gain i={d.metrics[m]!} f={df} /> : ""}
                    </TableCell>
                  ))}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
        <p className="text-xs text-muted-foreground">Bold: the interval leaves out zero.</p>
      </Section>
    </>
  );
}

function TitleOddsView({ r }: { r: TitleOddsResult }) {
  const top = r.teams.slice(0, 20);
  return (
    <>
      <Section
        title="Chance of winning the title"
        note={`Out of ${r.runs.toLocaleString()} replays of the same season. Whiskers are 95% intervals; the twenty likeliest teams are shown.`}
      >
        <IntervalPlot
          bars
          ariaLabel="Chance of winning the title for the twenty most likely teams, with 95% intervals"
          format={(v) => pct(v, 1)}
          rows={top.map((t) => ({
            label: t.id,
            interval: t.title,
            color: SERIES_COLORS[0]!,
            note: `Roster strength before the season ${pct(t.strength, 1)}`,
          }))}
        />
      </Section>
      <Section title="Every team">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Team</TableHead>
              <TableHead className="text-right">Roster strength</TableHead>
              <TableHead className="text-right">Win share</TableHead>
              <TableHead className="text-right">Swing (sd)</TableHead>
              <TableHead className="text-right">Playoffs</TableHead>
              <TableHead className="text-right">Final</TableHead>
              <TableHead className="text-right">Title</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {r.teams.map((t) => (
              <TableRow key={t.id}>
                <TableCell className="font-medium">{t.id}</TableCell>
                <TableCell className="text-right tabular-nums">{pct(t.strength, 1)}</TableCell>
                <TableCell className="text-right tabular-nums">{pct(t.winShare.mean, 1)}</TableCell>
                <TableCell className="text-right tabular-nums">{pct(t.winShareSd, 1)}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {pct(t.playoffs.mean, 0)} ({range(t.playoffs, (v) => pct(v, 0))})
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {pct(t.final.mean, 1)} ({range(t.final, (v) => pct(v, 1))})
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {pct(t.title.mean, 1)} ({range(t.title, (v) => pct(v, 1))})
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Section>
    </>
  );
}

function PlayoffView({ r }: { r: PlayoffResult }) {
  const flat = (v: number): Interval => ({ mean: v, lo: v, hi: v, n: 0, sd: 0 });
  return (
    <>
      <Section
        title="Who wins the title"
        note={`${r.runs} leagues, the real bracket replayed ${r.replays} times each from the same rosters. The strongest team is the one that wins most games on a neutral field against every other team.`}
      >
        <IntervalPlot
          bars
          ariaLabel="Chance of winning the title for the strongest team, the best record, and the one seeds, against a coin-flip bracket"
          format={(v) => pct(v, 0)}
          rows={[
            { label: "Strongest team", interval: r.strongestWinsTitle, color: SERIES_COLORS[0]! },
            ...(r.strongestMadePlayoffs.mean < 1
              ? [
                  {
                    label: "Strongest playoff team",
                    interval: r.strongestInPlayoffsWinsTitle,
                    color: SERIES_COLORS[0]!,
                  },
                ]
              : []),
            {
              label: "Best regular-season record",
              interval: r.bestRecordWinsTitle,
              color: SERIES_COLORS[1]!,
            },
            {
              label: "A one seed (either)",
              interval: r.topSeedsWinTitle,
              color: SERIES_COLORS[1]!,
            },
            {
              label: "A one seed, coin-flip games",
              interval: flat(0.25),
              color: SERIES_COLORS[2]!,
              note: "Two one seeds, each needing three wins: 1 in 8 apiece.",
            },
            {
              label: "Strongest team, coin-flip games",
              interval: flat(r.coinFlipStrongestTitle),
              color: SERIES_COLORS[2]!,
              note: "A one seed gets a bye and needs three wins (1 in 8); a lower seed needs four (1 in 16).",
            },
          ]}
        />
      </Section>
      <Section title="The numbers">
        <Table>
          <TableBody>
            {(
              [
                ["Strongest team wins the title", r.strongestWinsTitle],
                ["Strongest team reaches the final", r.strongestReachesFinal],
                ["Strongest team makes the playoffs", r.strongestMadePlayoffs],
                ["Strongest team in the playoffs wins the title", r.strongestInPlayoffsWinsTitle],
                ["Best regular-season record wins the title", r.bestRecordWinsTitle],
                ["A one seed wins the title", r.topSeedsWinTitle],
              ] as [string, Interval][]
            ).map(([label, i]) => (
              <TableRow key={label}>
                <TableCell>{label}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {pct(i.mean, 1)} ({range(i, (v) => pct(v, 1))})
                </TableCell>
              </TableRow>
            ))}
            <TableRow>
              <TableCell>Strongest team if every game were a coin flip</TableCell>
              <TableCell className="text-right tabular-nums">
                {pct(r.coinFlipStrongestTitle, 1)}
              </TableCell>
            </TableRow>
            <TableRow>
              <TableCell>Different champions in {r.replays} replays of one bracket</TableCell>
              <TableCell className="text-right tabular-nums">
                {r.distinctChampions.mean.toFixed(1)} (
                {range(r.distinctChampions, (v) => v.toFixed(1))})
              </TableCell>
            </TableRow>
            <TableRow>
              <TableCell>Neutral-field win share: best, median, worst team</TableCell>
              <TableCell className="text-right tabular-nums">
                {pct(r.strengthSpread.best.mean, 0)}, {pct(r.strengthSpread.median.mean, 0)},{" "}
                {pct(r.strengthSpread.worst.mean, 0)}
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </Section>
    </>
  );
}

function SwapView({ r }: { r: SwapResult }) {
  const first = r.conditions[0]!;
  const rest = r.differences;
  const colorOf = (name: string) =>
    SERIES_COLORS[r.conditions.findIndex((c) => c.name === name)] ?? SERIES_COLORS[1]!;
  const labelOf = (name: string) => r.conditions.find((c) => c.name === name)?.label ?? name;
  const plot = (
    pick: (d: SwapResult["differences"][number]) => Interval | null,
    f: (v: number) => string,
    label: string,
  ) => {
    const rows = rest.flatMap((d) => {
      const i = pick(d);
      return i
        ? [
            {
              label: labelOf(d.name),
              interval: i,
              color: colorOf(d.name),
              note: clear(i) ? "The interval leaves out zero." : "No clear difference.",
            },
          ]
        : [];
    });
    return rows.length ? <IntervalPlot ariaLabel={label} zero={0} format={f} rows={rows} /> : null;
  };
  return (
    <>
      <Section
        title="What each change is worth"
        note={`Each run picks one team and plays it as built (${first.label.toLowerCase()}) and with each change, in copies of the same league. A dot is the average gain; the whisker is its 95% interval.`}
      >
        <Design groups={r.spec.groups} />
        <div className="text-sm font-medium">
          Win share on neutral fields against every other team ({r.gamesPerOpponent} games each)
        </div>
        {plot(
          (d) => d.winShare,
          points,
          "Gain in neutral-field win share for each change, with 95% intervals",
        )}
        <div className="text-sm font-medium">Points per game, scored minus allowed</div>
        {plot((d) => d.pointDiff, signed, "Gain in points per game for each change")}
        <div className="text-sm font-medium">The team's win share over a full season</div>
        {plot((d) => d.season, points, "Gain in win share over a full season for each change")}
      </Section>
      <Section title="The numbers">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Condition</TableHead>
              <TableHead className="text-right">Neutral win share</TableHead>
              <TableHead className="text-right">Points per game</TableHead>
              <TableHead className="text-right">Full season</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {r.conditions.map((c) => (
              <TableRow key={c.name}>
                <TableCell>{c.label}</TableCell>
                <TableCell className="text-right tabular-nums">{pct(c.winShare.mean, 1)}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {signed(c.pointDiff.mean)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {c.season ? pct(c.season.mean, 1) : "-"}
                </TableCell>
              </TableRow>
            ))}
            {rest.map((d) => (
              <TableRow key={`d-${d.name}`}>
                <TableCell className="text-muted-foreground">Gain: {labelOf(d.name)}</TableCell>
                <TableCell className="text-right tabular-nums">
                  <Gain i={d.winShare} f={points} />
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  <Gain i={d.pointDiff} f={signed} />
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {d.season ? <Gain i={d.season} f={points} /> : "-"}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Section>
    </>
  );
}
