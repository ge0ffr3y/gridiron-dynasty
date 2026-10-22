/**
 * A player's career arc (Phase 9b): his overall at the end of each season
 * (as your staff sees it), with this season so far as an open dot. Hover or
 * use the arrow keys for each season's age, team and position; the table
 * below the chart has the same numbers.
 */
import type { PlayerView } from "@fgm/sim-core";
import { useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type Point = PlayerView["ratingHistory"][number];

const LINE = "var(--chart-1)";
const W = 720;
const H = 220;
const PAD = { left: 40, right: 16, top: 16, bottom: 28 };

export function RatingHistoryChart({ points }: { points: Point[] }) {
  const [active, setActive] = useState<number | null>(null);
  const svg = useRef<SVGSVGElement>(null);
  if (points.length === 0) return null;

  // A y range that leaves room around the arc, on whole tens/fives.
  const values = points.map((p) => p.overall);
  const low = Math.max(25, Math.floor((Math.min(...values) - 4) / 5) * 5);
  const high = Math.min(100, Math.ceil((Math.max(...values) + 4) / 5) * 5);
  const ticks: number[] = [];
  const step = high - low > 30 ? 10 : 5;
  for (let v = Math.ceil(low / step) * step; v <= high; v += step) ticks.push(v);
  const n = points.length;
  const x = (i: number) =>
    n === 1
      ? (PAD.left + W - PAD.right) / 2
      : PAD.left + (i / (n - 1)) * (W - PAD.left - PAD.right);
  const y = (v: number) => PAD.top + ((high - v) / (high - low)) * (H - PAD.top - PAD.bottom);
  const done = points.filter((p) => !p.now);
  const path = (list: Point[], from: number) =>
    list
      .map((p, i) => `${i ? "L" : "M"}${x(from + i).toFixed(1)},${y(p.overall).toFixed(1)}`)
      .join("");
  const last = points.at(-1)!;
  const best = points.reduce((a, b) => (b.overall > a.overall ? b : a));

  const nearest = (clientX: number) => {
    const box = svg.current?.getBoundingClientRect();
    if (!box) return null;
    const at = ((clientX - box.left) / box.width) * W;
    let bestI = 0;
    for (let i = 1; i < n; i++) if (Math.abs(x(i) - at) < Math.abs(x(bestI) - at)) bestI = i;
    return bestI;
  };
  const onMove = (e: PointerEvent<SVGSVGElement>) => setActive(nearest(e.clientX));
  const onKey = (e: KeyboardEvent<SVGSVGElement>) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const s = e.key === "ArrowRight" ? 1 : -1;
    setActive((i) => Math.max(0, Math.min(n - 1, (i ?? (s > 0 ? -1 : n)) + s)));
  };
  const point = active === null ? null : points[active]!;
  // Only label every other season when there are many.
  const labelEvery = n > 14 ? 3 : n > 8 ? 2 : 1;

  return (
    <div className="flex flex-col gap-3">
      <div className="relative">
        <svg
          ref={svg}
          viewBox={`0 0 ${W} ${H}`}
          className="h-auto w-full touch-none select-none outline-none focus-visible:ring-2 focus-visible:ring-ring"
          role="img"
          aria-label={`Overall by season, ${points[0]!.season} to ${last.season}: from ${points[0]!.overall} to ${last.overall}, best ${best.overall} in ${best.season}. Use the arrow keys to step through seasons.`}
          tabIndex={0}
          onPointerMove={onMove}
          onPointerLeave={() => setActive(null)}
          onKeyDown={onKey}
          onBlur={() => setActive(null)}
        >
          {ticks.map((v) => (
            <g key={v}>
              <line
                x1={PAD.left}
                x2={W - PAD.right}
                y1={y(v)}
                y2={y(v)}
                stroke="var(--border)"
                strokeWidth={1}
              />
              <text
                x={PAD.left - 8}
                y={y(v) + 4}
                fontSize={11}
                textAnchor="end"
                fill="var(--muted-foreground)"
              >
                {v}
              </text>
            </g>
          ))}
          {points.map((p, i) =>
            i % labelEvery === 0 || i === n - 1 ? (
              <text
                key={p.season}
                x={x(i)}
                y={H - 8}
                fontSize={11}
                textAnchor="middle"
                fill="var(--muted-foreground)"
              >
                {p.season}
              </text>
            ) : null,
          )}
          {point && (
            <line
              x1={x(active!)}
              x2={x(active!)}
              y1={PAD.top}
              y2={H - PAD.bottom}
              stroke="var(--muted-foreground)"
              strokeWidth={1}
              strokeDasharray="3 3"
            />
          )}
          <path
            d={path(done, 0)}
            fill="none"
            stroke={LINE}
            strokeWidth={2}
            strokeLinejoin="round"
          />
          {last.now && done.length > 0 && (
            <path
              d={path([done.at(-1)!, last], done.length - 1)}
              fill="none"
              stroke={LINE}
              strokeWidth={2}
              strokeDasharray="4 4"
            />
          )}
          {points.map((p, i) => (
            <circle
              key={p.season}
              cx={x(i)}
              cy={y(p.overall)}
              r={active === i ? 5.5 : 4}
              fill={p.now ? "var(--card)" : LINE}
              stroke={p.now ? LINE : "var(--card)"}
              strokeWidth={2}
            />
          ))}
          {/* Direct label on the latest point. */}
          <text
            x={x(n - 1) + (n === 1 ? 10 : -10)}
            y={y(last.overall) - 10}
            fontSize={12}
            textAnchor={n === 1 ? "start" : "end"}
            fill="var(--foreground)"
          >
            {last.overall}
          </text>
        </svg>
        {point && (
          <div
            className="pointer-events-none absolute top-1 rounded-md border bg-popover px-2.5 py-1.5 text-xs text-popover-foreground shadow-sm"
            style={{
              left: `${(x(active!) / W) * 100}%`,
              transform: active! > n / 2 ? "translateX(calc(-100% - 8px))" : "translateX(8px)",
            }}
          >
            <div className="font-medium">
              {point.season}
              {point.now ? " (so far)" : ""}: {point.overall}
            </div>
            <div className="text-muted-foreground">
              Age {point.age} · {point.position} · {point.team ?? "free agent"}
            </div>
          </div>
        )}
      </div>
      <details className="text-sm">
        <summary className="cursor-pointer text-muted-foreground">Season by season</summary>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Season</TableHead>
              <TableHead>Age</TableHead>
              <TableHead>Team</TableHead>
              <TableHead>Pos</TableHead>
              <TableHead className="text-right">Overall</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {[...points].reverse().map((p) => (
              <TableRow key={p.season}>
                <TableCell>
                  {p.season}
                  {p.now ? " (so far)" : ""}
                </TableCell>
                <TableCell>{p.age}</TableCell>
                <TableCell>{p.team ?? "FA"}</TableCell>
                <TableCell>{p.position}</TableCell>
                <TableCell className="text-right tabular-nums">{p.overall}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </details>
    </div>
  );
}
