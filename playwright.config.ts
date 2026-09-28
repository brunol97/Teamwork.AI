import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: "list",
  use: {
    baseURL: process.env.BASE_URL ?? "http://localhost:8080",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: "pnpm exec agent-native dev",
    url: "http://localhost:8080",
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      DATABASE_URL: "pglite:./data/pglite-e2e",
      AUTH_DISABLED: "true",
      AGENT_OFFICE_MOCK_LLM_RESPONSE:
        "Dit is een geautomatiseerd testantwoord van de Ollama-agent.",
    },
  },
});
