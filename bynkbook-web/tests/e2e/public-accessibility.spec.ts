import { expect, test } from "@playwright/test";

test("landing page is honest, keyboard reachable, and does not overflow", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("Private beta bookkeeping workspace")).toBeVisible();
  await expect(page.getByText("Launch-ready bookkeeping controls")).toHaveCount(0);
  await expect(page.getByText("3x")).toHaveCount(0);
  await expect(page.getByText("100%")).toHaveCount(0);

  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Skip to main content" })).toBeFocused();

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});

test("signup credentials use one semantic form with named fields", async ({ page }) => {
  await page.goto("/signup");
  const form = page.locator("form");
  await expect(form).toHaveCount(1);
  await expect(form.getByLabel("Email")).toHaveAttribute("name", "email");
  await expect(form.getByLabel("Password")).toHaveAttribute("name", "password");
  await expect(form.getByRole("button", { name: "Create account" })).toHaveAttribute("type", "submit");
});

test("legal pages are clearly marked as pre-release drafts", async ({ page }) => {
  await page.goto("/privacy");
  await expect(page.getByRole("heading", { name: "Privacy Notice (Draft)" })).toBeVisible();
  await page.goto("/terms");
  await expect(page.getByRole("heading", { name: "Terms of Service (Draft)" })).toBeVisible();
});

test("protected routes redirect unauthenticated users without exposing app content", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login\?next=%2Fdashboard/);
  await expect(page.getByRole("heading", { name: /sign in to bynkbook/i })).toBeVisible();
});

test("coarse-pointer interactive targets meet the 44px floor", async ({ page, isMobile }) => {
  test.skip(!isMobile, "Coarse pointer rule is mobile-specific");
  await page.goto("/");
  const box = await page.getByRole("button", { name: "Sign in" }).first().boundingBox();
  expect(box?.width ?? 0).toBeGreaterThanOrEqual(44);
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
});
