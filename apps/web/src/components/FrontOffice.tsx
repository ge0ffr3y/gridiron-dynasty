/**
 * A team's front office (Phase 13): its GM and his leanings, its owner, where the GM thinks the
 * team stands and why, the cap outlook, its biggest needs, and its recent trades with how it
 * valued each one.
 */
import { formatLeagueDate } from "@/lib/format";
import { ErrorNote, Loading } from "@/components/shared";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useLeagueKey } from "@/lib/session";
import { useSim } from "@/sim/client";

const STANCE_WORDS: Record<string, string> = {
  contend: "Contending",
  retool: "Retooling",
  rebuild: "Rebuilding",
};

/** A knob from -1 to 1 as a bar from the middle. */
function Knob({ low, high, value }: { low: string; high: string; value: number }) {
  const width = Math.abs(value) * 50;
  return (
    <div className="grid grid-cols-[8rem_1fr_8rem] items-center gap-2 text-xs">
      <span className="text-right text-muted-foreground">{low}</span>
      <div className="relative h-2 rounded bg-muted">
        <div className="absolute inset-y-0 left-1/2 w-px bg-border" />
        <div
          className="absolute inset-y-0 rounded bg-primary"
          style={
            value >= 0 ? { left: "50%", width: `${width}%` } : { right: "50%", width: `${width}%` }
          }
        />
      </div>
      <span className="text-muted-foreground">{high}</span>
    </div>
  );
}

export function FrontOffice({ teamId }: { teamId: string }) {
  const view = useSim("frontOfficeView", { teamId }, useLeagueKey(`fo:${teamId}`));
  if (view.error) return <ErrorNote message={view.error} />;
  if (!view.data) return <Loading />;
  const v = view.data;
  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>General manager</CardTitle>
            <CardDescription>
              {v.gm
                ? `${v.gm.name}, ${v.gm.age}. ${v.gm.archetype}. Running the team since ${v.gm.hiredSeason}${v.gm.contractThrough ? `, signed through ${v.gm.contractThrough}` : ""}.`
                : "The job is open."}
            </CardDescription>
          </CardHeader>
          {v.gm && (
            <CardContent className="flex flex-col gap-2">
              {v.gm.knobs.map((k) => (
                <Knob key={k.key} low={k.low} high={k.high} value={k.value} />
              ))}
              {v.gm.leanings.length > 0 && (
                <p className="text-sm text-muted-foreground">{v.gm.leanings.join(". ")}.</p>
              )}
            </CardContent>
          )}
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Owner</CardTitle>
            <CardDescription>
              {v.owner
                ? `${v.owner.name}, ${v.owner.age}. ${v.owner.traits.length ? `${v.owner.traits.join(", ")}.` : "Typical in every way."}`
                : "Unknown."}
            </CardDescription>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Owners judge the GM and the head coach, and hire and fire them (coming in Phase 13b).
          </CardContent>
        </Card>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>{v.plan ? STANCE_WORDS[v.plan.stance] : "Not read yet"}</CardTitle>
          <CardDescription>
            {v.plan
              ? `The GM's read as of ${formatLeagueDate(v.plan.date)}: starters ${v.plan.strength} now, ${v.plan.future} projected in two years (his staff's eyes).`
              : "The GM reads where the team stands at the League Year, camp and the trade deadline."}
          </CardDescription>
        </CardHeader>
        {v.plan && (
          <CardContent className="flex flex-col gap-3 text-sm">
            <ul className="list-disc pl-5">
              {v.plan.reasons.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
            <div className="flex flex-wrap gap-4">
              {v.plan.capRoom.map((c) => (
                <div key={c.season}>
                  <div className="text-xs text-muted-foreground">Cap room {c.season}</div>
                  <div className={`tabular-nums ${c.share < 0 ? "text-destructive" : ""}`}>
                    {Math.round(c.share * 1000) / 10}% of the cap
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        )}
      </Card>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Biggest needs</CardTitle>
            <CardDescription>
              By the staff's read of its starters, their age and depth (0-1).
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-1 text-sm">
            {v.needs.length === 0 && (
              <span className="text-muted-foreground">None to speak of.</span>
            )}
            {v.needs.map((n) => (
              <div key={n.position} className="flex items-center gap-2">
                <span className="w-12">{n.position}</span>
                <div className="h-2 flex-1 rounded bg-muted">
                  <div className="h-2 rounded bg-primary" style={{ width: `${n.need * 100}%` }} />
                </div>
                <span className="w-10 text-right tabular-nums">{n.need.toFixed(2)}</span>
              </div>
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Recent trades</CardTitle>
            <CardDescription>
              What the GM gave and got, in his own eyes (draft-pick value; the #1 pick is about 62).
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 text-sm">
            {v.trades.length === 0 && <span className="text-muted-foreground">None yet.</span>}
            {v.trades.map((t, i) => (
              <div key={`${t.date}-${i}`}>
                <div>{t.text}</div>
                <div className="text-xs text-muted-foreground">
                  {formatLeagueDate(t.date)} · with {t.partner} · gave {t.gave.toFixed(1)}, got{" "}
                  {t.got.toFixed(1)}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
