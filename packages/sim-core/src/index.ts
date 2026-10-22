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
