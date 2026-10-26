import { useEffect, useState, type ComponentProps } from "react";
import { cn } from "@/lib/utils";

/**
 * A table that scrolls sideways when it is wider than the screen. The scrolling area can be focused
 * and scrolled with the keyboard, and `caption` (read by screen readers, not shown) names it.
 */
export function Table({
  className,
  caption,
  children,
  ...props
}: ComponentProps<"table"> & { caption?: string }) {
  // Only a table that really scrolls is a tab stop and a named region.
  const [box, setBox] = useState<HTMLDivElement | null>(null);
  const [scrolls, setScrolls] = useState(false);
  useEffect(() => {
    if (!box) return;
    const check = () => setScrolls(box.scrollWidth > box.clientWidth + 1);
    check();
    const watch = new ResizeObserver(check);
    watch.observe(box);
    if (box.firstElementChild) watch.observe(box.firstElementChild);
    return () => watch.disconnect();
  }, [box]);
  return (
    <div
      ref={setBox}
      className="relative w-full overflow-x-auto"
      {...(scrolls
        ? { role: "region", "aria-label": caption ?? "Scrollable table", tabIndex: 0 }
        : {})}
    >
      <table className={cn("w-full caption-bottom text-sm", className)} {...props}>
        {caption && <caption className="sr-only">{caption}</caption>}
        {children}
      </table>
    </div>
  );
}

export function TableHeader({ className, ...props }: ComponentProps<"thead">) {
  return <thead className={cn("[&_tr]:border-b", className)} {...props} />;
}

export function TableBody({ className, ...props }: ComponentProps<"tbody">) {
  return <tbody className={cn("[&_tr:last-child]:border-0", className)} {...props} />;
}

export function TableRow({ className, ...props }: ComponentProps<"tr">) {
  return (
    <tr className={cn("border-b transition-colors hover:bg-muted/50", className)} {...props} />
  );
}

export function TableHead({ className, ...props }: ComponentProps<"th">) {
  return (
    <th
      scope="col"
      className={cn(
        "h-9 px-2 text-left align-middle text-xs font-medium whitespace-nowrap text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
}

export function TableCell({ className, ...props }: ComponentProps<"td">) {
  return <td className={cn("px-2 py-1.5 align-middle whitespace-nowrap", className)} {...props} />;
}
