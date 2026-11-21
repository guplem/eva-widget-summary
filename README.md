# Summary

A widget for [Eva](https://github.com/guplem/eva)'s home page. In one glance, at the right of Eva's greeting: the weather now, the events that happen now and how long until each ends, and the events of the next hours and how long until each starts.

**Demo:** https://guplem.github.io/eva-widget-summary/ (add `?size=header` for the strip)

The demo shows made-up events placed around the time you open it, so one event is always in progress and two are coming. Its weather is for your real location when your browser allows it, and for an example location otherwise.

Weather data by [Open-Meteo](https://open-meteo.com/), under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).

## What it does

- **The weather now:** an icon, the temperature and a word, such as "Partly cloudy". When the next 12 hours bring a change that matters, it says so: "rain from 17:00", "snow tomorrow from 06:00", or "dry from 19:00" when it rains now.
- **What happens now:** each event in progress, with how long until it ends: "Design review", "ends in 25 min". The one that ends first comes first, in the main colour.
- **What comes soon:** each event that starts within the next hours (6 by default), with how long until it starts: "Gym", "in 1 h 40 min".
- **When nothing is near:** one calm line, "Nothing in the next 6 hours", and the next event of today or tomorrow: "Next: Team standup tomorrow at 09:00".
- **A tap on an event** opens a small menu:
  - **Start a chat about this event** puts a line about the event in Eva's message box. Eva never sends it by herself.
  - **See in Google Calendar** opens the event in a new tab.
  - **Open the project** opens the project of the event in Eva, when its description has a line such as `[eva-project:2026-11-02-1030-example-app]`.

  Outside Eva, only the Google Calendar entry shows.

- It counts down by itself each minute and when the page shows again, reads your calendar again every 5 minutes, and the weather every 30 minutes. A countdown is the real time left, also across midnight and across a clock change.

### Each size

- **Header**, the strip beside Eva's greeting on a computer (about 320 to 640 px wide and 64 to 76 px high): the weather on the left, then the events side by side, the most urgent first, as many as fit, and "+3" for the rest. A tap on "+3" lists them. On a narrow strip the weather keeps the next change, or only the temperature. On a phone the strip is the first card of the grid: the weather on top and the events in a list.
- **Small:** the weather on top, then the most urgent events.
- **Medium:** the weather on the left, the events on the right.
- **Tall:** the weather with today's high and low, the events, and the next event after the hours.
- **Large, extra-large and full screen:** the same, with a timeline of the next hours: each event as a bar at its real time, and the weather of each hour along the top.

The right 64 px of the strip, and the top right corner of every size, stay free for Eva's full-screen button.

## Settings

| Setting              | What it does                                                                                                                                                                                                                                                                                                              |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Google Calendar      | Your events, through Eva's own Google login. The widget only reads them, and never sees your login. With no Google login, or with Calendar off, the widget shows the weather and says how to turn the calendar on.                                                                                                        |
| Location             | Your last location, for the weather. The widget sends it to `https://api.open-meteo.com`, rounded to two decimals (about one kilometre), and nothing else. With no location, it shows only your events.                                                                                                                   |
| Temperature unit     | Celsius or Fahrenheit.                                                                                                                                                                                                                                                                                                    |
| Hours to look ahead  | How many hours ahead an event counts as "soon", from 1 to 24. 6 by default.                                                                                                                                                                                                                                               |
| Show all-day events  | Off by default. On, today's all-day events, such as a holiday, show after the timed ones.                                                                                                                                                                                                                                 |
| Hide events by title | Regular expressions, case-insensitive, separated by commas, such as `^Lunch$, Focus time`, as in the Calendar widget. An event whose title matches one of them does not show. A pattern that is not valid, or that could take very long, counts as plain text. The widget reads the first 500 characters and 20 patterns. |

Eva asks you for each permission when you turn the widget on: the calendar, the location, the Open-Meteo address, and the two asks (a line in the message box, and opening a project).

## Add it to Eva

Add the widget by its address: `https://github.com/guplem/eva-widget-summary`. It needs an Eva that knows widget contract 3, the contract of the header slot and of the asks. Eva places it in the header slot by default; in **Settings > Personalize > Widget layout** you can move it into the grid, where it shows the view of its size.

## Run it on your computer

A browser does not run the widget from a double-click on `index.html`. Run a small web server instead:

```sh
npm install
npm start
```

Then open http://localhost:3000/. Add `?size=header`, `small`, `medium`, `large`, `tall`, `xlarge` or `full` to the address to see each size.

## Change it

The widget follows the [widget contract](https://github.com/guplem/eva/blob/main/docs/widgets.md) of Eva. `AGENTS.md` says how to work on it, for people and for coding agents. `npm run check` runs every check. The tests answer Open-Meteo with a made-up forecast, fix the clock and the time zone, and use the mock events of `example/google-calendar/`, which move with the clock.

## License

MIT. See [`LICENSE`](LICENSE). The weather data belongs to Open-Meteo and its sources.
