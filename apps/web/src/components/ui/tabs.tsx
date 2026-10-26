/**
 * Tabs (Phase 18): a tab bar that works with the keyboard and a screen reader. Left and right arrows
 * (and Home and End) move between tabs, only the selected tab is a tab stop, the bar scrolls
 * sideways on a phone instead of widening the page, and each tab names the panel it controls.
 */
import { useRef, type KeyboardEvent, type ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface TabItem<T extends string> {
  id: T;
  label: string;
}

export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
  label,
  idPrefix,
  className,
}: {
  tabs: readonly TabItem<T>[];
  value: T;
  onChange: (id: T) => void;
  /** What the tabs choose between, for screen readers. */
  label: string;
  /** Unique on the page; ties each tab to its panel. */
  idPrefix: string;
  className?: string;
}) {
  const refs = useRef(new Map<T, HTMLButtonElement>());
  const move = (to: number) => {
    const next = tabs[(to + tabs.length) % tabs.length]!;
    onChange(next.id);
    refs.current.get(next.id)?.focus();
  };
  const onKey = (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (e.key === "ArrowRight") move(index + 1);
    else if (e.key === "ArrowLeft") move(index - 1);
    else if (e.key === "Home") move(0);
    else if (e.key === "End") move(tabs.length - 1);
    else return;
    e.preventDefault();
  };
  return (
    <div
      role="tablist"
      aria-label={label}
      className={cn("flex gap-1 overflow-x-auto border-b [scrollbar-width:thin]", className)}
    >
      {tabs.map((tab, i) => {
        const selected = tab.id === value;
        return (
          <button
            key={tab.id}
            ref={(el) => {
              if (el) refs.current.set(tab.id, el);
              else refs.current.delete(tab.id);
            }}
            type="button"
            role="tab"
            id={`${idPrefix}-tab-${tab.id}`}
            aria-selected={selected}
            aria-controls={`${idPrefix}-panel`}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(tab.id)}
            onKeyDown={(e) => onKey(e, i)}
            className={cn(
              "-mb-px h-10 shrink-0 whitespace-nowrap rounded-t-md border-b-2 px-3 text-sm md:h-9",
              selected
                ? "border-primary font-medium text-foreground"
                : "border-transparent text-muted-foreground hover:bg-accent hover:text-foreground",
            )}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}

/** The panel for the selected tab. */
export function TabPanel({
  idPrefix,
  id,
  children,
  className,
}: {
  idPrefix: string;
  id: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      role="tabpanel"
      id={`${idPrefix}-panel`}
      aria-labelledby={`${idPrefix}-tab-${id}`}
      className={className}
    >
      {children}
    </div>
  );
}
