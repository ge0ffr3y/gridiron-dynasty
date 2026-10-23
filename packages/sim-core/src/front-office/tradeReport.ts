/**
 * The trade market against the real one (Phase 13), for `npm run sim -- --trades N`: how many
 * trades a year, of what kind, when, who moves, which picks, and how lopsided they are by a
 * neutral judge (real target: the spread of draft-day pick-for-pick prices).
 */
import { ageOn } from "@fgm/foundation";
import frontOffice from "../../../../calibration/frontoffice.json";
import type { League } from "../league/schema";

const WINDOWS: [string, string][] = [
  ["beforeLeagueYear", "03-10"],
  ["leagueYearToDraft", "04-20"],
  ["draft", "05-13"],
  ["summer", "07-20"],
  ["camp", "09-08"],
  ["season", "12-32"],
];
const stretchOf = (date: string) => WINDOWS.find(([, end]) => date.slice(5) < end)![0];

export interface TradeSeason {
  season: number;
  trades: number;
  byWindow: Record<string, number>;
  byType: { picksOnly: number; playersForPicks: number; playersForPlayers: number; mixed: number };
  players: number;
  medianAge: number;
  /** Non-draft trades with players: how many, and how many included a 1st, a 2nd, only rounds 5-7. */
  playerTrades: number;
  withFirst: number;
  withSecond: number;
  onlyLate: number;
  /** The winner's ratio (value got / value given, neutral judge) across trades: p25, p50, p75. */
  lopsided: [number, number, number];
}

export const REAL_TRADES = frontOffice.trades;
export const REAL_EXECUTIVES = frontOffice.executives;
export const REAL_PARITY = frontOffice.parity;

/** One calendar year's trades (the transactions dated in `season`). */
export function tradeSeason(league: League, season: number): TradeSeason {
  const trades = league.transactions.filter(
    (t) => t.type === "traded" && t.date.startsWith(`${season}-`),
  );
  const byWindow: Record<string, number> = Object.fromEntries(WINDOWS.map(([w]) => [w, 0]));
  const byType = { picksOnly: 0, playersForPicks: 0, playersForPlayers: 0, mixed: 0 };
  const ages: number[] = [];
  let playerTrades = 0;
  let withFirst = 0;
  let withSecond = 0;
  let onlyLate = 0;
  for (const t of trades) {
    const w = stretchOf(t.date);
    byWindow[w]! += 1;
    // Picks named in the text ("2027 1st round", "2026 3rd round, #85").
    const rounds = [...t.text.matchAll(/\d{4} (\d)(?:st|nd|rd|th) round/g)].map((m) =>
      Number(m[1]),
    );
    const hasPlayers = t.playerIds.length > 0;
    if (!hasPlayers) byType.picksOnly += 1;
    else if (rounds.length === 0) byType.playersForPlayers += 1;
    else if (t.playerIds.length >= 1 && /traded [^,]*\([A-Z]+\)[^0-9]* for \d{4}/.test(t.text))
      byType.playersForPicks += 1;
    else byType.mixed += 1;
    for (const id of t.playerIds) {
      const p = league.players.find((x) => x.id === id);
      if (p) ages.push(ageOn(p.birthDate, t.date));
    }
    if (hasPlayers && w !== "draft") {
      playerTrades += 1;
      if (rounds.includes(1)) withFirst += 1;
      if (rounds.includes(2)) withSecond += 1;
      if (rounds.length > 0 && Math.min(...rounds) >= 5) onlyLate += 1;
    }
  }
  const ratios = league.tradeHistory
    .filter((h) => h.date.startsWith(`${season}-`) && h.neutral[0] > 0 && h.neutral[1] > 0)
    .map((h) => Math.max(h.neutral[1] / h.neutral[0], h.neutral[0] / h.neutral[1]))
    .sort((a, b) => a - b);
  const q = (p: number) =>
    ratios.length ? Math.round(ratios[Math.round(p * (ratios.length - 1))]! * 100) / 100 : 0;
  ages.sort((a, b) => a - b);
  return {
    season,
    trades: trades.length,
    byWindow,
    byType,
    players: ages.length,
    medianAge: ages[Math.floor(ages.length / 2)] ?? 0,
    playerTrades,
    withFirst,
    withSecond,
    onlyLate,
    lopsided: [q(0.25), q(0.5), q(0.75)],
  };
}
