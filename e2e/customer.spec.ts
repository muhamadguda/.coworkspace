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
  const phone = "01077778888";

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
  expect(sql(`select count(*) from orders o join customers c on c.id = o.customer_id where c.phone = '${phone}' and o.status = 'new'`)).toBe("1");

  const staff = await browser.newPage();
  await signIn(staff);
  await staff.getByRole("button", { name: /^Orders/ }).click();
  await staff.getByRole("button", { name: "Accept" }).first().click();
  await expect.poll(() => sql(`select o.status from orders o join customers c on c.id = o.customer_id where c.phone = '${phone}'`)).toBe("accepted");
  // 15 + 45
  await expect.poll(() => sql(`select sum(oi.qty * oi.unit_price) from order_items oi join orders o on o.id = oi.order_id join bills b on b.id = o.bill_id join customers c on c.id = b.customer_id where c.phone = '${phone}' and b.status = 'open'`)).toBe("60.00");

  // The customer's bill page shows it, using their code.
  const code = sql(`select code from customers where phone = '${phone}'`);
  await customer.goto("/menu?tab=bill");
  if (await customer.locator("#bill-phone").isVisible().catch(() => false)) {
    await customer.locator("#bill-phone").fill(phone);
    await customer.locator("#bill-code").fill(code);
    await customer.getByRole("button", { name: /Show/ }).click();
  }
  await expect(customer.getByText("60 EGP").first()).toBeVisible();
});
