/**
 * The data pipeline. Steps so far:
 *
 *   npm run pipeline -- calibration    real NFL calibration targets (Phase 3)
 *
 * The real-league import arrives in Phase 6. Restricted inputs go in
 * pipeline/private/ (git-ignored).
 */
import { calibration } from "./calibration";

const step = process.argv[2];
if (step === "calibration") await calibration();
else console.log("Usage: npm run pipeline -- calibration");
