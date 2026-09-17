# AJ Power ERP — Frontend Architecture

> For domain-specific page logic, read the relevant `docs/DOMAIN_*.md` file.
> For the full workflow narrative, read `APPLICATION_WORKFLOW_AND_USER_JOURNEY.md`.

---

## Tech Stack

- **React 18** with functional components and hooks only.
- **Vite 5** — dev server + build.
- **react-router-dom v6** — SPA routing.
- **No UI component library.** Everything is custom (intentional — no dependency drift).
- **No TypeScript.** Plain JavaScript with JSDoc comments where needed.
- **CSS**: Vanilla CSS with custom properties. No Tailwind, no CSS-in-JS, no modules.

---

## Entry Points

```
frontend/src/main.jsx      ← ReactDOM.createRoot, mounts <App />
frontend/src/App.jsx       ← Shell, routing, global state (AppCtx)
frontend/src/api.js        ← All HTTP calls + formatters
frontend/src/styles.css    ← Full design system
frontend/src/download.js   ← downloadCsv() utility (used in ExpenseReport)
frontend/src/components/
  ui.jsx                   ← All reusable UI primitives
  charts.jsx               ← Hand-rolled SVG charts (used in Reports only)
frontend/src/pages/        ← 22 page files (no Billing.jsx yet)
```

---

## App Shell (`App.jsx`)

### Global State — `AppCtx`

A single React context provides these values to every page:

```js
{
  branches,     // array of all branches from /masters/branches
  branchId,     // currently selected branch ID (persisted in localStorage)
  setBranch,
  stores,       // stores for current branch
  storeId,      // active store ID (persisted in localStorage)
  setStore,
  users,        // all active users
  me,           // current acting user (from /whoami)
  desk,         // badge counts: { amendmentDue, indentsWaiting, expensesWaiting }
  refreshDesk,
}
```

Access in any page: `const { branchId, me } = useApp();`

### Navigation Structure

Two-level navigation:
1. **Department rail** (left) — icon + label per department. Hover shows flyout with sub-pages.
2. **Tab bar** (top) — sub-pages of the active department.

Defined in `SECTIONS` array in `App.jsx`. **Current 5 active departments** (in rail order):

```js
export const SECTIONS = [
  { id: 'plan',    label: 'Planning', screens: [
    { to: '/sites',   label: 'Sites' },
    { to: '/stores',  label: 'Stores' },
    { to: '/boq',     label: 'BOQ',         badge: 'amendmentDue' },
    { to: '/items',   label: 'Item master' },
  ]},
  { id: 'site',    label: 'Site', screens: [
    { to: '/indents',           label: 'Indents',          badge: 'indentsWaiting' },
    { to: '/site/inbox',        label: 'Acknowledgements' },
    { to: '/site/stock',        label: 'Site store' },
    { to: '/site/issue',        label: 'Issue material' },
    { to: '/site/returns',      label: 'Returns' },
    { to: '/site/transactions', label: 'Transactions' },
    { to: '/site/audit',        label: 'Audit' },
    { to: '/site/consumption',  label: 'Consumption' },
    { to: '/site/expenses',     label: 'Expenses',         badge: 'expensesWaiting' },
  ]},
  { id: 'store',   label: 'Store', screens: [
    { to: '/store',      label: 'Store desk', end: true },
    { to: '/store/prns', label: 'PRNs to fulfil' },
    { to: '/grns',       label: 'GRN' },
    { to: '/challans',   label: 'Challans' },
    { to: '/stock',      label: 'Stock' },
    { to: '/movements',  label: 'Movement' },
  ]},
  { id: 'reports', label: 'Reports', screens: [
    { to: '/reports/expense', label: 'Expense report' },
    { to: '/reports/pl',      label: 'Profit and loss' },
  ]},
  { id: 'procure', label: 'Procure', screens: [
    { to: '/procurement',     label: 'To buy' },
    { to: '/comparisons',     label: 'Rate comparison' },
    { to: '/purchase-orders', label: 'Orders' },
    { to: '/suppliers',       label: 'Suppliers' },
  ]},
];

export const SOON = [
  { id: 'billing',  label: 'Billing',  icon: '₹' },   // greyed — not built
  { id: 'accounts', label: 'Accounts', icon: '◎' },   // greyed — not built
];
```

Note: **Reports comes before Procure** in the rail order.

### `PageHead` Component

Every page starts with:
```jsx
<PageHead title="Sites" sub="subtitle text" actions={<button>...</button>} />
```

---

## API Layer (`api.js`)

**Never use `fetch` directly.** Always use `api.*`:

```js
import { api, money, qty, dmy, today } from '../api';

api.get('/sites?branchId=1')
api.post('/indents', payload)
api.put('/comparisons/5/quotes', d)
api.patch('/sites/3', patch)
api.del('/items/10')
api.upload('/work-orders/parse', file)  // multipart
```

**Formatters**:
```js
money(n)        // ₹1,23,456.78
qty(n)          // 10 or 12.500
dmy(d)          // "12/09/26"
today()         // "2026-09-12"
addDays(d, n)   // "2026-09-19"
```

---

## Data Fetching Hook — `useApi`

```jsx
import { useApi } from '../components/ui';

const { data, error, loading, reload } = useApi(
  branchId ? `/sites?branchId=${branchId}` : null,
  [branchId]
);
```

- Pass `null` to skip the fetch.
- Always show `<Loading />` while loading, `<ErrorNote error={error} onRetry={reload} />` on error.

---

## Component Library (`components/ui.jsx`)

| Component/Hook | Usage |
|---------------|-------|
| `useApi(path, deps)` | Data fetching |
| `useToast()` | `push(message, kind)` — kinds: `''`, `'ok'`, `'bad'` |
| `ToastHost` | Wrap app root |
| `Card` | White card. Props: `title`, `sub`, `actions`, `className` |
| `Field` | Form field. Props: `label`, `hint` |
| `Tag` | Status chip. Props: `kind` — `''`, `'ok'`, `'warn'`, `'bad'` |
| `Banner` | Info strip. Props: `kind` — `'info'`, `'warn'`, `'bad'` |
| `Empty` | Empty state. Props: `title` |
| `Loading` | Full-area spinner |
| `ErrorNote` | Error display with retry |
| `Stat` | Large number for dashboards |
| `Meter` | Progress bar. Props: `value`, `max` |
| `Modal` | Dialog wrapper |
| `ClientPicker` | Inline client select + create widget |

---

## Charts (`components/charts.jsx`)

Hand-rolled SVG — reads the same CSS variables as the design system. **Used only in `Reports.jsx`** (ExpenseReport's Statement/Charts toggle).

| Component | Props |
|-----------|-------|
| `DonutChart` | `segments=[{label, value, color}]` |
| `LineChart` | `series=[{label, points:[{x,y}]}]` |
| `TrendChart` | `data=[{date, value}]` |
| `RankBars` | `items=[{label, value}]` |

---

## Pages (`frontend/src/pages/`)

**22 files** — no `Billing.jsx` yet.

| File | Key exports | Routes |
|------|-------------|--------|
| `Sites.jsx` | `default Sites` | `/sites` |
| `NewSite.jsx` | `default NewSite` | `/sites/new` |
| `SiteDetail.jsx` | `default SiteDetail` | `/sites/:id` |
| `Stores.jsx` | `default Stores` | `/stores` |
| `Items.jsx` | `default Items` | `/items` |
| `BoqList.jsx` | `default BoqList` | `/boq` |
| `BoqAmend.jsx` | `AmendSheet`, `BoqHistory` | Modals inside BoqList |
| `Indents.jsx` | `SeverityTag`, `default Indents` | `/indents` |
| `IndentCart.jsx` | `default IndentCart` | `/indents/new`, `/indents/:id/edit` |
| `IndentDetail.jsx` | `default IndentDetail` | `/indents/:id` |
| `Store.jsx` | `StoreDesk`, `Prns`, `IssueSheet`, `Stock`, `Movements`, `DocLink`, `DocPeek` | `/store`, `/store/prns`, `/store/issue`, `/stock`, `/movements` |
| `SiteStore.jsx` | `useSite`, `SiteInbox`, `SiteStock` | `/site/inbox`, `/site/stock` |
| `Consumption.jsx` | `IssueStock`, `IssueCard`, `ReturnStock` | `/site/issue`, `/site/returns` |
| `Grns.jsx` | `ReceiveGrn`, `Grns`, `GrnRegister`, `GrnDetail` | `/grns`, `/grns/register`, `/grns/:id` |
| `Challans.jsx` | `DcTag`, `Challans`, `ChallanDetail`, `AckModal` | `/challans`, `/challans/:id` |
| `Tracking.jsx` | `Transactions`, `Audit`, `Consumed` | `/site/transactions`, `/site/audit`, `/site/consumption` |
| `Expenses.jsx` | `default Expenses` | `/site/expenses` |
| `Procurement.jsx` | `StageTag`, `default Procurement` | `/procurement` |
| `PurchaseOrders.jsx` | `PoTag`, `PurchaseOrders`, `PurchaseOrderDetail` | `/purchase-orders`, `/purchase-orders/:id` |
| `Comparisons.jsx` | `Comparisons`, `ComparisonDetail` | `/comparisons`, `/comparisons/:id` |
| `Suppliers.jsx` | `default Suppliers` | `/suppliers` |
| `Reports.jsx` | `ExpenseReport`, `ProfitLoss` | `/reports/expense`, `/reports/pl` |

---

## Design System (CSS Custom Properties)

```css
--brand: #00877B       /* teal */
--navy: #061D2B        /* sidebar */
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

**Key CSS classes**: `.shell`, `.rail`, `.tabs`, `.page-body`, `.page-head`, `.card`, `.tw` (table wrapper), `.btn`, `.btn.pri`, `.inp`, `.tag`, `.field`, `.banner`, `.click`, `.mono`, `.num`, `.rt`, `.row2`

---

## URL-Based Filters

Filters live in the URL via `useSearchParams` — filtered views are shareable.

```jsx
const [params, setParams] = useSearchParams();
const set = (patch) => setParams((p) => {
  for (const [k, v] of Object.entries(patch)) {
    if (v === '' || v == null) p.delete(k); else p.set(k, String(v));
  }
  return p;
}, { replace: true });
```

---

## Adding a New Page

1. Create `frontend/src/pages/MyPage.jsx`.
2. Import and add a `<Route>` in `App.jsx`.
3. Add to the relevant section's `screens` array in `SECTIONS`.
4. Use `PageHead`, `useApp`, `useApi`, `Card`, `Tag` from the existing library.
5. Use `api.get/post` — never raw fetch.
6. Put filters in URL params if filterable.
