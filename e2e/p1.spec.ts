import { expect, test } from "@playwright/test";

test("sign-in page loads", async ({ page }) => {
  const response = await page.goto("/");
  expect(response?.status()).toBe(200);
  await expect(page).toHaveTitle(/Agent Office/);
  await expect(page.locator("text=Sign in").first()).toBeVisible();
});
