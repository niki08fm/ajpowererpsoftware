'use strict';
const router = require('express').Router();
const { z } = require('zod');
const { many, one } = require('../config/db');
const { validate, wrap } = require('../middleware/validate');
const { badRequest, notFound } = require('../lib/errors');
const { plural } = require('../lib/words');

/**
 * My desk — the first thing each department sees.
 *
 * One shape for every department, so the screen is one screen:
 *
 *   tiles   counts that need somebody to act, each a link to the list
 *   needs   the specific documents behind them, the late ones first —
 *           late meaning past a date somebody committed to, or sitting
 *           longer than it should with the person who has to act
 *   trends  what the last few weeks or months looked like
 *
 * Nothing here is stored. Every number is the same derived view the
 * department's own screens read, so the desk and the screen behind a
 * tile can never disagree.
 *
 * Site screens never show money and this desk keeps that rule: the site
 * and store trends count documents, not rupees. Procurement, billing and
 * reports are money departments and their trends are in money.
 */

const WEEKS = 12;
const MONTHS = 6;

/** Buckets back from the database's own today, gap-free. */
async function buckets(kind) {
  const { d } = await one(`SELECT DATE_FORMAT(CURDATE(), '%Y-%m-%d') AS d`);
  const [y, m, day] = d.split('-').map(Number);
  const out = [];
  if (kind === 'week') {
    const t = new Date(Date.UTC(y, m - 1, day));
    t.setUTCDate(t.getUTCDate() - ((t.getUTCDay() + 6) % 7));   // back to Monday
    for (let i = WEEKS - 1; i >= 0; i -= 1) {
      const w = new Date(t); w.setUTCDate(t.getUTCDate() - i * 7);
      out.push(w.toISOString().slice(0, 10));
    }
  } else {
    for (let i = MONTHS - 1; i >= 0; i -= 1) {
      const w = new Date(Date.UTC(y, m - 1 - i, 1));
      out.push(w.toISOString().slice(0, 10));
    }
  }
  return out;
}
// the SQL twins of those buckets
const WEEK_OF = (col) => `DATE_FORMAT(DATE_SUB(${col}, INTERVAL WEEKDAY(${col}) DAY), '%Y-%m-%d')`;
const MONTH_OF = (col) => `DATE_FORMAT(${col}, '%Y-%m-01')`;
const SINCE = (kind) => (kind === 'week'
  ? `DATE_SUB(DATE_SUB(CURDATE(), INTERVAL WEEKDAY(CURDATE()) DAY), INTERVAL ${WEEKS - 1} WEEK)`
  : `DATE_FORMAT(DATE_SUB(CURDATE(), INTERVAL ${MONTHS - 1} MONTH), '%Y-%m-01')`);

/** Fold several {bucket, n} result sets into one gap-free series. */
function series(keys, sets, bs) {
  return bs.map((b) => {
    const row = { bucket: b };
    keys.forEach((k, i) => {
      const hit = sets[i].find((r) => r.b === b);
      row[k] = hit ? Number(hit.n) : 0;
    });
    return row;
  });
}

const branchClause = (branchId, col = 'branch_id') =>
  (branchId ? { sql: ` AND ${col} = ?`, p: [Number(branchId)] } : { sql: '', p: [] });

const late = (days) => (Number(days) > 0 ? Number(days) : 0);
const byUrgency = (a, b) => (b.severity === 'bad') - (a.severity === 'bad') || b.late - a.late;

/* ================================================================ Planning */
async function planning(branchId) {
  const bc = branchClause(branchId, 's.branch_id');
  const [noWo, noBoq, drafts, amend] = await Promise.all([
    many(`SELECT s.id, s.code, s.name, DATEDIFF(CURDATE(), DATE(s.created_at)) AS age
            FROM sites s LEFT JOIN work_orders wo ON wo.site_id = s.id
           WHERE s.site_type = 'SITE' AND s.status = 'ACTIVE' AND wo.id IS NULL${bc.sql}`, bc.p),
    many(`SELECT wo.id, wo.doc_no, s.id AS site_id, s.name, DATEDIFF(CURDATE(), DATE(wo.created_at)) AS age
            FROM work_orders wo JOIN sites s ON s.id = wo.site_id
            LEFT JOIN boqs b ON b.work_order_id = wo.id
           WHERE b.id IS NULL${bc.sql}`, bc.p),
    many(`SELECT b.id, b.doc_no, s.id AS site_id, s.name, v.prepared_count, v.wo_line_count,
                 DATEDIFF(CURDATE(), DATE(b.created_at)) AS age
            FROM boqs b JOIN sites s ON s.id = b.site_id JOIN v_boq_status v ON v.boq_id = b.id
           WHERE b.status = 'DRAFT'${bc.sql}`, bc.p),
    many(`SELECT b.id, b.doc_no, s.id AS site_id, s.name, v.over_line_count, v.worst_over_pct
            FROM boqs b JOIN sites s ON s.id = b.site_id JOIN v_boq_status v ON v.boq_id = b.id
           WHERE v.state = 'AMENDMENT_DUE'${bc.sql}`, bc.p),
  ]);

  const needs = [
    ...amend.map((r) => ({ kind: 'Amendment due', ref: r.doc_no, title: r.name,
      detail: `${plural(r.over_line_count, 'line')} past the estimate, worst ${Number(r.worst_over_pct)}% over`,
      severity: 'bad', late: 0, to: `/sites/${r.site_id}` })),
    ...noBoq.map((r) => ({ kind: 'Work order, no BOQ', ref: r.doc_no, title: r.name,
      detail: `loaded ${plural(r.age, 'day')} ago — no PRN can be raised until the BOQ exists`,
      severity: r.age > 3 ? 'bad' : 'warn', late: Math.max(0, r.age - 3), to: `/sites/${r.site_id}` })),
    ...drafts.map((r) => ({ kind: 'BOQ in draft', ref: r.doc_no, title: r.name,
      detail: `${r.prepared_count} of ${r.wo_line_count} lines prepared · ${plural(r.age, 'day')} old`,
      severity: r.age > 3 ? 'bad' : 'warn', late: Math.max(0, r.age - 3), to: `/sites/${r.site_id}` })),
    ...noWo.map((r) => ({ kind: 'Site, no work order', ref: r.code, title: r.name,
      detail: `opened ${plural(r.age, 'day')} ago`, severity: 'warn', late: 0, to: `/sites/${r.id}` })),
  ].sort(byUrgency);

  const bs = await buckets('week');
  const ib = branchClause(branchId, 'i.branch_id');
  const [raised, approved] = await Promise.all([
    many(`SELECT ${WEEK_OF('i.indent_date')} AS b, COUNT(*) AS n FROM indents i
           WHERE i.indent_date >= ${SINCE('week')} AND i.status <> 'DRAFT'${ib.sql} GROUP BY b`, ib.p),
    many(`SELECT ${WEEK_OF('DATE(e.created_at)')} AS b, COUNT(*) AS n
            FROM indent_events e JOIN indents i ON i.id = e.indent_id
           WHERE e.action = 'APPROVED' AND e.created_at >= ${SINCE('week')}${ib.sql} GROUP BY b`, ib.p),
  ]);

  return {
    tiles: [
      { key: 'amend', label: 'amendments due', n: amend.length, tone: amend.length ? 'bad' : '', to: '/boq' },
      { key: 'noboq', label: 'work orders with no BOQ', n: noBoq.length, tone: noBoq.length ? 'warn' : '', to: '/sites' },
      { key: 'drafts', label: 'BOQs in draft', n: drafts.length, to: '/boq' },
      { key: 'nowo', label: 'sites with no work order', n: noWo.length, to: '/sites' },
    ],
    needs,
    trends: [{
      key: 'indents', title: 'Indents, week by week', sub: 'raised against approved', bucket: 'week', unit: 'count',
      // raised, then approved: the second is a subset of the first, so
      // the overview may draw it as a funnel and name what fell out.
      // Nothing else here is a pipeline — billed against cost are two
      // separate measures and a funnel of them would be a lie.
      funnel: true,
      lines: [{ key: 'raised', label: 'Raised', tone: 'brand' }, { key: 'approved', label: 'Approved', tone: 'navy' }],
      series: series(['raised', 'approved'], [raised, approved], bs),
    }],
  };
}

/* ==================================================================== Site */
async function site(siteId) {
  const s = await one(`SELECT id, name, branch_id FROM sites WHERE id = ? AND site_type = 'SITE'`, [siteId]);
  if (!s) throw notFound('No such site');

  const [inbound, direct, lateprn, waiting, returned, trs, claims] = await Promise.all([
    many(`SELECT dc_id, doc_no, from_name, dc_date, days_out, in_transit_qty
            FROM v_dc_status WHERE to_site_id = ? AND state IN ('IN_TRANSIT','PART_ACK')`, [s.id]),
    many(`SELECT po_id, doc_no, supplier_name, expected_date, overdue,
                 DATEDIFF(CURDATE(), expected_date) AS days_over
            FROM v_po_status WHERE deliver_to_id = ? AND status = 'APPROVED' AND pending_qty > 0.0005`, [s.id]),
    many(`SELECT indent_id, doc_no, needed_by, stage, DATEDIFF(CURDATE(), needed_by) AS days_over
            FROM v_indent_pipeline
           WHERE site_id = ? AND status = 'APPROVED' AND to_deliver_qty > 0.0005
             AND needed_by IS NOT NULL AND needed_by < CURDATE()`, [s.id]),
    many(`SELECT i.id, i.doc_no, i.indent_date,
                 TIMESTAMPDIFF(DAY, COALESCE(MAX(e.created_at), i.updated_at), NOW()) AS age
            FROM indents i LEFT JOIN indent_events e ON e.indent_id = i.id AND e.action = 'SUBMITTED'
           WHERE i.site_id = ? AND i.status = 'SUBMITTED' GROUP BY i.id`, [s.id]),
    many(`SELECT id, doc_no FROM indents WHERE site_id = ? AND status = 'RETURNED'`, [s.id]),
    many(`SELECT tr_id, doc_no, to_name, state, days_late,
                 DATEDIFF(CURDATE(), request_date) AS age
            FROM v_tr_status WHERE from_site_id = ? AND state IN ('AWAITING','TO_SEND','PART_SENT')`, [s.id]),
    many(`SELECT id, doc_no, description FROM site_expenses WHERE site_id = ? AND status = 'RETURNED'`, [s.id]),
  ]);

  const needs = [
    ...lateprn.map((r) => ({ kind: 'PRN overdue', ref: r.doc_no, title: `wanted by ${String(r.needed_by).slice(0, 10)}`,
      detail: `still not here · ${String(r.stage).replace(/_/g, ' ').toLowerCase()}`,
      severity: 'bad', late: late(r.days_over), to: `/indents/${r.indent_id}` })),
    ...inbound.map((r) => ({ kind: 'Delivery to receive', ref: r.doc_no, title: `from ${r.from_name}`,
      detail: `on the road ${plural(r.days_out, 'day')}`, severity: r.days_out > 3 ? 'bad' : 'warn',
      late: Math.max(0, r.days_out - 3), to: '/site/inbox' })),
    ...direct.map((r) => ({ kind: 'Order coming direct', ref: r.doc_no, title: r.supplier_name,
      detail: r.expected_date ? `expected ${String(r.expected_date).slice(0, 10)}` : 'no expected date',
      severity: Number(r.overdue) ? 'bad' : 'warn', late: late(r.days_over), to: '/site/inbox' })),
    ...trs.map((r) => ({ kind: r.state === 'AWAITING' ? 'Transfer to answer' : 'Transfer to send',
      ref: r.doc_no, title: `to ${r.to_name}`, detail: `asked ${plural(r.age, 'day')} ago`,
      severity: r.days_late > 0 || r.age > 2 ? 'bad' : 'warn', late: late(r.days_late), to: '/site/transfers' })),
    ...returned.map((r) => ({ kind: 'PRN sent back', ref: r.doc_no, title: 'needs changing and resending',
      detail: '', severity: 'warn', late: 0, to: `/indents/${r.id}` })),
    ...claims.map((r) => ({ kind: 'Claim sent back', ref: r.doc_no, title: r.description,
      detail: '', severity: 'warn', late: 0, to: '/site/expenses' })),
    ...waiting.map((r) => ({ kind: 'PRN with the GM', ref: r.doc_no, title: 'waiting for approval',
      detail: `${plural(r.age, 'day')} so far`, severity: r.age > 2 ? 'warn' : '', late: Math.max(0, r.age - 2),
      to: `/indents/${r.id}` })),
  ].sort(byUrgency);

  const bs = await buckets('week');
  const [issues, prns, acks] = await Promise.all([
    many(`SELECT ${WEEK_OF('used_on')} AS b, COUNT(*) AS n FROM consumptions
           WHERE site_id = ? AND status = 'CONFIRMED' AND used_on >= ${SINCE('week')} GROUP BY b`, [s.id]),
    many(`SELECT ${WEEK_OF('indent_date')} AS b, COUNT(*) AS n FROM indents
           WHERE site_id = ? AND status <> 'DRAFT' AND indent_date >= ${SINCE('week')} GROUP BY b`, [s.id]),
    many(`SELECT ${WEEK_OF('a.ack_date')} AS b, COUNT(*) AS n
            FROM dc_acknowledgements a JOIN delivery_challans dc ON dc.id = a.dc_id
           WHERE dc.to_site_id = ? AND a.ack_date >= ${SINCE('week')} GROUP BY b`, [s.id]),
  ]);

  return {
    scope: { site: s.name },
    tiles: [
      { key: 'late', label: 'PRNs past their date', n: lateprn.length, tone: lateprn.length ? 'bad' : '', to: '/indents' },
      { key: 'sign', label: 'deliveries to receive', n: inbound.length + direct.length,
        tone: inbound.length + direct.length ? 'warn' : '', to: '/site/inbox' },
      { key: 'tr', label: 'transfers to handle', n: trs.length, tone: trs.length ? 'warn' : '', to: '/site/transfers' },
      { key: 'gm', label: 'PRNs with the GM', n: waiting.length, to: '/indents' },
      { key: 'back', label: 'sent back to fix', n: returned.length + claims.length,
        tone: returned.length + claims.length ? 'warn' : '', to: '/indents' },
    ],
    needs,
    trends: [{
      key: 'activity', title: 'This site, week by week', sub: 'documents, not quantities — a site keeps no rates',
      bucket: 'week', unit: 'count',
      lines: [
        { key: 'issues', label: 'Issue slips', tone: 'brand' },
        { key: 'prns', label: 'PRNs raised', tone: 'navy' },
        { key: 'acks', label: 'Deliveries received', tone: 'cat3' },
      ],
      series: series(['issues', 'prns', 'acks'], [issues, prns, acks], bs),
    }],
  };
}

/* =================================================================== Store */
async function store(storeId) {
  const st = await one(`SELECT id, name, branch_id FROM sites WHERE id = ? AND site_type = 'STORE'`, [storeId]);
  if (!st) throw notFound('No such store');

  const [latePrn, openPrn, lateOrders, coming, unsigned, trs] = await Promise.all([
    many(`SELECT p.indent_id, p.doc_no, s.name AS site_name, p.needed_by, DATEDIFF(CURDATE(), p.needed_by) AS days_over
            FROM v_indent_pipeline p JOIN sites s ON s.id = p.site_id
           WHERE p.branch_id = ? AND p.status = 'APPROVED' AND p.to_deliver_qty > 0.0005
             AND p.needed_by IS NOT NULL AND p.needed_by < CURDATE()`, [st.branch_id]),
    one(`SELECT COUNT(*) AS n FROM v_indent_pipeline
          WHERE branch_id = ? AND status = 'APPROVED' AND to_deliver_qty > 0.0005`, [st.branch_id]),
    many(`SELECT po_id, doc_no, supplier_name, expected_date, DATEDIFF(CURDATE(), expected_date) AS days_over
            FROM v_po_status WHERE deliver_to_id = ? AND status = 'APPROVED'
             AND pending_qty > 0.0005 AND overdue = 1`, [st.id]),
    one(`SELECT COUNT(*) AS n FROM v_po_status
          WHERE deliver_to_id = ? AND status = 'APPROVED' AND pending_qty > 0.0005`, [st.id]),
    many(`SELECT dc_id, doc_no, to_name, days_out FROM v_dc_status
           WHERE from_site_id = ? AND state IN ('IN_TRANSIT','PART_ACK')`, [st.id]),
    many(`SELECT tr_id, doc_no, from_name, to_name, DATEDIFF(CURDATE(), request_date) AS age
            FROM v_tr_status WHERE store_id = ? AND state = 'AWAITING'`, [st.id]),
  ]);

  const needs = [
    ...latePrn.map((r) => ({ kind: 'PRN overdue', ref: r.doc_no, title: r.site_name,
      detail: `wanted by ${String(r.needed_by).slice(0, 10)}`, severity: 'bad', late: late(r.days_over),
      to: `/store/issue?prns=${r.indent_id}` })),
    ...lateOrders.map((r) => ({ kind: 'Supplier late', ref: r.doc_no, title: r.supplier_name,
      detail: `expected ${String(r.expected_date).slice(0, 10)}`, severity: 'bad', late: late(r.days_over),
      to: `/purchase-orders/${r.po_id}` })),
    ...unsigned.filter((r) => r.days_out > 3).map((r) => ({ kind: 'Challan unsigned', ref: r.doc_no,
      title: `to ${r.to_name}`, detail: `out ${plural(r.days_out, 'day')}, not yet received`,
      severity: 'warn', late: r.days_out - 3, to: `/challans/${r.dc_id}` })),
    ...trs.filter((r) => r.age > 2).map((r) => ({ kind: 'Transfer unanswered', ref: r.doc_no,
      title: `${r.from_name} → ${r.to_name}`, detail: `asked ${plural(r.age, 'day')} ago`,
      severity: 'warn', late: r.age - 2, to: '/store/transfers' })),
  ].sort(byUrgency);

  const bs = await buckets('week');
  const [grns, dcs] = await Promise.all([
    many(`SELECT ${WEEK_OF('receipt_date')} AS b, COUNT(*) AS n FROM goods_receipts
           WHERE received_at = ? AND status = 'CONFIRMED' AND receipt_date >= ${SINCE('week')} GROUP BY b`, [st.id]),
    many(`SELECT ${WEEK_OF('dc_date')} AS b, COUNT(*) AS n FROM delivery_challans
           WHERE from_site_id = ? AND status IN ('DISPATCHED','PART_ACK','ACKNOWLEDGED')
             AND dc_date >= ${SINCE('week')} GROUP BY b`, [st.id]),
  ]);

  return {
    scope: { store: st.name },
    tiles: [
      { key: 'prns', label: 'PRNs to fulfil', n: Number(openPrn.n), to: '/store/prns' },
      { key: 'late', label: 'past their date', n: latePrn.length, tone: latePrn.length ? 'bad' : '', to: '/store/prns' },
      { key: 'coming', label: 'orders coming in', n: Number(coming.n), to: '/grns' },
      { key: 'supl', label: 'suppliers late', n: lateOrders.length, tone: lateOrders.length ? 'bad' : '', to: '/grns' },
      { key: 'out', label: 'challans out unsigned', n: unsigned.length,
        tone: unsigned.some((r) => r.days_out > 3) ? 'warn' : '', to: '/challans' },
    ],
    needs,
    trends: [{
      key: 'flow', title: 'In and out, week by week', sub: 'goods receipts against challans dispatched',
      bucket: 'week', unit: 'count',
      lines: [{ key: 'in', label: 'Receipts in', tone: 'brand' }, { key: 'out', label: 'Challans out', tone: 'navy' }],
      series: series(['in', 'out'], [grns, dcs], bs),
    }],
  };
}

/* ================================================================= Procure */
async function procure(branchId) {
  const bc = branchClause(branchId);
  const [toBuy, withGm, lateDel, lateNeed] = await Promise.all([
    one(`SELECT COUNT(*) AS n FROM v_indent_pipeline
          WHERE status = 'APPROVED' AND to_order_qty > 0.0005${bc.sql}`, bc.p),
    many(`SELECT po_id, doc_no, supplier_name, po_value,
                 TIMESTAMPDIFF(DAY, submitted_at, NOW()) AS age
            FROM v_po_status WHERE status = 'SUBMITTED'${bc.sql}`, bc.p),
    many(`SELECT po_id, doc_no, supplier_name, deliver_to_name, expected_date,
                 DATEDIFF(CURDATE(), expected_date) AS days_over
            FROM v_po_status WHERE status = 'APPROVED' AND pending_qty > 0.0005 AND overdue = 1${bc.sql}`, bc.p),
    many(`SELECT p.indent_id, p.doc_no, s.name AS site_name, p.needed_by,
                 DATEDIFF(CURDATE(), p.needed_by) AS days_over
            FROM v_indent_pipeline p JOIN sites s ON s.id = p.site_id
           WHERE p.status = 'APPROVED' AND p.to_order_qty > 0.0005
             AND p.needed_by IS NOT NULL AND p.needed_by < CURDATE()${branchClause(branchId, 'p.branch_id').sql}`,
    branchClause(branchId, 'p.branch_id').p),
  ]);

  const needs = [
    ...lateNeed.map((r) => ({ kind: 'Not yet ordered', ref: r.doc_no, title: r.site_name,
      detail: `wanted by ${String(r.needed_by).slice(0, 10)} and still not on an order`,
      severity: 'bad', late: late(r.days_over), to: '/procurement' })),
    ...lateDel.map((r) => ({ kind: 'Delivery overdue', ref: r.doc_no, title: r.supplier_name,
      detail: `to ${r.deliver_to_name}, expected ${String(r.expected_date).slice(0, 10)}`,
      severity: 'bad', late: late(r.days_over), to: `/purchase-orders/${r.po_id}` })),
    ...withGm.map((r) => ({ kind: 'Order with the GM', ref: r.doc_no, title: r.supplier_name,
      detail: `${plural(r.age, 'day')} waiting for approval`, severity: r.age > 2 ? 'warn' : '',
      late: Math.max(0, r.age - 2), to: `/purchase-orders/${r.po_id}`, amount: Number(r.po_value) })),
  ].sort(byUrgency);

  const bs = await buckets('month');
  const pc = branchClause(branchId, 'po.branch_id');
  const [placed] = await Promise.all([
    many(`SELECT ${MONTH_OF('po.po_date')} AS b, COALESCE(SUM(v.po_value), 0) AS n
            FROM purchase_orders po JOIN v_po_status v ON v.po_id = po.id
           WHERE po.status = 'APPROVED' AND po.po_date >= ${SINCE('month')}${pc.sql} GROUP BY b`, pc.p),
  ]);

  return {
    tiles: [
      { key: 'buy', label: 'indents to buy for', n: Number(toBuy.n), to: '/procurement' },
      { key: 'late', label: 'wanted and not ordered', n: lateNeed.length, tone: lateNeed.length ? 'bad' : '', to: '/procurement' },
      { key: 'gm', label: 'orders with the GM', n: withGm.length, to: '/purchase-orders' },
      { key: 'del', label: 'deliveries overdue', n: lateDel.length, tone: lateDel.length ? 'bad' : '', to: '/purchase-orders' },
    ],
    needs,
    trends: [{
      key: 'placed', title: 'Orders placed, month by month', sub: 'approved orders, value incl. GST',
      bucket: 'month', unit: 'money',
      lines: [{ key: 'placed', label: 'Ordered', tone: 'brand' }],
      series: series(['placed'], [placed], bs),
    }],
  };
}

/* ================================================================= Billing */
async function billing(branchId) {
  const bc = branchClause(branchId, 'l.branch_id');
  const [toBill, drafts, month] = await Promise.all([
    many(`SELECT l.site_id, s.name, s.code, SUM(l.to_bill_value) AS value, COUNT(*) AS line_count
            FROM v_billing_line l JOIN sites s ON s.id = l.site_id
           WHERE l.to_bill_value > 0.5${bc.sql}
           GROUP BY l.site_id ORDER BY value DESC`, bc.p),
    many(`SELECT b.id, b.doc_no, s.id AS site_id, s.name, DATEDIFF(CURDATE(), DATE(b.created_at)) AS age
            FROM bills b JOIN sites s ON s.id = b.site_id
           WHERE b.status = 'DRAFT'${branchClause(branchId, 'b.branch_id').sql}`, branchClause(branchId, 'b.branch_id').p),
    one(`SELECT COUNT(*) AS n, COALESCE(SUM(l.line_total), 0) AS v
           FROM bills b JOIN bill_lines l ON l.bill_id = b.id
          WHERE b.status = 'RAISED' AND b.bill_date >= DATE_FORMAT(CURDATE(), '%Y-%m-01')
            ${branchClause(branchId, 'b.branch_id').sql}`, branchClause(branchId, 'b.branch_id').p),
  ]);

  const needs = [
    ...drafts.map((r) => ({ kind: 'Bill left in draft', ref: r.doc_no, title: r.name,
      detail: `${plural(r.age, 'day')} old — a draft is not revenue`, severity: r.age > 3 ? 'warn' : '',
      late: Math.max(0, r.age - 3), to: `/billing/site/${r.site_id}` })),
    ...toBill.map((r) => ({ kind: 'Ready to bill', ref: r.code, title: r.name,
      detail: `${plural(r.line_count, 'line')} with work to bill`, severity: 'warn', late: 0,
      to: `/billing/site/${r.site_id}`, amount: Number(r.value) })),
  ].sort(byUrgency);

  const bs = await buckets('month');
  const bb = branchClause(branchId, 'b.branch_id');
  const billed = await many(
    `SELECT ${MONTH_OF('b.bill_date')} AS b, COALESCE(SUM(l.line_total), 0) AS n
       FROM bills b JOIN bill_lines l ON l.bill_id = b.id
      WHERE b.status = 'RAISED' AND b.bill_date >= ${SINCE('month')}${bb.sql} GROUP BY b`, bb.p);

  return {
    tiles: [
      { key: 'sites', label: 'sites with work to bill', n: toBill.length, tone: toBill.length ? 'warn' : '', to: '/billing' },
      { key: 'value', label: 'waiting to be billed', n: toBill.reduce((t, r) => t + Number(r.value), 0),
        money: true, to: '/billing' },
      { key: 'drafts', label: 'bills in draft', n: drafts.length, to: '/billing/bills' },
      { key: 'month', label: 'billed this month', n: Number(month.v), money: true, to: '/billing/bills' },
    ],
    needs,
    trends: [{
      key: 'billed', title: 'Billed, month by month', sub: 'raised RA bills only',
      bucket: 'month', unit: 'money',
      lines: [{ key: 'billed', label: 'Billed', tone: 'brand' }],
      series: series(['billed'], [billed], bs),
    }],
  };
}

/* ================================================================= Reports */
async function reports(branchId) {
  const cc = branchClause(branchId, 'c.branch_id');
  const bb = branchClause(branchId, 'b.branch_id');
  const [costMonth, revMonth, unbilled] = await Promise.all([
    one(`SELECT COALESCE(SUM(c.amount), 0) AS v FROM v_cost_event c
          WHERE c.event_date >= DATE_FORMAT(CURDATE(), '%Y-%m-01')${cc.sql}`, cc.p),
    one(`SELECT COALESCE(SUM(l.line_total), 0) AS v FROM bills b JOIN bill_lines l ON l.bill_id = b.id
          WHERE b.status = 'RAISED' AND b.bill_date >= DATE_FORMAT(CURDATE(), '%Y-%m-01')${bb.sql}`, bb.p),
    many(`SELECT s.id, s.code, s.name, SUM(c.amount) AS cost
            FROM v_cost_event c JOIN sites s ON s.id = c.site_id
            LEFT JOIN v_site_revenue r ON r.site_id = s.id
           WHERE r.site_id IS NULL${cc.sql}
           GROUP BY s.id HAVING cost > 0 ORDER BY cost DESC`, cc.p),
  ]);

  const needs = unbilled.map((r) => ({ kind: 'Spending, never billed', ref: r.code, title: r.name,
    detail: 'material and expenses booked, no RA bill raised yet', severity: 'warn', late: 0,
    to: `/billing/site/${r.id}`, amount: Number(r.cost) }));

  const bs = await buckets('month');
  const [cost, rev] = await Promise.all([
    many(`SELECT ${MONTH_OF('c.event_date')} AS b, COALESCE(SUM(c.amount), 0) AS n FROM v_cost_event c
           WHERE c.event_date >= ${SINCE('month')}${cc.sql} GROUP BY b`, cc.p),
    many(`SELECT ${MONTH_OF('b.bill_date')} AS b, COALESCE(SUM(l.line_total), 0) AS n
            FROM bills b JOIN bill_lines l ON l.bill_id = b.id
           WHERE b.status = 'RAISED' AND b.bill_date >= ${SINCE('month')}${bb.sql} GROUP BY b`, bb.p),
  ]);

  return {
    tiles: [
      { key: 'cost', label: 'cost this month', n: Number(costMonth.v), money: true, to: '/reports/expense' },
      { key: 'rev', label: 'billed this month', n: Number(revMonth.v), money: true, to: '/reports/pl' },
      { key: 'unbilled', label: 'sites spending, never billed', n: unbilled.length,
        tone: unbilled.length ? 'warn' : '', to: '/reports/pl' },
    ],
    needs,
    trends: [{
      key: 'pl', title: 'Cost against revenue, month by month', sub: 'booked cost, raised bills',
      bucket: 'month', unit: 'money',
      lines: [{ key: 'revenue', label: 'Billed', tone: 'brand' }, { key: 'cost', label: 'Cost', tone: 'navy' }],
      series: series(['revenue', 'cost'], [rev, cost], bs),
    }],
  };
}

/* ================================================================== router */
router.get('/:dept',
  validate(z.object({
    branchId: z.coerce.number().int().positive().optional(),
    siteId: z.coerce.number().int().positive().optional(),
    storeId: z.coerce.number().int().positive().optional(),
  }), 'query'),
  wrap(async (req, res) => {
    const { branchId, siteId, storeId } = req.query;
    const d = req.params.dept;
    let out;
    if (d === 'plan') out = await planning(branchId);
    else if (d === 'site') {
      if (!siteId) throw badRequest('Say which site');
      out = await site(siteId);
    } else if (d === 'store') {
      if (!storeId) throw badRequest('Say which store');
      out = await store(storeId);
    } else if (d === 'procure') out = await procure(branchId);
    else if (d === 'billing') out = await billing(branchId);
    else if (d === 'reports') out = await reports(branchId);
    else throw notFound('No desk for that department');
    res.json({ dept: d, ...out });
  })
);

module.exports = router;
