// The Summary widget. It talks to its host only through fetch to relative paths, to Open-Meteo (the
// host of its manifest), and to Eva's page by the asks of contract 3. Inside Eva, eva/google-calendar/
// answers with the person's calendar and eva/location.json with the last location. On GitHub Pages
// these paths do not exist, so the mock files under example/ answer, moved to the current time.
// See the contract: https://github.com/guplem/eva/blob/main/docs/widgets.md
//
// summary.js and weather.js hold the logic. This file loads the data and draws it.
import {
  addDays,
  agenda,
  calmWords,
  chatText,
  clockOf,
  dayOf,
  endsWords,
  exampleShift,
  fitSlots,
  hourMs,
  hoursAhead,
  moveExample,
  nextWords,
  readCalendars,
  readEvents,
  slotsFor,
  spanOf,
  timelineBars,
  titleFilter,
  untilWords,
} from "./summary.js";
import { changeWords, degrees, forecastUrl, hoursBetween, nextChange, pointOf, readForecast, sky } from "./weather.js";

const sizes = ["header", "small", "medium", "large", "tall", "xlarge", "full"];
/** The moment of the mock events that the demo moves to the current minute. */
const exampleAnchor = "2026-01-01T12:00:00";
const requestTimeoutMs = 15_000;
const locationTimeoutMs = 8000;
const calendarRefreshMs = 5 * 60_000;
const weatherRefreshMs = 30 * 60_000;
/** Outside Eva no answer to "hello" comes: after this wait, the entries that need Eva hide. */
const helloWaitMs = 400;
const askWaitMs = 3000;
const svgSpace = "http://www.w3.org/2000/svg";

const root = document.querySelector(".widget");
const part = (role) => root.querySelector(`[data-role="${role}"]`);

const state = {
  size: "full",
  unit: "celsius",
  hours: 6,
  showAllDay: false,
  hidden: titleFilter(""),
  /** loading, ready, off (Eva answers null) or error. */
  calendar: "loading",
  calendarAt: 0,
  calendars: new Map(),
  events: [],
  /** The shift of the mock events, fixed for the page, so a countdown runs on between two loads. */
  shift: null,
  /** loading, none (no location), ready or failed. */
  weather: "loading",
  weatherAt: 0,
  forecast: null,
  /** The asks that Eva allows, from her answer to "hello". */
  asks: new Set(),
};
let calendarTimer = 0;
let weatherTimer = 0;
let tickTimer = 0;

// --- Loading -------------------------------------------------------------------------------------

/** The answer at an address: `{ status, body }`. Status 0 when no answer came. */
async function request(address) {
  try {
    const response = await fetch(address, { cache: "no-store", signal: AbortSignal.timeout(requestTimeoutMs) });
    return { status: response.status, body: response.ok ? await response.json() : undefined };
  } catch {
    return { status: 0, body: undefined };
  }
}

/** A calendar path of Eva, or its mock file when the path does not exist, as on GitHub Pages. */
async function readCalendarPath(name, query = "") {
  const eva = await request(`eva/google-calendar/${name}${query}`);
  if (eva.status === 200) return { example: false, body: eva.body };
  if (eva.status !== 404) return { failed: true };
  const example = await request(`example/google-calendar/${name}`);
  return example.status === 200 ? { example: true, body: example.body } : { failed: true };
}

async function loadCalendar() {
  const today = dayOf(new Date());
  // From yesterday, so an event that started before midnight and runs on still shows.
  const query = `?from=${addDays(today, -1)}&to=${addDays(today, 1)}`;
  const [calendars, events] = await Promise.all([
    readCalendarPath("calendars.json"),
    readCalendarPath("events.json", query),
  ]);
  state.calendarAt = Date.now();
  clearTimeout(calendarTimer);
  calendarTimer = setTimeout(() => void loadCalendar().then(draw), calendarRefreshMs);
  if (calendars.failed === true || events.failed === true) {
    // A failure keeps the events that the widget shows; only a widget with none says so.
    if (state.calendar !== "ready") state.calendar = "error";
    return;
  }
  let body = events.body;
  if (events.example) {
    state.shift ??= exampleShift(exampleAnchor, new Date());
    body = moveExample(body, exampleAnchor, state.shift);
  }
  const list = readCalendars(calendars.body);
  const found = readEvents(body);
  if (list === null || found === null) {
    state.calendar = "off";
    return;
  }
  state.calendars = new Map(list.map((calendar) => [calendar.id, calendar]));
  state.events = found;
  state.calendar = "ready";
}

/** The browser's location, or null when the visitor does not allow it. */
function browserLocation() {
  if (!("geolocation" in navigator)) return Promise.resolve(null);
  return new Promise((resolve) => {
    setTimeout(() => resolve(null), locationTimeoutMs);
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => resolve({ latitude: coords.latitude, longitude: coords.longitude }),
      () => resolve(null),
      { timeout: locationTimeoutMs, maximumAge: 600000 },
    );
  });
}

/** Eva's location first, then the browser's, then the mock one, as the contract says. */
async function findLocation() {
  const eva = await request("eva/location.json");
  if (eva.status === 200) return pointOf(eva.body);
  if (eva.status !== 404) return null;
  return (await browserLocation()) ?? pointOf((await request("example/location.json")).body);
}

async function loadWeather() {
  clearTimeout(weatherTimer);
  weatherTimer = setTimeout(() => void loadWeather().then(draw), weatherRefreshMs);
  state.weatherAt = Date.now();
  const point = await findLocation();
  if (point === null) {
    state.weather = "none";
    return;
  }
  const read = readForecast((await request(forecastUrl(point, state.unit))).body);
  if (read === null) {
    // Keep the forecast that the widget shows, if any.
    if (state.forecast === null) state.weather = "failed";
    return;
  }
  state.forecast = read;
  state.weather = "ready";
}

// --- Asks to Eva (contract 3) --------------------------------------------------------------------

let askId = 0;
const waiting = new Map();

window.addEventListener("message", (message) => {
  if (message.source !== window.parent) return;
  const data = message.data;
  if (typeof data !== "object" || data === null || data.eva !== "widget") return;
  const resolve = waiting.get(data.id);
  if (resolve === undefined) return;
  waiting.delete(data.id);
  resolve(data);
});

/** Sends an ask to Eva and waits for her answer, or for `wait` ms: then `{ ok: false, reason: "no-answer" }`. */
function ask(fields, wait = askWaitMs) {
  if (window.parent === window) return Promise.resolve({ ok: false, reason: "no-answer" });
  askId += 1;
  const id = askId;
  return new Promise((resolve) => {
    waiting.set(id, resolve);
    setTimeout(() => {
      if (!waiting.delete(id)) return;
      resolve({ ok: false, reason: "no-answer" });
    }, wait);
    window.parent.postMessage({ eva: "widget", id, ...fields }, "*");
  });
}

async function hello() {
  const answer = await ask({ ask: "hello" }, helloWaitMs);
  state.asks = new Set(answer.ok === true && Array.isArray(answer.asks) ? answer.asks : []);
}

const refusals = {
  "not-allowed": "Eva does not allow this widget to do that. Approve it in Eva's widget settings.",
  "no-tap": "Eva needs a tap to do that. Try again.",
  "too-long": "The text was too long for Eva.",
  "not-found": "Eva could not find that.",
};

function showStatusNote(text) {
  const note = part("status");
  note.textContent = text;
  note.hidden = false;
  note.classList.add("is-note");
}

// --- Drawing helpers -----------------------------------------------------------------------------

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className !== undefined && className !== "") node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function svg(tag, attributes = {}) {
  const node = document.createElementNS(svgSpace, tag);
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, String(value));
  return node;
}

const cloudPath = "M7 19h10.5a4 4 0 0 0 .4-8 6 6 0 0 0-11.6 1.7A3.2 3.2 0 0 0 7 19z";
const sunRays = [0, 45, 90, 135, 180, 225, 270, 315];

/** A weather icon: clear, partly, cloud, fog, rain, snow or storm, as the Calendar widget draws it. */
function icon(kind, isDay = true) {
  const picture = svg("svg", { viewBox: "0 0 24 24", class: `icon icon-${kind}`, "aria-hidden": "true" });
  const sun = (x, y, radius) => {
    const group = svg("g", { class: "icon-sun" });
    group.append(svg("circle", { cx: x, cy: y, r: radius }));
    for (const angle of sunRays) {
      const rad = (angle * Math.PI) / 180;
      const near = radius + 1.6;
      const far = radius + 3.4;
      group.append(
        svg("line", {
          x1: x + near * Math.cos(rad),
          y1: y + near * Math.sin(rad),
          x2: x + far * Math.cos(rad),
          y2: y + far * Math.sin(rad),
        }),
      );
    }
    return group;
  };
  const moon = (x, y) =>
    svg("path", {
      class: "icon-moon",
      d: `M${String(x + 3)} ${String(y - 5.5)}a6 6 0 1 0 3.2 9.6A5 5 0 0 1 ${String(x + 3)} ${String(y - 5.5)}z`,
    });
  const cloud = (shift = 0) =>
    svg("path", { class: "icon-cloud", d: cloudPath, transform: `translate(0 ${String(shift)})` });
  if (kind === "clear") picture.append(isDay ? sun(12, 12, 4.5) : moon(10, 12));
  else if (kind === "partly") picture.append(isDay ? sun(8.5, 8, 3) : moon(7, 8), cloud(1.5));
  else if (kind === "cloud") picture.append(cloud());
  else if (kind === "fog") {
    for (const y of [8, 12, 16]) picture.append(svg("line", { class: "icon-fog", x1: 4, y1: y, x2: 20, y2: y }));
  } else {
    picture.append(cloud(-3));
    for (const x of [8.5, 12.5, 16.5]) {
      if (kind === "snow") picture.append(svg("circle", { class: "icon-snow", cx: x - 0.5, cy: 19.5, r: 1.1 }));
      else if (kind === "rain")
        picture.append(svg("line", { class: "icon-rain", x1: x, y1: 18, x2: x - 1.5, y2: 21.5 }));
    }
    if (kind === "storm") picture.append(svg("path", { class: "icon-bolt", d: "M13 15l-3 4h3l-2 4 5-5.5h-3l2-2.5z" }));
  }
  return picture;
}

/** Gives a node the colour of its calendar. The CSS object model is not an inline style: Eva's policy allows it. */
function paint(node, event) {
  const colour = state.calendars.get(event.calendarId)?.color ?? null;
  if (colour !== null) node.style.setProperty("--calendar-colour", colour);
  return node;
}

/** The words of an item: what it is, and how long until it ends or starts. */
function whenWords(item, now) {
  if (item.kind === "now") return endsWords(item.event.end - now);
  if (item.kind === "soon") return untilWords(item.event.start - now);
  return "All day";
}

// --- Drawing -------------------------------------------------------------------------------------

function drawWeather(now) {
  const box = part("weather");
  const iconBox = part("weather-icon");
  const temperature = part("temperature");
  const skyText = part("sky");
  const change = part("change");
  const range = part("range");
  box.dataset.state = state.weather;
  iconBox.replaceChildren();
  range.textContent = "";
  change.textContent = "";
  // With no location, the strip shows only the events, when it has them.
  box.hidden = state.weather === "none" && state.calendar === "ready";
  if (state.weather === "loading") {
    temperature.textContent = "";
    skyText.textContent = "Weather…";
    return;
  }
  if (state.weather === "none") {
    temperature.textContent = "";
    skyText.textContent = "No location yet";
    return;
  }
  if (state.weather === "failed") {
    temperature.textContent = "";
    skyText.textContent = "Weather not available now";
    return;
  }
  const { now: current } = state.forecast;
  const words = sky(current.code);
  iconBox.append(icon(words.icon, current.isDay));
  temperature.textContent = degrees(current.temperature);
  skyText.textContent = words.text;
  change.textContent = changeWords(nextChange(state.forecast, now), now);
  if (state.forecast.high !== null && state.forecast.low !== null)
    range.textContent = `${degrees(state.forecast.high)} / ${degrees(state.forecast.low)}`;
}

/** The items of the list, the most urgent first: what runs now, what starts soon, today's all-day events. */
function itemsAt(now) {
  const found = agenda(state.events, now, {
    hours: state.hours,
    showAllDay: state.showAllDay,
    hidden: state.hidden,
  });
  const items = [
    ...found.now.map((event) => ({ kind: "now", event })),
    ...found.soon.map((event) => ({ kind: "soon", event })),
    ...found.allDay.map((event) => ({ kind: "allday", event })),
  ];
  return { items, found };
}

function eventButton(item, now) {
  const button = paint(element("button", "event"), item.event);
  button.type = "button";
  button.dataset.kind = item.kind;
  const words = whenWords(item, now);
  button.setAttribute("aria-label", `${item.event.title}, ${words}`);
  button.append(
    element("span", "event-bar"),
    element("span", "event-title", item.event.title),
    element("span", "event-sep", " · "),
    element("span", "event-when", words),
  );
  button.addEventListener("click", () => openMenu(item.event, button));
  return button;
}

/** The size of an item of the list and the gap, from style.css: `--slot` and `--gap`, along `--axis`. */
function slotSize(list) {
  const style = getComputedStyle(list);
  const read = (name, fallback) => {
    const value = parseFloat(style.getPropertyValue(name));
    return Number.isFinite(value) ? value : fallback;
  };
  const axis = style.getPropertyValue("--axis").trim() === "row" ? "row" : "column";
  return { axis, item: read("--slot", 40), gap: read("--gap", 6), more: read("--more", 44) };
}

/** The one-line strip of the header slot on a computer, where every word counts. */
function strip() {
  return state.size === "header" && window.innerHeight < 120;
}

function drawAgenda(now) {
  const list = part("events");
  const calm = part("calm");
  const status = part("status");
  list.replaceChildren();
  part("later").textContent = "";
  calm.hidden = true;
  if (!status.classList.contains("is-note")) status.hidden = true;
  const agendaBox = part("agenda");
  agendaBox.dataset.state = state.calendar;
  if (state.calendar !== "ready") {
    root.classList.remove("has-events");
    status.classList.remove("is-note");
    status.hidden = false;
    status.textContent =
      state.calendar === "loading"
        ? "Loading your events…"
        : state.calendar === "off"
          ? strip()
            ? "Calendar off: log in to Google in Eva's Settings."
            : "Calendar off: in Eva, open Settings > Connections > Google, log in and tick Calendar."
          : strip()
            ? "Calendar not available now. Trying again soon."
            : "Your calendar did not load. The widget tries again in a few minutes.";
    return;
  }
  const { items, found } = itemsAt(now);
  part("later").textContent =
    found.soon.length > 0 && found.later !== null ? nextWords(found.later, now).replace(/^Next:/, "Later:") : "";
  if (found.now.length === 0 && found.soon.length === 0) {
    calm.hidden = false;
    part("calm-line").textContent = calmWords(state.hours);
    part("calm-next").textContent = nextWords(found.next, now);
  }
  root.classList.toggle("has-events", items.length > 0);
  if (items.length === 0) return;
  const { axis, item, gap, more } = slotSize(list);
  // The list is empty now; the box of the list decides the space, less the lines under the list.
  const others = [calm, part("later")]
    .filter((node) => !node.hidden && node.textContent !== "" && getComputedStyle(node).display !== "none")
    .reduce((sum, node) => sum + node.getBoundingClientRect()[axis === "row" ? "width" : "height"] + 8, 0);
  const space = (axis === "row" ? agendaBox.clientWidth : agendaBox.clientHeight) - others;
  const { shown, more: rest } = fitSlots(items, slotsFor(items.length, space, { item, gap, more }));
  for (const each of shown) {
    const row = element("li", "events-item");
    row.append(eventButton(each, now));
    list.append(row);
  }
  if (rest > 0) {
    const row = element("li", "events-item is-more");
    const button = element("button", "more", `+${String(rest)}`);
    button.type = "button";
    button.setAttribute("aria-label", `${String(rest)} more ${rest === 1 ? "event" : "events"}`);
    button.addEventListener("click", () => openList(items.slice(items.length - rest), button));
    row.append(button);
    list.append(row);
  }
}

function drawTimeline(now) {
  const box = part("timeline");
  box.replaceChildren();
  const shown = ["large", "xlarge", "full"].includes(state.size) && state.calendar === "ready";
  box.hidden = !shown;
  if (!shown) return;
  const end = new Date(now.getTime() + state.hours * hourMs);
  const events = state.events.filter((event) => !state.hidden(event.title));
  const { bars, lanes } = timelineBars(events, now, end);
  const span = end.getTime() - now.getTime();
  const share = (date) => (date.getTime() - now.getTime()) / span;
  const scale = element("div", "timeline-scale");
  const width = Math.max(1, box.clientWidth);
  const forecastHours = hoursBetween(state.forecast, now, end);
  // A mark at each whole hour, with its weather when the forecast has it.
  const first = new Date(now);
  first.setMinutes(0, 0, 0);
  const nowMark = element("div", "timeline-mark is-now");
  nowMark.style.setProperty("--left", "0");
  nowMark.append(element("span", "timeline-hour", "Now"));
  scale.append(nowMark);
  const step = state.hours > 12 ? 3 : state.hours > 6 ? 2 : 1;
  for (let at = new Date(first.getTime() + hourMs); at <= end; at = new Date(at.getTime() + hourMs)) {
    // A mark too near "Now" or the right end would cover its label.
    if (at.getHours() % step !== 0 || share(at) * width < 44 || (1 - share(at)) * width < 20) continue;
    const mark = element("div", "timeline-mark");
    mark.style.setProperty("--left", String(share(at)));
    mark.append(element("span", "timeline-hour", clockOf(at)));
    const weather = forecastHours.find((hour) => Math.abs(hour.at.getTime() - at.getTime()) < 60_000);
    if (weather !== undefined && weather.code !== null) {
      const small = element("span", "timeline-weather");
      small.append(icon(sky(weather.code).icon, weather.isDay), element("span", "", degrees(weather.temperature)));
      mark.append(small);
    }
    scale.append(mark);
  }
  const track = element("div", "timeline-track");
  track.style.setProperty("--lanes", String(Math.max(1, lanes)));
  for (const bar of bars) {
    const node = paint(element("button", "timeline-bar"), bar.event);
    node.type = "button";
    node.dataset.kind = bar.event.start <= now ? "now" : "soon";
    node.style.setProperty("--left", String(bar.left));
    node.style.setProperty("--width", String(bar.width));
    node.style.setProperty("--lane", String(bar.lane));
    node.setAttribute("aria-label", `${bar.event.title}, ${spanOf(bar.event)}`);
    node.append(element("span", "timeline-title", bar.event.title));
    node.addEventListener("click", () => openMenu(bar.event, node));
    track.append(node);
  }
  if (bars.length === 0) track.append(element("p", "timeline-empty", calmWords(state.hours)));
  box.append(scale, track);
}

function draw() {
  const now = new Date();
  closeMenuIfGone();
  drawWeather(now);
  drawAgenda(now);
  drawTimeline(now);
  root.dataset.calendar = state.calendar;
  root.dataset.weather = state.weather;
}

// --- The menu ------------------------------------------------------------------------------------

let menuEvent = null;

function closeMenu() {
  part("menu").hidden = true;
  menuEvent = null;
}

function closeMenuIfGone() {
  if (menuEvent !== null && !state.events.includes(menuEvent)) closeMenu();
}

/** Places the menu near `anchor` in the large sizes; in the small ones, style.css lays it over the widget. */
function placeMenu(anchor) {
  const menu = part("menu");
  menu.style.removeProperty("--menu-left");
  menu.style.removeProperty("--menu-top");
  if (getComputedStyle(menu).getPropertyValue("--menu-mode").trim() !== "float") return;
  const frame = root.getBoundingClientRect();
  const box = anchor.getBoundingClientRect();
  const size = menu.getBoundingClientRect();
  const margin = 8;
  let left = Math.min(Math.max(margin, box.left), frame.width - size.width - margin);
  let top = box.bottom + 6;
  if (top + size.height > frame.height - margin) top = Math.max(margin, box.top - 6 - size.height);
  // Keep Eva's full-screen corner free.
  if (top < 56 && left + size.width > frame.width - 56) left = Math.max(margin, frame.width - 56 - size.width);
  menu.style.setProperty("--menu-left", `${String(Math.round(left))}px`);
  menu.style.setProperty("--menu-top", `${String(Math.round(top))}px`);
}

function menuButton(text, onClick) {
  const button = element("button", "menu-action", text);
  button.type = "button";
  button.addEventListener("click", onClick);
  return button;
}

function showMenu(title, when, actions, anchor) {
  const menu = part("menu");
  part("menu-title").textContent = title;
  part("menu-when").textContent = when;
  part("menu-actions").replaceChildren(...actions);
  menu.hidden = false;
  placeMenu(anchor);
  (actions.find((node) => node.tagName === "BUTTON" || node.tagName === "A") ?? part("menu-close")).focus();
}

function openMenu(event, anchor) {
  menuEvent = event;
  const now = new Date();
  const actions = [];
  if (state.asks.has("chat")) {
    actions.push(
      menuButton("Open a chat about this event", () => {
        const answer = ask({ ask: "chat", text: chatText(event, now) });
        closeMenu();
        void answer.then((result) => {
          if (result.ok !== true) showStatusNote(refusals[result.reason] ?? "Eva did not answer. Try again.");
        });
      }),
    );
  }
  if (event.link !== null) {
    const link = element("a", "menu-action", "See in Google Calendar");
    link.href = event.link;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.addEventListener("click", () => closeMenu());
    actions.push(link);
  }
  if (event.project !== null && state.asks.has("open")) {
    actions.push(
      menuButton(`Open the project ${event.project.title}`, () => {
        const answer = ask({ ask: "open", path: event.project.path });
        closeMenu();
        void answer.then((result) => {
          if (result.ok !== true) showStatusNote(refusals[result.reason] ?? "Eva did not answer. Try again.");
        });
      }),
    );
  }
  if (actions.length === 0) actions.push(element("p", "menu-empty", "Open Eva to chat about this event."));
  const when = event.allDay
    ? "All day"
    : event.start > now
      ? `${spanOf(event)} · ${untilWords(event.start - now)}`
      : `${spanOf(event)} · ${endsWords(event.end - now)}`;
  const place = event.place === null ? "" : ` · ${event.place}`;
  showMenu(event.title, `${when}${place}`, actions, anchor);
}

/** The list behind the "+N" chip: each event opens its own menu. */
function openList(items, anchor) {
  const now = new Date();
  const actions = items.map((item) =>
    menuButton(`${item.event.title} · ${whenWords(item, now)}`, () => openMenu(item.event, anchor)),
  );
  menuEvent = null;
  showMenu(`${String(items.length)} more`, "", actions, anchor);
}

part("menu-close").addEventListener("click", closeMenu);
document.addEventListener("keydown", (key) => {
  if (key.key === "Escape") closeMenu();
});
document.addEventListener("click", (click) => {
  const menu = part("menu");
  // A tap in the "+N" list replaces the entries, so its target has left the page by now.
  if (menu.hidden || !(click.target instanceof Node) || !click.target.isConnected) return;
  if (menu.contains(click.target) || click.target.closest?.(".event, .more, .timeline-bar")) return;
  closeMenu();
});

// --- Clock ---------------------------------------------------------------------------------------

/** Draws again at the start of each minute, so each countdown moves with the clock. */
function scheduleTick() {
  clearTimeout(tickTimer);
  const wait = 60_000 - (Date.now() % 60_000) + 50;
  tickTimer = setTimeout(() => {
    draw();
    scheduleTick();
  }, wait);
}

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible") return;
  draw();
  scheduleTick();
  const age = Date.now();
  if (age - state.calendarAt >= calendarRefreshMs) void loadCalendar().then(draw);
  if (age - state.weatherAt >= weatherRefreshMs) void loadWeather().then(draw);
});

let resizeFrame = 0;
window.addEventListener("resize", () => {
  cancelAnimationFrame(resizeFrame);
  resizeFrame = requestAnimationFrame(draw);
});

async function start() {
  const size = new URLSearchParams(window.location.search).get("size");
  // Opened alone in a browser, the widget shows its full-screen view.
  state.size = sizes.includes(size) ? size : "full";
  root.dataset.size = state.size;
  const config = (await request("config.json")).body ?? {};
  state.unit = config.unit === "fahrenheit" ? "fahrenheit" : "celsius";
  state.hours = hoursAhead(config.hoursAhead);
  state.showAllDay = config.showAllDay === true || config.showAllDay === "true";
  state.hidden = titleFilter(config.hideTitles);
  draw();
  await Promise.all([loadCalendar().then(draw), loadWeather().then(draw), hello()]);
  draw();
  scheduleTick();
  // Tests wait for this flag: every part of the widget has its content now.
  root.dataset.ready = "true";
}

void start();
