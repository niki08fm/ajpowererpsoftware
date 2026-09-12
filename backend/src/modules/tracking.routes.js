'use strict';
const router = require('express').Router();
const { z } = require('zod');
const { many, one } = require('../config/db');
const { validate, wrap } = require('../middleware/validate');
const { notFound } = require('../lib/errors');

/**
 * Three questions about the same ledger.
 *
 *   transactions  what moved — everything, filtered any way you like
 *   audit         one item's whole history, or one person's
 *   consumption   what a site has used between two dates, by item
 *
 * They are three screens because they are three different questions
 * people arrive with, but they read one view. v_consumption_event has
 * issues positive and returns negative, so every one of these is the
 * same rows sliced differently — which is the only way three screens
 * can be guaranteed to agree with each other.
 *
 * Transactions is the exception: it reads v_stock_movement instead,
 * because "what happened to this material" includes the receipt and
 * the challan that brought it here, not only what was spent.
 */

const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const money = (n) => Math.round(Number(n) * 100) / 100;
const round3 = (n) => Math.round(Number(n) * 1000) / 1000;

/** Scope every query to one branch, and to one site when asked. */
function scope(q, alias = '') {
  const a = alias ? `${alias}.` : '';
  const where = [];
  const params = [];
  if (q.siteId) { where.push(`${a}site_id = ?`); params.push(q.siteId); }
  else if (q.branchId) { where.push(`${a}branch_id = ?`); params.push(q.branchId); }
  if (q.from) { where.push(`${a}${q.dateCol} >= ?`); params.push(q.from); }
  if (q.to) { where.push(`${a}${q.dateCol} <= ?`); params.push(q.to); }
  return { where, params };
}

/* ==================================================================
   1. TRANSACTIONS — what moved, filtered
   ================================================================== */
router.get('/transactions',
  validate(z.object({
    branchId: z.coerce.number().int().positive().optional(),
    siteId: z.coerce.number().int().positive().optional(),
    itemId: z.coerce.number().int().positive().optional(),
    categoryId: z.coerce.number().int().positive().optional(),
    kind: z.string().trim().optional(),          // ISSUE, RETURN, GRN, DC_IN, DC_OUT, ADJUST
    direction: z.enum(['IN', 'OUT', 'ALL']).default('ALL'),
    siteType: z.enum(['SITE', 'STORE', 'ALL']).default('ALL'),
    person: z.string().trim().optional(),
    from: DATE.optional(),
    to: DATE.optional(),
    q: z.string().trim().optional(),
    sort: z.enum(['recent', 'oldest', 'largest', 'item']).default('recent'),
    limit: z.coerce.number().int().min(1).max(2000).default(300),
  }), 'query'),
  wrap(async (req, res) => {
    const q = req.query;
    const where = [];
    const params = [];

    if (q.siteId) { where.push('m.site_id = ?'); params.push(q.siteId); }
    else if (q.branchId) { where.push('m.branch_id = ?'); params.push(q.branchId); }
    if (q.siteType !== 'ALL') { where.push('m.site_type = ?'); params.push(q.siteType); }
    if (q.itemId) { where.push('m.item_id = ?'); params.push(q.itemId); }
    if (q.categoryId) { where.push('it.category_id = ?'); params.push(q.categoryId); }
    if (q.kind) { where.push('m.kind = ?'); params.push(q.kind); }
    if (q.direction !== 'ALL') { where.push('m.direction = ?'); params.push(q.direction); }
    if (q.from) { where.push('m.moved_on >= ?'); params.push(q.from); }
    if (q.to) { where.push('m.moved_on <= ?'); params.push(q.to); }
    if (q.q) {
      where.push('(m.item_name LIKE ? OR m.item_code LIKE ? OR m.ref_no LIKE ?)');
      const like = `%${q.q}%`;
      params.push(like, like, like);
    }
    // a person only appears on an issue or a return, so asking for one
    // narrows to those two kinds by implication
    if (q.person) {
      where.push(`EXISTS (SELECT 1 FROM v_consumption_event e
                           WHERE e.doc_no = m.ref_no AND e.item_id = m.item_id
                             AND e.person LIKE ?)`);
      params.push(`%${q.person}%`);
    }

    const order = {
      recent: 'm.moved_on DESC, m.id DESC',
      oldest: 'm.moved_on ASC, m.id ASC',
      largest: 'ABS(m.qty) DESC',
      item: 'm.item_name ASC, m.moved_on DESC',
    }[q.sort];

    const sql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const rows = await many(
      `SELECT m.id, m.moved_on, m.site_id, m.site_name, m.site_code, m.site_type,
              m.item_id, m.item_code, m.item_name, m.uom, m.make_name,
              m.qty, m.rate, m.value, m.kind, m.direction,
              m.ref_type, m.ref_id, m.ref_no, m.by_name,
              (SELECT e.person FROM v_consumption_event e
                WHERE e.doc_no = m.ref_no AND e.item_id = m.item_id LIMIT 1) AS person
         FROM v_stock_movement m
         JOIN items it ON it.id = m.item_id
         ${sql}
        ORDER BY ${order}
        LIMIT ${q.limit}`, params);

    // the totals are of what was asked for, not of the page shown
    const sums = await one(
      `SELECT COUNT(*) AS moves,
              COALESCE(SUM(CASE WHEN m.qty > 0 THEN m.qty ELSE 0 END), 0)  AS in_qty,
              COALESCE(SUM(CASE WHEN m.qty < 0 THEN -m.qty ELSE 0 END), 0) AS out_qty,
              COALESCE(SUM(CASE WHEN m.qty > 0 THEN m.value ELSE 0 END), 0)  AS in_value,
              COALESCE(SUM(CASE WHEN m.qty < 0 THEN m.value ELSE 0 END), 0)  AS out_value,
              COUNT(DISTINCT m.item_id) AS items,
              COUNT(DISTINCT m.site_id) AS sites
         FROM v_stock_movement m JOIN items it ON it.id = m.item_id ${sql}`, params);

    const kinds = await many(
      `SELECT m.kind, COUNT(*) AS moves
         FROM v_stock_movement m JOIN items it ON it.id = m.item_id ${sql}
        GROUP BY m.kind ORDER BY moves DESC`, params);

    res.json({
      rows,
      truncated: Number(sums.moves) > rows.length,
      totals: {
        moves: Number(sums.moves),
        items: Number(sums.items),
        sites: Number(sums.sites),
        inQty: round3(sums.in_qty),
        outQty: round3(sums.out_qty),
        inValue: money(sums.in_value),
        outValue: money(sums.out_value),
      },
      kinds,
    });
  })
);

/** The kinds actually present, so the filter offers only real options. */
router.get('/transactions/kinds',
  validate(z.object({
    branchId: z.coerce.number().int().positive().optional(),
    siteId: z.coerce.number().int().positive().optional(),
  }), 'query'),
  wrap(async (req, res) => {
    const { where, params } = scope({ ...req.query, dateCol: 'moved_on' });
    const rows = await many(
      `SELECT kind, COUNT(*) AS moves, MIN(moved_on) AS first_on, MAX(moved_on) AS last_on
         FROM v_stock_movement
        ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
        GROUP BY kind ORDER BY moves DESC`, params);
    res.json(rows);
  })
);

/* ==================================================================
   2a. AUDIT BY ITEM — one item's whole history
   ================================================================== */
router.get('/audit/item/:itemId',
  validate(z.object({
    branchId: z.coerce.number().int().positive().optional(),
    siteId: z.coerce.number().int().positive().optional(),
    from: DATE.optional(),
    to: DATE.optional(),
  }), 'query'),
  wrap(async (req, res) => {
    const item = await one(
      `SELECT i.id, i.code, i.name, u.code AS uom, c.name AS category, i.std_rate
         FROM items i JOIN uoms u ON u.id = i.uom_id
         JOIN item_categories c ON c.id = i.category_id
        WHERE i.id = ?`, [req.params.itemId]);
    if (!item) throw notFound('No such item');

    const q = { ...req.query, dateCol: 'moved_on' };
    const { where, params } = scope(q);
    where.unshift('item_id = ?');
    params.unshift(item.id);
    const clause = `WHERE ${where.join(' AND ')}`;

    // every movement of it, anywhere it has been
    const moves = await many(
      `SELECT id, moved_on, site_id, site_name, site_code, site_type,
              qty, rate, value, kind, direction, ref_type, ref_id, ref_no, by_name, make_name,
              (SELECT e.person FROM v_consumption_event e
                WHERE e.doc_no = ref_no AND e.item_id = v_stock_movement.item_id LIMIT 1) AS person
         FROM v_stock_movement ${clause}
        ORDER BY moved_on DESC, id DESC LIMIT 500`, params);

    // where it is standing right now — no date filter: a balance is
    // as at today, whatever window you were looking at
    const balParams = [item.id];
    const balWhere = ['item_id = ?', 'qty <> 0'];
    if (req.query.siteId) { balWhere.push('site_id = ?'); balParams.push(req.query.siteId); }
    else if (req.query.branchId) { balWhere.push('branch_id = ?'); balParams.push(req.query.branchId); }
    const balances = await many(
      `SELECT site_id, site_name, site_code, site_type, is_central,
              qty, avg_rate, latest_rate, last_in, last_moved
         FROM v_stock_balance WHERE ${balWhere.join(' AND ')}
        ORDER BY site_type, site_name`, balParams);

    // who has had it, and how much of that is still with them
    const peopleWhere = ['e.item_id = ?'];
    const peopleParams = [item.id];
    if (req.query.siteId) { peopleWhere.push('e.site_id = ?'); peopleParams.push(req.query.siteId); }
    else if (req.query.branchId) { peopleWhere.push('e.branch_id = ?'); peopleParams.push(req.query.branchId); }
    if (req.query.from) { peopleWhere.push('e.event_date >= ?'); peopleParams.push(req.query.from); }
    if (req.query.to) { peopleWhere.push('e.event_date <= ?'); peopleParams.push(req.query.to); }
    const people = await many(
      `SELECT e.person, e.site_id, e.site_name,
              SUM(CASE WHEN e.source = 'ISSUE'  THEN e.qty  ELSE 0 END) AS issued_qty,
              SUM(CASE WHEN e.source = 'RETURN' THEN -e.qty ELSE 0 END) AS returned_qty,
              SUM(e.qty)   AS net_qty,
              SUM(e.value) AS net_value,
              MAX(e.event_date) AS last_on
         FROM (SELECT ev.*, s.name AS site_name FROM v_consumption_event ev
                 JOIN sites s ON s.id = ev.site_id) e
        WHERE ${peopleWhere.join(' AND ')} AND e.person IS NOT NULL
        GROUP BY e.person, e.site_id, e.site_name
        ORDER BY net_qty DESC, e.person`, peopleParams);

    const sums = await one(
      `SELECT COALESCE(SUM(CASE WHEN qty > 0 THEN qty ELSE 0 END), 0)  AS in_qty,
              COALESCE(SUM(CASE WHEN qty < 0 THEN -qty ELSE 0 END), 0) AS out_qty,
              COUNT(*) AS moves, COUNT(DISTINCT site_id) AS sites,
              MIN(moved_on) AS first_on, MAX(moved_on) AS last_on
         FROM v_stock_movement ${clause}`, params);

    const consumed = await one(
      `SELECT COALESCE(SUM(qty), 0) AS qty, COALESCE(SUM(value), 0) AS value
         FROM v_consumption_event
        WHERE item_id = ?
          ${req.query.siteId ? 'AND site_id = ?' : req.query.branchId ? 'AND branch_id = ?' : ''}
          ${req.query.from ? 'AND event_date >= ?' : ''}
          ${req.query.to ? 'AND event_date <= ?' : ''}`,
      [item.id,
       ...(req.query.siteId ? [req.query.siteId] : req.query.branchId ? [req.query.branchId] : []),
       ...(req.query.from ? [req.query.from] : []),
       ...(req.query.to ? [req.query.to] : [])]);

    res.json({
      item,
      moves,
      balances,
      people,
      totals: {
        moves: Number(sums.moves),
        sites: Number(sums.sites),
        inQty: round3(sums.in_qty),
        outQty: round3(sums.out_qty),
        onHand: round3(balances.reduce((t, b) => t + Number(b.qty), 0)),
        consumedQty: round3(consumed.qty),
        consumedValue: money(consumed.value),
        firstOn: sums.first_on,
        lastOn: sums.last_on,
      },
    });
  })
);

/* ==================================================================
   2b. AUDIT BY PERSON — what one person has had
   ================================================================== */

/** Everyone who has ever had material, so the search has something to offer. */
router.get('/audit/people',
  validate(z.object({
    branchId: z.coerce.number().int().positive().optional(),
    siteId: z.coerce.number().int().positive().optional(),
    from: DATE.optional(),
    to: DATE.optional(),
    q: z.string().trim().optional(),
    sort: z.enum(['value', 'recent', 'name', 'outstanding']).default('value'),
  }), 'query'),
  wrap(async (req, res) => {
    const q = { ...req.query, dateCol: 'event_date' };
    const { where, params } = scope(q);
    where.push('person IS NOT NULL');
    if (q.q) { where.push('person LIKE ?'); params.push(`%${q.q}%`); }
    const order = {
      value: 'issued_value DESC',
      recent: 'last_on DESC',
      name: 'person ASC',
      outstanding: 'net_qty DESC',
    }[q.sort];

    const rows = await many(
      `SELECT person,
              COUNT(DISTINCT CASE WHEN source = 'ISSUE'  THEN doc_id END) AS issues,
              COUNT(DISTINCT CASE WHEN source = 'RETURN' THEN doc_id END) AS returns,
              COUNT(DISTINCT item_id) AS items,
              COUNT(DISTINCT site_id) AS sites,
              SUM(CASE WHEN source = 'ISSUE'  THEN qty ELSE 0 END)   AS issued_qty,
              SUM(CASE WHEN source = 'RETURN' THEN -qty ELSE 0 END)  AS returned_qty,
              SUM(CASE WHEN source = 'ISSUE'  THEN value ELSE 0 END) AS issued_value,
              SUM(CASE WHEN source = 'RETURN' THEN -value ELSE 0 END) AS returned_value,
              SUM(qty)   AS net_qty,
              SUM(value) AS net_value,
              MIN(event_date) AS first_on,
              MAX(event_date) AS last_on
         FROM v_consumption_event
        WHERE ${where.join(' AND ')}
        GROUP BY person
        ORDER BY ${order}
        LIMIT 200`, params);

    res.json({
      rows,
      totals: {
        people: rows.length,
        issuedValue: money(rows.reduce((t, r) => t + Number(r.issued_value), 0)),
        returnedValue: money(rows.reduce((t, r) => t + Number(r.returned_value), 0)),
        netValue: money(rows.reduce((t, r) => t + Number(r.net_value), 0)),
      },
    });
  })
);

/** One person: every line they have ever signed for, with dates. */
router.get('/audit/person',
  validate(z.object({
    name: z.string().trim().min(1, 'Which person?'),
    branchId: z.coerce.number().int().positive().optional(),
    siteId: z.coerce.number().int().positive().optional(),
    itemId: z.coerce.number().int().positive().optional(),
    from: DATE.optional(),
    to: DATE.optional(),
    exact: z.coerce.boolean().default(false),
  }), 'query'),
  wrap(async (req, res) => {
    const q = { ...req.query, dateCol: 'event_date' };
    const { where, params } = scope(q, 'e');
    if (q.exact) { where.push('e.person = ?'); params.push(q.name); }
    else { where.push('e.person LIKE ?'); params.push(`%${q.name}%`); }
    if (q.itemId) { where.push('e.item_id = ?'); params.push(q.itemId); }
    const clause = `WHERE ${where.join(' AND ')}`;

    // every line, newest first — this is the answer to "what have we
    // given him", and it is a list of lines with dates on them
    const lines = await many(
      `SELECT e.source, e.line_id, e.doc_id, e.doc_no, e.event_date,
              e.site_id, s.name AS site_name, s.code AS site_code,
              e.item_id, e.item_code, e.item_name, e.uom, e.make_name,
              ABS(e.qty) AS qty, e.rate, ABS(e.value) AS value,
              e.person, e.purpose, e.remark,
              u.name AS recorded_by_name
         FROM v_consumption_event e
         JOIN sites s  ON s.id = e.site_id
         LEFT JOIN users u ON u.id = e.recorded_by
         ${clause}
        ORDER BY e.event_date DESC, e.doc_id DESC, e.item_name
        LIMIT 1000`, params);

    // and the same thing folded up by item, which is the question
    // "what has he still got"
    const byItem = await many(
      `SELECT e.item_id, e.item_code, e.item_name, e.uom,
              SUM(CASE WHEN e.source = 'ISSUE'  THEN e.qty  ELSE 0 END) AS issued_qty,
              SUM(CASE WHEN e.source = 'RETURN' THEN -e.qty ELSE 0 END) AS returned_qty,
              SUM(e.qty)   AS net_qty,
              SUM(e.value) AS net_value,
              MIN(e.event_date) AS first_on,
              MAX(e.event_date) AS last_on
         FROM v_consumption_event e ${clause}
        GROUP BY e.item_id, e.item_code, e.item_name, e.uom
        ORDER BY net_value DESC`, params);

    // exact spellings caught by a loose search, so a typo is visible
    const spellings = await many(
      `SELECT e.person, COUNT(*) AS line_count, MAX(e.event_date) AS last_on
         FROM v_consumption_event e ${clause}
        GROUP BY e.person ORDER BY line_count DESC`, params);

    const issued = lines.filter((l) => l.source === 'ISSUE');
    const returned = lines.filter((l) => l.source === 'RETURN');

    res.json({
      name: q.name,
      lines,
      byItem,
      spellings,
      totals: {
        lines: lines.length,
        issues: new Set(issued.map((l) => l.doc_id)).size,
        returns: new Set(returned.map((l) => l.doc_id)).size,
        items: byItem.length,
        issuedValue: money(issued.reduce((t, l) => t + Number(l.value), 0)),
        returnedValue: money(returned.reduce((t, l) => t + Number(l.value), 0)),
        netValue: money(byItem.reduce((t, r) => t + Number(r.net_value), 0)),
        outstandingQty: round3(byItem.reduce((t, r) => t + Number(r.net_qty), 0)),
        firstOn: lines.length ? lines[lines.length - 1].event_date : null,
        lastOn: lines.length ? lines[0].event_date : null,
      },
    });
  })
);

/* ==================================================================
   3. CUMULATIVE CONSUMPTION — what a site has used, between two dates
   ================================================================== */
router.get('/consumed',
  validate(z.object({
    branchId: z.coerce.number().int().positive().optional(),
    siteId: z.coerce.number().int().positive().optional(),
    categoryId: z.coerce.number().int().positive().optional(),
    from: DATE.optional(),
    to: DATE.optional(),
    q: z.string().trim().optional(),
    sort: z.enum(['value', 'qty', 'item', 'recent']).default('value'),
    bucket: z.enum(['day', 'week', 'month']).default('month'),
  }), 'query'),
  wrap(async (req, res) => {
    const q = { ...req.query, dateCol: 'event_date' };
    const { where, params } = scope(q, 'e');
    if (q.categoryId) { where.push('e.category_id = ?'); params.push(q.categoryId); }
    if (q.q) {
      where.push('(e.item_name LIKE ? OR e.item_code LIKE ?)');
      params.push(`%${q.q}%`, `%${q.q}%`);
    }
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const order = {
      value: 'consumed_value DESC',
      qty: 'consumed_qty DESC',
      item: 'e.item_name ASC',
      recent: 'last_on DESC',
    }[q.sort];

    // by item: issued less returned, in the window
    const rows = await many(
      `SELECT e.item_id, e.item_code, e.item_name, e.uom, e.category_id,
              SUM(CASE WHEN e.source = 'ISSUE'  THEN e.qty  ELSE 0 END) AS issued_qty,
              SUM(CASE WHEN e.source = 'RETURN' THEN -e.qty ELSE 0 END) AS returned_qty,
              SUM(e.qty)   AS consumed_qty,
              SUM(e.value) AS consumed_value,
              ROUND(CASE WHEN SUM(e.qty) <> 0 THEN SUM(e.value) / SUM(e.qty) ELSE 0 END, 2)
                AS avg_rate,
              COUNT(DISTINCT CASE WHEN e.source = 'ISSUE' THEN e.doc_id END) AS issues,
              COUNT(DISTINCT e.person) AS people,
              COUNT(DISTINCT e.site_id) AS sites,
              MIN(e.event_date) AS first_on,
              MAX(e.event_date) AS last_on
         FROM v_consumption_event e ${clause}
        GROUP BY e.item_id, e.item_code, e.item_name, e.uom, e.category_id
       HAVING SUM(e.qty) <> 0 OR SUM(e.value) <> 0
        ORDER BY ${order}
        LIMIT 500`, params);

    // everything before the window, so "to date" means to date and
    // the running line starts where the previous window left off
    const openingWhere = [];
    const openingParams = [];
    if (q.siteId) { openingWhere.push('site_id = ?'); openingParams.push(q.siteId); }
    else if (q.branchId) { openingWhere.push('branch_id = ?'); openingParams.push(q.branchId); }
    if (q.from) { openingWhere.push('event_date < ?'); openingParams.push(q.from); }
    const opening = q.from
      ? await one(
        `SELECT COALESCE(SUM(qty), 0) AS qty, COALESCE(SUM(value), 0) AS value
           FROM v_consumption_event WHERE ${openingWhere.join(' AND ')}`, openingParams)
      : { qty: 0, value: 0 };

    // and the same window as a run of dates, for the shape of it
    const fmt = {
      day: `DATE_FORMAT(e.event_date, '%Y-%m-%d')`,
      week: `DATE_FORMAT(e.event_date - INTERVAL WEEKDAY(e.event_date) DAY, '%Y-%m-%d')`,
      month: `DATE_FORMAT(e.event_date, '%Y-%m-01')`,
    }[q.bucket];
    const series = await many(
      `SELECT ${fmt} AS bucket,
              SUM(CASE WHEN e.source = 'ISSUE'  THEN e.value ELSE 0 END)  AS issued_value,
              SUM(CASE WHEN e.source = 'RETURN' THEN -e.value ELSE 0 END) AS returned_value,
              SUM(e.value) AS consumed_value,
              SUM(e.qty)   AS consumed_qty,
              COUNT(DISTINCT CASE WHEN e.source = 'ISSUE' THEN e.doc_id END) AS issues
         FROM v_consumption_event e ${clause}
        GROUP BY bucket ORDER BY bucket`, params);

    // a running total down the series, so "to date" is on the chart.
    // Both, because the site screens plot quantity and the expense
    // report plots money, and a series that carried only one of them
    // would have the other computed somewhere else and drift.
    let runV = Number(opening?.value || 0);
    let runQ = Number(opening?.qty || 0);
    const cumulative = series.map((s) => {
      runV += Number(s.consumed_value);
      runQ += Number(s.consumed_qty);
      return { ...s, running_value: money(runV), running_qty: round3(runQ) };
    });

    // who did the consuming, in this window
    const people = await many(
      `SELECT e.person,
              SUM(e.qty) AS consumed_qty, SUM(e.value) AS consumed_value,
              COUNT(DISTINCT CASE WHEN e.source = 'ISSUE' THEN e.doc_id END) AS issues
         FROM v_consumption_event e ${clause}
          ${clause ? 'AND' : 'WHERE'} e.person IS NOT NULL
        GROUP BY e.person ORDER BY consumed_value DESC LIMIT 25`, params);

    // and, when looking at more than one site, the split between them
    const sites = await many(
      `SELECT e.site_id, s.name AS site_name, s.code AS site_code,
              SUM(e.qty) AS consumed_qty, SUM(e.value) AS consumed_value,
              COUNT(DISTINCT e.item_id) AS items
         FROM v_consumption_event e JOIN sites s ON s.id = e.site_id ${clause}
        GROUP BY e.site_id, s.name, s.code
        ORDER BY consumed_value DESC`, params);

    const consumedValue = rows.reduce((t, r) => t + Number(r.consumed_value), 0);

    res.json({
      rows,
      series: cumulative,
      people,
      sites,
      bucket: q.bucket,
      totals: {
        items: rows.length,
        issuedQty: round3(rows.reduce((t, r) => t + Number(r.issued_qty), 0)),
        returnedQty: round3(rows.reduce((t, r) => t + Number(r.returned_qty), 0)),
        consumedQty: round3(rows.reduce((t, r) => t + Number(r.consumed_qty), 0)),
        consumedValue: money(consumedValue),
        people: people.length,
        sites: sites.length,
        beforeWindowQty: round3(opening.qty),
        beforeWindowValue: money(opening.value),
        toDateQty: round3(Number(opening.qty)
          + rows.reduce((t, r) => t + Number(r.consumed_qty), 0)),
        toDateValue: money(Number(opening.value) + consumedValue),
      },
    });
  })
);

module.exports = router;
