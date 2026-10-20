/**
 * Placeholder team identities, keyed by the team ids in the rules file.
 * Real cities are fine; the nicknames are deliberately not any league's real
 * nicknames, and the whole set gets replaced in the Phase 6 naming session.
 */
export const PLACEHOLDER_TEAMS: Record<
  string,
  { city: string; nickname: string; colors: [string, string] }
> = {
  BUF: { city: "Buffalo", nickname: "Blizzard", colors: ["#1d4ed8", "#e2e8f0"] },
  MIA: { city: "Miami", nickname: "Manta Rays", colors: ["#0d9488", "#f97316"] },
  NE: { city: "New England", nickname: "Nor'easters", colors: ["#1e3a8a", "#94a3b8"] },
  NYA: { city: "New York", nickname: "Ironworks", colors: ["#065f46", "#d1d5db"] },
  BAL: { city: "Baltimore", nickname: "Bulwarks", colors: ["#4c1d95", "#facc15"] },
  CIN: { city: "Cincinnati", nickname: "Riverhawks", colors: ["#c2410c", "#111827"] },
  CLE: { city: "Cleveland", nickname: "Foundry", colors: ["#7c2d12", "#fb923c"] },
  PIT: { city: "Pittsburgh", nickname: "Forge", colors: ["#111827", "#eab308"] },
  HOU: { city: "Houston", nickname: "Wildcatters", colors: ["#7f1d1d", "#1e3a8a"] },
  IND: { city: "Indianapolis", nickname: "Crossroads", colors: ["#1e40af", "#f8fafc"] },
  JAX: { city: "Jacksonville", nickname: "Riptide", colors: ["#0f766e", "#ca8a04"] },
  TEN: { city: "Tennessee", nickname: "Ridgebacks", colors: ["#0c4a6e", "#38bdf8"] },
  DEN: { city: "Denver", nickname: "Summit", colors: ["#ea580c", "#1e3a8a"] },
  KC: { city: "Kansas City", nickname: "Stockyards", colors: ["#b91c1c", "#fbbf24"] },
  LV: { city: "Las Vegas", nickname: "High Rollers", colors: ["#18181b", "#a1a1aa"] },
  LAA: { city: "Los Angeles", nickname: "Surf", colors: ["#0284c7", "#fde047"] },
  DAL: { city: "Dallas", nickname: "Wranglers", colors: ["#1e3a8a", "#cbd5e1"] },
  NYB: { city: "New York", nickname: "Harbormen", colors: ["#1e40af", "#dc2626"] },
  PHI: { city: "Philadelphia", nickname: "Founders", colors: ["#115e59", "#e5e7eb"] },
  WAS: { city: "Washington", nickname: "Statesmen", colors: ["#881337", "#f59e0b"] },
  CHI: { city: "Chicago", nickname: "Gales", colors: ["#1e293b", "#f97316"] },
  DET: { city: "Detroit", nickname: "Assembly", colors: ["#0369a1", "#cbd5e1"] },
  GB: { city: "Green Bay", nickname: "Lumberjacks", colors: ["#166534", "#facc15"] },
  MIN: { city: "Minnesota", nickname: "Loons", colors: ["#581c87", "#fbbf24"] },
  ATL: { city: "Atlanta", nickname: "Firebirds", colors: ["#b91c1c", "#111827"] },
  CAR: { city: "Carolina", nickname: "Pines", colors: ["#0ea5e9", "#0f172a"] },
  NO: { city: "New Orleans", nickname: "Krewe", colors: ["#a16207", "#111827"] },
  TB: { city: "Tampa Bay", nickname: "Mangroves", colors: ["#be123c", "#57534e"] },
  ARI: { city: "Arizona", nickname: "Scorpions", colors: ["#9f1239", "#fcd34d"] },
  LAB: { city: "Los Angeles", nickname: "Stars", colors: ["#1d4ed8", "#facc15"] },
  SF: { city: "San Francisco", nickname: "Fog", colors: ["#991b1b", "#d4a017"] },
  SEA: { city: "Seattle", nickname: "Squall", colors: ["#064e3b", "#65a30d"] },
};
