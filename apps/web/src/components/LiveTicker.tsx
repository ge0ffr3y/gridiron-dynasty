/**
 * Watching a game live: the play-by-play revealed one play at a time, with
 * the score and clock updating, and speed controls. The final score stays
 * hidden until the last play (or "Skip to end").
 */
import type { GameView, PlayLine } from "@fgm/sim-core";
import { FastForward, Pause, Play } from "lucide-react";
import { Fragment, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { TeamChip } from "./shared";

/** Milliseconds per play at 1x; scores and turnovers linger a little longer. */
const PLAY_MS = 1200;
const SCORE_LINGER = 2;
const SPEEDS = [1, 4] as const;
/** How many recent plays the feed shows. */
const FEED_LENGTH = 25;

const quarterLabel = (q: number) => (q <= 4 ? `Q${q}` : "OT");

export function LiveTicker({
  game,
  plays,
  onFinished,
}: {
  game: GameView;
  plays: PlayLine[];
  onFinished: () => void;
}) {
  const [shown, setShown] = useState(0);
  const [speed, setSpeed] = useState<number>(1);
  const [paused, setPaused] = useState(false);
  const done = shown >= plays.length;

  useEffect(() => {
    if (paused || done) return;
    const last = plays[shown - 1];
    const wait = (PLAY_MS * (last?.scoring ? SCORE_LINGER : 1)) / speed;
    const timer = setTimeout(() => setShown((n) => n + 1), shown === 0 ? 300 : wait);
    return () => clearTimeout(timer);
  }, [shown, speed, paused, done, plays]);

  const latest = plays[shown - 1];
  const score: [number, number] = latest?.score ?? [0, 0];
  const feed = plays.slice(Math.max(0, shown - FEED_LENGTH), shown).reverse();
  const possession = latest?.situation ? latest.offense : null;

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardContent className="grid grid-cols-[1fr_auto_1fr] items-center gap-4">
          {([game.away, game.home] as const).map((team, i) => {
            const side = i === 0 ? "away" : "home";
            const points = i === 0 ? score[1] : score[0];
            return (
              <Fragment key={team.id}>
                {i === 1 && (
                  <div className="text-center tabular-nums">
                    <div className="text-sm font-semibold">
                      {done
                        ? game.overtime
                          ? "Final (OT)"
                          : "Final"
                        : latest
                          ? quarterLabel(latest.quarter)
                          : "Kickoff"}
                    </div>
                    {!done && latest && (
                      <div className="text-xs text-muted-foreground">{latest.clock}</div>
                    )}
                  </div>
                )}
                <div
                  className={cn(
                    "flex items-center gap-3",
                    i === 1 && "flex-row-reverse text-right",
                  )}
                >
                  <TeamChip team={team} className="h-9 min-w-14 text-sm" />
                  <div className="min-w-0">
                    <div className="truncate font-medium">
                      {team.city} {team.nickname}
                      {possession === side && (
                        <span className="ml-1.5 text-xs text-muted-foreground" title="Has the ball">
                          ●
                        </span>
                      )}
                    </div>
                    <div className="text-3xl font-bold tabular-nums">{points}</div>
                  </div>
                </div>
              </Fragment>
            );
          })}
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={() => setPaused((p) => !p)}
          disabled={done}
          aria-label={paused ? "Resume" : "Pause"}
        >
          {paused ? <Play /> : <Pause />}
          {paused ? "Resume" : "Pause"}
        </Button>
        <div className="flex rounded-md border p-0.5" role="group" aria-label="Speed">
          {SPEEDS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => {
                setSpeed(s);
                setPaused(false);
              }}
              aria-pressed={speed === s}
              className={cn(
                "rounded px-2.5 py-1 text-xs font-medium tabular-nums",
                speed === s
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-accent",
              )}
            >
              {s}×
            </button>
          ))}
        </div>
        {done ? (
          <Button size="sm" onClick={onFinished}>
            Box score and charts
          </Button>
        ) : (
          <Button size="sm" variant="ghost" onClick={() => setShown(plays.length)}>
            <FastForward />
            Skip to end
          </Button>
        )}
      </div>

      <Card className="gap-2 py-3">
        <CardContent className="px-2">
          {feed.length === 0 ? (
            <p className="px-2 text-sm text-muted-foreground">The teams take the field…</p>
          ) : (
            <ol className="flex flex-col" aria-live="polite">
              {feed.map((p, i) => {
                const team = p.offense === "home" ? game.home : game.away;
                return (
                  <li
                    key={shown - i}
                    className={cn(
                      "grid grid-cols-[4.5rem_2.5rem_1fr] gap-2 rounded px-2 py-1 text-sm",
                      p.scoring && "bg-primary/10 font-medium",
                      i === 0 && "text-base",
                      i > 0 && "text-muted-foreground",
                    )}
                  >
                    <span className="tabular-nums text-muted-foreground">
                      {quarterLabel(p.quarter)} {p.clock}
                    </span>
                    <span className="text-xs leading-5 font-semibold text-muted-foreground">
                      {team.abbreviation}
                    </span>
                    <span>
                      {p.situation && (
                        <span className="text-muted-foreground">{p.situation}: </span>
                      )}
                      {p.text}
                      {p.scoring && (
                        <span className="ml-2 tabular-nums text-muted-foreground">
                          ({game.away.abbreviation} {p.score[1]}, {game.home.abbreviation}{" "}
                          {p.score[0]})
                        </span>
                      )}
                      {i === 0 && p.note && (
                        <span className="block text-xs text-muted-foreground">{p.note}</span>
                      )}
                    </span>
                  </li>
                );
              })}
            </ol>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
