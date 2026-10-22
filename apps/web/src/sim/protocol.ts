/**
 * Messages between the page and the simulation worker. The worker owns the
 * league; the page asks for screen data by name and gets plain data back.
 */
import type {
  BigBoardView,
  DraftAction,
  DraftHistoryView,
  DraftRoomView,
  MockDraftView,
  DraftClassView,
  ProspectView,
  ScoutingDepartmentView,
  ScoutingMove,
  CalendarPageView,
  CampReportView,
  CarouselView,
  CoachRole,
  DevelopmentReportView,
  InjuryReportView,
  RosterManagementView,
  RosterMoveKind,
  TradeAssets,
  TradePreview,
  TradeSide,
  TransactionsView,
  CalendarView,
  CapMoveKind,
  CapSheetView,
  ContractView,
  DepthChartView,
  DepthSlot,
  LeadersView,
  CoachView,
  GameView,
  HistoryView,
  LeagueSummary,
  PlayerView,
  PlayoffsView,
  RosterRow,
  ScheduleSelection,
  ScheduleView,
  SimActionId,
  StandingsView,
  TeamView,
} from "@fgm/sim-core";

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
  /** A fictional league from a seed, or the real league (built locally by the pipeline) with a seed. */
  createLeague(params: { name: string; seed: number; kind?: "fictional" | "real" }): SavedLeague;
  /** Whether the real league file has been built on this machine. */
  realLeagueAvailable(params: Record<string, never>): boolean;
  openLeague(params: { id: string }): SavedLeague;
  deleteLeague(params: { id: string }): void;
  exportLeague(params: { id: string }): { fileName: string; bytes: Uint8Array };
  importLeague(params: { bytes: Uint8Array }): SavedLeague;
  leagueSummary(params: Record<string, never>): LeagueSummary & { saved: SavedLeague };
  teamView(params: { teamId: string }): TeamView;
  playersView(params: Record<string, never>): RosterRow[];
  playerView(params: { id: number }): PlayerView;
  coachView(params: { id: number }): CoachView;
  calendar(params: Record<string, never>): CalendarView;
  /** Runs a sim button; progress messages arrive while it runs. The league is saved afterwards. */
  simAction(params: { action: SimActionId }): CalendarView;
  /** Plays one of this week's games right away ("Play and watch"). The league is saved afterwards. */
  playGameNow(params: { gameId: number }): CalendarView;
  scheduleView(params: { selection?: ScheduleSelection }): ScheduleView;
  standingsView(params: Record<string, never>): StandingsView;
  playoffsView(params: Record<string, never>): PlayoffsView;
  historyView(params: Record<string, never>): HistoryView;
  gameView(params: { gameId: number }): GameView;
  depthChartView(params: { teamId: string }): DepthChartView;
  /** Moves a player at one spot on a team's depth chart (the chart becomes a custom one). */
  moveOnDepthChart(params: {
    teamId: string;
    slot: DepthSlot;
    playerId: number;
    toIndex: number;
  }): DepthChartView;
  resetDepthChart(params: { teamId: string }): DepthChartView;
  leadersView(params: { season?: number }): LeadersView;
  /** A player's contract year by year, with "what if" previews of cap moves. */
  contractView(params: { id: number }): ContractView;
  /** A team's cap sheet for this League Year and the next three. */
  capSheetView(params: { teamId: string }): CapSheetView;
  /** A league-office cap move (release, June 1 release, restructure), saved. Returns what happened. */
  capMove(params: { playerId: number; kind: CapMoveKind }): { message: string };
  /** The transaction log, newest first (optionally one team's, or one kind). */
  transactionsView(params: { teamId?: string; group?: string }): TransactionsView;
  /** The League Year's dates and deadlines, and where the league is. */
  calendarPageView(params: Record<string, never>): CalendarPageView;
  /** Preseason standouts, who improved, and the waiver claims at final cuts. */
  campReportView(params: Record<string, never>): CampReportView;
  /** This season's coaching carousel: firings, searches and interviews, hires, open jobs. */
  carouselView(params: { season?: number }): CarouselView;
  /** A league-office coaching move (saved): fire a coach, or hire a candidate for an open job. */
  coachingMove(
    params:
      | { kind: "fire"; coachId: number }
      | { kind: "hire"; teamId: string; role: CoachRole; coachId: number },
  ): { message: string };
  /** This week's injury report: every team's (or one team's) listed players and reserve lists. */
  injuryReportView(params: { teamId?: string }): InjuryReportView;
  /** This season's development rounds: biggest risers and fallers, with reasons. */
  developmentReportView(params: Record<string, never>): DevelopmentReportView;
  /** A team's roster by list, with the moves the league office can make; plus free agents. */
  rosterManagementView(params: {
    teamId: string;
    freeAgentPosition?: string;
  }): RosterManagementView;
  /** A league-office roster move (saved). Returns what happened. */
  rosterMove(params: { teamId: string; playerId: number; kind: RosterMoveKind }): {
    message: string;
  };
  /** A team's tradable players and picks. */
  tradeAssets(params: { teamId: string }): TradeAssets;
  /** What a trade would do to both teams (changes nothing). */
  previewTrade(params: { a: TradeSide; b: TradeSide }): TradePreview;
  /** Makes a legal trade (saved). Returns what happened. */
  makeTrade(params: { a: TradeSide; b: TradeSide }): { message: string };
  /** Whose eyes the screens see through, and the teams to choose from. */
  viewingOptions(params: Record<string, never>): ViewingOptions;
  /** Switches "Viewing as" (null: the league office's consensus). Saved. */
  setViewingAs(params: { teamId: string | null }): ViewingOptions;
  /** The upcoming draft class, as the viewer's scouts rank it. */
  draftClassView(params: Record<string, never>): DraftClassView;
  /** One prospect's scouting report. */
  prospectView(params: { id: number }): ProspectView;
  /** A team's scouting department: budget, scouts and assignments. */
  scoutingDepartmentView(params: { teamId: string }): ScoutingDepartmentView;
  /** A league-office scouting move (saved): a team's budget or a scout's assignment. */
  scoutingMove(params: ScoutingMove): { message: string };
  /** The draft room: the pick on the clock, its team's board and needs, trade offers, the log. */
  draftRoomView(params: Record<string, never>): DraftRoomView;
  /** A draft-room action (saved): make the pick, sim picks, or accept a trade offer. */
  draftAction(params: DraftAction): { message: string };
  /** A team's big board for the upcoming draft. */
  bigBoardView(params: { teamId: string }): BigBoardView;
  /** Sets a team's board by hand (prospect ids, best first), or back to its scouts' (null). Saved. */
  setBoard(params: { teamId: string; ids: number[] | null }): BigBoardView;
  /** A mock draft as the viewer's scouts see it. */
  mockDraftView(params: Record<string, never>): MockDraftView;
  /** A past draft class with retro grades. */
  draftHistoryView(params: { season?: number }): DraftHistoryView;
}

export type ViewingOptions = { current: string | null; teams: { id: string; name: string }[] };

export type Method = keyof SimApi;
export type Params<M extends Method> = Parameters<SimApi[M]>[0];
export type Result<M extends Method> = ReturnType<SimApi[M]>;

export interface ToWorker {
  id: number;
  method: Method;
  params: unknown;
}

export type FromWorker =
  | { id: number; ok: true; result: unknown }
  | { id: number; ok: false; error: string }
  /** Progress while a long request runs (not the final answer). */
  | { id: number; progress: string };
