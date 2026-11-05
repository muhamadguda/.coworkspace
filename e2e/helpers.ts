import { execFileSync } from "node:child_process";
import { expect, type Page } from "@playwright/test";

export const OWNER = { phone: "01000000001", password: "e2e-pass-123" };
const DB = process.env.E2E_DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

/** Runs SQL on the local test database and returns the first column of the first row. */
export function sql(query: string): string {
  return execFileSync("psql", [DB, "-qtAX", "-v", "ON_ERROR_STOP=1", "-c", query], { encoding: "utf8" }).trim();
}

export async function english(page: Page) {
  await page.addInitScript(() => localStorage.setItem("dot.lang", "en"));
}

/** Signs in as the test owner and gets past the start-of-day / start-shift gate. */
export async function signIn(page: Page) {
  page.on("pageerror", (e) => console.log("pageerror:", e.message));
  page.on("console", (m) => m.type() === "error" && console.log("console error:", m.text().slice(0, 300)));
  await english(page);
  await page.goto("/staff");
  await page.fill("#login-phone", OWNER.phone);
  await page.fill("#login-password", OWNER.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  const float = page.locator("#opening-float");
  const shift = page.getByRole("button", { name: "Start shift" });
  await expect(float.or(shift)).toBeVisible({ timeout: 30_000 });
  if (await float.isVisible()) {
    await float.fill("500");
    await page.getByRole("button", { name: "Start day" }).click();
  } else {
    await shift.click();
  }
  await expect(page.getByRole("button", { name: "Board", exact: true })).toBeVisible();
}

/** Opens a free room and waits for the start-session sheet (retries the tap once if the board re-rendered). */
export async function openStart(page: Page, room: string) {
  const search = page.getByRole("dialog").locator("#customer-search");
  for (let i = 0; i < 3; i++) {
    await roomTile(page, room).click();
    if (await search.isVisible({ timeout: 5_000 }).catch(() => false)) return page.getByRole("dialog");
    await page.keyboard.press("Escape");
  }
  // Still not there: print what the screen shows so the CI log explains it.
  console.log("openStart failed. Dialogs:", await page.getByRole("dialog").count(), "\nScreen:\n", (await page.locator("body").innerText()).slice(0, 1500));
  await expect(search).toBeVisible();
  return page.getByRole("dialog");
}

export const roomTile = (page: Page, name: string) => page.getByRole("button").filter({ hasText: name }).filter({ hasText: /Free|In use|bills/ }).first();
