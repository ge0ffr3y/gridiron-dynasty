/**
 * The data pipeline. Steps so far:
 *
 *   npm run pipeline -- calibration    real NFL calibration targets (Phase 3)
 *   npm run pipeline -- matchups       formations, coverages, pass rush, penalties (Phase 4)
 *   npm run pipeline -- people         snap shares, injuries, leaderboards (Phase 4b)
 *   npm run pipeline -- situations     win probability, 4th downs, clock, replay (Phase 5a)
 *   npm run pipeline -- elements       special teams, stadiums, weather (Phase 5b)
 *   npm run pipeline -- league         the real league, renamed, with real contracts (Phases 6, 7b)
 *   npm run pipeline -- rookies        the real rookie wage scale, as knots for the rules file (Phase 7b)
 *   npm run pipeline -- lifecycle      aging by position, careers, the age mix (Phase 9)
 *   npm run pipeline -- injuries       body parts, severity, reinjury, report statuses, injured reserve (Phase 9b)
 *   npm run pipeline -- coaching       team and coach tendencies, head-coach changes (Phase 10)
 *   npm run pipeline -- draft          hit rates by round, pick values, combine measurables, the 2026 class (Phase 11)
 *   npm run pipeline -- market         the contract market: pay by position and rank, free agents, contract shapes (Phase 12)
 *   npm run pipeline -- frontoffice    trades, parity, executive turnover, dead money; private 2025 front-office habits (Phase 13)
 *   npm run pipeline -- history        the real league's past since 1966: awards, records, Hall of Fame (Phase 15, private)
 *   npm run pipeline -- sweep-list     hashes of real names, for the CI trademark and name sweep (Phase 18)
 *
 * Restricted inputs (Madden ratings) and anything with real names go in
 * pipeline/private/ (git-ignored).
 */
import { calibration } from "./calibration";
import { matchups } from "./matchups";
import { people } from "./people";
import { situations } from "./situations";
import { elements } from "./elements";
import { league } from "./league";
import { lifecycle } from "./lifecycle";
import { injuries } from "./injuries";
import { coaching } from "./coaching";
import { draft } from "./draft";
import { market } from "./market";
import { frontOffice } from "./frontoffice";
import { rookieScale } from "./league/rookieScale";
import { history } from "./history";
import { sweepList } from "./sweep";

const step = process.argv[2];
if (step === "calibration") await calibration();
else if (step === "matchups") await matchups();
else if (step === "people") await people();
else if (step === "situations") await situations();
else if (step === "elements") await elements();
else if (step === "league") await league();
else if (step === "rookies") await rookieScale();
else if (step === "lifecycle") await lifecycle();
else if (step === "injuries") await injuries();
else if (step === "coaching") await coaching();
else if (step === "draft") await draft();
else if (step === "market") await market();
else if (step === "frontoffice") await frontOffice();
else if (step === "history") await history();
else if (step === "sweep-list") await sweepList();
else
  console.log(
    "Usage: npm run pipeline -- calibration | matchups | people | situations | elements | league | rookies | lifecycle | injuries | coaching | draft | market | frontoffice | history | sweep-list",
  );
