import type { PlayoffRound, ScheduleSelection } from "@fgm/sim-core";
import { useState } from "react";
import { GameRow } from "@/components/GameRow";
import { ErrorNote, Loading, PageHeader, TeamChip } from "@/components/shared";
import { Button } from "@/components/ui/button";
import { formatLeagueDate } from "@/lib/format";
import { useLeagueKey } from "@/lib/session";
import { useSim } from "@/sim/client";

export const ROUND_LABELS: Record<PlayoffRound, string> = {
  wildcard: "Wild card",
  divisional: "Divisional",
  conference: "Conference",
  championship: "Championship",
};

export function SchedulePage() {
  const [selection, setSelection] = useState<ScheduleSelection | undefined>(undefined);
  const key = selection
    ? selection.kind === "week"
      ? `w${selection.week}`
      : selection.round
    : "now";
  const view = useSim("scheduleView", { selection }, useLeagueKey(key));
  if (view.error) return <ErrorNote message={view.error} />;
  if (!view.data) return <Loading />;
  const v = view.data;
  const sel = v.selection;
  const isSelected = (s: ScheduleSelection) =>
    s.kind === sel.kind &&
    (s.kind === "week"
      ? s.week === (sel as { week: number }).week
      : s.round === (sel as { round: string }).round);
  const title = sel.kind === "week" ? `Week ${sel.week}` : `${ROUND_LABELS[sel.round]} round`;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={`${v.season} schedule`}
        subtitle={`${title}${v.games[0] ? ` · ${formatLeagueDate(v.games[0].date)}` : ""}`}
      />
      <div className="flex flex-wrap gap-1">
        {v.weeks.map((w) => (
          <Button
            key={w}
            size="sm"
            variant={isSelected({ kind: "week", week: w }) ? "default" : "outline"}
            className="w-9 px-0"
            onClick={() => setSelection({ kind: "week", week: w })}
          >
            {w}
          </Button>
        ))}
        {v.rounds.map((r) => (
          <Button
            key={r}
            size="sm"
            variant={isSelected({ kind: "round", round: r }) ? "default" : "outline"}
            onClick={() => setSelection({ kind: "round", round: r })}
          >
            {ROUND_LABELS[r]}
          </Button>
        ))}
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {v.games.map((g) => (
          <GameRow key={g.id} game={g} />
        ))}
      </div>
      {v.games.length === 0 && <p className="text-sm text-muted-foreground">No games yet.</p>}
      {v.byes.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted-foreground">On bye:</span>
          {v.byes.map((t) => (
            <TeamChip key={t.id} team={t} />
          ))}
        </div>
      )}
    </div>
  );
}
