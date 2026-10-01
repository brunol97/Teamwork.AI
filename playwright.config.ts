import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [["list"], ["html", { open: "never" }]],
  outputDir: "./test-results",
  use: {
    baseURL: process.env.BASE_URL ?? "http://localhost:8080",
    // Keep a trace of the first retry so a flaky failure can be inspected.
    trace: "on-first-retry",
    // Record video for every run, not just failures, so a reviewer can watch the
    // flow without re-running it. Recordings are uploaded by .github/workflows/pr-e2e.yml.
    video: { mode: "on", size: { width: 1280, height: 720 } },
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    // Apply migrations before the dev server boots. Inside the dev server,
    // framework and app migrations race at boot on PGlite and can deadlock;
    // doing it first keeps the webServer start deterministic.
    command: "pnpm exec tsx scripts/migrate-on-deploy.ts && pnpm exec agent-native dev",
    url: "http://localhost:8080",
    reuseExistingServer: false,
    timeout: 240_000,
    env: {
      DATABASE_URL: "pglite:./data/pglite-e2e",
      AUTH_DISABLED: "true",
      AGENT_OFFICE_MOCK_LLM_RESPONSE:
        "Dit is een geautomatiseerd testantwoord van de Ollama-agent.",
    },
  },
});
