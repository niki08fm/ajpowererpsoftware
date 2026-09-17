# AJ Power ERP — Agent Instructions

You are working on **AJ Power ERP**, an Electrical Contracting / EPC project management system built for AJ Power Solutions.

---

## How to Use This Context System

Context is split into focused files. **Read only what the task needs.** Do not load everything at once.

```
CLAUDE.md                        ← You are here. Start here every session.
PROJECT_STATUS.md                ← Current build state, what's done, what's pending
DEV_ENVIRONMENT.md               ← Stack, commands, local setup
FRONTEND_ARCHITECTURE.md         ← React/Vite structure, shell, design system
BACKEND_ARCHITECTURE.md          ← Node/Express/MySQL structure, patterns
docs/
  DOMAIN_PLANNING.md             ← Planning dept: Sites, BOQ, Work Orders, Items
  DOMAIN_SITE.md                 ← Site dept: Indents, Store, Issue, Returns, Expenses
  DOMAIN_STORE.md                ← Store dept: GRN, Challans, Stock
  DOMAIN_PROCUREMENT.md          ← Procure dept: Demand, Comparisons, Purchase Orders
  DOMAIN_BILLING_REPORTS.md      ← Billing dept + Reports dept: RA Bills, P&L, Costs
APPLICATION_WORKFLOW_AND_USER_JOURNEY.md  ← Full domain narrative (load only when deep domain
                                             knowledge is required for a feature)
docs/API.md                      ← Full endpoint reference (load only when writing API-touching code)
```

### Decision tree — what to load

| Task | Files to read |
|------|---------------|
| Bugfix in a specific page | `DEV_ENVIRONMENT.md` + the relevant `DOMAIN_*.md` |
| New feature in Planning | `FRONTEND_ARCHITECTURE.md` + `DOMAIN_PLANNING.md` |
| New feature in Site | `FRONTEND_ARCHITECTURE.md` + `DOMAIN_SITE.md` |
| Backend API change | `BACKEND_ARCHITECTURE.md` + relevant `DOMAIN_*.md` |
| Auth / login work | `PROJECT_STATUS.md` + `FRONTEND_ARCHITECTURE.md` + `BACKEND_ARCHITECTURE.md` |
| Billing frontend | `DOMAIN_BILLING_REPORTS.md` + `FRONTEND_ARCHITECTURE.md` + `PROJECT_STATUS.md` |
| Full P&L or cost reports | `DOMAIN_BILLING_REPORTS.md` + `docs/API.md` |
| Deep domain question | `APPLICATION_WORKFLOW_AND_USER_JOURNEY.md` |
| First session on this project | Read `PROJECT_STATUS.md` first, then this file |

---

## Project in One Paragraph

AJ Power ERP tracks the full lifecycle of electrical contracting projects: from client **Work Orders** → technical **BOQ** preparation → site **Material Indents** → **Procurement & POs** → **GRN at central store** → **Delivery Challans to site** → **Site store acknowledgement** → **Field issues & returns** → **Site expenses** → **RA Billing** → **Profit & Loss**. The current UI is a **single-page app with a department sidebar** (Planning, Site, Store, Procure, Reports). The next major goal is to **remove the sidebar and separate each department into its own login-gated route**.

---

## Critical Invariants — Never Violate These

1. **No stored running balances.** Stock, pending orders, consumed qty — all derived from ledger views (`v_stock_balance`, `v_indent_item_flow`, etc.). Never add a `qty_on_hand` column or similar.
2. **Rate stamping at point of movement.** When material moves, stamp the central store rate *on that document's date*, not today.
3. **Site screens show quantities only — no money.** Exception: `/site/expenses` (petty cash *is* a rupee figure).
4. **Billing ceiling = what has been indented**, not the contracted quantity. `may_bill = indented − already_billed`.
5. **Quantities: `DECIMAL(18,3)`. Money: `DECIMAL(18,2)`. Zero floats.**
6. **Audit log is append-only.** Never update or delete from `audit_log`.
7. **`approved_amount` on expenses is NULL until decided, never 0.** NULL ≠ zero = refused.

---

## What Is NOT Built Yet

- **Auth / Login system** — currently a "Working as" dropdown sends `X-User-Id` header. No JWT, no sessions.
- **Billing frontend** — DB schema + views are done (migrations 022/023), no React pages yet. `SOON` array in `App.jsx` lists it as greyed-out.
- **Accounts department** — not started.
- **Per-department separate login routes** — the main upcoming goal. See `PROJECT_STATUS.md`.
- **Permission/role checks** — backend has no middleware guards. `users.department` is a label only.

---

## Code Style & Conventions

### Frontend
- **React 18 + Vite**. No extra UI libraries. All components are custom.
- State: `useState` / `useEffect`. Shared state via `AppCtx` context (branches, branchId, storeId, users, me, desk).
- API calls: always use `api.get/post/put/patch/del` from `src/api.js`. Never use `fetch` directly.
- Filters live in the **URL** via `useSearchParams` so filtered views are shareable.
- CSS: vanilla CSS custom properties in `styles.css`. Class names follow `.card`, `.btn`, `.tag`, `.banner`, `.field`, `.inp`, `.tw` (table wrapper) patterns.
- No TypeScript yet.

### Backend
- **Node.js (CommonJS) + Express**. Route files in `src/modules/`. All exported as `router`.
- DB helpers: `many()`, `one()`, `run()`, `tx()` from `src/config/db.js`. Never write raw `pool.query`.
- Validation: Zod schemas via `validate(schema, 'body'|'query')` middleware wrapper.
- Errors: use helpers from `src/lib/errors.js` (`conflict`, `notFound`, `badRequest`, etc.).
- Every write goes through `tx()` and logs to `audit_log` via `src/lib/audit.js`.
- Doc numbers generated by `src/lib/docNo.js`.

---

## Repository Layout (Quick Reference)

```
ajpowererpsoftware/
├── CLAUDE.md                    ← This file
├── PROJECT_STATUS.md
├── DEV_ENVIRONMENT.md
├── FRONTEND_ARCHITECTURE.md
├── BACKEND_ARCHITECTURE.md
├── start.ps1                    ← One command to start all 3 servers
├── README.md
├── docs/
│   ├── API.md                   ← Full endpoint reference
│   ├── DOMAIN_PLANNING.md
│   ├── DOMAIN_SITE.md
│   ├── DOMAIN_STORE.md
│   ├── DOMAIN_PROCUREMENT.md
│   └── DOMAIN_BILLING_REPORTS.md
├── backend/
│   ├── package.json             ← deps: cors, dotenv, express, multer, mysql2, xlsx, zod
│   ├── tests/                   ← Node built-in test runner test files
│   └── src/
│       ├── app.js               ← Express app, CORS, routes mount
│       ├── index.js             ← HTTP server bootstrap (:4000)
│       ├── config/db.js         ← MySQL pool + helpers (many, one, run, tx)
│       ├── config/env.js        ← Env vars with sane defaults
│       ├── db/migrations/       ← 23 SQL migration files (001–023)
│       ├── db/seeds/            ← 001_reference.sql + 002_items.sql (2,607 items)
│       ├── lib/                 ← audit, docNo, errors, normKey, rates, woImport
│       ├── middleware/          ← currentUser, error handler, validate
│       ├── modules/             ← 19 route controller files (no bills.routes.js yet)
│       └── routes/
│           └── index.js         ← Mounts all 20 route prefixes
└── frontend/
    ├── package.json             ← deps: react, react-dom, react-router-dom
    └── src/
        ├── main.jsx             ← ReactDOM.createRoot entry point
        ├── App.jsx              ← Shell, SECTIONS (5 depts), SOON, AppCtx, all routes
        ├── api.js               ← Fetch wrapper + formatters (money, qty, dmy, today)
        ├── styles.css           ← Full design system (CSS custom properties)
        ├── download.js          ← CSV download utility (used in ExpenseReport)
        ├── components/
        │   ├── ui.jsx           ← Card, Field, Tag, Banner, Modal, useApi, toasts, etc.
        │   └── charts.jsx       ← Hand-rolled SVG: TrendChart, RankBars, DonutChart, LineChart
        └── pages/               ← 22 page files (no Billing.jsx yet)
```
