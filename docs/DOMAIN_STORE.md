# Domain: Store Department (Central Store)

> Persona: **Central Storekeeper** (e.g., Imran Sheikh)
> Frontend section: `store` in `SECTIONS` (App.jsx)
> For deep narrative, see: `APPLICATION_WORKFLOW_AND_USER_JOURNEY.md` §5

---

## What the Store Does

Receives supplier shipments (GRN), maintains warehouse inventory, and dispatches materials to sites via Delivery Challans.

---

## Screens & Routes

| Screen | Route | File(s) |
|--------|-------|---------|
| Store desk | `/store` | `pages/Store.jsx` → `StoreDesk` |
| PRNs to fulfil | `/store/prns` | `pages/Store.jsx` → `Prns` |
| GRN list | `/grns` | `pages/Grns.jsx` → `Grns` |
| GRN register | `/grns/register` | `pages/Grns.jsx` → `GrnRegister` |
| GRN detail | `/grns/:id` | `pages/Grns.jsx` → `GrnDetail` |
| Challans | `/challans` | `pages/Challans.jsx` |
| Challan detail | `/challans/:id` | `pages/Challans.jsx` → `ChallanDetail` |
| Stock | `/stock` | `pages/Store.jsx` → `Stock` |
| Movements | `/movements` | `pages/Store.jsx` → `Movements` |

---

## Key Concepts

### Store Selector
Top bar shows a store selector only when `section.id === 'store'`. `storeId` persisted in localStorage.

### GRN
Receive against an **APPROVED** PO only. On confirmation: `stock_movements` entry written, unit rate stamped from the PO.

### Delivery Challan
On DISPATCH: qty decrements from central store, enters **IN TRANSIT**. Belongs to nobody until the site acknowledges. Both store and site screens show it until resolved.

---

## API Endpoints

| Method | Path | What |
|--------|------|------|
| GET | `/grns/desk` | Approved POs ready to receive |
| POST | `/purchase-orders/:id/receipts` | Create GRN |
| POST | `/grns/:id/confirm` | Confirm GRN |
| GET | `/store/prns` | PRNs queue |
| POST | `/challans` | Create DC |
| POST | `/challans/:id/dispatch` | Dispatch (decrements stock) |
| GET | `/store/stock?storeId=` | Current stock |
| GET | `/store/movements?storeId=` | Movement ledger |
| GET | `/store/stores?branchId=` | Stores in branch |

---

## Current State

✅ Fully built and working.
