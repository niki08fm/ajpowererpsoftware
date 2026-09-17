# Domain: Planning Department

> Persona: **Planning Engineer** (e.g., Suresh Rao)
> Frontend section: `plan` in `SECTIONS` (App.jsx)
> For deep narrative, see: `APPLICATION_WORKFLOW_AND_USER_JOURNEY.md` §1–§2

---

## What Planning Does

Planning is the project foundation. It sets up sites, ingests client contracts, and prepares the technical breakdown that all downstream departments (Site, Store, Procure, Billing) operate against.

---

## Screens & Routes

| Screen | Route | File |
|--------|-------|------|
| Sites list | `/sites` | `pages/Sites.jsx` |
| Create new site | `/sites/new` | `pages/NewSite.jsx` |
| Site detail / WO | `/sites/:id` | `pages/SiteDetail.jsx` |
| BOQ list + preparation | `/boq` | `pages/BoqList.jsx` + `BoqAmend.jsx` |
| Item master | `/items` | `pages/Items.jsx` |
| Stores management | `/stores` | `pages/Stores.jsx` |

---

## Key Concepts

### Site
The atomic unit of work. Every downstream document belongs to a site.

Requires **four role assignments** (DB-enforced):
- Branch (commercial entity)
- Site Head (project engineer)
- Site Storekeeper (material custodian)
- General Manager (`ck_site_gm` constraint)

### Client
Created inline via `ClientPicker`. Duplicate names return `409 + { clientId }` so the picker selects the existing one rather than erroring.

### Work Order (WO)
Client's legal agreement. Uploaded as Excel/CSV → `POST /work-orders/parse`. **Permanently LOCKED** once created — scope changes go through BOQ amendments only.

### BOQ (Bill of Quantities)
Technical breakdown: which items make up one unit of each WO line, and how many.

`boq_qty = item_qty × contracted_qty`

**Overrun policies** at submission:
- `overAllow: false` — hard stop.
- `overAllow: true, overPct: 10` — warn up to 10%.
- `overAllow: true, overPct: 0` — unlimited.

### BOQ Amendment
Raised against the **WO line**, not individual items. System recalculates component quantities. Original contracted qty preserved. An amendment does not raise what can be billed — material still needs to be indented.

### Items (Item Master)
2,607 pre-seeded electrical items. Duplicate prevention via `norm_key` + `sort_key`.

---

## API Endpoints

| Method | Path | What |
|--------|------|------|
| GET | `/sites?branchId=` | List sites |
| POST | `/sites` | Create site |
| PATCH | `/sites/:id` | Update site |
| GET | `/sites/stores/list` | Stores for site picker |
| GET | `/masters/clients?branchId=` | Client list |
| POST | `/masters/clients` | Create client |
| GET | `/masters/branches` | All branches |
| GET | `/masters/users?department=` | Users |
| POST | `/work-orders/parse` | Parse Excel/CSV upload |
| POST | `/work-orders` | Create WO |
| GET | `/work-orders/site/:id` | WO for a site |
| POST | `/boq/prepare` | Prepare BOQ |
| PUT | `/boq/:id/wo-line/:woLineId` | Update component recipe |
| POST | `/boq/:id/submit` | Lock BOQ with overrun policy |
| GET | `/boq/:id/amend-sheet` | Amendment sheet |
| POST | `/boq/:id/amendments` | Submit amendments |
| GET | `/items` | Item list |
| POST | `/items` | Create item |
| GET | `/items/search` | Token-based search |

---

## Current State

✅ Fully built and working.
