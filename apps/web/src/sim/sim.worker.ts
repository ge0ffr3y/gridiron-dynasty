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
  screenViewer,
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
  freeAgencyView,
  lockerRoomView,
  disputesView,
  makeOffer,
  negotiationView,
  bigBoardView,
  draftAction,
  draftHistoryView,
  draftRoomView,
  mockDraftView,
  setBoard,
  draftClassView,
  makeScoutingMove,
  prospectView,
  scoutingDepartmentView,
  setViewingAs,
  viewingOptions,
  officeFire,
  officeHire,
  developmentReportView,
  injuryReportView,
  makeRosterMove,
  proposeTrade,
  tradeAnswer,
  frontOfficeView,
  powerRankingsView,
  leagueOverview,
  executiveView,
  formerPlayerView,
  tradeOffersView,
  respondToOffer,
  setController,
  gmCareerView,
  startCareer,
  answerInbox,
  delegate,
  tidyInbox,
  assertYourTeam,
  ownerWatch,
  careerPageView,
  dismissTip,
  takeJob,
  retireCareer,
  glossaryView,
  almanacView,
  dayOneView,
  seasonRecapView,
  recordsView,
  teamHistoryView,
  newsView,
  coachTreeView,
  previewTradeDeal,
  rosterManagementView,
  tradeAssetsView,
  transactionsView,
  type Position,
} from "@fgm/sim-core";
import type { Play } from "@fgm/game-engine";
import { BACKUPS_KEPT, db, PLAY_LOG_SEASONS_KEPT, type PlayLog } from "./db";
import { decodeLeagueFile, encodeLeagueFile, leagueFileName } from "./leagueFile";
import type { FromWorker, Method, SavedLeague, SimApi, ToWorker } from "./protocol";

declare const self: DedicatedWorkerGlobalScope;

/** Whose eyes the screens see through: the league's "Viewing as" setting (the league office by default). */
function viewer(): Viewer {
  return screenViewer(requireLeague());
}

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
  // GM Mode: inbox items you settled on a screen (a signing, a pick, cuts) close, and the owner
  // looks at what you did.
  tidyInbox(league);
  ownerWatch(league);
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
  // A new season began: keep a backup of the league as it starts (the last few seasons).
  if (existing && existing.season !== saved.season) {
    await db.backups.put({
      leagueId: saved.id,
      season: saved.season,
      date: saved.date,
      savedAt: now,
      text,
    });
    const all = await db.backups.where("leagueId").equals(saved.id).sortBy("season");
    for (const old of all.slice(0, Math.max(0, all.length - BACKUPS_KEPT)))
      await db.backups.delete([old.leagueId, old.season]);
  }
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
    await db.transaction("rw", [db.leagues, db.leagueData, db.playLogs, db.backups], async () => {
      await db.leagues.delete(id);
      await db.leagueData.delete(id);
      await db.playLogs.where("leagueId").equals(id).delete();
      await db.backups.where("leagueId").equals(id).delete();
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
    return { ...leagueSummary(league, viewer()), saved: open!.saved };
  },

  teamView({ teamId }) {
    return teamView(requireLeague(), teamId, viewer());
  },

  playersView() {
    return playersView(requireLeague(), viewer());
  },

  playerView({ id }) {
    return playerView(requireLeague(), id, viewer());
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

  async simSeason() {
    const league = requireLeague();
    const logs: PlayLog[] = [];
    // To the end of this season (from wherever it is), then into the next offseason.
    if (league.calendar.stage !== "complete")
      runAction(league, "season-end", { onStep: progress, onGame: keepPlays(logs) });
    runAction(league, "next-season", { onStep: progress });
    await saveWithPlays(league, logs);
    return calendarView(league);
  },

  gmCareerView() {
    return gmCareerView(requireLeague());
  },

  async startCareer({ teamId, firstName, lastName }) {
    const league = requireLeague();
    const meeting = startCareer(league, teamId, { firstName, lastName });
    open = { saved: await save(league, open!.saved), league };
    return meeting;
  },

  async answerInbox({ decisionId, choice }) {
    const league = requireLeague();
    try {
      return answerInbox(league, decisionId, choice);
    } finally {
      // Saved either way: a refused answer may still close the item (a stale trade offer).
      open = { saved: await save(league, open!.saved), league };
    }
  },

  careerPageView() {
    return careerPageView(requireLeague(), viewer());
  },

  async dismissTip({ id }) {
    const league = requireLeague();
    dismissTip(league, id);
    open = { saved: await save(league, open!.saved), league };
    return gmCareerView(league);
  },

  async takeJob({ teamId }) {
    const league = requireLeague();
    takeJob(league, teamId);
    open = { saved: await save(league, open!.saved), league };
    return gmCareerView(league);
  },

  async retireCareer() {
    const league = requireLeague();
    retireCareer(league);
    open = { saved: await save(league, open!.saved), league };
    return gmCareerView(league);
  },

  dayOneView() {
    return dayOneView(requireLeague());
  },

  almanacView() {
    return almanacView(requireLeague());
  },

  seasonRecapView({ season }) {
    return seasonRecapView(requireLeague(), season);
  },

  recordsView({ scope }) {
    return recordsView(requireLeague(), scope);
  },

  teamHistoryView({ teamId }) {
    return teamHistoryView(requireLeague(), teamId);
  },

  newsView({ teamId }) {
    return newsView(requireLeague(), teamId);
  },

  coachTreeView({ id }) {
    return coachTreeView(requireLeague(), id);
  },

  glossaryView() {
    return glossaryView(requireLeague());
  },

  async saveCopy({ name }) {
    const league = requireLeague();
    // A copy is its own league in the list: same file, a new name.
    const copy = parseLeague(serializeLeague(league));
    copy.meta.name = name.trim() || `${league.meta.name} (copy)`;
    return save(copy);
  },

  async listBackups({ id }) {
    const all = await db.backups.where("leagueId").equals(id).toArray();
    return all
      .sort((a, b) => b.season - a.season)
      .map(({ season, date, savedAt }) => ({ season, date, savedAt }));
  },

  async restoreBackup({ id, season }) {
    const backup = await db.backups.get([id, season]);
    if (!backup) throw new Error("That backup isn't saved any more.");
    const league = parseLeague(backup.text);
    league.meta.name = `${league.meta.name} (${season} backup)`;
    return save(league);
  },

  async delegate({ area, who }) {
    const league = requireLeague();
    delegate(league, area, who);
    open = { saved: await save(league, open!.saved), league };
    return gmCareerView(league);
  },

  powerRankingsView() {
    return powerRankingsView(requireLeague());
  },

  leagueOverview() {
    return leagueOverview(requireLeague());
  },

  formerPlayerView({ id }) {
    return formerPlayerView(requireLeague(), id);
  },

  executiveView({ id }) {
    return executiveView(requireLeague(), id);
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
    return depthChartView(requireLeague(), teamId, viewer());
  },

  async moveOnDepthChart({ teamId, slot, playerId, toIndex }) {
    const league = requireLeague();
    assertYourTeam(league, teamId);
    moveOnDepthChart(league, teamId, slot, playerId, toIndex);
    open = { saved: await save(league, open!.saved), league };
    return depthChartView(league, teamId, viewer());
  },

  async resetDepthChart({ teamId }) {
    const league = requireLeague();
    assertYourTeam(league, teamId);
    resetDepthChart(league, teamId);
    open = { saved: await save(league, open!.saved), league };
    return depthChartView(league, teamId, viewer());
  },

  leadersView({ season }) {
    return leadersView(requireLeague(), season);
  },

  contractView({ id }) {
    return contractView(requireLeague(), id);
  },

  capSheetView({ teamId }) {
    return capSheetView(requireLeague(), teamId, viewer());
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
    return developmentReportView(requireLeague(), viewer());
  },

  rosterManagementView({ teamId, freeAgentPosition }) {
    return rosterManagementView(requireLeague(), teamId, viewer(), {
      freeAgentPosition: freeAgentPosition as Position | undefined,
    });
  },

  async rosterMove({ teamId, playerId, kind }) {
    const league = requireLeague();
    assertYourTeam(league, teamId);
    const message = makeRosterMove(league, teamId, playerId, kind);
    open = { saved: await save(league, open!.saved), league };
    return { message };
  },

  viewingOptions() {
    return viewingOptions(requireLeague());
  },

  async setViewingAs({ teamId }) {
    const league = requireLeague();
    setViewingAs(league, teamId);
    open = { saved: await save(league, open!.saved), league };
    return viewingOptions(league);
  },

  draftClassView() {
    return draftClassView(requireLeague(), viewer());
  },

  prospectView({ id }) {
    return prospectView(requireLeague(), id, viewer());
  },

  scoutingDepartmentView({ teamId }) {
    return scoutingDepartmentView(requireLeague(), teamId);
  },

  async scoutingMove(move) {
    const league = requireLeague();
    assertYourTeam(league, move.teamId);
    const message = makeScoutingMove(league, move);
    open = { saved: await save(league, open!.saved), league };
    return { message };
  },

  freeAgencyView() {
    return freeAgencyView(requireLeague(), viewer());
  },

  lockerRoomView({ teamId }) {
    return lockerRoomView(requireLeague(), teamId, viewer());
  },

  disputesView() {
    return disputesView(requireLeague());
  },

  negotiationView({ playerId, teamId }) {
    return negotiationView(requireLeague(), playerId, teamId, viewer());
  },

  async makeOffer({ playerId, teamId, offer }) {
    const league = requireLeague();
    assertYourTeam(league, teamId);
    const result = makeOffer(league, playerId, teamId, offer);
    open = { saved: await save(league, open!.saved), league };
    return result;
  },

  draftRoomView() {
    return draftRoomView(requireLeague());
  },

  async draftAction(action) {
    const league = requireLeague();
    const message = draftAction(league, action);
    open = { saved: await save(league, open!.saved), league };
    return { message };
  },

  bigBoardView({ teamId }) {
    return bigBoardView(requireLeague(), teamId);
  },

  async setBoard({ teamId, ids }) {
    const league = requireLeague();
    assertYourTeam(league, teamId);
    setBoard(league, teamId, ids);
    open = { saved: await save(league, open!.saved), league };
    return bigBoardView(league, teamId);
  },

  mockDraftView() {
    return mockDraftView(requireLeague(), viewer());
  },

  draftHistoryView({ season }) {
    return draftHistoryView(requireLeague(), viewer(), season);
  },

  carouselView({ season }) {
    return carouselView(requireLeague(), season);
  },

  async coachingMove(params) {
    const league = requireLeague();
    assertYourTeam(
      league,
      params.kind === "fire"
        ? league.coaches.find((c) => c.id === params.coachId)?.teamId
        : params.teamId,
    );
    // Both check everything before changing anything, so a refused move leaves the league as it was.
    const message =
      params.kind === "fire"
        ? officeFire(league, params.coachId)
        : officeHire(league, params.teamId, params.role, params.coachId);
    open = { saved: await save(league, open!.saved), league };
    return { message };
  },

  tradeAssets({ teamId }) {
    return tradeAssetsView(requireLeague(), teamId, viewer());
  },

  previewTrade({ a, b }) {
    return previewTradeDeal(requireLeague(), a, b);
  },

  tradeAnswer({ a, b }) {
    return tradeAnswer(requireLeague(), a, b);
  },

  async makeTrade({ a, b }) {
    const league = requireLeague();
    assertYourTeam(league, a.teamId);
    // The other team's GM must agree (Phase 13).
    const message = proposeTrade(league, a, b);
    open = { saved: await save(league, open!.saved), league };
    return { message };
  },

  frontOfficeView({ teamId }) {
    return frontOfficeView(requireLeague(), teamId);
  },

  tradeOffersView({ teamId }) {
    return tradeOffersView(requireLeague(), teamId);
  },

  async respondToOffer({ offerId, accept }) {
    const league = requireLeague();
    const message = respondToOffer(league, offerId, accept);
    open = { saved: await save(league, open!.saved), league };
    return { message };
  },

  async setController({ teamId, human }) {
    const league = requireLeague();
    setController(league, teamId, human);
    open = { saved: await save(league, open!.saved), league };
    return {
      message: human
        ? `You now answer ${teamId}'s trade offers.`
        : `${teamId}'s GM answers its trade offers again.`,
    };
  },

  async capMove({ playerId, kind }) {
    const league = requireLeague();
    assertYourTeam(league, league.players.find((p) => p.id === playerId)?.teamId);
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
