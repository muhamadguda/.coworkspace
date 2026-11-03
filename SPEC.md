# dot: co-working space & café — product spec

Live at **https://dotcowork.space** (customer page) and **https://dotcowork.space/staff** (counter).

Two surfaces:

| Page | Who | What |
|---|---|---|
| `/` | Customers (no login) | Menu and ordering, my bill, room booking, live room availability |
| `/staff` | Staff and owner (phone + password) | Rooms and tables board, orders, bills and checkout, bookings, customers and debts, cash drawer. Owner also gets menu, settings, QR codes, team and reports |

Arabic (Egyptian dialect) is the default, with a visible English switch. Numbers are always Western digits. Currency is EGP.

## Places

- **Rooms** are rented by the hour. A room is multi-purpose; the **mode** sets the hourly price:
  PlayStation single 120 EGP/h, PlayStation multiplayer 150 EGP/h, meeting or lecture 120 EGP/h.
  Each room can have its own price per mode (Settings → Prices per room); empty means the mode's default. Modes and prices are editable by the owner.
- **Tables** are free to use. Customers only pay for what they order.
- Board colors: **green = free**, **red = in use**, and the board shows the current mode.
  Bookings are listed separately and never change a room's color.

## Customers

- A customer is identified by **phone number**, with an optional name.
- On first visit they get a **customer code** (4 digits, longer once those run out). It is shown on screen and printed on receipts.
- To order: phone **or** code. To see a bill: phone **and** code. No SMS verification.
- Failed bill lookups are throttled: 8 failures per phone per 15 minutes.

## Ordering

- Every table and room has a **QR code** (`/?t=<token>`). Scanning it tells the counter where the order came from.
- Without a QR the order is a counter or takeaway pickup.
- A customer order arrives as **New** on the staff page with a **loud, repeating alarm**, and stays that way until staff accept or reject it. Staff review every order; if one looks wrong they go and ask the customer. The order card also shows when that customer has an open bill somewhere else.
- Accepted orders go onto the customer's open bill. The first accepted order opens it (a table visit).
- Order states: New → Accepted (being prepared) → Served. Orders can also be Rejected (while new) or Cancelled after acceptance; cancelling needs a reason and is logged.
- Staff can add items directly to any open bill, and change the quantity of or remove a single item (with a reason, logged).
- Item options such as sugar or milk never change the price.
- **Staff** can mark items sold out (Orders tab); sold-out items disappear from customer carts automatically.

## Room sessions

- Staff open a session for a **main booker**, choose a mode, and optionally a group size. Group size never changes the price.
- **Open-ended**: billed until staff end it.
- **Fixed** (1h, 2h…): when time is up, a repeating alarm sounds until staff acknowledge it, extend it (+30 min or +1 h), or end the session.
  - Billing stops at the planned end. Overstay within the **grace period** (10 min, configurable) is free.
  - Overstay beyond the grace period is charged by default at the end; staff can waive it.
- **Mode changes** mid-session start a new segment. Each segment is billed at its own rate, per minute.
- **Minimum** 60 min for the whole session, configurable. After that, time is rounded **up** to the billing step (15 min, configurable). Minutes added by the minimum or rounding are billed at the last mode's rate.
- Each person in the room orders for themselves on **their own bill** (they must give a phone or code). The booker adds people from the room panel.
- A guest who **leaves early** pays their own items right away; the room keeps running. If the booker leaves early, they first **hand over the booking** to someone still in the room, who then settles the room fee.
- At the end, the room fee goes on the booker's bill, or is **split equally** across the bills staff select. The booker settles the room fee.
- A bill follows its customer when moved: table → room joins that room's session; table → free room makes them the booker of a new session.

## Bookings

- Customers request a booking (room, mode, date and time, duration, group size). It is **pending** until staff or the owner call the customer and confirm.
- Confirmed bookings show on the customer's page and block that slot for others. Staff can also create bookings directly.
- If a room is in use when a booking is due, staff get a warning 15 minutes before (configurable). There is no buffer between bookings.
- Statuses: pending, confirmed, rejected, cancelled, no-show, started.

## Checkout

- Payment methods: **cash, InstaPay, Vodafone Cash**. Only the method is recorded; there is no payment integration. A bill can be split across methods.
- **Pay later**: any remainder can be left as debt, within the customer's **debt limit**. New customers have a limit of 0; the owner sets limits per customer. Going over the limit needs the owner's phone and password on the spot, which needs internet.
- **Discounts**: fixed EGP amount or percent, on the whole bill, always with a reason. Staff are capped (20% and 50 EGP by default); above the cap needs owner approval.
- No service charge or VAT.
- 80 mm thermal receipts with logo, address, WhatsApp, customer code, items, room time breakdown, payments and footer. Pre-bills can be printed any time.

- **Reopen a bill** (owner): a closed bill can be reopened to fix it (wrong method, forgotten item, refund). Its payments are removed and logged; the bill is checked out again.

## Notifications

- Customers can tap **Notify me** to get a push notification when their order is confirmed / ready / on its way, when their booking is confirmed or declined, or when a busy room becomes free.
- Staff and owner devices can turn on **Alerts on this device** (tap your name): new orders and booking requests; owners also get app errors.
- iPhone: push works only after **Share → Add to Home Screen** and opening dot from there (iOS 16.4+).

## Cash drawer

- Once a day: the first person in the morning enters the **opening float** (cash counted in the drawer). It is pre-filled with yesterday's closing count.
- **Cash out** entries record money taken from the drawer, with a reason (milk, change…).
- **Close day**: count the cash. Expected = float + cash payments − cash outs. The difference is shown and saved, and a day report prints.
- The **business day** rolls over at 05:00 Cairo time (configurable), so a 2 a.m. sale counts toward the previous day.

## Staff and owner

- Staff sign in with **phone + password**. The owner creates staff, resets passwords and disables accounts. There's no SMS.
- Staff cannot change prices or settings, cannot exceed discount or debt limits without the owner, and cannot delete payments.
- Every discount, pay-later, cancellation, cash out, debt payment and day close is written to an audit log.

## Offline

- One counter device (a Windows PC). If the internet drops, the counter keeps working: open and close sessions, add orders, check out, cash entries. Every change is queued on the device and synced in order when the connection returns.
- The page itself loads offline after the first visit (service worker).
- Customer QR ordering needs the venue's server to be reachable, so customer orders pause during an outage and then arrive.
- Owner-only screens (menu, settings, team, reports) and owner overrides need internet.

## Reports (owner)

Everything below exports to **CSV** (opens in Excel, Arabic included). A **System health** panel lists app errors from the last 30 days.

Revenue and collections by method, room fees vs food and drinks, discounts, new pay-later and debt collected, removed items, revenue by day, room usage per room and mode, top items, outstanding balances, cash drawer closes with differences, cash outs, and cancelled orders. Ranges: today, yesterday, last 7 days, this month, or custom.
