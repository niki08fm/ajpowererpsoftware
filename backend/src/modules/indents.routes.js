'use strict';
const router = require('express').Router();
const { z } = require('zod');
const { many, one, run, tx } = require('../config/db');
const { validate, wrap } = require('../middleware/validate');
const { nextDocNo } = require('../lib/docNo');
const { log } = require('../lib/audit');
const { notFound, badRequest, conflict } = require('../lib/errors');

/**
 * Indents. A cart, then a document.
 *
 *   DRAFT      editable, and it eats no balance. That last part
 *              matters: a site manager building a cart over three days
 *              must not be silently holding quantity nobody can see.
 *   SUBMITTED  in the queue, and now it holds quantity
 *   APPROVED   committed
 *   RETURNED   sent back, editable again
 *
 * Quantity past the BOQ line's estimate is allowed only where the BOQ
 * says so. How much is past is recorded on the line, so the flag
 * survives a later amendment moving the estimate underneath it.
 */
const round3 = (n) => Math.round(Number(n) * 1000) / 1000;
const EDITABLE = ['DRAFT', 'RETURNED'];

/** Sites with a locked BOQ — the only ones that can be indented against. */
router.get('/sites',
  validate(z.object({ branchId: z.coerce.number().int().positive().optional() }), 'query'),
  wrap(async (req, res) => {
    const bId = req.query.branchId;
    res.json(await many(
      `SELECT s.id, s.code, s.name, b.id AS boq_id, b.doc_no AS boq_doc_no,
              b.over_allow, b.over_pct, v.state, v.over_line_count, v.worst_over_pct
         FROM sites s
         JOIN boqs b ON b.site_id = s.id AND b.status = 'LOCKED'
         LEFT JOIN v_boq_status v ON v.boq_id = b.id
        WHERE s.site_type = 'SITE' AND s.status = 'ACTIVE' ${bId ? 'AND s.branch_id = ?' : ''}
        ORDER BY s.name`,
      bId ? [bId] : []
    ));
  })
);

/** Every BOQ line with the numbers the indent screen shows. */
router.get('/boq/:boqId/lines', wrap(async (req, res) => {
  const ok = await one(`SELECT id FROM boqs WHERE id = ? AND status = 'LOCKED'`, [req.params.boqId]);
  if (!ok) throw notFound('No such BOQ, or it is not locked yet');
  res.json(await many(`SELECT * FROM v_boq_line_status WHERE boq_id = ? ORDER BY sno`, [req.params.boqId]));
}));

const linesSchema = z.array(z.object({
  boqLineId: z.coerce.number().int().positive(),
  qty: z.coerce.number().positive(),
  makeId: z.coerce.number().int().positive().nullable().optional(),
  remark: z.string().trim().max(300).optional(),
})).min(1).max(300);

/**
 * Price the lines against the BOQ: how much of each is past the
 * estimate, and whether the policy permits it. One rule, used by the
 * dry run and by the save, so the screen cannot disagree with the API.
 */
async function evaluate(conn, boq, lines) {
  const out = [];
  for (const l of lines) {
    const st = await one(
      `SELECT * FROM v_boq_line_status WHERE boq_line_id = ? AND boq_id = ?`,
      [l.boqLineId, boq.id], conn
    );
    if (!st) throw badRequest('One of those lines is not on this BOQ');
    if (l.makeId) {
      const okMake = await one(
        `SELECT 1 AS ok FROM item_makes WHERE item_id = ? AND make_id = ?`, [st.item_id, l.makeId], conn);
      if (!okMake) throw badRequest(`That make is not approved for ${st.item_code}`);
    }
    const free = Number(st.balance);              // drafts already excluded
    const overQty = round3(Math.max(0, l.qty - Math.max(free, 0)));

    if (overQty > 0) {
      if (!boq.over_allow) {
        throw conflict(
          `${st.item_code} — ${st.item_name}: the estimate is a hard stop on this BOQ. ` +
          (free > 0 ? `Only ${free} left.` : 'Nothing left on this line.'),
          { boqLineId: st.boq_line_id, available: Math.max(free, 0) }
        );
      }
      if (st.ceiling_qty !== null) {
        const room = round3(Number(st.ceiling_qty) - Number(st.committed_qty));
        if (l.qty > room) {
          throw conflict(
            `${st.item_code} — ${st.item_name}: ${boq.over_pct}% over the estimate is the ceiling, ` +
            `so ${Math.max(room, 0)} is the most that can go on this line.`,
            { boqLineId: st.boq_line_id, available: Math.max(room, 0) }
          );
        }
      }
    }
    out.push({
      ...l, itemId: st.item_id, overQty,
      overPct: st.effective_est > 0 ? round3((overQty / Number(st.effective_est)) * 100) : 0,
      itemCode: st.item_code, itemName: st.item_name,
      effectiveEst: st.effective_est, balance: st.balance,
    });
  }
  return out;
}

/** amber inside an agreed ceiling, red where none was agreed */
const severityOf = (boq, overCount) =>
  !overCount ? 'none' : (boq.over_allow && Number(boq.over_pct) > 0) ? 'warn' : 'bad';

/** Dry run, so the screen can warn before anything is committed. */
router.post('/evaluate',
  validate(z.object({ boqId: z.coerce.number().int().positive(), lines: linesSchema })),
  wrap(async (req, res) => {
    const boq = await one(`SELECT * FROM boqs WHERE id = ? AND status = 'LOCKED'`, [req.body.boqId]);
    if (!boq) throw notFound('No such BOQ');
    const priced = await evaluate(null, boq, req.body.lines);
    const over = priced.filter((l) => l.overQty > 0);
    res.json({
      lines: priced,
      over: over.length,
      worstOverPct: over.reduce((a, l) => Math.max(a, l.overPct), 0),
      severity: severityOf(boq, over.length),
      policy: { overAllow: !!boq.over_allow, overPct: boq.over_pct },
    });
  })
);

const indentBody = z.object({
  siteId: z.coerce.number().int().positive(),
  indentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  neededBy: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  lines: linesSchema,
});

/** Save the cart. `send:true` puts it straight into the queue. */
router.post('/', validate(indentBody.extend({ send: z.boolean().default(false) })),
  wrap(async (req, res) => {
    const b = req.body;
    const site = await one(
      `SELECT s.*, bq.id AS boq_id FROM sites s
         JOIN boqs bq ON bq.site_id = s.id AND bq.status = 'LOCKED'
        WHERE s.id = ? AND s.status = 'ACTIVE'`, [b.siteId]
    );
    if (!site) throw notFound('No such site, or it has no locked BOQ');
    const boq = await one(`SELECT * FROM boqs WHERE id = ?`, [site.boq_id]);

    const out = await tx(async (conn) => {
      const priced = await evaluate(conn, boq, b.lines);
      const docNo = await nextDocNo(conn, 'IND', b.indentDate);
      const r = await run(
        `INSERT INTO indents (doc_no, site_id, branch_id, boq_id, indent_date, needed_by, status, raised_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [docNo, site.id, site.branch_id, boq.id, b.indentDate, b.neededBy || null,
         b.send ? 'SUBMITTED' : 'DRAFT', req.user?.id || null], conn
      );
      for (const l of priced) {
        await run(
          `INSERT INTO indent_lines (indent_id, boq_line_id, item_id, make_id, qty, over_qty, remark)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [r.insertId, l.boqLineId, l.itemId, l.makeId || null, l.qty, l.overQty, l.remark || null], conn
        );
      }
      if (b.send) {
        await run(`INSERT INTO indent_events (indent_id, action, user_id) VALUES (?, 'SUBMITTED', ?)`,
          [r.insertId, req.user?.id || null], conn);
      }
      const over = priced.filter((l) => l.overQty > 0);
      await log(conn, {
        entity: 'INDENT', entityId: r.insertId, docNo,
        action: b.send ? 'Submitted' : 'Saved as a draft',
        detail: `${site.name} · ${priced.length} line(s)${over.length ? ` · ${over.length} past the estimate` : ''}`,
        user: req.user,
      });
      return { id: r.insertId, docNo, status: b.send ? 'SUBMITTED' : 'DRAFT',
               over: over.length, severity: severityOf(boq, over.length) };
    });
    res.status(201).json(out);
  })
);

/** Edit the cart. Only while it is still one. */
// every field optional: an edit may be only the lines, or only a date
const indentPatch = indentBody.partial();
router.put('/:id', validate(indentPatch), wrap(async (req, res) => {
  const ind = await one(`SELECT * FROM indents WHERE id = ?`, [req.params.id]);
  if (!ind) throw notFound('No such indent');
  if (!EDITABLE.includes(ind.status)) {
    throw conflict('This indent is in the queue — it has to be returned before it can be changed');
  }
  const boq = await one(`SELECT * FROM boqs WHERE id = ?`, [ind.boq_id]);
  await tx(async (conn) => {
    if (req.body.lines) {
      const priced = await evaluate(conn, boq, req.body.lines);
      await run(`DELETE FROM indent_lines WHERE indent_id = ?`, [ind.id], conn);
      for (const l of priced) {
        await run(
          `INSERT INTO indent_lines (indent_id, boq_line_id, item_id, make_id, qty, over_qty, remark)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [ind.id, l.boqLineId, l.itemId, l.makeId || null, l.qty, l.overQty, l.remark || null], conn
        );
      }
    }
    await run(
      `UPDATE indents SET indent_date = COALESCE(?, indent_date), needed_by = COALESCE(?, needed_by) WHERE id = ?`,
      [req.body.indentDate ?? null, req.body.neededBy ?? null, ind.id], conn
    );
    await log(conn, { entity: 'INDENT', entityId: ind.id, docNo: ind.doc_no, action: 'Draft updated', user: req.user });
  });
  res.json({ ok: true });
}));

/** Cart -> queue. This is the moment it starts holding quantity. */
router.post('/:id/submit', wrap(async (req, res) => {
  const ind = await one(`SELECT * FROM indents WHERE id = ?`, [req.params.id]);
  if (!ind) throw notFound('No such indent');
  if (!EDITABLE.includes(ind.status)) throw conflict('Already submitted');
  const { n } = await one(`SELECT COUNT(*) AS n FROM indent_lines WHERE indent_id = ?`, [ind.id]);
  if (!n) throw badRequest('There is nothing on this indent');
  await tx(async (conn) => {
    await run(`UPDATE indents SET status = 'SUBMITTED' WHERE id = ?`, [ind.id], conn);
    await run(`INSERT INTO indent_events (indent_id, action, user_id) VALUES (?, 'SUBMITTED', ?)`,
      [ind.id, req.user?.id || null], conn);
    await log(conn, { entity: 'INDENT', entityId: ind.id, docNo: ind.doc_no, action: 'Submitted', user: req.user });
  });
  res.json({ ok: true, docNo: ind.doc_no, status: 'SUBMITTED' });
}));

/**
 * Approve or return. Deliberately open to anyone for now — who signs is
 * part of the access decision we have not taken. The trail is recorded
 * either way, so nothing is lost by deciding later.
 */
router.post('/:id/decide',
  validate(z.object({ action: z.enum(['APPROVED', 'RETURNED']), note: z.string().trim().max(500).optional() })),
  wrap(async (req, res) => {
    const ind = await one(`SELECT * FROM indents WHERE id = ?`, [req.params.id]);
    if (!ind) throw notFound('No such indent');
    if (ind.status !== 'SUBMITTED') throw conflict(`This indent is ${ind.status.toLowerCase()}, not waiting`);
    await tx(async (conn) => {
      await run(`UPDATE indents SET status = ? WHERE id = ?`, [req.body.action, ind.id], conn);
      await run(`INSERT INTO indent_events (indent_id, action, user_id, note) VALUES (?, ?, ?, ?)`,
        [ind.id, req.body.action, req.user?.id || null, req.body.note || null], conn);
      await log(conn, { entity: 'INDENT', entityId: ind.id, docNo: ind.doc_no,
        action: req.body.action, detail: req.body.note, user: req.user });
    });
    res.json({ ok: true, status: req.body.action });
  })
);

router.delete('/:id', wrap(async (req, res) => {
  const ind = await one(`SELECT * FROM indents WHERE id = ?`, [req.params.id]);
  if (!ind) throw notFound('No such indent');
  if (ind.status !== 'DRAFT') throw conflict('Only a draft can be deleted');
  await run(`DELETE FROM indents WHERE id = ?`, [ind.id]);
  res.json({ ok: true });
}));

router.get('/',
  validate(z.object({
    branchId: z.coerce.number().int().positive().optional(),
    siteId: z.coerce.number().int().positive().optional(),
  }), 'query'),
  wrap(async (req, res) => {
    const where = [];
    const params = [];
    if (req.query.branchId) { where.push('i.branch_id = ?'); params.push(req.query.branchId); }
    if (req.query.siteId) { where.push('i.site_id = ?'); params.push(req.query.siteId); }
    const rows = await many(
      `SELECT i.id, i.doc_no, i.indent_date, i.needed_by, i.status, i.created_at,
              s.id AS site_id, s.name AS site_name, u.name AS raised_by_name,
              b.doc_no AS boq_doc_no, b.over_allow, b.over_pct,
              (SELECT COUNT(*) FROM indent_lines il WHERE il.indent_id = i.id) AS line_count,
              (SELECT COUNT(*) FROM indent_lines il WHERE il.indent_id = i.id AND il.over_qty > 0) AS over_lines
         FROM indents i
         JOIN sites s ON s.id = i.site_id
         LEFT JOIN users u ON u.id = i.raised_by
         JOIN boqs b ON b.id = i.boq_id
        ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
        ORDER BY i.created_at DESC`,
      params
    );
    const decorate = (r) => ({
      ...r,
      severity: severityOf({ over_allow: r.over_allow, over_pct: r.over_pct }, r.over_lines),
    });
    res.json({
      drafts: rows.filter((r) => r.status === 'DRAFT').map(decorate),
      indents: rows.filter((r) => r.status !== 'DRAFT').map(decorate),
    });
  })
);

router.get('/:id', wrap(async (req, res) => {
  const ind = await one(
    `SELECT i.*, s.name AS site_name, u.name AS raised_by_name,
            b.doc_no AS boq_doc_no, b.over_allow, b.over_pct
       FROM indents i
       JOIN sites s ON s.id = i.site_id
       LEFT JOIN users u ON u.id = i.raised_by
       JOIN boqs b ON b.id = i.boq_id
      WHERE i.id = ?`, [req.params.id]
  );
  if (!ind) throw notFound('No such indent');
  const lines = await many(
    `SELECT il.id, il.qty, il.over_qty, il.remark, il.boq_line_id,
            bl.sno, i2.code AS item_code, i2.name AS item_name, u.code AS uom,
            mk.name AS make_name,
            st.effective_est, st.boq_qty, st.est_qty, st.var_qty, st.balance, st.committed_qty
       FROM indent_lines il
       JOIN boq_lines bl ON bl.id = il.boq_line_id
       JOIN items i2 ON i2.id = il.item_id
       JOIN uoms u ON u.id = bl.uom_id
       LEFT JOIN makes mk ON mk.id = il.make_id
       LEFT JOIN v_boq_line_status st ON st.boq_line_id = bl.id
      WHERE il.indent_id = ? ORDER BY bl.sno`, [ind.id]
  );
  const events = await many(
    `SELECT e.action, e.note, e.created_at, u.name AS user_name
       FROM indent_events e LEFT JOIN users u ON u.id = e.user_id
      WHERE e.indent_id = ? ORDER BY e.id`, [ind.id]
  );
  const over = lines.filter((l) => Number(l.over_qty) > 0);
  res.json({
    id: ind.id, docNo: ind.doc_no, status: ind.status,
    site: { id: ind.site_id, name: ind.site_name },
    indentDate: ind.indent_date, neededBy: ind.needed_by, raisedBy: ind.raised_by_name,
    boqDocNo: ind.boq_doc_no,
    policy: { overAllow: !!ind.over_allow, overPct: ind.over_pct },
    severity: severityOf(ind, over.length),
    overLines: over.length,
    worstOverPct: over.reduce(
      (a, l) => Math.max(a, l.effective_est > 0 ? (l.over_qty / l.effective_est) * 100 : 0), 0),
    canEdit: EDITABLE.includes(ind.status),
    lines, events,
  });
}));

module.exports = router;
