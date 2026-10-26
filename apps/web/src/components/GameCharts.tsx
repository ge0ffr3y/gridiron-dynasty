/**
 * Game page charts: the win-probability line, the drive chart and the
 * scoring summary. Home is chart color 1 (blue), away chart color 2 (orange),
 * everywhere; text always uses the text colors, never the series colors.
 */
import type { GameView } from "@fgm/sim-core";
import { useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useChartWidth } from "@/lib/useChartWidth";

type Charts = NonNullable<GameView["charts"]>;
type Plays = NonNullable<GameView["plays"]>;

const HOME = "var(--chart-1)";
const AWAY = "var(--chart-2)";
const clock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
const period = (q: number) => (q <= 4 ? `Q${q}` : "OT");
const pct = (v: number) => `${Math.round(v * 100)}%`;

/** A short stroke of a series color, keying a label. */
function LineKey({ color }: { color: string }) {
  return (
    <span
      className="inline-block h-0.5 w-3 rounded-full align-middle"
      style={{ background: color }}
    />
  );
}

const H = 220;
const PAD = { left: 64, right: 12, top: 14, bottom: 26 };

export function WinProbabilityChart({
  charts,
  plays,
  home,
  away,
}: {
  charts: Charts;
  plays: Plays;
  home: string;
  away: string;
}) {
  const points = charts.winProbability;
  const [active, setActive] = useState<number | null>(null);
  const svg = useRef<SVGSVGElement>(null);
  const [setBox, W] = useChartWidth();
  if (points.length < 2) return null;
  const x = (elapsed: number) =>
    PAD.left + (elapsed / charts.totalSeconds) * (W - PAD.left - PAD.right);
  const y = (homeChance: number) => PAD.top + (1 - homeChance) * (H - PAD.top - PAD.bottom);
  const path = points
    .map((p, i) => `${i ? "L" : "M"}${x(p.elapsed).toFixed(1)},${y(p.home).toFixed(1)}`)
    .join("");
  // Quarter lines (and overtime, if played).
  const marks: { at: number; label: string }[] = [];
  for (let t = 0; t < charts.totalSeconds; t += charts.quarterSeconds) {
    const q = Math.round(t / charts.quarterSeconds) + 1;
    if (t >= 4 * charts.quarterSeconds) {
      marks.push({ at: t, label: "OT" });
      break;
    }
    marks.push({ at: t, label: `Q${q}` });
  }

  // The crosshair snaps to the nearest snap.
  const nearest = (clientX: number) => {
    const box = svg.current?.getBoundingClientRect();
    if (!box) return null;
    const elapsed =
      ((((clientX - box.left) / box.width) * W - PAD.left) / (W - PAD.left - PAD.right)) *
      charts.totalSeconds;
    let best = 0;
    for (let i = 1; i < points.length; i++)
      if (Math.abs(points[i]!.elapsed - elapsed) < Math.abs(points[best]!.elapsed - elapsed))
        best = i;
    return best;
  };
  const onMove = (e: PointerEvent<SVGSVGElement>) => setActive(nearest(e.clientX));
  const onKey = (e: KeyboardEvent<SVGSVGElement>) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const step = e.key === "ArrowRight" ? 1 : -1;
    setActive((i) =>
      Math.max(0, Math.min(points.length - 1, (i ?? (step > 0 ? -1 : points.length)) + step)),
    );
  };
  const point = active === null ? null : points[active]!;
  const playText = point && point.play >= 0 ? plays[point.play]?.text : "Final";

  return (
    <div ref={setBox} className="relative">
      <svg
        ref={svg}
        viewBox={`0 0 ${W} ${H}`}
        className="h-auto w-full touch-none select-none outline-none focus-visible:ring-2 focus-visible:ring-ring"
        role="img"
        aria-label={`Win probability: ${home} chance of winning, play by play. Use the arrow keys to step through plays.`}
        tabIndex={0}
        onPointerMove={onMove}
        onPointerLeave={() => setActive(null)}
        onKeyDown={onKey}
        onBlur={() => setActive(null)}
      >
        {/* Recessive frame: 100% / 50% / 100% lines and quarter lines. */}
        {[1, 0.5, 0].map((v) => (
          <line
            key={v}
            x1={PAD.left}
            x2={W - PAD.right}
            y1={y(v)}
            y2={y(v)}
            stroke="var(--border)"
            strokeWidth={1}
          />
        ))}
        {marks.map((m) => (
          <g key={m.label}>
            <line
              x1={x(m.at)}
              x2={x(m.at)}
              y1={PAD.top}
              y2={H - PAD.bottom}
              stroke="var(--border)"
              strokeWidth={1}
            />
            <text x={x(m.at) + 4} y={H - 8} fontSize={11} fill="var(--muted-foreground)">
              {m.label}
            </text>
          </g>
        ))}
        <text
          x={PAD.left - 8}
          y={y(1) + 4}
          fontSize={11}
          textAnchor="end"
          fill="var(--muted-foreground)"
        >
          {home} 100%
        </text>
        <text
          x={PAD.left - 8}
          y={y(0.5) + 4}
          fontSize={11}
          textAnchor="end"
          fill="var(--muted-foreground)"
        >
          50%
        </text>
        <text
          x={PAD.left - 8}
          y={y(0) + 4}
          fontSize={11}
          textAnchor="end"
          fill="var(--muted-foreground)"
        >
          {away} 100%
        </text>
        <path
          d={path}
          fill="none"
          stroke={HOME}
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {point && (
          <g pointerEvents="none">
            <line
              x1={x(point.elapsed)}
              x2={x(point.elapsed)}
              y1={PAD.top}
              y2={H - PAD.bottom}
              stroke="var(--muted-foreground)"
              strokeWidth={1}
            />
            <circle
              cx={x(point.elapsed)}
              cy={y(point.home)}
              r={4}
              fill={HOME}
              stroke="var(--card)"
              strokeWidth={2}
            />
          </g>
        )}
      </svg>
      {point && (
        <div
          className="pointer-events-none absolute top-0 z-10 w-64 rounded-md border bg-popover p-2 text-xs shadow-md"
          style={{
            left: `clamp(0px, calc(${(x(point.elapsed) / W) * 100}% - 8rem), calc(100% - 16rem))`,
          }}
        >
          <div className="mb-1 text-muted-foreground">
            {period(point.quarter)} {clock(point.clock)}
          </div>
          <div className="flex gap-3">
            <span>
              <LineKey color={HOME} /> <strong>{pct(point.home)}</strong>{" "}
              <span className="text-muted-foreground">{home}</span>
            </span>
            <span>
              <strong>{pct(1 - point.home)}</strong>{" "}
              <span className="text-muted-foreground">{away}</span>
            </span>
          </div>
          {playText && <div className="mt-1 line-clamp-3 text-muted-foreground">{playText}</div>}
        </div>
      )}
    </div>
  );
}

export function ScoringSummary({
  plays,
  home,
  away,
}: {
  plays: Plays;
  home: string;
  away: string;
}) {
  const scores = plays
    .map((p, i) => ({ p, before: i > 0 ? plays[i - 1]!.score : ([0, 0] as [number, number]) }))
    .filter(({ p }) => p.scoring);
  if (scores.length === 0) return <p className="text-sm text-muted-foreground">No scoring.</p>;
  return (
    <ol className="flex flex-col gap-2 text-sm">
      {scores.map(({ p, before }, i) => {
        const homeScored = p.score[0] > before[0];
        return (
          <li key={i} className="grid grid-cols-[4.5rem_1fr_auto] items-baseline gap-3">
            <span className="whitespace-nowrap tabular-nums text-muted-foreground">
              {period(p.quarter)} {p.clock}
            </span>
            <span>
              <LineKey color={homeScored ? HOME : AWAY} />{" "}
              <span className="font-medium">{homeScored ? home : away}</span>{" "}
              <span className="text-muted-foreground">{p.text}</span>
            </span>
            <span className="tabular-nums whitespace-nowrap">
              {away} {p.score[1]} – {home} {p.score[0]}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

export function DriveChart({ charts, home, away }: { charts: Charts; home: string; away: string }) {
  if (charts.drives.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-4 text-xs text-muted-foreground">
        <span>
          <LineKey color={AWAY} /> {away}
        </span>
        <span>
          <LineKey color={HOME} /> {home}
        </span>
        <span>Bars run from the drive's start toward the other team's goal line.</span>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Team</TableHead>
            <TableHead>Started</TableHead>
            <TableHead className="w-1/3 min-w-32">Field</TableHead>
            <TableHead className="text-right">Plays</TableHead>
            <TableHead className="text-right">Yards</TableHead>
            <TableHead className="text-right">Time</TableHead>
            <TableHead>Result</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {charts.drives.map((d, i) => {
            // Field position from the team's own goal line (0) to the opponent's (100).
            const from = 100 - d.startYardsToGoal;
            const to = 100 - d.endYardsToGoal;
            const left = Math.min(from, to);
            const width = Math.max(1, Math.abs(to - from));
            const team = d.team === "home" ? home : away;
            return (
              <TableRow key={i}>
                <TableCell className="font-medium">{team}</TableCell>
                <TableCell className="tabular-nums text-muted-foreground">
                  {period(d.quarter)} {clock(d.clock)}
                </TableCell>
                <TableCell>
                  <div
                    className="relative h-2 w-full rounded-full bg-muted"
                    title={`${team}: own ${from} to ${to >= 50 ? `opponent ${100 - to}` : `own ${to}`}`}
                  >
                    <div
                      className="absolute top-0 h-2 rounded-full"
                      style={{
                        left: `${left}%`,
                        width: `${width}%`,
                        background: d.team === "home" ? HOME : AWAY,
                      }}
                    />
                  </div>
                </TableCell>
                <TableCell className="text-right tabular-nums">{d.plays}</TableCell>
                <TableCell className="text-right tabular-nums">{d.yards}</TableCell>
                <TableCell className="text-right tabular-nums">{clock(d.seconds)}</TableCell>
                <TableCell>{d.result}</TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
