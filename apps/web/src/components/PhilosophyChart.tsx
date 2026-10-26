/**
 * A coach's philosophy (Phase 10): each tendency as a bar left or right of the
 * league average, sized in spreads between real teams (so a full bar is about
 * as far from average as the most extreme real teams). His own side of the
 * ball is in the series color; the rest (how he'd coach if he moved) is muted.
 * Every bar carries its value in points, so the numbers never depend on color.
 */
import type { CoachView } from "@fgm/sim-core";

const SIDE_NAMES = { offense: "Offense", defense: "Defense", game: "Game management" } as const;

export function PhilosophyChart({ lines }: { lines: CoachView["philosophy"] }) {
  const max = 2.5;
  return (
    <div className="flex flex-col gap-1.5" role="list" aria-label="Coaching philosophy">
      <div className="grid grid-cols-[minmax(5.5rem,12rem)_1fr_3.5rem] sm:grid-cols-[minmax(8rem,12rem)_1fr_4.5rem] items-center gap-3 text-xs text-muted-foreground">
        <span />
        <div className="flex justify-between">
          <span>less than average</span>
          <span>league average</span>
          <span>more than average</span>
        </div>
        <span />
      </div>
      {lines.map((l) => {
        const width = (Math.abs(l.standard) / max) * 50;
        const left = l.standard >= 0 ? 50 : 50 - width;
        return (
          <div
            key={l.key}
            role="listitem"
            className="grid grid-cols-[minmax(5.5rem,12rem)_1fr_3.5rem] sm:grid-cols-[minmax(8rem,12rem)_1fr_4.5rem] items-center gap-3 text-sm"
            title={`${l.label}: ${l.points >= 0 ? "+" : ""}${l.points} points against the league average (${SIDE_NAMES[l.side].toLowerCase()})${l.active ? "" : "; not part of his current job"}`}
          >
            <span className={l.active ? "" : "text-muted-foreground"}>{l.label}</span>
            <div className="relative h-3">
              <div className="absolute inset-y-0 left-1/2 w-px bg-border" />
              <div
                className="absolute inset-y-0.5 rounded-sm"
                style={{
                  left: `${left}%`,
                  width: `${Math.max(width, 0.5)}%`,
                  background: l.active ? "var(--chart-1)" : "var(--muted-foreground)",
                  opacity: l.active ? 1 : 0.35,
                }}
              />
            </div>
            <span className={`text-right tabular-nums ${l.active ? "" : "text-muted-foreground"}`}>
              {l.points >= 0 ? "+" : ""}
              {l.points.toFixed(1)} pts
            </span>
          </div>
        );
      })}
    </div>
  );
}
