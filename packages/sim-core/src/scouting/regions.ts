/** Each college's region (Phase 11): fixed by its name, so it never changes. */
import { REGIONS } from "./config";

export function regionOf(college: string): string {
  let h = 0;
  for (let i = 0; i < college.length; i++) h = (h * 31 + college.charCodeAt(i)) >>> 0;
  return REGIONS[h % REGIONS.length]!;
}
