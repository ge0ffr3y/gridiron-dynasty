/**
 * Game-day weather, drawn from the home city's real climate for that week
 * (calibration/elements.json): temperature, wind, rain and snow. Domes keep
 * the weather out; retractable roofs open only in pleasant weather, at the
 * rate the real stadium does. Each game has its own seed, so a game's weather
 * doesn't depend on which games were played first.
 */
import { Rng, streamSeed } from "@fgm/foundation";
import { ELEMENTS, type Conditions } from "@fgm/game-engine";
import type { Game, League, Stadium, Weather } from "../league/schema";
import { WEATHER } from "./config";

interface Climate {
  tempByWeek: [number, number];
  tempSd: number;
  windMean: number;
  windSd: number;
  rain: [number, number];
  snow: [number, number];
}

const CLIMATES = ELEMENTS.climate as unknown as Record<string, Climate>;
const STADIUMS = ELEMENTS.stadiums as unknown as Record<string, Stadium>;

/** A team's stadium from the real data (a plain outdoor grass field if the team isn't in it). */
export function stadiumFor(teamId: string): Stadium {
  return STADIUMS[teamId] ?? { roof: "outdoor", surface: "grass", elevationMeters: 0 };
}

export function drawWeather(league: League, game: Game): Weather {
  const rng = new Rng(streamSeed(league.meta.seed, `weather:${league.season}:${game.id}`));
  const climate = CLIMATES[game.homeId];
  const stadium =
    league.teams.find((t) => t.id === game.homeId)?.stadium ?? stadiumFor(game.homeId);
  // The championship is at a neutral site; we put it under a roof.
  if (game.neutral || !climate) {
    return {
      indoors: true,
      temperatureF: WEATHER.indoorTemperatureF,
      windMph: 0,
      precipitation: "none",
    };
  }
  const W = WEATHER;
  const temperatureF = Math.round(
    climate.tempByWeek[0] + climate.tempByWeek[1] * game.week + rng.gaussian(0, climate.tempSd),
  );
  const windMph = Math.max(0, Math.round(rng.gaussian(climate.windMean, climate.windSd)));
  const late = game.week >= W.lateSeasonWeek ? 1 : 0;
  const r = rng.next();
  let precipitation: Weather["precipitation"] =
    r < climate.snow[late]!
      ? "snow"
      : r < climate.snow[late]! + climate.rain[late]!
        ? "rain"
        : "none";
  if (precipitation === "snow" && temperatureF > W.snowAtMostF) precipitation = "rain";
  if (precipitation === "rain" && temperatureF <= W.freezingF) precipitation = "snow";
  const pleasant =
    precipitation === "none" && temperatureF >= W.openRoof.minF && temperatureF <= W.openRoof.maxF;
  const indoors =
    stadium.roof === "dome" ||
    (stadium.roof === "retractable" && !(pleasant && rng.chance(stadium.openShare ?? 0)));
  return { indoors, temperatureF, windMph, precipitation };
}

/** What the engine needs: the weather plus the stadium's elevation. */
export function conditionsFor(league: League, game: Game, weather: Weather): Conditions {
  const stadium =
    league.teams.find((t) => t.id === game.homeId)?.stadium ?? stadiumFor(game.homeId);
  return { ...weather, elevationMeters: game.neutral ? 0 : stadium.elevationMeters };
}

const FEET_PER_METER = 3.28084;

/**
 * The game page's weather line: "Dome, turf", "Retractable roof, open · 68°F,
 * wind 6 mph · grass", "34°F, wind 15 mph, snow · grass · 5,279 ft up".
 * Null until the game is played.
 */
export function describeConditions(league: League, game: Game): string | null {
  const w = game.weather;
  if (!w) return null;
  if (game.neutral) return "Neutral site, under a roof";
  const stadium =
    league.teams.find((t) => t.id === game.homeId)?.stadium ?? stadiumFor(game.homeId);
  const roof =
    stadium.roof === "dome"
      ? "Dome"
      : stadium.roof === "retractable"
        ? `Retractable roof, ${w.indoors ? "closed" : "open"}`
        : "";
  const sky = w.indoors
    ? ""
    : [
        `${w.temperatureF}°F`,
        w.windMph > 0 ? `wind ${w.windMph} mph` : "calm",
        w.precipitation === "none" ? "" : w.precipitation,
      ]
        .filter(Boolean)
        .join(", ");
  const elevation = stadium.elevationMeters * FEET_PER_METER;
  const altitude =
    elevation >= 1000 ? `${Math.round(elevation).toLocaleString("en-US")} ft above sea level` : "";
  return [roof, sky, stadium.surface, altitude].filter(Boolean).join(" · ");
}
