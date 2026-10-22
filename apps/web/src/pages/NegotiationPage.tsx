/**
 * The negotiation screen (Phase 12): a player's market value and ask (and
 * why), his agent and priorities, how he sees the team, the talks so far, and
 * an offer form with what it does to the cap. Until GM Mode the league office
 * negotiates for the team you're viewing as (or one you pick).
 */
import type { Offer } from "@fgm/sim-core";
import { useEffect, useState } from "react";
import { Link } from "wouter";
import { ErrorNote, Facts, Loading, OverallBadge, RatingBar } from "@/components/shared";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/input";
import { useLeagueKey, useSession } from "@/lib/session";
import { call, useSim } from "@/sim/client";
import { millions } from "./FreeAgencyPage";

// Rounded up, so an offer typed from his ask never falls a few dollars short of it.
const toMillions = (d: number) => Math.ceil(d / 10_000) / 100;
const fromMillions = (m: number) => Math.round(m * 1_000_000);

export function NegotiationPage({ playerId }: { playerId: number }) {
  const { bump } = useSession();
  const options = useSim("viewingOptions", {}, useLeagueKey());
  const [picked, setPicked] = useState<string | null>(null);
  const teamId = options.data?.current ?? picked ?? options.data?.teams[0]?.id ?? "";
  const view = useSim(
    "negotiationView",
    { playerId, teamId },
    useLeagueKey(`neg:${playerId}:${teamId}`),
  );
  const [form, setForm] = useState({ years: 1, apy: 0, guaranteed: 0, signingBonus: 0 });
  const [message, setMessage] = useState<string | null>(null);
  const v = view.data;
  // Start the form at his counter (if any), else his ask.
  useEffect(() => {
    if (!v) return;
    const start: Offer = v.talks?.counter ?? v.ask;
    setForm({
      years: start.years,
      apy: toMillions(start.apy),
      guaranteed: toMillions(start.guaranteed),
      signingBonus: toMillions(start.signingBonus),
    });
  }, [v?.player.id, v?.team.id, v?.talks?.rounds]);

  if (view.error) return <ErrorNote message={view.error} />;
  if (!v) return <Loading what="Loading talks" />;

  const submit = () =>
    call("makeOffer", {
      playerId,
      teamId,
      offer: {
        years: form.years,
        apy: fromMillions(form.apy),
        guaranteed: fromMillions(form.guaranteed),
        signingBonus: fromMillions(form.signingBonus),
      },
    }).then(
      (r) => {
        setMessage(r.message);
        bump();
      },
      (e: unknown) => setMessage(String(e)),
    );

  const total = form.apy * form.years;
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-4">
        <OverallBadge value={v.player.overall} className="h-14 w-14 text-xl" />
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">
            <Link href={`/player/${v.player.id}`} className="hover:underline">
              {v.player.name}
            </Link>
          </h2>
          <div className="text-sm text-muted-foreground">
            {v.player.position} · age {v.player.age} · {v.player.experience} seasons ·{" "}
            {v.player.team ?? "free agent"}
          </div>
        </div>
        {!options.data?.current && (
          <label className="ml-auto flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">Negotiating for</span>
            <Select value={teamId} onChange={(e) => setPicked(e.target.value)} aria-label="Team">
              {options.data?.teams.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </Select>
          </label>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>What he wants</CardTitle>
          <CardDescription>{v.why}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <Facts
            items={[
              [
                "Market value",
                `${millions(v.market.apy)} a year (${(v.market.share * 100).toFixed(1)}% of the cap)`,
              ],
              ["His ask", `${millions(v.ask.apy)} a year, ${v.ask.years} years`],
              ["Guaranteed", millions(v.ask.guaranteed)],
              ["Years he'll consider", `${v.ask.minYears}–${v.ask.maxYears}`],
              ["Agent", `${v.agent.name}, ${v.agent.agency} (${v.agent.style})`],
              [
                "How he sees the team",
                `${v.appeal.score >= 0.3 ? "Keen" : v.appeal.score <= -0.3 ? "Reluctant" : "Neutral"} (${v.appeal.score.toFixed(2)})`,
              ],
            ]}
          />
          <ul className="list-disc pl-5 text-sm text-muted-foreground">
            {v.reasons.map((r) => (
              <li key={r}>{r}</li>
            ))}
            {v.appeal.reasons.length > 0 && (
              <li>
                About {v.team.name}: he {v.appeal.reasons.join(", ")}.
              </li>
            )}
          </ul>
          <div className="grid max-w-md gap-1">
            <div className="text-xs text-muted-foreground">What matters to him</div>
            <RatingBar label="Money" value={v.priorities.money} />
            <RatingBar label="Winning" value={v.priorities.winning} />
            <RatingBar label="Role" value={v.priorities.role} />
            <RatingBar label="Location" value={v.priorities.location} />
          </div>
        </CardContent>
      </Card>

      {!v.kind && v.talks && (
        <Card>
          <CardHeader>
            <CardTitle>
              Talks with {v.team.name}: {v.talks.status === "agreed" ? "agreed" : "over"}
            </CardTitle>
            <CardDescription>{v.talks.reason}</CardDescription>
          </CardHeader>
        </Card>
      )}
      {v.kind && (
        <Card>
          <CardHeader>
            <CardTitle>Make an offer for {v.team.name}</CardTitle>
            <CardDescription>
              {v.talks
                ? `Round ${v.talks.rounds}: ${v.talks.reason}`
                : "Meeting his ask in every part always works; far below it ends talks."}{" "}
              Room now {millions(v.cap.roomNow)} this League Year, {millions(v.cap.roomNext)} next;
              at his ask: {millions(v.cap.afterAsk.now)} and {millions(v.cap.afterAsk.next)}.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 text-sm">
            <div className="flex flex-wrap items-end gap-3">
              {(
                [
                  ["years", "Years", 1],
                  ["apy", "A year ($M)", 0.1],
                  ["guaranteed", "Guaranteed ($M)", 0.1],
                  ["signingBonus", "Signing bonus ($M)", 0.1],
                ] as const
              ).map(([key, label, step]) => (
                <label key={key} className="flex flex-col gap-1">
                  <span className="text-xs text-muted-foreground">{label}</span>
                  <Input
                    type="number"
                    step={step}
                    min={0}
                    value={form[key]}
                    onChange={(e) => setForm({ ...form, [key]: Number(e.target.value) })}
                    className="w-32"
                  />
                </label>
              ))}
              <Button
                onClick={() => void submit()}
                disabled={v.talks?.status === "ended" || v.talks?.status === "agreed"}
              >
                Make offer
              </Button>
            </div>
            <div className="text-xs text-muted-foreground">
              Total {millions(fromMillions(total))} over {form.years} year
              {form.years === 1 ? "" : "s"}.
            </div>
            {message && <p className="font-medium">{message}</p>}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
