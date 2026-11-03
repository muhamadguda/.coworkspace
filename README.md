# dot

Co-working space and café app: customers order from their table by QR, check their bill, and book rooms; the counter runs rooms, tables, orders, checkout and the cash drawer, and keeps working offline.

- Customer page: https://dotcowork.space
- Counter: https://dotcowork.space/staff
- Product spec: [SPEC.md](SPEC.md)

## Stack

- **Next.js 16** (App Router, TypeScript), **React 19**, **Tailwind CSS 4**. Pages are static and run in the browser.
- **Supabase** (Postgres in Frankfurt). Row-level security plus security-definer SQL functions hold all business rules. There's no separate backend. Supabase Realtime pushes changes to the counter.
- **Vercel** hosting, functions in `fra1`.

## Layout

```
supabase/migrations/   schema, RLS, SQL functions (customer_*, staff_op, staff_snapshot, owner_*)
supabase/seed.sql      starter rooms, modes and menu
src/lib/billing.ts     room-fee, split, discount and business-day math (+ tests)
src/lib/dict.ts        every UI string, Egyptian Arabic and English
src/customer/          customer page: menu, my bill, booking
src/staff/store.ts     counter state: server snapshot + offline op queue + sync
src/staff/reducer.ts   applies queued ops locally so the UI works offline
src/staff/views/       board, orders, bills, bookings, customers, cash drawer
src/staff/owner/       menu, settings + QR codes, team, reports
public/sw.js           service worker (counter loads offline)
brand/                 logo masters and icons
```

### How the counter works offline

Every counter action is an op (`{id, type, at, payload}`). It is applied to the local copy right away and queued in IndexedDB. Ops are sent in order to `staff_op()`, which is idempotent by op id, so retries are safe. When the queue drains, the counter reloads the server snapshot. If the server rejects an op, the counter shows it, drops it and resyncs.

## First-time setup

1. Open https://dotcowork.space/setup, enter the **setup code** (shared privately; it is not in this repository), and create the owner account with your phone and a password.
2. Sign in at `/staff`.
3. **Settings**: venue address, WhatsApp number, receipt footer, billing rules, staff discount caps, rooms and tables, modes and prices.
4. **Settings → QR codes → Print all QR codes**, and stick them on each table and room.
5. **Menu**: edit the starter menu, prices and photos.
6. **Team**: add staff (phone + password).

### Counter PC (Windows)

Receipts print to an 80 mm thermal printer. So Chrome prints without the print dialog every time:

1. Set the receipt printer as the Windows **default printer**. Paper: 80 mm (72 mm printable), margins none.
2. Create a Chrome shortcut with:
   ```
   "C:\Program Files\Google\Chrome\Application\chrome.exe" --kiosk-printing --app=https://dotcowork.space/staff
   ```
3. Open it once while online and sign in. After that, the counter loads even without internet.
4. At the start of every shift, tap **Start shift**. Browsers only allow alarm sounds after a tap, and it also keeps the screen awake. Turn the PC volume up.

## Development

```bash
npm install
cp .env.example .env.local   # NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
npm run dev                  # http://localhost:3000
npm test                     # billing math (node --test)
npm run lint && npm run typecheck
```

Database changes go in a new file under `supabase/migrations/`. Apply it with the Supabase CLI (`supabase db push`) or the dashboard SQL editor.

## Security notes

- Browsers only hold the **publishable** key. Customers can only call the `customer_*` and `public_*` functions; everything else checks `is_staff()` / `is_owner()` in the database.
- In the Supabase dashboard, **Authentication → Sign In / Providers**, turn off **Allow new users to sign up**. Staff accounts are created by the owner from the Team screen. Signed-up strangers get nothing (they are not staff), but there is no reason to allow it.
