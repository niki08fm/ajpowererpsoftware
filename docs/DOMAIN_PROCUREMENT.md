# Domain: Procurement Department

> Persona: **Procurement Officer** + **GM** for PO approval
> Frontend section: `procure` in `SECTIONS` (App.jsx)
> For deep narrative, see: `APPLICATION_WORKFLOW_AND_USER_JOURNEY.md` §4

---

## What Procurement Does

Consolidates approved site demands, gets supplier quotes, compares landed costs, and raises Purchase Orders requiring GM sign-off.

---

## Screens & Routes

| Screen | Route | File(s) |
|--------|-------|---------|
| Demand / buying sheet | `/procurement` | `pages/Procurement.jsx` |
| Rate comparisons | `/comparisons` | `pages/Comparisons.jsx` |
| Comparison detail | `/comparisons/:id` | `pages/Comparisons.jsx` → `ComparisonDetail` |
| Purchase orders | `/purchase-orders` | `pages/PurchaseOrders.jsx` |
| PO detail | `/purchase-orders/:id` | `pages/PurchaseOrders.jsx` → `PurchaseOrderDetail` |
| Suppliers | `/suppliers` | `pages/Suppliers.jsx` |

---

## Key Concepts

### Landed Cost Formula
```
Basic Amount = Σ (Rate × Qty)
Landed Cost  = Basic Amount − (Basic Amount × Discount%) + Freight
```
Selecting a non-lowest supplier requires an explicit justification (stored in audit trail).

### PO Lifecycle
```
DRAFT → SUBMITTED → APPROVED (GM)
            ↓
         RETURNED → back to DRAFT
```
- `SUBMITTED` holds qty (prevents double-ordering) but store can't receive yet.
- Only `APPROVED` enables GRN.

---

## API Endpoints

| Method | Path | What |
|--------|------|------|
| GET | `/procurement/queue` | Open approved indents |
| POST | `/procurement/demand` | Buying sheet with stock on hand |
| POST | `/comparisons` | Create comparison |
| PUT | `/comparisons/:id/quotes` | Update quotes |
| POST | `/comparisons/:id/decide` | Select supplier |
| POST | `/purchase-orders` | Create PO |
| POST | `/purchase-orders/:id/decide` | GM approve / return |

---

## Current State

✅ Fully built and working.
