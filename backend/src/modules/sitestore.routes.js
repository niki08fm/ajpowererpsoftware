'use strict';
const router = require('express').Router();
const { z } = require('zod');
const { many, one } = require('../config/db');
const { validate, wrap } = require('../middleware/validate');
const { notFound } = require('../lib/errors');

/**
 * The site's own store, and the site's acknowledgements.
 *
 * This is not the central store and does not behave like one. It buys
 * nothing, it holds no rates of its own, and every item on its shelf
 * got there because somebody at the site signed for it. Material is
 * carried here at what the central store paid for it, because the site
 * never negotiated a price and has no business quoting one.
 *
 * Acknowledgement belongs here. Whatever is directed at this site —
 * a challan from the store, or a purchase order the buyer sent straight
 * to site — is the site team's to receive. Nothing lands on this shelf
 * until they say it arrived.
 */

async function requireSite(id) {
  const s = await one(
    `SELECT id, code, name, site_type, branch_id FROM sites WHERE id = ?`, [id]);
  if (!s) throw notFound('No such site');
  return s;
}

/* ==================================================================
   Everything waiting for this site's signature.
   ================================================================== */
router.get('/:siteId/inbox', wrap(async (req, res) => {
  const site = await requireSite(req.params.siteId);

  // challans the store has sent here and nobody has signed off
  const challans = await many(
    `SELECT v.dc_id, v.doc_no, v.dc_date, v.dispatched_at, v.vehicle_no, v.driver,
            v.from_site_id, v.from_name, v.state, v.status, v.days_out,
            v.line_count, v.sent_qty, v.acked_qty, v.in_transit_qty, v.dc_value,
            (SELECT GROUP_CONCAT(DISTINCT i.doc_no ORDER BY i.doc_no SEPARATOR ', ')
               FROM dc_line_indents dli
               JOIN delivery_challan_lines dl ON dl.id = dli.dc_line_id
               JOIN indents i ON i.id = dli.indent_id
              WHERE dl.dc_id = v.dc_id) AS prns
       FROM v_dc_status v
      WHERE v.to_site_id = ? AND v.state IN ('IN_TRANSIT','PART_ACK')
      ORDER BY v.days_out DESC, v.dc_date`, [site.id]);

  // orders the buyer sent straight here, bypassing the store — the
  // site signs for those itself, and a GRN is what that produces
  const orders = await many(
    `SELECT v.po_id, v.doc_no, v.po_date, v.expected_date, v.supplier_name,
            v.ordered_qty, v.received_qty, v.pending_qty, v.po_value, v.overdue,
            v.receipt_state,
            (SELECT GROUP_CONCAT(DISTINCT i.doc_no ORDER BY i.doc_no SEPARATOR ', ')
               FROM purchase_order_indents poi JOIN indents i ON i.id = poi.indent_id
              WHERE poi.po_id = v.po_id) AS prns
       FROM v_po_status v JOIN purchase_orders po ON po.id = v.po_id
      WHERE po.status = 'APPROVED' AND v.deliver_to_id = ? AND v.pending_qty > 0.0005
      ORDER BY v.expected_date IS NULL, v.expected_date`, [site.id]);

  // what this site has signed for lately, both ways in
  const signed = await many(
    `SELECT 'DC' AS kind, a.id, d.doc_no, a.ack_date AS on_date, u.name AS by_name, a.note,
            (SELECT COALESCE(SUM(al.qty), 0) FROM dc_acknowledgement_lines al
              WHERE al.ack_id = a.id) AS qty
       FROM dc_acknowledgements a
       JOIN delivery_challans d ON d.id = a.dc_id
       LEFT JOIN users u ON u.id = a.acked_by
      WHERE d.to_site_id = ?
      UNION ALL
     SELECT 'GRN' AS kind, g.grn_id AS id, g.doc_no, g.receipt_date AS on_date,
            g.received_by_name AS by_name, g.note, g.grn_qty AS qty
       FROM v_grn_status g WHERE g.site_id = ?
      ORDER BY on_date DESC, id DESC LIMIT 40`, [site.id, site.id]);

  res.json({
    site,
    challans,
    orders,
    signed,
    totals: {
      waiting: challans.length + orders.length,
      inTransitQty: challans.reduce((t, r) => t + Number(r.in_transit_qty), 0),
      onOrderQty: orders.reduce((t, r) => t + Number(r.pending_qty), 0),
      overdue: challans.filter((r) => Number(r.days_out) > 3).length
        + orders.filter((r) => Number(r.overdue) > 0).length,
    },
  });
}));

/* ==================================================================
   The site's shelf. Quantities, not money.
   ================================================================== */
router.get('/:siteId/stock',
  validate(z.object({
    q: z.string().trim().optional(),
    categoryId: z.coerce.number().int().positive().optional(),
    hideEmpty: z.coerce.boolean().default(true),
    sort: z.enum(['item', 'qty', 'moved']).default('item'),
  }), 'query'),
  wrap(async (req, res) => {
    const site = await requireSite(req.params.siteId);
    const where = ['b.site_id = ?'];
    const params = [site.id];
    if (req.query.categoryId) { where.push('b.category_id = ?'); params.push(req.query.categoryId); }
    if (req.query.q) {
      where.push('(b.item_name LIKE ? OR b.item_code LIKE ?)');
      params.push(`%${req.query.q}%`, `%${req.query.q}%`);
    }
    if (req.query.hideEmpty) where.push('b.qty <> 0');
    const order = { item: 'b.item_name', qty: 'b.qty DESC', moved: 'b.last_moved DESC' }
      [req.query.sort];

    // no rate column: the site did not buy this and cannot price it
    const rows = await many(
      `SELECT b.site_id, b.item_id, b.item_code, b.item_name, b.uom, b.category_id,
              b.qty, b.last_in, b.last_moved,
              -- still coming: signed out of the store, not yet signed for here
              (SELECT COALESCE(SUM(l.in_transit_qty), 0)
                 FROM v_dc_line_status l
                 JOIN delivery_challans dc ON dc.id = l.dc_id
                WHERE dc.to_site_id = b.site_id AND l.item_id = b.item_id
                  AND dc.status IN ('DISPATCHED','PART_ACK')) AS incoming_qty
         FROM v_stock_balance b
        WHERE ${where.join(' AND ')}
        ORDER BY ${order}`, params);

    // things on the way that this shelf has never held, so they would
    // not otherwise appear at all
    const incomingOnly = await many(
      `SELECT it.id AS item_id, it.code AS item_code, it.name AS item_name, u.code AS uom,
              0 AS qty, NULL AS last_in, NULL AS last_moved,
              SUM(l.in_transit_qty) AS incoming_qty
         FROM v_dc_line_status l
         JOIN delivery_challans dc ON dc.id = l.dc_id
         JOIN items it ON it.id = l.item_id
         JOIN uoms  u  ON u.id = it.uom_id
        WHERE dc.to_site_id = ? AND dc.status IN ('DISPATCHED','PART_ACK')
          AND l.in_transit_qty > 0.0005
          AND NOT EXISTS (SELECT 1 FROM stock_movements m
                           WHERE m.site_id = dc.to_site_id AND m.item_id = l.item_id)
        GROUP BY it.id`, [site.id]);

    const all = [...rows, ...incomingOnly.map((r) => ({ ...r, site_id: site.id }))];
    res.json({
      site,
      rows: all,
      totals: {
        items: all.filter((r) => Number(r.qty) !== 0).length,
        qty: all.reduce((t, r) => t + Number(r.qty), 0),
        incoming: all.reduce((t, r) => t + Number(r.incoming_qty || 0), 0),
      },
    });
  })
);

/** One item on this shelf: how it got here and where it went. */
router.get('/:siteId/stock/:itemId', wrap(async (req, res) => {
  const site = await requireSite(req.params.siteId);
  const item = await one(
    `SELECT i.id, i.code, i.name, u.code AS uom FROM items i
       JOIN uoms u ON u.id = i.uom_id WHERE i.id = ?`, [req.params.itemId]);
  if (!item) throw notFound('No such item');
  const bal = await one(
    `SELECT qty, last_in, last_moved FROM v_stock_balance WHERE site_id = ? AND item_id = ?`,
    [site.id, item.id]);
  const moves = await many(
    `SELECT id, moved_on, qty, kind, ref_type, ref_id, ref_no, direction, by_name, make_name
       FROM v_stock_movement WHERE site_id = ? AND item_id = ?
      ORDER BY moved_on DESC, id DESC LIMIT 200`, [site.id, item.id]);
  res.json({ site, item, balance: bal || { qty: 0 }, moves });
}));

/** The site's ledger, in quantities. */
router.get('/:siteId/movements',
  validate(z.object({
    kind: z.string().trim().optional(),
    direction: z.enum(['IN', 'OUT', 'ALL']).default('ALL'),
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    q: z.string().trim().optional(),
    limit: z.coerce.number().int().min(1).max(1000).default(300),
  }), 'query'),
  wrap(async (req, res) => {
    const site = await requireSite(req.params.siteId);
    const where = ['site_id = ?'];
    const params = [site.id];
    if (req.query.kind) { where.push('kind = ?'); params.push(req.query.kind); }
    if (req.query.direction !== 'ALL') {
      where.push('direction = ?'); params.push(req.query.direction);
    }
    if (req.query.from) { where.push('moved_on >= ?'); params.push(req.query.from); }
    if (req.query.to) { where.push('moved_on <= ?'); params.push(req.query.to); }
    if (req.query.q) {
      where.push('(item_name LIKE ? OR item_code LIKE ? OR ref_no LIKE ?)');
      const like = `%${req.query.q}%`;
      params.push(like, like, like);
    }
    const rows = await many(
      `SELECT id, moved_on, item_id, item_code, item_name, uom, make_name, qty, kind,
              ref_type, ref_id, ref_no, direction, by_name
         FROM v_stock_movement WHERE ${where.join(' AND ')}
        ORDER BY moved_on DESC, id DESC LIMIT ${req.query.limit}`, params);
    res.json({
      site,
      rows,
      totals: {
        moves: rows.length,
        inQty: rows.filter((r) => r.direction === 'IN').reduce((t, r) => t + Number(r.qty), 0),
        outQty: rows.filter((r) => r.direction === 'OUT')
          .reduce((t, r) => t + Math.abs(Number(r.qty)), 0),
      },
    });
  })
);

module.exports = router;
