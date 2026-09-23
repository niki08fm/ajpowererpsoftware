'use strict';
const router = require('express').Router();
const { many } = require('../config/db');
const { wrap } = require('../middleware/validate');
const { ROLES } = require('../lib/access');

/**
 * Alerts: what has gone wrong or is late, for the people who oversee.
 *
 * Nothing here is stored. Every alert is worked out from the documents
 * as they stand right now, so it appears the moment something slips and
 * goes away by itself the moment it is put right — nobody has to clear
 * it, and it can never say something that is no longer true.
 *
 *   Challan not signed for  dispatched, and the site has entered nothing
 *                           a day later                       Management,
 *   Short delivery          the site signed for less than was sent  GM, Store
 *   PRN past needed-by      approved, and not all of it at site by the
 *                           date the site asked for           Management, GM, Store
 *   PRN not ordered         past its needed-by date and some of it on
 *                           no purchase order yet             Procurement
 *   Supplier delivery late  a PO past its expected date, not fully
 *                           received                          Management, Procurement,
 *                                                             GM (a PO for their project)
 *
 * Management sees every project; a GM sees the challans for the
 * projects they are GM of; the store sees every challan it sent.
 */

const WHO = {
  challans: [ROLES.MANAGEMENT, ROLES.GM, ROLES.STORE],
  prns: [ROLES.MANAGEMENT, ROLES.GM, ROLES.STORE],
  unordered: [ROLES.PROCUREMENT],
  pos: [ROLES.MANAGEMENT, ROLES.PROCUREMENT, ROLES.GM],
};

async function alertsFor(req) {
  const role = req.user?.department;
  const scope = req.access?.siteIds || null;   // null: every site
  const out = [];

  if (WHO.challans.includes(role)) {
    const dcs = await many(
      `SELECT dc_id, doc_no, state, dc_date, dispatched_at, from_name, to_name, to_site_id,
              sent_qty, acked_qty, in_transit_qty, days_out,
              TIMESTAMPDIFF(HOUR, dispatched_at, NOW()) AS hours_out
         FROM v_dc_status
        WHERE (state = 'IN_TRANSIT' AND dispatched_at <= NOW() - INTERVAL 1 DAY)
           OR state = 'PART_ACK'
        ORDER BY dispatched_at`);
    for (const d of dcs) {
      if (scope && !scope.has(Number(d.to_site_id))) continue;
      const short = d.state === 'PART_ACK';
      out.push({
        key: `dc-${d.dc_id}`,
        kind: short ? 'SHORT_DELIVERY' : 'NOT_SIGNED',
        tone: 'stopped',
        title: short
          ? `${d.doc_no} short delivered at ${d.to_name}`
          : `${d.doc_no} not signed for at ${d.to_name}`,
        detail: short
          ? `${Number(d.acked_qty)} of ${Number(d.sent_qty)} signed for · ${Number(d.in_transit_qty)} not received`
          : `Dispatched from ${d.from_name} ${Math.floor(Number(d.hours_out) / 24)} day(s) ago · nothing entered by the site`,
        since: d.dispatched_at,
        link: `/challans/${d.dc_id}`,
      });
    }
  }

  if (WHO.prns.includes(role)) {
    const prns = await many(
      `SELECT p.indent_id, p.doc_no, p.site_id, p.needed_by, p.indented_qty, p.at_site_qty,
              p.to_deliver_qty, s.name AS site_name,
              DATEDIFF(CURDATE(), p.needed_by) AS days_late
         FROM v_indent_pipeline p JOIN sites s ON s.id = p.site_id
        WHERE p.status = 'APPROVED' AND p.to_deliver_qty > 0
          AND p.needed_by IS NOT NULL AND p.needed_by < CURDATE()
        ORDER BY p.needed_by`);
    for (const r of prns) {
      if (scope && !scope.has(Number(r.site_id))) continue;
      out.push({
        key: `prn-${r.indent_id}`,
        kind: 'PRN_LATE',
        tone: 'attention',
        title: `${r.doc_no} for ${r.site_name} is ${r.days_late} day(s) past its needed-by date`,
        detail: `Needed by ${String(r.needed_by).slice(0, 10)} · ${Number(r.at_site_qty)} of `
          + `${Number(r.indented_qty)} at site · ${Number(r.to_deliver_qty)} still to reach the site`,
        since: r.needed_by,
        link: `/indents/${r.indent_id}`,
        indentId: r.indent_id,
      });
    }
  }

  // for the buyer: past the date and not even ordered yet
  if (WHO.unordered.includes(role)) {
    const prns = await many(
      `SELECT p.indent_id, p.doc_no, p.site_id, p.needed_by, p.indented_qty, p.ordered_qty,
              p.pending_gm_qty, p.to_order_qty, s.name AS site_name,
              DATEDIFF(CURDATE(), p.needed_by) AS days_late
         FROM v_indent_pipeline p JOIN sites s ON s.id = p.site_id
        WHERE p.status = 'APPROVED' AND p.to_order_qty > 0
          AND p.needed_by IS NOT NULL AND p.needed_by < CURDATE()
        ORDER BY p.needed_by`);
    for (const r of prns) {
      out.push({
        key: `prnorder-${r.indent_id}`,
        kind: 'PRN_NOT_ORDERED',
        tone: 'stopped',
        title: `${r.doc_no} for ${r.site_name} is ${r.days_late} day(s) past its needed-by date and not fully ordered`,
        detail: `Needed by ${String(r.needed_by).slice(0, 10)} · ${Number(r.to_order_qty)} of `
          + `${Number(r.indented_qty)} on no purchase order yet`
          + (Number(r.pending_gm_qty) > 0 ? ` · ${Number(r.pending_gm_qty)} on an order awaiting approval` : ''),
        since: r.needed_by,
        link: `/indents/${r.indent_id}`,
        indentId: r.indent_id,
      });
    }
  }

  if (WHO.pos.includes(role)) {
    const pos = await many(
      `SELECT po_id, doc_no, supplier_name, deliver_to_id, deliver_to_name, expected_date,
              ordered_qty, received_qty, pending_qty, receipt_state,
              DATEDIFF(CURDATE(), expected_date) AS days_late,
              -- the projects it is buying for: the sites of the PRNs behind it
              (SELECT GROUP_CONCAT(DISTINCT i.site_id)
                 FROM purchase_order_lines pol
                 JOIN po_line_indents pli ON pli.po_line_id = pol.id
                 JOIN indents i ON i.id = pli.indent_id
                WHERE pol.po_id = v_po_status.po_id) AS for_sites
         FROM v_po_status
        WHERE status = 'APPROVED' AND pending_qty > 0
          AND expected_date IS NOT NULL AND expected_date < CURDATE()
        ORDER BY expected_date`);
    for (const p of pos) {
      // a GM hears about an order that buys for one of their projects,
      // or goes straight to one of their sites
      if (scope) {
        const sites = String(p.for_sites || '').split(',').filter(Boolean).map(Number);
        const mine = sites.some((id) => scope.has(id))
          || (p.deliver_to_id && scope.has(Number(p.deliver_to_id)) && !sites.length);
        if (!mine) continue;
      }
      out.push({
        key: `po-${p.po_id}`,
        kind: 'PO_LATE',
        tone: 'attention',
        title: `${p.doc_no} from ${p.supplier_name} is ${p.days_late} day(s) late`,
        detail: `Due ${String(p.expected_date).slice(0, 10)} at ${p.deliver_to_name} · `
          + `${Number(p.received_qty)} of ${Number(p.ordered_qty)} received`,
        since: p.expected_date,
        link: `/purchase-orders/${p.po_id}`,
      });
    }
  }

  // the worst first: a delivery gone missing before a late supplier
  const rank = { stopped: 0, attention: 1 };
  return out.sort((a, b) => rank[a.tone] - rank[b.tone]
    || String(a.since).localeCompare(String(b.since)));
}

router.get('/', wrap(async (req, res) => {
  const rows = await alertsFor(req);
  res.json({ rows, count: rows.length });
}));

router.get('/count', wrap(async (req, res) => {
  res.json({ count: (await alertsFor(req)).length });
}));

module.exports = router;
