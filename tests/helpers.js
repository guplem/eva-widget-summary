// Helpers for the widget tests. The tests never call the real Open-Meteo: a helper answers it with a
// made-up forecast. The tests also fix the clock, and the Playwright config fixes the time zone
// (UTC), so the mock events, which move with the clock, and the forecast fall on known hours.

/** The time of the tests: Wednesday 2026-03-11 at 14:20, in the UTC time zone of the browser. */
export const testNow = new Date("2026-03-11T14:20:00Z");

/**
 * A made-up Open-Meteo answer with Unix times, for 3 days from midnight of `testNow`: partly cloudy
 * now at 14.2°, rain from 17:00 to 20:00, and a mild day curve.
 */
export function forecastFor({ code = 2, rainFrom = 17, rainTo = 20 } = {}) {
  const start = Date.parse("2026-03-11T00:00:00Z") / 1000;
  const time = Array.from({ length: 72 }, (_, index) => start + index * 3600);
  const hourOf = (index) => index % 24;
  const wet = (index) => index >= rainFrom && index < rainTo;
  return {
    latitude: 48.86,
    longitude: 2.29,
    timezone: "UTC",
    utc_offset_seconds: 0,
    current: { time: start + 14 * 3600, temperature_2m: 14.2, weather_code: code, is_day: 1 },
    hourly: {
      time,
      temperature_2m: time.map((_, index) => {
        const curve = Math.max(0, Math.sin((Math.PI * (hourOf(index) - 6)) / 16));
        return Math.round((7 + 9 * curve) * 10) / 10;
      }),
      precipitation_probability: time.map((_, index) => (wet(index) ? 70 : 5)),
      weather_code: time.map((_, index) => (wet(index) ? 61 : code)),
      is_day: time.map((_, index) => (hourOf(index) >= 7 && hourOf(index) < 19 ? 1 : 0)),
    },
    daily: {
      time: [start, start + 86400, start + 172800],
      temperature_2m_max: [16, 15, 17],
      temperature_2m_min: [7, 6, 8],
    },
  };
}

/** Answers Open-Meteo with the made-up forecast, or with `status`. Returns the asked addresses. */
export async function fakeWeather(page, { status = 200, forecast = forecastFor() } = {}) {
  const requests = [];
  await page.route("https://api.open-meteo.com/**", (route) => {
    requests.push(new URL(route.request().url()));
    return route.fulfill(
      status === 200
        ? {
            status: 200,
            contentType: "application/json",
            // A browser needs the CORS header.
            headers: { "access-control-allow-origin": "*" },
            body: JSON.stringify(forecast),
          }
        : { status },
    );
  });
  return requests;
}

/** Answers eva/location.json as Eva does, with this point, or with null for "no location yet". */
export async function fakeEvaLocation(page, point) {
  await page.route("**/eva/location.json", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(point) }),
  );
}

/**
 * Answers eva/google-calendar/ as Eva does: `calendars` and `events` as the bodies (null for "no
 * Google login or Calendar off"), or `status` for a failure. Returns the asked addresses.
 */
export async function fakeEvaCalendar(page, { calendars = null, events = null, status = 200 } = {}) {
  const requests = [];
  await page.route("**/eva/google-calendar/**", (route) => {
    const url = new URL(route.request().url());
    requests.push(url);
    if (status !== 200) return route.fulfill({ status });
    const body = url.pathname.endsWith("/calendars.json") ? calendars : events;
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
  });
  return requests;
}

/** Answers config.json with these values. */
export async function fakeConfig(page, config) {
  await page.route("**/config.json", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(config) }),
  );
}

/** A timed event of Eva's calendar, from minutes after `testNow`. */
export function eventAt(title, fromMinutes, toMinutes, extra = {}) {
  const at = (minutes) => new Date(testNow.getTime() + minutes * 60_000).toISOString();
  return {
    id: title,
    calendarId: "work@example.com",
    title,
    startAt: at(fromMinutes),
    endAt: at(toMinutes),
    place: null,
    link: "https://calendar.google.com/calendar/",
    description: null,
    project: null,
    ...extra,
  };
}

export const calendars = [{ id: "work@example.com", name: "Work", color: "#3f51b5", primary: true }];

/**
 * Opens the widget at a size, at the time of the tests, and waits until it has drawn. `install`
 * installs a fake clock that the test moves on with `page.clock.runFor`.
 */
export async function open(page, size, { now = testNow, install = false } = {}) {
  if (install) await page.clock.install({ time: now });
  else await page.clock.setFixedTime(now);
  await page.goto(size === undefined ? "/" : `/?size=${size}`);
  await page.locator('.widget[data-ready="true"]').waitFor();
}

/**
 * Makes the widget a frame of a page that plays Eva: it answers "hello" with `asks`, and records
 * each ask. Returns the frame and the list of asks.
 */
export async function openInFakeEva(page, size, { asks = ["chat", "open"], width = 480, height = 70 } = {}) {
  await page.clock.setFixedTime(testNow);
  await page.goto("/tests/fake-eva.html");
  await page.evaluate(({ asks, size, width, height }) => window.startFrame({ asks, size, width, height }), {
    asks,
    size,
    width,
    height,
  });
  const frame = page.frameLocator("iframe");
  await frame.locator('.widget[data-ready="true"]').waitFor();
  return { frame, asks: () => page.evaluate(() => window.received) };
}
