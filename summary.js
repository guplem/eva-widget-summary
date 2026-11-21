// The logic of the Summary widget: which events happen now, which start soon, the words of each
// countdown, the title filter, and what fits in the strip. This file reads no page and no network,
// so the unit tests of tests/summary.test.js run it in Node.
//
// Each time is in the time zone of the browser, as `new Date()` gives it. A countdown is the real
// time between two moments, so it stays right across midnight and across a clock change.

export const minuteMs = 60_000;
export const hourMs = 3_600_000;
const isoDay = /^\d{4}-\d{2}-\d{2}$/;

/** The longest `hideTitles` expression that the widget reads. A longer one is cut. */
export const maxPatternLength = 200;
/** The hours to look ahead when the setting is missing, and the range that the widget allows. */
export const defaultHours = 6;
export const maxHours = 24;
/** The longest text of a chat ask (round 3 plan, section 3.1). */
export const maxChatLength = 2000;

/** The day of a date in the browser's time zone, as `YYYY-MM-DD`. */
export function dayOf(date) {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${String(date.getFullYear())}-${month}-${day}`;
}

/** The day `count` days after `day` (before it for a negative count). */
export function addDays(day, count) {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + count);
  return date.toISOString().slice(0, 10);
}

/** The number of days from `from` to `to`: 1 from today to tomorrow. */
export function daysBetween(from, to) {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/** The `HH:MM` of a date. */
export function clockOf(date) {
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

/** A link that a tap may open: an https address only, never a `javascript:` one. */
export function safeLink(value) {
  if (typeof value !== "string") return null;
  try {
    return new URL(value).protocol === "https:" ? value : null;
  } catch {
    return null;
  }
}

/** The calendars of `calendars.json`, as `{ id, name, color }`, or null for Eva's `null` answer. */
export function readCalendars(value) {
  if (!Array.isArray(value)) return null;
  return value
    .filter((calendar) => typeof calendar?.id === "string")
    .map((calendar) => ({
      id: calendar.id,
      name: typeof calendar.name === "string" && calendar.name !== "" ? calendar.name : "Calendar",
      color: typeof calendar.color === "string" && /^#[0-9a-fA-F]{3,8}$/.test(calendar.color) ? calendar.color : null,
    }));
}

/** The title of an event with no title: Google Calendar shows such an event as busy time. */
export const noTitle = "Busy";

function isMidnight(date) {
  return date.getHours() === 0 && date.getMinutes() === 0 && date.getSeconds() === 0 && date.getMilliseconds() === 0;
}

/** The project of an event (contract 3), or null: `{ id, title, path }`. */
function projectOf(value) {
  if (typeof value !== "object" || value === null) return null;
  if (typeof value.path !== "string" || value.path === "" || value.path.startsWith("/")) return null;
  const id = typeof value.id === "string" ? value.id : value.path.split("/").pop();
  const title = typeof value.title === "string" && value.title.trim() !== "" ? value.title : id;
  return { id, title, path: value.path };
}

/**
 * The events of `events.json`, or null for Eva's `null` answer. A timed event gets `start` and
 * `end` as dates; an all-day event gets `allDay: true` with `date` and `endDate`. A timed event
 * from a midnight to a later midnight is an all-day event, as Google Calendar shows it. An event
 * that a person or a tool wrote with fewer fields is kept when it can be shown.
 */
export function readEvents(value) {
  if (!Array.isArray(value)) return null;
  const events = [];
  for (const item of value) {
    if (typeof item !== "object" || item === null) continue;
    const base = {
      id: typeof item.id === "string" ? item.id : "",
      calendarId: typeof item.calendarId === "string" ? item.calendarId : "",
      title: typeof item.title === "string" && item.title.trim() !== "" ? item.title.trim() : noTitle,
      place: typeof item.place === "string" && item.place !== "" ? item.place : null,
      link: safeLink(item.link),
      description: typeof item.description === "string" && item.description !== "" ? item.description : null,
      project: projectOf(item.project),
    };
    if (typeof item.date === "string" && isoDay.test(item.date)) {
      const endDate = typeof item.endDate === "string" && item.endDate >= item.date ? item.endDate : item.date;
      events.push({ ...base, allDay: true, date: item.date, endDate });
      continue;
    }
    const start = new Date(typeof item.startAt === "string" ? item.startAt : Number.NaN);
    const end = new Date(typeof item.endAt === "string" ? item.endAt : Number.NaN);
    if (Number.isNaN(start.getTime())) continue;
    // An event with no end, or an end before its start, counts as a short event.
    const safeEnd = Number.isNaN(end.getTime()) || end <= start ? new Date(start.getTime() + 30 * minuteMs) : end;
    if (isMidnight(start) && isMidnight(safeEnd)) {
      events.push({ ...base, allDay: true, date: dayOf(start), endDate: dayOf(new Date(safeEnd.getTime() - 1)) });
      continue;
    }
    events.push({ ...base, allDay: false, start, end: safeEnd });
  }
  return events;
}

function escapeExpression(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * The `hideTitles` setting as a test of a title: true hides the event. The setting is a regular
 * expression, read without case. An expression that is not valid is plain text. An empty setting
 * hides nothing. The widget reads the first `maxPatternLength` characters only.
 */
export function titleFilter(source) {
  if (typeof source !== "string") return () => false;
  const text = source.trim().slice(0, maxPatternLength);
  if (text === "") return () => false;
  let expression;
  try {
    expression = new RegExp(text, "i");
  } catch {
    expression = new RegExp(escapeExpression(text), "i");
  }
  return (title) => expression.test(title);
}

/** The hours to look ahead, from the setting: a whole number from 1 to 24, 6 when not given. */
export function hoursAhead(value) {
  const number = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  if (typeof number !== "number" || !Number.isFinite(number)) return defaultHours;
  return Math.max(1, Math.min(maxHours, Math.round(number)));
}

/** The mock events move with the clock: the shift, to the minute, from `anchor` to `now`. */
export function exampleShift(anchor, now) {
  const start = new Date(anchor).getTime();
  return Math.floor(now.getTime() / minuteMs) * minuteMs - start;
}

/**
 * The example events of the demo, moved by `shift` milliseconds, so they always sit around now: one
 * runs now, and two start soon. An all-day event moves by whole days, from the day of `anchor`.
 */
export function moveExample(value, anchor, shift) {
  if (!Array.isArray(value)) return value;
  const anchorDate = new Date(anchor);
  const days = daysBetween(dayOf(anchorDate), dayOf(new Date(anchorDate.getTime() + shift)));
  const moveTime = (text) =>
    typeof text === "string" && !Number.isNaN(Date.parse(text))
      ? new Date(Date.parse(text) + shift).toISOString()
      : text;
  const moveDay = (text) => (typeof text === "string" && isoDay.test(text) ? addDays(text, days) : text);
  return value.map((event) => ({
    ...event,
    ...("date" in event ? { date: moveDay(event.date), endDate: moveDay(event.endDate) } : {}),
    ...("startAt" in event ? { startAt: moveTime(event.startAt), endAt: moveTime(event.endAt) } : {}),
  }));
}

/**
 * What the widget shows at `now`:
 *
 * - `now`: the timed events that run now, the one that ends first first.
 * - `soon`: the timed events that start within `hours`, the first first.
 * - `allDay`: the all-day events of today, when `showAllDay` is on.
 * - `later`: the first timed event of today or tomorrow after the hours, else null.
 * - `next`: `later` when nothing starts soon, else null.
 *
 * `hidden(title)` hides an event (the `hideTitles` setting).
 */
export function agenda(events, now, { hours = defaultHours, showAllDay = false, hidden = () => false } = {}) {
  const time = now.getTime();
  const horizon = time + hours * hourMs;
  const today = dayOf(now);
  const shown = events.filter((event) => !hidden(event.title));
  const timed = shown.filter((event) => !event.allDay).sort((a, b) => a.start - b.start || a.end - b.end);
  const running = timed
    .filter((event) => event.start.getTime() <= time && event.end.getTime() > time)
    .sort((a, b) => a.end - b.end);
  const soon = timed.filter((event) => event.start.getTime() > time && event.start.getTime() <= horizon);
  const allDay = showAllDay
    ? shown.filter((event) => event.allDay && event.date <= today && event.endDate >= today)
    : [];
  const tomorrow = addDays(today, 1);
  const later = timed.find((event) => event.start.getTime() > horizon && dayOf(event.start) <= tomorrow) ?? null;
  return { now: running, soon, allDay, next: soon.length > 0 ? null : later, later };
}

/** A span of minutes as words: "25 min", "1 h", "1 h 40 min". */
function spanWords(minutes) {
  if (minutes < 60) return `${String(minutes)} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${String(hours)} h` : `${String(hours)} h ${String(rest)} min`;
}

/** The time until a start: "now", "in 5 min", "in 1 h 40 min". A started minute counts as a whole one. */
export function untilWords(milliseconds) {
  const minutes = Math.ceil(milliseconds / minuteMs);
  return minutes <= 0 ? "now" : `in ${spanWords(minutes)}`;
}

/** The time until an end: "ends in 25 min", "ends in 2 h", or "ends now". */
export function endsWords(milliseconds) {
  const minutes = Math.ceil(milliseconds / minuteMs);
  return minutes <= 0 ? "ends now" : `ends in ${spanWords(minutes)}`;
}

/** The calm line when nothing starts soon: "Nothing in the next 6 hours", "Nothing in the next hour". */
export function calmWords(hours) {
  return hours === 1 ? "Nothing in the next hour" : `Nothing in the next ${String(hours)} hours`;
}

/** The next event after the calm line: "Next: Dinner at 20:00", "Next: Standup tomorrow at 09:00". */
export function nextWords(event, now) {
  if (event === null || event === undefined) return "Nothing else today or tomorrow";
  const day = dayOf(event.start) === dayOf(now) ? "" : " tomorrow";
  return `Next: ${event.title}${day} at ${clockOf(event.start)}`;
}

/** The time span of an event: "10:00–12:45", or "All day". */
export function spanOf(event) {
  return event.allDay ? "All day" : `${clockOf(event.start)}–${clockOf(event.end)}`;
}

/**
 * How many items fit in `space` pixels, each `item` wide with `gap` between, when a "+N" chip of
 * `more` pixels must show after them if some do not fit. Never less than 0.
 */
export function slotsFor(total, space, { item, gap = 0, more = 0 }) {
  if (total <= 0) return 0;
  if (total * item + (total - 1) * gap <= space) return total;
  return Math.max(0, Math.min(total - 1, Math.floor((space - more) / (item + gap))));
}

/** The first `slots` items, and how many stay out for the "+N" chip. */
export function fitSlots(items, slots) {
  const count = Math.max(0, Math.min(items.length, Math.floor(slots)));
  return { shown: items.slice(0, count), more: items.length - count };
}

/**
 * The bars of a timeline from `from` to `to` (dates): each timed event that touches it, with `left`
 * and `width` as shares of the line, in the first lane that is free. Returns `{ bars, lanes }`.
 */
export function timelineBars(events, from, to) {
  const start = from.getTime();
  const span = to.getTime() - start;
  const laneEnds = [];
  const bars = events
    .filter((event) => !event.allDay && event.end.getTime() > start && event.start.getTime() < to.getTime())
    .sort((a, b) => a.start - b.start)
    .map((event) => {
      const left = Math.max(0, (event.start.getTime() - start) / span);
      const right = Math.min(1, (event.end.getTime() - start) / span);
      let lane = laneEnds.findIndex((end) => end <= left);
      if (lane < 0) lane = laneEnds.length;
      laneEnds[lane] = right;
      return { event, left, width: Math.max(0, right - left), lane };
    });
  return { bars, lanes: laneEnds.length };
}

/** The text that "Open a chat about this event" puts in Eva's message box, 2000 characters at most. */
export function chatText(event, now) {
  const when = event.allDay
    ? `${event.date === dayOf(now) ? "today" : event.date}, all day`
    : `${dayOf(event.start) === dayOf(now) ? "today" : dayOf(event.start)} ${spanOf(event)}`;
  const parts = [`Let us talk about my event "${event.title}" (${when}`];
  if (event.place !== null) parts.push(`, ${event.place}`);
  parts.push(").");
  if (event.project !== null) parts.push(` It belongs to my project "${event.project.title}" (${event.project.path}).`);
  if (event.description !== null) parts.push(`\n\nIts description: ${event.description}`);
  const text = parts.join("");
  if (text.length <= maxChatLength) return text;
  // Cut in UTF-16 units, as a JavaScript string counts, never in the middle of a character.
  const cut = text.slice(0, maxChatLength - 1).replace(/[\uD800-\uDBFF]$/, "");
  return `${cut}…`;
}
