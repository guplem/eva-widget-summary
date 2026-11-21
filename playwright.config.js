import { defineConfig, devices } from "@playwright/test";

// Each widget repository comes from the same template, so each one would test on the same port.
// This one tests on 3140, and WIDGET_TEST_PORT picks another one, so two repositories can run their tests at once.
const port = process.env.WIDGET_TEST_PORT ?? "3140";
const address = `http://localhost:${port}/`;

// The tests run the widget on the small static server, as GitHub Pages runs it: writes fail there,
// and tests/helpers.js fakes them where a test needs them.
export default defineConfig({
  testDir: "tests",
  testMatch: "*.spec.js",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  reporter: process.env.CI ? "github" : "list",
  use: { baseURL: address, trace: "retain-on-failure", timezoneId: "UTC", locale: "en-GB" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "node scripts/serve.js",
    url: address,
    env: { PORT: port },
    // A server that already listens could be another widget's: the tests would load the wrong page.
    reuseExistingServer: false,
  },
});
