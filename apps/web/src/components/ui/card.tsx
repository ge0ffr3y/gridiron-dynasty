import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

export function Card({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "flex flex-col gap-4 rounded-xl border bg-card py-5 text-card-foreground shadow-sm",
        className,
      )}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("flex flex-col gap-1 px-5", className)} {...props} />;
}

/** A card's heading: an h2 by default (the page title is the h1); `as="h3"` inside a titled section. */
export function CardTitle({
  className,
  as: Tag = "h2",
  ...props
}: ComponentProps<"h2"> & { as?: "h2" | "h3" }) {
  return <Tag className={cn("font-semibold leading-none", className)} {...props} />;
}

export function CardDescription({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("text-sm text-muted-foreground", className)} {...props} />;
}

export function CardContent({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("px-5", className)} {...props} />;
}
