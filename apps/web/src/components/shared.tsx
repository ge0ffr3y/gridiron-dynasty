import type { TeamCard } from "@fgm/sim-core";
import type { ReactNode } from "react";
import { Link } from "wouter";
import { cn } from "@/lib/utils";

/** Black or white, whichever reads better on a background color like "#1d4ed8". */
export function readableTextOn(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const channel = (c: number) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  const luminance =
    0.2126 * channel((n >> 16) & 255) +
    0.7152 * channel((n >> 8) & 255) +
    0.0722 * channel(n & 255);
  return luminance > 0.18 ? "#000000" : "#ffffff";
}

/** A team's abbreviation on its own colors, linking to the team. */
export function TeamChip({
  team,
  className,
}: {
  team: Pick<TeamCard, "id" | "abbreviation" | "colors">;
  className?: string;
}) {
  return (
    <Link
      href={`/team/${team.id}`}
      className={cn(
        "inline-flex h-6 min-w-10 items-center justify-center rounded px-1.5 text-xs font-bold tracking-wide",
        className,
      )}
      style={{ backgroundColor: team.colors.primary, color: readableTextOn(team.colors.primary) }}
    >
      {team.abbreviation}
    </Link>
  );
}

/** An overall rating, shaded by how good it is. */
export function OverallBadge({ value, className }: { value: number; className?: string }) {
  const tone =
    value >= 85
      ? "bg-primary text-primary-foreground"
      : value >= 75
        ? "bg-primary/25 text-foreground"
        : value >= 65
          ? "bg-muted text-foreground"
          : "bg-muted text-muted-foreground";
  return (
    <span
      className={cn(
        "inline-flex h-6 w-9 items-center justify-center rounded text-xs font-semibold tabular-nums",
        tone,
        className,
      )}
    >
      {value}
    </span>
  );
}

/** A small "Out" tag for an injured player; hovering shows when and how long. */
export function InjuryTag({
  injury,
}: {
  injury: { description: string; gamesRemaining: number } | null;
}) {
  if (!injury) return null;
  const games = `${injury.gamesRemaining} game${injury.gamesRemaining === 1 ? "" : "s"}`;
  return (
    <span
      title={`${injury.description}. Out ${injury.gamesRemaining} more game${injury.gamesRemaining === 1 ? "" : "s"}.`}
      className="ml-2 inline-flex items-center rounded border border-destructive/40 px-1.5 text-[11px] font-medium text-destructive"
    >
      Out {games}
      <span className="sr-only">
        . {injury.description}. Out {injury.gamesRemaining} more game
        {injury.gamesRemaining === 1 ? "" : "s"}.
      </span>
    </span>
  );
}

const LIST_TAGS: Record<string, { short: string; long: string }> = {
  "practice-squad": { short: "PS", long: "Practice squad" },
  "injured-reserve": { short: "IR", long: "Injured reserve" },
  pup: { short: "PUP", long: "Physically unable to perform" },
  nfi: { short: "NFI", long: "Non-football injury" },
};

/** Where a player is listed, when it isn't the active roster (practice squad, a reserve list). */
export function ListTag({ list }: { list: string | null }) {
  const tag = list ? LIST_TAGS[list] : undefined;
  if (!tag) return null;
  return (
    <span
      title={tag.long}
      className="ml-2 inline-flex items-center rounded border px-1.5 text-[11px] font-medium text-muted-foreground"
    >
      <span aria-hidden>{tag.short}</span>
      <span className="sr-only">{tag.long}</span>
    </span>
  );
}

/** Plain-English name of a roster list. */
export function listName(list: string | null): string {
  if (list === null) return "Free agent";
  return LIST_TAGS[list]?.long ?? "Active roster";
}

/** A 0-100 value as a labeled bar. */
export function RatingBar({ label, value }: { label: string; value: number }) {
  return (
    <div className="grid grid-cols-[minmax(0,8rem)_minmax(3rem,1fr)_2rem] items-center gap-2 text-sm">
      <span className="truncate text-muted-foreground">{label}</span>
      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-primary"
          style={{ width: `${value}%`, opacity: 0.35 + value / 160 }}
        />
      </div>
      <span className="text-right tabular-nums">{value}</span>
    </div>
  );
}

export function PageHeader({
  title,
  subtitle,
  children,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {subtitle && <div className="mt-1 text-sm text-muted-foreground">{subtitle}</div>}
      </div>
      {children}
    </div>
  );
}

export function Loading({ what = "Loading" }: { what?: string }) {
  return (
    <p role="status" className="text-sm text-muted-foreground">
      {what}…
    </p>
  );
}

export function ErrorNote({ message }: { message: string }) {
  return (
    <p
      role="alert"
      className="rounded-md border border-destructive/40 p-3 text-sm text-destructive"
    >
      {message}
    </p>
  );
}

/** Stat label + value pairs. */
export function Facts({ items }: { items: [string, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3">
      {items.map(([label, value]) => (
        <div key={label}>
          <dt className="text-xs text-muted-foreground">{label}</dt>
          <dd className="font-medium">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * A player's scheme fit (Phase 10) as a small tag: words, not color alone. Neutral fits show
 * nothing unless `always`.
 */
/** How a player feels (Phase 12b): a small tag, quiet when he's content. */
export function MoodTag({
  mood,
  always = false,
}: {
  mood: { score: number; label: string; reason: string } | null;
  always?: boolean;
}) {
  if (!mood || (mood.label === "Content" && !always)) return null;
  const good = mood.label === "Thrilled" || mood.label === "Happy";
  const bad = mood.label === "Unhappy" || mood.label === "Angry";
  return (
    <span
      title={`Mood ${mood.score}: ${mood.reason}`}
      className={`ml-1 inline-flex items-center rounded border px-1 text-[11px] ${good ? "border-primary/40 text-foreground" : bad ? "border-destructive/50 text-destructive" : "text-muted-foreground"}`}
    >
      <span aria-hidden>{good ? "☺" : bad ? "☹" : ""}</span> {mood.label}
      <span className="sr-only">
        . Mood {mood.score}: {mood.reason}
      </span>
    </span>
  );
}

const DISPUTE_WORDS = {
  holdout: "Holding out",
  "hold-in": "Holding in",
  "trade-request": "Wants a trade",
} as const;

/** A holdout, hold-in or trade request under way. */
export function DisputeTag({ kind }: { kind: keyof typeof DISPUTE_WORDS | null }) {
  if (!kind) return null;
  return (
    <span className="ml-1 inline-flex items-center rounded border border-destructive/50 px-1 text-[11px] text-destructive">
      {DISPUTE_WORDS[kind]}
    </span>
  );
}

export function FitTag({ label, always = false }: { label: string | null; always?: boolean }) {
  if (!label || (label === "Neutral" && !always)) return null;
  const good = label === "Great fit" || label === "Good fit";
  return (
    <span
      title={`Scheme fit: ${label.toLowerCase()} in his team's scheme`}
      className={`ml-1 inline-flex items-center rounded border px-1 text-[11px] ${good ? "border-primary/40 text-foreground" : "text-muted-foreground"}`}
    >
      <span aria-hidden>{good ? "▲" : label === "Neutral" ? "" : "▼"}</span>{" "}
      {label.replace(" fit", "")}
      <span className="sr-only">. Scheme fit: {label.toLowerCase()} in his team's scheme.</span>
    </span>
  );
}
