/**
 * What the weather and the stadium do to a game, from effects fitted on real
 * games (calibration/elements.json). The league-wide tables the engine draws
 * from already average over real weather, so each effect is measured from the
 * average real conditions: a dome game kicks a little better than average, a
 * windy December game a lot worse.
 */
import { ELEMENTS, TUNING } from "./config";
import type { Conditions } from "./types";

export interface WeatherEffects {
  fieldGoalLogit: number;
  completionLogit: number;
  /** Multiplies how far a completed pass goes. */
  catchYardsFactor: number;
  /** Multiplies fumble chances. */
  fumbleFactor: number;
  puntYards: number;
  touchbackLogit: number;
  shortKickLogit: number;
}

export function weatherEffects(c: Conditions | undefined): WeatherEffects {
  const E = ELEMENTS.effects;
  const avg = E.average;
  const W = TUNING.weather;
  const K = TUNING.specialTeams;
  const outside = c !== undefined && !c.indoors;
  const wind = outside ? c.windMph : 0;
  const cold = outside && c.temperatureF <= W.coldF ? 1 : 0;
  const rain = outside && c.precipitation === "rain" ? 1 : 0;
  const snow = outside && c.precipitation === "snow" ? 1 : 0;
  const precip = rain + snow;
  // Thin air helps kicks under a roof too.
  const altitude = (c?.elevationMeters ?? 0) >= W.altitudeMeters ? 1 : 0;
  const avgPrecip = avg.rain + avg.snow;
  const dWind = wind - avg.wind;
  const yardsInRain = (share: number) => 1 + (E.yardsPerCatch.precip - 1) * share;
  const fumblesBy = (r: number, s: number) =>
    1 + (E.fumbles.rain - 1) * r + (E.fumbles.snow - 1) * s;
  return {
    fieldGoalLogit:
      E.fieldGoal.windPerMph * dWind +
      E.fieldGoal.cold * (cold - avg.cold) +
      E.fieldGoal.precip * (precip - avgPrecip) +
      E.fieldGoal.altitude * (altitude - avg.altitude),
    completionLogit:
      E.completion.windPerMph * dWind +
      E.completion.cold * (cold - avg.cold) +
      E.completion.precip * (precip - avgPrecip),
    catchYardsFactor:
      ((1 + E.yardsPerCatch.perMphOfWind * dWind) * yardsInRain(precip)) / yardsInRain(avgPrecip),
    fumbleFactor: fumblesBy(rain, snow) / fumblesBy(avg.rain, avg.snow),
    puntYards: E.punt.yardsPerMphOfWind * dWind + E.punt.altitudeYards * (altitude - avg.altitude),
    touchbackLogit:
      -K.touchbackPerMphOfWind * dWind + K.touchbackAtAltitude * (altitude - avg.altitude),
    shortKickLogit: K.shortKickPerMphOfWind * dWind,
  };
}
