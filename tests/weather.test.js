// The pure logic of weather.js, in a fixed time zone.
process.env.TZ = "UTC";

import assert from "node:assert/strict";
import { test } from "node:test";
import { changeWords, degrees, forecastUrl, hoursBetween, nextChange, pointOf, readForecast, sky } from "../weather.js";

/** An Open-Meteo answer with Unix times: one hour each from `first`, with these codes and chances. */
function answer({ first = "2026-03-11T00:00:00Z", code = 2, codes = [], rain = [] } = {}) {
  const start = Date.parse(first) / 1000;
  const time = Array.from({ length: 48 }, (_, index) => start + index * 3600);
  return {
    utc_offset_seconds: 0,
    current: { time: start + 14 * 3600, temperature_2m: 14.2, weather_code: code, is_day: 1 },
    hourly: {
      time,
      temperature_2m: time.map(() => 12),
      precipitation_probability: time.map((_, index) => rain[index] ?? 0),
      weather_code: time.map((_, index) => codes[index] ?? 2),
      is_day: time.map(() => 1),
    },
    daily: { time: [start], temperature_2m_max: [16], temperature_2m_min: [7] },
  };
}

const now = new Date("2026-03-11T14:20:00Z");

test("readForecast reads the weather now, each hour as a moment, and today's high and low", () => {
  const forecast = readForecast(answer());
  assert.deepEqual(forecast.now, { temperature: 14.2, code: 2, isDay: true });
  assert.equal(forecast.hours.length, 48);
  assert.equal(forecast.hours[17].at.toISOString(), "2026-03-11T17:00:00.000Z");
  assert.equal(forecast.high, 16);
  assert.equal(forecast.low, 7);
  assert.equal(readForecast({}), null);
  assert.equal(readForecast(undefined), null);
});

test("dry now: the next change is the first wet hour", () => {
  const codes = [];
  codes[17] = 61;
  assert.deepEqual(nextChange(readForecast(answer({ codes })), now), {
    kind: "rain",
    at: new Date("2026-03-11T17:00:00Z"),
  });
  assert.equal(changeWords(nextChange(readForecast(answer({ codes })), now), now), "rain from 17:00");
});

test("a high chance of rain counts as rain; a low one does not", () => {
  const rain = [];
  rain[16] = 30;
  rain[18] = 60;
  assert.equal(nextChange(readForecast(answer({ rain })), now).at.getUTCHours(), 18);
});

test("snow and storms have their own words", () => {
  const snow = [];
  snow[20] = 73;
  assert.equal(changeWords(nextChange(readForecast(answer({ codes: snow })), now), now), "snow from 20:00");
  const storm = [];
  storm[15] = 95;
  assert.equal(nextChange(readForecast(answer({ codes: storm })), now).kind, "storm");
});

test("wet now: the next change is the first dry hour", () => {
  const codes = Array(48).fill(63);
  codes[19] = 3;
  const change = nextChange(readForecast(answer({ code: 63, codes })), now);
  assert.equal(changeWords(change, now), "dry from 19:00");
});

test("a change of tomorrow says so; nothing past 12 hours", () => {
  const codes = [];
  codes[25] = 61;
  assert.equal(changeWords(nextChange(readForecast(answer({ codes })), now), now), "rain tomorrow from 01:00");
  const far = [];
  far[30] = 61;
  assert.equal(nextChange(readForecast(answer({ codes: far })), now), null);
  assert.equal(nextChange(readForecast(answer()), now), null);
  assert.equal(changeWords(null, now), "");
});

test("the address rounds the location and asks for Unix times", () => {
  const url = new URL(forecastUrl({ latitude: 48.8584, longitude: 2.2945 }, "fahrenheit"));
  assert.equal(url.origin, "https://api.open-meteo.com");
  assert.equal(url.searchParams.get("latitude"), "48.86");
  assert.equal(url.searchParams.get("longitude"), "2.29");
  assert.equal(url.searchParams.get("timeformat"), "unixtime");
  assert.equal(url.searchParams.get("temperature_unit"), "fahrenheit");
});

test("small helpers", () => {
  assert.deepEqual(sky(61), { text: "Light rain", icon: "rain" });
  assert.deepEqual(sky(1234), { text: "Unknown", icon: "cloud" });
  assert.equal(pointOf({ latitude: 100, longitude: 0 }), null);
  assert.equal(pointOf(null), null);
  assert.deepEqual(pointOf({ latitude: 1, longitude: 2, accuracy: 3 }), { latitude: 1, longitude: 2 });
  assert.equal(degrees(12.6), "13°");
  assert.equal(degrees(null), "–");
  const forecast = readForecast(answer());
  assert.equal(hoursBetween(forecast, now, new Date("2026-03-11T20:20:00Z")).length, 6);
});
