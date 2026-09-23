'use strict';
const router = require('express').Router();
const { z } = require('zod');
const { many, one } = require('../config/db');
const { validate, wrap } = require('../middleware/validate');
const { badRequest } = require('../lib/errors');

/**
 * What the buyer is handed.
 *
 * Every approved indent, with how far it has got: waiting for an order,
 * part ordered, ordered, part received, received. It stays on the queue
 * until every item on it has been fully ordered — a half-ordered indent
 * is not finished business.
 *
 * Nothing here is stored. Ordered and received are derived from the
 * purchase orders and receipts that caused them.
 */

const SORTS = {
  needed: 'i.needed_by IS NULL, i.needed_by, i.indent_date',
  raised: 'i.indent_date DESC, i.id DESC',
  site: 's.name, i.needed_by',
  value: 'p.to_order_qty DESC',
};

router.get('/queue',
  validate(z.object({
    branchId: z.coerce.number().int().positive().optional(),
    siteId: z.coerce.number().int().positive().optional(),
    q: z.string().trim().optional(),
    stage: z.enum(['AWAITING_PO', 'PART_ORDERED', 'ORDERED', 'PART_RECEIVED', 'RECEIVED', 'OPEN', 'ALL'])
      .default('OPEN'),
    sort: z.enum(['needed', 'raised', 'site', 'value']).default('needed'),
  }), 'query'),
  wrap(async (req, res) => {
    const where = [`i.status = 'APPROVED'`];
    const params = [];
    if (req.query.branchId) { where.push('i.branch_id = ?'); params.push(req.query.branchId); }
    if (req.query.siteId) { where.push('i.site_id = ?'); params.push(req.query.siteId); }
    if (req.query.q) {
      where.push('(i.doc_no LIKE ? OR s.name LIKE ? OR s.code LIKE ?)');
      const like = `%${req.query.q}%`;
      params.push(like, like, like);
    }
    // "open" is the buyer's default: anything still owing an order
    if (req.query.stage === 'OPEN') where.push(`p.stage IN ('AWAITING_PO','PART_ORDERED')`);
    else if (req.query.stage !== 'ALL') { where.push('p.stage = ?'); params.push(req.query.stage); }

    const rows = await many(
      `SELECT i.id, i.doc_no, i.indent_date, i.needed_by,
              s.id AS site_id, s.name AS site_name, s.code AS site_code,
              b.code AS branch_code, u.name AS raised_by_name,
              p.stage, p.item_count, p.indented_qty, p.ordered_qty, p.received_qty,
              p.to_order_qty, p.to_receive_qty, p.po_count,
              (i.needed_by IS NOT NULL AND i.needed_by < CURDATE()
               AND p.to_receive_qty > 0) AS late
         FROM indents i
         JOIN sites s      ON s.id = i.site_id
         JOIN branches b   ON b.id = i.branch_id
         LEFT JOIN users u ON u.id = i.raised_by
         JOIN v_indent_pipeline p ON p.indent_id = i.id
        WHERE ${where.join(' AND ')}
        ORDER BY ${SORTS[req.query.sort]}`,
      params
    );
    res.json(rows);
  })
);

/** Which store a multi-site order is delivered to. */
async function centralStore(branchId) {
  return one(
    `SELECT id, code, name FROM sites
      WHERE branch_id = ? AND site_type = 'STORE' AND status = 'ACTIVE'
      ORDER BY is_central DESC, id LIMIT 1`, [branchId]
  );
}

/**
 * The buying sheet. Several indents in, one line per item out, with
 * what the central store already holds beside it — because the cheapest
 * way to fill a requirement is often not to buy it at all.
 */
router.post('/demand',
  validate(z.object({
    indentIds: z.array(z.coerce.number().int().positive()).min(1).max(100),
  })),
  wrap(async (req, res) => {
    const ids = [...new Set(req.body.indentIds)];
    const marks = ids.map(() => '?').join(',');

    const indents = await many(
      `SELECT i.id, i.doc_no, i.site_id, i.branch_id, i.indent_date, i.needed_by,
              i.status, s.name AS site_name
         FROM indents i JOIN sites s ON s.id = i.site_id
        WHERE i.id IN (${marks})`, ids
    );
    if (indents.length !== ids.length) throw badRequest('One of those PRNs does not exist');
    const notApproved = indents.filter((i) => i.status !== 'APPROVED');
    if (notApproved.length) {
      throw badRequest(`${notApproved[0].doc_no} is not approved, so it cannot be ordered against`);
    }
    const branches = [...new Set(indents.map((i) => i.branch_id))];
    if (branches.length > 1) throw badRequest('Those PRNs are in different branches');

    const sites = [...new Set(indents.map((i) => i.site_id))];
    const store = await centralStore(branches[0]);

    // one line per item, summed across the indents chosen, less what has
    // already been ordered for them
    const rows = await many(
      `SELECT f.item_id, f.make_id, f.item_code, f.item_name, f.uom, f.make_name,
              i.uom_id, i.gst_rate, i.std_rate,
              SUM(f.indented_qty) AS indented_qty,
              SUM(f.ordered_qty)  AS ordered_qty,
              SUM(f.to_order_qty) AS to_order_qty
         FROM v_indent_item_flow f
         JOIN items i ON i.id = f.item_id
        WHERE f.indent_id IN (${marks})
        GROUP BY f.item_id, f.make_id
        ORDER BY f.item_name`, ids
    );

    // what the store holds, and what it last cost
    const stock = store ? await many(
      `SELECT item_id, qty, avg_rate FROM v_stock_balance WHERE site_id = ?`, [store.id]) : [];
    const byItem = Object.fromEntries(stock.map((s) => [s.item_id, s]));

    // the last rate actually paid anywhere, so the buyer is not typing
    // into a vacuum on an item the store has never held
    const lastPaid = rows.length ? await many(
      `SELECT pol.item_id,
              ROUND(SUM(pol.qty * pol.rate) / NULLIF(SUM(pol.qty), 0), 2) AS rate,
              MAX(po.po_date) AS on_date
         FROM purchase_order_lines pol
         JOIN purchase_orders po ON po.id = pol.po_id
        WHERE po.status = 'APPROVED'
          AND pol.item_id IN (${rows.map(() => '?').join(',')})
        GROUP BY pol.item_id`, rows.map((r) => r.item_id)) : [];
    const byPaid = Object.fromEntries(lastPaid.map((r) => [r.item_id, r]));

    res.json({
      indents: indents.map((i) => ({
        id: i.id, docNo: i.doc_no, site: i.site_name, siteId: i.site_id,
        indentDate: i.indent_date, neededBy: i.needed_by,
      })),
      // one site's indents may go straight there; several cannot, so
      // they land at the store and are issued on from it
      singleSite: sites.length === 1,
      deliverOptions: sites.length === 1
        ? [{ id: sites[0], name: indents[0].site_name, type: 'SITE' },
          ...(store ? [{ id: store.id, name: store.name, type: 'STORE' }] : [])]
        : (store ? [{ id: store.id, name: store.name, type: 'STORE' }] : []),
      centralStore: store || null,
      lines: rows.map((r) => {
        const st = byItem[r.item_id] || {};
        const paid = byPaid[r.item_id] || {};
        return {
          itemId: r.item_id, makeId: r.make_id,
          itemCode: r.item_code, itemName: r.item_name, uom: r.uom, uomId: r.uom_id,
          makeName: r.make_name,
          indentedQty: Number(r.indented_qty),
          orderedQty: Number(r.ordered_qty),
          toOrderQty: Number(r.to_order_qty),
          storeQty: Number(st.qty || 0),
          storeRate: Number(st.avg_rate || 0),
          lastPaidRate: Number(paid.rate || 0),
          lastPaidOn: paid.on_date || null,
          gstRate: Number(r.gst_rate),
          suggestedRate: Number(paid.rate || st.avg_rate || r.std_rate || 0),
        };
      }),
    });
  })
);

/* ========================================================= by item */
/**
 * The same queue, turned round: one row per item across every approved
 * PRN that still has some of it to order. The buyer negotiates per item,
 * not per PRN — thirty metres of cable wanted by three sites is one
 * purchase — so this is the view that says what to buy, in total.
 *
 * Only APPROVED PRNs count: a PRN reaches the buyer after both levels of
 * approval, never before.
 */
const itemFilters = z.object({
  branchId: z.coerce.number().int().positive().optional(),
  siteId: z.coerce.number().int().positive().optional(),
  q: z.string().trim().max(120).optional(),
  sort: z.enum(['item', 'qty', 'prns', 'needed']).default('item'),
});

const itemWhere = (q) => {
  const where = [`i.status = 'APPROVED'`, 'f.to_order_qty > 0'];
  const params = [];
  if (q.branchId) { where.push('s.branch_id = ?'); params.push(q.branchId); }
  if (q.siteId) { where.push('i.site_id = ?'); params.push(q.siteId); }
  if (q.q) {
    where.push('(f.item_name LIKE ? OR f.item_code LIKE ?)');
    params.push(`%${q.q}%`, `%${q.q}%`);
  }
  return { where: where.join(' AND '), params };
};

router.get('/items', validate(itemFilters, 'query'), wrap(async (req, res) => {
  const { where, params } = itemWhere(req.query);
  const order = {
    item: 'item_name', qty: 'to_order_qty DESC', prns: 'prns DESC, item_name',
    needed: 'first_needed IS NULL, first_needed, item_name',
  }[req.query.sort];
  const rows = await many(
    `SELECT f.item_id, f.make_id, f.item_code, f.item_name, f.uom, f.make_name,
            ROUND(SUM(f.indented_qty), 3) AS indented_qty,
            ROUND(SUM(f.ordered_qty), 3)  AS ordered_qty,
            ROUND(SUM(f.pending_gm_qty), 3) AS pending_gm_qty,
            ROUND(SUM(f.to_order_qty), 3) AS to_order_qty,
            COUNT(DISTINCT i.id)          AS prns,
            COUNT(DISTINCT i.site_id)     AS sites,
            MIN(i.needed_by)              AS first_needed,
            GROUP_CONCAT(DISTINCT s.name ORDER BY s.name SEPARATOR ', ') AS site_names
       FROM v_indent_item_flow f
       JOIN indents i ON i.id = f.indent_id
       JOIN sites s   ON s.id = i.site_id
      WHERE ${where}
      GROUP BY f.item_id, f.make_id, f.item_code, f.item_name, f.uom, f.make_name
      ORDER BY ${order}`, params);
  res.json({
    rows,
    totals: {
      items: rows.length,
      toOrder: rows.reduce((t, r) => t + Number(r.to_order_qty), 0),
    },
  });
}));

/** One item: which PRNs want it, and on which BOQ lines of each. */
router.get('/items/:itemId',
  validate(itemFilters.extend({ makeId: z.coerce.number().int().positive().optional() }), 'query'),
  wrap(async (req, res) => {
    const { where, params } = itemWhere(req.query);
    const make = req.query.makeId ? 'AND f.make_id = ?' : 'AND f.make_id IS NULL';
    const args = [...params, req.params.itemId, ...(req.query.makeId ? [req.query.makeId] : [])];
    const prns = await many(
      `SELECT i.id, i.doc_no, i.indent_date, i.needed_by, i.site_id, s.name AS site_name,
              s.branch_id, b.name AS branch_name,
              f.indented_qty, f.ordered_qty, f.pending_gm_qty, f.to_order_qty
         FROM v_indent_item_flow f
         JOIN indents i  ON i.id = f.indent_id
         JOIN sites s    ON s.id = i.site_id
         JOIN branches b ON b.id = s.branch_id
        WHERE ${where} AND f.item_id = ? ${make}
        ORDER BY i.needed_by IS NULL, i.needed_by, i.id`, args);
    const lines = prns.length ? await many(
      `SELECT il.indent_id, bl.sno, il.qty
         FROM indent_lines il JOIN boq_lines bl ON bl.id = il.boq_line_id
        WHERE il.indent_id IN (?) AND il.item_id = ?
          AND ${req.query.makeId ? 'il.make_id = ?' : 'il.make_id IS NULL'}
        ORDER BY bl.sno`,
      [prns.map((p) => p.id), req.params.itemId, ...(req.query.makeId ? [req.query.makeId] : [])]) : [];
    res.json({
      prns: prns.map((p) => ({
        ...p,
        lines: lines.filter((l) => l.indent_id === p.id).map((l) => ({ sno: l.sno, qty: l.qty })),
      })),
    });
  })
);

module.exports = router;
