'use strict';
const router = require('express').Router();
const { z } = require('zod');
const { many, one, run, tx } = require('../config/db');
const { validate, wrap } = require('../middleware/validate');
const { nextDocNo } = require('../lib/docNo');
const { centralRate } = require('../lib/rates');
const { log } = require('../lib/audit');
const { conflict, notFound, badRequest } = require('../lib/errors');
const { plural } = require('../lib/words');

/**
 * Issuing material for consumption, and taking it back.
 *
 * This is the last hop. Everything before it — order, receipt, challan,
 * acknowledgement — moves material between places that are answerable
 * for it. This moves it into a person's hands, and that is where it
 * stops being stock and starts being cost.
 *
 * Two rules worth stating out loud.
 *
 * A site cannot issue what it does not hold. The check is against the
 * same balance view the store uses, and it is done inside the
 * transaction under the row that is about to be written, so two people
 * issuing the last coil of wire at the same moment cannot both win.
 *
 * The rate is read once and written down. Everywhere else this schema
 * refuses to store a number it could derive; here it stores one on
 * purpose, because the cost of a thing is what it cost on the day, and
 * a report whose past changes when the store buys at a new price is
 * worthless. See lib/rates.js for where the number comes from.
 */

const round3 = (n) => Math.round(Number(n) * 1000) / 1000;
const money = (n) => Math.round(Number(n) * 100) / 100;
const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');

async function requireSite(id, conn) {
  const s = await one(
    `SELECT id, code, name, site_type, branch_id FROM sites WHERE id = ?`, [id], conn);
  if (!s) throw notFound('No such site');
  return s;
}

/** What this site is holding of one item, right now. */
async function onHand(conn, siteId, itemId) {
  const r = await one(
    `SELECT COALESCE(SUM(qty), 0) AS qty FROM stock_movements
      WHERE site_id = ? AND item_id = ?`, [siteId, itemId], conn);
  return Number(r?.qty || 0);
}

/**
 * How much of an item was issued and has not come back — for one
 * person if a name is given, for the whole site otherwise.
 *
 * This is the cap on a return and nothing else. It is emphatically
 * not a balance somebody is carrying: material issued and not
 * returned has been used, which is what issuing it means. All this
 * number does is stop a return inventing stock that never left. It does not price
 * anything: a return is struck at the central store's rate on the day
 * it comes back, the same way an issue is, so that a day's cost is
 * that day's net quantity at that day's rate. The weighted average it
 * also returns is carried for the screens that want to show what the
 * outstanding material is worth, not for costing a document.
 */
async function outstanding(conn, siteId, itemId, person) {
  const where = ['site_id = ?', 'item_id = ?'];
  const params = [siteId, itemId];
  if (person) { where.push('person = ?'); params.push(person); }
  const r = await one(
    `SELECT COALESCE(SUM(qty), 0) AS qty, COALESCE(SUM(value), 0) AS value
       FROM v_consumption_event WHERE ${where.join(' AND ')}`, params, conn);
  const qty = Number(r?.qty || 0);
  const value = Number(r?.value || 0);
  return { qty, value, rate: qty > 0 ? Math.round((value / qty) * 100) / 100 : 0 };
}

const itemLabel = async (conn, id) => {
  const it = await one(`SELECT code, name FROM items WHERE id = ?`, [id], conn);
  return it ? `${it.code} — ${it.name}` : `Item ${id}`;
};

/* ==================================================================
   ISSUE — off the shelf, into someone's hands
   ================================================================== */

const issueBody = z.object({
  siteId: z.coerce.number().int().positive(),
  usedOn: DATE,
  issuedTo: z.string().trim().min(1, 'Say who it went to').max(160),
  issuedToUserId: z.coerce.number().int().positive().optional(),
  purpose: z.string().trim().max(300).optional(),
  note: z.string().trim().max(300).optional(),
  lines: z.array(z.object({
    itemId: z.coerce.number().int().positive(),
    makeId: z.coerce.number().int().positive().optional(),
    qty: z.coerce.number().positive('A quantity is needed'),
    remark: z.string().trim().max(300).optional(),
  })).min(1, 'Nothing to issue').max(200),
});

router.post('/issues', validate(issueBody), wrap(async (req, res) => {
  const b = req.body;
  const site = await requireSite(b.siteId);

  // one row per item: two lines of the same thing on one slip is a
  // typing mistake, not an intention
  const seen = new Set();
  for (const l of b.lines) {
    const key = `${l.itemId}:${l.makeId || 0}`;
    if (seen.has(key)) {
      throw badRequest(`${await itemLabel(null, l.itemId)} is on this issue twice`);
    }
    seen.add(key);
  }

  const out = await tx(async (conn) => {
    const docNo = await nextDocNo(conn, 'CON', b.usedOn);
    const boq = await one(
      `SELECT id FROM boqs WHERE site_id = ? ORDER BY id DESC LIMIT 1`, [site.id], conn);

    const con = await run(
      `INSERT INTO consumptions
         (doc_no, site_id, branch_id, boq_id, used_on, issued_to_name, issued_to_user_id,
          purpose, status, note, recorded_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'CONFIRMED', ?, ?)`,
      [docNo, site.id, site.branch_id, boq?.id || null, b.usedOn, b.issuedTo,
       b.issuedToUserId || null, b.purpose || null, b.note || null, req.user?.id || null],
      conn);

    let value = 0;
    for (const l of b.lines) {
      const have = await onHand(conn, site.id, l.itemId);
      if (Number(l.qty) > have + 0.0005) {
        throw conflict(
          `${await itemLabel(conn, l.itemId)}: the site holds ${round3(have)}, `
          + `so ${round3(l.qty)} cannot be issued.`,
          { itemId: l.itemId, available: round3(have) }
        );
      }

      const { rate } = await centralRate(conn,
        { branchId: site.branch_id, siteId: site.id, itemId: l.itemId, asOf: b.usedOn });
      const uom = await one(`SELECT uom_id FROM items WHERE id = ?`, [l.itemId], conn);

      await run(
        `INSERT INTO consumption_lines
           (consumption_id, boq_line_id, item_id, make_id, uom_id, qty, rate, remark)
         VALUES (?, NULL, ?, ?, ?, ?, ?, ?)`,
        [con.insertId, l.itemId, l.makeId || null, uom?.uom_id || null,
         l.qty, rate, l.remark || null], conn);

      // off the shelf
      await run(
        `INSERT INTO stock_movements (site_id, item_id, make_id, qty, rate, kind,
                                      ref_type, ref_id, ref_no, moved_on, created_by)
         VALUES (?, ?, ?, ?, ?, 'ISSUE', 'CON', ?, ?, ?, ?)`,
        [site.id, l.itemId, l.makeId || null, -Number(l.qty), rate,
         con.insertId, docNo, b.usedOn, req.user?.id || null], conn);

      value += Number(l.qty) * rate;
    }

    await log(conn, {
      entity: 'CON', entityId: con.insertId, docNo, action: 'Issued',
      detail: `${site.name} → ${b.issuedTo} · ${plural(b.lines.length, 'line')} · ₹${money(value)}`,
      user: req.user,
    });
    return { id: con.insertId, docNo, value: money(value) };
  });

  const v = await one(`SELECT * FROM v_consumption_status WHERE consumption_id = ?`, [out.id]);
  res.status(201).json({ ...out, issuedQty: v.issued_qty, issuedValue: v.issued_value });
}));

/* ------------------------------------------------------- the register */
router.get('/issues',
  validate(z.object({
    branchId: z.coerce.number().int().positive().optional(),
    siteId: z.coerce.number().int().positive().optional(),
    person: z.string().trim().optional(),
    itemId: z.coerce.number().int().positive().optional(),
    from: DATE.optional(),
    to: DATE.optional(),
    q: z.string().trim().optional(),
    limit: z.coerce.number().int().min(1).max(500).default(200),
  }), 'query'),
  wrap(async (req, res) => {
    const q = req.query;
    const where = [`v.status = 'CONFIRMED'`];
    const params = [];
    if (q.branchId) { where.push('v.branch_id = ?'); params.push(q.branchId); }
    if (q.siteId) { where.push('v.site_id = ?'); params.push(q.siteId); }
    if (q.person) { where.push('v.issued_to LIKE ?'); params.push(`%${q.person}%`); }
    if (q.from) { where.push('v.used_on >= ?'); params.push(q.from); }
    if (q.to) { where.push('v.used_on <= ?'); params.push(q.to); }
    if (q.itemId) {
      where.push(`EXISTS (SELECT 1 FROM consumption_lines cl
                           WHERE cl.consumption_id = v.consumption_id AND cl.item_id = ?)`);
      params.push(q.itemId);
    }
    if (q.q) {
      where.push('(v.doc_no LIKE ? OR v.issued_to LIKE ? OR v.purpose LIKE ?)');
      const like = `%${q.q}%`;
      params.push(like, like, like);
    }
    const rows = await many(
      `SELECT * FROM v_consumption_status v
        WHERE ${where.join(' AND ')}
        ORDER BY v.used_on DESC, v.consumption_id DESC
        LIMIT ${q.limit}`, params);
    res.json({
      rows,
      totals: {
        issues: rows.length,
        qty: rows.reduce((t, r) => t + Number(r.issued_qty), 0),
        value: money(rows.reduce((t, r) => t + Number(r.issued_value), 0)),
        people: new Set(rows.map((r) => r.issued_to)).size,
      },
    });
  })
);

router.get('/issues/:id', wrap(async (req, res) => {
  const head = await one(
    `SELECT * FROM v_consumption_status WHERE consumption_id = ?`, [req.params.id]);
  if (!head) throw notFound('No such issue');
  const lines = await many(
    `SELECT * FROM v_consumption_line WHERE consumption_id = ? ORDER BY item_name`,
    [head.consumption_id]);
  // what the people on this slip still have out. A return no longer
  // names the issue it undoes — nobody could tell you — so this is
  // answered per person, which is the handle that does exist.
  const withThem = await many(
    `SELECT person, item_code, item_name, uom, open_qty
       FROM v_person_outstanding
      WHERE site_id = ? AND person = ? AND open_qty > 0.0005
      ORDER BY item_name`, [head.site_id, head.issued_to]);
  res.json({ head, lines, withThem });
}));

/* ==================================================================
   RETURN — back on the shelf, and the cost given back
   ================================================================== */

const returnBody = z.object({
  siteId: z.coerce.number().int().positive(),
  returnedOn: DATE,
  returnedBy: z.string().trim().min(1, 'Say who is returning it').max(160),
  returnedByUserId: z.coerce.number().int().positive().optional(),
  reason: z.string().trim().max(300).optional(),
  lines: z.array(z.object({
    itemId: z.coerce.number().int().positive(),
    makeId: z.coerce.number().int().positive().optional(),
    qty: z.coerce.number().positive('A quantity is needed'),
    remark: z.string().trim().max(300).optional(),
  })).min(1, 'Nothing to return').max(200),
});

router.post('/returns', validate(returnBody), wrap(async (req, res) => {
  const b = req.body;
  const site = await requireSite(b.siteId);
  const person = b.returnedBy.trim();

  const seen = new Set();
  for (const l of b.lines) {
    const key = `${l.itemId}:${l.makeId || 0}`;
    if (seen.has(key)) {
      throw badRequest(`${await itemLabel(null, l.itemId)} is on this return twice`);
    }
    seen.add(key);
  }

  const out = await tx(async (conn) => {
    const docNo = await nextDocNo(conn, 'RET', b.returnedOn);
    const ret = await run(
      `INSERT INTO stock_returns
         (doc_no, site_id, branch_id, returned_on, returned_by_name, returned_by_user_id,
          reason, status, recorded_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'CONFIRMED', ?)`,
      [docNo, site.id, site.branch_id, b.returnedOn, person,
       b.returnedByUserId || null, b.reason || null, req.user?.id || null], conn);

    let value = 0;
    for (const l of b.lines) {
      const open = await outstanding(conn, site.id, l.itemId, person);

      if (Number(l.qty) > open.qty + 0.0005) {
        throw conflict(
          `${await itemLabel(conn, l.itemId)}: ${round3(open.qty)} was issued `
          + `to ${person} and has not come back, so ${round3(l.qty)} cannot be returned.`,
          { itemId: l.itemId, available: round3(open.qty) }
        );
      }

      // Priced the same way an issue is: what the central store was
      // holding it at on the day it moved. A day's cost is that day's
      // net quantity at that day's rate, so the two sides of a day
      // must be struck at the same price.
      const { rate } = await centralRate(conn,
        { branchId: site.branch_id, siteId: site.id, itemId: l.itemId, asOf: b.returnedOn });

      const uom = await one(`SELECT uom_id FROM items WHERE id = ?`, [l.itemId], conn);
      await run(
        `INSERT INTO stock_return_lines
           (return_id, item_id, make_id, uom_id, qty, rate, remark)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [ret.insertId, l.itemId, l.makeId || null, uom?.uom_id || null,
         l.qty, rate, l.remark || null], conn);

      // back on the shelf
      await run(
        `INSERT INTO stock_movements (site_id, item_id, make_id, qty, rate, kind,
                                      ref_type, ref_id, ref_no, moved_on, created_by)
         VALUES (?, ?, ?, ?, ?, 'RETURN', 'RET', ?, ?, ?, ?)`,
        [site.id, l.itemId, l.makeId || null, Number(l.qty), rate,
         ret.insertId, docNo, b.returnedOn, req.user?.id || null], conn);

      value += Number(l.qty) * rate;
    }

    await log(conn, {
      entity: 'RET', entityId: ret.insertId, docNo, action: 'Returned',
      detail: `${person} → ${site.name} · ${plural(b.lines.length, 'line')} · ₹${money(value)}`,
      user: req.user,
    });
    return { id: ret.insertId, docNo, value: money(value) };
  });

  const v = await one(`SELECT * FROM v_return_status WHERE return_id = ?`, [out.id]);
  res.status(201).json({ ...out, returnedQty: v.returned_qty, returnedValue: v.returned_value });
}));

router.get('/returns',
  validate(z.object({
    branchId: z.coerce.number().int().positive().optional(),
    siteId: z.coerce.number().int().positive().optional(),
    person: z.string().trim().optional(),
    itemId: z.coerce.number().int().positive().optional(),
    from: DATE.optional(),
    to: DATE.optional(),
    q: z.string().trim().optional(),
    limit: z.coerce.number().int().min(1).max(500).default(200),
  }), 'query'),
  wrap(async (req, res) => {
    const q = req.query;
    const where = [`v.status = 'CONFIRMED'`];
    const params = [];
    if (q.branchId) { where.push('v.branch_id = ?'); params.push(q.branchId); }
    if (q.siteId) { where.push('v.site_id = ?'); params.push(q.siteId); }
    if (q.person) { where.push('v.returned_by LIKE ?'); params.push(`%${q.person}%`); }
    if (q.from) { where.push('v.returned_on >= ?'); params.push(q.from); }
    if (q.to) { where.push('v.returned_on <= ?'); params.push(q.to); }
    if (q.itemId) {
      where.push(`EXISTS (SELECT 1 FROM stock_return_lines rl
                           WHERE rl.return_id = v.return_id AND rl.item_id = ?)`);
      params.push(q.itemId);
    }
    if (q.q) {
      where.push('(v.doc_no LIKE ? OR v.returned_by LIKE ? OR v.reason LIKE ?)');
      const like = `%${q.q}%`;
      params.push(like, like, like);
    }
    const rows = await many(
      `SELECT * FROM v_return_status v
        WHERE ${where.join(' AND ')}
        ORDER BY v.returned_on DESC, v.return_id DESC
        LIMIT ${q.limit}`, params);
    res.json({
      rows,
      totals: {
        returns: rows.length,
        qty: rows.reduce((t, r) => t + Number(r.returned_qty), 0),
        value: money(rows.reduce((t, r) => t + Number(r.returned_value), 0)),
      },
    });
  })
);

router.get('/returns/:id', wrap(async (req, res) => {
  const head = await one(`SELECT * FROM v_return_status WHERE return_id = ?`, [req.params.id]);
  if (!head) throw notFound('No such return');
  const lines = await many(
    `SELECT * FROM v_return_line WHERE return_id = ? ORDER BY item_name`, [head.return_id]);
  res.json({ head, lines });
}));

/* ==================================================================
   What the two screens need before they can be filled in.
   ================================================================== */

/**
 * What this site can issue right now — its shelf, priced the way the
 * issue will price it, so the person typing sees the cost before they
 * commit to it rather than after.
 */
router.get('/issuable/:siteId',
  validate(z.object({
    q: z.string().trim().optional(),
    // the rate shown must be the rate that will be stamped, so a
    // backdated slip quotes the price of the day it is dated
    asOf: DATE.optional(),
  }), 'query'),
  wrap(async (req, res) => {
    const site = await requireSite(req.params.siteId);
    const params = [site.id];
    let filter = '';
    if (req.query.q) {
      filter = 'AND (b.item_name LIKE ? OR b.item_code LIKE ?)';
      params.push(`%${req.query.q}%`, `%${req.query.q}%`);
    }
    const rows = await many(
      `SELECT b.item_id, b.item_code, b.item_name, b.uom, b.category_id, b.qty AS on_hand
         FROM v_stock_balance b
        WHERE b.site_id = ? AND b.qty > 0 ${filter}
        ORDER BY b.item_name`, params);

    const asOf = req.query.asOf || null;
    for (const r of rows) {
      const { rate, source } = await centralRate(null,
        { branchId: site.branch_id, siteId: site.id, itemId: r.item_id, asOf });
      r.rate = rate;
      r.rate_source = source;
    }
    res.json({ site, asOf, rows });
  })
);

/**
 * What may come back.
 *
 * Keyed on the person, because the system already knows exactly who
 * every item went to — nobody should be asked to remember, or to
 * type. Name the person and this is what they took and have not
 * brought back: a short, exact list instead of the site's whole
 * shelf, and the cap on every line of the return.
 *
 * With no person it answers for the whole site, which is what the
 * audit wants; the return screen always names one.
 */
router.get('/returnable/:siteId',
  validate(z.object({
    person: z.string().trim().optional(),
    q: z.string().trim().optional(),
  }), 'query'),
  wrap(async (req, res) => {
    const site = await requireSite(req.params.siteId);
    const person = (req.query.person || '').trim();

    const where = ['e.site_id = ?'];
    const params = [site.id];
    if (person) { where.push('e.person = ?'); params.push(person); }
    if (req.query.q) {
      where.push('(e.item_name LIKE ? OR e.item_code LIKE ?)');
      params.push(`%${req.query.q}%`, `%${req.query.q}%`);
    }

    const rows = await many(
      `SELECT e.item_id, e.item_code, e.item_name, e.uom,
              SUM(e.qty) AS open_qty,
              ROUND(CASE WHEN SUM(e.qty) > 0 THEN SUM(e.value) / SUM(e.qty) ELSE 0 END, 2) AS rate,
              MAX(CASE WHEN e.source = 'ISSUE' THEN e.event_date END) AS last_issued_on,
              GROUP_CONCAT(DISTINCT e.person ORDER BY e.person SEPARATOR ', ') AS people
         FROM v_consumption_event e
        WHERE ${where.join(' AND ')}
        GROUP BY e.item_id, e.item_code, e.item_name, e.uom
       HAVING SUM(e.qty) > 0.0005
        ORDER BY e.item_name`, params);

    res.json({ site, person: person || null, rows });
  })
);

/**
 * The people this site knows about.
 *
 * Two different questions, one endpoint.
 *
 * Issuing asks "who have we issued to before", so the storekeeper
 * typing a name is offered the ones already used here rather than
 * inventing a fourth spelling of Ramesh. That list is every name.
 *
 * Returning asks something narrower: "who is holding something that
 * could come back". Nobody types a name there at all — the system
 * knows exactly who material went to, so it says so, and `outstanding`
 * is what asks for that list.
 *
 * When site attendance arrives the first list becomes a real picker
 * and this endpoint keeps its shape.
 */
router.get('/people/:siteId',
  validate(z.object({
    q: z.string().trim().optional(),
    outstanding: z.coerce.boolean().default(false),
  }), 'query'),
  wrap(async (req, res) => {
    const site = await requireSite(req.params.siteId);
    const params = [site.id];
    let filter = '';
    if (req.query.q) { filter = 'AND person LIKE ?'; params.push(`%${req.query.q}%`); }

    const rows = await many(
      `SELECT person AS name,
              COUNT(DISTINCT CASE WHEN source = 'ISSUE' THEN doc_id END) AS issues,
              SUM(CASE WHEN source = 'ISSUE'  THEN qty ELSE 0 END) AS issued_qty,
              SUM(CASE WHEN source = 'RETURN' THEN -qty ELSE 0 END) AS returned_qty,
              SUM(qty) AS open_qty,
              COUNT(DISTINCT CASE WHEN source = 'ISSUE' THEN item_id END) AS items,
              MAX(event_date) AS last_on
         FROM v_consumption_event
        WHERE site_id = ? AND person IS NOT NULL ${filter}
        GROUP BY person
        ${req.query.outstanding ? 'HAVING SUM(qty) > 0.0005' : ''}
        ORDER BY ${req.query.outstanding ? 'open_qty DESC, person' : 'last_on DESC, person'}
        LIMIT 200`, params);

    // how many different items each of them could hand back, which is
    // what the return screen wants to show beside a name
    if (req.query.outstanding) {
      for (const r of rows) {
        const c = await one(
          `SELECT COUNT(*) AS n FROM v_person_outstanding
            WHERE site_id = ? AND person = ? AND open_qty > 0.0005`, [site.id, r.name]);
        r.returnable_items = Number(c?.n || 0);
      }
    }
    res.json({ site, rows });
  })
);

module.exports = router;
