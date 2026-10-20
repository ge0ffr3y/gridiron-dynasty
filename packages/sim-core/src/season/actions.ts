/**
 * The sim buttons: what you can do next at each point of the calendar.
 */
import type { League } from "../league/schema";
import { advance, advanceUntil, type SimHooks } from "./flow";

export type SimActionId =
  "start-season" | "week" | "deadline" | "regular-end" | "round" | "season-end" | "next-season";

export interface SimAction {
  id: SimActionId;
  label: string;
}

const ROUND_NAMES = {
  wildcard: "wild-card round",
  divisional: "divisional round",
  conference: "conference championships",
  championship: "championship game",
} as const;

export function availableActions(league: League): SimAction[] {
  const { stage, week } = league.calendar;
  const deadline = league.rules.schedule.tradeDeadlineAfterWeek;
  switch (stage) {
    case "offseason":
    case "preseason":
      return [{ id: "start-season", label: `Start the ${league.season} season` }];
    case "regular":
      return [
        { id: "week", label: `Sim week ${week}` },
        ...(week <= deadline ? [{ id: "deadline" as const, label: "Sim to trade deadline" }] : []),
        { id: "regular-end", label: "Sim to end of regular season" },
        { id: "season-end", label: "Sim full season" },
      ];
    case "wildcard":
    case "divisional":
    case "conference":
    case "championship":
      return [
        { id: "round", label: `Sim ${ROUND_NAMES[stage]}` },
        ...(stage !== "championship"
          ? [{ id: "season-end" as const, label: "Sim rest of playoffs" }]
          : []),
      ];
    case "complete":
      return [{ id: "next-season", label: `Start the ${league.season + 1} league year` }];
  }
}

/** Runs an action, reporting each step (and each game, if asked). */
export function runAction(league: League, id: SimActionId, hooks: SimHooks = {}): void {
  const deadline = league.rules.schedule.tradeDeadlineAfterWeek;
  const step = () => hooks.onStep?.(advance(league, hooks));
  switch (id) {
    case "start-season":
      advanceUntil(league, (l) => l.calendar.stage === "regular", hooks);
      return;
    case "week":
    case "round":
    case "next-season":
      step();
      return;
    case "deadline":
      advanceUntil(
        league,
        (l) => l.calendar.stage !== "regular" || l.calendar.week > deadline,
        hooks,
      );
      return;
    case "regular-end":
      advanceUntil(league, (l) => l.calendar.stage !== "regular", hooks);
      return;
    case "season-end":
      advanceUntil(league, (l) => l.calendar.stage === "complete", hooks);
      return;
  }
}
