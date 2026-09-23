'use strict';
const router = require('express').Router();
const { z } = require('zod');
const { many, one, run, tx } = require('../config/db');
const { validate, wrap } = require('../middleware/validate');
const { nextDocNo } = require('../lib/docNo');
const { log } = require('../lib/audit');
const { conflict, notFound, badRequest } = require('../lib/errors');
const { plural } = require('../lib/words');

/**
 * Delivery challans: store to site.
 *
 * Dispatching and acknowledging are two events, deliberately. What is
 * sent leaves the store at once — it is not there any more, whatever
 * happens next. What arrives becomes the site's only when the site
 * says it has it. The difference is in transit: it belongs to nobody,
 * and it stays on both screens until somebody accounts for it.
 *
 * A site may sign for part of a challan. The rest stays outstanding.
 */

const round3 = (n) => Math.round(Number(n) * 1000) / 1000;
const EDITABLE = ['DRAFT'];

/* ------------------------------------------------------------- list */
router.get('/',
  validate(z.object({
    branchId: z.coerce.number().int().positive().optional(),
    fromSiteId: z.coerce.number().int().positive().optional(),
    toSiteId: z.coerce.number().int().positive().optional(),
    // anything touching this site, sent or received
    siteId: z.coerce.number().int().positive().optional(),
    state: z.enum(['DRAFT', 'IN_TRANSIT', 'PART_ACK', 'ACKNOWLEDGED', 'CANCELLED',
      'PENDING', 'ALL']).default('ALL'),
    q: z.string().trim().optional(),
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    sort: z.enum(['date', 'oldest_out', 'site']).default('date'),
  }), 'query'),
  wrap(async (req, res) => {
    const where = [];
    const params = [];
    const q = req.query;
    if (q.branchId) { where.push('branch_id = ?'); params.push(q.branchId); }
    if (q.fromSiteId) { where.push('from_site_id = ?'); params.push(q.fromSiteId); }
    if (q.toSiteId) { where.push('to_site_id = ?'); params.push(q.toSiteId); }
    if (q.siteId) { where.push('(from_site_id = ? OR to_site_id = ?)'); params.push(q.siteId, q.siteId); }
    // everything still owing a signature
    if (q.state === 'PENDING') where.push(`state IN ('IN_TRANSIT','PART_ACK')`);
    else if (q.state !== 'ALL') { where.push('state = ?'); params.push(q.state); }
    if (q.from) { where.push('dc_date >= ?'); params.push(q.from); }
    if (q.to) { where.push('dc_date <= ?'); params.push(q.to); }
    if (q.q) {
      where.push('(doc_no LIKE ? OR to_name LIKE ? OR from_name LIKE ? OR vehicle_no LIKE ?)');
      const like = `%${q.q}%`;
      params.push(like, like, like, like);
    }
    const order = {
      date: 'dc_date DESC, dc_id DESC',
      oldest_out: 'days_out DESC, dc_date',
      site: 'to_name, dc_date DESC',
    }[q.sort];
    res.json(await many(
      `SELECT v.*,
              (SELECT GROUP_CONCAT(DISTINCT i.doc_no ORDER BY i.doc_no SEPARATOR ', ')
                 FROM dc_line_indents dli
                 JOIN delivery_challan_lines dl ON dl.id = dli.dc_line_id
                 JOIN indents i ON i.id = dli.indent_id
                WHERE dl.dc_id = v.dc_id) AS prns
         FROM v_dc_status v ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
        ORDER BY ${order}`, params));
  })
);

/* ----------------------------------------------------------- detail */
router.get('/:id', wrap(async (req, res) => {
  const dc = await one(`SELECT * FROM v_dc_status WHERE dc_id = ?`, [req.params.id]);
  if (!dc) throw notFound('No such challan');

  const lines = await many(
    `SELECT l.*,
            (SELECT GROUP_CONCAT(CONCAT(i.doc_no, ': ', TRIM(TRAILING '.' FROM TRIM(TRAILING '0' FROM ROUND(dli.qty, 3)))) ORDER BY i.doc_no SEPARATOR ' · ')
               FROM dc_line_indents dli JOIN indents i ON i.id = dli.indent_id
              WHERE dli.dc_line_id = l.dc_line_id) AS against
       FROM v_dc_line_status l WHERE l.dc_id = ? ORDER BY l.item_name`, [dc.dc_id]);

  const acks = await many(
    `SELECT a.id, a.ack_date, a.note, u.name AS acked_by_name, a.created_at,
            (SELECT COALESCE(SUM(al.qty), 0) FROM dc_acknowledgement_lines al
              WHERE al.ack_id = a.id) AS qty
       FROM dc_acknowledgements a LEFT JOIN users u ON u.id = a.acked_by
      WHERE a.dc_id = ? ORDER BY a.id`, [dc.dc_id]);

  // what each signature actually covered — a slip has to say what was
  // counted off the lorry, not just how much
  if (acks.length) {
    const al = await many(
      `SELECT al.ack_id, al.qty, al.remark, l.item_code, l.item_name, l.uom,
              l.rate, l.sent_qty, ROUND(al.qty * l.rate, 2) AS line_value
         FROM dc_acknowledgement_lines al
         JOIN v_dc_line_status l ON l.dc_line_id = al.dc_line_id
        WHERE al.ack_id IN (?) ORDER BY l.item_name`, [acks.map((a) => a.id)]);
    for (const a of acks) a.lines = al.filter((x) => x.ack_id === a.id);
  }

  // the PRNs this challan is answering, each with where it now stands
  const prns = await many(
    `SELECT p.indent_id, p.doc_no, p.needed_by, p.stage,
            p.indented_qty, p.issued_qty, p.at_site_qty, p.in_transit_qty, p.to_deliver_qty,
            ROUND(SUM(dli.qty), 3) AS on_this_dc
       FROM dc_line_indents dli
       JOIN delivery_challan_lines dl ON dl.id = dli.dc_line_id
       JOIN v_indent_pipeline p ON p.indent_id = dli.indent_id
      WHERE dl.dc_id = ?
      GROUP BY p.indent_id ORDER BY p.doc_no`, [dc.dc_id]);

  // every step this challan has been through, appended never edited
  const events = await many(
    `SELECT a.action, a.detail, a.created_at, u.name AS user_name
       FROM audit_log a LEFT JOIN users u ON u.id = a.user_id
      WHERE a.entity = 'DC' AND a.entity_id = ? ORDER BY a.id`, [dc.dc_id]);

  res.json({
    ...dc, lines, acks, prns, events,
    canEdit: EDITABLE.includes(dc.status),
    canDispatch: dc.status === 'DRAFT',
    canAck: ['DISPATCHED', 'PART_ACK'].includes(dc.status),
  });
}));

/* ----------------------------------------------------------- create */
const lineShape = z.object({
  // which PRN this quantity answers — optional, see writeLines
  indentId: z.coerce.number().int().positive().optional(),
  // or which transfer request, when the store has asked this site to
  // send material to another site against that site's PRN
  trId: z.coerce.number().int().positive().optional(),
  itemId: z.coerce.number().int().positive(),
  makeId: z.coerce.number().int().positive().nullable().optional(),
  qty: z.coerce.number().positive(),
  remark: z.string().trim().max(300).optional(),
});

/**
 * Write the lines, valued at what the store holds them at, and record
 * which PRN each quantity answers.
 *
 * One challan may answer several PRNs, but only of the same site — a
 * lorry goes to one place. Several PRNs asking for the same item become
 * ONE line on the challan; the split across them is recorded in
 * `dc_line_indents`, which is what lets each PRN say how much of itself
 * has been sent.
 *
 * The caller may name the PRN on each line (the store issuing against
 * its pending list) or leave it out, in which case the quantity is
 * attributed soonest-needed-first across whatever that site is owed.
 */
async function writeLines(conn, dcId, fromSiteId, toSiteId, lines) {
  const owed = await many(
    `SELECT f.indent_id, f.item_id, f.to_deliver_qty, i.needed_by, i.indent_date
       FROM v_indent_item_flow f JOIN indents i ON i.id = f.indent_id
      WHERE i.site_id = ? AND i.status = 'APPROVED' AND f.to_deliver_qty > 0
      ORDER BY i.needed_by IS NULL, i.needed_by, i.indent_date, i.id`, [toSiteId], conn);
  const owes = (indentId, itemId) => Number(
    (owed.find((o) => o.indent_id === indentId && o.item_id === itemId) || {}).to_deliver_qty || 0);

  // several PRNs asking for the same item are one line on the lorry
  const byItem = new Map();
  for (const l of lines) {
    const key = `${l.itemId}:${l.makeId || 0}`;
    const at = byItem.get(key) || { itemId: l.itemId, makeId: l.makeId || null, qty: 0,
      remark: l.remark || null, prns: [], trs: [] };
    at.qty = round3(at.qty + Number(l.qty));
    if (l.indentId) at.prns.push({ indentId: l.indentId, qty: Number(l.qty) });
    if (l.trId) at.trs.push({ trId: l.trId, qty: Number(l.qty) });
    byItem.set(key, at);
  }

  // a PRN named on a line has to be this site's, approved, and still owed
  const named = [...new Set(lines.filter((l) => l.indentId).map((l) => l.indentId))];
  if (named.length) {
    const rows = await many(
      `SELECT id, doc_no, site_id, status FROM indents WHERE id IN (?)`, [named], conn);
    for (const id of named) {
      const ind = rows.find((r) => r.id === id);
      if (!ind) throw badRequest('One of those PRNs does not exist');
      if (ind.site_id !== toSiteId) {
        throw badRequest(`${ind.doc_no} belongs to another site. One challan goes to one site.`);
      }
      if (ind.status !== 'APPROVED') throw conflict(`${ind.doc_no} is not approved`);
    }
  }

  // a transfer request named on a line has to be accepted, and has to
  // be this pair of sites, in this direction
  const namedTrs = [...new Set(lines.filter((l) => l.trId).map((l) => l.trId))];
  const trIndent = new Map();
  if (namedTrs.length) {
    const rows = await many(
      `SELECT id, doc_no, from_site_id, to_site_id, indent_id, status
         FROM transfer_requests WHERE id IN (?)`, [namedTrs], conn);
    for (const id of namedTrs) {
      const r = rows.find((x) => x.id === id);
      if (!r) throw badRequest('One of those transfer requests does not exist');
      if (r.status !== 'ACCEPTED') {
        throw conflict(`${r.doc_no} has not been accepted, so nothing can be sent against it`);
      }
      if (r.from_site_id !== fromSiteId || r.to_site_id !== toSiteId) {
        throw badRequest(`${r.doc_no} is between two other sites`);
      }
      // the request exists to answer a PRN, so the quantity answers it
      trIndent.set(id, r.indent_id);
    }
  }

  for (const l of byItem.values()) {
    const item = await one(`SELECT id, uom_id, code, name FROM items WHERE id = ?`, [l.itemId], conn);
    if (!item) throw badRequest('One of those items is not in the master');

    const st = await one(
      `SELECT qty, latest_rate FROM v_stock_balance WHERE site_id = ? AND item_id = ?`,
      [fromSiteId, l.itemId], conn);
    const held = Number(st?.qty || 0);
    if (l.qty > held + 0.0005) {
      throw conflict(
        `${item.code} — ${item.name}: the store holds ${round3(held)}, so ${l.qty} cannot be sent.`,
        { itemId: l.itemId, available: Math.max(held, 0) }
      );
    }

    const line = await run(
      `INSERT INTO delivery_challan_lines (dc_id, item_id, make_id, uom_id, qty, rate, remark)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [dcId, l.itemId, l.makeId, item.uom_id, l.qty, Number(st?.latest_rate || 0),
       l.remark || null], conn);

    for (const t of l.trs) {
      const asked = await one(
        `SELECT requested_qty, sent_qty FROM v_tr_line_status WHERE tr_id = ? AND item_id = ?`,
        [t.trId, l.itemId], conn);
      if (!asked) throw badRequest(`${item.code} — ${item.name} is not on that transfer request`);
      const room = round3(Number(asked.requested_qty) - Number(asked.sent_qty));
      if (t.qty > room + 0.0005) {
        const r = await one(`SELECT doc_no FROM transfer_requests WHERE id = ?`, [t.trId], conn);
        throw conflict(
          `${item.code} — ${item.name}: ${r.doc_no} still asks for ${round3(room)}, `
          + `so ${t.qty} cannot be sent against it.`,
          { trId: t.trId, itemId: l.itemId, available: Math.max(room, 0) }
        );
      }
      await run(
        `INSERT INTO dc_line_trs (dc_line_id, tr_id, qty) VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE qty = qty + VALUES(qty)`,
        [line.insertId, t.trId, t.qty], conn);

      // and it answers the PRN behind the request, so the receiving
      // site's requirement closes out exactly as if the store had sent it
      const indentId = trIndent.get(t.trId);
      const roomOnPrn = owes(indentId, l.itemId);
      if (roomOnPrn > 0.0005) {
        await run(
          `INSERT INTO dc_line_indents (dc_line_id, indent_id, qty) VALUES (?, ?, ?)
           ON DUPLICATE KEY UPDATE qty = qty + VALUES(qty)`,
          [line.insertId, indentId, round3(Math.min(t.qty, roomOnPrn))], conn);
      }
    }

    if (l.prns.length) {
      // the store said which PRN each part answers, so record that
      for (const p of l.prns) {
        const room = owes(p.indentId, l.itemId);
        if (p.qty > room + 0.0005) {
          const ind = await one(`SELECT doc_no FROM indents WHERE id = ?`, [p.indentId], conn);
          throw conflict(
            `${item.code} — ${item.name}: ${ind.doc_no} is still owed ${round3(room)}, `
            + `so ${p.qty} cannot be sent against it.`,
            { indentId: p.indentId, itemId: l.itemId, available: room }
          );
        }
        await run(
          `INSERT INTO dc_line_indents (dc_line_id, indent_id, qty) VALUES (?, ?, ?)
           ON DUPLICATE KEY UPDATE qty = qty + VALUES(qty)`,
          [line.insertId, p.indentId, p.qty], conn);
      }
    } else if (!l.trs.length) {
      // nobody said: soonest needed first. The site may be owed less
      // than is being sent — extra stock is allowed to travel, it
      // simply answers no particular PRN.
      let left = l.qty;
      for (const o of owed.filter((x) => x.item_id === l.itemId)) {
        if (left <= 0.0005) break;
        const take = round3(Math.min(left, Number(o.to_deliver_qty)));
        if (take <= 0) continue;
        left = round3(left - take);
        await run(
          `INSERT INTO dc_line_indents (dc_line_id, indent_id, qty) VALUES (?, ?, ?)
           ON DUPLICATE KEY UPDATE qty = qty + VALUES(qty)`,
          [line.insertId, o.indent_id, take], conn);
      }
    }
  }
}

router.post('/',
  validate(z.object({
    fromSiteId: z.coerce.number().int().positive(),
    toSiteId: z.coerce.number().int().positive(),
    dcDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    vehicleNo: z.string().trim().max(32).optional(),
    driver: z.string().trim().max(120).optional(),
    note: z.string().trim().max(400).optional(),
    dispatch: z.boolean().default(false),
    lines: z.array(lineShape).min(1).max(300),
  })),
  wrap(async (req, res) => {
    const b = req.body;
    if (b.fromSiteId === b.toSiteId) throw badRequest('A challan cannot go where it came from');
    const from = await one(`SELECT * FROM sites WHERE id = ?`, [b.fromSiteId]);
    const to = await one(`SELECT * FROM sites WHERE id = ?`, [b.toSiteId]);
    if (!from || !to) throw badRequest('No such site');
    if (from.branch_id !== to.branch_id) throw badRequest('Those are in different branches');

    const out = await tx(async (conn) => {
      const docNo = await nextDocNo(conn, 'DC', b.dcDate);
      const dc = await run(
        `INSERT INTO delivery_challans (doc_no, branch_id, from_site_id, to_site_id, dc_date,
                                        status, vehicle_no, driver, note, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [docNo, from.branch_id, from.id, to.id, b.dcDate, b.dispatch ? 'DISPATCHED' : 'DRAFT',
         b.vehicleNo || null, b.driver || null, b.note || null, req.user?.id || null], conn);

      await writeLines(conn, dc.insertId, from.id, to.id, b.lines);

      if (b.dispatch) await dispatchNow(conn, dc.insertId, req.user);
      await log(conn, { entity: 'DC', entityId: dc.insertId, docNo,
        action: b.dispatch ? 'Dispatched' : 'Drafted',
        detail: `${from.name} → ${to.name} · ${plural(b.lines.length, 'line')}`, user: req.user });
      return { id: dc.insertId, docNo };
    });

    const v = await one(`SELECT * FROM v_dc_status WHERE dc_id = ?`, [out.id]);
    res.status(201).json({ ...out, state: v.state, sentQty: v.sent_qty, value: v.dc_value });
  })
);

/** Leaving the store: the stock goes out now, not when it arrives. */
async function dispatchNow(conn, dcId, user) {
  const dc = await one(`SELECT * FROM delivery_challans WHERE id = ? FOR UPDATE`, [dcId], conn);
  const lines = await many(`SELECT * FROM delivery_challan_lines WHERE dc_id = ?`, [dcId], conn);
  if (!lines.length) throw badRequest('There is nothing on this challan');

  for (const l of lines) {
    const st = await one(
      `SELECT qty FROM v_stock_balance WHERE site_id = ? AND item_id = ?`,
      [dc.from_site_id, l.item_id], conn);
    if (Number(l.qty) > Number(st?.qty || 0) + 0.0005) {
      const it = await one(`SELECT code, name FROM items WHERE id = ?`, [l.item_id], conn);
      throw conflict(
        `${it.code} — ${it.name}: the store now holds ${round3(Number(st?.qty || 0))}, `
        + `so ${l.qty} cannot leave.`
      );
    }
    await run(
      `INSERT INTO stock_movements (site_id, item_id, make_id, qty, rate, kind,
                                    ref_type, ref_id, ref_no, moved_on, created_by)
       VALUES (?, ?, ?, ?, ?, 'DC_OUT', 'DC', ?, ?, ?, ?)`,
      [dc.from_site_id, l.item_id, l.make_id, -Number(l.qty), l.rate, dcId, dc.doc_no,
       dc.dc_date, user?.id || null], conn);
  }
  await run(
    `UPDATE delivery_challans SET status = 'DISPATCHED', dispatched_at = NOW(), dispatched_by = ?
      WHERE id = ?`, [user?.id || null, dcId], conn);
}

router.post('/:id/dispatch', wrap(async (req, res) => {
  const dc = await one(`SELECT * FROM delivery_challans WHERE id = ?`, [req.params.id]);
  if (!dc) throw notFound('No such challan');
  if (dc.status !== 'DRAFT') throw conflict(`This challan is ${dc.status.toLowerCase()}`);
  await tx(async (conn) => {
    await dispatchNow(conn, dc.id, req.user);
    await log(conn, { entity: 'DC', entityId: dc.id, docNo: dc.doc_no,
      action: 'Dispatched', user: req.user });
  });
  const v = await one(`SELECT * FROM v_dc_status WHERE dc_id = ?`, [dc.id]);
  res.json({ ok: true, state: v.state, inTransitQty: v.in_transit_qty });
}));

/* ---------------------------------------------------- acknowledged */
/** What is still unaccounted for on this challan, for whoever signs. */
router.get('/:id/pending', wrap(async (req, res) => {
  const dc = await one(`SELECT * FROM v_dc_status WHERE dc_id = ?`, [req.params.id]);
  if (!dc) throw notFound('No such challan');
  const lines = await many(
    `SELECT * FROM v_dc_line_status WHERE dc_id = ? AND in_transit_qty > 0 ORDER BY item_name`,
    [dc.dc_id]);
  res.json({ dcId: dc.dc_id, docNo: dc.doc_no, from: dc.from_name, to: dc.to_name,
    toSiteId: dc.to_site_id, lines });
}));

router.post('/:id/acknowledge',
  validate(z.object({
    ackDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    note: z.string().trim().max(400).optional(),
    lines: z.array(z.object({
      dcLineId: z.coerce.number().int().positive(),
      qty: z.coerce.number().positive(),
      remark: z.string().trim().max(300).optional(),
    })).min(1).max(300),
  })),
  wrap(async (req, res) => {
    const dc = await one(`SELECT * FROM delivery_challans WHERE id = ?`, [req.params.id]);
    if (!dc) throw notFound('No such challan');
    if (!['DISPATCHED', 'PART_ACK'].includes(dc.status)) {
      throw conflict(dc.status === 'DRAFT'
        ? 'This challan has not left the store yet'
        : `This challan is ${dc.status.toLowerCase()}`);
    }

    await tx(async (conn) => {
      const ack = await run(
        `INSERT INTO dc_acknowledgements (dc_id, ack_date, note, acked_by) VALUES (?, ?, ?, ?)`,
        [dc.id, req.body.ackDate, req.body.note || null, req.user?.id || null], conn);

      for (const l of req.body.lines) {
        const st = await one(
          `SELECT s.*, dl.make_id FROM v_dc_line_status s
             JOIN delivery_challan_lines dl ON dl.id = s.dc_line_id
            WHERE s.dc_line_id = ? AND s.dc_id = ?`, [l.dcLineId, dc.id], conn);
        if (!st) throw badRequest('One of those lines is not on this challan');
        if (l.qty > Number(st.in_transit_qty) + 0.0005) {
          throw conflict(
            `${st.item_code} — ${st.item_name}: ${st.in_transit_qty} is still unaccounted for, `
            + `so ${l.qty} cannot be received.`,
            { dcLineId: l.dcLineId, available: Number(st.in_transit_qty) }
          );
        }
        await run(
          `INSERT INTO dc_acknowledgement_lines (ack_id, dc_line_id, qty, remark)
           VALUES (?, ?, ?, ?)`,
          [ack.insertId, l.dcLineId, l.qty, l.remark || null], conn);
        // signing for it is what puts it on the site's books
        await run(
          `INSERT INTO stock_movements (site_id, item_id, make_id, qty, rate, kind,
                                        ref_type, ref_id, ref_no, moved_on, created_by)
           VALUES (?, ?, ?, ?, ?, 'DC_IN', 'DC', ?, ?, ?, ?)`,
          [dc.to_site_id, st.item_id, st.make_id, l.qty, st.rate, dc.id, dc.doc_no,
           req.body.ackDate, req.user?.id || null], conn);
      }

      const after = await one(
        `SELECT COALESCE(SUM(in_transit_qty), 0) AS left_qty FROM v_dc_line_status WHERE dc_id = ?`,
        [dc.id], conn);
      const done = Number(after.left_qty) <= 0.0005;
      await run(`UPDATE delivery_challans SET status = ? WHERE id = ?`,
        [done ? 'ACKNOWLEDGED' : 'PART_ACK', dc.id], conn);

      await log(conn, { entity: 'DC', entityId: dc.id, docNo: dc.doc_no,
        action: done ? 'Received in full' : 'Part received',
        detail: done ? '' : `${round3(Number(after.left_qty))} still unaccounted for`,
        user: req.user });
    });

    const v = await one(`SELECT * FROM v_dc_status WHERE dc_id = ?`, [dc.id]);
    res.status(201).json({ ok: true, state: v.state, inTransitQty: v.in_transit_qty });
  })
);

/* ----------------------------------------------------- housekeeping */
router.put('/:id',
  validate(z.object({
    dcDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    vehicleNo: z.string().trim().max(32).optional(),
    driver: z.string().trim().max(120).optional(),
    note: z.string().trim().max(400).optional(),
    lines: z.array(lineShape).min(1).max(300).optional(),
  })),
  wrap(async (req, res) => {
    const dc = await one(`SELECT * FROM delivery_challans WHERE id = ?`, [req.params.id]);
    if (!dc) throw notFound('No such challan');
    if (!EDITABLE.includes(dc.status)) throw conflict('Only a draft challan can be edited');
    const b = req.body;
    await tx(async (conn) => {
      await run(
        `UPDATE delivery_challans SET dc_date = COALESCE(?, dc_date),
                vehicle_no = COALESCE(?, vehicle_no), driver = COALESCE(?, driver),
                note = COALESCE(?, note) WHERE id = ?`,
        [b.dcDate ?? null, b.vehicleNo ?? null, b.driver ?? null, b.note ?? null, dc.id], conn);
      if (b.lines) {
        await run(`DELETE FROM delivery_challan_lines WHERE dc_id = ?`, [dc.id], conn);
        await writeLines(conn, dc.id, dc.from_site_id, dc.to_site_id, b.lines);
      }
      await log(conn, { entity: 'DC', entityId: dc.id, docNo: dc.doc_no,
        action: 'Edited', user: req.user });
    });
    res.json({ ok: true });
  })
);

router.delete('/:id', wrap(async (req, res) => {
  const dc = await one(`SELECT * FROM delivery_challans WHERE id = ?`, [req.params.id]);
  if (!dc) throw notFound('No such challan');
  if (dc.status !== 'DRAFT') throw conflict('Only a draft challan can be deleted');
  await run(`DELETE FROM delivery_challans WHERE id = ?`, [dc.id]);
  res.json({ ok: true });
}));

module.exports = router;
