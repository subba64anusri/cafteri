# Canteen OS

A real-time canteen ordering system for three roles — **Student**, **Chef**, and
**Admin** — built on Express, MongoDB, and Socket.IO.

## What changed from the original

This is a full rebuild, not a patch. The original had no working order backend
at all: every "order" only ever existed in the browser's `localStorage`, so the
chef, the admin, and the student were each looking at completely different,
disconnected data. The fixes below are structural, not cosmetic.

**Backend**
- Added the order pipeline that didn't exist: `POST /api/orders`,
  `GET /api/orders`, `GET /api/orders/active`, `PUT /api/orders/:id/status`.
  Orders are now real MongoDB documents, validated server-side against the
  live menu (price and stock can't be spoofed from the browser).
- Placing an order now decrements stock atomically; the admin's menu page and
  every student's screen update live when stock changes.
- Removed the duplicate `cors` import and duplicate `GET /api/menu` route.
- Reports (`/api/reports/summary`, `/api/reports/items`) are computed from
  real `Order` documents instead of a schema nothing actually wrote to.
- Added Socket.IO. The server emits `order:new`, `order:status`, and
  `menu:update` so every screen reflects reality within milliseconds —
  no polling, no manual refresh.
- Moved configuration (port, Mongo URI, CORS origins, default accounts) into
  a `.env` file instead of hardcoded values and a hardcoded IP address.

**Frontend**
- Removed every hardcoded `http://10.177.113.16:5000` reference. Each page now
  detects the API host from `window.location` (see `public/js/config.js`), so
  the same files work on any machine without edits.
- Fixed the cart bug in the student app: the dashboard wrote to
  `cart_<email>` but the cart page's remove/checkout logic read from a
  different, fixed key (`studentCart`) — meaning removed items could reappear
  and checkout could silently use stale data. Everything now reads and
  writes through one `getCartKey()` function.
- Replaced `prompt()`-based add/edit flows in the admin menu page with a real
  form (validates price/quantity, shows inline errors, no more "click OK three
  times").
- Fixed the ₹ / $ currency inconsistency (admin menu table showed `$`, every
  other screen showed `₹`).
- One shared CSS design system (`public/css/canteen.css`) replaces three
  near-duplicate inline stylesheets, with a consistent "ticket" motif (order
  tokens, kitchen-ticket cards) and a distinct accent color per role.
- Added empty states, loading skeletons, and toast notifications in place of
  blank tables and `alert()` popups.

**Kept simple, by request**
- Passwords are stored in plain text and there are no JWT/session tokens.
  This matches what you asked for, but means **this is not safe to expose
  directly to the public internet as-is** — see Security notes below.

## Project structure

```
canteen/
├── server.js              Express + Socket.IO entrypoint
├── seed.js                 One-time script to populate starter menu items
├── models/index.js         Mongoose schemas (Admin, Chef, Student, Menu, Order)
├── routes/
│   ├── auth.js              /api/admin/login, /api/chef/login, /api/student/*
│   ├── menu.js               /api/menu (CRUD)
│   ├── orders.js             /api/orders (place, list, update status)
│   └── reports.js            /api/reports/summary, /api/reports/items
├── public/
│   ├── css/canteen.css       Shared design system
│   └── js/
│       ├── config.js          Auto-detects the API base URL
│       └── shared.js          apiFetch(), toasts, Socket.IO connector
├── index.html               Role picker
├── student/                 login, register, dashboard (menu), cart, orders
├── admin/                   login, dashboard, menu management, reports
└── chef/                    login, dashboard (kitchen ticket board)
```

## Running it on your server

### 1. Prerequisites
- Node.js 18+
- MongoDB running locally (`mongod`), since you're managing your own database
  server rather than using a cloud database.

### 2. Install dependencies
```bash
cd canteen
npm install
```

### 3. Configure environment
```bash
cp .env.example .env
```
Open `.env` and adjust if needed — the defaults assume MongoDB on
`127.0.0.1:27017` and the API on port `5000`. If students/chefs/admins will
access the system from other devices on your network, set `CORS_ORIGINS` to
the exact origin(s) you'll serve the frontend from (or leave as `*` while
testing).

### 4. Seed starter menu data (optional, recommended for first run)
```bash
npm run seed
```

### 5. Start the server
```bash
npm start
```
You should see:
```
✅ Connected to MongoDB at mongodb://127.0.0.1:27017/canteenDB
👤 Default admin created -> admin / password123
👨‍🍳 Default chef created -> chef1 / password123
🚀 Canteen server running on port 5000
```

### 6. Serve the frontend
The HTML/CSS/JS files are static — serve them with any static file server.
For a quick local setup, from the project root:
```bash
npx http-server . -p 8080
```
Then open `http://<your-server-ip>:8080/index.html`.

In production, put a real static file server (e.g. nginx) in front of these
files, and make sure it's reachable from the same network as port `5000`
(the API). The frontend automatically calls the API on the same hostname it's
loaded from, on port 5000 — so as long as both are reachable at that hostname,
no code changes are needed.

### 7. First login
- **Admin:** `admin` / `password123` (change immediately — see below)
- **Chef:** `chef1` / `password123`
- **Student:** register a new account from the student login screen

## Changing default credentials

Edit `.env` before first boot:
```
DEFAULT_ADMIN_USERNAME=youradminname
DEFAULT_ADMIN_PASSWORD=a-real-password
DEFAULT_CHEF_USERNAME=yourchefname
DEFAULT_CHEF_PASSWORD=a-real-password
```
These only take effect if the account doesn't already exist. If you've
already booted the server once, change the password directly in MongoDB:
```bash
mongosh canteenDB --eval 'db.admins.updateOne({username:"admin"},{$set:{password:"new-password"}})'
```

## Security notes (please read before going live)

Per your request, this build keeps auth simple — no password hashing, no
session tokens. That's a reasonable choice for a trusted internal network
(e.g. a campus LAN that only canteen staff and students can reach), but it
means:
- Anyone with network access to port 5000 can read the database contents
  with the right tooling.
- Passwords are stored and transmitted in plain text.

If this will ever be reachable from the open internet, the two highest-value
upgrades are bcrypt password hashing and short-lived session tokens (JWT) —
happy to add both later if you change your mind, it's a contained change
limited to `routes/auth.js` and a small client-side update to store/send a
token.

## How real-time works

The server keeps two kinds of Socket.IO rooms:
- `student:<email>` — joined by a student's browser tab, used to push order
  status changes (`order:status`) to exactly that person.
- `kitchen` — joined by chef and admin tabs, used for `order:new` so the
  kitchen board updates the instant an order is placed, with no refresh.

`menu:update` is broadcast to everyone, so a stock or price change from the
admin panel — or stock decreasing because someone else just ordered the last
plate of biryani — shows up on every open student screen immediately.
