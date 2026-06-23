# Cafteri — Multi-Canteen Management Platform

A complete refactor of the original single-canteen Online Canteen Management
System into a platform that can run any number of independent canteens from
one codebase and one database.

## What changed, in one paragraph

Every canteen now owns its own menu, orders, tokens, chefs, and revenue —
nothing crosses canteen boundaries. A new **Manager** role (replacing the old
global "Admin") can create canteens, switch between them from one dashboard
without logging out, and fully manage each canteen's chefs and menu. A
**Chef** account is now assigned to exactly one canteen by a manager and can
never see or touch another canteen's data, even by tampering with requests.
**Customers** (the old "Student" role, now used by anyone — students,
faculty, staff, visitors) pick a canteen before browsing, and their cart and
menu view are scoped to that canteen, while their order history spans every
canteen they've ever ordered from.

## Running it locally

You'll need Node.js 18+ and a running MongoDB instance.

```bash
cd cafteri
cp .env.example .env       # edit MONGO_URI etc. if needed
npm install
npm run seed                # creates 2 sample canteens, a manager, 2 chefs, starter menus
npm start                    # or: npm run dev (with nodemon)
```

Then open `http://localhost:5000` in a browser. The server serves both the
API and the static frontend from one origin, so nothing else needs to run.

### Default accounts (created by `npm run seed`)

| Role | Username | Password | Notes |
|---|---|---|---|
| Manager | `manager` | `password123` | Global — can manage every canteen |
| Chef | `chef1` | `password123` | Assigned to "Main Campus Canteen" |
| Chef | `chef2` | `password123` | Assigned to "Hostel Block Canteen" |

Customers register their own accounts from the **Order Food** portal.

**Change these passwords (or delete and re-seed with your own) before
deploying anywhere reachable by other people.**

## Architecture

```
server.js                  Express + Socket.IO entry point, static file serving
models/index.js            Canteen, Manager, Chef, Student, Menu, Order schemas
middleware/auth.js          requireManager / requireChef / requireStudent / loadCanteen
routes/
  auth.js                   /api/manager/login, /api/chef/login, /api/student/login + register
  canteens.js               /api/canteens — public, read-only, active canteens only
  manager.js                /api/manager/* — canteen CRUD + chef CRUD (manager-only)
  menu.js                   /api/menu — canteen-scoped reads/writes
  orders.js                 /api/orders — canteen-scoped order placement + status
  reports.js                /api/reports — canteen-scoped summary + item breakdown
seed.js                     Sample data: 2 canteens, 1 manager, 2 chefs, starter menus
public/
  index.html                Landing page — Order Food / Chef Portal / Manager Portal
  css/canteen.css           Shared design system (unchanged from the original app,
                             extended with a few new component classes)
  js/config.js               API base URL detection (unchanged)
  js/shared.js               Session helpers, apiFetch with auth headers, Socket.IO connector
  manager/                   Manager login + single-page dashboard (canteen switcher,
                              overview/menu/orders/chefs/reports tabs)
  chef/                      Chef login + kitchen ticket dashboard (own canteen only)
  student/                   Customer canteen-selection, login, register, menu, cart, orders
```

## Authentication model (by design, not an oversight)

Per explicit instruction, this project does **not** use JWTs. Each role's
login returns an identifying string (manager username, chef username, or
customer email), which the frontend stores in `localStorage` via the
`Session` helper in `shared.js` and re-sends as a header
(`x-manager-username`, `x-chef-username`, or `x-student-email`) on every
request. The server re-validates that header against the database on
**every** request (see `middleware/auth.js`) — there is no signed token, so
this is only as secure as the original app's localStorage-based session, but
unlike the original app, every protected route now actually checks the
header against a real account server-side rather than trusting any string.

If you later want stronger security (signed/expiring sessions, password
hashing for chefs, rate limiting on login), the `middleware/auth.js` file is
the only place that needs to change — every route already depends on it
rather than rolling its own auth logic.

## Multi-canteen isolation — how it's enforced

- **Database**: `Menu`, `Order`, and `Chef` all carry a `canteen` reference.
  Menu-name uniqueness and order-token uniqueness are indexed *per canteen*,
  not globally — two canteens can each have a "Veg Thali" or an active
  token #412 at the same time without conflict.
- **API**: every menu/order/report route requires a `canteenId` and, for
  chef requests, the chef's own assigned canteen is substituted automatically
  — a chef cannot pass a different `canteenId` to read or write another
  canteen's data. Edit/delete routes additionally re-check that the
  *existing* item/order actually belongs to the chef's canteen before
  allowing the change, closing the gap where someone could otherwise guess
  another canteen's document ID.
- **Realtime**: Socket.IO rooms are keyed `kitchen:<canteenId>` instead of a
  single shared room, so live order/menu updates for one canteen never reach
  another canteen's chef or manager view.
- **Frontend**: the customer's cart is keyed `cart_<email>_<canteenId>`, so
  switching canteens never mixes items from two kitchens into one order.

## Known limitations / honest caveats

- This sandbox has no network access, so I could not run `npm install` or
  boot the server to test live HTTP requests end-to-end. Every file passed
  `node --check` (syntax), every internal link/redirect was programmatically
  resolved against the actual file tree (no broken links), and every
  frontend `apiFetch` call was cross-referenced by hand against the actual
  backend route table (method + path) to confirm they match. I'd still
  recommend you run through the core flows once locally (register, place an
  order, mark it ready as a chef, add a canteen as a manager) before relying
  on this in production.
- Chef and customer passwords are stored in plaintext in the database,
  matching the original app's behavior for those two roles (only the
  Manager/former-Admin role used bcrypt in the original code, and that's
  preserved here). If you want this hardened, bcrypt-hash `Chef.password`
  and `Student.password` the same way `Manager.passwordHash` already is —
  happy to do this as a follow-up if you'd like it.
- The category list (`Tiffins, Meals, Drinks, Snacks, Desserts`) is still a
  hardcoded constant in three places (`models/index.js`, the manager
  dashboard JS, and the customer dashboard JS) rather than a single shared
  source — this matches the original app's own pattern (it was already
  hardcoded client-side before this refactor) but would be a good candidate
  to centralize via the existing `/api/menu/categories` endpoint if you want
  categories to ever be customizable per canteen in the future.
