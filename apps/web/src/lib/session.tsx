/**
 * Which league is open. Remembered in this browser so a reload reopens it.
 */
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { call } from "@/sim/client";
import type { SavedLeague } from "@/sim/protocol";

const KEY = "fgm-open-league";

interface Session {
  league: SavedLeague | null;
  /** Goes up each time the league changes (a sim step), so screens refetch. */
  version: number;
  bump: () => void;
  /** True while the remembered league is being reopened after a reload. */
  restoring: boolean;
  setLeague: (league: SavedLeague | null) => void;
}

const SessionContext = createContext<Session | null>(null);

function remember(id: string | null): void {
  try {
    if (id) localStorage.setItem(KEY, id);
    else localStorage.removeItem(KEY);
  } catch {
    // Storage can be blocked (private windows); the league just won't reopen by itself.
  }
}

function remembered(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [league, setLeagueState] = useState<SavedLeague | null>(null);
  const [restoring, setRestoring] = useState(() => remembered() !== null);
  const [version, setVersion] = useState(0);
  const bump = useCallback(() => setVersion((v) => v + 1), []);

  useEffect(() => {
    const id = remembered();
    if (!id) return;
    call("openLeague", { id })
      .then(setLeagueState, () => remember(null))
      .finally(() => setRestoring(false));
  }, []);

  const setLeague = useCallback((next: SavedLeague | null) => {
    setLeagueState(next);
    remember(next?.id ?? null);
  }, []);

  return (
    <SessionContext.Provider value={{ league, restoring, setLeague, version, bump }}>
      {children}
    </SessionContext.Provider>
  );
}

export function useSession(): Session {
  const session = useContext(SessionContext);
  if (!session) throw new Error("useSession must be used inside SessionProvider");
  return session;
}

/** A cache key for screen data: changes with the open league and after every sim step. */
export function useLeagueKey(extra = ""): string {
  const { league, version } = useSession();
  return `${league?.id ?? ""}:${version}:${extra}`;
}
