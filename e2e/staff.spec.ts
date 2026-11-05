import { test, expect } from "@playwright/test";
import { roomTile, signIn, sql } from "./helpers";

test.describe.configure({ mode: "serial" });

test("room session from start to paid bill", async ({ page }) => {
  await signIn(page);
  const phone = "01011112222";

  await roomTile(page, "Room 2").click();
  const start = page.getByRole("dialog");
  await start.locator("#customer-search").fill(phone);
  await start.getByRole("button", { name: "Add customer" }).click();
  await expect(start.getByText(phone)).toBeVisible();
  await start.getByRole("button", { name: "Start session" }).click();

  await expect.poll(() => sql(`select count(*) from room_sessions s join places p on p.id = s.place_id where p.name_en = 'Room 2' and s.status = 'active'`)).toBe("1");

  await roomTile(page, "Room 2").click();
  await page.getByRole("dialog").getByRole("button", { name: "End session" }).click();
  await page.getByRole("button", { name: /End and calculate/ }).click();
  await expect.poll(() => sql(`select count(*) from room_sessions s join places p on p.id = s.place_id where p.name_en = 'Room 2' and s.status = 'active'`)).toBe("0");

  // Minimum one hour at the PlayStation single rate (120).
  await expect.poll(() => sql(`select room_fee_share from bills b join customers c on c.id = b.customer_id where c.phone = '${phone}' and b.status = 'open'`)).toBe("120.00");

  await page.keyboard.press("Escape");
  await roomTile(page, "Room 2").click();
  await page.getByRole("dialog").getByRole("button", { name: "Checkout" }).first().click();
  const co = page.getByRole("dialog").last();
  await co.getByRole("button", { name: "Rest" }).first().click();
  await co.getByText("Print receipt").click(); // no print dialog in CI
  await co.getByRole("button", { name: /Close bill/ }).click();

  await expect.poll(() => sql(`select b.status || ':' || b.total from bills b join customers c on c.id = b.customer_id where c.phone = '${phone}' order by b.opened_at desc limit 1`)).toBe("closed:120.00");
  await expect.poll(() => sql(`select coalesce(sum(p.amount), 0) from payments p join bills b on b.id = p.bill_id join customers c on c.id = b.customer_id where c.phone = '${phone}' and p.method = 'cash'`)).toBe("120.00");
});

test("work continues offline and syncs when back online", async ({ page, context }) => {
  await signIn(page);
  const phone = "01033334444";
  await context.setOffline(true);
  await expect(page.getByText("Offline", { exact: false }).first()).toBeVisible({ timeout: 20_000 });

  await roomTile(page, "Room 3").click();
  const start = page.getByRole("dialog");
  await start.locator("#customer-search").fill(phone);
  await start.getByRole("button", { name: "Add customer" }).click();
  await start.getByRole("button", { name: "Start session" }).click();
  await expect(roomTile(page, "Room 3")).toContainText("In use");
  expect(sql(`select count(*) from customers where phone = '${phone}'`)).toBe("0");

  await context.setOffline(false);
  await expect.poll(() => sql(`select count(*) from room_sessions s join customers c on c.id = s.booker_customer_id where c.phone = '${phone}' and s.status = 'active'`), { timeout: 45_000 }).toBe("1");
});

test("a sale lowers stock, sells the item out at zero, and the owner sees it", async ({ page }) => {
  const id = sql(`update menu_items set track_stock = true, stock_qty = 1, low_stock_at = 1 where name_en = 'Espresso' returning id`);
  const owner = sql(`select user_id from staff_profiles where phone = '01000000001'`);
  const asOwner = `select set_config('request.jwt.claims', json_build_object('sub', '${owner}', 'role', 'authenticated')::text, false);`;
  sql(`${asOwner} select public.staff_op3('{"id":"${crypto.randomUUID()}","type":"ensure_customer","payload":{"id":"${crypto.randomUUID()}","phone":"01055556666"}}'::jsonb);`);
  const cust = sql(`select id from customers where phone = '01055556666'`);
  const bill = crypto.randomUUID();
  sql(`${asOwner} select public.staff_op3('{"id":"${crypto.randomUUID()}","type":"open_bill","payload":{"id":"${bill}","customer_id":"${cust}"}}'::jsonb);`);
  sql(`${asOwner} select public.staff_op3('{"id":"${crypto.randomUUID()}","type":"staff_order","payload":{"bill_id":"${bill}","order_id":"${crypto.randomUUID()}","items":[{"id":"${crypto.randomUUID()}","menu_item_id":"${id}","qty":1,"options":[]}]}}'::jsonb);`);
  expect(sql(`select stock_qty || ':' || available from menu_items where id = '${id}'`)).toBe("0.00:false");

  await signIn(page);
  await page.getByRole("button", { name: "Reports", exact: true }).click();
  await expect(page.getByText("Today so far")).toBeVisible();
  await expect(page.getByText("Running low", { exact: true }).locator("..").getByText("Espresso")).toBeVisible();
});
