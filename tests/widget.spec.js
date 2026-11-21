// The views and the states of the Summary widget. Outside Eva the mock events of
// example/google-calendar/ answer, moved to the current minute, so at the test time (14:20) the
// "Design review" ends in 25 min, "Gym" starts in 1 h 40 min and the plumber calls in 4 h 30 min.
// "Focus time" runs at 14:50 too, but config.json hides it. The made-up forecast of tests/helpers.js
// has rain from 17:00.
import { expect, test } from "@playwright/test";
import {
  calendars,
  eventAt,
  fakeConfig,
  fakeEvaCalendar,
  fakeEvaLocation,
  fakeWeather,
  open,
  openInFakeEva,
  testNow,
} from "./helpers.js";

const event = (page, title) => page.locator(".event", { hasText: title });
const place = { latitude: 40.42, longitude: -3.7, accuracy: 20, at: "2026-03-11T14:00:00Z" };

test.describe("the header strip on a computer", () => {
  test.beforeEach(async ({ page }) => {
    await fakeWeather(page);
  });

  test("480 x 70: the weather now, its next change, the event of now with its countdown, and +N", async ({ page }) => {
    await page.setViewportSize({ width: 480, height: 70 });
    await open(page, "header");
    await expect(page.locator('[data-role="temperature"]')).toHaveText("14°");
    await expect(page.locator('[data-role="change"]')).toHaveText("rain from 17:00");
    await expect(page.locator(".weather .icon-partly")).toHaveCount(1);
    await expect(page.locator(".event")).toHaveCount(1);
    await expect(event(page, "Design review")).toContainText("ends in 25 min");
    await expect(event(page, "Design review")).toHaveAttribute("data-kind", "now");
    await expect(page.locator(".more")).toHaveText("+2");
    await expect(page.getByText("Focus time")).toHaveCount(0);
  });

  test("640 x 76: more room shows more events, the most urgent first", async ({ page }) => {
    await page.setViewportSize({ width: 640, height: 76 });
    await open(page, "header");
    await expect(page.locator(".event-title")).toHaveText(["Design review", "Gym"]);
    await expect(event(page, "Gym")).toContainText("in 1 h 40 min");
    await expect(page.locator(".more")).toHaveText("+1");
  });

  test("320 x 64: one event, the temperature and +N still fit", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 64 });
    await open(page, "header");
    await expect(page.locator('[data-role="temperature"]')).toBeVisible();
    await expect(page.locator(".event")).toHaveCount(1);
    await expect(page.locator(".more")).toHaveText("+2");
  });

  for (const viewport of [
    { width: 320, height: 64 },
    { width: 480, height: 70 },
    { width: 640, height: 76 },
    { width: 358, height: 168 },
  ]) {
    test(`${String(viewport.width)} x ${String(viewport.height)}: nothing sits in Eva's top right corner`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport);
      await open(page, "header");
      const inCorner = await page.evaluate(() => {
        const width = window.innerWidth;
        const parts = document.querySelectorAll(
          ".event, .more, .weather-icon, .weather-text, .weather-range, .calm, .status, .later",
        );
        return [...parts].filter((node) => {
          const box = node.getBoundingClientRect();
          return box.width > 0 && box.right > width - 56 && box.top < 56;
        }).length;
      });
      expect(inCorner).toBe(0);
    });
  }
});

test("the header on a phone (358 x 168): the weather on top and the events in a list", async ({ page }) => {
  await fakeWeather(page);
  await page.setViewportSize({ width: 358, height: 168 });
  await open(page, "header");
  await expect(page.locator(".event-title")).toHaveText(["Design review", "Gym"]);
  await expect(page.locator(".more")).toHaveText("+1");
  const weather = await page.locator(".weather").boundingBox();
  const first = await page.locator(".event").first().boundingBox();
  expect(first.y).toBeGreaterThan(weather.y + weather.height - 1);
});

test.describe("the clock", () => {
  test.beforeEach(async ({ page }) => {
    await fakeWeather(page);
    await page.setViewportSize({ width: 640, height: 76 });
  });

  test("each countdown moves on by itself each minute", async ({ page }) => {
    await open(page, "header", { install: true });
    await expect(event(page, "Design review")).toContainText("ends in 25 min");
    await page.clock.runFor(61_000);
    await expect(event(page, "Design review")).toContainText("ends in 24 min");
    await expect(event(page, "Gym")).toContainText("in 1 h 39 min");
  });

  test("the widget draws again when the page shows again", async ({ page }) => {
    await open(page, "header");
    await page.clock.setFixedTime(new Date(testNow.getTime() + 10 * 60_000));
    await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    await expect(event(page, "Design review")).toContainText("ends in 15 min");
  });

  test("the calendar is read again after five minutes", async ({ page }) => {
    const requests = await fakeEvaCalendar(page, { calendars, events: [eventAt("Review", -10, 30)] });
    await open(page, "header", { install: true });
    const before = requests.length;
    await page.clock.runFor(5 * 60_000 + 1000);
    await expect.poll(() => requests.length).toBeGreaterThan(before);
    // From yesterday to tomorrow, so an event that started before midnight still shows.
    const events = requests.find((url) => url.pathname.endsWith("/events.json"));
    expect(events.searchParams.get("from")).toBe("2026-03-10");
    expect(events.searchParams.get("to")).toBe("2026-03-12");
  });

  test("the mock events are always around now, at any hour", async ({ page }) => {
    await open(page, "header", { now: new Date("2026-07-04T03:07:40Z") });
    await expect(event(page, "Design review")).toContainText("ends in 25 min");
    await expect(event(page, "Gym")).toContainText("in 1 h 40 min");
  });
});

test.describe("the states, with words", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 480, height: 70 });
  });

  test("nothing near: one calm line, and the next event of tomorrow", async ({ page }) => {
    await fakeWeather(page);
    await fakeEvaLocation(page, place);
    // Tomorrow at 09:00 is 18 h 40 min after the test time.
    await fakeEvaCalendar(page, { calendars, events: [eventAt("Standup", 18 * 60 + 40, 18 * 60 + 55)] });
    await open(page, "header");
    await expect(page.locator('[data-role="calm-line"]')).toHaveText("Nothing in the next 6 hours");
    await expect(page.locator('[data-role="calm-next"]')).toHaveText("Next: Standup tomorrow at 09:00");
  });

  test("nothing today or tomorrow says so", async ({ page }) => {
    await fakeWeather(page);
    await fakeEvaLocation(page, place);
    await fakeEvaCalendar(page, { calendars, events: [] });
    await open(page, "header");
    await expect(page.locator('[data-role="calm-next"]')).toHaveText("Nothing else today or tomorrow");
  });

  test("no Google login or Calendar off: the weather, and why the events are missing", async ({ page }) => {
    await fakeWeather(page);
    await fakeEvaLocation(page, place);
    await fakeEvaCalendar(page, { calendars: null, events: null });
    await open(page, "header");
    await expect(page.locator('[data-role="temperature"]')).toHaveText("14°");
    await expect(page.locator('[data-role="status"]')).toContainText("Calendar off");
    await expect(page.locator(".event")).toHaveCount(0);
  });

  test("the calendar fails: it says so, and tries again later", async ({ page }) => {
    await fakeWeather(page);
    await fakeEvaLocation(page, place);
    await fakeEvaCalendar(page, { status: 502 });
    await open(page, "header");
    await expect(page.locator('[data-role="status"]')).toContainText("Calendar not available now");
  });

  test("no location: only the events", async ({ page }) => {
    await fakeEvaLocation(page, null);
    await fakeEvaCalendar(page, { calendars, events: [eventAt("Review", -10, 30)] });
    await open(page, "header");
    await expect(page.locator(".weather")).toBeHidden();
    await expect(event(page, "Review")).toContainText("ends in 30 min");
  });

  for (const [size, width, height] of [
    ["medium", 418, 150],
    ["large", 418, 200],
  ]) {
    test(`no location in ${size}: the events take the weather's column, and no weather credit shows`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height });
      await fakeEvaLocation(page, null);
      await fakeEvaCalendar(page, { calendars, events: [eventAt("Review", -10, 30)] });
      await open(page, size);
      await expect(page.locator(".weather")).toBeHidden();
      await expect(page.locator(".credit")).toBeHidden();
      const agenda = await page.locator(".agenda").boundingBox();
      // The agenda starts near the left edge, with no empty column of the weather before it.
      expect(agenda.x).toBeLessThan(24);
    });
  }

  test("no location and the calendar off: words for both, never an empty strip", async ({ page }) => {
    await fakeEvaLocation(page, null);
    await fakeEvaCalendar(page, { calendars: null, events: null });
    await open(page, "header");
    await expect(page.locator('[data-role="sky"]')).toHaveText("No location yet");
    await expect(page.locator('[data-role="status"]')).toContainText("Calendar off");
  });

  test("the forecast fails: it says so, and the events still show", async ({ page }) => {
    await fakeWeather(page, { status: 500 });
    await fakeEvaLocation(page, place);
    await fakeEvaCalendar(page, { calendars, events: [eventAt("Review", -10, 30)] });
    await open(page, "header");
    await expect(page.locator('[data-role="sky"]')).toHaveText("Weather not available now");
    await expect(event(page, "Review")).toBeVisible();
  });
});

test.describe("the settings", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
  });

  test("all-day events show apart when the setting is on", async ({ page }) => {
    await fakeWeather(page);
    await fakeConfig(page, { showAllDay: true });
    await open(page, "full");
    await expect(event(page, "Local holiday")).toHaveAttribute("data-kind", "allday");
    await expect(event(page, "Local holiday")).toContainText("All day");
    // With no hideTitles, Focus time shows too.
    await expect(event(page, "Focus time")).toBeVisible();
  });

  test("all-day events stay out by default", async ({ page }) => {
    await fakeWeather(page);
    await open(page, "full");
    await expect(event(page, "Local holiday")).toHaveCount(0);
  });

  test("the hours to look ahead decide what is soon", async ({ page }) => {
    await fakeWeather(page);
    await fakeConfig(page, { hoursAhead: 2 });
    await open(page, "full");
    await expect(page.locator(".event-title")).toHaveText(["Design review", "Focus time", "Gym"]);
  });

  test("hideTitles hides each matching event, without case", async ({ page }) => {
    await fakeWeather(page);
    await fakeConfig(page, { hideTitles: "GYM|plumber" });
    await open(page, "full");
    await expect(page.locator(".event-title")).toHaveText(["Design review", "Focus time"]);
    await expect(page.locator(".timeline-bar", { hasText: "Gym" })).toHaveCount(0);
  });

  test("Fahrenheit asks Open-Meteo for Fahrenheit", async ({ page }) => {
    const requests = await fakeWeather(page);
    await fakeConfig(page, { unit: "fahrenheit" });
    await open(page, "full");
    expect(requests[0].searchParams.get("temperature_unit")).toBe("fahrenheit");
  });
});

test.describe("the menu of an event", () => {
  test.beforeEach(async ({ page }) => {
    await fakeWeather(page);
  });

  test("inside Eva: chat, Google Calendar and the project; each ask reaches Eva", async ({ page }) => {
    const { frame, asks } = await openInFakeEva(page, "header", { width: 640, height: 76 });
    await frame.locator(".event", { hasText: "Design review" }).click();
    const menu = frame.locator(".menu");
    await expect(menu).toBeVisible();
    await expect(menu.locator(".menu-action")).toHaveText([
      "Start a chat about this event",
      "See in Google Calendar",
      "Open the project Example app",
    ]);
    await expect(menu.getByRole("link", { name: "See in Google Calendar" })).toHaveAttribute(
      "href",
      "https://calendar.google.com/calendar/",
    );
    await menu.getByRole("button", { name: "Start a chat about this event" }).click();
    await expect(menu).toBeHidden();
    await expect.poll(asks).toHaveLength(1);
    const [chat] = await asks();
    expect(chat.ask).toBe("chat");
    expect(chat.text).toContain('"Design review"');
    expect(chat.text).toContain("Projects/2026-01-01-0900-example-app");
    await frame.locator(".event", { hasText: "Design review" }).click();
    await menu.getByRole("button", { name: "Open the project Example app" }).click();
    await expect.poll(asks).toHaveLength(2);
    expect((await asks())[1]).toMatchObject({ ask: "open", path: "Projects/2026-01-01-0900-example-app" });
  });

  test("an event with no project has no project entry", async ({ page }) => {
    const { frame } = await openInFakeEva(page, "header", { width: 640, height: 76 });
    await frame.locator(".event", { hasText: "Gym" }).click();
    await expect(frame.locator(".menu .menu-action")).toHaveText([
      "Start a chat about this event",
      "See in Google Calendar",
    ]);
  });

  test("Eva allows chat only: no project entry", async ({ page }) => {
    const { frame } = await openInFakeEva(page, "header", { asks: ["chat"], width: 640, height: 76 });
    await frame.locator(".event", { hasText: "Design review" }).click();
    await expect(frame.locator(".menu .menu-action")).toHaveCount(2);
  });

  test("outside Eva: only Google Calendar, after the short wait for Eva", async ({ page }) => {
    await page.setViewportSize({ width: 640, height: 76 });
    await open(page, "header");
    await event(page, "Design review").click();
    await expect(page.locator(".menu .menu-action")).toHaveText(["See in Google Calendar"]);
    await page.keyboard.press("Escape");
    await expect(page.locator(".menu")).toBeHidden();
  });

  test("+N lists the other events, and each opens its own menu", async ({ page }) => {
    await page.setViewportSize({ width: 480, height: 70 });
    await open(page, "header");
    await page.locator(".more").click();
    const menu = page.locator(".menu");
    await expect(menu.locator(".menu-action")).toHaveText([
      "Gym · in 1 h 40 min",
      "Call with the plumber · in 4 h 30 min",
    ]);
    await menu.getByRole("button", { name: /Gym/ }).click();
    await expect(page.locator('[data-role="menu-title"]')).toHaveText("Gym");
    await page.getByRole("button", { name: "Close" }).click();
    await expect(menu).toBeHidden();
  });

  test("in a large size, the menu floats beside the event", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await open(page, "full");
    await page.locator(".timeline-bar", { hasText: "Gym" }).click();
    const menu = await page.locator(".menu").boundingBox();
    expect(menu.width).toBeLessThan(400);
    await expect(page.locator('[data-role="menu-title"]')).toHaveText("Gym");
  });
});

test.describe("the grid sizes", () => {
  test.beforeEach(async ({ page }) => {
    await fakeWeather(page);
  });

  for (const [size, width, height, events] of [
    ["small", 180, 160, ["Design review"]],
    ["medium", 600, 170, ["Design review", "Gym", "Call with the plumber"]],
    ["tall", 300, 340, ["Design review", "Gym", "Call with the plumber"]],
    ["large", 1200, 160, ["Design review", "Gym", "Call with the plumber"]],
    ["xlarge", 900, 500, ["Design review", "Gym", "Call with the plumber"]],
    ["full", 1280, 800, ["Design review", "Gym", "Call with the plumber"]],
  ]) {
    test(`${size} at ${String(width)} x ${String(height)} shows the weather and the events that fit`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height });
      await open(page, size);
      await expect(page.locator('[data-role="temperature"]')).toHaveText("14°");
      await expect(page.locator(".event-title")).toHaveText(events);
    });
  }

  for (const size of ["large", "xlarge", "full"]) {
    test(`${size} shows a timeline of the next hours, with the weather of each hour`, async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 800 });
      await open(page, size);
      await expect(page.locator(".timeline-bar")).toHaveCount(3);
      await expect(page.locator(".timeline-mark.is-now")).toHaveText("Now");
      await expect(page.locator(".timeline-mark", { hasText: "17:00" }).locator("svg.icon-rain")).toHaveCount(1);
      await expect(page.locator(".later")).toHaveText("Later: Family dinner at 22:20");
    });
  }

  test("small and medium have no timeline", async ({ page }) => {
    await open(page, "medium");
    await expect(page.locator(".timeline")).toBeHidden();
  });
});
