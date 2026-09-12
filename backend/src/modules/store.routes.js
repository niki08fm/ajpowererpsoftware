'use strict';
const router = require('express').Router();
const { z } = require('zod');
const { many, one } = require('../config/db');
const { validate, wrap } = require('../middleware/validate');
const { notFound, badRequest } = require('../lib/errors');

/**
 * The central store.
 *
 * This department is one place: the branch's central store. It buys in
 * against purchase orders, it holds stock, and it issues out to sites
 * against their PRNs. A site's own store is not this — that belongs to
 * the site department, has no rates of its own, and is fed entirely by
 * what the site signs for.
 *
 * Two documents and nothing else. A GRN takes material in; a delivery
 * challan sends it out. Rates live here and only here, at what the last
 * purchase order paid.
 *
 * Nothing in this file writes. The ledger is written by the receipt and
 * the challan, and read back from here.
 */

/** Every store in the branch, with enough to choose between them. */
async function storeList(branchId) {
  return many(
    `SELECT s.id, s.code, s.name, s.is_central, s.location,
            (SELECT COUNT(*) FROM v_stock_balance b
              WHERE b.site_id = s.id AND b.qty <> 0)            AS items,
            (SELECT COALESCE(SUM(ROUND(b.qty * b.latest_rate, 2)), 0) FROM v_stock_balance b
              WHERE b.site_id = s.id)                           AS value,
            (SELECT COUNT(*) FROM v_po_status v
               JOIN purchase_orders po ON po.id = v.po_id
              WHERE po.status = 'APPROVED' AND v.deliver_to_id = s.id
                AND v.pending_qty > 0.0005)                     AS awaiting_grn,
            (SELECT COUNT(*) FROM v_dc_status d
              WHERE d.from_site_id = s.id AND d.state IN ('IN_TRANSIT','PART_ACK')) AS out_unsigned
       FROM sites s
      WHERE s.branch_id = ? AND s.site_type = 'STORE' AND s.status = 'ACTIVE'
      ORDER BY s.is_central DESC, s.name`, [branchId]);
}

/** The branch's store. Central if one is marked, otherwise the first. */
async function centralStore(branchId) {
  if (!branchId) return null;
  return one(
    `SELECT id, name, code, is_central FROM sites
      WHERE branch_id = ? AND site_type = 'STORE' AND status = 'ACTIVE'
      ORDER BY is_central DESC, id LIMIT 1`, [branchId]);
}

/** Every screen here is the store's, so resolve it once and complain
 *  plainly if the branch has not got one yet. */
/** The store, and the branch it belongs to. */
async function storeBranch(storeId) {
  return (await one(`SELECT branch_id FROM sites WHERE id = ?`, [storeId])).branch_id;
}

async function requireStore(req) {
  if (req.query.storeId) {
    const s = await one(
      `SELECT id, name, code, is_central FROM sites WHERE id = ? AND site_type = 'STORE'`,
      [req.query.storeId]);
    if (!s) throw notFound('No such store');
    return s;
  }
  const s = await centralStore(req.query.branchId);
  if (!s) throw badRequest('This branch has no store yet — create one first');
  return s;
}

/** The stores you can stand in. */
router.get('/stores',
  validate(z.object({ branchId: z.coerce.number().int().positive() }), 'query'),
  wrap(async (req, res) => {
    res.json(await storeList(req.query.branchId));
  })
);

/* ==================================================================
   The desk: what is coming in, what is going out, who is waiting.
   ================================================================== */
router.get('/desk',
  validate(z.object({
    branchId: z.coerce.number().int().positive().optional(),
    storeId: z.coerce.number().int().positive().optional(),
  }), 'query'),
  wrap(async (req, res) => {
    const store = await requireStore(req);

    // orders coming to THIS store. One directed straight to a site is
    // not the store's to receive — the site signs for it.
    const toReceive = await many(
      `SELECT v.po_id, v.doc_no, v.supplier_name, v.deliver_to_id, v.deliver_to_name,
              v.deliver_to_type, v.expected_date, v.po_date, v.ordered_qty, v.received_qty,
              v.pending_qty, v.overdue, v.receipt_state, v.po_value
         FROM v_po_status v JOIN purchase_orders po ON po.id = v.po_id
        WHERE po.status = 'APPROVED' AND v.pending_qty > 0.0005 AND v.deliver_to_id = ?
        ORDER BY v.expected_date IS NULL, v.expected_date`, [store.id]);

    // what this store has sent that nobody has signed for yet
    const inTransit = await many(
      `SELECT v.*,
              (SELECT GROUP_CONCAT(DISTINCT i.doc_no ORDER BY i.doc_no SEPARATOR ', ')
                 FROM dc_line_indents dli
                 JOIN delivery_challan_lines dl ON dl.id = dli.dc_line_id
                 JOIN indents i ON i.id = dli.indent_id
                WHERE dl.dc_id = v.dc_id) AS prns
         FROM v_dc_status v
        WHERE v.state IN ('IN_TRANSIT','PART_ACK') AND v.from_site_id = ?
        ORDER BY v.days_out DESC`, [store.id]);

    // PRNs still owed something, gathered by the site they belong to
    const owed = await many(
      `SELECT p.site_id, s.name AS site_name, s.code AS site_code,
              COUNT(*) AS prn_count,
              SUM(p.to_deliver_qty) AS to_deliver_qty,
              SUM(p.in_transit_qty) AS in_transit_qty,
              MIN(p.needed_by) AS soonest
         FROM v_indent_pipeline p
         JOIN sites s ON s.id = p.site_id
        WHERE p.status = 'APPROVED' AND p.to_deliver_qty > 0.0005 AND s.branch_id = ?
        GROUP BY p.site_id
        ORDER BY soonest IS NULL, soonest`, [await storeBranch(store.id)]);

    const held = await one(
      `SELECT COUNT(*) AS items, COALESCE(SUM(qty), 0) AS qty,
              COALESCE(SUM(ROUND(qty * latest_rate, 2)), 0) AS value
         FROM v_stock_balance WHERE site_id = ? AND qty <> 0`, [store.id]);

    res.json({ store, toReceive, inTransit, sitesOwed: owed, held });
  })
);

/* ==================================================================
   PRNs. Shown to the store until they are fully fulfilled.
   ================================================================== */
router.get('/prns',
  validate(z.object({
    branchId: z.coerce.number().int().positive().optional(),
    storeId: z.coerce.number().int().positive().optional(),
    siteId: z.coerce.number().int().positive().optional(),
    q: z.string().trim().optional(),
    show: z.enum(['PENDING', 'ALL']).default('PENDING'),
    sort: z.enum(['needed', 'oldest', 'site', 'outstanding']).default('needed'),
  }), 'query'),
  wrap(async (req, res) => {
    const store = await requireStore(req);
    const branch = await storeBranch(store.id);

    const where = [`p.status = 'APPROVED'`, 's.branch_id = ?'];
    const params = [branch];
    // fully fulfilled falls off the list, which is what "until they are
    // fully fulfilled" means
    if (req.query.show === 'PENDING') where.push('p.to_deliver_qty > 0.0005');
    if (req.query.siteId) { where.push('p.site_id = ?'); params.push(req.query.siteId); }
    if (req.query.q) {
      where.push('(p.doc_no LIKE ? OR s.name LIKE ?)');
      params.push(`%${req.query.q}%`, `%${req.query.q}%`);
    }
    const order = {
      needed: 'p.needed_by IS NULL, p.needed_by, p.indent_date',
      oldest: 'p.indent_date, p.indent_id',
      site: 's.name, p.needed_by',
      outstanding: 'p.to_deliver_qty DESC',
    }[req.query.sort];

    const rows = await many(
      `SELECT p.indent_id, p.doc_no, p.indent_date, p.needed_by, p.stage,
              p.site_id, s.name AS site_name, s.code AS site_code,
              p.item_count, p.indented_qty, p.ordered_qty, p.received_qty,
              p.issued_qty, p.in_transit_qty, p.at_site_qty, p.to_deliver_qty,
              CASE WHEN p.needed_by IS NOT NULL AND p.needed_by < CURDATE()
                        AND p.to_deliver_qty > 0.0005
                   THEN DATEDIFF(CURDATE(), p.needed_by) ELSE 0 END AS days_late,
              -- how much of what it still wants is on this store's shelf
              (SELECT COALESCE(SUM(LEAST(f.to_deliver_qty, COALESCE(b.qty, 0))), 0)
                 FROM v_indent_item_flow f
                 LEFT JOIN v_stock_balance b ON b.item_id = f.item_id AND b.site_id = ?
                WHERE f.indent_id = p.indent_id AND f.to_deliver_qty > 0.0005) AS can_send_qty
         FROM v_indent_pipeline p
         JOIN sites s ON s.id = p.site_id
        WHERE ${where.join(' AND ')}
        ORDER BY ${order}`, [store.id, ...params]);

    res.json({
      store,
      rows,
      totals: {
        prns: rows.length,
        toDeliver: rows.reduce((t, r) => t + Number(r.to_deliver_qty), 0),
        inTransit: rows.reduce((t, r) => t + Number(r.in_transit_qty), 0),
        canSend: rows.reduce((t, r) => t + Number(r.can_send_qty), 0),
        late: rows.filter((r) => Number(r.days_late) > 0).length,
      },
    });
  })
);

/**
 * The issue sheet.
 *
 * One or more PRNs, of one site, line by line. Several PRNs may ask for
 * the same item; each keeps its own row, because what is being answered
 * matters, and the store's holding is shown once per item so it is
 * plain that the two rows are drawing on the same shelf.
 */
router.get('/issue',
  validate(z.object({
    branchId: z.coerce.number().int().positive().optional(),
    storeId: z.coerce.number().int().positive().optional(),
    indentIds: z.string().trim().optional(),
    siteId: z.coerce.number().int().positive().optional(),
  }), 'query'),
  wrap(async (req, res) => {
    const store = await requireStore(req);
    const ids = (req.query.indentIds || '').split(',')
      .map((x) => Number(x.trim())).filter(Boolean);

    let prns;
    if (ids.length) {
      prns = await many(
        `SELECT p.indent_id, p.doc_no, p.indent_date, p.needed_by, p.site_id,
                s.name AS site_name, p.status, p.to_deliver_qty
           FROM v_indent_pipeline p JOIN sites s ON s.id = p.site_id
          WHERE p.indent_id IN (?) ORDER BY p.needed_by IS NULL, p.needed_by, p.doc_no`, [ids]);
      if (prns.length !== ids.length) throw badRequest('One of those PRNs does not exist');
      const sites = [...new Set(prns.map((p) => p.site_id))];
      // a lorry goes to one place
      if (sites.length > 1) {
        throw badRequest(
          `Those PRNs belong to ${sites.length} different sites (`
          + `${[...new Set(prns.map((p) => p.site_name))].join(', ')}`
          + `). One challan goes to one site — pick PRNs of the same site.`);
      }
      const bad = prns.find((p) => p.status !== 'APPROVED');
      if (bad) throw badRequest(`${bad.doc_no} is not approved`);
    } else if (req.query.siteId) {
      prns = await many(
        `SELECT p.indent_id, p.doc_no, p.indent_date, p.needed_by, p.site_id,
                s.name AS site_name, p.status, p.to_deliver_qty
           FROM v_indent_pipeline p JOIN sites s ON s.id = p.site_id
          WHERE p.site_id = ? AND p.status = 'APPROVED' AND p.to_deliver_qty > 0.0005
          ORDER BY p.needed_by IS NULL, p.needed_by, p.doc_no`, [req.query.siteId]);
    } else {
      throw badRequest('Choose the PRNs to issue against');
    }
    if (!prns.length) throw badRequest('Nothing is outstanding on those PRNs');

    const site = await one(`SELECT id, name, code FROM sites WHERE id = ?`, [prns[0].site_id]);

    const lines = await many(
      `SELECT f.indent_id, i.doc_no, i.needed_by,
              f.item_id, f.make_id, f.item_code, f.item_name, f.uom, f.make_name,
              f.indented_qty, f.issued_qty, f.in_transit_qty, f.at_site_qty, f.to_deliver_qty
         FROM v_indent_item_flow f
         JOIN indents i ON i.id = f.indent_id
        WHERE f.indent_id IN (?) AND f.to_deliver_qty > 0.0005
        ORDER BY f.item_name, i.needed_by IS NULL, i.needed_by, i.doc_no`,
      [prns.map((p) => p.indent_id)]);

    // the shelf is shared across every row that names the same item
    const stock = await many(
      `SELECT item_id, qty, latest_rate FROM v_stock_balance WHERE site_id = ?`, [store.id]);
    const byItem = Object.fromEntries(stock.map((s) => [s.item_id, s]));

    res.json({
      store,
      site,
      prns,
      lines: lines.map((l) => {
        const st = byItem[l.item_id] || {};
        return {
          indentId: l.indent_id, prnNo: l.doc_no, neededBy: l.needed_by,
          itemId: l.item_id, makeId: l.make_id,
          itemCode: l.item_code, itemName: l.item_name, uom: l.uom, makeName: l.make_name,
          indentedQty: Number(l.indented_qty),
          issuedQty: Number(l.issued_qty),
          inTransitQty: Number(l.in_transit_qty),
          atSiteQty: Number(l.at_site_qty),
          toDeliverQty: Number(l.to_deliver_qty),
          storeQty: Number(st.qty || 0),
          rate: Number(st.latest_rate || 0),
        };
      }),
    });
  })
);

/* ==================================================================
   Stock. This store's shelf, at what the last order paid.
   ================================================================== */
router.get('/stock',
  validate(z.object({
    branchId: z.coerce.number().int().positive().optional(),
    storeId: z.coerce.number().int().positive().optional(),
    q: z.string().trim().optional(),
    categoryId: z.coerce.number().int().positive().optional(),
    hideEmpty: z.coerce.boolean().default(true),
    sort: z.enum(['item', 'qty', 'value', 'moved']).default('item'),
  }), 'query'),
  wrap(async (req, res) => {
    const store = await requireStore(req);
    const where = ['b.site_id = ?'];
    const params = [store.id];
    if (req.query.categoryId) { where.push('b.category_id = ?'); params.push(req.query.categoryId); }
    if (req.query.q) {
      where.push('(b.item_name LIKE ? OR b.item_code LIKE ?)');
      params.push(`%${req.query.q}%`, `%${req.query.q}%`);
    }
    if (req.query.hideEmpty) where.push('b.qty <> 0');
    const order = {
      item: 'b.item_name', qty: 'b.qty DESC',
      value: '(b.qty * b.latest_rate) DESC', moved: 'b.last_moved DESC',
    }[req.query.sort];

    const rows = await many(
      `SELECT b.*, ROUND(b.qty * b.latest_rate, 2) AS value,
              (SELECT COALESCE(SUM(l.in_transit_qty), 0)
                 FROM v_dc_line_status l
                 JOIN delivery_challans dc ON dc.id = l.dc_id
                WHERE dc.from_site_id = b.site_id AND l.item_id = b.item_id
                  AND dc.status IN ('DISPATCHED','PART_ACK')) AS out_in_transit,
              -- what the sites are asking for that this row could answer
              (SELECT COALESCE(SUM(f.to_deliver_qty), 0)
                 FROM v_indent_item_flow f
                 JOIN indents i ON i.id = f.indent_id
                WHERE f.item_id = b.item_id AND i.status = 'APPROVED'
                  AND i.branch_id = b.branch_id) AS demand_qty
         FROM v_stock_balance b
        WHERE ${where.join(' AND ')}
        ORDER BY ${order}`, params);

    res.json({
      store,
      rows,
      totals: {
        items: rows.length,
        qty: rows.reduce((t, r) => t + Number(r.qty), 0),
        value: rows.reduce((t, r) => t + Number(r.value), 0),
        short: rows.filter((r) => Number(r.demand_qty) > Number(r.qty)).length,
      },
    });
  })
);

/** One item's whole story on this shelf: every movement, both ways. */
router.get('/stock/:itemId',
  validate(z.object({
    branchId: z.coerce.number().int().positive().optional(),
    storeId: z.coerce.number().int().positive().optional(),
  }), 'query'),
  wrap(async (req, res) => {
    const store = await requireStore(req);
    const bal = await one(
      `SELECT b.*, ROUND(b.qty * b.latest_rate, 2) AS value
         FROM v_stock_balance b WHERE b.site_id = ? AND b.item_id = ?`,
      [store.id, req.params.itemId]);
    const moves = await many(
      `SELECT * FROM v_stock_movement WHERE site_id = ? AND item_id = ?
        ORDER BY moved_on DESC, id DESC LIMIT 200`, [store.id, req.params.itemId]);
    const item = await one(
      `SELECT i.id, i.code, i.name, u.code AS uom FROM items i
         JOIN uoms u ON u.id = i.uom_id WHERE i.id = ?`, [req.params.itemId]);
    if (!item) throw notFound('No such item');
    res.json({ store, item, balance: bal || null, moves });
  })
);

/* ==================================================================
   Movement, read as documents. A ledger line is a consequence; the
   GRN and the challan are the things that happened.
   ================================================================== */
router.get('/movements',
  validate(z.object({
    branchId: z.coerce.number().int().positive().optional(),
    storeId: z.coerce.number().int().positive().optional(),
    siteId: z.coerce.number().int().positive().optional(),
    itemId: z.coerce.number().int().positive().optional(),
    kind: z.string().trim().optional(),
    direction: z.enum(['IN', 'OUT', 'ALL']).default('ALL'),
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    q: z.string().trim().optional(),
    limit: z.coerce.number().int().min(1).max(1000).default(300),
  }), 'query'),
  wrap(async (req, res) => {
    // the store's own ledger unless a site is named outright
    const where = [];
    const params = [];
    if (req.query.siteId) { where.push('site_id = ?'); params.push(req.query.siteId); }
    else {
      const store = await requireStore(req);
      where.push('site_id = ?'); params.push(store.id);
    }
    if (req.query.itemId) { where.push('item_id = ?'); params.push(req.query.itemId); }
    if (req.query.kind) { where.push('kind = ?'); params.push(req.query.kind); }
    if (req.query.direction !== 'ALL') { where.push('direction = ?'); params.push(req.query.direction); }
    if (req.query.from) { where.push('moved_on >= ?'); params.push(req.query.from); }
    if (req.query.to) { where.push('moved_on <= ?'); params.push(req.query.to); }
    if (req.query.q) {
      where.push('(item_name LIKE ? OR item_code LIKE ? OR ref_no LIKE ?)');
      const like = `%${req.query.q}%`;
      params.push(like, like, like);
    }

    const rows = await many(
      `SELECT * FROM v_stock_movement WHERE ${where.join(' AND ')}
        ORDER BY moved_on DESC, id DESC LIMIT ${req.query.limit}`, params);

    // the same movements gathered back into the documents that caused
    // them, which is how a storekeeper remembers them
    const docs = [];
    const seen = new Map();
    for (const r of rows) {
      const key = `${r.ref_type}:${r.ref_id}`;
      if (!seen.has(key)) {
        seen.set(key, {
          refType: r.ref_type, refId: r.ref_id, refNo: r.ref_no,
          movedOn: r.moved_on, direction: r.direction, kind: r.kind,
          byName: r.by_name, lines: 0, qty: 0, value: 0,
        });
        docs.push(seen.get(key));
      }
      const d = seen.get(key);
      d.lines += 1;
      d.qty += Math.abs(Number(r.qty));
      d.value += Number(r.value);
    }

    res.json({
      rows,
      docs,
      totals: {
        moves: rows.length,
        docs: docs.length,
        inQty: rows.filter((r) => r.direction === 'IN').reduce((t, r) => t + Number(r.qty), 0),
        outQty: rows.filter((r) => r.direction === 'OUT')
          .reduce((t, r) => t + Math.abs(Number(r.qty)), 0),
        inValue: rows.filter((r) => r.direction === 'IN').reduce((t, r) => t + Number(r.value), 0),
        outValue: rows.filter((r) => r.direction === 'OUT')
          .reduce((t, r) => t + Number(r.value), 0),
      },
    });
  })
);

/**
 * What was in one document.
 *
 * A ledger line says a quantity moved; it does not say what the lorry
 * had on it. This answers that in one shape for both documents, so the
 * movement screen can open a challan or a note without knowing the
 * difference between them.
 */
router.get('/document/:refType/:refId', wrap(async (req, res) => {
  const { refType, refId } = req.params;

  if (refType === 'DC') {
    const dc = await one(`SELECT * FROM v_dc_status WHERE dc_id = ?`, [refId]);
    if (!dc) throw notFound('No such challan');
    const lines = await many(
      `SELECT item_code, item_name, uom, make_name, sent_qty AS qty, acked_qty,
              in_transit_qty, rate, line_value
         FROM v_dc_line_status WHERE dc_id = ? ORDER BY item_name`, [refId]);
    const prns = await many(
      `SELECT DISTINCT i.doc_no FROM dc_line_indents dli
         JOIN delivery_challan_lines dl ON dl.id = dli.dc_line_id
         JOIN indents i ON i.id = dli.indent_id
        WHERE dl.dc_id = ? ORDER BY i.doc_no`, [refId]);
    return res.json({
      refType, refId: dc.dc_id, docNo: dc.doc_no, kind: 'Delivery challan',
      date: dc.dc_date, from: dc.from_name, to: dc.to_name,
      state: dc.state, direction: 'OUT',
      vehicle: dc.vehicle_no, by: dc.dispatched_by_name || dc.created_by_name,
      prns: prns.map((p) => p.doc_no),
      totals: { lines: dc.line_count, qty: dc.sent_qty, value: dc.dc_value,
        acked: dc.acked_qty, inTransit: dc.in_transit_qty },
      lines,
      href: `/challans/${dc.dc_id}`,
    });
  }

  if (refType === 'GRN') {
    const g = await one(`SELECT * FROM v_grn_status WHERE grn_id = ?`, [refId]);
    if (!g) throw notFound('No such receipt');
    const lines = await many(
      `SELECT item_code, item_name, uom, make_name, qty, rate, gst_rate,
              basic, gst_amt, line_value, ordered_qty
         FROM v_grn_line WHERE grn_id = ? ORDER BY item_name`, [refId]);
    return res.json({
      refType, refId: g.grn_id, docNo: g.doc_no, kind: 'Goods receipt note',
      date: g.receipt_date, from: g.supplier_name, to: g.site_name,
      state: g.status === 'CONFIRMED' ? 'IN_STOCK' : 'DRAFT', direction: 'IN',
      supplierDc: g.supplier_dc, po: { id: g.po_id, docNo: g.po_no },
      by: g.received_by_name,
      totals: { lines: g.line_count, qty: g.grn_qty, value: g.grn_value,
        basic: g.grn_basic, gst: g.grn_gst },
      lines,
      href: `/grns/${g.grn_id}`,
    });
  }

  throw badRequest('That is not a document this screen can open');
}));

module.exports = router;
