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
export { seasonDates } from "./season/calendar";

/** Bumped when the league save format or simulation rules change in a breaking way. */
export const SIM_CORE_VERSION = "0.8.1";
