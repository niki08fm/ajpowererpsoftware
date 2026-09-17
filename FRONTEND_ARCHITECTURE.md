# AJ Power ERP — Frontend Architecture

> For page-level business logic, read the relevant `docs/DOMAIN_*.md`.

---

## Stack

- **React 18** — functional components and hooks only
- **Vite 5** — dev server + build
- **react-router-dom v6** — SPA routing
- **No UI library** — all components are custom (intentional)
- **No TypeScript** — plain JavaScript
- **CSS** — vanilla CSS custom properties, no Tailwind, no CSS-in-JS

---

## Entry Points

```
frontend/src/
├── main.jsx            ← ReactDOM.createRoot, mounts <App />
├── App.jsx             ← Shell, routing, global state (AppCtx)
├── api.js              ← All HTTP calls + formatters
├── styles.css          ← Full design system (CSS custom properties)
├── download.js         ← downloadCsv() utility
├── components/
│   ├── ui.jsx          ← All reusable primitives
│   └── charts.jsx      ← SVG charts (Reports only)
└── pages/              ← 24 page files
```

---

## App Shell (`App.jsx`)

### Global State — `AppCtx`

```js
const {
  branches,     // all branches from /masters/branches
  branchId,     // selected branch ID (localStorage)
  setBranch,
  stores,       // stores for current branch
  storeId,      // active store ID (localStorage)
  setStore,
  users,        // all active users
  me,           // current acting user (from /whoami)
  desk,         // badge counts: { amendmentDue, indentsWaiting, expensesWaiting }
  refreshDesk,
} = useApp();
```

### Navigation — `SECTIONS` array

6 active departments (in rail order):

```js
Planning  → /planning/sites, /stores, /boq, /items, /planning/clients
Site      → /indents, /site/inbox, /site/stock, /site/issue, /site/returns,
            /site/transactions, /site/audit, /site/consumption, /site/expenses,
            /site/transfers
Store     → /store, /store/prns, /grns, /challans, /stock, /movements,
            /store/transfers
Reports   → /reports/expense, /reports/pl
Procure   → /procurement, /comparisons, /purchase-orders, /suppliers
Billing   → /billing, /billing/bills
```

`SOON` array in `App.jsx` holds departments that are greyed out in the rail. Currently only `Accounts`.

---

## API Layer (`api.js`)

Never use `fetch` directly. Always use `api.*`:

```js
import { api, money, qty, dmy, today, addDays } from '../api';

api.get('/sites?branchId=1')
api.post('/indents', payload)
api.put('/comparisons/5/quotes', data)
api.patch('/sites/3', patch)
api.del('/items/10')
api.upload('/work-orders/parse', file)   // multipart
```

**Formatters:**
```js
money(n)         // ₹1,23,456.78
qty(n)           // 10 or 12.500
dmy(d)           // "12/09/26"
today()          // "2026-09-12"
addDays(d, n)    // "2026-09-19"
```

---

## Data Fetching — `useApi`

```jsx
import { useApi } from '../components/ui';

const { data, error, loading, reload } = useApi(
  branchId ? `/sites?branchId=${branchId}` : null,
  [branchId]   // re-fetches when these change
);
```

- Pass `null` to skip the fetch (used when required params aren't ready yet).
- Always render `<Loading />` while loading and `<ErrorNote error={error} onRetry={reload} />` on error.

---

## Component Library (`components/ui.jsx`)

| Export | Purpose |
|--------|---------|
| `useApi(path, deps)` | Data fetching hook |
| `useToast()` → `push(msg, kind)` | Toast notifications. kinds: `''`, `'ok'`, `'bad'` |
| `ToastHost` | Mount once at app root |
| `Card` | White card. Props: `title`, `sub`, `actions` |
| `Field` | Form field wrapper. Props: `label`, `hint` |
| `Tag` | Status chip. Props: `kind` → `''` / `'ok'` / `'warn'` / `'bad'` |
| `Banner` | Info strip. Props: `kind` → `'info'` / `'warn'` / `'bad'`, `action` |
| `Empty` | Empty-state component. Props: `title` |
| `Loading` | Full-area spinner |
| `ErrorNote` | Error display + retry button |
| `Stat` | Large metric for dashboards |
| `Meter` | Progress bar. Props: `value`, `max` |
| `Modal` | Dialog wrapper |
| `ClientPicker` | Inline client select + create widget |
| `PageHead` | Page header. Props: `title`, `sub`, `actions` |

Every page starts with `<PageHead title="..." sub="..." actions={...} />`.

---

## Charts (`components/charts.jsx`)

Hand-rolled SVG, reads the same CSS variables as the design system. Only used in `Reports.jsx`.

| Component | Props |
|-----------|-------|
| `DonutChart` | `segments=[{label, value, color}]` |
| `LineChart` | `series=[{label, points:[{x,y}]}]` |
| `TrendChart` | `data=[{date, value}]` |
| `RankBars` | `items=[{label, value}]` |

---

## Pages (`frontend/src/pages/`)

| File | Key exports | Routes |
|------|-------------|--------|
| `Clients.jsx` | `default Clients` | `/planning/clients` |
| `Login.jsx` | `default Login` | `/login` |
| `Sites.jsx` | `default Sites` | `/planning/sites` |
| `NewSite.jsx` | `default NewSite` | `/planning/sites/new` |
| `SiteDetail.jsx` | `default SiteDetail` | `/planning/sites/:id` |
| `Stores.jsx` | `default Stores` | `/stores` |
| `Items.jsx` | `default Items` | `/items` |
| `BoqList.jsx` | `default BoqList` | `/boq` |
| `BoqAmend.jsx` | `AmendSheet`, `BoqHistory` | Modals inside BoqList |
| `Indents.jsx` | `SeverityTag`, `default Indents` | `/indents` |
| `IndentCart.jsx` | `default IndentCart` | `/indents/new`, `/indents/:id/edit` |
| `IndentDetail.jsx` | `default IndentDetail` | `/indents/:id` |
| `Store.jsx` | `StoreDesk`, `Prns`, `IssueSheet`, `Stock`, `Movements` | `/store`, `/store/prns`, `/store/issue`, `/stock`, `/movements` |
| `SiteStore.jsx` | `SiteInbox`, `SiteStock` | `/site/inbox`, `/site/stock` |
| `Consumption.jsx` | `IssueStock`, `ReturnStock` | `/site/issue`, `/site/returns` |
| `Transfers.jsx` | `SiteTransfers`, `SentAndReorder`, `SourceTransfer` | `/site/transfers`, `/store/transfers` |
| `Grns.jsx` | `ReceiveGrn`, `Grns`, `GrnRegister`, `GrnDetail` | `/grns`, `/grns/register`, `/grns/:id` |
| `Challans.jsx` | `Challans`, `ChallanDetail` | `/challans`, `/challans/:id` |
| `Tracking.jsx` | `Transactions`, `Audit`, `Consumed` | `/site/transactions`, `/site/audit`, `/site/consumption` |
| `Expenses.jsx` | `default Expenses` | `/site/expenses` |
| `Procurement.jsx` | `default Procurement` | `/procurement` |
| `PurchaseOrders.jsx` | `PurchaseOrders`, `PurchaseOrderDetail` | `/purchase-orders`, `/purchase-orders/:id` |
| `Comparisons.jsx` | `Comparisons`, `ComparisonDetail` | `/comparisons`, `/comparisons/:id` |
| `Suppliers.jsx` | `default Suppliers` | `/suppliers` |
| `Reports.jsx` | `ExpenseReport`, `ProfitLoss` | `/reports/expense`, `/reports/pl` |
| `Billing.jsx` | `Billing`, `BillingSheet`, `Bills` | `/billing`, `/billing/site/:id`, `/billing/bills` |

---

## Design System (CSS Custom Properties)

```css
--brand: #00877B       /* teal */
--navy: #061D2B        /* sidebar bg */
--canvas: #F6F9FB      /* page bg */
--card: #FFFFFF
--ink: #0F172A
--muted: #64748B
--ok: #0E9F6E
--warn: #B45309
--bad: #DC2626
--rail: 92px
--top: 56px
```

Key CSS classes: `.shell`, `.rail`, `.tabs`, `.page-body`, `.page-head`, `.card`, `.tw` (table wrapper), `.btn`, `.btn.pri`, `.inp`, `.tag`, `.field`, `.banner`, `.click`, `.mono`, `.rt`, `.row2`, `.stats`, `.grid2`

---

## URL-Based Filters

All filterable list pages store filters in the URL so views are shareable:

```jsx
const [params, setParams] = useSearchParams();
const set = (patch) => setParams((p) => {
  for (const [k, v] of Object.entries(patch)) {
    if (!v || v === 'ALL') p.delete(k); else p.set(k, String(v));
  }
  return p;
}, { replace: true });
```

---

## Adding a New Page

1. Create `frontend/src/pages/MyPage.jsx`.
2. Add a `<Route>` in `App.jsx`.
3. Add to the relevant `screens` array in `SECTIONS`.
4. Use `PageHead`, `useApp`, `useApi`, `Card`, `Tag` from the existing library.
5. Use `api.get/post` — never raw `fetch`.
6. Put filters in URL params if the view is filterable.
