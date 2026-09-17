# Domain: Billing & Reports Departments

> Personas: **Billing Engineer** (Billing), **Finance Director / Management** (Reports)
> For deep narrative, see: `APPLICATION_WORKFLOW_AND_USER_JOURNEY.md` §9, §10

---

## Billing Department

### Status: Backend DB ✅ | Backend Routes ❌ | Frontend ❌

Migrations 022 + 023 are complete. No route file or React pages exist yet.

---

### Core Billing Rules

**Billing ceiling = indented qty, not contracted qty:**
```
may_bill = indented_qty − already_billed_qty
```

**Translating indents to client units** — `v_wo_line_indented` takes the **least-provisioned item**:
- Socket point needs 1 box + 2 plates. 80 boxes indented, 60 plates → **60 points** billable.

**RA Bill sequence**: strictly RA 1, 2, 3. `uq_bill_ra (site_id, ra_no)` prevents duplicates.

**Status**:
- `DRAFT` — not revenue.
- `RAISED` — revenue. Rates stamped from WO at raise time, never repriced.
- `CANCELLED` — must cancel in reverse order (RA 3 before RA 2).

---

### What Needs to Be Built

#### Backend — create `src/modules/bills.routes.js`
```
GET  /bills/sites              → sites with billing summary
GET  /bills/sheet/:siteId      → billing sheet (v_billing_line)
POST /bills                    → create draft
POST /bills/:id/raise          → raise bill
POST /bills/:id/cancel         → cancel (with reason, in order)
GET  /bills/register           → bill register
GET  /bills/:id                → bill detail
```
Register in routes index under `/bills`.

#### Frontend — create `src/pages/Billing.jsx`
- `BillingSheet` — main billing entry screen.
- `BillRegister` — list of raised bills.

Add to `SECTIONS` in `App.jsx` (remove from `SOON`):
```js
{ id: 'billing', label: 'Billing', icon: '₹',
  screens: [
    { to: '/billing', label: 'Billing sheet' },
    { to: '/billing/bills', label: 'Bill register' },
  ]
}
```

Register in `src/routes/index.js`: `router.use('/bills', require('../modules/bills.routes'));`

#### Frontend — create `src/pages/Billing.jsx`
- `BillingSheet` — main billing entry screen using `v_billing_line` columns.
- `BillRegister` — list of raised bills.

Add to `SECTIONS` in `App.jsx` (remove from `SOON`):
```js
{ id: 'billing', label: 'Billing', icon: '₹',
  screens: [
    { to: '/billing', label: 'Billing sheet' },
    { to: '/billing/bills', label: 'Bill register' },
  ]
}
```
Add routes in `App.jsx`:
```jsx
<Route path="/billing" element={<BillingSheet />} />
<Route path="/billing/bills" element={<BillRegister />} />
```

---

### Key Views (migration 023)

**`v_billing_line`** — the biller's working sheet, one row per WO line:

| Column | Meaning |
|--------|---------|
| `contracted_qty` | Agreed quantity on WO |
| `var_qty` | Amendment variance |
| `boq_qty` | `contracted_qty + var_qty` (current agreed total) |
| `supply_rate`, `inst_rate`, `rate` | Client rates from WO |
| `contract_value` | `wol.line_total` — original contract value |
| `indented_qty` | Least-provisioned item translated to client units |
| `consumed_qty` | Net site consumption translated to client units |
| `billed_qty` | Cumulative raised-bill qty |
| `billed_value` | Cumulative raised-bill value |
| `to_bill_qty` | `GREATEST(boq_qty − billed_qty, 0)` |
| `to_bill_value` | `to_bill_qty × rate` |
| `billed_pct` | `billed_qty / boq_qty × 100` |

**`v_wo_line_indented`** — translates item-level indents to WO-line units via `MIN` across items:
- Joins `boq_lines` → `v_boq_line_movement` for `approved_qty`.
- Left-joins `v_site_consumption` for `consumed_qty` (net issues − returns).

**`v_bill_line`** — individual lines with `previous_qty` for RA "up to last · this bill · to date" format.

**`v_bill_status`** — bill header with `supply_value`, `inst_value`, `bill_value` totals.

**`v_site_revenue`** — raised bills only, grouped by site. Feeds P&L.

---

## Reports Department

### Status: ✅ Fully built

### Expense Report (`/reports/expense`)
```
MATERIAL CONSUMED    per item — net qty + amount (no rate column)
LABOUR               per approved claim (LABOUR kind)
OTHER EXPENSES       per approved claim (OTHER kind)
TOTAL
```
- Statement / Charts toggle (donuts, line graph, column chart).
- Unapproved claims shown separately.
- All filters in URL. CSV download available.

### Profit & Loss (`/reports/pl`)
- Revenue = raised RA bills only (`v_site_revenue`).
- Guard: refuses to show before any bill exists.
```
Gross Profit  = Billed Revenue − (Material + Labour + Approved Expenses)
Gross Margin% = (Gross Profit / Billed Revenue) × 100
```

### API Endpoints
| Method | Path | What |
|--------|------|------|
| GET | `/costs/expense/statement` | Full expense statement |
| GET | `/costs/expense` | Summary totals |
| GET | `/costs/expense/lines` | Item-level lines |
| GET | `/costs/pl` | P&L for a site |

> P&L shows empty state until Billing is built — it already queries `v_site_revenue`, just no bills exist yet.
