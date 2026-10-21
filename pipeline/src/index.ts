/**
 * The data pipeline. Steps so far:
 *
 *   npm run pipeline -- calibration    real NFL calibration targets (Phase 3)
 *   npm run pipeline -- matchups       formations, coverages, pass rush, penalties (Phase 4)
 *
 * The real-league import arrives in Phase 6. Restricted inputs go in
 * pipeline/private/ (git-ignored).
 */
import { calibration } from "./calibration";
import { matchups } from "./matchups";

const step = process.argv[2];
if (step === "calibration") await calibration();
else if (step === "matchups") await matchups();
else console.log("Usage: npm run pipeline -- calibration | matchups");
