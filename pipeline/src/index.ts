/**
 * The data pipeline. Steps so far:
 *
 *   npm run pipeline -- calibration    real NFL calibration targets (Phase 3)
 *   npm run pipeline -- matchups       formations, coverages, pass rush, penalties (Phase 4)
 *   npm run pipeline -- people         snap shares, injuries, leaderboards (Phase 4b)
 *   npm run pipeline -- situations     win probability, 4th downs, clock, replay (Phase 5a)
 *   npm run pipeline -- elements       special teams, stadiums, weather (Phase 5b)
 *
 * The real-league import arrives in Phase 6. Restricted inputs go in
 * pipeline/private/ (git-ignored).
 */
import { calibration } from "./calibration";
import { matchups } from "./matchups";
import { people } from "./people";
import { situations } from "./situations";
import { elements } from "./elements";

const step = process.argv[2];
if (step === "calibration") await calibration();
else if (step === "matchups") await matchups();
else if (step === "people") await people();
else if (step === "situations") await situations();
else if (step === "elements") await elements();
else
  console.log("Usage: npm run pipeline -- calibration | matchups | people | situations | elements");
