/**
 * The sim buttons: what you can do next at each point of the calendar.
 */
import type { League } from "../league/schema";
import { advance, advanceUntil, type SimHooks } from "./flow";

export type SimActionId =
  | "league-year"
  | "draft-day"
  | "draft"
  | "camp"
  | "preseason-week"
  | "cutdown"
  | "start-season"
  | "week"
  | "deadline"
  | "regular-end"
  | "round"
  | "season-end"
  | "next-season";

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

/** The offseason stops, in order, and the stage each one leaves the league in. */
const OFFSEASON_STOPS: { id: SimActionId; label: string; reaches: League["calendar"]["stage"] }[] =
  [
    { id: "league-year", label: "Sim to the new League Year", reaches: "free-agency" },
    { id: "draft-day", label: "Sim to draft day", reaches: "draft" },
    { id: "draft", label: "Sim through the draft", reaches: "after-draft" },
    { id: "camp", label: "Sim to training camp", reaches: "preseason" },
  ];
const STAGE_ORDER: League["calendar"]["stage"][] = [
  "offseason",
  "free-agency",
  "draft",
  "after-draft",
  "preseason",
  "cutdown",
  "regular",
];

export function availableActions(league: League): SimAction[] {
  const { stage, week } = league.calendar;
  const deadline = league.rules.schedule.tradeDeadlineAfterWeek;
  const start = { id: "start-season" as const, label: `Sim to the ${league.season} season opener` };
  switch (stage) {
    case "offseason":
    case "free-agency":
    case "draft":
    case "after-draft": {
      const here = STAGE_ORDER.indexOf(stage);
      return [
        ...OFFSEASON_STOPS.filter((s) => STAGE_ORDER.indexOf(s.reaches) > here),
        { id: "cutdown", label: "Sim through final cuts" },
        start,
      ];
    }
    case "preseason":
      return [
        ...(league.settings.preseasonGames
          ? [{ id: "preseason-week" as const, label: `Sim preseason week ${week}` }]
          : []),
        { id: "cutdown", label: "Sim through final cuts" },
        start,
      ];
    case "cutdown":
      return [{ id: "cutdown", label: "Make final cuts" }, start];
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
      return [{ id: "next-season", label: `Start the ${league.season + 1} offseason` }];
  }
}

/** Runs an action, reporting each step (and each game, if asked). */
export function runAction(league: League, id: SimActionId, hooks: SimHooks = {}): void {
  const deadline = league.rules.schedule.tradeDeadlineAfterWeek;
  const step = () => hooks.onStep?.(advance(league, hooks));
  const until = (stage: League["calendar"]["stage"]) =>
    advanceUntil(
      league,
      (l) => STAGE_ORDER.indexOf(l.calendar.stage) >= STAGE_ORDER.indexOf(stage),
      hooks,
    );
  switch (id) {
    case "league-year":
      return until("free-agency");
    case "draft-day":
      return until("draft");
    case "draft":
      return until("after-draft");
    case "camp":
      return until("preseason");
    case "cutdown":
    case "start-season":
      // Final cuts leave the league at Week 1, ready to play.
      return until("regular");
    case "preseason-week":
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
