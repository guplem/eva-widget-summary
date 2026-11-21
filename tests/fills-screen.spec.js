// The widget fills the space that it gets, at every size, with no empty border (the widget
// contract). Eva's setup report checks that this test exists. Keep it.
import { expect, test } from "@playwright/test";
import { fakeWeather } from "./helpers.js";

// Never the real Open-Meteo in a test.
test.beforeEach(async ({ page }) => {
  await fakeWeather(page);
});

const viewports = [
  { width: 160, height: 160 },
  { width: 320, height: 200 },
  { width: 375, height: 667 },
  { width: 800, height: 400 },
  { width: 1280, height: 800 },
  { width: 1920, height: 1080 },
];

// The header slot of Eva's home page: a wide, short strip beside the greeting on a computer, and
// the first card of the grid, full width and one row high, on a phone.
const headerViewports = [
  { width: 320, height: 64 },
  { width: 480, height: 70 },
  { width: 640, height: 76 },
  { width: 358, height: 168 },
];

const cases = [
  ...headerViewports.map((viewport) => ["header", viewport]),
  ...["small", "medium", "large", "tall", "xlarge", "full"].flatMap((size) =>
    viewports.map((viewport) => [size, viewport]),
  ),
];

for (const [size, viewport] of cases) {
  test(`size ${size} fills ${String(viewport.width)} x ${String(viewport.height)}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto(`/?size=${size}`);
    await expect(page.locator(".widget")).toHaveAttribute("data-ready", "true");
    const box = await page.evaluate(() => {
      const widget = document.querySelector(".widget").getBoundingClientRect();
      // The content: every visible child of the widget, from the first top to the last bottom.
      const parts = [...document.querySelector(".widget").children]
        .map((child) => child.getBoundingClientRect())
        .filter((rect) => rect.height > 0);
      const padding = parseFloat(getComputedStyle(document.querySelector(".widget")).paddingBottom);
      return {
        widget: { left: widget.left, top: widget.top, width: widget.width, height: widget.height },
        contentBottom: Math.max(...parts.map((rect) => rect.bottom)),
        padding,
        scrollWidth: document.documentElement.scrollWidth,
        scrollHeight: document.documentElement.scrollHeight,
      };
    });
    expect(box.widget).toEqual({ left: 0, top: 0, width: viewport.width, height: viewport.height });
    expect(box.scrollWidth).toBe(viewport.width);
    expect(box.scrollHeight).toBe(viewport.height);
    // No empty band at the bottom: the content reaches the padding of the widget.
    expect(box.contentBottom).toBeGreaterThanOrEqual(viewport.height - box.padding - 1);
  });
}
