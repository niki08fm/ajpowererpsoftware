# AJ Power ERP — Backend Architecture

> For domain-specific business rules, read `docs/DOMAIN_*.md`.
> For the full workflow narrative, read `APPLICATION_WORKFLOW_AND_USER_JOURNEY.md`.

---

## Stack

- **Node.js** (CommonJS `'use strict'`) + **Express 4**
- **MySQL 8.4** via `mysql2` connection pool
- **Zod** for request validation
- **No ORM** — raw SQL everywhere
- Server starts on port **4000**
- All API routes prefixed with `/api`

---

## Directory Layout

```
backend/src/
├── app.js              ← Express app setup, CORS, route mounting
├── index.js            ← HTTP server, graceful shutdown
├── config/
│   ├── db.js           ← MySQL pool + helper functions (many, one, run, tx)
│   └── env.js          ← All env vars with defaults
├── db/
│   ├── migrations/     ← 001_schema.sql through 023_billing_views.sql
│   ├── seeds/          ← 001_reference.sql, 002_items.sql
│   └── setup.js        ← Boot-time migration + seed runner
├── lib/
│   ├── audit.js        ← Append-only audit_log writer
│   ├── docNo.js        ← Document number generator
│   ├── errors.js       ← HTTP error helpers
│   ├── normKey.js      ← String normalization for duplicate guards
│   ├── rates.js        ← Rate stamping engine
│   └── woImport.js     ← Excel/CSV Work Order parser
├── middleware/
│   ├── currentUser.js  ← Reads X-User-Id header, attaches req.user
│   ├── error.js        ← Global error handler + 404 handler
│   └── validate.js     ← Zod validation middleware + async wrap
├── modules/            ← 19 route controller files (one per feature domain)
│   ├── boq.routes.js
│   ├── challans.routes.js
│   ├── comparisons.routes.js
│   ├── consumption.routes.js
│   ├── costs.routes.js
│   ├── expenses.routes.js
│   ├── grn.routes.js
│   ├── indents.routes.js
│   ├── items.routes.js
│   ├── masters.routes.js
│   ├── procurement.routes.js
│   ├── progress.routes.js
│   ├── purchaseorders.routes.js
│   ├── sites.routes.js
│   ├── sitestore.routes.js
│   ├── store.routes.js
│   ├── suppliers.routes.js
│   ├── tracking.routes.js
│   └── workorders.routes.js
│   (bills.routes.js — NOT YET CREATED)
└── routes/
    └── index.js        ← Mounts all modules + /whoami + /users
```

---

## Database Helpers (`config/db.js`)

**Always use these — never call `pool.query` directly.**

```js
const { many, one, run, tx } = require('../config/db');

const rows = await many(`SELECT * FROM items WHERE category_id = ?`, [catId]);
const item = await one(`SELECT * FROM items WHERE id = ?`, [id]);
const result = await run(`INSERT INTO ...`, [...values]);
// result.insertId, result.affectedRows

const newId = await tx(async (conn) => {
  const r = await run(`INSERT INTO ...`, [...], conn);
  await run(`INSERT INTO audit_log ...`, [...], conn);
  return r.insertId;
});
// tx auto-commits on success, auto-rolls-back on throw
```

Pass `conn` as third arg to `many/one/run` when inside a transaction.

---

## Validation Middleware

```js
const { validate, wrap } = require('../middleware/validate');
const { z } = require('zod');

router.post('/items',
  validate(z.object({
    name: z.string().trim().min(2).max(180),
    categoryId: z.coerce.number().int().positive(),
  })),
  wrap(async (req, res) => {
    res.json({ id: 1 });
  })
);

// Query params:
validate(z.object({ branchId: z.coerce.number().optional() }), 'query')
```

---

## Error Helpers (`lib/errors.js`)

```js
const { conflict, notFound, badRequest, forbidden } = require('../lib/errors');

throw conflict('Already exists', { existingId: 5 });  // 409
throw notFound('Site not found');                      // 404
throw badRequest('qty must be > 0');                   // 400
```

---

## Audit Logging (`lib/audit.js`)

Every write must log to `audit_log`. Append-only.

```js
const { log } = require('../lib/audit');

await tx(async (conn) => {
  const r = await run(`INSERT INTO ...`, [...], conn);
  await log(conn, {
    entity: 'INDENT', entityId: r.insertId,
    docNo: 'PRN/26-27/0001',
    action: 'Created',
    detail: 'description',
    user: req.user,
  });
  return r.insertId;
});
```

---

## Document Numbering (`lib/docNo.js`)

```js
const { nextDocNo } = require('../lib/docNo');
const docNo = await nextDocNo(conn, 'PRN', branchId);
// → "PRN/26-27/0042"
```

---

## Route Structure Pattern

```js
'use strict';
const router = require('express').Router();
const { z } = require('zod');
const { many, one, run, tx } = require('../config/db');
const { validate, wrap } = require('../middleware/validate');
const { log } = require('../lib/audit');
const { notFound, conflict } = require('../lib/errors');

router.get('/path', wrap(async (req, res) => {
  res.json(await many(`SELECT ...`));
}));

router.post('/path',
  validate(z.object({ ... })),
  wrap(async (req, res) => {
    const id = await tx(async (conn) => {
      const r = await run(`INSERT INTO ...`, [...], conn);
      await log(conn, { ... });
      return r.insertId;
    });
    res.status(201).json({ id });
  })
);

module.exports = router;
```

---

## Adding a New Route Module

1. Create `src/modules/myfeature.routes.js`.
2. In `src/routes/index.js` add: `router.use('/myfeature', require('../modules/myfeature.routes'));`

All requests pass through `currentUser` middleware first (reads `X-User-Id`, attaches `req.user`). No auth enforcement yet.

## Migration System

- Reads all `.sql` files from `db/migrations/` in order.
- Tracks applied migrations in `migration_log` (idempotent).
- `--fresh` drops the DB and starts clean.

### Writing a New Migration

1. Create `db/migrations/024_my_feature.sql`.
2. Start with `SET FOREIGN_KEY_CHECKS = 0;`, end with `SET FOREIGN_KEY_CHECKS = 1;`.
3. Use `CREATE OR REPLACE VIEW` and `CREATE TABLE IF NOT EXISTS`.
4. **Never edit existing migration files** — always add a new one.

---

## Key Database Views

| View | What it answers |
|------|----------------|
| `v_stock_balance` | Current qty and value at any store/site |
| `v_stock_movement` | Human-readable movement ledger |
| `v_boq_line_status` | Estimated / indented / consumed / balance per BOQ line |
| `v_indent_item_flow` | Ordered / received / in-transit / at-site per indent |
| `v_consumption_event` | Issues (+) and returns (−) as signed ledger |
| `v_person_outstanding` | What each named person currently holds |
| `v_site_expense` | Expense with derived `outcome`, `disallowed_amount` |
| `v_cost_event` | Material + approved expenses on one cost ledger |
| `v_wo_line_indented` | Indents translated to client units (least-provisioned item) |
| `v_billing_line` | Agreed / indented / billed / billable / waiting per WO line |
| `v_bill_line` | Bill lines with `previous_qty` for RA format |
| `v_bill_status` | Bill header + totals |
| `v_site_revenue` | Raised bills only — revenue side of P&L |

---

## What Is Missing from Backend

- `bills.routes.js` — not yet created. Schema (022) and views (023) are done.
- Auth middleware — no JWT, no `requireAuth` or `requireDepartment`.
- Rate limiting — no `express-rate-limit`.
- CORS restriction — currently wide open.
