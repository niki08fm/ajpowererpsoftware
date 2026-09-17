---
inclusion: auto
name: AJ Power ERP Agent Instructions
description: Core instructions and context navigation guide for any coding task on the AJ Power ERP project. Auto-loaded for all sessions.
---

# AJ Power ERP — Agent Steering File

This project is an **Electrical Contracting ERP** (AJ Power Solutions). Before writing any code, orient yourself using the context system described below.

---

## Context Navigation

Load only what the task needs.

### Always available (repo root)

| File | When to read |
|------|-------------|
| `CLAUDE.md` | Every session — invariants, conventions, repo map |
| `PROJECT_STATUS.md` | What's built vs. pending |
| `DEV_ENVIRONMENT.md` | Dev setup, commands, env vars |
| `FRONTEND_ARCHITECTURE.md` | Any frontend work |
| `BACKEND_ARCHITECTURE.md` | Any backend work |

### Domain context (load for that department)

| File | Department |
|------|-----------|
| `docs/DOMAIN_PLANNING.md` | Sites, BOQ, Work Orders, Items |
| `docs/DOMAIN_SITE.md` | Indents, Store, Issue/Return, Expenses |
| `docs/DOMAIN_STORE.md` | GRN, Challans, Stock |
| `docs/DOMAIN_PROCUREMENT.md` | Demand, Comparisons, Purchase Orders |
| `docs/DOMAIN_BILLING_REPORTS.md` | RA Billing, Expense report, P&L |

### Deep reference (only when needed)

| File | When |
|------|------|
| `APPLICATION_WORKFLOW_AND_USER_JOURNEY.md` | Deep domain question or business rule dispute |
| `docs/API.md` | Full endpoint reference |

---

## Non-Negotiable Rules

1. **No stored running balances.** All quantities derived from ledger views.
2. **Site screens — quantities only, no money.** Exception: `/site/expenses`.
3. **Rate stamping** — stamp central store rate for the document's date, not today.
4. **Billing ceiling = indented qty**, not contracted qty.
5. **`approved_amount` on expenses: NULL until decided, never 0.**
6. **Audit log is append-only.** Never UPDATE or DELETE from `audit_log`.
7. **All DB writes go through `tx()` and log to `audit_log`.**
8. **Quantities `DECIMAL(18,3)`, money `DECIMAL(18,2)`. No floats.**

---

## Stack Quick Reference

- **Backend**: Node.js (CommonJS) + Express + MySQL 8.4 + Zod. Port 4000.
- **Frontend**: React 18 + Vite + react-router-dom v6. Port 5173. No UI library, no TypeScript.
- **Start everything**: `.\start.ps1` from project root.
- **DB reset**: `cd backend; npm run db:reset` (destructive — drops and reseeds).
- **Tests**: `cd backend; npm test`.
- **Route index**: `backend/src/routes/index.js` — 20 prefixes mounted, `/bills` not yet added.

---

## Current Priority (as of September 2026)

1. **Build Billing frontend** — DB + views ready, no React pages.
2. **Authentication** — replace X-User-Id header with JWT login.
3. **Separate department dashboards** — remove sidebar, per-department login routes.

See `PROJECT_STATUS.md` for the full plan.
