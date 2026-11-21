// The pure logic of summary.js. The time zone is Madrid, which changes its clock twice a year, so
// the tests can cross a clock change. Node reads TZ again when it changes.
process.env.TZ = "Europe/Madrid";

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  agenda,
  calmWords,
  chatText,
  endsWords,
  exampleShift,
  fitSlots,
  hoursAhead,
  maxPatternLength,
  moveExample,
  nextWords,
  readEvents,
  slotsFor,
  timelineBars,
  titleFilter,
  untilWords,
} from "../summary.js";

/** A timed event, from two local times such as "2026-03-11T14:00". */
function timed(title, start, end, extra = {}) {
  return { id: title, calendarId: "c", title, startAt: start, endAt: end, ...extra };
}

const at = (text) => new Date(text);

test("readEvents keeps a timed event, an all-day event, the description and the project", () => {
  const events = readEvents([
    timed("Review", "2026-03-11T10:00:00+01:00", "2026-03-11T11:00:00+01:00", {
      description: "Bring the notes",
      project: { id: "2026-01-01-0900-app", title: "App", path: "Projects/2026-01-01-0900-app" },
      link: "javascript:alert(1)",
    }),
    { id: "h", title: "Holiday", date: "2026-03-11", endDate: "2026-03-11" },
    { id: "x", title: "No start" },
    timed("", "2026-03-11T12:00:00+01:00", "2026-03-11T12:30:00+01:00", { project: { path: "/etc" } }),
  ]);
  assert.equal(events.length, 3);
  assert.equal(events[0].description, "Bring the notes");
  assert.deepEqual(events[0].project, {
    id: "2026-01-01-0900-app",
    title: "App",
    path: "Projects/2026-01-01-0900-app",
  });
  assert.equal(events[0].link, null);
  assert.equal(events[1].allDay, true);
  assert.equal(events[2].title, "Busy");
  assert.equal(events[2].project, null);
  assert.equal(readEvents(null), null);
});

test("readEvents makes a midnight-to-midnight event an all-day one", () => {
  const [event] = readEvents([timed("Trip", "2026-03-11T00:00:00", "2026-03-13T00:00:00")]);
  assert.equal(event.allDay, true);
  assert.equal(event.date, "2026-03-11");
  assert.equal(event.endDate, "2026-03-12");
});

test("an event that runs now is 'now'; one that starts within the hours is 'soon'; later ones are not", () => {
  const now = at("2026-03-11T14:20:00");
  const events = readEvents([
    timed("Past", "2026-03-11T09:00:00", "2026-03-11T09:30:00"),
    timed("Long", "2026-03-11T13:00:00", "2026-03-11T17:00:00"),
    timed("Review", "2026-03-11T14:00:00", "2026-03-11T14:45:00"),
    timed("Gym", "2026-03-11T16:00:00", "2026-03-11T17:00:00"),
    timed("Edge", "2026-03-11T20:20:00", "2026-03-11T21:00:00"),
    timed("Late", "2026-03-11T20:21:00", "2026-03-11T21:00:00"),
    { id: "h", title: "Holiday", date: "2026-03-11", endDate: "2026-03-11" },
  ]);
  const result = agenda(events, now, { hours: 6 });
  // The one that ends first comes first.
  assert.deepEqual(
    result.now.map((event) => event.title),
    ["Review", "Long"],
  );
  assert.deepEqual(
    result.soon.map((event) => event.title),
    ["Gym", "Edge"],
  );
  assert.deepEqual(result.allDay, []);
  assert.equal(result.next, null);
});

test("an event that ends at this minute is no longer 'now'; one that starts at this minute is", () => {
  const now = at("2026-03-11T14:00:00");
  const events = readEvents([
    timed("Ended", "2026-03-11T13:00:00", "2026-03-11T14:00:00"),
    timed("Starts", "2026-03-11T14:00:00", "2026-03-11T15:00:00"),
  ]);
  assert.deepEqual(
    agenda(events, now).now.map((event) => event.title),
    ["Starts"],
  );
});

test("all-day events show only with the setting on", () => {
  const now = at("2026-03-11T14:20:00");
  const events = readEvents([
    { id: "h", title: "Holiday", date: "2026-03-10", endDate: "2026-03-12" },
    { id: "t", title: "Tomorrow", date: "2026-03-12", endDate: "2026-03-12" },
  ]);
  assert.deepEqual(agenda(events, now).allDay, []);
  assert.deepEqual(
    agenda(events, now, { showAllDay: true }).allDay.map((event) => event.title),
    ["Holiday"],
  );
});

test("when nothing starts soon, the next event of today or tomorrow comes, never a later one", () => {
  const now = at("2026-03-11T14:20:00");
  const tomorrow = readEvents([timed("Standup", "2026-03-12T09:00:00", "2026-03-12T09:15:00")]);
  const result = agenda(tomorrow, now, { hours: 6 });
  assert.equal(result.next.title, "Standup");
  assert.equal(nextWords(result.next, now), "Next: Standup tomorrow at 09:00");
  const today = readEvents([timed("Dinner", "2026-03-11T21:00:00", "2026-03-11T22:00:00")]);
  assert.equal(nextWords(agenda(today, now, { hours: 6 }).next, now), "Next: Dinner at 21:00");
  const far = readEvents([timed("Trip", "2026-03-13T09:00:00", "2026-03-13T10:00:00")]);
  assert.equal(agenda(far, now).next, null);
  assert.equal(nextWords(null, now), "Nothing else today or tomorrow");
  assert.equal(calmWords(6), "Nothing in the next 6 hours");
  assert.equal(calmWords(1), "Nothing in the next hour");
});

test("the countdown words", () => {
  assert.equal(untilWords(100 * 60_000), "in 1 h 40 min");
  assert.equal(untilWords(60 * 60_000), "in 1 h");
  assert.equal(untilWords(5 * 60_000), "in 5 min");
  // A started minute counts as a whole one.
  assert.equal(untilWords(30_000), "in 1 min");
  assert.equal(untilWords(0), "now");
  assert.equal(endsWords(25 * 60_000), "ends in 25 min");
  assert.equal(endsWords(24.5 * 60_000), "ends in 25 min");
  assert.equal(endsWords(0), "ends now");
});

test("across midnight: an event of tomorrow is soon, and one from yesterday runs now", () => {
  const now = at("2026-03-11T23:30:00");
  const events = readEvents([
    timed("Night shift", "2026-03-11T22:00:00", "2026-03-12T01:00:00"),
    timed("Early", "2026-03-12T00:45:00", "2026-03-12T01:30:00"),
  ]);
  const result = agenda(events, now);
  assert.equal(result.now[0].title, "Night shift");
  assert.equal(endsWords(result.now[0].end - now), "ends in 1 h 30 min");
  assert.equal(result.soon[0].title, "Early");
  assert.equal(untilWords(result.soon[0].start - now), "in 1 h 15 min");
});

test("across a clock change, a countdown is the real time", () => {
  // Madrid, 29 March 2026: the clock jumps from 02:00 to 03:00.
  const spring = at("2026-03-29T01:50:00");
  const [early] = readEvents([timed("Early run", "2026-03-29T03:30:00", "2026-03-29T04:30:00")]);
  assert.equal(untilWords(early.start - spring), "in 40 min");
  // Madrid, 25 October 2026: the clock goes back from 03:00 to 02:00.
  const autumn = new Date("2026-10-24T23:30:00Z");
  const [late] = readEvents([timed("Late call", "2026-10-25T01:30:00Z", "2026-10-25T02:30:00Z")]);
  assert.equal(untilWords(late.start - autumn), "in 2 h");
  assert.equal(agenda([late], autumn, { hours: 2 }).soon.length, 1);
});

test("the title filter is a regular expression without case, and plain text when it is not valid", () => {
  assert.equal(titleFilter("^focus time$")("Focus Time"), true);
  assert.equal(titleFilter("^focus time$")("Focus time with Sam"), false);
  assert.equal(titleFilter("lunch|commute")("Commute home"), true);
  // Not a valid expression: the text itself.
  assert.equal(titleFilter("Gym (")("Gym (legs)"), true);
  assert.equal(titleFilter("Gym (")("Gym"), false);
  assert.equal(titleFilter("")("Anything"), false);
  assert.equal(titleFilter("   ")("Anything"), false);
  assert.equal(titleFilter(undefined)("Anything"), false);
  // A longer setting is cut: the end past the limit is ignored.
  assert.equal(titleFilter(`${" ".repeat(maxPatternLength)}, zzz`)("zzz"), false);
  assert.equal(titleFilter(`${" ".repeat(maxPatternLength - 10)}, zzz`)("zzz"), true);
});

test("the title filter reads several expressions separated by commas, as the Calendar widget does", () => {
  const hide = titleFilter("^lunch$, focus time");
  assert.equal(hide("Lunch"), true);
  assert.equal(hide("Focus time block"), true);
  assert.equal(hide("Lunch with Sam"), false);
  // A comma inside {} or [] belongs to its expression.
  assert.equal(titleFilter("^a{2,3}$")("aaa"), true);
  assert.equal(titleFilter("x[,;]y")("x;y"), true);
});

test("the title filter reads a slow expression as plain text, so a title cannot freeze the widget", () => {
  const started = Date.now();
  assert.equal(titleFilter("(a+)+$")(`${"a".repeat(40)}!`), false);
  assert.ok(Date.now() - started < 100);
});

test("the filter hides events from now, soon and next", () => {
  const now = at("2026-03-11T14:20:00");
  const events = readEvents([
    timed("Focus time", "2026-03-11T14:00:00", "2026-03-11T15:00:00"),
    timed("Gym", "2026-03-11T16:00:00", "2026-03-11T17:00:00"),
  ]);
  const result = agenda(events, now, { hidden: titleFilter("focus") });
  assert.deepEqual(result.now, []);
  assert.equal(result.soon[0].title, "Gym");
});

test("the hours to look ahead: 6 by default, from 1 to 24", () => {
  assert.equal(hoursAhead(undefined), 6);
  assert.equal(hoursAhead("abc"), 6);
  assert.equal(hoursAhead(3), 3);
  assert.equal(hoursAhead("12"), 12);
  assert.equal(hoursAhead(0), 1);
  assert.equal(hoursAhead(100), 24);
  assert.equal(hoursAhead(2.6), 3);
});

test("what fits in N slots, with a +N chip for the rest", () => {
  const items = ["a", "b", "c", "d"];
  assert.deepEqual(fitSlots(items, 4), { shown: items, more: 0 });
  assert.deepEqual(fitSlots(items, 2), { shown: ["a", "b"], more: 2 });
  assert.deepEqual(fitSlots(items, 0), { shown: [], more: 4 });
  assert.deepEqual(fitSlots(items, 9), { shown: items, more: 0 });
  // Three items of 100 px with gaps of 8 need 316 px.
  assert.equal(slotsFor(3, 316, { item: 100, gap: 8, more: 40 }), 3);
  // In 300 px, two items and the chip fit (2 * 108 + 40 = 256), three do not.
  assert.equal(slotsFor(3, 300, { item: 100, gap: 8, more: 40 }), 2);
  assert.equal(slotsFor(3, 120, { item: 100, gap: 8, more: 40 }), 0);
  assert.equal(slotsFor(0, 500, { item: 100 }), 0);
});

test("the mock events move with the clock, so one runs now and two start soon", () => {
  const anchor = "2026-01-01T12:00:00";
  const now = at("2026-03-11T14:20:30");
  const shift = exampleShift(anchor, now);
  const moved = readEvents(
    moveExample(
      [
        timed("Review", "2026-01-01T11:15:00", "2026-01-01T12:25:00"),
        timed("Gym", "2026-01-01T13:40:00", "2026-01-01T15:00:00"),
        { id: "h", title: "Holiday", date: "2026-01-01", endDate: "2026-01-01" },
      ],
      anchor,
      shift,
    ),
  );
  assert.equal(endsWords(moved[0].end - now), "ends in 25 min");
  assert.equal(untilWords(moved[1].start - now), "in 1 h 40 min");
  assert.equal(moved[2].date, "2026-03-11");
});

test("the timeline puts overlapping events on lanes", () => {
  const from = at("2026-03-11T14:00:00");
  const to = at("2026-03-11T20:00:00");
  const events = readEvents([
    timed("A", "2026-03-11T13:00:00", "2026-03-11T15:00:00"),
    timed("B", "2026-03-11T14:30:00", "2026-03-11T16:00:00"),
    timed("C", "2026-03-11T17:00:00", "2026-03-11T18:00:00"),
    timed("Out", "2026-03-11T21:00:00", "2026-03-11T22:00:00"),
  ]);
  const { bars, lanes } = timelineBars(events, from, to);
  assert.equal(lanes, 2);
  assert.deepEqual(
    bars.map((bar) => [bar.event.title, bar.lane]),
    [
      ["A", 0],
      ["B", 1],
      ["C", 0],
    ],
  );
  assert.equal(bars[0].left, 0);
  assert.ok(Math.abs(bars[2].left - 0.5) < 1e-9);
});

test("the chat text names the event, its time, its place and its project", () => {
  const now = at("2026-03-11T14:20:00");
  const [event] = readEvents([
    timed("Review", "2026-03-11T14:00:00", "2026-03-11T14:45:00", {
      place: "Room B",
      project: { id: "app", title: "App", path: "Projects/app" },
    }),
  ]);
  assert.equal(
    chatText(event, now),
    'Let us talk about my event "Review" (today 14:00–14:45, Room B). It belongs to my project "App" (Projects/app).',
  );
  const [long] = readEvents([
    timed("Long", "2026-03-11T14:00:00", "2026-03-11T14:45:00", { description: "x".repeat(3000) }),
  ]);
  assert.equal(chatText(long, now).length, 2000);
  const [emoji] = readEvents([
    timed("Emoji", "2026-03-11T14:00:00", "2026-03-11T14:45:00", { description: "😀".repeat(1500) }),
  ]);
  const text = chatText(emoji, now);
  assert.ok(text.length <= 2000);
  assert.ok(!/[\uD800-\uDBFF]…$/.test(text));
});
