/// <reference lib="webworker" />
/**
 * The simulation runs here, off the page's main thread, so the UI never
 * freezes. The worker owns the open league, saves it, and builds screen data.
 */
import { GAME_ENGINE_VERSION } from "@fgm/game-engine";
import {
  RngStreams,
  SIM_CORE_VERSION,
  calendarView,
  coachView,
  historyView,
  playoffsView,
  runAction,
  scheduleView,
  standingsView,
  createLeague,
  fingerprint,
  gameView,
  leagueSummary,
  parseLeague,
  playerView,
  playersView,
  serializeLeague,
  teamView,
  type League,
  type Viewer,
  depthChartView,
  leadersView,
  moveOnDepthChart,
  resetDepthChart,
  playGameNow as playOneGame,
  startRealLeague,
  type SimHooks,
  capSheetView,
  contractView,
  makeCapMove,
  calendarPageView,
  campReportView,
  carouselView,
  officeFire,
  officeHire,
  developmentReportView,
  injuryReportView,
  makeRosterMove,
  makeTrade,
  previewTradeDeal,
  rosterManagementView,
  tradeAssetsView,
  transactionsView,
  type Position,
} from "@fgm/sim-core";
import type { Play } from "@fgm/game-engine";
import { db, PLAY_LOG_SEASONS_KEPT, type PlayLog } from "./db";
import { decodeLeagueFile, encodeLeagueFile, leagueFileName } from "./leagueFile";
import type { FromWorker, Method, SavedLeague, SimApi, ToWorker } from "./protocol";

declare const self: DedicatedWorkerGlobalScope;

/** Until GM Mode (Phase 14) everyone views the league as the neutral league office. */
const VIEWER: Viewer = { kind: "league" };

let open: { saved: SavedLeague; league: League } | null = null;

/** The request being handled, so long-running handlers can report progress. */
let currentRequest = 0;
function progress(label: string): void {
  self.postMessage({ id: currentRequest, progress: label } satisfies FromWorker);
}

function requireLeague(): League {
  if (!open) throw new Error("No league is open.");
  return open.league;
}

async function save(league: League, existing?: SavedLeague): Promise<SavedLeague> {
  const text = serializeLeague(league);
  const now = Date.now();
  const saved: SavedLeague = {
    id: existing?.id ?? crypto.randomUUID(),
    name: league.meta.name,
    seed: league.meta.seed,
    kind: league.meta.kind,
    season: league.season,
    date: league.date,
    teamCount: league.teams.length,
    playerCount: league.players.length,
    fingerprint: fingerprint(text),
    createdAt: existing?.createdAt ?? now,
    lastOpenedAt: now,
  };
  await db.transaction("rw", db.leagues, db.leagueData, async () => {
    await db.leagues.put(saved);
    await db.leagueData.put({ id: saved.id, text });
  });
  return saved;
}

/** Collects each game's play-by-play as it's played. */
function keepPlays(logs: PlayLog[]): SimHooks["onGame"] {
  const id = open!.saved.id;
  return (game, output) =>
    logs.push({ leagueId: id, season: game.season, gameId: game.id, plays: output.plays });
}

/** Saves the league and the new play-by-play, keeping play-by-play for recent seasons only. */
async function saveWithPlays(league: League, logs: PlayLog[]): Promise<void> {
  const id = open!.saved.id;
  open = { saved: await save(league, open!.saved), league };
  await db.playLogs.bulkPut(logs);
  const oldest = league.season - PLAY_LOG_SEASONS_KEPT + 1;
  await db.playLogs
    .where("leagueId")
    .equals(id)
    .and((log) => log.season < oldest)
    .delete();
}

/**
 * The real league's starting file. The pipeline builds it on this machine
 * (`npm run pipeline -- league`) and copies it where the dev server serves it;
 * it's never committed.
 */
async function realLeagueText(): Promise<string> {
  const url = new URL(
    `${import.meta.env.BASE_URL}private/real-league-2026.json`,
    self.location.origin,
  );
  const response = await fetch(url);
  const text = response.ok ? await response.text() : "";
  // A missing file comes back as the app's own page, so check it's a league.
  if (!text.startsWith("{"))
    throw new Error("The real league hasn't been built yet. Run: npm run pipeline -- league");
  return text;
}

type Handlers = {
  [M in Method]: (
    params: Parameters<SimApi[M]>[0],
  ) => Promise<ReturnType<SimApi[M]>> | ReturnType<SimApi[M]>;
};

const handlers: Handlers = {
  hello({ seed }) {
    const stream = new RngStreams(seed).get("league");
    return {
      simCoreVersion: SIM_CORE_VERSION,
      gameEngineVersion: GAME_ENGINE_VERSION,
      sample: [stream.nextUint32(), stream.nextUint32(), stream.nextUint32()],
    };
  },

  async realLeagueAvailable() {
    try {
      await realLeagueText();
      return true;
    } catch {
      return false;
    }
  },

  async listLeagues() {
    return db.leagues.orderBy("lastOpenedAt").reverse().toArray();
  },

  async createLeague({ name, seed, kind }) {
    const leagueName = name.trim() || `League ${seed}`;
    const league =
      kind === "real"
        ? startRealLeague(parseLeague(await realLeagueText()), { name: leagueName, seed })
        : createLeague({ name: leagueName, seed });
    const saved = await save(league);
    open = { saved, league };
    return saved;
  },

  async openLeague({ id }) {
    if (open?.saved.id === id) return open.saved;
    const [saved, data] = await Promise.all([db.leagues.get(id), db.leagueData.get(id)]);
    if (!saved || !data) throw new Error("That league isn't saved in this browser any more.");
    const league = parseLeague(data.text);
    const updated = { ...saved, lastOpenedAt: Date.now() };
    await db.leagues.put(updated);
    open = { saved: updated, league };
    return updated;
  },

  async deleteLeague({ id }) {
    await db.transaction("rw", db.leagues, db.leagueData, db.playLogs, async () => {
      await db.leagues.delete(id);
      await db.leagueData.delete(id);
      await db.playLogs.where("leagueId").equals(id).delete();
    });
    if (open?.saved.id === id) open = null;
  },

  async exportLeague({ id }) {
    const [saved, data] = await Promise.all([db.leagues.get(id), db.leagueData.get(id)]);
    if (!saved || !data) throw new Error("That league isn't saved in this browser any more.");
    return { fileName: leagueFileName(saved.name), bytes: await encodeLeagueFile(data.text) };
  },

  async importLeague({ bytes }) {
    const league = parseLeague(await decodeLeagueFile(bytes));
    return save(league);
  },

  leagueSummary() {
    const league = requireLeague();
    return { ...leagueSummary(league, VIEWER), saved: open!.saved };
  },

  teamView({ teamId }) {
    return teamView(requireLeague(), teamId, VIEWER);
  },

  playersView() {
    return playersView(requireLeague(), VIEWER);
  },

  playerView({ id }) {
    return playerView(requireLeague(), id, VIEWER);
  },

  coachView({ id }) {
    return coachView(requireLeague(), id);
  },

  calendar() {
    return calendarView(requireLeague());
  },

  async simAction({ action }) {
    const league = requireLeague();
    const logs: PlayLog[] = [];
    runAction(league, action, { onStep: progress, onGame: keepPlays(logs) });
    await saveWithPlays(league, logs);
    return calendarView(league);
  },

  async playGameNow({ gameId }) {
    const league = requireLeague();
    const logs: PlayLog[] = [];
    playOneGame(league, gameId, { onGame: keepPlays(logs) });
    await saveWithPlays(league, logs);
    return calendarView(league);
  },

  async gameView({ gameId }) {
    const league = requireLeague();
    const log = await db.playLogs.get([open!.saved.id, league.season, gameId]);
    return gameView(league, gameId, (log?.plays as Play[] | undefined) ?? null);
  },

  scheduleView({ selection }) {
    return scheduleView(requireLeague(), selection);
  },

  standingsView() {
    return standingsView(requireLeague());
  },

  playoffsView() {
    return playoffsView(requireLeague());
  },

  historyView() {
    return historyView(requireLeague());
  },

  depthChartView({ teamId }) {
    return depthChartView(requireLeague(), teamId, VIEWER);
  },

  async moveOnDepthChart({ teamId, slot, playerId, toIndex }) {
    const league = requireLeague();
    moveOnDepthChart(league, teamId, slot, playerId, toIndex);
    open = { saved: await save(league, open!.saved), league };
    return depthChartView(league, teamId, VIEWER);
  },

  async resetDepthChart({ teamId }) {
    const league = requireLeague();
    resetDepthChart(league, teamId);
    open = { saved: await save(league, open!.saved), league };
    return depthChartView(league, teamId, VIEWER);
  },

  leadersView({ season }) {
    return leadersView(requireLeague(), season);
  },

  contractView({ id }) {
    return contractView(requireLeague(), id);
  },

  capSheetView({ teamId }) {
    return capSheetView(requireLeague(), teamId, VIEWER);
  },

  transactionsView({ teamId, group }) {
    return transactionsView(requireLeague(), { teamId, group });
  },

  calendarPageView() {
    return calendarPageView(requireLeague());
  },

  campReportView() {
    return campReportView(requireLeague());
  },

  injuryReportView({ teamId }) {
    return injuryReportView(requireLeague(), teamId ?? null);
  },

  developmentReportView() {
    return developmentReportView(requireLeague(), VIEWER);
  },

  rosterManagementView({ teamId, freeAgentPosition }) {
    return rosterManagementView(requireLeague(), teamId, VIEWER, {
      freeAgentPosition: freeAgentPosition as Position | undefined,
    });
  },

  async rosterMove({ teamId, playerId, kind }) {
    const league = requireLeague();
    const message = makeRosterMove(league, teamId, playerId, kind);
    open = { saved: await save(league, open!.saved), league };
    return { message };
  },

  carouselView({ season }) {
    return carouselView(requireLeague(), season);
  },

  async coachingMove(params) {
    const league = requireLeague();
    // Both check everything before changing anything, so a refused move leaves the league as it was.
    const message =
      params.kind === "fire"
        ? officeFire(league, params.coachId)
        : officeHire(league, params.teamId, params.role, params.coachId);
    open = { saved: await save(league, open!.saved), league };
    return { message };
  },

  tradeAssets({ teamId }) {
    return tradeAssetsView(requireLeague(), teamId, VIEWER);
  },

  previewTrade({ a, b }) {
    return previewTradeDeal(requireLeague(), a, b);
  },

  async makeTrade({ a, b }) {
    const league = requireLeague();
    makeTrade(league, a, b, "League office trade (any two teams, until GM Mode in Phase 14).");
    const message = league.transactions.at(-1)!.text;
    open = { saved: await save(league, open!.saved), league };
    return { message };
  },

  async capMove({ playerId, kind }) {
    const league = requireLeague();
    const message = makeCapMove(league, playerId, kind);
    open = { saved: await save(league, open!.saved), league };
    return { message };
  },
};

self.onmessage = async (event: MessageEvent<ToWorker>) => {
  const { id, method, params } = event.data;
  currentRequest = id;
  try {
    const handler = handlers[method] as (p: unknown) => unknown;
    const result = await handler(params);
    const transfer =
      method === "exportLeague" ? [(result as { bytes: Uint8Array }).bytes.buffer] : [];
    self.postMessage({ id, ok: true, result } satisfies FromWorker, transfer as Transferable[]);
  } catch (error) {
    self.postMessage({
      id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    } satisfies FromWorker);
  }
};
