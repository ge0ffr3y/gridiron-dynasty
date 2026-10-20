export * from "./rng";
export * as dmath from "./math";
export * from "./money";
export * from "./dates";
export * from "./rules";
export * from "./league/schema";
export * from "./players/positions";
export { overallAt, overallWithFamiliarity, fortyTime } from "./players/ratings";
export { createLeague, type NewLeagueOptions } from "./generate/league";
export * from "./perception";
export * from "./decisions";
export * from "./serialize";
export * from "./views";
export * from "./season/views";
export { availableActions, runAction, type SimAction, type SimActionId } from "./season/actions";
export { advance, advanceUntil, currentStandings } from "./season/flow";
export { validateSchedule } from "./season/validate";
export { seasonDates } from "./season/calendar";

/** Bumped when the league save format or simulation rules change in a breaking way. */
export const SIM_CORE_VERSION = "0.2.0";
