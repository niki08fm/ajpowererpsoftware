'use strict';
const router = require('express').Router();
const { z } = require('zod');
const { many, one, run, tx } = require('../config/db');
const { validate, wrap } = require('../middleware/validate');
const { nextDocNo } = require('../lib/docNo');
const { log } = require('../lib/audit');
const { conflict, notFound, badRequest } = require('../lib/errors');

/**
 * The BOQ. Each work order line prepared as items from the master.
 *
 *   BOQ qty = item qty x the work order line quantity  (calculated)
 *   Est qty = what Planning expects to procure          (typed)
 *
 * It cannot be submitted until every work order line is prepared, and
 * until it is submitted it saves as a draft. Submitting asks one
 * question — may the site indent past the estimate, and by how much —
 * and that answer governs every indent raised afterwards.
 */

/** 0 -> a, 25 -> z, 26 -> aa. Sub-line numbering under a work order line. */
function suffix(i) {
  let s = '';
  let n = i + 1;
  while (n > 0) { s = String.fromCharCode(97 + ((n - 1) % 26)) + s; n = Math.floor((n - 1) / 26); }
  return s;
}
const round3 = (n) => Math.round(Number(n) * 1000) / 1000;

async function loadBoq(boqId) {
  const boq = await one(
    `SELECT b.*, s.name AS site_name, s.code AS site_code, c.name AS client_name,
            wo.doc_no AS wo_doc_no, wo.client_wo_no, v.state, v.prepared_count,
            v.wo_line_count, v.over_line_count, v.worst_over_pct
       FROM boqs b
       JOIN sites s ON s.id = b.site_id
       LEFT JOIN clients c ON c.id = s.client_id
       JOIN work_orders wo ON wo.id = b.work_order_id
       LEFT JOIN v_boq_status v ON v.boq_id = b.id
      WHERE b.id = ?`, [boqId]
  );
  if (!boq) throw notFound('No such BOQ');
  return boq;
}

/* ------------------------------------------------------------- list */
router.get('/',
  validate(z.object({ branchId: z.coerce.number().int().positive().optional() }), 'query'),
  wrap(async (req, res) => {
  const bId = req.query.branchId;
  const rows = await many(
    `SELECT b.id, b.doc_no, b.status, b.over_allow, b.over_pct, b.created_at, b.amended_on,
            s.id AS site_id, s.name AS site_name, wo.doc_no AS wo_doc_no, wo.client_wo_no,
            v.state, v.prepared_count, v.wo_line_count, v.over_line_count, v.worst_over_pct,
            (SELECT COUNT(*) FROM boq_lines bl WHERE bl.boq_id = b.id) AS line_count
       FROM boqs b
       JOIN sites s ON s.id = b.site_id
       JOIN work_orders wo ON wo.id = b.work_order_id
       LEFT JOIN v_boq_status v ON v.boq_id = b.id
      ${bId ? 'WHERE b.branch_id = ?' : ''} ORDER BY b.created_at DESC`,
    bId ? [bId] : []
  );
  // work orders with no BOQ yet: nothing can be indented against these
  const waiting = await many(
    `SELECT wo.id AS work_order_id, wo.doc_no, wo.client_wo_no,
            s.id AS site_id, s.name AS site_name, v.line_count, v.wo_value
       FROM work_orders wo
       JOIN sites s ON s.id = wo.site_id
       LEFT JOIN v_work_order_value v ON v.work_order_id = wo.id
       LEFT JOIN boqs b ON b.work_order_id = wo.id
      WHERE b.id IS NULL ${bId ? 'AND wo.branch_id = ?' : ''} ORDER BY s.name`,
    bId ? [bId] : []
  );
  res.json({ boqs: rows, awaitingPreparation: waiting });
}));

/* ---------------------------------------------------------- prepare */
/** Open (or reopen) the draft for a work order. */
router.post('/prepare',
  validate(z.object({ workOrderId: z.coerce.number().int().positive() })),
  wrap(async (req, res) => {
    const wo = await one(
      `SELECT wo.*, s.name AS site_name FROM work_orders wo
         JOIN sites s ON s.id = wo.site_id
        WHERE wo.id = ?`, [req.body.workOrderId]
    );
    if (!wo) throw notFound('No such work order');
    const existing = await one(`SELECT id, doc_no, status FROM boqs WHERE work_order_id = ?`, [wo.id]);
    if (existing) {
      if (existing.status === 'LOCKED') throw conflict(`${existing.doc_no} is already locked`, { boqId: existing.id });
      return res.json({ boqId: existing.id, docNo: existing.doc_no, resumed: true });
    }
    const out = await tx(async (conn) => {
      const docNo = await nextDocNo(conn, 'BOQ');
      const r = await run(
        `INSERT INTO boqs (doc_no, site_id, branch_id, work_order_id, status, created_by)
         VALUES (?, ?, ?, ?, 'DRAFT', ?)`,
        [docNo, wo.site_id, wo.branch_id, wo.id, req.user?.id || null], conn
      );
      await log(conn, { entity: 'BOQ', entityId: r.insertId, docNo, action: 'Started', detail: wo.site_name, user: req.user });
      return { boqId: r.insertId, docNo, resumed: false };
    });
    res.status(201).json(out);
  })
);

/** The whole sheet: every work order line, with whatever is prepared under it. */
router.get('/:id', wrap(async (req, res) => {
  const boq = await loadBoq(req.params.id);
  const woLines = await many(
    `SELECT wol.id AS wo_line_id, wol.sno, wol.description, u.code AS uom, wol.qty,
            bwl.id AS boq_wo_line_id, COALESCE(bwl.est_qty, 0) AS est_qty
       FROM work_order_lines wol
       JOIN uoms u ON u.id = wol.uom_id
       LEFT JOIN boq_wo_lines bwl ON bwl.wo_line_id = wol.id AND bwl.boq_id = ?
      WHERE wol.work_order_id = ? ORDER BY wol.sno`,
    [boq.id, boq.work_order_id]
  );
  const lines = await many(`SELECT * FROM v_boq_line_status WHERE boq_id = ? ORDER BY sno`, [boq.id]);
  const byWo = new Map();
  for (const l of lines) {
    if (!byWo.has(l.wo_line_id)) byWo.set(l.wo_line_id, []);
    byWo.get(l.wo_line_id).push(l);
  }
  res.json({
    id: boq.id, docNo: boq.doc_no, status: boq.status, state: boq.state,
    site: { id: boq.site_id, name: boq.site_name, code: boq.site_code },
    client: boq.client_name, workOrder: { docNo: boq.wo_doc_no, clientWoNo: boq.client_wo_no },
    policy: { overAllow: !!boq.over_allow, overPct: boq.over_pct },
    prepared: boq.prepared_count, ofLines: boq.wo_line_count,
    remaining: (boq.wo_line_count || 0) - (boq.prepared_count || 0),
    overLines: boq.over_line_count, worstOverPct: boq.worst_over_pct,
    amendedOn: boq.amended_on,
    woLines: woLines.map((w) => ({ ...w, items: byWo.get(w.wo_line_id) || [] })),
  });
}));

/**
 * Save one work order line's preparation. Replaces whatever was there.
 * The whole line goes in one transaction: a half-saved line is worse
 * than an unsaved one.
 */
router.put('/:id/wo-line/:woLineId',
  validate(z.object({
    estQty: z.coerce.number().min(0),
    items: z.array(z.object({
      itemId: z.coerce.number().int().positive(),
      makeId: z.coerce.number().int().positive().nullable().optional(),
      itemQty: z.coerce.number().positive(),
      estQty: z.coerce.number().min(0).optional(),   // set only when typed over
    })).min(1).max(200),
  })),
  wrap(async (req, res) => {
    const boq = await loadBoq(req.params.id);
    if (boq.status === 'LOCKED') throw conflict('This BOQ is locked — change it through an amendment');
    const wol = await one(
      `SELECT * FROM work_order_lines WHERE id = ? AND work_order_id = ?`,
      [req.params.woLineId, boq.work_order_id]
    );
    if (!wol) throw notFound('That line is not on this work order');
    if (!(req.body.estQty > 0)) throw badRequest('Enter the estimated quantity on the work order line');

    const seen = new Set();
    for (const it of req.body.items) {
      if (seen.has(it.itemId)) throw badRequest('The same item is on this line twice — change its item quantity instead');
      seen.add(it.itemId);
    }

    await tx(async (conn) => {
      await run(
        `INSERT INTO boq_wo_lines (boq_id, wo_line_id, est_qty) VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE est_qty = VALUES(est_qty)`,
        [boq.id, wol.id, req.body.estQty], conn
      );
      const bwl = await one(`SELECT id FROM boq_wo_lines WHERE boq_id = ? AND wo_line_id = ?`,
        [boq.id, wol.id], conn);

      await run(`DELETE FROM boq_lines WHERE boq_wo_line_id = ?`, [bwl.id], conn);

      let i = 0;
      for (const it of req.body.items) {
        const item = await one(`SELECT id, uom_id FROM items WHERE id = ? AND status = 'ACTIVE'`, [it.itemId], conn);
        if (!item) throw badRequest('One of those items is not in the master');
        if (it.makeId) {
          const okMake = await one(`SELECT 1 AS ok FROM item_makes WHERE item_id = ? AND make_id = ?`,
            [it.itemId, it.makeId], conn);
          if (!okMake) throw badRequest('That make is not approved for that item');
        }
        const boqQty = round3(it.itemQty * Number(wol.qty));
        const manual = it.estQty !== undefined && it.estQty !== null;
        const estQty = manual ? round3(it.estQty) : round3(it.itemQty * req.body.estQty);
        await run(
          `INSERT INTO boq_lines (boq_id, boq_wo_line_id, sno, item_id, make_id, uom_id,
                                  item_qty, boq_qty, est_qty, est_manual)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [boq.id, bwl.id, `${wol.sno}${suffix(i++)}`, it.itemId, it.makeId || null, item.uom_id,
           it.itemQty, boqQty, estQty, manual ? 1 : 0], conn
        );
      }
      await log(conn, {
        entity: 'BOQ', entityId: boq.id, docNo: boq.doc_no, action: 'Line prepared',
        detail: `WO line ${wol.sno} · ${req.body.items.length} item(s)`, user: req.user,
      });
    });

    const status = await one(`SELECT * FROM v_boq_status WHERE boq_id = ?`, [boq.id]);
    res.json({
      ok: true,
      prepared: status.prepared_count, ofLines: status.wo_line_count,
      remaining: status.wo_line_count - status.prepared_count,
    });
  })
);

router.delete('/:id/wo-line/:woLineId', wrap(async (req, res) => {
  const boq = await loadBoq(req.params.id);
  if (boq.status === 'LOCKED') throw conflict('This BOQ is locked');
  await run(`DELETE FROM boq_wo_lines WHERE boq_id = ? AND wo_line_id = ?`, [boq.id, req.params.woLineId]);
  res.json({ ok: true });
}));

/* ------------------------------------------------------------ submit */
router.post('/:id/submit',
  validate(z.object({
    overAllow: z.boolean().default(false),
    // 0 with overAllow true means no ceiling at all
    overPct: z.coerce.number().min(0).max(500).default(0),
  })),
  wrap(async (req, res) => {
    const boq = await loadBoq(req.params.id);
    if (boq.status === 'LOCKED') throw conflict('Already locked');
    if (boq.prepared_count !== boq.wo_line_count) {
      throw badRequest(
        `${boq.wo_line_count - boq.prepared_count} work order line(s) are not prepared yet`,
        { prepared: boq.prepared_count, ofLines: boq.wo_line_count }
      );
    }
    const { overAllow, overPct } = req.body;
    await tx(async (conn) => {
      await run(
        `UPDATE boqs SET status='LOCKED', over_allow=?, over_pct=?, submitted_at=NOW()
          WHERE id=? AND status='DRAFT'`,
        [overAllow ? 1 : 0, overAllow ? overPct : 0, boq.id], conn
      );
      await log(conn, {
        entity: 'BOQ', entityId: boq.id, docNo: boq.doc_no, action: 'Submitted and locked',
        detail: `beyond estimate: ${overAllow ? (overPct ? `${overPct}% allowed` : 'allowed, no ceiling') : 'not allowed'}`,
        user: req.user,
      });
    });
    res.json({
      ok: true, docNo: boq.doc_no,
      policy: { overAllow, overPct: overAllow ? overPct : 0 },
    });
  })
);

/* --------------------------------------------------------- amendment */
/** Which lines have been indented past their estimate. */
router.get('/:id/over-lines', wrap(async (req, res) => {
  const boq = await loadBoq(req.params.id);
  const lines = await many(
    `SELECT * FROM v_boq_line_status WHERE boq_id = ? AND over_qty > 0 ORDER BY sno`, [boq.id]
  );
  res.json({ boqId: boq.id, docNo: boq.doc_no, state: boq.state, lines });
}));

/**
 * Record a variation quantity. This is what takes a BOQ out of
 * AMENDMENT_DUE: the estimate moves up to cover what was already
 * indented, and the trail says who moved it and why.
 */
router.post('/:id/amendments',
  validate(z.object({
    reason: z.string().trim().min(5).max(500),
    lines: z.array(z.object({
      boqLineId: z.coerce.number().int().positive(),
      qty: z.coerce.number().positive(),
    })).min(1),
  })),
  wrap(async (req, res) => {
    const boq = await loadBoq(req.params.id);
    if (boq.status !== 'LOCKED') throw badRequest('Only a locked BOQ can be amended');

    const out = await tx(async (conn) => {
      const am = await run(
        `INSERT INTO boq_amendments (boq_id, reason, created_by) VALUES (?, ?, ?)`,
        [boq.id, req.body.reason, req.user?.id || null], conn
      );
      for (const l of req.body.lines) {
        const line = await one(
          `SELECT id FROM boq_lines WHERE id = ? AND boq_id = ? FOR UPDATE`,
          [l.boqLineId, boq.id], conn
        );
        if (!line) throw badRequest('One of those lines is not on this BOQ');
        await run(`INSERT INTO boq_amendment_lines (amendment_id, boq_line_id, qty) VALUES (?, ?, ?)`,
          [am.insertId, l.boqLineId, l.qty], conn);
        await run(`UPDATE boq_lines SET var_qty = var_qty + ? WHERE id = ?`, [l.qty, l.boqLineId], conn);
      }
      await run(`UPDATE boqs SET amended_on = CURDATE() WHERE id = ?`, [boq.id], conn);
      await log(conn, {
        entity: 'BOQ', entityId: boq.id, docNo: boq.doc_no, action: 'Amended',
        detail: `${req.body.lines.length} line(s) given a variation · ${req.body.reason}`, user: req.user,
      });
      return am.insertId;
    });

    const status = await one(`SELECT state, over_line_count FROM v_boq_status WHERE boq_id = ?`, [boq.id]);
    res.status(201).json({ amendmentId: out, state: status.state, overLines: status.over_line_count });
  })
);

router.get('/:id/amendments', wrap(async (req, res) => {
  const boq = await loadBoq(req.params.id);
  const rows = await many(
    `SELECT a.id, a.reason, a.created_at, u.name AS by_name,
            bl.sno, i.code AS item_code, i.name AS item_name, al.qty
       FROM boq_amendments a
       JOIN users u ON u.id = a.created_by
       JOIN boq_amendment_lines al ON al.amendment_id = a.id
       JOIN boq_lines bl ON bl.id = al.boq_line_id
       JOIN items i ON i.id = bl.item_id
      WHERE a.boq_id = ? ORDER BY a.id DESC, bl.sno`, [boq.id]
  );
  res.json(rows);
}));

module.exports = router;
