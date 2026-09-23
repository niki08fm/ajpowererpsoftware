'use strict';
const router = require('express').Router();
const { z } = require('zod');
const { many, one, run, tx } = require('../config/db');
const { validate, wrap } = require('../middleware/validate');
const { log } = require('../lib/audit');
const { conflict, notFound } = require('../lib/errors');
const { plural } = require('../lib/words');

/**
 * The goods receipt register.
 *
 * A GRN is created against the order it answers — that lives on the
 * purchase order, because you cannot receive what nobody bought. What
 * lives here is everything afterwards: the register, one note read end
 * to end, and the two housekeeping actions.
 *
 * A receipt is the only thing that puts bought material on a shelf, so
 * a drafted one is a note that has not happened yet. Confirming it is
 * what writes the stock.
 */

/**
 * The GRN desk: every order still owing this place something, and the
 * notes already raised against them.
 *
 * Acknowledging a delivery is the whole act — the note is not something
 * you write separately afterwards, it is what acknowledging produces.
 * It appears in the history the moment the stock is taken in.
 */
router.get('/desk',
  validate(z.object({
    branchId: z.coerce.number().int().positive().optional(),
    siteId: z.coerce.number().int().positive().optional(),
    storeId: z.coerce.number().int().positive().optional(),
  }), 'query'),
  wrap(async (req, res) => {
    // the store unless a site names itself — a PO sent straight to a
    // site is that site's to sign for, not the store's
    let place = null;
    if (req.query.siteId || req.query.storeId) {
      place = await one(`SELECT id, name, code, site_type FROM sites WHERE id = ?`,
        [req.query.siteId || req.query.storeId]);
      if (!place) throw notFound('No such site');
    } else if (req.query.branchId) {
      place = await one(
        `SELECT id, name, code, site_type FROM sites
          WHERE branch_id = ? AND site_type = 'STORE' AND status = 'ACTIVE'
          ORDER BY is_central DESC, id LIMIT 1`, [req.query.branchId]);
    }
    if (!place) throw notFound('No store for this branch yet');

    const pending = await many(
      `SELECT v.po_id, v.doc_no, v.po_date, v.expected_date, v.supplier_id, v.supplier_name,
              v.deliver_to_id, v.deliver_to_name, v.deliver_to_type,
              v.ordered_qty, v.received_qty, v.pending_qty, v.po_value,
              v.overdue, v.receipt_state,
              (SELECT COUNT(*) FROM goods_receipts g WHERE g.po_id = v.po_id) AS grn_count,
              (SELECT GROUP_CONCAT(DISTINCT i.doc_no ORDER BY i.doc_no SEPARATOR ', ')
                 FROM purchase_order_indents poi JOIN indents i ON i.id = poi.indent_id
                WHERE poi.po_id = v.po_id) AS prns
         FROM v_po_status v JOIN purchase_orders po ON po.id = v.po_id
        WHERE po.status = 'APPROVED' AND v.pending_qty > 0.0005 AND v.deliver_to_id = ?
        ORDER BY v.expected_date IS NULL, v.expected_date`, [place.id]);

    const history = await many(
      `SELECT * FROM v_grn_status WHERE site_id = ?
        ORDER BY receipt_date DESC, grn_id DESC LIMIT 50`, [place.id]);

    res.json({
      place,
      pending,
      history,
      totals: {
        orders: pending.length,
        pendingQty: pending.reduce((t, r) => t + Number(r.pending_qty), 0),
        overdue: pending.filter((r) => Number(r.overdue) > 0).length,
        notes: history.length,
        received: history.reduce((t, r) => t + Number(r.grn_qty), 0),
      },
    });
  })
);

/* ------------------------------------------------------------- list */
router.get('/',
  validate(z.object({
    branchId: z.coerce.number().int().positive().optional(),
    siteId: z.coerce.number().int().positive().optional(),
    poId: z.coerce.number().int().positive().optional(),
    supplierId: z.coerce.number().int().positive().optional(),
    itemId: z.coerce.number().int().positive().optional(),
    status: z.enum(['DRAFT', 'CONFIRMED', 'ALL']).default('ALL'),
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    q: z.string().trim().optional(),
    sort: z.enum(['date', 'oldest', 'value', 'late', 'supplier']).default('date'),
    limit: z.coerce.number().int().min(1).max(1000).default(300),
  }), 'query'),
  wrap(async (req, res) => {
    const q = req.query;
    const where = [];
    const params = [];
    if (q.branchId) { where.push('branch_id = ?'); params.push(q.branchId); }
    if (q.siteId) { where.push('site_id = ?'); params.push(q.siteId); }
    if (q.poId) { where.push('po_id = ?'); params.push(q.poId); }
    if (q.supplierId) { where.push('supplier_id = ?'); params.push(q.supplierId); }
    if (q.status !== 'ALL') { where.push('status = ?'); params.push(q.status); }
    if (q.from) { where.push('receipt_date >= ?'); params.push(q.from); }
    if (q.to) { where.push('receipt_date <= ?'); params.push(q.to); }
    if (q.itemId) {
      where.push('grn_id IN (SELECT grn_id FROM v_grn_line WHERE item_id = ?)');
      params.push(q.itemId);
    }
    if (q.q) {
      // the four numbers a storekeeper actually remembers
      where.push(`(doc_no LIKE ? OR po_no LIKE ? OR supplier_dc LIKE ?
                   OR supplier_name LIKE ? OR site_name LIKE ?)`);
      const like = `%${q.q}%`;
      params.push(like, like, like, like, like);
    }
    const order = {
      date: 'receipt_date DESC, grn_id DESC',
      oldest: 'receipt_date, grn_id',
      value: 'grn_value DESC',
      late: 'days_late DESC, receipt_date DESC',
      supplier: 'supplier_name, receipt_date DESC',
    }[q.sort];

    const rows = await many(
      `SELECT * FROM v_grn_status ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
        ORDER BY ${order} LIMIT ${q.limit}`, params);

    res.json({
      rows,
      totals: {
        notes: rows.length,
        qty: rows.reduce((t, r) => t + Number(r.grn_qty), 0),
        value: rows.reduce((t, r) => t + Number(r.grn_value), 0),
        drafts: rows.filter((r) => r.status === 'DRAFT').length,
        late: rows.filter((r) => Number(r.days_late) > 0).length,
      },
    });
  })
);

/* ----------------------------------------------------------- detail */
router.get('/:id', wrap(async (req, res) => {
  const g = await one(`SELECT * FROM v_grn_status WHERE grn_id = ?`, [req.params.id]);
  if (!g) throw notFound('No such receipt');

  const lines = await many(
    `SELECT l.*,
            (SELECT ROUND(pol.qty - COALESCE(SUM(x.qty), 0), 3)
               FROM goods_receipt_lines x
               JOIN goods_receipts xg ON xg.id = x.grn_id
               JOIN purchase_order_lines pol ON pol.id = l.po_line_id
              WHERE x.po_line_id = l.po_line_id AND xg.status = 'CONFIRMED') AS pending_qty,
            -- which indents this line is answering, in the order's own split
            (SELECT GROUP_CONCAT(CONCAT(i.doc_no, ': ', TRIM(TRAILING '.' FROM TRIM(TRAILING '0' FROM ROUND(pli.qty, 3))))
                       ORDER BY i.doc_no SEPARATOR ' · ')
               FROM po_line_indents pli JOIN indents i ON i.id = pli.indent_id
              WHERE pli.po_line_id = l.po_line_id) AS against
       FROM v_grn_line l WHERE l.grn_id = ? ORDER BY l.item_name`, [g.grn_id]);

  // the stock this note actually created, read back rather than assumed
  const moves = await many(
    `SELECT * FROM v_stock_movement WHERE ref_type = 'GRN' AND ref_id = ? ORDER BY item_name`,
    [g.grn_id]);

  // where the order stands now, so the note is readable without leaving it
  const po = await one(`SELECT * FROM v_po_status WHERE po_id = ?`, [g.po_id]);
  const siblings = await many(
    `SELECT grn_id, doc_no, receipt_date, status, grn_qty, grn_value
       FROM v_grn_status WHERE po_id = ? ORDER BY receipt_date, grn_id`, [g.po_id]);

  const events = await many(
    `SELECT a.action, a.detail, a.created_at, u.name AS user_name
       FROM audit_log a LEFT JOIN users u ON u.id = a.user_id
      WHERE a.entity = 'GRN' AND a.entity_id = ? ORDER BY a.id`, [g.grn_id]);

  res.json({
    ...g,
    lines,
    events,
    moves,
    siblings,
    po: po ? {
      poId: po.po_id, docNo: po.doc_no, stage: po.stage, poDate: po.po_date,
      expectedDate: po.expected_date, supplier: po.supplier_name,
      orderedQty: po.ordered_qty, receivedQty: po.received_qty, pendingQty: po.pending_qty,
      poValue: po.po_value, receiptState: po.receipt_state,
    } : null,
    canConfirm: g.status === 'DRAFT',
    canDelete: g.status === 'DRAFT',
  });
}));

/* ------------------------------------------------------- the ledger */
/** Every note that ever touched one item, oldest first. What the store
 *  turns to when somebody asks what a thing has been costing. */
router.get('/item/:itemId', wrap(async (req, res) => {
  const rows = await many(
    `SELECT g.grn_id, g.doc_no, g.receipt_date, g.status, g.po_no, g.supplier_name,
            g.site_name, g.supplier_dc, l.qty, l.rate, l.line_value, l.make_name
       FROM v_grn_line l JOIN v_grn_status g ON g.grn_id = l.grn_id
      WHERE l.item_id = ? ORDER BY g.receipt_date DESC, g.grn_id DESC LIMIT 200`,
    [req.params.itemId]);
  res.json(rows);
}));

/* ----------------------------------------------------- housekeeping */
/** A drafted note has not put anything on a shelf. This is what does. */
router.post('/:id/confirm', wrap(async (req, res) => {
  const g = await one(`SELECT * FROM goods_receipts WHERE id = ?`, [req.params.id]);
  if (!g) throw notFound('No such receipt');
  if (g.status === 'CONFIRMED') throw conflict('This note is already in stock');

  await tx(async (conn) => {
    const lines = await many(
      `SELECT gl.qty, pol.item_id, pol.make_id, pol.rate
         FROM goods_receipt_lines gl
         JOIN purchase_order_lines pol ON pol.id = gl.po_line_id
        WHERE gl.grn_id = ?`, [g.id], conn);
    await run(`UPDATE goods_receipts SET status = 'CONFIRMED' WHERE id = ?`, [g.id], conn);
    for (const l of lines) {
      await run(
        `INSERT INTO stock_movements (site_id, item_id, make_id, qty, rate, kind,
                                      ref_type, ref_id, ref_no, moved_on, created_by)
         VALUES (?, ?, ?, ?, ?, 'GRN', 'GRN', ?, ?, ?, ?)`,
        [g.received_at, l.item_id, l.make_id, l.qty, l.rate, g.id, g.doc_no,
         g.receipt_date, req.user?.id || null], conn);
    }
    await log(conn, { entity: 'GRN', entityId: g.id, docNo: g.doc_no,
      action: 'Confirmed', detail: `${plural(lines.length, 'line')} on the shelf`, user: req.user });
  });

  const v = await one(`SELECT * FROM v_grn_status WHERE grn_id = ?`, [g.id]);
  res.json({ ok: true, status: 'CONFIRMED', qty: v.grn_qty, value: v.grn_value });
}));

/** Only a draft can go. A confirmed note has moved stock, and stock
 *  that moved is not unmoved by deleting the paperwork. */
router.delete('/:id', wrap(async (req, res) => {
  const g = await one(`SELECT * FROM goods_receipts WHERE id = ?`, [req.params.id]);
  if (!g) throw notFound('No such receipt');
  if (g.status !== 'DRAFT') {
    throw conflict('This note is in stock. Material that has been taken in cannot be '
      + 'un-received by deleting the note — issue it out or raise a return instead.');
  }
  await run(`DELETE FROM goods_receipts WHERE id = ?`, [g.id]);
  res.json({ ok: true });
}));

module.exports = router;
