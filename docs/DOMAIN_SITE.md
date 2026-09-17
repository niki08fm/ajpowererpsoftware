# Domain: Site Department

> Personas: **Site Engineer / PM** (raises indents, expenses), **Site Storekeeper** (inbox, issues, returns)
> Frontend section: `site` in `SECTIONS` (App.jsx)
> For deep narrative, see: `APPLICATION_WORKFLOW_AND_USER_JOURNEY.md` §3, §6, §7, §8

---

## What Site Does

Site covers everything at the physical job site: requesting materials, receiving deliveries, issuing to field workers, accepting returns, and claiming operational expenses.

**Critical rule**: Site screens show **quantities only — no rates, no rupee values.** The only exception is `/site/expenses`.

---

## Screens & Routes

| Screen | Route | File(s) |
|--------|-------|---------|
| Material indents | `/indents` | `pages/Indents.jsx` |
| Indent cart (new/edit) | `/indents/new`, `/indents/:id/edit` | `pages/IndentCart.jsx` |
| Indent detail | `/indents/:id` | `pages/IndentDetail.jsx` |
| Site inbox | `/site/inbox` | `pages/SiteStore.jsx` → `SiteInbox` |
| Site stock | `/site/stock` | `pages/SiteStore.jsx` → `SiteStock` |
| Issue material | `/site/issue` | `pages/Consumption.jsx` → `IssueStock` |
| Material returns | `/site/returns` | `pages/Consumption.jsx` → `ReturnStock` |
| Transactions | `/site/transactions` | `pages/Tracking.jsx` → `Transactions` |
| Audit | `/site/audit` | `pages/Tracking.jsx` → `Audit` |
| Consumption | `/site/consumption` | `pages/Tracking.jsx` → `Consumed` |
| Site expenses | `/site/expenses` | `pages/Expenses.jsx` |

---

## Key Concepts

### Indents — lifecycle
```
DRAFT → SUBMITTED → APPROVED → FULFILLED
            ↓
         RETURNED (with note)
```
- Pre-check (`POST /indents/evaluate`): classifies each item as `none` / `warn` / `bad`.
- On approval: **rollup** merges duplicate items across BOQ lines.
- The indent is also the **billing ceiling** — see `DOMAIN_BILLING_REPORTS.md`.

### Site Inbox
IN TRANSIT challans appear here. Storekeeper verifies and acknowledges (full or `PART_ACK`). Acknowledging writes a `DC_IN` movement.

### Issue Material
Worker names are **typed free-text** (field labour aren't system users). Rate stamped silently at central store rate for the document date. Stock constraint enforced inside the DB transaction.

### Material Returns
- **Person is selected**, never typed — only people currently holding something appear.
- Not linked to a specific issue slip (migration 018 removed that column).
- Cost reversal at central store rate on the return date.

### Site Expenses — lifecycle
```
DRAFT → SUBMITTED → APPROVED / REJECTED / RETURNED
```
- `approved_amount` is NULL until decided, never 0.
- Partial approval: both figures stay on one document. `PART_APPROVED` is derived.
- Approving more than claimed is refused by DB constraint.
- A cut/refusal/return requires a reason.

---

## API Endpoints

### Indents
| Method | Path | What |
|--------|------|------|
| GET | `/indents?branchId=&siteId=&status=` | List |
| POST | `/indents/evaluate` | Dry-run qty check |
| POST | `/indents` | Create |
| GET | `/indents/:id` | Detail |
| PATCH | `/indents/:id` | Update draft |
| POST | `/indents/:id/decide` | Approve / Return |

### Site Store & Consumption
| Method | Path | What |
|--------|------|------|
| GET | `/site-store/:siteId/inbox` | Inbound challans |
| POST | `/challans/:id/acknowledge` | Sign for delivery |
| GET | `/site-store/:siteId/stock` | Current site stock |
| GET | `/consumption/issuable/:siteId` | Items available to issue |
| GET | `/consumption/returnable/:siteId` | Person + items to return |
| GET | `/consumption/people/:siteId` | Names used at this site |
| POST | `/consumption/issues` | Record issue |
| POST | `/consumption/returns` | Record return |

### Tracking
| Method | Path | What |
|--------|------|------|
| GET | `/tracking/transactions` | Movement ledger |
| GET | `/tracking/audit/item/:itemId` | Item history |
| GET | `/tracking/audit/person` | Person audit |
| GET | `/tracking/consumed` | Net consumption |

### Expenses
| Method | Path | What |
|--------|------|------|
| GET | `/expenses?siteId=&status=` | List |
| POST | `/expenses` | Create |
| PATCH | `/expenses/:id` | Edit draft |
| POST | `/expenses/:id/decide` | Approve / Reject / Return |
| GET | `/expenses/categories` | Category list |

---

## Current State

✅ All Site screens fully built and working.
