// The weather of the Summary widget, from Open-Meteo: the weather now and the next change that
// matters, such as "rain from 17:00". This file reads no page and no network, so the unit tests of
// tests/weather.test.js run it in Node.
//
// The widget asks Open-Meteo for each time as a Unix time (`timeformat=unixtime`), so a time is a
// real moment, in every time zone and across a clock change.

import { clockOf, dayOf } from "./summary.js";

export const forecastHost = "https://api.open-meteo.com";
/** How far the next change may be: past that, the widget says nothing about it. */
export const changeHorizonHours = 12;
/** A chance of rain from this percentage counts as rain. */
const rainChance = 50;

/** The sky of each WMO weather code, which Open-Meteo gives as `weather_code`, with its icon. */
const skies = new Map([
  [0, ["Clear", "clear"]],
  [1, ["Mostly clear", "clear"]],
  [2, ["Partly cloudy", "partly"]],
  [3, ["Cloudy", "cloud"]],
  [45, ["Fog", "fog"]],
  [48, ["Icy fog", "fog"]],
  [51, ["Light drizzle", "rain"]],
  [53, ["Drizzle", "rain"]],
  [55, ["Heavy drizzle", "rain"]],
  [56, ["Freezing drizzle", "rain"]],
  [57, ["Freezing drizzle", "rain"]],
  [61, ["Light rain", "rain"]],
  [63, ["Rain", "rain"]],
  [65, ["Heavy rain", "rain"]],
  [66, ["Freezing rain", "rain"]],
  [67, ["Freezing rain", "rain"]],
  [71, ["Light snow", "snow"]],
  [73, ["Snow", "snow"]],
  [75, ["Heavy snow", "snow"]],
  [77, ["Snow grains", "snow"]],
  [80, ["Light showers", "rain"]],
  [81, ["Showers", "rain"]],
  [82, ["Heavy showers", "rain"]],
  [85, ["Snow showers", "snow"]],
  [86, ["Heavy snow showers", "snow"]],
  [95, ["Thunderstorm", "storm"]],
  [96, ["Thunderstorm with hail", "storm"]],
  [99, ["Thunderstorm with hail", "storm"]],
]);

/** The words and the icon of a weather code: `{ text, icon }`. An unknown code reads "Unknown". */
export function sky(code) {
  const [text, icon] = skies.get(code) ?? ["Unknown", "cloud"];
  return { text, icon };
}

/** A point of eva/location.json, or null when the value is not one. */
export function pointOf(value) {
  if (typeof value !== "object" || value === null) return null;
  const { latitude, longitude } = value;
  if (typeof latitude !== "number" || typeof longitude !== "number") return null;
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;
  return { latitude, longitude };
}

/** The address of the forecast. The location leaves the device with two decimals, about one kilometre. */
export function forecastUrl(point, unit = "celsius") {
  const query = new URLSearchParams({
    latitude: point.latitude.toFixed(2),
    longitude: point.longitude.toFixed(2),
    current: "temperature_2m,weather_code,is_day",
    hourly: "temperature_2m,precipitation_probability,weather_code,is_day",
    daily: "temperature_2m_max,temperature_2m_min",
    timezone: "auto",
    timeformat: "unixtime",
    forecast_days: "3",
    temperature_unit: unit === "fahrenheit" ? "fahrenheit" : "celsius",
  });
  return `${forecastHost}/v1/forecast?${query.toString()}`;
}

function number(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function list(block, key) {
  return Array.isArray(block?.[key]) ? block[key] : [];
}

/**
 * The forecast of an Open-Meteo answer, or null when it holds no weather now:
 * `{ now: { temperature, code, isDay }, hours: [{ at, temperature, rain, code, isDay }], high, low }`,
 * where `at` is a date and `high` and `low` are today's, or null.
 */
export function readForecast(body) {
  const current = body?.current;
  const temperature = number(current?.temperature_2m);
  if (temperature === null) return null;
  const hourly = body?.hourly;
  const hours = list(hourly, "time")
    .map((time, index) => ({
      at: new Date(Number(time) * 1000),
      temperature: number(list(hourly, "temperature_2m")[index]),
      rain: number(list(hourly, "precipitation_probability")[index]),
      code: number(list(hourly, "weather_code")[index]),
      isDay: list(hourly, "is_day")[index] !== 0,
    }))
    .filter((hour) => !Number.isNaN(hour.at.getTime()));
  return {
    now: { temperature, code: number(current.weather_code), isDay: current.is_day !== 0 },
    hours,
    high: number(list(body?.daily, "temperature_2m_max")[0]),
    low: number(list(body?.daily, "temperature_2m_min")[0]),
  };
}

/** The kind of wet weather of a code: "storm", "snow", "rain", or null for dry. */
function wetKind(code) {
  const icon = sky(code).icon;
  return icon === "storm" || icon === "snow" || icon === "rain" ? icon : null;
}

function hourKind(hour) {
  return wetKind(hour.code) ?? (hour.rain !== null && hour.rain >= rainChance ? "rain" : null);
}

/**
 * The next change that matters, within the next `changeHorizonHours` hours: `{ kind, at }`, where
 * `kind` is "rain", "snow" or "storm" when it is dry now and wet weather comes, or "dry" when it is
 * wet now and the wet weather stops. Null when nothing changes.
 */
export function nextChange(forecast, now) {
  if (forecast === null || forecast === undefined) return null;
  const time = now.getTime();
  const wetNow = wetKind(forecast.now.code) !== null;
  const horizon = time + changeHorizonHours * 3_600_000;
  for (const hour of forecast.hours) {
    const at = hour.at.getTime();
    if (at <= time || at > horizon) continue;
    const kind = hourKind(hour);
    if (!wetNow && kind !== null) return { kind, at: hour.at };
    if (wetNow && kind === null) return { kind: "dry", at: hour.at };
  }
  return null;
}

/** The words of a change: "rain from 17:00", "dry from 19:00", "snow tomorrow from 06:00". */
export function changeWords(change, now) {
  if (change === null) return "";
  const day = dayOf(change.at) === dayOf(now) ? "" : " tomorrow";
  return `${change.kind}${day} from ${clockOf(change.at)}`;
}

/** The hours of the forecast from `from` to `to`, for the timeline. */
export function hoursBetween(forecast, from, to) {
  if (forecast === null || forecast === undefined) return [];
  return forecast.hours.filter((hour) => hour.at >= from && hour.at <= to);
}

/** A temperature as the widget shows it, such as "12°". */
export function degrees(value) {
  return typeof value === "number" ? `${String(Math.round(value))}°` : "–";
}
