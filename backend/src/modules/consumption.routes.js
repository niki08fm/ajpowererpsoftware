'use strict';
const router = require('express').Router();
const { z } = require('zod');
const { many, one, run, tx } = require('../config/db');
const { validate, wrap } = require('../middleware/validate');
const { nextDocNo } = require('../lib/docNo');
const { log } = require('../lib/audit');
const { notFound, badRequest, conflict } = require('../lib/errors');

/**
 * Consumption — what the site actually used, booked against the same
 * BOQ line the material was indented on.
 *
 * That is the whole point of keeping one thread from work order line
 * to BOQ line: estimated, indented, used and left are four numbers
 * about the same row, and none of them is stored.
 *
 * Until the store side exists, a site may only consume what its
 * indents actually got approved for.
 */
const round3 = (n) => Math.round(Number(n) * 1000) / 1000;
const EDITABLE = ['DRAFT'];

/** What is at site to use, line by line. */
router.get('/boq/:boqId/available', wrap(async (req, res) => {
  const ok = await one(`SELECT id FROM boqs WHERE id = ? AND status = 'LOCKED'`, [req.params.boqId]);
  if (!ok) throw notFound('No such BOQ, or it is not locked yet');
  res.json(await many(
    `SELECT boq_line_id, sno, item_id, item_code, item_name, uom, make_name,
            effective_est, approved_qty, consumed_qty, available_qty
       FROM v_boq_line_status
      WHERE boq_id = ? AND approved_qty > 0
      ORDER BY sno`,
    [req.params.boqId]
  ));
}));

const linesSchema = z.array(z.object({
  boqLineId: z.coerce.number().int().positive(),
  qty: z.coerce.number().positive(),
  remark: z.string().trim().max(300).optional(),
})).min(1).max(300);

/** Check each line against what is at site. One rule, used by both paths. */
async function price(conn, boqId, lines) {
  const out = [];
  for (const l of lines) {
    const st = await one(
      `SELECT * FROM v_boq_line_status WHERE boq_line_id = ? AND boq_id = ?`,
      [l.boqLineId, boqId], conn
    );
    if (!st) throw badRequest('One of those lines is not on this BOQ');
    const available = round3(Number(st.available_qty));
    if (Number(st.approved_qty) <= 0) {
      throw conflict(
        `${st.item_code} — ${st.item_name}: nothing has been indented against this line yet.`,
        { boqLineId: st.boq_line_id, available: 0 }
      );
    }
    if (l.qty > available) {
      throw conflict(
        `${st.item_code} — ${st.item_name}: only ${available} is at site. ` +
        `${st.approved_qty} indented, ${st.consumed_qty} already used.`,
        { boqLineId: st.boq_line_id, available }
      );
    }
    out.push({ ...l, itemId: st.item_id, itemCode: st.item_code, itemName: st.item_name, available });
  }
  return out;
}

router.post('/evaluate',
  validate(z.object({ boqId: z.coerce.number().int().positive(), lines: linesSchema })),
  wrap(async (req, res) => {
    const priced = await price(null, req.body.boqId, req.body.lines);
    res.json({ lines: priced, total: priced.reduce((a, l) => a + Number(l.qty), 0) });
  })
);

const bodySchema = z.object({
  siteId: z.coerce.number().int().positive(),
  usedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  note: z.string().trim().max(300).optional(),
  lines: linesSchema,
});

router.post('/', validate(bodySchema.extend({ confirm: z.boolean().default(false) })),
  wrap(async (req, res) => {
    const b = req.body;
    const site = await one(
      `SELECT s.*, bq.id AS boq_id FROM sites s
         JOIN boqs bq ON bq.site_id = s.id AND bq.status = 'LOCKED'
        WHERE s.id = ? AND s.status = 'ACTIVE'`, [b.siteId]
    );
    if (!site) throw notFound('No such site, or it has no locked BOQ');

    const out = await tx(async (conn) => {
      const priced = await price(conn, site.boq_id, b.lines);
      const docNo = await nextDocNo(conn, 'CON', b.usedOn);
      const r = await run(
        `INSERT INTO consumptions (doc_no, site_id, branch_id, boq_id, used_on, status, note, recorded_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [docNo, site.id, site.branch_id, site.boq_id, b.usedOn,
         b.confirm ? 'CONFIRMED' : 'DRAFT', b.note || null, req.user?.id || null], conn
      );
      for (const l of priced) {
        await run(
          `INSERT INTO consumption_lines (consumption_id, boq_line_id, item_id, qty, remark)
           VALUES (?, ?, ?, ?, ?)`,
          [r.insertId, l.boqLineId, l.itemId, l.qty, l.remark || null], conn
        );
      }
      await log(conn, {
        entity: 'CONSUMPTION', entityId: r.insertId, docNo,
        action: b.confirm ? 'Confirmed' : 'Saved as a draft',
        detail: `${site.name} · ${priced.length} line(s)`, user: req.user,
      });
      return { id: r.insertId, docNo, status: b.confirm ? 'CONFIRMED' : 'DRAFT' };
    });
    res.status(201).json(out);
  })
);

router.put('/:id', validate(bodySchema.partial()), wrap(async (req, res) => {
  const c = await one(`SELECT * FROM consumptions WHERE id = ?`, [req.params.id]);
  if (!c) throw notFound('No such consumption entry');
  if (!EDITABLE.includes(c.status)) throw conflict('This entry is confirmed — it cannot be changed');
  await tx(async (conn) => {
    if (req.body.lines) {
      const priced = await price(conn, c.boq_id, req.body.lines);
      await run(`DELETE FROM consumption_lines WHERE consumption_id = ?`, [c.id], conn);
      for (const l of priced) {
        await run(
          `INSERT INTO consumption_lines (consumption_id, boq_line_id, item_id, qty, remark)
           VALUES (?, ?, ?, ?, ?)`,
          [c.id, l.boqLineId, l.itemId, l.qty, l.remark || null], conn
        );
      }
    }
    await run(
      `UPDATE consumptions SET used_on = COALESCE(?, used_on), note = COALESCE(?, note) WHERE id = ?`,
      [req.body.usedOn ?? null, req.body.note ?? null, c.id], conn
    );
    await log(conn, { entity: 'CONSUMPTION', entityId: c.id, docNo: c.doc_no, action: 'Draft updated', user: req.user });
  });
  res.json({ ok: true });
}));

/** Confirming is what makes it count. Re-checked, because the site may
    have consumed elsewhere since the draft was written. */
router.post('/:id/confirm', wrap(async (req, res) => {
  const c = await one(`SELECT * FROM consumptions WHERE id = ?`, [req.params.id]);
  if (!c) throw notFound('No such consumption entry');
  if (c.status === 'CONFIRMED') throw conflict('Already confirmed');
  const lines = await many(
    `SELECT boq_line_id AS boqLineId, qty FROM consumption_lines WHERE consumption_id = ?`, [c.id]);
  if (!lines.length) throw badRequest('There is nothing on this entry');

  await tx(async (conn) => {
    await price(conn, c.boq_id, lines);
    await run(`UPDATE consumptions SET status = 'CONFIRMED' WHERE id = ?`, [c.id], conn);
    await log(conn, { entity: 'CONSUMPTION', entityId: c.id, docNo: c.doc_no, action: 'Confirmed', user: req.user });
  });
  res.json({ ok: true, docNo: c.doc_no, status: 'CONFIRMED' });
}));

router.delete('/:id', wrap(async (req, res) => {
  const c = await one(`SELECT * FROM consumptions WHERE id = ?`, [req.params.id]);
  if (!c) throw notFound('No such consumption entry');
  if (c.status !== 'DRAFT') throw conflict('Only a draft can be deleted');
  await run(`DELETE FROM consumptions WHERE id = ?`, [c.id]);
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
    if (req.query.branchId) { where.push('c.branch_id = ?'); params.push(req.query.branchId); }
    if (req.query.siteId) { where.push('c.site_id = ?'); params.push(req.query.siteId); }
    const rows = await many(
      `SELECT c.id, c.doc_no, c.used_on, c.status, c.note, c.created_at,
              s.id AS site_id, s.name AS site_name, u.name AS recorded_by_name,
              (SELECT COUNT(*) FROM consumption_lines cl WHERE cl.consumption_id = c.id) AS line_count,
              (SELECT COALESCE(SUM(cl.qty),0) FROM consumption_lines cl WHERE cl.consumption_id = c.id) AS total_qty
         FROM consumptions c
         JOIN sites s ON s.id = c.site_id
         LEFT JOIN users u ON u.id = c.recorded_by
        ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
        ORDER BY c.used_on DESC, c.id DESC`,
      params
    );
    res.json({
      drafts: rows.filter((r) => r.status === 'DRAFT'),
      entries: rows.filter((r) => r.status !== 'DRAFT'),
    });
  })
);

router.get('/:id', wrap(async (req, res) => {
  const c = await one(
    `SELECT c.*, s.name AS site_name, u.name AS recorded_by_name, b.doc_no AS boq_doc_no
       FROM consumptions c
       JOIN sites s ON s.id = c.site_id
       LEFT JOIN users u ON u.id = c.recorded_by
       JOIN boqs b ON b.id = c.boq_id
      WHERE c.id = ?`, [req.params.id]
  );
  if (!c) throw notFound('No such consumption entry');
  const lines = await many(
    `SELECT cl.id, cl.qty, cl.remark, cl.boq_line_id,
            bl.sno, i.code AS item_code, i.name AS item_name, u.code AS uom,
            st.effective_est, st.approved_qty, st.consumed_qty, st.available_qty
       FROM consumption_lines cl
       JOIN boq_lines bl ON bl.id = cl.boq_line_id
       JOIN items i ON i.id = cl.item_id
       JOIN uoms u ON u.id = bl.uom_id
       LEFT JOIN v_boq_line_status st ON st.boq_line_id = bl.id
      WHERE cl.consumption_id = ? ORDER BY bl.sno`, [c.id]
  );
  res.json({
    id: c.id, docNo: c.doc_no, status: c.status, usedOn: c.used_on, note: c.note,
    site: { id: c.site_id, name: c.site_name },
    boqDocNo: c.boq_doc_no, recordedBy: c.recorded_by_name,
    canEdit: EDITABLE.includes(c.status),
    lines,
  });
}));

module.exports = router;
