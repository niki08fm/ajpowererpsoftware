# AJ Power ERP — Backend Architecture

> For business rules, read `docs/DOMAIN_*.md`.
> For the full workflow narrative, read `APPLICATION_WORKFLOW_AND_USER_JOURNEY.md`.

---

## Stack

- **Node.js** (CommonJS `'use strict'`) + **Express 4**
- **MySQL 8.4** via `mysql2` connection pool
- **Zod** for request validation
- **No ORM** — raw SQL everywhere
- Port **4000**, all routes prefixed with `/api`

---

## Directory Layout

```
backend/src/
├── app.js              ← Express app, CORS, route mounting
├── index.js            ← HTTP server, graceful shutdown
├── config/
│   ├── db.js           ← MySQL pool + helpers: many, one, run, tx
│   └── env.js          ← All env vars with defaults
├── db/
│   ├── migrations/     ← 001_schema.sql → 024_transfers.sql
│   ├── seeds/          ← 001_reference, 002_items, 003_demo_data, 004_expanded_data
│   └── setup.js        ← Boot-time migration + seed runner (idempotent, --fresh flag)
├── lib/
│   ├── audit.js        ← Append-only audit_log writer
│   ├── docNo.js        ← Document number generator (FY-aware, row-locked)
│   ├── errors.js       ← HTTP error helpers: conflict, notFound, badRequest, forbidden
│   ├── normKey.js      ← String normalization for duplicate guards
│   ├── rates.js        ← Rate stamping engine
│   └── woImport.js     ← Excel/CSV Work Order parser
├── middleware/
│   ├── currentUser.js  ← Reads X-User-Id header, attaches req.user
│   ├── error.js        ← Global error handler + 404 handler
│   └── validate.js     ← Zod validation wrapper + async wrap helper
├── modules/            ← 22 route controller files (one per domain)
└── routes/
    └── index.js        ← Mounts all 22 prefixes + /whoami + /users
```

---

## Database Helpers (`config/db.js`)

Always use these. Never call `pool.query` directly.

```js
const { many, one, run, tx } = require('../config/db');

const rows  = await many(`SELECT * FROM items WHERE category_id = ?`, [catId]);
const item  = await one(`SELECT * FROM items WHERE id = ?`, [id]);
const res   = await run(`INSERT INTO indents ...`, [...values]);
// res.insertId, res.affectedRows

const newId = await tx(async (conn) => {
  const r = await run(`INSERT INTO ...`, [...], conn);
  await run(`INSERT INTO audit_log ...`, [...], conn);
  return r.insertId;
});
// tx auto-commits on success, auto-rolls-back on throw
```

Pass `conn` as third arg to `many/one/run` when inside a transaction.

---

## Validation & Error Helpers

```js
const { validate, wrap } = require('../middleware/validate');
const { z } = require('zod');
const { conflict, notFound, badRequest } = require('../lib/errors');

router.post('/items',
  validate(z.object({
    name: z.string().trim().min(2),
    categoryId: z.coerce.number().int().positive(),
  })),
  wrap(async (req, res) => {
    // req.body is already validated and typed
    if (exists) throw conflict('Already exists', { existingId: 5 }); // 409
    throw notFound('Not found');    // 404
    throw badRequest('qty must > 0'); // 400
  })
);

// For query params:
validate(z.object({ branchId: z.coerce.number().optional() }), 'query')
```

---

## Audit Logging (`lib/audit.js`)

Every write must log to `audit_log`. The table is append-only — never UPDATE or DELETE it.

```js
const { log } = require('../lib/audit');

await tx(async (conn) => {
  const r = await run(`INSERT INTO indents ...`, [...], conn);
  await log(conn, {
    entity: 'INDENT', entityId: r.insertId,
    docNo: 'IND/25-26/0001',
    action: 'Created',
    detail: 'Raised against BOQ/25-26/0001',
    user: req.user,
  });
  return r.insertId;
});
```

---

## Document Numbering (`lib/docNo.js`)

```js
const { nextDocNo, fyOf } = require('../lib/docNo');

// Must be called inside a transaction — uses FOR UPDATE row lock
const docNo = await nextDocNo(conn, 'IND', new Date());
// → "IND/25-26/0007"

fyOf('2026-08-01')  // → '26-27'
fyOf('2025-02-01')  // → '24-25'
```

Format: `{TYPE}/{FY}/{####}` — FY resets at April 1, sequence is per doc_type per FY.

---

## Route Module Pattern

```js
'use strict';
const router = require('express').Router();
const { z } = require('zod');
const { many, one, run, tx } = require('../config/db');
const { validate, wrap } = require('../middleware/validate');
const { log } = require('../lib/audit');
const { notFound } = require('../lib/errors');

router.get('/', wrap(async (req, res) => {
  res.json(await many(`SELECT * FROM ...`));
}));

router.post('/',
  validate(z.object({ name: z.string().min(1) })),
  wrap(async (req, res) => {
    const id = await tx(async (conn) => {
      const r = await run(`INSERT INTO ...`, [...], conn);
      await log(conn, { entity: 'X', entityId: r.insertId, action: 'Created', user: req.user });
      return r.insertId;
    });
    res.status(201).json({ id });
  })
);

module.exports = router;
```

To add a new module: create the file, then add `router.use('/prefix', require('../modules/myfeature.routes'))` to `src/routes/index.js`.

---

## Migration System

- `setup.js` reads `db/migrations/` in filename order, tracks applied files in `schema_migrations`.
- `--fresh` drops the DB and starts clean (used by `npm run db:reset`).
- Seeds run automatically: item master gated on `items` table being empty, demo data gated on `sites` table being empty.

**Writing a new migration:**
1. Create `db/migrations/024_my_feature.sql`.
2. Start with `SET FOREIGN_KEY_CHECKS = 0;`, end with `SET FOREIGN_KEY_CHECKS = 1;`.
3. Use `CREATE TABLE IF NOT EXISTS` and `CREATE OR REPLACE VIEW`.
4. Never edit an existing migration file — always add a new one.

---

## Key Database Views

| View | What it answers |
|------|----------------|
| `v_stock_balance` | Current qty and avg_rate at any store/site |
| `v_stock_movement` | Human-readable movement ledger |
| `v_boq_line_status` | est_qty / indented / consumed / balance per BOQ line |
| `v_indent_item_flow` | ordered / received / in-transit / at-site per indent item |
| `v_indent_pipeline` | Stage summary per indent (AWAITING_PO → AT_SITE) |
| `v_po_line_status` | Ordered vs received per PO line |
| `v_po_status` | PO header with stage and delivery state |
| `v_dc_status` | Challan state: DISPATCHED / IN_TRANSIT / ACKNOWLEDGED |
| `v_consumption_event` | Issues (+) and returns (−) as signed ledger |
| `v_person_outstanding` | What each named person currently holds |
| `v_site_expense` | Expense with `outcome`, `cost_amount`, `disallowed_amount` |
| `v_cost_event` | Material + approved expenses on one cost ledger |
| `v_billing_line` | contracted / indented / billed / billable / to-bill per WO line |
| `v_bill_line` | Bill lines with `previous_qty` for RA format |
| `v_bill_status` | Bill header + supply/inst/total values |
| `v_site_revenue` | Raised bills only — revenue side of P&L |
