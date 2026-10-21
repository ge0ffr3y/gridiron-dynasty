/**
 * "Play and watch": plays one of this week's games right away and opens it in
 * the live ticker. The result is the same as simming it with the rest of the
 * week (every game has its own seed).
 */
import { Loader2, Play } from "lucide-react";
import { useState } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { useSession } from "@/lib/session";
import { cn } from "@/lib/utils";
import { call } from "@/sim/client";

export function PlayAndWatchButton({
  gameId,
  className,
  size = "sm",
}: {
  gameId: number;
  className?: string;
  size?: "sm" | "default";
}) {
  const { bump } = useSession();
  const [, navigate] = useLocation();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function playAndWatch() {
    setBusy(true);
    setError(null);
    try {
      await call("playGameNow", { gameId });
      bump();
      navigate(`/game/${gameId}/watch`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <Button size={size} variant="outline" onClick={playAndWatch} disabled={busy}>
        {busy ? <Loader2 className="animate-spin" /> : <Play />}
        Play and watch
      </Button>
      {error && <span className="text-xs text-destructive">{error}</span>}
    </span>
  );
}
