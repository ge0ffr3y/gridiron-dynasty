/**
 * `npm run pipeline -- history` (Phase 15): the real league's past, from the first championship
 * game on (the 1966 season). Fetches the public pages (once, politely), then derives calibration/awards.json.
 */
import { calibrate } from "./calibrate";
import { fetchHistoryPages, fetchTeamRecordPages, historyPaths } from "./fetch";

export async function history(): Promise<void> {
  // The franchise record pages come from a lenient host: first, so they never wait on the archive.
  console.log(`${await fetchTeamRecordPages()} of 32 franchise record pages on disk.`);
  const have = await fetchHistoryPages();
  console.log(`${have} of ${historyPaths().length} history pages on disk.`);
  calibrate();
}
