import { defineConfig, devices } from "@playwright/test";

const fixturePort = process.env.SUBJAP_FIXTURE_PORT ?? "4173";
const fixtureOrigin = `http://127.0.0.1:${fixturePort}`;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: fixtureOrigin,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: `npm.cmd run test:fixture -- --port ${fixturePort}`,
    url: `${fixtureOrigin}/tests/fixture/index.html`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
