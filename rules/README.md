# Rules config

League rules live here as versioned data (one file per season, `2026.json` today), never in code: salary cap, contract rules, roster limits, overtime, kickoffs, playoff format, tiebreakers, free agency, the draft, the calendar. When the real league changes a rule, update the config.

`packages/sim-core/src/rules.ts` loads and validates the file. Every block carries a `source` note saying which CBA article, rulebook section or public page its numbers came from. Exact league values are checked against those sources when a phase first uses them, never typed from memory.
