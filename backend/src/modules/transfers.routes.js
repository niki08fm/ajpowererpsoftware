'use strict';
const router = require('express').Router();
const { z } = require('zod');
const { many, one, run, tx } = require('../config/db');
const { validate, wrap } = require('../middleware/validate');
const { nextDocNo } = require('../lib/docNo');
const { log } = require('../lib/audit');
const { badRequest, conflict, notFound } = require('../lib/errors');

/**
 * Sourcing a PRN from another site.
 *
 * The central store is the only party that raises one of these. Sites
 * do not trade with each other directly — the store decides what
 * moves, because the store is what knows where everything is.
 *
 * The request names a site to send, a site to receive, and the PRN
 * being answered. The sending site accepts, then writes an ordinary
 * delivery challan; the receiving site signs for it the way it signs
 * for anything, because from where it stands its PRN has simply
 * arrived.
 *
 * The sending site is then short of material it indented for its own
 * work, and reorders it here. That reorder is a real PRN on the store
 * and will be fulfilled like any other — but it is marked REPLACEMENT,
 * and the two views that answer "how much has this BOQ indented"
 * cannot see it. Site A already indented that cable once; counting it
 * twice would overstate the BOQ and double what A may invoice.
 */

const round3 = (n) => Math.round(Number(n) * 1000) / 1000;

const shape = (r) => ({
  id: r.tr_id, docNo: r.doc_no, status: r.status, state: r.state,
  from: { id: r.from_site_id, name: r.from_name, code: r.from_code },
  to: { id: r.to_site_id, name: r.to_name, code: r.to_code },
  indent: { id: r.indent_id, docNo: r.indent_no, neededBy: r.indent_needed_by },
  requestDate: r.request_date, neededBy: r.needed_by, note: r.note,
  lineCount: Number(r.line_count),
  requestedQty: Number(r.requested_qty),
  sentQty: Number(r.sent_qty),
  ackedQty: Number(r.acked_qty),
  pendingQty: Number(r.pending_qty),
  daysLate: Number(r.days_late),
  decidedAt: r.decided_at, decideNote: r.decide_note,
  decidedBy: r.decided_by_name, raisedBy: r.raised_by_name,
});

/* ==================================================== the store asks */
router.post('/',
  validate(z.object({
    storeId: z.coerce.number().int().positive(),
    fromSiteId: z.coerce.number().int().positive(),
    indentId: z.coerce.number().int().positive(),
    requestDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    neededBy: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
    note: z.string().trim().max(400).optional(),
    lines: z.array(z.object({
      itemId: z.coerce.number().int().positive(),
      makeId: z.coerce.number().int().positive().nullable().optional(),
      qty: z.coerce.number().positive(),
      remark: z.string().trim().max(300).optional(),
    })).min(1).max(200),
  })),
  wrap(async (req, res) => {
    const b = req.body;
    const store = await one(
      `SELECT * FROM sites WHERE id = ? AND site_type = 'STORE'`, [b.storeId]);
    if (!store) throw badRequest('Only the central store raises a transfer request');

    const indent = await one(
      `SELECT i.*, s.name AS site_name FROM indents i JOIN sites s ON s.id = i.site_id
        WHERE i.id = ?`, [b.indentId]);
    if (!indent) throw notFound('No such PRN');
    if (indent.status !== 'APPROVED') throw conflict(`${indent.doc_no} is not approved`);

    const from = await one(
      `SELECT * FROM sites WHERE id = ? AND site_type = 'SITE'`, [b.fromSiteId]);
    if (!from) throw badRequest('The site being asked does not exist, or is a store');
    if (from.id === indent.site_id) throw badRequest('That PRN belongs to the site being asked');
    if (from.branch_id !== indent.branch_id) throw badRequest('Those are in different branches');

    // What is being asked for has to be there. The challan checks this
    // again on the way out, but finding out at dispatch that the
    // material was never there wastes everybody's week.
    for (const l of b.lines) {
      const st = await one(
        `SELECT qty FROM v_stock_balance WHERE site_id = ? AND item_id = ?`,
        [from.id, l.itemId]);
      const held = Number(st?.qty || 0);
      if (Number(l.qty) > held + 0.0005) {
        const it = await one(`SELECT code, name FROM items WHERE id = ?`, [l.itemId]);
        throw conflict(
          `${it.code} — ${it.name}: ${from.name} holds ${round3(held)}, `
          + `so ${round3(l.qty)} cannot be asked for.`,
          { itemId: l.itemId, available: Math.max(held, 0) }
        );
      }
    }

    const out = await tx(async (conn) => {
      const docNo = await nextDocNo(conn, 'TR', b.requestDate);
      const r = await run(
        `INSERT INTO transfer_requests
           (doc_no, branch_id, store_id, from_site_id, to_site_id, indent_id,
            request_date, needed_by, status, note, raised_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'SUBMITTED', ?, ?)`,
        [docNo, indent.branch_id, store.id, from.id, indent.site_id, indent.id,
         b.requestDate, b.neededBy || indent.needed_by || null, b.note || null,
         req.user?.id || null], conn);

      const byItem = new Map();
      for (const l of b.lines) {
        const key = `${l.itemId}:${l.makeId || 0}`;
        const at = byItem.get(key)
          || { itemId: l.itemId, makeId: l.makeId || null, qty: 0, remark: l.remark || null };
        at.qty = round3(at.qty + Number(l.qty));
        byItem.set(key, at);
      }
      for (const l of byItem.values()) {
        const item = await one(`SELECT uom_id FROM items WHERE id = ?`, [l.itemId], conn);
        if (!item) throw badRequest('One of those items is not in the master');
        await run(
          `INSERT INTO transfer_request_lines (tr_id, item_id, make_id, uom_id, qty, remark)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [r.insertId, l.itemId, l.makeId, item.uom_id, l.qty, l.remark || null], conn);
      }
      await run(`INSERT INTO tr_events (tr_id, action, user_id) VALUES (?, 'RAISED', ?)`,
        [r.insertId, req.user?.id || null], conn);
      await log(conn, { entity: 'TR', entityId: r.insertId, docNo, action: 'Raised',
        detail: `${from.name} to send to ${indent.site_name} against ${indent.doc_no}`,
        user: req.user });
      return { id: r.insertId, docNo };
    });

    res.status(201).json(shape(await one(`SELECT * FROM v_tr_status WHERE tr_id = ?`, [out.id])));
  })
);

/**
 * What a PRN still wants, item by item, and which sites are holding it.
 *
 * The store is standing at a PRN it cannot fill and asking who can, so
 * the answer has to be both halves at once: what is outstanding, and
 * where in the branch it actually is.
 */
router.get('/prn/:indentId/outstanding', wrap(async (req, res) => {
  const ind = await one(
    `SELECT i.id, i.doc_no, i.site_id, i.branch_id, i.needed_by, i.status,
            s.name AS site_name
       FROM indents i JOIN sites s ON s.id = i.site_id WHERE i.id = ?`, [req.params.indentId]);
  if (!ind) throw notFound('No such PRN');

  const lines = await many(
    `SELECT f.item_id, f.item_code, f.item_name, f.uom, f.make_id, f.make_name,
            f.indented_qty, f.to_deliver_qty
       FROM v_indent_item_flow f
      WHERE f.indent_id = ? AND f.to_deliver_qty > 0.0005
      ORDER BY f.item_name`, [ind.id]);

  // every other site in the branch holding any of it
  const holders = lines.length ? await many(
    `SELECT b.site_id, s.name AS site_name, s.code AS site_code, b.item_id, b.qty
       FROM v_stock_balance b
       JOIN sites s ON s.id = b.site_id
      WHERE s.branch_id = ? AND s.site_type = 'SITE' AND s.id <> ?
        AND b.qty > 0.0005 AND b.item_id IN (${lines.map(() => '?').join(',')})
      ORDER BY s.name`, [ind.branch_id, ind.site_id, ...lines.map((l) => l.item_id)]) : [];

  res.json({
    prn: {
      id: ind.id, docNo: ind.doc_no, status: ind.status,
      site: { id: ind.site_id, name: ind.site_name }, neededBy: ind.needed_by,
    },
    lines: lines.map((l) => ({
      itemId: l.item_id, itemCode: l.item_code, itemName: l.item_name, uom: l.uom,
      makeId: l.make_id, make: l.make_name,
      indentedQty: Number(l.indented_qty), toDeliverQty: Number(l.to_deliver_qty),
    })),
    holders: holders.map((h) => ({
      siteId: h.site_id, siteName: h.site_name, siteCode: h.site_code,
      itemId: h.item_id, qty: Number(h.qty),
    })),
  });
}));

/* -------------------------------------------- the sending site answers */
router.post('/:id/decide',
  validate(z.object({
    action: z.enum(['ACCEPTED', 'REJECTED']),
    note: z.string().trim().max(400).optional(),
  })),
  wrap(async (req, res) => {
    const r = await one(`SELECT * FROM transfer_requests WHERE id = ?`, [req.params.id]);
    if (!r) throw notFound('No such request');
    if (r.status !== 'SUBMITTED') {
      throw conflict(`This request is ${r.status.toLowerCase()}, not waiting for an answer`);
    }
    if (req.body.action === 'REJECTED' && !req.body.note) {
      throw badRequest('Say why — the store has to find the material somewhere else');
    }
    await tx(async (conn) => {
      await run(
        `UPDATE transfer_requests SET status = ?, decided_at = NOW(), decided_by = ?,
                decide_note = ? WHERE id = ?`,
        [req.body.action, req.user?.id || null, req.body.note || null, r.id], conn);
      await run(`INSERT INTO tr_events (tr_id, action, user_id, note) VALUES (?, ?, ?, ?)`,
        [r.id, req.body.action, req.user?.id || null, req.body.note || null], conn);
      await log(conn, { entity: 'TR', entityId: r.id, docNo: r.doc_no,
        action: req.body.action === 'ACCEPTED' ? 'Accepted' : 'Refused',
        detail: req.body.note, user: req.user });
    });
    res.json(shape(await one(`SELECT * FROM v_tr_status WHERE tr_id = ?`, [r.id])));
  })
);

router.post('/:id/cancel', wrap(async (req, res) => {
  const r = await one(`SELECT * FROM transfer_requests WHERE id = ?`, [req.params.id]);
  if (!r) throw notFound('No such request');
  if (['CANCELLED', 'REJECTED'].includes(r.status)) throw conflict('That is already closed');
  const sent = await one(`SELECT COALESCE(SUM(qty), 0) AS q FROM dc_line_trs WHERE tr_id = ?`, [r.id]);
  if (Number(sent.q) > 0.0005) {
    throw conflict('Material has already gone against this request, so it cannot be cancelled');
  }
  await tx(async (conn) => {
    await run(`UPDATE transfer_requests SET status = 'CANCELLED' WHERE id = ?`, [r.id], conn);
    await run(`INSERT INTO tr_events (tr_id, action, user_id) VALUES (?, 'CANCELLED', ?)`,
      [r.id, req.user?.id || null], conn);
    await log(conn, { entity: 'TR', entityId: r.id, docNo: r.doc_no, action: 'Cancelled', user: req.user });
  });
  res.json({ ok: true });
}));

/* ------------------------------------------------------------- read */
router.get('/',
  validate(z.object({
    branchId: z.coerce.number().int().positive().optional(),
    fromSiteId: z.coerce.number().int().positive().optional(),
    toSiteId: z.coerce.number().int().positive().optional(),
    storeId: z.coerce.number().int().positive().optional(),
    state: z.string().trim().max(20).optional(),
    show: z.enum(['OPEN', 'ALL']).default('OPEN'),
  }), 'query'),
  wrap(async (req, res) => {
    const where = [];
    const params = [];
    for (const [k, col] of [['branchId', 'branch_id'], ['fromSiteId', 'from_site_id'],
      ['toSiteId', 'to_site_id'], ['storeId', 'store_id'], ['state', 'state']]) {
      if (req.query[k]) { where.push(`v.${col} = ?`); params.push(req.query[k]); }
    }
    if (req.query.show === 'OPEN') {
      where.push(`v.state NOT IN ('COMPLETE', 'REJECTED', 'CANCELLED')`);
    }
    const rows = await many(
      `SELECT * FROM v_tr_status v ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
        ORDER BY FIELD(v.state, 'AWAITING', 'TO_SEND', 'PART_SENT', 'IN_TRANSIT',
                       'COMPLETE', 'REJECTED', 'CANCELLED'),
                 v.needed_by IS NULL, v.needed_by, v.request_date DESC`, params);
    res.json({
      rows: rows.map(shape),
      totals: {
        awaiting: rows.filter((r) => r.state === 'AWAITING').length,
        toSend: rows.filter((r) => ['TO_SEND', 'PART_SENT'].includes(r.state)).length,
        inTransit: rows.filter((r) => r.state === 'IN_TRANSIT').length,
        late: rows.filter((r) => Number(r.days_late) > 0).length,
      },
    });
  })
);

router.get('/:id', wrap(async (req, res) => {
  const v = await one(`SELECT * FROM v_tr_status WHERE tr_id = ?`, [req.params.id]);
  if (!v) throw notFound('No such request');
  const [lines, events, challans] = await Promise.all([
    many(
      `SELECT l.*, COALESCE(b.qty, 0) AS held_qty
         FROM v_tr_line_status l
         LEFT JOIN v_stock_balance b ON b.item_id = l.item_id AND b.site_id = ?
        WHERE l.tr_id = ? ORDER BY l.item_name`, [v.from_site_id, v.tr_id]),
    many(
      `SELECT e.action, e.note, e.created_at, u.name AS by_name
         FROM tr_events e LEFT JOIN users u ON u.id = e.user_id
        WHERE e.tr_id = ? ORDER BY e.id`, [v.tr_id]),
    many(
      `SELECT DISTINCT dc.id AS dc_id, dc.doc_no, dc.dc_date, s.state,
              s.sent_qty, s.acked_qty, s.in_transit_qty
         FROM dc_line_trs dt
         JOIN delivery_challan_lines dl ON dl.id = dt.dc_line_id
         JOIN delivery_challans dc      ON dc.id = dl.dc_id
         JOIN v_dc_status s             ON s.dc_id = dc.id
        WHERE dt.tr_id = ? ORDER BY dc.dc_date DESC`, [v.tr_id]),
  ]);
  res.json({
    ...shape(v),
    lines: lines.map((l) => ({
      lineId: l.tr_line_id, itemId: l.item_id, itemCode: l.item_code, itemName: l.item_name,
      uom: l.uom, make: l.make_name,
      requestedQty: Number(l.requested_qty), sentQty: Number(l.sent_qty),
      ackedQty: Number(l.acked_qty), pendingQty: Number(l.pending_qty),
      heldQty: Number(l.held_qty), remark: l.remark,
      shortBy: Math.max(0, Number(l.pending_qty) - Number(l.held_qty)),
    })),
    events, challans,
  });
}));

/* ==================================================================
 *  The sending site's history — every transfer challan it has written,
 *  document by document, and what the far end actually signed for.
 * ================================================================== */
router.get('/site/:siteId/history', wrap(async (req, res) => {
  const site = await one(`SELECT id, code, name FROM sites WHERE id = ?`, [req.params.siteId]);
  if (!site) throw notFound('No such site');

  const docs = await many(
    `SELECT dc.id AS dc_id, dc.doc_no, dc.dc_date, dc.vehicle_no,
            s.state, s.to_site_id, s.to_name,
            SUM(dt.qty) AS sent_qty,
            SUM(CASE WHEN dl.qty > 0 THEN dls.acked_qty * (dt.qty / dl.qty) ELSE 0 END) AS acked_qty,
            SUM(CASE WHEN dl.qty > 0 THEN dls.in_transit_qty * (dt.qty / dl.qty) ELSE 0 END) AS in_transit_qty,
            COUNT(DISTINCT dl.id) AS line_count,
            GROUP_CONCAT(DISTINCT tr.doc_no ORDER BY tr.doc_no SEPARATOR ', ') AS requests,
            GROUP_CONCAT(DISTINCT i.doc_no ORDER BY i.doc_no SEPARATOR ', ') AS prns
       FROM dc_line_trs dt
       JOIN delivery_challan_lines dl ON dl.id = dt.dc_line_id
       JOIN delivery_challans dc      ON dc.id = dl.dc_id
       JOIN v_dc_status s             ON s.dc_id = dc.id
       JOIN v_dc_line_status dls      ON dls.dc_line_id = dl.id
       JOIN transfer_requests tr      ON tr.id = dt.tr_id
       JOIN indents i                 ON i.id = tr.indent_id
      WHERE dc.from_site_id = ? AND dc.status <> 'CANCELLED'
      GROUP BY dc.id ORDER BY dc.dc_date DESC, dc.id DESC`, [site.id]);

  const items = docs.length ? await many(
    `SELECT dl.dc_id, it.code AS item_code, it.name AS item_name, u.code AS uom,
            dt.qty AS sent_qty,
            CASE WHEN dl.qty > 0 THEN ROUND(dls.acked_qty * (dt.qty / dl.qty), 3) ELSE 0 END AS acked_qty
       FROM dc_line_trs dt
       JOIN delivery_challan_lines dl ON dl.id = dt.dc_line_id
       JOIN v_dc_line_status dls      ON dls.dc_line_id = dl.id
       JOIN items it ON it.id = dl.item_id
       JOIN uoms u   ON u.id  = it.uom_id
      WHERE dl.dc_id IN (${docs.map(() => '?').join(',')})
      ORDER BY it.name`, docs.map((d) => d.dc_id)) : [];

  const byDoc = new Map(docs.map((d) => [d.dc_id, []]));
  for (const i of items) byDoc.get(i.dc_id)?.push({
    itemCode: i.item_code, itemName: i.item_name, uom: i.uom,
    sentQty: Number(i.sent_qty), ackedQty: Number(i.acked_qty),
  });

  res.json({
    site,
    docs: docs.map((d) => ({
      dcId: d.dc_id, docNo: d.doc_no, date: d.dc_date, vehicleNo: d.vehicle_no,
      state: d.state, to: { id: d.to_site_id, name: d.to_name },
      requests: d.requests, prns: d.prns,
      lineCount: Number(d.line_count),
      sentQty: Number(d.sent_qty), ackedQty: Number(d.acked_qty),
      inTransitQty: Number(d.in_transit_qty),
      items: byDoc.get(d.dc_id) || [],
    })),
    totals: {
      challans: docs.length,
      sent: docs.reduce((t, d) => t + Number(d.sent_qty), 0),
      acked: docs.reduce((t, d) => t + Number(d.acked_qty), 0),
    },
  });
}));

/* ==================================================================
 *  Reorder issued stock
 *
 *  What this site has lent out, what it has already asked back, and
 *  what is left to ask for. The cap is what was lent: a site cannot
 *  reorder more than it gave away, because past that point it is not
 *  replacing anything, it is indenting — and indenting has a form of
 *  its own that counts against the BOQ.
 * ================================================================== */
router.get('/site/:siteId/lent-out',
  validate(z.object({ show: z.enum(['TO_REORDER', 'ALL']).default('TO_REORDER') }), 'query'),
  wrap(async (req, res) => {
    const site = await one(`SELECT id, code, name FROM sites WHERE id = ?`, [req.params.siteId]);
    if (!site) throw notFound('No such site');
    const where = ['v.site_id = ?'];
    const params = [site.id];
    if (req.query.show === 'TO_REORDER') where.push('v.to_reorder_qty > 0.0005');

    const rows = await many(
      `SELECT v.*, COALESCE(b.qty, 0) AS on_shelf_qty
         FROM v_site_lent_out v
         LEFT JOIN v_stock_balance b ON b.item_id = v.item_id AND b.site_id = v.site_id
        WHERE ${where.join(' AND ')} ORDER BY v.item_name`, params);

    res.json({
      site,
      rows: rows.map((r) => ({
        itemId: r.item_id, itemCode: r.item_code, itemName: r.item_name, uom: r.uom,
        lentQty: Number(r.lent_qty),
        reorderedQty: Number(r.reordered_qty),
        toReorderQty: Number(r.to_reorder_qty),
        onShelfQty: Number(r.on_shelf_qty),
        challans: Number(r.challan_count), lastSentOn: r.last_sent_on,
      })),
      totals: {
        items: rows.length,
        lent: rows.reduce((t, r) => t + Number(r.lent_qty), 0),
        reordered: rows.reduce((t, r) => t + Number(r.reordered_qty), 0),
        toReorder: rows.reduce((t, r) => t + Number(r.to_reorder_qty), 0),
      },
    });
  })
);

/**
 * Raise the replacement PRN.
 *
 * An ordinary PRN as far as the store and the buyer are concerned —
 * it appears on the PRNs to fulfil, it is bought against, it is
 * challaned out. The one thing it is not is a new claim on the work
 * order, which is what kind = REPLACEMENT buys.
 */
router.post('/site/:siteId/reorder',
  validate(z.object({
    indentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    neededBy: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
    send: z.boolean().default(true),
    lines: z.array(z.object({
      itemId: z.coerce.number().int().positive(),
      qty: z.coerce.number().positive(),
    })).min(1).max(200),
  })),
  wrap(async (req, res) => {
    const siteId = Number(req.params.siteId);
    const site = await one(`SELECT * FROM sites WHERE id = ? AND site_type = 'SITE'`, [siteId]);
    if (!site) throw notFound('No such site');

    const boq = await one(
      `SELECT id FROM boqs WHERE site_id = ? AND status = 'LOCKED' ORDER BY id DESC LIMIT 1`,
      [siteId]);
    if (!boq) throw conflict('This site has no locked BOQ, so nothing can be raised against it');

    const lent = await many(`SELECT * FROM v_site_lent_out WHERE site_id = ?`, [siteId]);
    const room = (itemId) => Number(
      (lent.find((l) => l.item_id === itemId) || {}).to_reorder_qty || 0);

    // a replacement line still has to name a BOQ line, because every
    // indent line does. It is the site's own BOQ line for that item —
    // the one it originally indented against and then lent away.
    const boqLines = await many(
      `SELECT id, item_id FROM boq_lines WHERE boq_id = ? ORDER BY sno`, [boq.id]);

    for (const l of req.body.lines) {
      const it = await one(`SELECT code, name FROM items WHERE id = ?`, [l.itemId]);
      if (!it) throw badRequest('One of those items is not in the master');
      const left = room(l.itemId);
      if (Number(l.qty) > left + 0.0005) {
        throw conflict(
          `${it.code} — ${it.name}: ${round3(left)} is left to reorder, `
          + `so ${round3(l.qty)} is more than was lent out.`,
          { itemId: l.itemId, available: Math.max(left, 0) }
        );
      }
      if (!boqLines.some((b) => b.item_id === l.itemId)) {
        throw conflict(
          `${it.code} — ${it.name} is not on this site's BOQ, so there is nothing to replace it against`,
          { itemId: l.itemId }
        );
      }
    }

    const out = await tx(async (conn) => {
      const docNo = await nextDocNo(conn, 'IND', req.body.indentDate);
      const r = await run(
        `INSERT INTO indents (doc_no, site_id, branch_id, boq_id, kind, indent_date,
                              needed_by, status, raised_by)
         VALUES (?, ?, ?, ?, 'REPLACEMENT', ?, ?, ?, ?)`,
        [docNo, siteId, site.branch_id, boq.id, req.body.indentDate,
         req.body.neededBy || null, req.body.send ? 'SUBMITTED' : 'DRAFT',
         req.user?.id || null], conn);

      for (const l of req.body.lines) {
        const bl = boqLines.find((b) => b.item_id === l.itemId);
        await run(
          `INSERT INTO indent_lines (indent_id, boq_line_id, item_id, qty)
           VALUES (?, ?, ?, ?)`,
          [r.insertId, bl.id, l.itemId, round3(l.qty)], conn);
      }
      if (req.body.send) {
        await run(`INSERT INTO indent_events (indent_id, action, user_id, note) VALUES (?, 'SUBMITTED', ?, ?)`,
          [r.insertId, req.user?.id || null, 'Replacing material lent to another site'], conn);
      }
      await log(conn, { entity: 'INDENT', entityId: r.insertId, docNo,
        action: 'Raised to replace lent stock',
        detail: `${req.body.lines.length} item(s) — does not count against the BOQ`,
        user: req.user });
      return { id: r.insertId, docNo };
    });

    res.status(201).json({ ...out, kind: 'REPLACEMENT', siteId });
  })
);

module.exports = router;
