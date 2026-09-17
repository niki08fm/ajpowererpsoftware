# AJ Power ERP — Project Status

> Last updated: September 2026

---

## Overall Maturity

| Layer | Status |
|-------|--------|
| Database schema (23 migrations) | ✅ Complete |
| Backend API — all departments | ✅ Complete (21 route prefixes) |
| Frontend shell & design system | ✅ Stable |
| Planning dept UI | ✅ Complete |
| Site dept UI | ✅ Complete |
| Store dept UI | ✅ Complete |
| Procure dept UI | ✅ Complete |
| Reports dept UI | ✅ Complete |
| Billing (backend DB ✅, routes ✅, frontend ✅) | Complete |
| Transfers (site-to-site sourcing) | ✅ Complete |
| Demo / seed data | ✅ Complete (8 WOs, full ERP lifecycle) |
| Authentication / Login | 🔧 In progress — `Login.jsx` exists, no JWT backend yet |
| Per-department separate routes | ❌ Planned — next major goal |
| Permission / role enforcement | ❌ Not built — `users.department` is label-only |
| Accounts department | ❌ Not started |

---

## What Is Fully Working

### Planning (`/sites`, `/boq`, `/items`, `/stores`)
- Sites + stores with client, branch, head, keeper, GM.
- Inline client creation with duplicate guard.
- Work Order upload from Excel/CSV.
- BOQ preparation: item recipes per WO line, overrun policies.
- BOQ amendments with proportional quantity recalculation.
- Item master — 2,607 pre-seeded electrical items.

### Site (`/indents`, `/site/*`)
- Indent lifecycle: DRAFT → SUBMITTED → APPROVED / RETURNED.
- BOQ rollup on approval.
- Site store inbox: acknowledge delivery challans (full or partial).
- Site stock view (quantities only, no rates).
- Issue material to named field workers.
- Return unused material (person-based).
- Transactions, Audit (by item or person), Consumption views.
- Expenses: claim → submit → approve / reject / return / cut.

### Store (`/store`, `/grns`, `/challans`)
- Store desk: stock overview + pending actions.
- GRN desk: receive supplier shipments, stamp unit rate from PO.
- PRN queue: approved indents needing dispatch.
- Delivery Challan creation and dispatch.
- Stock and movement views.

### Procure (`/procurement`, `/comparisons`, `/purchase-orders`, `/suppliers`)
- Open indent consolidation with stock-on-hand check.
- Supplier quotation comparison with landed cost.
- Justification required when not selecting lowest landed cost.
- PO creation + GM approval workflow.
- Supplier master.

### Billing (`/billing`, `/billing/bills`)
- Billing sheet per site: contracted / indented / billed / to-bill per WO line.
- RA bill creation (DRAFT → RAISED → CANCELLED).
- Bills list with totals and filters.
- Revenue feeds `v_site_revenue` → P&L.

### Reports (`/reports/expense`, `/reports/pl`)
- Expense report: material consumed (rate-stamped) + labour + other.
- Statement / Charts toggle.
- P&L: gross profit from raised bills only.
- All filters shareable via URL.

---

## Demo Seed Data

`npm run db:reset` loads all four seed files automatically:

| Seed file | Contents |
|-----------|----------|
| `001_reference.sql` | 2 branches, 5 users, 3 clients |
| `002_items.sql` | 2,607 electrical items |
| `003_demo_data.sql` | 3 WOs (GMR T2, Brigade, Salarpuria) — full lifecycle |
| `004_expanded_data.sql` | 4 more clients, 5 more sites, 5 more WOs — covers every dashboard state |

**After reset the database has:**
- 7 clients, 5 suppliers, 4 stores, 8 project sites
- 8 work orders, 8 BOQs, 10 indents
- 6 comparisons, 8 POs (DRAFT/SUBMITTED/APPROVED), 5 GRNs
- 7 challans (ACKNOWLEDGED + DISPATCHED for in-transit coverage)
- 8 consumptions, 3 returns, 18 expenses, 7 bills (4 RAISED + 3 DRAFT)

---

## Next Major Goal: Auth + Per-Department Dashboards

### Current Problem
One SPA, no login, all departments visible to all users. Auth is a "Working as" dropdown sending `X-User-Id` header.

### Target
Each department is a login-gated route with its own shell:

```
/login          ← shared login, redirects to user's department
/planning/*     ← Planning Engineer
/site/*         ← Site Engineer / Storekeeper
/store/*        ← Central Storekeeper
/procure/*      ← Procurement Officer
/billing/*      ← Billing Engineer
/reports/*      ← Management / Finance
```

### What Needs Building
1. **Backend**: JWT auth (`/auth/login`, `/auth/refresh`), `password_hash` on `users`, `requireAuth` + `requireDepartment` middleware.
2. **Frontend**: JWT in `api.js`, `Login.jsx` wired to real auth, `PrivateRoute` wrapper, per-department shells.
3. **Nav**: Remove universal rail, replace with per-department nav.

---

## Backend Route Map

All 21 prefixes mounted in `src/routes/index.js`:

| Prefix | Module |
|--------|--------|
| `/whoami` | inline |
| `/users` | inline |
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
| `/bills` | `bills.routes` |
| `/transfers` | `transfers.routes` |

---

## Database Migration State

| # | File | What it adds |
|---|------|-------------|
| 001 | schema.sql | Core tables: branches, users, clients, sites, work_orders, BOQ, items |
| 002 | views.sql | Initial derived views |
| 003 | consumption.sql | stock_movements, issues, returns |
| 004 | amend_at_wo_line.sql | BOQ amendment tracking at WO line level |
| 005 | site_gm.sql | GM enforcement CHECK constraint on sites |
| 006 | indent_sheet.sql | Indent flow views |
| 007 | rollup_fix.sql | BOQ rollup deduplication |
| 008 | procurement.sql | suppliers, stock_movements, comparisons, purchase_orders, GRN |
| 009 | procurement_views.sql | Procurement derived views |
| 010 | po_approval.sql | PO approval workflow + po_events |
| 011 | comparison_views.sql | Landed cost comparison views |
| 012 | store.sql | Central store tables, delivery_challans |
| 013 | store_views.sql | Stock balance views |
| 014 | grn.sql | Goods Receipt Note tables |
| 015 | flow_rounding.sql | DECIMAL precision fixes |
| 016 | issue_return.sql | consumptions + stock_returns reshape |
| 017 | issue_return_views.sql | Consumption event views |
| 018 | return_by_person.sql | Dropped consumption_id FK from stock_returns |
| 019 | expenses.sql | site_expenses, expense_categories |
| 020 | expense_views.sql | v_site_expense, v_cost_event |
| 021 | expense_kind.sql | LABOUR / OTHER kind on categories |
| 022 | billing.sql | bills, bill_lines tables |
| 023 | billing_views.sql | v_billing_line, v_bill_line, v_bill_status, v_site_revenue |
| 024 | transfers.sql | site-to-site transfer requests (store-initiated) |

---

## Known Technical Debt

| Item | Location | Notes |
|------|----------|-------|
| CORS wide open | `backend/src/app.js` | `cors()` with no origin restriction |
| No rate limiting | `app.js` | No `express-rate-limit` |
| No HTTPS | `index.js` | Local dev only |
| `multer` v1 lts fork | `package.json` | `1.4.5-lts.1` |
| `xlsx` library | `package.json` | Only used for WO import |
| No auth / JWT | Entire backend | `X-User-Id` header, no guards |
| `Login.jsx` stub | `frontend/src/pages/` | Page exists, no backend auth wired |

---

## Test Coverage

- Backend tests in `backend/tests/` — Node built-in test runner, `--test-concurrency=1`.
- No frontend tests.
- Run: `cd backend && npm test`
