import { test, expect } from "@playwright/test";
import { english, signIn, sql } from "./helpers";

test("landing page, sitemap, robots and share image", async ({ page, request }) => {
  await page.goto("/");
  await expect(page).toHaveTitle(/dot/);
  await expect(page.locator('a[href^="tel:"]').first()).toBeVisible();
  expect((await request.get("/robots.txt")).status()).toBe(200);
  expect(await (await request.get("/sitemap.xml")).text()).toContain("https://dotcowork.space/menu");
  const og = await request.get("/opengraph-image");
  expect(og.status()).toBe(200);
  expect(og.headers()["content-type"]).toContain("image/png");
});

test("QR order reaches the counter, gets accepted, and lands on the bill", async ({ browser }) => {
  const token = sql(`select qr_token from places where name_en = 'Table 1'`);
  const phone = "010" + String(Date.now()).slice(-8);

  const customer = await browser.newPage();
  await english(customer);
  await customer.goto(`/menu?t=${token}`);
  await expect(customer.getByText(/Ordering from Table 1/)).toBeVisible();
  await customer.getByRole("button", { name: "Add Water" }).click();
  await customer.getByRole("button", { name: "Add Lemon mint" }).click();
  await customer.getByRole("button", { name: /Review order/ }).click();
  await customer.locator("#order-phone").fill(phone);
  await customer.getByRole("button", { name: /Send order/ }).click();
  await expect(customer.getByText("Your order reached the counter")).toBeVisible();
  await expect.poll(() => sql(`select count(*) from orders o join customers c on c.id = o.customer_id where c.phone = '${phone}' and o.status = 'new'`)).toBe("1");

  const staff = await browser.newPage();
  await signIn(staff);
  await staff.getByRole("button", { name: /^Orders/ }).click();
  await staff.getByRole("button", { name: "Accept" }).first().click();
  await expect.poll(() => sql(`select o.status from orders o join customers c on c.id = o.customer_id where c.phone = '${phone}'`)).toBe("accepted");
  // 15 + 45
  await expect.poll(() => sql(`select sum(oi.qty * oi.unit_price) from order_items oi join orders o on o.id = oi.order_id join bills b on b.id = o.bill_id join customers c on c.id = b.customer_id where c.phone = '${phone}' and b.status = 'open'`)).toBe("60.00");

  // The customer's bill page shows it, using their code.
  const code = sql(`select code from customers where phone = '${phone}'`);
  // Their phone and code were saved when they ordered, so the bill loads by itself.
  expect(code).toMatch(/^\d{4,6}$/);
  await customer.goto("/menu?tab=bill");
  await expect(customer.getByText("60 EGP").first()).toBeVisible({ timeout: 20_000 });
});

test("call staff from the table rings the counter until someone handles it", async ({ browser }) => {
  const token = sql(`select qr_token from places where name_en = 'Table 2'`);
  const place = sql(`select id from places where name_en = 'Table 2'`);
  sql(`update staff_calls set handled_at = now() where place_id = '${place}' and handled_at is null`);
  const customer = await browser.newPage();
  await english(customer);
  await customer.goto(`/menu?t=${token}`);
  await customer.getByRole("button", { name: "Call staff" }).click();
  await customer.getByRole("button", { name: "Water, please" }).click();
  await expect(customer.getByText("Sent. Someone's coming.")).toBeVisible();
  await expect.poll(() => sql(`select count(*) from staff_calls where place_id = '${place}' and handled_at is null`)).toBe("1");

  const staff = await browser.newPage();
  await signIn(staff);
  const alert = staff.getByRole("alert").getByText(/Table 2 would like water/);
  await expect(alert).toBeVisible({ timeout: 20_000 });
  await staff.getByRole("alert").getByRole("button", { name: "Done" }).first().click();
  await expect.poll(() => sql(`select count(*) from staff_calls where place_id = '${place}' and handled_at is null`)).toBe("0");
});

test("events page: sign up, seats go down, offers opt-in is saved", async ({ page }) => {
  const phone = "010" + String(Date.now()).slice(-8);
  const id = sql(`insert into events (title_ar, title_en, starts_at, capacity, price) values ('ليلة تجربة', 'E2E night', now() + interval '2 days', 5, 0) returning id`);
  await english(page);
  await page.goto(`/events#${id}`);
  const card = page.locator(`#ev-${id}`);
  await expect(card.getByText("5 seats left")).toBeVisible({ timeout: 20_000 });
  await card.getByRole("button", { name: "Save my seat" }).click();
  await page.locator("#ev-name").fill("Mona");
  await page.locator("#ev-phone").fill(phone);
  await page.getByRole("button", { name: "+" }).click();
  await page.getByLabel("Send me offers and events on WhatsApp").check();
  await page.getByRole("button", { name: "Confirm" }).click();
  await expect(card.getByText("3 seats left")).toBeVisible();
  await expect(card.getByText("You're in: 2")).toBeVisible();
  expect(sql(`select offers_opt_in from customers where phone = '${phone}'`)).toBe("t");
  expect(sql(`select seats from event_signups s join customers c on c.id = s.customer_id where c.phone = '${phone}'`)).toBe("2");
  sql(`delete from event_signups where event_id = '${id}'; delete from events where id = '${id}'`);
});
