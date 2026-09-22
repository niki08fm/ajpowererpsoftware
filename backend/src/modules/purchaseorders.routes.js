'use strict';
const router = require('express').Router();
const { z } = require('zod');
const { many, one, run, tx } = require('../config/db');
const { validate, wrap } = require('../middleware/validate');
const { nextDocNo } = require('../lib/docNo');
const { log } = require('../lib/audit');
const { conflict, notFound, badRequest } = require('../lib/errors');
const chain = require('../lib/approvals');

/**
 * Purchase orders.
 *
 * One order can answer several indents — the same cable wanted by three
 * sites is one negotiation. Which means the quantity on a line has to be
 * attributed back to the indents it fills, or nobody can answer "how
 * much of my indent has been ordered". That split is recorded rather
 * than inferred, oldest need-date first, capped at what each indent
 * still has outstanding.
 *
 * Where it delivers follows from what it covers: one site's indents may
 * go straight to that site, several sites' must land at the store and
 * be issued on from there.
 */

const round3 = (n) => Math.round(Number(n) * 1000) / 1000;

/* ------------------------------------------------------------- list */
const SORTS = {
  date: 'po.po_date DESC, po.id DESC',
  expected: 'po.expected_date IS NULL, po.expected_date',
  supplier: 'sp.name, po.po_date DESC',
  value: 'v.po_value DESC',
  pending: 'v.pending_qty DESC',
};

router.get('/',
  validate(z.object({
    branchId: z.coerce.number().int().positive().optional(),
    supplierId: z.coerce.number().int().positive().optional(),
    // one word for where an order is, whether that is a signature
    // or a delivery. PIPELINE is everything signed and not yet fully in.
    stage: z.enum(['DRAFT', 'AWAITING_GM', 'RETURNED', 'AWAITING', 'PARTIAL', 'RECEIVED',
      'CANCELLED', 'PIPELINE', 'MINE', 'ALL']).default('ALL'),
    overdue: z.coerce.boolean().optional(),
    q: z.string().trim().optional(),
    sort: z.enum(['date', 'expected', 'supplier', 'value', 'pending']).default('date'),
  }), 'query'),
  wrap(async (req, res) => {
    const where = [];
    const params = [];
    if (req.query.branchId) { where.push('po.branch_id = ?'); params.push(req.query.branchId); }
    if (req.query.supplierId) { where.push('po.supplier_id = ?'); params.push(req.query.supplierId); }
    if (req.query.q) {
      where.push('(po.doc_no LIKE ? OR sp.name LIKE ? OR d.name LIKE ?)');
      const like = `%${req.query.q}%`;
      params.push(like, like, like);
    }
    // the delivery pipeline: signed, and something still owed on it
    if (req.query.stage === 'PIPELINE') where.push(`v.stage IN ('AWAITING','PARTIAL')`);
    // what the buyer has to act on: not yet sent, or sent back
    else if (req.query.stage === 'MINE') where.push(`v.stage IN ('DRAFT','RETURNED')`);
    else if (req.query.stage !== 'ALL') { where.push('v.stage = ?'); params.push(req.query.stage); }
    if (req.query.overdue) where.push('v.overdue = 1');

    res.json(await many(
      `SELECT v.*, po.created_at,
              (SELECT GROUP_CONCAT(i.doc_no ORDER BY i.doc_no SEPARATOR ', ')
                 FROM purchase_order_indents poi JOIN indents i ON i.id = poi.indent_id
                WHERE poi.po_id = po.id) AS indent_nos
         FROM purchase_orders po
         JOIN suppliers sp ON sp.id = po.supplier_id
         JOIN sites d      ON d.id = po.deliver_to_id
         JOIN v_po_status v ON v.po_id = po.id
        ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
        ORDER BY ${SORTS[req.query.sort]}`, params));
  })
);

/* ----------------------------------------------------------- detail */
router.get('/:id', wrap(async (req, res) => {
  const po = await one(
    `SELECT v.*, po.notes, po.closed_note, po.comparison_id, po.created_at, u.name AS created_by_name,
            sp.gstin AS supplier_gstin, sp.terms_days
       FROM purchase_orders po
       JOIN v_po_status v ON v.po_id = po.id
       JOIN suppliers sp  ON sp.id = po.supplier_id
       LEFT JOIN users u  ON u.id = po.created_by
      WHERE po.id = ?`, [req.params.id]
  );
  if (!po) throw notFound('No such purchase order');

  const events = await many(
    `SELECT e.action, e.note, e.created_at, u.name AS user_name
       FROM po_events e LEFT JOIN users u ON u.id = e.user_id
      WHERE e.po_id = ? ORDER BY e.id`, [po.po_id]);

  const lines = await many(
    `SELECT l.*,
            (SELECT GROUP_CONCAT(CONCAT(i.doc_no, ' ', ROUND(pli.qty, 3)) ORDER BY i.doc_no SEPARATOR ' · ')
               FROM po_line_indents pli JOIN indents i ON i.id = pli.indent_id
              WHERE pli.po_line_id = l.po_line_id) AS against
       FROM v_po_line_status l WHERE l.po_id = ? ORDER BY l.item_name`, [po.po_id]);

  const indents = await many(
    `SELECT i.id, i.doc_no, i.needed_by, s.name AS site_name
       FROM purchase_order_indents poi
       JOIN indents i ON i.id = poi.indent_id
       JOIN sites s   ON s.id = i.site_id
      WHERE poi.po_id = ? ORDER BY i.doc_no`, [po.po_id]);

  const receipts = await many(
    `SELECT grn_id AS id, doc_no, receipt_date, supplier_dc, status, note, days_late,
            site_name AS received_at_name, received_by_name,
            line_count, grn_qty AS qty, grn_value AS value
       FROM v_grn_status WHERE po_id = ? ORDER BY receipt_date, grn_id`, [po.po_id]);

  res.json({
    ...po, lines, indents, receipts, events,
    canEdit: EDITABLE.includes(po.status),
    canSign: po.status === 'SUBMITTED',
  });
}));

/* ----------------------------------------------------------- create */
const lineShape = z.object({
  itemId: z.coerce.number().int().positive(),
  makeId: z.coerce.number().int().positive().nullable().optional(),
  qty: z.coerce.number().positive(),
  rate: z.coerce.number().min(0),
  gstRate: z.coerce.number().min(0).max(100).default(18),
  remark: z.string().trim().max(300).optional(),
});

/**
 * Write the lines of an order and attribute each one back to the
 * indents it fills — soonest needed first, capped at what each is
 * still owed.
 *
 * `exceptPoId` is the order being edited: what it already holds is
 * added back before the cap is applied, or an order would be refused
 * for the quantity it itself is responsible for.
 */
async function writeLines(conn, poId, indentIds, lines, exceptPoId) {
  const marks = indentIds.map(() => '?').join(',');
  const flow = await many(
    `SELECT f.indent_id, f.item_id, f.to_order_qty,
            COALESCE((SELECT SUM(pli.qty) FROM po_line_indents pli
                        JOIN purchase_order_lines pol ON pol.id = pli.po_line_id
                       WHERE pli.indent_id = f.indent_id AND pol.item_id = f.item_id
                         AND pol.po_id = ?), 0) AS own_qty
       FROM v_indent_item_flow f JOIN indents i ON i.id = f.indent_id
      WHERE f.indent_id IN (${marks})
      ORDER BY i.needed_by IS NULL, i.needed_by, i.indent_date, i.id`,
    [exceptPoId || 0, ...indentIds], conn
  );
  // free = still owed, plus whatever this same order is already holding
  const free = flow
    .map((f) => ({ ...f, free: round3(Number(f.to_order_qty) + Number(f.own_qty)) }))
    .filter((f) => f.free > 0);

  for (const l of lines) {
    const item = await one(`SELECT id, uom_id, name, code FROM items WHERE id = ?`, [l.itemId], conn);
    if (!item) throw badRequest('One of those items is not in the master');

    const share = free.filter((f) => f.item_id === l.itemId);
    const owed = round3(share.reduce((t, f) => t + f.free, 0));
    if (l.qty > owed + 0.0005) {
      throw conflict(
        `${item.code} — ${item.name}: ${owed} is still outstanding on the indents chosen, `
        + `so ${l.qty} cannot be ordered against them.`,
        { itemId: l.itemId, available: owed }
      );
    }

    const line = await run(
      `INSERT INTO purchase_order_lines (po_id, item_id, make_id, uom_id, qty, rate, gst_rate, remark)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [poId, l.itemId, l.makeId || null, item.uom_id, l.qty, l.rate, l.gstRate,
       l.remark || null], conn
    );

    let left = l.qty;
    for (const f of share) {
      if (left <= 0.0005) break;
      const take = round3(Math.min(left, f.free));
      if (take <= 0) continue;
      left = round3(left - take);
      await run(
        `INSERT INTO po_line_indents (po_line_id, indent_id, qty) VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE qty = qty + VALUES(qty)`,
        [line.insertId, f.indent_id, take], conn
      );
    }
  }
}

/** The delivery rule: one site may take it direct, several cannot. */
async function checkDestination(indents, deliverToId) {
  const dest = await one(`SELECT id, name, site_type, branch_id FROM sites WHERE id = ?`, [deliverToId]);
  if (!dest) throw badRequest('No such delivery destination');
  const sites = [...new Set(indents.map((i) => i.site_id))];
  if (sites.length > 1 && dest.site_type !== 'STORE') {
    throw badRequest(
      'These indents are for more than one site, so the order has to be delivered to a store '
      + 'and issued on from there.'
    );
  }
  if (sites.length === 1 && dest.site_type === 'SITE' && dest.id !== sites[0]) {
    throw badRequest('That is not the site these indents were raised for');
  }
  return dest;
}

const createBody = z.object({
  supplierId: z.coerce.number().int().positive(),
  indentIds: z.array(z.coerce.number().int().positive()).min(1).max(100),
  deliverToId: z.coerce.number().int().positive(),
  poDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  expectedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  comparisonId: z.coerce.number().int().positive().optional(),
  notes: z.string().trim().max(500).optional(),
  submit: z.boolean().default(false),
  lines: z.array(lineShape).min(1).max(300),
});

const editBody = z.object({
  supplierId: z.coerce.number().int().positive().optional(),
  deliverToId: z.coerce.number().int().positive().optional(),
  poDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  expectedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  notes: z.string().trim().max(500).optional(),
  lines: z.array(lineShape).min(1).max(300).optional(),
});

router.post('/', validate(createBody), wrap(async (req, res) => {
  const b = req.body;
  const ids = [...new Set(b.indentIds)];
  const marks = ids.map(() => '?').join(',');

  const indents = await many(
    `SELECT id, doc_no, site_id, branch_id, status, needed_by, indent_date
       FROM indents WHERE id IN (${marks})`, ids);
  if (indents.length !== ids.length) throw badRequest('One of those indents does not exist');
  const bad = indents.find((i) => i.status !== 'APPROVED');
  if (bad) throw badRequest(`${bad.doc_no} is not approved`);
  const branches = [...new Set(indents.map((i) => i.branch_id))];
  if (branches.length > 1) throw badRequest('Those indents are in different branches');

  const dest = await checkDestination(indents, b.deliverToId);

  // A rate comparison is the evidence for the rate on this order, and
  // evidence nobody signed is not evidence. If the buyer cites one, it
  // has to have cleared both levels first.
  if (b.comparisonId) {
    const cmp = await one(`SELECT doc_no, status FROM comparisons WHERE id = ?`, [b.comparisonId]);
    if (!cmp) throw badRequest('That rate comparison does not exist');
    if (cmp.status !== 'APPROVED') {
      throw conflict(cmp.status === 'DECIDED'
        ? `${cmp.doc_no} is still waiting to be signed — an order cannot be raised off it yet`
        : `${cmp.doc_no} has not been decided`);
    }
  }

  const out = await tx(async (conn) => {
    const docNo = await nextDocNo(conn, 'PO', b.poDate);
    const po = await run(
      `INSERT INTO purchase_orders (doc_no, branch_id, supplier_id, comparison_id, deliver_to_id,
                                    po_date, expected_date, status, notes, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [docNo, branches[0], b.supplierId, b.comparisonId || null, dest.id, b.poDate,
       b.expectedDate || null, b.submit ? 'SUBMITTED' : 'DRAFT', b.notes || null,
       req.user?.id || null], conn
    );
    for (const id of ids) {
      await run(`INSERT INTO purchase_order_indents (po_id, indent_id) VALUES (?, ?)`,
        [po.insertId, id], conn);
    }

    await writeLines(conn, po.insertId, ids, b.lines, null);

    await log(conn, {
      entity: 'PO', entityId: po.insertId, docNo,
      action: b.submit ? 'Sent to the GM' : 'Drafted',
      detail: `${b.lines.length} line(s) · ${ids.length} indent(s) · to ${dest.name}`,
      user: req.user,
    });
    if (b.submit) {
      await run(`UPDATE purchase_orders SET submitted_at = NOW() WHERE id = ?`, [po.insertId], conn);
      await run(`INSERT INTO po_events (po_id, action, user_id) VALUES (?, 'SUBMITTED', ?)`,
        [po.insertId, req.user?.id || null], conn);
      // raising it already sent is the same act as submitting it
      await chain.open(conn, { docType: 'PO', docId: po.insertId, docNo,
        branchId: branches[0], siteId: dest.id, userId: req.user?.id });
    }
    return { id: po.insertId, docNo };
  });

  const v = await one(`SELECT * FROM v_po_status WHERE po_id = ?`, [out.id]);
  res.status(201).json({ ...out, status: v.status, value: v.po_value, deliverTo: dest.name });
}));

/* --------------------------------------------------- the signature */
/**
 * A purchase order commits money, so the GM signs it before it is sent.
 *
 * DRAFT/RETURNED -> SUBMITTED -> APPROVED, or back to RETURNED with a
 * remark saying why. A returned order is editable again: fix it and
 * resubmit, or cancel it. Nothing reaches a supplier unsigned.
 */
const EDITABLE = ['DRAFT', 'RETURNED'];

router.post('/:id/submit', wrap(async (req, res) => {
  const po = await one(`SELECT * FROM purchase_orders WHERE id = ?`, [req.params.id]);
  if (!po) throw notFound('No such purchase order');
  if (!EDITABLE.includes(po.status)) throw conflict(`This order is ${po.status.toLowerCase()}`);
  const { n } = await one(`SELECT COUNT(*) AS n FROM purchase_order_lines WHERE po_id = ?`, [po.id]);
  if (!n) throw badRequest('There is nothing on this order');
  await tx(async (conn) => {
    await run(`UPDATE purchase_orders SET status = 'SUBMITTED', submitted_at = NOW() WHERE id = ?`,
      [po.id], conn);
    await run(`INSERT INTO po_events (po_id, action, user_id) VALUES (?, 'SUBMITTED', ?)`,
      [po.id, req.user?.id || null], conn);
    // the GM of the site it is being delivered to signs first, then
    // Management; an order is money leaving the company
    await chain.open(conn, { docType: 'PO', docId: po.id, docNo: po.doc_no,
      branchId: po.branch_id, siteId: po.deliver_to_id, userId: req.user?.id });
    await log(conn, { entity: 'PO', entityId: po.id, docNo: po.doc_no,
      action: 'Sent to the GM', user: req.user });
  });
  res.json({ ok: true, status: 'SUBMITTED' });
}));

router.post('/:id/decide',
  validate(z.object({
    action: z.enum(['APPROVED', 'RETURNED']),
    note: z.string().trim().max(500).optional(),
  })),
  wrap(async (req, res) => {
    const po = await one(`SELECT * FROM purchase_orders WHERE id = ?`, [req.params.id]);
    if (!po) throw notFound('No such purchase order');
    if (po.status !== 'SUBMITTED') {
      throw conflict(`This order is ${po.status.toLowerCase()}, not waiting for a signature`);
    }
    // sending it back without saying why leaves the buyer guessing
    if (req.body.action === 'RETURNED' && (req.body.note || '').trim().length < 5) {
      throw badRequest('Say why it is going back');
    }
    // an order is signed twice — the GM, then Management — and only
    // the second signature lets it go to the supplier
    let step;
    await tx(async (conn) => {
      step = await chain.decide(conn, { docType: 'PO', docId: po.id,
        action: req.body.action, userId: req.user?.id, note: req.body.note });
      const status = req.body.action === 'RETURNED' ? 'RETURNED'
        : step.done ? 'APPROVED' : 'SUBMITTED';
      await run(
        `UPDATE purchase_orders
            SET status = ?, decided_at = ?, decided_by = ? WHERE id = ?`,
        [status, step.done || req.body.action === 'RETURNED' ? new Date() : null,
          step.done ? req.user?.id || null : po.decided_by, po.id], conn
      );
      const event = req.body.action === 'RETURNED' ? 'RETURNED'
        : step.done ? 'APPROVED' : 'GM_APPROVED';
      await run(`INSERT INTO po_events (po_id, action, user_id, note) VALUES (?, ?, ?, ?)`,
        [po.id, event, req.user?.id || null, req.body.note || null], conn);
      await log(conn, { entity: 'PO', entityId: po.id, docNo: po.doc_no,
        action: event === 'APPROVED' ? 'Approved'
          : event === 'GM_APPROVED' ? 'Signed by the GM' : 'Returned',
        detail: req.body.note, user: req.user });
    });
    res.json({
      ok: true,
      status: req.body.action === 'RETURNED' ? 'RETURNED'
        : step.done ? 'APPROVED' : 'SUBMITTED',
      level: step.level, levels: step.levels, done: step.done,
      message: req.body.action === 'RETURNED'
        ? `${po.doc_no} is back with the buyer`
        : step.done
          ? `${po.doc_no} is signed and can go to the supplier`
          : `${po.doc_no} is signed by the GM and now waits for Management`,
    });
  })
);

/** Edit while it is the buyer's: a draft, or one sent back. */
router.put('/:id', validate(editBody), wrap(async (req, res) => {
  const po = await one(`SELECT * FROM purchase_orders WHERE id = ?`, [req.params.id]);
  if (!po) throw notFound('No such purchase order');
  if (!EDITABLE.includes(po.status)) {
    throw conflict(`This order is ${po.status.toLowerCase()} and cannot be edited`);
  }
  const b = req.body;
  await tx(async (conn) => {
    await run(
      `UPDATE purchase_orders SET supplier_id = COALESCE(?, supplier_id),
              deliver_to_id = COALESCE(?, deliver_to_id), po_date = COALESCE(?, po_date),
              expected_date = COALESCE(?, expected_date), notes = COALESCE(?, notes)
        WHERE id = ?`,
      [b.supplierId ?? null, b.deliverToId ?? null, b.poDate ?? null,
       b.expectedDate ?? null, b.notes ?? null, po.id], conn
    );
    if (b.lines) {
      const ids = (await many(
        `SELECT indent_id FROM purchase_order_indents WHERE po_id = ?`, [po.id], conn))
        .map((r) => r.indent_id);
      await run(`DELETE FROM purchase_order_lines WHERE po_id = ?`, [po.id], conn);
      await writeLines(conn, po.id, ids, b.lines, po.id);
    }
    await run(`INSERT INTO po_events (po_id, action, user_id) VALUES (?, 'EDITED', ?)`,
      [po.id, req.user?.id || null], conn);
    await log(conn, { entity: 'PO', entityId: po.id, docNo: po.doc_no,
      action: 'Edited', user: req.user });
  });
  res.json({ ok: true });
}));

router.delete('/:id', wrap(async (req, res) => {
  const po = await one(`SELECT * FROM purchase_orders WHERE id = ?`, [req.params.id]);
  if (!po) throw notFound('No such purchase order');
  if (po.status !== 'DRAFT') throw conflict('Only a draft can be deleted');
  await run(`DELETE FROM purchase_orders WHERE id = ?`, [po.id]);
  res.json({ ok: true });
}));

router.post('/:id/cancel',
  validate(z.object({ note: z.string().trim().min(5).max(300) })),
  wrap(async (req, res) => {
    const po = await one(`SELECT * FROM purchase_orders WHERE id = ?`, [req.params.id]);
    if (!po) throw notFound('No such purchase order');
    if (po.status === 'CANCELLED') throw conflict('Already cancelled');
    const got = await one(
      `SELECT COALESCE(SUM(received_qty), 0) AS n FROM v_po_line_status WHERE po_id = ?`, [po.id]);
    if (Number(got.n) > 0) throw conflict('Something has already been received against this order');
    await tx(async (conn) => {
      await run(`UPDATE purchase_orders SET status = 'CANCELLED', closed_note = ? WHERE id = ?`,
        [req.body.note, po.id], conn);
      await run(`INSERT INTO po_events (po_id, action, user_id, note) VALUES (?, 'CANCELLED', ?, ?)`,
        [po.id, req.user?.id || null, req.body.note], conn);
      await log(conn, { entity: 'PO', entityId: po.id, docNo: po.doc_no,
        action: 'Cancelled', detail: req.body.note, user: req.user });
    });
    res.json({ ok: true, status: 'CANCELLED' });
  })
);

/* ---------------------------------------------------------- receipt */
/** What is still owed on this order, for whoever is unloading it. */
router.get('/:id/pending', wrap(async (req, res) => {
  const po = await one(`SELECT * FROM v_po_status WHERE po_id = ?`, [req.params.id]);
  if (!po) throw notFound('No such purchase order');
  const lines = await many(
    `SELECT * FROM v_po_line_status WHERE po_id = ? AND pending_qty > 0 ORDER BY item_name`, [po.po_id]);
  res.json({ poId: po.po_id, docNo: po.doc_no, receivedAt: po.deliver_to_id,
    receivedAtName: po.deliver_to_name, supplier: po.supplier_name, lines });
}));

router.post('/:id/receipts',
  validate(z.object({
    receiptDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    supplierDc: z.string().trim().max(64).optional(),
    note: z.string().trim().max(400).optional(),
    confirm: z.boolean().default(true),
    // where the caller believes it is standing — an order is signed for
    // by the place it was sent to, and nobody else
    atSiteId: z.coerce.number().int().positive().optional(),
    lines: z.array(z.object({
      poLineId: z.coerce.number().int().positive(),
      qty: z.coerce.number().positive(),
      remark: z.string().trim().max(300).optional(),
    })).min(1).max(300),
  })),
  wrap(async (req, res) => {
    const po = await one(`SELECT * FROM purchase_orders WHERE id = ?`, [req.params.id]);
    if (!po) throw notFound('No such purchase order');
    if (po.status !== 'APPROVED') {
      throw conflict(po.status === 'SUBMITTED'
        ? 'This order has not been signed yet'
        : `This order is ${po.status.toLowerCase()}`);
    }
    // A delivery is signed for where it was sent. One store cannot take
    // in another store's order, however convenient that would be — the
    // stock would land on the wrong shelf and the PRN would be answered
    // from a place the material never reached.
    if (req.body.atSiteId && req.body.atSiteId !== po.deliver_to_id) {
      const want = await one(`SELECT name FROM sites WHERE id = ?`, [po.deliver_to_id]);
      const here = await one(`SELECT name FROM sites WHERE id = ?`, [req.body.atSiteId]);
      throw conflict(
        `${po.doc_no} was sent to ${want.name}, so ${here ? here.name : 'this place'} `
        + `cannot sign for it.`,
        { deliverToId: po.deliver_to_id, deliverToName: want.name }
      );
    }

    const out = await tx(async (conn) => {
      const docNo = await nextDocNo(conn, 'GRN', req.body.receiptDate);
      const grn = await run(
        `INSERT INTO goods_receipts (doc_no, po_id, received_at, receipt_date, supplier_dc,
                                     status, note, received_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [docNo, po.id, po.deliver_to_id, req.body.receiptDate, req.body.supplierDc || null,
         req.body.confirm ? 'CONFIRMED' : 'DRAFT', req.body.note || null, req.user?.id || null], conn
      );

      for (const l of req.body.lines) {
        const st = await one(
          `SELECT l.*, pol.uom_id FROM v_po_line_status l
             JOIN purchase_order_lines pol ON pol.id = l.po_line_id
            WHERE l.po_line_id = ? AND l.po_id = ?`, [l.poLineId, po.id], conn);
        if (!st) throw badRequest('One of those lines is not on this order');
        if (l.qty > Number(st.pending_qty) + 0.0005) {
          throw conflict(
            `${st.item_code} — ${st.item_name}: ${st.pending_qty} is still owed, `
            + `so ${l.qty} cannot be received.`,
            { poLineId: l.poLineId, available: Number(st.pending_qty) }
          );
        }
        await run(
          `INSERT INTO goods_receipt_lines (grn_id, po_line_id, qty, remark) VALUES (?, ?, ?, ?)`,
          [grn.insertId, l.poLineId, l.qty, l.remark || null], conn
        );
        // a confirmed receipt is what puts it on the shelf
        if (req.body.confirm) {
          await run(
            `INSERT INTO stock_movements (site_id, item_id, make_id, qty, rate, kind,
                                          ref_type, ref_id, ref_no, moved_on, created_by)
             VALUES (?, ?, ?, ?, ?, 'GRN', 'GRN', ?, ?, ?, ?)`,
            [po.deliver_to_id, st.item_id, st.make_id, l.qty, st.rate,
             grn.insertId, docNo, req.body.receiptDate, req.user?.id || null], conn
          );
        }
      }

      await log(conn, {
        entity: 'GRN', entityId: grn.insertId, docNo,
        action: req.body.confirm ? 'Received' : 'Drafted',
        detail: `against ${po.doc_no} · ${req.body.lines.length} line(s)`, user: req.user,
      });
      return { id: grn.insertId, docNo };
    });

    const v = await one(`SELECT * FROM v_po_status WHERE po_id = ?`, [po.id]);
    res.status(201).json({ ...out, poState: v.receipt_state, pendingQty: v.pending_qty });
  })
);

module.exports = router;
