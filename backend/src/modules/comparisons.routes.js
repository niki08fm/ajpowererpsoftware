'use strict';
const router = require('express').Router();
const { z } = require('zod');
const { many, one, run, tx } = require('../config/db');
const { validate, wrap } = require('../middleware/validate');
const { nextDocNo } = require('../lib/docNo');
const { log } = require('../lib/audit');
const { conflict, notFound, badRequest } = require('../lib/errors');
const chain = require('../lib/approvals');
const { plural } = require('../lib/words');

/**
 * Rate comparison.
 *
 * A rate is not a price. The discount comes off, the freight goes on,
 * and the supplier who quoted lowest is regularly not the one it is
 * cheapest to buy from. Showing that is the only reason this screen
 * exists — so the sheet always reports both, and says when they differ.
 *
 * Credit days sit alongside rather than being priced in: 45 days
 * against 15 is a judgement a buyer makes differently in different
 * months, and folding it into one number would hide it.
 */

/* ------------------------------------------------------------- list */
router.get('/',
  validate(z.object({
    branchId: z.coerce.number().int().positive().optional(),
    status: z.enum(['DRAFT', 'DECIDED', 'ALL']).default('ALL'),
    q: z.string().trim().optional(),
  }), 'query'),
  wrap(async (req, res) => {
    const where = [];
    const params = [];
    if (req.query.branchId) { where.push('c.branch_id = ?'); params.push(req.query.branchId); }
    if (req.query.status !== 'ALL') { where.push('c.status = ?'); params.push(req.query.status); }
    if (req.query.q) {
      where.push('(c.doc_no LIKE ? OR c.title LIKE ?)');
      params.push(`%${req.query.q}%`, `%${req.query.q}%`);
    }
    res.json(await many(
      `SELECT c.* FROM v_comparison_status c
        ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
        ORDER BY c.created_at DESC`, params));
  })
);

/* ----------------------------------------------------------- detail */
router.get('/:id', wrap(async (req, res) => {
  const c = await one(`SELECT * FROM v_comparison_status WHERE comparison_id = ?`, [req.params.id]);
  if (!c) throw notFound('No such comparison');

  const items = await many(
    `SELECT ci.id, ci.item_id, ci.make_id, ci.qty,
            it.code AS item_code, it.name AS item_name, it.gst_rate,
            u.code AS uom, mk.name AS make_name
       FROM comparison_items ci
       JOIN items it ON it.id = ci.item_id
       JOIN uoms  u  ON u.id = it.uom_id
       LEFT JOIN makes mk ON mk.id = ci.make_id
      WHERE ci.comparison_id = ? ORDER BY it.name`, [c.comparison_id]);

  const suppliers = await many(
    `SELECT * FROM v_comparison_supplier WHERE comparison_id = ? ORDER BY supplier_name`,
    [c.comparison_id]);

  const quotes = await many(
    `SELECT q.comparison_item_id, q.comparison_supplier_id, q.rate
       FROM comparison_quotes q
       JOIN comparison_suppliers cs ON cs.id = q.comparison_supplier_id
      WHERE cs.comparison_id = ?`, [c.comparison_id]);

  const indents = await many(
    `SELECT i.id, i.doc_no, s.name AS site_name
       FROM comparison_indents ci JOIN indents i ON i.id = ci.indent_id
       JOIN sites s ON s.id = i.site_id
      WHERE ci.comparison_id = ? ORDER BY i.doc_no`, [c.comparison_id]);

  res.json({
    ...c, items, suppliers, quotes, indents,
    // the point of the sheet, stated rather than left to be spotted
    cheapestIsNotLowest: !!(c.best_landed_supplier_id && c.best_quoted_supplier_id
      && c.best_landed_supplier_id !== c.best_quoted_supplier_id),
    canEdit: c.status === 'DRAFT',
    // whose desk it is on and at which level, with names
    approval: await chain.trail('COMPARISON', c.comparison_id, req.user?.id),
  });
}));

/* ----------------------------------------------------------- create */
router.post('/',
  validate(z.object({
    // optional when indents are named: they carry their own branch, and
    // a buyer looking at every branch has no single one to send
    branchId: z.coerce.number().int().positive().optional(),
    title: z.string().trim().max(200).optional(),
    indentIds: z.array(z.coerce.number().int().positive()).max(100).default([]),
    items: z.array(z.object({
      itemId: z.coerce.number().int().positive(),
      makeId: z.coerce.number().int().positive().nullable().optional(),
      qty: z.coerce.number().positive(),
    })).max(300).default([]),
    supplierIds: z.array(z.coerce.number().int().positive()).max(20).default([]),
  })),
  wrap(async (req, res) => {
    const b = req.body;

    // One comparison is one branch: its suppliers, rates and the orders
    // it leads to all belong to a branch. The indents it answers decide
    // which, and indents from two branches cannot share one sheet.
    let branchId = b.branchId;
    if (b.indentIds.length) {
      const brs = await many(
        `SELECT DISTINCT i.branch_id, br.name FROM indents i
           JOIN branches br ON br.id = i.branch_id
          WHERE i.id IN (${b.indentIds.map(() => '?').join(',')})`, b.indentIds);
      if (brs.length > 1) {
        throw badRequest(
          `Those indents are from ${brs.map((x) => x.name).join(' and ')}. `
          + 'One comparison is one branch — compare each branch separately.');
      }
      if (brs.length && branchId && brs[0].branch_id !== branchId) {
        throw badRequest(`Those PRNs are from ${brs[0].name}, not the branch this comparison names`);
      }
      if (brs.length) branchId = brs[0].branch_id;
    }
    if (!branchId) throw badRequest('Say which branch this comparison is for');

    // seeded from indents, or typed in directly — but not from nothing
    let lines = b.items;
    if (b.indentIds.length) {
      const marks = b.indentIds.map(() => '?').join(',');
      const rows = await many(
        `SELECT f.item_id, f.make_id, SUM(f.to_order_qty) AS qty
           FROM v_indent_item_flow f
          WHERE f.indent_id IN (${marks}) AND f.to_order_qty > 0
          GROUP BY f.item_id, f.make_id`, b.indentIds);
      lines = rows.map((r) => ({ itemId: r.item_id, makeId: r.make_id, qty: Number(r.qty) }));
    }
    if (!lines.length) throw badRequest('There is nothing to compare');

    const out = await tx(async (conn) => {
      const docNo = await nextDocNo(conn, 'CMP');
      const c = await run(
        `INSERT INTO comparisons (doc_no, branch_id, title, created_by) VALUES (?, ?, ?, ?)`,
        [docNo, branchId, b.title || null, req.user?.id || null], conn);
      for (const id of new Set(b.indentIds)) {
        await run(`INSERT INTO comparison_indents (comparison_id, indent_id) VALUES (?, ?)`,
          [c.insertId, id], conn);
      }
      for (const l of lines) {
        await run(
          `INSERT INTO comparison_items (comparison_id, item_id, make_id, qty) VALUES (?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE qty = qty + VALUES(qty)`,
          [c.insertId, l.itemId, l.makeId || null, l.qty], conn);
      }
      for (const sid of new Set(b.supplierIds)) {
        await run(`INSERT INTO comparison_suppliers (comparison_id, supplier_id) VALUES (?, ?)`,
          [c.insertId, sid], conn);
      }
      await log(conn, { entity: 'COMPARISON', entityId: c.insertId, docNo, action: 'Started',
        detail: `${plural(lines.length, 'item')}`, user: req.user });
      return { id: c.insertId, docNo };
    });
    res.status(201).json(out);
  })
);

/* --------------------------------------------------- who is quoting */
async function liveDraft(id) {
  const c = await one(`SELECT * FROM comparisons WHERE id = ?`, [id]);
  if (!c) throw notFound('No such comparison');
  if (c.status !== 'DRAFT') throw conflict('This comparison has been decided');
  return c;
}

router.post('/:id/suppliers',
  validate(z.object({ supplierId: z.coerce.number().int().positive() })),
  wrap(async (req, res) => {
    const c = await liveDraft(req.params.id);
    const dup = await one(
      `SELECT id FROM comparison_suppliers WHERE comparison_id = ? AND supplier_id = ?`,
      [c.id, req.body.supplierId]);
    if (dup) throw conflict('That supplier is already on this sheet');
    const r = await run(
      `INSERT INTO comparison_suppliers (comparison_id, supplier_id) VALUES (?, ?)`,
      [c.id, req.body.supplierId]);
    res.status(201).json({ comparisonSupplierId: r.insertId });
  })
);

router.delete('/:id/suppliers/:csId', wrap(async (req, res) => {
  const c = await liveDraft(req.params.id);
  await run(`DELETE FROM comparison_suppliers WHERE id = ? AND comparison_id = ?`,
    [req.params.csId, c.id]);
  res.json({ ok: true });
}));

/** Discount, freight and credit belong to the whole quote, not a line. */
router.patch('/:id/suppliers/:csId',
  validate(z.object({
    discountPct: z.coerce.number().min(0).max(100).optional(),
    freight: z.coerce.number().min(0).optional(),
    creditDays: z.coerce.number().int().min(0).max(365).optional(),
    note: z.string().trim().max(300).optional(),
  })),
  wrap(async (req, res) => {
    const c = await liveDraft(req.params.id);
    const b = req.body;
    await run(
      `UPDATE comparison_suppliers
          SET discount_pct = COALESCE(?, discount_pct), freight = COALESCE(?, freight),
              credit_days = COALESCE(?, credit_days), note = COALESCE(?, note)
        WHERE id = ? AND comparison_id = ?`,
      [b.discountPct ?? null, b.freight ?? null, b.creditDays ?? null, b.note ?? null,
       req.params.csId, c.id]);
    const row = await one(`SELECT * FROM v_comparison_supplier WHERE comparison_supplier_id = ?`,
      [req.params.csId]);
    res.json(row);
  })
);

/** The rates, saved together — a half-entered quote compares badly. */
router.put('/:id/quotes',
  validate(z.object({
    quotes: z.array(z.object({
      comparisonItemId: z.coerce.number().int().positive(),
      comparisonSupplierId: z.coerce.number().int().positive(),
      rate: z.coerce.number().min(0).nullable(),
    })).max(2000),
  })),
  wrap(async (req, res) => {
    const c = await liveDraft(req.params.id);
    await tx(async (conn) => {
      for (const q of req.body.quotes) {
        if (q.rate === null || q.rate === undefined) {
          await run(
            `DELETE FROM comparison_quotes
              WHERE comparison_item_id = ? AND comparison_supplier_id = ?`,
            [q.comparisonItemId, q.comparisonSupplierId], conn);
        } else {
          await run(
            `INSERT INTO comparison_quotes (comparison_item_id, comparison_supplier_id, rate)
             VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE rate = VALUES(rate)`,
            [q.comparisonItemId, q.comparisonSupplierId, q.rate], conn);
        }
      }
    });
    res.json(await many(
      `SELECT * FROM v_comparison_supplier WHERE comparison_id = ? ORDER BY landed`, [c.id]));
  })
);

/* ---------------------------------------------------------- decided */
router.post('/:id/decide',
  validate(z.object({
    supplierId: z.coerce.number().int().positive(),
    note: z.string().trim().max(400).optional(),
  })),
  wrap(async (req, res) => {
    const c = await liveDraft(req.params.id);
    const onSheet = await one(
      `SELECT * FROM v_comparison_supplier WHERE comparison_id = ? AND supplier_id = ?`,
      [c.id, req.body.supplierId]);
    if (!onSheet) throw badRequest('That supplier did not quote on this sheet');
    if (!Number(onSheet.quoted_lines)) throw badRequest('That supplier has not quoted anything yet');

    const best = await one(
      `SELECT * FROM v_comparison_supplier WHERE comparison_id = ? AND quoted_lines > 0
        ORDER BY landed LIMIT 1`, [c.id]);
    // choosing a dearer quote is allowed and often right — delivery,
    // credit, a supplier who actually turns up — but it is recorded
    const dearer = Number(onSheet.landed) > Number(best.landed);
    if (dearer && !(req.body.note || '').trim()) {
      throw badRequest(
        `${onSheet.supplier_name} is not the cheapest landed — ${best.supplier_name} is. `
        + 'Say why this one.'
      );
    }

    // Choosing the supplier is the buyer's decision and it is recorded
    // as theirs; it is not the company's until it has been signed.
    // Until then no order may be raised off this sheet, which is the
    // point of comparing rates in front of somebody.
    //
    // A comparison belongs to a branch rather than a site — the buy
    // list it came from can span several — so there is no site GM to
    // sign it. Both levels are Management, and the chain's rule that
    // one person may not sign twice keeps it two real signatures.
    await tx(async (conn) => {
      await run(
        `UPDATE comparisons SET status = 'DECIDED', chosen_supplier_id = ?,
                decided_note = ?, decided_at = NOW() WHERE id = ?`,
        [req.body.supplierId, req.body.note || null, c.id], conn);
      await chain.open(conn, { docType: 'COMPARISON', docId: c.id, docNo: c.doc_no,
        branchId: c.branch_id, userId: req.user?.id, note: req.body.note });
      await log(conn, { entity: 'COMPARISON', entityId: c.id, docNo: c.doc_no,
        action: 'Decided, sent for approval',
        detail: `${onSheet.supplier_name}${dearer ? ' (not the cheapest)' : ''}`
          + (req.body.note ? ` · ${req.body.note}` : ''), user: req.user });
    });
    res.json({
      ok: true, supplierId: req.body.supplierId, supplierName: onSheet.supplier_name,
      landed: onSheet.landed, wasCheapest: !dearer, status: 'DECIDED',
      message: `${onSheet.supplier_name} chosen — ${c.doc_no} now needs two approvals `
        + 'before an order can be raised from it',
    });
  })
);

/**
 * Sign the chosen rate, or send the sheet back to the buyer.
 *
 * Returning it reopens the comparison for a different choice rather
 * than killing it — the quotes on it are still good.
 */
router.post('/:id/decide-approval',
  validate(z.object({
    action: z.enum(['APPROVED', 'RETURNED']),
    note: z.string().trim().max(500).optional(),
  })),
  wrap(async (req, res) => {
    const c = await one(`SELECT * FROM comparisons WHERE id = ?`, [req.params.id]);
    if (!c) throw notFound('No such comparison');
    if (c.status !== 'DECIDED') {
      throw conflict(`This comparison is ${c.status.toLowerCase()}, not waiting for approval`);
    }
    if (req.body.action === 'RETURNED' && (req.body.note || '').trim().length < 5) {
      throw badRequest('Say why it is going back');
    }
    let step;
    await tx(async (conn) => {
      step = await chain.decide(conn, { docType: 'COMPARISON', docId: c.id,
        action: req.body.action, userId: req.user?.id, note: req.body.note });
      if (req.body.action === 'RETURNED') {
        await run(
          `UPDATE comparisons SET status = 'DRAFT', chosen_supplier_id = NULL,
                  decided_note = NULL, decided_at = NULL WHERE id = ?`, [c.id], conn);
      } else if (step.done) {
        await run(`UPDATE comparisons SET status = 'APPROVED' WHERE id = ?`, [c.id], conn);
      }
      await log(conn, { entity: 'COMPARISON', entityId: c.id, docNo: c.doc_no,
        action: req.body.action === 'RETURNED' ? 'Returned to the buyer'
          : step.done ? 'Approved' : 'Signed once',
        detail: req.body.note, user: req.user });
    });
    res.json({
      ok: true,
      status: req.body.action === 'RETURNED' ? 'DRAFT' : step.done ? 'APPROVED' : 'DECIDED',
      level: step.level, levels: step.levels, done: step.done,
      message: req.body.action === 'RETURNED'
        ? `${c.doc_no} is back with the buyer to choose again`
        : step.done
          ? `${c.doc_no} is approved — an order can be raised from it`
          : `${c.doc_no} is approved at level 1 and is now with Management`,
    });
  })
);

router.post('/:id/reopen', wrap(async (req, res) => {
  const c = await one(`SELECT * FROM comparisons WHERE id = ?`, [req.params.id]);
  if (!c) throw notFound('No such comparison');
  const used = await one(`SELECT id FROM purchase_orders WHERE comparison_id = ?`, [c.id]);
  if (used) throw conflict('An order has already been raised from this comparison');
  await tx(async (conn) => {
    await run(
      `UPDATE comparisons SET status = 'DRAFT', chosen_supplier_id = NULL,
              decided_note = NULL, decided_at = NULL WHERE id = ?`, [c.id], conn);
    // the signatures were for a choice that no longer stands; the sheet
    // starts again, and the old chain goes with the old decision
    await run(`DELETE FROM approval_chains WHERE doc_type = 'COMPARISON' AND doc_id = ?`,
      [c.id], conn);
  });
  res.json({ ok: true });
}));

router.delete('/:id', wrap(async (req, res) => {
  const c = await one(`SELECT * FROM comparisons WHERE id = ?`, [req.params.id]);
  if (!c) throw notFound('No such comparison');
  const used = await one(`SELECT id FROM purchase_orders WHERE comparison_id = ?`, [c.id]);
  if (used) throw conflict('An order has been raised from this comparison');
  await run(`DELETE FROM comparisons WHERE id = ?`, [c.id]);
  res.json({ ok: true });
}));

module.exports = router;
