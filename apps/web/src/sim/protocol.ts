/**
 * Messages between the page and the simulation worker. The worker owns the
 * league; the page asks for screen data by name and gets plain data back.
 */
import type { CoachView, LeagueSummary, PlayerView, RosterRow, TeamView } from "@fgm/sim-core";

/** A league saved in this browser. */
export interface SavedLeague {
  id: string;
  name: string;
  seed: number;
  kind: "fictional" | "real";
  season: number;
  date: string;
  teamCount: number;
  playerCount: number;
  /** Fingerprint of the league file: two leagues with the same fingerprint are identical. */
  fingerprint: string;
  createdAt: number;
  lastOpenedAt: number;
}

export interface SimApi {
  hello(params: { seed: number }): {
    simCoreVersion: string;
    gameEngineVersion: string;
    sample: number[];
  };
  listLeagues(params: Record<string, never>): SavedLeague[];
  createLeague(params: { name: string; seed: number }): SavedLeague;
  openLeague(params: { id: string }): SavedLeague;
  deleteLeague(params: { id: string }): void;
  exportLeague(params: { id: string }): { fileName: string; bytes: Uint8Array };
  importLeague(params: { bytes: Uint8Array }): SavedLeague;
  leagueSummary(params: Record<string, never>): LeagueSummary & { saved: SavedLeague };
  teamView(params: { teamId: string }): TeamView;
  playersView(params: Record<string, never>): RosterRow[];
  playerView(params: { id: number }): PlayerView;
  coachView(params: { id: number }): CoachView;
}

export type Method = keyof SimApi;
export type Params<M extends Method> = Parameters<SimApi[M]>[0];
export type Result<M extends Method> = ReturnType<SimApi[M]>;

export interface ToWorker {
  id: number;
  method: Method;
  params: unknown;
}

export type FromWorker =
  { id: number; ok: true; result: unknown } | { id: number; ok: false; error: string };
