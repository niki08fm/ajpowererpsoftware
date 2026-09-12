'use strict';
const router = require('express').Router();
const { z } = require('zod');
const { many, one } = require('../config/db');
const { validate, wrap } = require('../middleware/validate');

/**
 * What it has cost.
 *
 * One ledger, v_cost_event, carrying two kinds of row that are spent
 * in completely different ways — material off a shelf at the rate the
 * central store held it at that day, and money out of a pocket at the
 * amount somebody approved. Everything on this screen is that view
 * sliced: by window, by site, by category, by month.
 *
 * Three rules it keeps.
 *
 * Nothing unapproved is counted. A claim in somebody's queue is not a
 * cost; it is shown separately, as what is waiting, so nobody mistakes
 * the one for the other.
 *
 * A window knows what came before it. `beforeWindow` is everything up
 * to the start date, so "to date" is a real running total no matter
 * how narrow the window, and the chart's line starts where the last
 * one finished rather than at zero.
 *
 * And the picture never replaces the numbers. Every series here has a
 * table beside it on the screen, because a chart is for spotting the
 * shape and a table is for the answer.
 */

const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const money = (n) => Math.round(Number(n) * 100) / 100;

const filters = z.object({
  branchId: z.coerce.number().int().positive().optional(),
  // one site, or every site in the branch
  siteId: z.coerce.number().int().positive().optional(),
  source: z.enum(['MATERIAL', 'EXPENSE', 'ALL']).default('ALL'),
  categoryId: z.coerce.number().int().positive().optional(),
  from: DATE.optional(),
  to: DATE.optional(),
  bucket: z.enum(['day', 'week', 'month']).default('month'),
});

/** The WHERE every query on this screen shares. */
function scope(q, alias = 'c') {
  const a = `${alias}.`;
  const where = [];
  const params = [];
  if (q.siteId) { where.push(`${a}site_id = ?`); params.push(q.siteId); }
  else if (q.branchId) { where.push(`${a}branch_id = ?`); params.push(q.branchId); }
  if (q.source !== 'ALL') { where.push(`${a}source = ?`); params.push(q.source); }
  if (q.categoryId) { where.push(`${a}category_id = ?`); params.push(q.categoryId); }
  if (q.from) { where.push(`${a}event_date >= ?`); params.push(q.from); }
  if (q.to) { where.push(`${a}event_date <= ?`); params.push(q.to); }
  return { clause: where.length ? `WHERE ${where.join(' AND ')}` : '', params };
}

/* ==================================================================
   THE EXPENSE REPORT
   ================================================================== */
router.get('/expense', validate(filters, 'query'), wrap(async (req, res) => {
  const q = req.query;
  const { clause, params } = scope(q);

  const totals = await one(
    `SELECT COALESCE(SUM(CASE WHEN c.source = 'MATERIAL' THEN c.amount ELSE 0 END), 0)
              AS material,
            COALESCE(SUM(CASE WHEN c.source = 'EXPENSE' THEN c.amount ELSE 0 END), 0)
              AS expense,
            COALESCE(SUM(c.amount), 0) AS total,
            COUNT(DISTINCT c.site_id)  AS sites,
            COUNT(*)                   AS entries,
            MIN(c.event_date) AS first_on, MAX(c.event_date) AS last_on
       FROM v_cost_event c ${clause}`, params);

  // everything before the window, so "to date" means to date
  const openWhere = [];
  const openParams = [];
  if (q.siteId) { openWhere.push('site_id = ?'); openParams.push(q.siteId); }
  else if (q.branchId) { openWhere.push('branch_id = ?'); openParams.push(q.branchId); }
  if (q.source !== 'ALL') { openWhere.push('source = ?'); openParams.push(q.source); }
  if (q.categoryId) { openWhere.push('category_id = ?'); openParams.push(q.categoryId); }
  if (q.from) { openWhere.push('event_date < ?'); openParams.push(q.from); }
  const before = q.from
    ? await one(
      `SELECT COALESCE(SUM(amount), 0) AS amount FROM v_cost_event
        WHERE ${openWhere.join(' AND ')}`, openParams)
    : { amount: 0 };

  // the shape of it over time, material and expense side by side
  const fmt = {
    day: `DATE_FORMAT(c.event_date, '%Y-%m-%d')`,
    week: `DATE_FORMAT(c.event_date - INTERVAL WEEKDAY(c.event_date) DAY, '%Y-%m-%d')`,
    month: `DATE_FORMAT(c.event_date, '%Y-%m-01')`,
  }[q.bucket];
  const series = await many(
    `SELECT ${fmt} AS bucket,
            SUM(CASE WHEN c.source = 'MATERIAL' THEN c.amount ELSE 0 END) AS material,
            SUM(CASE WHEN c.source = 'EXPENSE'  THEN c.amount ELSE 0 END) AS expense,
            SUM(c.amount) AS total
       FROM v_cost_event c ${clause}
      GROUP BY bucket ORDER BY bucket`, params);

  let run = Number(before.amount);
  const withRunning = series.map((s) => {
    run += Number(s.total);
    return {
      bucket: s.bucket,
      material: money(s.material),
      expense: money(s.expense),
      total: money(s.total),
      running_value: money(run),
    };
  });

  // what the money went on. Material is one line against the expense
  // categories, because "cable" and "transport" are not comparable
  // and pretending they are makes a chart nobody can read.
  const byCategory = await many(
    `SELECT c.source,
            COALESCE(c.category, 'Material') AS category,
            c.category_id,
            SUM(c.amount) AS amount,
            COUNT(*) AS entries
       FROM v_cost_event c ${clause}
      GROUP BY c.source, c.category, c.category_id
      ORDER BY amount DESC`, params);

  const bySite = await many(
    `SELECT c.site_id, s.name AS site_name, s.code AS site_code,
            cl.name AS client_name,
            SUM(CASE WHEN c.source = 'MATERIAL' THEN c.amount ELSE 0 END) AS material,
            SUM(CASE WHEN c.source = 'EXPENSE'  THEN c.amount ELSE 0 END) AS expense,
            SUM(c.amount) AS total
       FROM v_cost_event c
       JOIN sites s ON s.id = c.site_id
       LEFT JOIN clients cl ON cl.id = s.client_id
       ${clause}
      GROUP BY c.site_id, s.name, s.code, cl.name
      ORDER BY total DESC`, params);

  // the dearest items, which is the question that follows every
  // glance at a material figure
  const byItem = await many(
    `SELECT c.item_id, c.item_code, c.label AS item_name, c.uom,
            SUM(c.qty) AS qty, SUM(c.amount) AS amount
       FROM v_cost_event c ${clause} ${clause ? 'AND' : 'WHERE'} c.source = 'MATERIAL'
      GROUP BY c.item_id, c.item_code, c.label, c.uom
     HAVING SUM(c.amount) <> 0
      ORDER BY amount DESC LIMIT 15`, params);

  // and what is not counted yet, said out loud rather than left out
  const pendWhere = [`v.status = 'SUBMITTED'`];
  const pendParams = [];
  if (q.siteId) { pendWhere.push('v.site_id = ?'); pendParams.push(q.siteId); }
  else if (q.branchId) { pendWhere.push('v.branch_id = ?'); pendParams.push(q.branchId); }
  const pending = await one(
    `SELECT COUNT(*) AS claims, COALESCE(SUM(v.claimed_amount), 0) AS amount,
            COALESCE(MAX(v.days_waiting), 0) AS oldest
       FROM v_site_expense v WHERE ${pendWhere.join(' AND ')}`, pendParams);

  res.json({
    bucket: q.bucket,
    series: withRunning,
    byCategory: byCategory.map((r) => ({ ...r, amount: money(r.amount) })),
    bySite: bySite.map((r) => ({
      ...r, material: money(r.material), expense: money(r.expense), total: money(r.total),
    })),
    byItem: byItem.map((r) => ({ ...r, amount: money(r.amount) })),
    totals: {
      material: money(totals.material),
      expense: money(totals.expense),
      total: money(totals.total),
      sites: Number(totals.sites),
      entries: Number(totals.entries),
      beforeWindow: money(before.amount),
      toDate: money(Number(before.amount) + Number(totals.total)),
      firstOn: totals.first_on,
      lastOn: totals.last_on,
    },
    pending: {
      claims: Number(pending.claims),
      amount: money(pending.amount),
      oldestDays: Number(pending.oldest),
    },
  });
}));

/* ==================================================================
   THE STATEMENT
   ==================================================================
   The same shape every cost statement in this trade has: material
   first, item by item, with its own total; then labour; then
   everything else; then one figure at the bottom.

   Material is listed per item and not per issue, because "what did
   the cable cost" is the question, and a list of forty slips is not
   an answer to it. Every other section is listed per claim, because
   there the document IS the answer — somebody asked for money, and
   the reader wants to see what for, on whose site, and what was
   written against it when it was approved.
   ================================================================== */
router.get('/expense/statement', validate(filters, 'query'), wrap(async (req, res) => {
  const q = req.query;
  const { clause, params } = scope(q);

  // ---- material, one row per item, net of anything returned -------
  const material = await many(
    `SELECT c.item_id, c.item_code, c.label AS item_name, c.uom,
            SUM(CASE WHEN c.amount >= 0 THEN c.qty ELSE 0 END)  AS issued_qty,
            SUM(CASE WHEN c.amount <  0 THEN -c.qty ELSE 0 END) AS returned_qty,
            SUM(c.qty)    AS qty,
            SUM(c.amount) AS amount,
            -- deliberately no rate. The rate moved: this item went out
            -- at what the central store held it at on each day it
            -- moved, which may be ten different numbers. Dividing the
            -- total by the quantity would produce an average that was
            -- never the price of anything on any day, and printing it
            -- in a rate column invites somebody to multiply it back
            -- out and get a different answer from the one beside it.
            -- The amount is right; the quantity is right; a single
            -- rate is not available and saying so is the honest thing.
            COUNT(DISTINCT c.event_date) AS days,
            COUNT(DISTINCT c.site_id) AS sites,
            MIN(c.event_date) AS first_on,
            MAX(c.event_date) AS last_on
       FROM v_cost_event c ${clause} ${clause ? 'AND' : 'WHERE'} c.source = 'MATERIAL'
      GROUP BY c.item_id, c.item_code, c.label, c.uom
     HAVING SUM(c.amount) <> 0 OR SUM(c.qty) <> 0
      ORDER BY amount DESC`, params);

  // ---- the claims, labour and other, each with what was written
  //      on it when it was raised and when it was decided ----------
  const expWhere = [`v.status = 'APPROVED'`, 'v.cost_amount <> 0'];
  const expParams = [];
  if (q.siteId) { expWhere.push('v.site_id = ?'); expParams.push(q.siteId); }
  else if (q.branchId) { expWhere.push('v.branch_id = ?'); expParams.push(q.branchId); }
  if (q.categoryId) { expWhere.push('v.category_id = ?'); expParams.push(q.categoryId); }
  if (q.from) { expWhere.push('v.spent_on >= ?'); expParams.push(q.from); }
  if (q.to) { expWhere.push('v.spent_on <= ?'); expParams.push(q.to); }

  const claims = q.source === 'MATERIAL' ? [] : await many(
    `SELECT v.expense_id, v.doc_no, v.spent_on, v.site_id, v.site_name,
            v.category_id, v.category, v.category_kind,
            v.description, v.paid_to, v.bill_no,
            v.note, v.decision_note,
            v.claimed_amount, v.approved_amount, v.cost_amount, v.disallowed_amount,
            v.outcome, v.raised_by_name, v.decided_by_name
       FROM v_site_expense v
      WHERE ${expWhere.join(' AND ')}
      ORDER BY v.spent_on, v.doc_no`, expParams);

  const labour = claims.filter((c) => c.category_kind === 'LABOUR');
  const other = claims.filter((c) => c.category_kind !== 'LABOUR');

  // other expenses read better grouped by what they were for
  const groups = [];
  for (const r of other) {
    let g = groups.find((x) => x.category_id === r.category_id);
    if (!g) { g = { category_id: r.category_id, category: r.category, rows: [], total: 0 }; groups.push(g); }
    g.rows.push(r);
    g.total = money(g.total + Number(r.cost_amount));
  }
  groups.sort((a, b) => b.total - a.total);

  const sum = (rows, key) => money(rows.reduce((t, r) => t + Number(r[key]), 0));
  const materialTotal = q.source === 'EXPENSE' ? 0 : sum(material, 'amount');
  const labourTotal = sum(labour, 'cost_amount');
  const otherTotal = sum(other, 'cost_amount');

  // everything before the window, so the statement can close with a
  // running figure rather than only this window's
  const openWhere = [];
  const openParams = [];
  if (q.siteId) { openWhere.push('site_id = ?'); openParams.push(q.siteId); }
  else if (q.branchId) { openWhere.push('branch_id = ?'); openParams.push(q.branchId); }
  if (q.source !== 'ALL') { openWhere.push('source = ?'); openParams.push(q.source); }
  if (q.categoryId) { openWhere.push('category_id = ?'); openParams.push(q.categoryId); }
  if (q.from) { openWhere.push('event_date < ?'); openParams.push(q.from); }
  const before = q.from
    ? await one(`SELECT COALESCE(SUM(amount), 0) AS amount FROM v_cost_event
                  WHERE ${openWhere.join(' AND ')}`, openParams)
    : { amount: 0 };

  const site = q.siteId
    ? await one(`SELECT s.id, s.code, s.name, c.name AS client_name
                   FROM sites s LEFT JOIN clients c ON c.id = s.client_id
                  WHERE s.id = ?`, [q.siteId])
    : null;

  const total = money(materialTotal + labourTotal + otherTotal);
  res.json({
    site,
    window: { from: q.from || null, to: q.to || null },
    material: {
      rows: material.map((r) => ({ ...r, amount: money(r.amount) })),
      total: materialTotal,
    },
    labour: { rows: labour, total: labourTotal },
    other: { groups, rows: other, total: otherTotal },
    totals: {
      material: materialTotal,
      labour: labourTotal,
      other: otherTotal,
      expense: money(labourTotal + otherTotal),
      total,
      beforeWindow: money(before.amount),
      toDate: money(Number(before.amount) + total),
    },
  });
}));

/** Every line behind the report, for whoever wants to see it itemised. */
router.get('/expense/lines',
  validate(filters.extend({
    q: z.string().trim().optional(),
    limit: z.coerce.number().int().min(1).max(2000).default(500),
  }), 'query'),
  wrap(async (req, res) => {
    const q = req.query;
    const { clause, params } = scope(q);
    let where = clause;
    if (q.q) {
      where = `${clause || 'WHERE 1=1'} AND (c.label LIKE ? OR c.doc_no LIKE ? OR c.who LIKE ?)`;
      const like = `%${q.q}%`;
      params.push(like, like, like);
    }
    const rows = await many(
      `SELECT c.source, c.row_id, c.ref_id, c.doc_no, c.event_date,
              c.site_id, s.name AS site_name, c.category, c.category_id,
              c.item_code, c.label, c.uom, c.qty, c.rate, c.amount, c.who
         FROM v_cost_event c JOIN sites s ON s.id = c.site_id
         ${where}
        ORDER BY c.event_date DESC, c.source, c.row_id DESC
        LIMIT ${q.limit}`, params);
    const sums = await one(
      `SELECT COUNT(*) AS n, COALESCE(SUM(c.amount), 0) AS amount
         FROM v_cost_event c JOIN sites s ON s.id = c.site_id ${where}`, params);
    res.json({
      rows,
      truncated: Number(sums.n) > rows.length,
      totals: { entries: Number(sums.n), amount: money(sums.amount) },
    });
  })
);

/* ==================================================================
   PROFIT AND LOSS — what can and cannot be answered yet
   ================================================================== */

/**
 * There is no profit and loss until the client is billed.
 *
 * Cost is known to the rupee: every issue, every return, every
 * approved claim. Revenue is not known at all — a work order is what
 * was agreed, not what has been invoiced, and treating an agreement
 * as income is how a business convinces itself it is profitable while
 * running out of money.
 *
 * So this endpoint answers the half it can, states plainly what is
 * missing, and refuses to guess the rest. When Billing exists it
 * gains a revenue side and nothing else about it changes.
 */
router.get('/pl', validate(filters, 'query'), wrap(async (req, res) => {
  const q = req.query;
  const { clause, params } = scope(q);

  const cost = await one(
    `SELECT COALESCE(SUM(CASE WHEN c.source = 'MATERIAL' THEN c.amount ELSE 0 END), 0)
              AS material,
            COALESCE(SUM(CASE WHEN c.source = 'EXPENSE' THEN c.amount ELSE 0 END), 0)
              AS expense,
            COALESCE(SUM(c.amount), 0) AS total
       FROM v_cost_event c ${clause}`, params);

  // what the client agreed to pay, which is not the same as revenue
  // and is shown only so the gap between the two is visible
  const orderWhere = [];
  const orderParams = [];
  if (q.siteId) { orderWhere.push('wo.site_id = ?'); orderParams.push(q.siteId); }
  else if (q.branchId) { orderWhere.push('wo.branch_id = ?'); orderParams.push(q.branchId); }
  const ordered = await one(
    `SELECT COALESCE(SUM(l.line_total), 0) AS value, COUNT(DISTINCT wo.id) AS orders
       FROM work_orders wo JOIN work_order_lines l ON l.work_order_id = wo.id
       ${orderWhere.length ? `WHERE ${orderWhere.join(' AND ')}` : ''}`, orderParams);

  const sites = await many(
    `SELECT c.site_id, s.name AS site_name, s.code AS site_code, cl.name AS client_name,
            SUM(c.amount) AS cost,
            COALESCE((SELECT SUM(l.line_total) FROM work_orders wo
                        JOIN work_order_lines l ON l.work_order_id = wo.id
                       WHERE wo.site_id = c.site_id), 0) AS order_value
       FROM v_cost_event c
       JOIN sites s ON s.id = c.site_id
       LEFT JOIN clients cl ON cl.id = s.client_id
       ${clause}
      GROUP BY c.site_id, s.name, s.code, cl.name
      ORDER BY cost DESC`, params);

  res.json({
    available: false,
    blockedBy: 'BILLING',
    reason: 'A profit and loss needs revenue, and nothing has been billed to a client yet. '
      + 'Billing is not built, so there is no invoice to take revenue from.',
    cost: {
      material: money(cost.material),
      expense: money(cost.expense),
      total: money(cost.total),
    },
    // deliberately not called revenue
    orderValue: money(ordered.value),
    orderCount: Number(ordered.orders),
    sites: sites.map((r) => ({
      ...r,
      cost: money(r.cost),
      order_value: money(r.order_value),
    })),
  });
}));

module.exports = router;
