# AJ Power ERP — Agent Instructions

**AJ Power ERP** is an Electrical Contracting project management system for AJ Power Solutions. It tracks the full lifecycle: client Work Orders → BOQ → Indents → Procurement → GRN → Delivery Challans → Site Issues → Expenses → RA Billing → P&L.

---

## Context Navigation

Load only what the task needs.

| File | Load when |
|------|-----------|
| `PROJECT_STATUS.md` | Checking what's built, what's pending, or planning new work |
| `DEV_ENVIRONMENT.md` | Running locally, db commands, env vars |
| `FRONTEND_ARCHITECTURE.md` | Any frontend work |
| `BACKEND_ARCHITECTURE.md` | Any backend work |
| `docs/DOMAIN_PLANNING.md` | Sites, BOQ, Work Orders, Items |
| `docs/DOMAIN_SITE.md` | Indents, Site Store, Issue/Return, Expenses |
| `docs/DOMAIN_STORE.md` | GRN, Challans, Stock |
| `docs/DOMAIN_PROCUREMENT.md` | Demand, Comparisons, Purchase Orders |
| `docs/DOMAIN_BILLING_REPORTS.md` | RA Billing, Expense report, P&L |
| `APPLICATION_WORKFLOW_AND_USER_JOURNEY.md` | Deep domain question or business rule dispute |
| `docs/API.md` | Full endpoint reference |

---

## What Is Built (full feature list in `PROJECT_STATUS.md`)

All 6 departments have both backend routes and React frontend pages:

| Dept | Pages | Backend |
|------|-------|---------|
| Planning | Sites, BOQ, Items, Stores | ✅ |
| Site | Indents, Site Store, Issue, Returns, Expenses, Tracking | ✅ |
| Store | Store Desk, PRNs, GRN, Challans, Stock, Movements | ✅ |
| Procure | To Buy, Comparisons, Purchase Orders, Suppliers | ✅ |
| Reports | Expense Report, Profit & Loss | ✅ |
| Billing | Billing sheet, Bills list | ✅ |

**22 backend route modules** mounted in `src/routes/index.js` (including `/bills` and `/transfers`).  
**26 frontend page files** in `frontend/src/pages/` (including `Billing.jsx`, `Login.jsx`, `Clients.jsx`, `Transfers.jsx`).

---

## Non-Negotiable Invariants

1. **No stored running balances.** All qty/value derived from ledger views. Never add a `qty_on_hand` column.
2. **Rate stamping at point of movement.** Stamp the central store rate for the document's date, not today.
3. **Site screens show quantities only — no money.** Exception: `/site/expenses`.
4. **Billing ceiling = indented qty**, not contracted qty.
5. **Quantities `DECIMAL(18,3)`, money `DECIMAL(18,2)`. No floats.**
6. **Audit log is append-only.** Never UPDATE or DELETE from `audit_log`.
7. **All DB writes go through `tx()` and log to `audit_log`.**
8. **`approved_amount` on expenses: NULL until decided, never 0.**

---

## Stack Quick Reference

- **Backend**: Node.js (CommonJS) + Express 4 + MySQL 8.4 + Zod. Port 4000.
- **Frontend**: React 18 + Vite 5 + react-router-dom v6. No UI library, no TypeScript. Port 5173.
- **Start everything**: `.\start.ps1` from project root.
- **DB reset**: `cd backend && npm run db:reset` (drops and fully reseeds including demo data).

---

## Repository Map

```
ajpowererpsoftware/
├── CLAUDE.md                    ← This file
├── PROJECT_STATUS.md            ← Build state, pending work, debt
├── DEV_ENVIRONMENT.md           ← Setup, commands, env vars
├── FRONTEND_ARCHITECTURE.md     ← Shell, AppCtx, pages, components, design system
├── BACKEND_ARCHITECTURE.md      ← Express patterns, db helpers, audit, docNo
├── start.ps1                    ← Starts MySQL + backend + frontend
├── docs/
│   ├── API.md
│   ├── DOMAIN_PLANNING.md
│   ├── DOMAIN_SITE.md
│   ├── DOMAIN_STORE.md
│   ├── DOMAIN_PROCUREMENT.md
│   └── DOMAIN_BILLING_REPORTS.md
├── APPLICATION_WORKFLOW_AND_USER_JOURNEY.md
├── backend/
│   ├── .env                     ← DB credentials (not committed)
│   ├── src/
│   │   ├── app.js               ← Express app, CORS, route mounting
│   │   ├── index.js             ← HTTP server (:4000)
│   │   ├── config/db.js         ← MySQL pool: many, one, run, tx
│   │   ├── config/env.js        ← Env vars with defaults
│   │   ├── db/
│   │   │   ├── migrations/      ← 001–024 SQL migration files
│   │   │   ├── seeds/           ← 001_reference, 002_items, 003_demo_data, 004_expanded_data
│   │   │   └── setup.js         ← Migration + seed runner (idempotent)
│   │   ├── lib/                 ← audit, docNo, errors, normKey, rates, woImport
│   │   ├── middleware/          ← currentUser, error handler, validate
│   │   ├── modules/             ← 22 route files (one per domain)
│   │   └── routes/index.js      ← Mounts all 22 route prefixes
└── frontend/
    └── src/
        ├── App.jsx              ← Shell, SECTIONS (6 depts), AppCtx, all routes
        ├── api.js               ← Fetch wrapper + formatters
        ├── styles.css           ← Design system (CSS custom properties)
        ├── components/
        │   ├── ui.jsx           ← Card, Field, Tag, Banner, Modal, useApi, toasts
        │   └── charts.jsx       ← SVG charts for Reports
        └── pages/               ← 26 page files
```
