/**
 * Charts for experiment results (Phase 17), hand-drawn SVG like the other charts: a dot-and-whisker
 * (or bar-and-whisker) plot for estimates with 95% intervals, and a line chart with an interval band
 * for a measure season by season. Colors are the theme's chart tokens; every chart sits above a table
 * with the same numbers, and the third color (aqua) is always labelled, never color alone.
 */
import { useRef, useState, type PointerEvent } from "react";
import type { Interval } from "@/lib/experiments";

export const SERIES_COLORS = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)"];

/** Round tick values covering [lo, hi]. */
function ticksFor(lo: number, hi: number, count = 5): number[] {
  const span = hi - lo || 1;
  const raw = span / count;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s >= raw) ?? raw;
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-9; v += step)
    out.push(Math.round(v / step) * step);
  return out;
}

const W = 720;

export interface PlotRow {
  label: string;
  interval: Interval;
  color: string;
  /** Extra text for the tooltip. */
  note?: string;
}

/** Estimates with 95% intervals: a dot (or a bar from zero) and a whisker per row. */
export function IntervalPlot({
  rows,
  format,
  zero,
  bars,
  ariaLabel,
}: {
  rows: PlotRow[];
  format: (v: number) => string;
  /** A reference line (no difference, or a coin flip). */
  zero?: number;
  bars?: boolean;
  ariaLabel: string;
}) {
  const [active, setActive] = useState<number | null>(null);
  if (rows.length === 0) return null;
  const labelW = 230;
  const rowH = 30;
  const top = 8;
  const H = top + rows.length * rowH + 28;
  const values = rows.flatMap((r) => [r.interval.lo, r.interval.hi]);
  if (zero !== undefined) values.push(zero);
  if (bars) values.push(0);
  let lo = Math.min(...values);
  let hi = Math.max(...values);
  const pad = (hi - lo || 1) * 0.06;
  lo -= pad;
  hi += pad;
  const x = (v: number) => labelW + ((v - lo) / (hi - lo)) * (W - labelW - 16);
  const ticks = ticksFor(lo, hi);
  const row = active === null ? null : rows[active]!;

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-auto w-full select-none"
        role="img"
        aria-label={ariaLabel}
      >
        {ticks.map((t) => (
          <g key={t}>
            <line x1={x(t)} x2={x(t)} y1={top} y2={H - 24} stroke="var(--border)" strokeWidth={1} />
            <text
              x={x(t)}
              y={H - 8}
              fontSize={11}
              textAnchor="middle"
              fill="var(--muted-foreground)"
            >
              {format(t)}
            </text>
          </g>
        ))}
        {zero !== undefined && (
          <line
            x1={x(zero)}
            x2={x(zero)}
            y1={top}
            y2={H - 24}
            stroke="var(--muted-foreground)"
            strokeWidth={1.5}
            strokeDasharray="4 3"
          />
        )}
        {rows.map((r, i) => {
          const cy = top + i * rowH + rowH / 2;
          return (
            <g
              key={r.label}
              onPointerEnter={() => setActive(i)}
              onPointerLeave={() => setActive(null)}
              opacity={active === null || active === i ? 1 : 0.55}
            >
              {/* A wide invisible target, bigger than the mark. */}
              <rect x={0} y={cy - rowH / 2} width={W} height={rowH} fill="transparent" />
              <text
                x={labelW - 10}
                y={cy + 4}
                fontSize={12}
                textAnchor="end"
                fill="var(--foreground)"
              >
                {r.label}
              </text>
              {bars && (
                <rect
                  x={Math.min(x(0), x(r.interval.mean))}
                  y={cy - 7}
                  width={Math.abs(x(r.interval.mean) - x(0))}
                  height={14}
                  rx={3}
                  fill={r.color}
                  opacity={0.85}
                />
              )}
              <line
                x1={x(r.interval.lo)}
                x2={x(r.interval.hi)}
                y1={cy}
                y2={cy}
                stroke={bars ? "var(--foreground)" : r.color}
                strokeWidth={2}
              />
              <line
                x1={x(r.interval.lo)}
                x2={x(r.interval.lo)}
                y1={cy - 5}
                y2={cy + 5}
                stroke={bars ? "var(--foreground)" : r.color}
                strokeWidth={2}
              />
              <line
                x1={x(r.interval.hi)}
                x2={x(r.interval.hi)}
                y1={cy - 5}
                y2={cy + 5}
                stroke={bars ? "var(--foreground)" : r.color}
                strokeWidth={2}
              />
              {!bars && (
                <circle
                  cx={x(r.interval.mean)}
                  cy={cy}
                  r={5}
                  fill={r.color}
                  stroke="var(--card)"
                  strokeWidth={2}
                />
              )}
            </g>
          );
        })}
      </svg>
      {row && (
        <div
          className="pointer-events-none absolute right-2 top-0 rounded-md border bg-popover px-3 py-2 text-xs shadow-md"
          role="status"
        >
          <div className="font-medium">{row.label}</div>
          <div>
            {format(row.interval.mean)} (95% interval {format(row.interval.lo)} to{" "}
            {format(row.interval.hi)})
          </div>
          {row.note && <div className="text-muted-foreground">{row.note}</div>}
        </div>
      )}
    </div>
  );
}

export interface LineSeries {
  name: string;
  label: string;
  color: string;
  points: Interval[];
}

/** A measure season by season for each group: a line with its 95% band; hover for each season. */
export function TrajectoryChart({
  series,
  format,
  xLabel,
  ariaLabel,
}: {
  series: LineSeries[];
  format: (v: number) => string;
  xLabel: (i: number) => string;
  ariaLabel: string;
}) {
  const [active, setActive] = useState<number | null>(null);
  const svg = useRef<SVGSVGElement>(null);
  const n = series[0]?.points.length ?? 0;
  if (n === 0) return null;
  const H = 260;
  const PAD = { left: 48, right: 90, top: 14, bottom: 30 };
  const all = series.flatMap((s) => s.points.flatMap((p) => [p.lo, p.hi]));
  let lo = Math.min(...all);
  let hi = Math.max(...all);
  const pad = (hi - lo || 1) * 0.08;
  lo -= pad;
  hi += pad;
  const x = (i: number) => PAD.left + (n === 1 ? 0.5 : i / (n - 1)) * (W - PAD.left - PAD.right);
  const y = (v: number) => PAD.top + ((hi - v) / (hi - lo)) * (H - PAD.top - PAD.bottom);
  const ticks = ticksFor(lo, hi);
  const every = n > 14 ? 3 : n > 8 ? 2 : 1;
  const nearest = (clientX: number) => {
    const box = svg.current?.getBoundingClientRect();
    if (!box) return null;
    const at = ((clientX - box.left) / box.width) * W;
    let best = 0;
    for (let i = 1; i < n; i++) if (Math.abs(x(i) - at) < Math.abs(x(best) - at)) best = i;
    return best;
  };
  const line = (pts: Interval[]) =>
    pts.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.mean).toFixed(1)}`).join("");
  const band = (pts: Interval[]) =>
    pts.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.hi).toFixed(1)}`).join("") +
    [...pts]
      .reverse()
      .map((p, k) => `L${x(n - 1 - k).toFixed(1)},${y(p.lo).toFixed(1)}`)
      .join("") +
    "Z";

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-4 text-xs" aria-hidden>
        {series.map((s) => (
          <span key={s.name} className="flex items-center gap-1.5">
            <span className="inline-block h-0.5 w-5" style={{ background: s.color }} />
            {s.label}
          </span>
        ))}
      </div>
      <div className="relative">
        <svg
          ref={svg}
          viewBox={`0 0 ${W} ${H}`}
          className="h-auto w-full touch-none select-none"
          role="img"
          aria-label={ariaLabel}
          onPointerMove={(e: PointerEvent<SVGSVGElement>) => setActive(nearest(e.clientX))}
          onPointerLeave={() => setActive(null)}
        >
          {ticks.map((t) => (
            <g key={t}>
              <line
                x1={PAD.left}
                x2={W - PAD.right}
                y1={y(t)}
                y2={y(t)}
                stroke="var(--border)"
                strokeWidth={1}
              />
              <text
                x={PAD.left - 8}
                y={y(t) + 4}
                fontSize={11}
                textAnchor="end"
                fill="var(--muted-foreground)"
              >
                {format(t)}
              </text>
            </g>
          ))}
          {Array.from({ length: n }, (_, i) =>
            i % every === 0 || i === n - 1 ? (
              <text
                key={i}
                x={x(i)}
                y={H - 10}
                fontSize={11}
                textAnchor="middle"
                fill="var(--muted-foreground)"
              >
                {xLabel(i)}
              </text>
            ) : null,
          )}
          {active !== null && (
            <line
              x1={x(active)}
              x2={x(active)}
              y1={PAD.top}
              y2={H - PAD.bottom}
              stroke="var(--muted-foreground)"
              strokeWidth={1}
              strokeDasharray="3 3"
            />
          )}
          {series.map((s) => (
            <g key={s.name}>
              <path d={band(s.points)} fill={s.color} opacity={0.16} />
              <path
                d={line(s.points)}
                fill="none"
                stroke={s.color}
                strokeWidth={2}
                strokeLinejoin="round"
              />
              {active !== null && (
                <circle
                  cx={x(active)}
                  cy={y(s.points[active]!.mean)}
                  r={4}
                  fill={s.color}
                  stroke="var(--card)"
                  strokeWidth={2}
                />
              )}
              <text
                x={x(n - 1) + 8}
                y={y(s.points[n - 1]!.mean) + 4}
                fontSize={11}
                fill="var(--foreground)"
              >
                {s.name}
              </text>
            </g>
          ))}
        </svg>
        {active !== null && (
          <div
            className="pointer-events-none absolute right-2 top-0 rounded-md border bg-popover px-3 py-2 text-xs shadow-md"
            role="status"
          >
            <div className="font-medium">{xLabel(active)}</div>
            {series.map((s) => (
              <div key={s.name}>
                <span
                  className="mr-1.5 inline-block size-2 rounded-full"
                  style={{ background: s.color }}
                />
                {s.name}: {format(s.points[active]!.mean)} ({format(s.points[active]!.lo)} to{" "}
                {format(s.points[active]!.hi)})
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
