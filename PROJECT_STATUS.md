# AJ Power ERP — Project Status

> Last updated: September 2026
> This file is the source of truth for what is built, what is in progress, and what is next.
> Update this file when a major feature ships or a new goal is confirmed.

---

## Overall Maturity

| Layer | Status |
|-------|--------|
| Database schema & migrations | ✅ Complete (023 migrations) |
| Backend API — all built departments | ✅ Complete (20 route prefixes mounted) |
| Frontend shell & design system | ✅ Stable |
| Planning dept UI | ✅ Complete |
| Site dept UI | ✅ Complete |
| Store dept UI | ✅ Complete |
| Procure dept UI | ✅ Complete |
| Reports dept UI | ✅ Complete |
| **Billing dept UI** | ❌ Not built — backend DB + views done, no React pages |
| **Accounts dept** | ❌ Not started |
| **Authentication / Login** | ❌ Not built — X-User-Id header only |
| **Per-department separate routes** | ❌ Not built — next major goal |
| Permission / role enforcement | ❌ Not built — `users.department` is label-only |

---

## What Is Fully Working

### Planning Department (`/sites`, `/boq`, `/items`, `/stores`)
- Create and manage project sites with client, branch, site head, storekeeper, GM.
- Inline client creation with duplicate guard (`norm_key` / `sort_key`).
- Upload and parse client Work Orders from Excel/CSV.
- BOQ preparation: item-level component recipes per WO line, overrun policies.
- BOQ amendments that recalculate downstream quantities proportionally.
- Item master with 2,607 pre-seeded electrical items and duplicate prevention.
- Store/branch management.

### Site Department (`/indents`, `/site/*`)
- Indent cart: raises material requisitions against approved BOQ.
- Indent evaluation pre-check (none/warn/bad).
- Indent lifecycle: DRAFT → SUBMITTED → APPROVED / RETURNED.
- BOQ rollup on approval (deduplicates items across lines).
- Site store inbox: acknowledge delivery challans (full or partial).
- Site stock view: quantities only (no rates shown).
- Issue material to named field workers.
- Return unused material (person-based, not document-based).
- Transactions, Audit (by item or by person), Consumption views.
- Site expenses: claim → submit → approve/reject/return/cut.

### Store Department (`/store`, `/grns`, `/challans`, `/stock`, `/movements`)
- Store desk: overview of stock and pending actions.
- GRN desk: receive supplier shipments, stamp unit rate from PO.
- PRNs to fulfil: queue of approved indents needing dispatch.
- Delivery Challan creation and dispatch (decrements central stock, moves to IN TRANSIT).
- Stock and movement views.

### Procure Department (`/procurement`, `/comparisons`, `/purchase-orders`, `/suppliers`)
- Open indent consolidation with stock-on-hand check.
- Supplier quotation comparison with landed cost formula.
- Justification required when not selecting lowest landed cost.
- Purchase Order creation + GM approval workflow.
- Supplier master.

### Reports Department (`/reports/expense`, `/reports/pl`)
- Expense report: material consumed (per item, rate-stamped), labour, other expenses.
- Statement / Charts toggle (donuts, line graph, column chart).
- P&L: gross profit and margin from raised bills only.
- All filters live in URL (shareable).

---

## What Is Partially Done

### Billing (backend DB ✅, backend routes ❌, frontend ❌)
- **Database**: `bills`, `bill_lines` tables (migration 022).
- **Views** (migration 023):
  - `v_wo_line_indented` — least-provisioned item per WO line, carries `indented_qty` and `consumed_qty`. Joins through `boq_lines` + `v_boq_line_movement` + `v_site_consumption`.
  - `v_wo_line_billed` — cumulative raised-bill qty per WO line.
  - `v_billing_line` — full billing sheet: `contracted_qty`, `var_qty`, `boq_qty`, `indented_qty`, `consumed_qty`, `billed_qty`, `to_bill_qty`, `billed_pct`.
  - `v_bill_line` — individual lines with `previous_qty` for RA bill format.
  - `v_bill_status` — bill header with supply/inst/total values.
  - `v_site_revenue` — raised bills only, feeds P&L.
- **Backend routes**: `bills.routes.js` does **not exist** in `src/modules/`. Not mounted in `src/routes/index.js`.
- **Frontend**: No pages exist. `SOON` array in `App.jsx` lists Billing as greyed-out.
- **What needs building**:
  - `backend/src/modules/bills.routes.js` — endpoints: list, sheet, create draft, raise, cancel, register.
  - Register at `/bills` in `src/routes/index.js`.
  - `frontend/src/pages/Billing.jsx` — billing sheet + RA bill register.
  - Add Billing to `SECTIONS` in `App.jsx` (remove from `SOON`).
  - Add `/billing` and `/billing/bills` routes in `App.jsx`.

---

## Next Major Goal: Separate Department Dashboards with Login

### Current Architecture Problem
The entire app is one SPA with a department rail sidebar. There is no login, authentication, or role enforcement. All departments are visible to all users.

### Target Architecture
Each department becomes its own login-gated route:
- `/login` — shared login page, authenticates and redirects to user's department.
- `/planning/*` — Planning Engineer dashboard.
- `/site/*` — Site Engineer / Site Storekeeper dashboard.
- `/store/*` — Central Storekeeper dashboard.
- `/procure/*` — Procurement Officer dashboard.
- `/reports/*` — Management / Finance Director dashboard.
- `/billing/*` — Billing Engineer dashboard (when built).

### What This Requires
1. **Backend**: Add JWT-based auth (`/auth/login`, `/auth/refresh`). Add `password_hash` to `users` table. Add `requireAuth` middleware. Add `requireDepartment(dept)` middleware for route-level guards.
2. **Frontend**: Replace `X-User-Id` header with JWT token in `api.js`. Add login page. Add `PrivateRoute` wrapper. Separate `App.jsx` into per-department shells.
3. **Design**: Remove the department rail from individual department views. Each department gets its own shell with only its relevant nav.

### Migration Plan
- Phase 1: Add auth (JWT + login page) while keeping sidebar intact.
- Phase 2: Add route guards so each user only sees their department.
- Phase 3: Remove the universal rail, replace with per-department shell components.
- Phase 4: Improve and polish each department's UI independently.

---

## Known Technical Debt

| Item | Location | Notes |
|------|----------|-------|
| CORS wide open | `backend/src/app.js` | `cors()` with no origin restriction |
| No rate limiting | `app.js` | No `express-rate-limit` |
| No HTTPS enforcement | `index.js` | Local only |
| `multer` v1 lts fork | `package.json` | `1.4.5-lts.1` — patched in v2 |
| `xlsx` library | `package.json` | Prototype-pollution risk in old versions; only used for WO import |
| `bills.routes.js` missing | `backend/src/modules/` | DB + views done, routes not written |
| Billing UI missing | `frontend/src/pages/` | No `Billing.jsx` |
| No auth / permission checks | Entire backend | No JWT, no `requireAuth`, no role guards |
| README test count stale | `README.md` | Says 168 tests; actual count may differ |

---

## Backend Route Map (`src/routes/index.js`)

All 20 prefixes currently mounted:

| Prefix | Module |
|--------|--------|
| `/whoami` | inline handler |
| `/users` | inline `listUsers()` |
| `/masters` | `masters.routes` |
| `/items` | `items.routes` |
| `/sites` | `sites.routes` |
| `/work-orders` | `workorders.routes` |
| `/boq` | `boq.routes` |
| `/indents` | `indents.routes` |
| `/progress` | `progress.routes` |
| `/suppliers` | `suppliers.routes` |
| `/procurement` | `procurement.routes` |
| `/purchase-orders` | `purchaseorders.routes` |
| `/comparisons` | `comparisons.routes` |
| `/store` | `store.routes` |
| `/challans` | `challans.routes` |
| `/grns` | `grn.routes` |
| `/site-store` | `sitestore.routes` |
| `/consumption` | `consumption.routes` |
| `/tracking` | `tracking.routes` |
| `/expenses` | `expenses.routes` |
| `/costs` | `costs.routes` |

**`/bills` is NOT mounted** — add it when `bills.routes.js` is created.

---

## Database Migration State

| # | File | What it adds |
|---|------|-------------|
| 001 | schema.sql | Core tables: branches, users, clients, sites, work_orders, items, BOQ |
| 002 | views.sql | Initial derived views |
| 003 | consumption.sql | stock_movements, issues, returns |
| 004 | amend_at_wo_line.sql | Amendment tracking at WO line level |
| 005 | site_gm.sql | GM enforcement constraint on sites |
| 006 | indent_sheet.sql | Indent flow views |
| 007 | rollup_fix.sql | BOQ rollup deduplication fix |
| 008 | procurement.sql | purchase_orders, po_lines tables |
| 009 | procurement_views.sql | Procurement derived views |
| 010 | po_approval.sql | PO approval workflow |
| 011 | comparison_views.sql | Landed cost comparison views |
| 012 | store.sql | Central store tables |
| 013 | store_views.sql | Stock balance views |
| 014 | grn.sql | Goods Receipt Note tables |
| 015 | flow_rounding.sql | DECIMAL precision fixes |
| 016 | issue_return.sql | Issue/return tables |
| 017 | issue_return_views.sql | Consumption event views |
| 018 | return_by_person.sql | Removed consumption_id from returns |
| 019 | expenses.sql | site_expenses, expense_categories |
| 020 | expense_views.sql | v_site_expense, v_cost_event |
| 021 | expense_kind.sql | LABOUR/OTHER kind on categories |
| 022 | billing.sql | bills, bill_lines tables |
| 023 | billing_views.sql | v_billing_line, v_bill_line, v_site_revenue |

> **Note**: Migration 023 was patched — `consumed_qty` in `v_wo_line_indented` now pulls from
> `v_site_consumption` instead of the non-existent column on `v_boq_line_movement`.

---

## Test Coverage

- Backend tests in `backend/tests/` (uses Node built-in test runner, `--test-concurrency=1`).
- No frontend tests currently.
- Run with: `npm test` inside `backend/`.
