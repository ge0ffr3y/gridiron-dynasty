export * from "@fgm/foundation";
export * from "./rules";
export * from "./league/schema";
export { createLeague, type NewLeagueOptions } from "./generate/league";
export {
  assembleRealLeague,
  startRealLeague,
  type RealCoachInput,
  type RealGameInput,
  type RealLeagueInput,
  type RealPlayerInput,
} from "./realLeague";
export { NamePicker } from "./generate/people";
// Contracts and the salary cap (Phase 7).
export * from "./contracts/cap";
export {
  bonusShare,
  capHit,
  capParts,
  cashIn,
  guaranteedAtSigning,
  proration,
  remainingGuarantees,
  remainingProration,
  span,
  totalValue,
  yearOf as contractYearOf,
  yearsLeft,
} from "./contracts/contract";
export * from "./contracts/team";
export * from "./contracts/operations";
export * from "./contracts/views";
export * from "./roster/lists";
export * from "./roster/legality";
export * from "./roster/moves";

export * from "./roster/trades";
export * from "./roster/office";
export * from "./roster/views";
export { assignJerseys } from "./roster/jerseys";
export { gradePreseason, preseasonGame } from "./roster/preseason";
export { calendarEvents, type CalendarEvent } from "./season/calendar";
export { tagTender, fifthYearOptionSalary } from "./contracts/tags";
export { TRAIT_MEAN, TRAIT_SPREAD } from "./generate/config";
export { FIRST_NAMES, LAST_NAMES, COLLEGES } from "./generate/names";
export * from "./perception";
export * from "./decisions";
export * from "./serialize";
export * from "./views";
export * from "./season/views";
export * from "./season/gameView";
export type { Drive, DriveResult, WinPoint } from "./season/gameCharts";
export * from "./peopleViews";
export { availableActions, runAction, type SimAction, type SimActionId } from "./season/actions";
export {
  advance,
  advanceUntil,
  canPlayNow,
  currentStandings,
  playGameNow,
  type SimHooks,
} from "./season/flow";
export { validateSchedule } from "./season/validate";
// Experiments (Phase 17)
export { exhibitionRig, type ExhibitionRig } from "./season/exhibition";
export { starterStrengths } from "./season/flow";
export { gameDepthChart } from "./season/depthChart";
export { coachIn, staffInput } from "./coaches/style";
export { expectedWinShare } from "./coaches/carousel";
export * from "./lifecycle/report";
export * from "./lifecycle/views";
export * from "./coaches/report";
export {
  carouselView,
  careerView,
  officeFire,
  officeHire,
  type CarouselView,
} from "./coaches/carousel";
export { DEVELOPMENT } from "./lifecycle/config";
export { seasonDates } from "./season/calendar";
// Scouting and draft classes (Phase 11).
export type { RealProspectInput } from "./scouting/classes";
export { draftClass, upcomingDraftYear } from "./scouting/classes";
export { DRILLS } from "./scouting/measurables";
export { REGIONS, SCOUT_GROUPS, SCOUTING } from "./scouting/config";
export * from "./scouting/views";
// Free agency and negotiation (Phase 12).
export * from "./contracts/marketViews";
export { FREE_AGENCY } from "./contracts/freeAgency";
export { marketSeason, REAL_MOVEMENT, type MarketSeason } from "./contracts/marketReport";
export * from "./people/morale";
export * from "./people/disputes";
export * from "./people/views";
export * from "./front-office/executives";
export * from "./front-office/evaluate";
export * from "./front-office/strategy";
export * from "./front-office/tradeValue";
export * from "./front-office/tradeAI";
export * from "./front-office/tradeMarket";
export * from "./front-office/tradeReport";
export * from "./front-office/views";
export * from "./front-office/owners";
export * from "./front-office/balanceReport";
export * from "./lifecycle/archive";
// Draft day (Phase 11b).
export * from "./draft/views";
export { draftAction, tradeOffers, type DraftAction, type TradeOffer } from "./draft/day";
export { compensatoryAwards } from "./draft/compensatory";
export {
  draftOutcomes,
  draftOutcomesByPick,
  seasonsStarted,
  DRAFT_REPORT,
} from "./scouting/report";

/** Bumped when the league save format or simulation rules change in a breaking way. */
export const SIM_CORE_VERSION = "0.13.0";
// GM Mode (Phase 14)
export {
  AREA_LABELS,
  DEFAULT_DELEGATION,
  assertYourTeam,
  personTeam,
  staffDecides,
} from "./career/delegation";
export { inbox } from "./career/inbox";
export { startCareer, ownerMeeting, type OwnerMeeting } from "./career/start";
export { answerInbox, type InboxAnswer } from "./career/answers";
export { gmCareerView, type GmCareerView, type InboxItem, type JobRow } from "./career/views";
export { delegate, tidyInbox } from "./career/staff";
export { careerPageView, type CareerPageView } from "./career/views";
export { jobSecurity, ownerWatch, retireCareer, takeJob, type JobSecurity } from "./career/job";
export { currentTips, dismissTip, type Tip } from "./career/tips";
export { glossaryView, type GlossaryEntry } from "./career/glossary";
// Day One (Phase 16)
export { dayOneView, type DayOneView } from "./dayOne";
// League history (Phase 15)
export {
  almanacView,
  coachTreeView,
  newsView,
  recordsView,
  seasonRecapView,
  teamHistoryView,
  type AlmanacView,
  type NewsView,
  type RecordsView,
  type SeasonRecapView,
  type TeamHistoryView,
  type TreeNode,
} from "./history/views";
export { AWARD_LABELS } from "./history/awards";
export { honorsOf, type Honors } from "./history/honors";
export type { RealHistoryInput, RealLegend } from "./history/real";
export { hallOfFameAudit } from "./history/hallOfFame";
export { seasonAndCareerRecords } from "./history/records";
export type { RealScheduleGame, RealPickTrade } from "./realLeague";
