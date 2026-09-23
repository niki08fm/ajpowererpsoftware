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
    // qty is the effective quantity — contracted plus whatever an
    // amendment has moved it by — so the preparation sheet and the
    // amend sheet can never show two numbers for the same line
    `SELECT wol.id AS wo_line_id, wol.sno, wol.description, u.code AS uom,
            wol.qty AS contracted_qty,
            COALESCE(bwl.var_qty, 0) AS var_qty,
            (wol.qty + COALESCE(bwl.var_qty, 0)) AS qty,
            bwl.id AS boq_wo_line_id,
            COALESCE(bwl.est_qty, 0) AS contracted_est,
            (COALESCE(bwl.est_qty, 0) + COALESCE(bwl.var_qty, 0)) AS est_qty
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
    // whose desk it is on and at which level, with names
    approval: await chain.trail('BOQ', boq.id, req.user?.id),
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
        detail: `WO line ${wol.sno} · ${plural(req.body.items.length, 'item')}`, user: req.user,
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
    if (boq.status === 'SUBMITTED') throw conflict('Already waiting for approval');
    if (boq.prepared_count !== boq.wo_line_count) {
      throw badRequest(
        (boq.wo_line_count - boq.prepared_count === 1 ? '1 work order line is not prepared yet'
          : `${boq.wo_line_count - boq.prepared_count} work order lines are not prepared yet`),
        { prepared: boq.prepared_count, ofLines: boq.wo_line_count }
      );
    }
    const { overAllow, overPct } = req.body;
    // Submitting no longer locks it. The BOQ is what every indent,
    // order and bill on this site is measured against, so it is signed
    // twice — the site's GM, then Management — and it locks on the
    // second signature. The beyond-estimate policy travels with it, so
    // what is being approved includes how far over the estimate the
    // site may go.
    await tx(async (conn) => {
      await run(
        `UPDATE boqs SET status='SUBMITTED', over_allow=?, over_pct=?, submitted_at=NOW()
          WHERE id=? AND status='DRAFT'`,
        [overAllow ? 1 : 0, overAllow ? overPct : 0, boq.id], conn
      );
      await chain.open(conn, { docType: 'BOQ', docId: boq.id, docNo: boq.doc_no,
        branchId: boq.branch_id, siteId: boq.site_id, userId: req.user?.id });
      await log(conn, {
        entity: 'BOQ', entityId: boq.id, docNo: boq.doc_no, action: 'Sent for approval',
        detail: `beyond estimate: ${overAllow ? (overPct ? `${overPct}% allowed` : 'allowed, no ceiling') : 'not allowed'}`,
        user: req.user,
      });
    });
    res.json({
      ok: true, docNo: boq.doc_no, status: 'SUBMITTED',
      message: `${boq.doc_no} is with the site GM for approval; it locks once Management approves too`,
      policy: { overAllow, overPct: overAllow ? overPct : 0 },
    });
  })
);

/**
 * Sign, or send back.
 *
 * A BOQ that is sent back returns to draft, because the only reason to
 * send one back is to change a line on it — and changing a line is
 * something only a draft allows.
 */
router.post('/:id/decide',
  validate(z.object({
    action: z.enum(['APPROVED', 'RETURNED']),
    note: z.string().trim().max(500).optional(),
  })),
  wrap(async (req, res) => {
    const boq = await one(`SELECT * FROM boqs WHERE id = ?`, [req.params.id]);
    if (!boq) throw notFound('No such BOQ');
    if (boq.status !== 'SUBMITTED') {
      throw conflict(`This BOQ is ${boq.status.toLowerCase()}, not waiting for approval`);
    }
    if (req.body.action === 'RETURNED' && (req.body.note || '').trim().length < 5) {
      throw badRequest('Say why it is going back');
    }
    let step;
    await tx(async (conn) => {
      step = await chain.decide(conn, { docType: 'BOQ', docId: boq.id,
        action: req.body.action, userId: req.user?.id, note: req.body.note });
      const status = req.body.action === 'RETURNED' ? 'DRAFT'
        : step.done ? 'LOCKED' : 'SUBMITTED';
      await run(`UPDATE boqs SET status = ? WHERE id = ?`, [status, boq.id], conn);
      await log(conn, { entity: 'BOQ', entityId: boq.id, docNo: boq.doc_no,
        action: req.body.action === 'RETURNED' ? 'Returned to draft'
          : step.done ? 'Approved and locked' : 'Signed by the GM',
        detail: req.body.note, user: req.user });
    });
    res.json({
      ok: true,
      status: req.body.action === 'RETURNED' ? 'DRAFT' : step.done ? 'LOCKED' : 'SUBMITTED',
      level: step.level, levels: step.levels, done: step.done,
      message: req.body.action === 'RETURNED'
        ? `${boq.doc_no} is back in draft with planning`
        : step.done
          ? `${boq.doc_no} is approved and locked — the site can raise PRNs against it`
          : `${boq.doc_no} is approved at level 1 (GM) and is now with Management`,
    });
  })
);

/* --------------------------------------------------------- amendment */
/**
 * An amendment is typed against a WORK ORDER LINE, not against each
 * item. One number, and every item under it recomputes on the same
 * formula preparation uses:
 *
 *     boq_qty = item_qty x (contracted qty + amendment)
 *     est_qty = item_qty x (contracted est + amendment)
 *
 * The client's work_order_lines.qty is never touched. The amendment
 * accumulates on boq_wo_lines.var_qty, so the sheet can always show
 * what was contracted next to what it now stands at.
 */

/** The amend sheet: the BOQ exactly as preparation shows it. */
router.get('/:id/amend-sheet', wrap(async (req, res) => {
  const boq = await loadBoq(req.params.id);
  const woLines = await many(
    `SELECT * FROM v_boq_wo_line WHERE boq_id = ? ORDER BY sno`, [boq.id]);
  const items = await many(
    `SELECT s.*, bl.boq_wo_line_id, bl.est_manual
       FROM v_boq_line_status s
       JOIN boq_lines bl ON bl.id = s.boq_line_id
      WHERE s.boq_id = ? ORDER BY s.sno`, [boq.id]);

  res.json({
    boqId: boq.id, docNo: boq.doc_no, state: boq.state,
    site: { id: boq.site_id, name: boq.site_name, code: boq.site_code },
    workOrder: { docNo: boq.wo_doc_no, clientWoNo: boq.client_wo_no },
    policy: { overAllow: !!boq.over_allow, overPct: boq.over_pct },
    woLines: woLines.map((w) => ({
      ...w,
      items: items.filter((i) => i.boq_wo_line_id === w.boq_wo_line_id),
    })),
  });
}));

/** Which lines have been indented past their estimate. */
router.get('/:id/over-lines', wrap(async (req, res) => {
  const boq = await loadBoq(req.params.id);
  const lines = await many(
    `SELECT * FROM v_boq_line_status WHERE boq_id = ? AND over_qty > 0 ORDER BY sno`, [boq.id]
  );
  res.json({ boqId: boq.id, docNo: boq.doc_no, state: boq.state, lines });
}));

/**
 * Preview: what the sheet becomes if these amendments are recorded.
 * Saves nothing. The screen can show the new quantities beside the
 * present ones before anyone commits to them.
 */
const amendBody = z.object({
  reason: z.string().trim().min(5).max(500),
  lines: z.array(z.object({
    boqWoLineId: z.coerce.number().int().positive(),
    // a cut is allowed; nothing is a no-op
    qty: z.coerce.number().refine((n) => n !== 0, 'A variation of nothing is not a variation'),
  })).min(1),
});

/** Work out the new numbers. Used by the preview and by the save. */
async function projectAmendment(conn, boq, lines) {
  const out = [];
  for (const l of lines) {
    const w = await one(
      `SELECT * FROM v_boq_wo_line WHERE boq_wo_line_id = ? AND boq_id = ?`,
      [l.boqWoLineId, boq.id], conn
    );
    if (!w) throw badRequest('One of those lines is not on this BOQ');

    const newQty = round3(Number(w.effective_qty) + l.qty);
    const newEst = round3(Number(w.effective_est) + l.qty);
    if (newQty <= 0) {
      throw badRequest(
        `Line ${w.sno} stands at ${w.effective_qty}; a cut of ${Math.abs(l.qty)} would leave nothing.`,
        { boqWoLineId: w.boq_wo_line_id }
      );
    }

    const kids = await many(
      `SELECT s.*, bl.item_qty AS iq, bl.est_manual, bl.est_qty AS own_est
         FROM v_boq_line_status s
         JOIN boq_lines bl ON bl.id = s.boq_line_id
        WHERE bl.boq_wo_line_id = ? ORDER BY s.sno`, [l.boqWoLineId], conn
    );
    const items = kids.map((k) => {
      const iq = Number(k.iq);
      const newVar = round3(iq * (Number(w.var_qty) + l.qty));
      const newBoqQty = round3(iq * newQty);
      const newEffEst = round3(Number(k.own_est) + newVar);
      return {
        boqLineId: k.boq_line_id, sno: k.sno,
        itemCode: k.item_code, itemName: k.item_name, uom: k.uom,
        itemQty: iq, estManual: !!k.est_manual,
        boqQty: Number(k.boq_qty), newBoqQty,
        effectiveEst: Number(k.effective_est), newEffectiveEst: newEffEst,
        committed: Number(k.committed_qty),
        newVarQty: newVar,
        // a cut can leave a line holding more than it is now estimated for
        goesOver: round3(Math.max(0, Number(k.committed_qty) - newEffEst)),
      };
    });

    out.push({
      boqWoLineId: w.boq_wo_line_id, sno: w.sno, description: w.description, uom: w.uom,
      contractedQty: Number(w.contracted_qty), varQty: Number(w.var_qty),
      fromQty: Number(w.effective_qty), amendBy: l.qty, toQty: newQty,
      fromEst: Number(w.effective_est), toEst: newEst,
      items,
    });
  }
  return out;
}

router.post('/:id/amendments/preview', validate(amendBody), wrap(async (req, res) => {
  const boq = await loadBoq(req.params.id);
  if (boq.status !== 'LOCKED') throw badRequest('Only a locked BOQ can be amended');
  const lines = await projectAmendment(null, boq, req.body.lines);
  const over = lines.flatMap((w) => w.items.filter((i) => i.goesOver > 0));
  res.json({ lines, goesOver: over });
}));

router.post('/:id/amendments', validate(amendBody), wrap(async (req, res) => {
  const boq = await loadBoq(req.params.id);
  if (boq.status !== 'LOCKED') throw badRequest('Only a locked BOQ can be amended');

  const out = await tx(async (conn) => {
    // lock the work order lines first so two amendments cannot both
    // read the same var_qty and each add to it
    for (const l of req.body.lines) {
      await one(`SELECT id FROM boq_wo_lines WHERE id = ? AND boq_id = ? FOR UPDATE`,
        [l.boqWoLineId, boq.id], conn);
    }
    const projected = await projectAmendment(conn, boq, req.body.lines);

    const am = await run(
      `INSERT INTO boq_amendments (boq_id, reason, created_by) VALUES (?, ?, ?)`,
      [boq.id, req.body.reason, req.user?.id || null], conn
    );

    for (const w of projected) {
      await run(
        `INSERT INTO boq_amendment_lines (amendment_id, boq_wo_line_id, qty, from_qty, to_qty)
         VALUES (?, ?, ?, ?, ?)`,
        [am.insertId, w.boqWoLineId, w.amendBy, w.fromQty, w.toQty], conn
      );
      await run(`UPDATE boq_wo_lines SET var_qty = var_qty + ? WHERE id = ?`,
        [w.amendBy, w.boqWoLineId], conn);
      // every item under the line recomputed, not incremented, so
      // amending the same line twice cannot drift
      for (const i of w.items) {
        await run(`UPDATE boq_lines SET boq_qty = ?, var_qty = ? WHERE id = ?`,
          [i.newBoqQty, i.newVarQty, i.boqLineId], conn);
      }
    }

    await run(`UPDATE boqs SET amended_on = CURDATE() WHERE id = ?`, [boq.id], conn);
    await log(conn, {
      entity: 'BOQ', entityId: boq.id, docNo: boq.doc_no, action: 'Amended',
      detail: `${projected.map((w) => `line ${w.sno} ${w.fromQty}→${w.toQty}`).join(', ')} · ${req.body.reason}`,
      user: req.user,
    });
    return { id: am.insertId, projected };
  });

  const status = await one(`SELECT state, over_line_count FROM v_boq_status WHERE boq_id = ?`, [boq.id]);
  res.status(201).json({
    amendmentId: out.id,
    lines: out.projected.map((w) => ({ sno: w.sno, from: w.fromQty, to: w.toQty, items: w.items.length })),
    state: status.state,
    overLines: status.over_line_count,
  });
}));

/** The trail: one entry per amendment, with the lines it moved. */
router.get('/:id/amendments', wrap(async (req, res) => {
  const boq = await loadBoq(req.params.id);
  const heads = await many(
    `SELECT a.id, a.reason, a.created_at, u.name AS by_name
       FROM boq_amendments a
       LEFT JOIN users u ON u.id = a.created_by
      WHERE a.boq_id = ? ORDER BY a.id DESC`, [boq.id]
  );
  if (!heads.length) return res.json([]);

  const rows = await many(
    `SELECT al.amendment_id, al.qty, al.from_qty, al.to_qty,
            wol.sno, wol.description, u.code AS uom,
            bl.sno AS item_sno, i.code AS item_code, i.name AS item_name
       FROM boq_amendment_lines al
       LEFT JOIN boq_wo_lines bwl     ON bwl.id = al.boq_wo_line_id
       LEFT JOIN work_order_lines wol ON wol.id = bwl.wo_line_id
       LEFT JOIN uoms u               ON u.id = wol.uom_id
       LEFT JOIN boq_lines bl         ON bl.id = al.boq_line_id
       LEFT JOIN items i              ON i.id = bl.item_id
      WHERE al.amendment_id IN (${heads.map(() => '?').join(',')})
      ORDER BY al.id`, heads.map((h) => h.id)
  );

  res.json(heads.map((h) => ({
    id: h.id, reason: h.reason, at: h.created_at, by: h.by_name,
    lines: rows.filter((r) => r.amendment_id === h.id).map((r) => (
      r.sno !== null
        // the shape since 004: a work order line moved
        ? { kind: 'WO_LINE', sno: r.sno, description: r.description, uom: r.uom,
            qty: r.qty, from: r.from_qty, to: r.to_qty }
        // raised before 004, when an amendment named a single item
        : { kind: 'ITEM', sno: r.item_sno, itemCode: r.item_code, itemName: r.item_name, qty: r.qty }
    )),
  })));
}));

/**
 * Everything that has happened to one BOQ, in one call: the trail of
 * what was done to it, every amendment with the lines it moved, and
 * every indent raised against it.
 */
router.get('/:id/history', wrap(async (req, res) => {
  const boq = await loadBoq(req.params.id);

  const events = await many(
    `SELECT a.action, a.detail, a.created_at, u.name AS by_name
       FROM audit_log a
       LEFT JOIN users u ON u.id = a.user_id
      WHERE a.entity = 'BOQ' AND a.entity_id = ?
      ORDER BY a.id DESC`, [boq.id]
  );

  const indents = await many(
    `SELECT i.id, i.doc_no, i.indent_date, i.needed_by, i.status, i.created_at,
            u.name AS raised_by_name,
            (SELECT COUNT(*) FROM indent_lines il WHERE il.indent_id = i.id) AS line_count,
            (SELECT COALESCE(SUM(il.qty), 0) FROM indent_lines il WHERE il.indent_id = i.id) AS total_qty,
            (SELECT COUNT(*) FROM indent_lines il WHERE il.indent_id = i.id AND il.over_qty > 0) AS over_lines
       FROM indents i
       LEFT JOIN users u ON u.id = i.raised_by
      WHERE i.boq_id = ?
      ORDER BY i.created_at DESC`, [boq.id]
  );

  res.json({
    boqId: boq.id, docNo: boq.doc_no, state: boq.state,
    site: { id: boq.site_id, name: boq.site_name, code: boq.site_code },
    workOrder: { docNo: boq.wo_doc_no, clientWoNo: boq.client_wo_no },
    amendedOn: boq.amended_on,
    events,
    indents: indents.map((r) => ({
      ...r,
      severity: !r.over_lines ? 'none'
        : (boq.over_allow && Number(boq.over_pct) > 0) ? 'warn' : 'bad',
    })),
  });
}));

module.exports = router;
