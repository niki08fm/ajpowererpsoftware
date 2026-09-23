'use strict';
const router = require('express').Router();
const { z } = require('zod');
const { many, one } = require('../config/db');
const { validate, wrap } = require('../middleware/validate');
const { notFound } = require('../lib/errors');

/**
 * The spine, read end to end.
 *
 * Work order line -> BOQ lines -> indented -> used -> left. Four
 * numbers about one row, none of them stored anywhere.
 */
router.get('/site/:siteId', wrap(async (req, res) => {
  const site = await one(
    `SELECT s.id, s.code, s.name, s.status, c.name AS client_name,
            wo.id AS wo_id, wo.doc_no AS wo_doc_no, wo.client_wo_no,
            b.id AS boq_id, b.doc_no AS boq_doc_no, b.status AS boq_status,
            b.over_allow, b.over_pct,
            vb.state, vb.prepared_count, vb.wo_line_count, vb.over_line_count, vb.worst_over_pct,
            vp.boq_lines, vp.indented_qty,
            vw.wo_value
       FROM sites s
       LEFT JOIN clients c ON c.id = s.client_id
       LEFT JOIN work_orders wo ON wo.site_id = s.id
       LEFT JOIN v_work_order_value vw ON vw.work_order_id = wo.id
       LEFT JOIN boqs b ON b.site_id = s.id
       LEFT JOIN v_boq_status vb ON vb.boq_id = b.id
       LEFT JOIN v_site_progress vp ON vp.boq_id = b.id
      WHERE s.id = ?`, [req.params.siteId]
  );
  if (!site) throw notFound('No such site');

  const lines = site.boq_id
    ? await many(
      `SELECT sno, wo_sno, wo_description, item_code, item_name, uom, make_name,
              item_qty, boq_qty, est_qty, var_qty, effective_est,
              approved_qty, pending_qty, committed_qty, item_indented_qty, balance,
              over_qty, over_pct_actual
         FROM v_boq_line_status WHERE boq_id = ? ORDER BY sno`, [site.boq_id])
    : [];

  res.json({
    site: { id: site.id, code: site.code, name: site.name, status: site.status, client: site.client_name },
    workOrder: site.wo_id
      ? { id: site.wo_id, docNo: site.wo_doc_no, clientWoNo: site.client_wo_no, value: site.wo_value }
      : null,
    boq: site.boq_id
      ? {
        id: site.boq_id, docNo: site.boq_doc_no, status: site.boq_status, state: site.state,
        policy: { overAllow: !!site.over_allow, overPct: site.over_pct },
        prepared: site.prepared_count, ofLines: site.wo_line_count,
        overLines: site.over_line_count, worstOverPct: site.worst_over_pct,
      }
      : null,
    totals: {
      boqLines: site.boq_lines || 0,
      indented: site.indented_qty || 0,

    },
    lines,
  });
}));

/** The desk: everything that needs someone's attention, in one call. */
router.get('/desk',
  validate(z.object({ branchId: z.coerce.number().int().positive().optional() }), 'query'),
  wrap(async (req, res) => {
    const bId = req.query.branchId;
    const w = bId ? 'AND s.branch_id = ?' : '';
    const p = bId ? [bId] : [];

    const amendmentDue = await many(
      `SELECT b.id AS boq_id, b.doc_no, s.id AS site_id, s.name AS site_name,
              v.over_line_count, v.worst_over_pct
         FROM boqs b JOIN sites s ON s.id = b.site_id
         JOIN v_boq_status v ON v.boq_id = b.id
        WHERE v.state = 'AMENDMENT_DUE' ${w}
        ORDER BY v.worst_over_pct DESC`, p);

    const awaitingBoq = await many(
      `SELECT wo.id AS work_order_id, wo.doc_no, s.id AS site_id, s.name AS site_name
         FROM work_orders wo JOIN sites s ON s.id = wo.site_id
         LEFT JOIN boqs b ON b.work_order_id = wo.id
        WHERE b.id IS NULL ${w} ORDER BY s.name`, p);

    const boqDrafts = await many(
      `SELECT b.id AS boq_id, b.doc_no, s.id AS site_id, s.name AS site_name,
              v.prepared_count, v.wo_line_count
         FROM boqs b JOIN sites s ON s.id = b.site_id
         JOIN v_boq_status v ON v.boq_id = b.id
        WHERE b.status = 'DRAFT' ${w} ORDER BY s.name`, p);

    const submitted = await many(
      `SELECT i.id, i.doc_no, s.id AS site_id, s.name AS site_name, i.indent_date,
              (SELECT COUNT(*) FROM indent_lines il WHERE il.indent_id = i.id AND il.over_qty > 0) AS over_lines
         FROM indents i JOIN sites s ON s.id = i.site_id
        WHERE i.status = 'SUBMITTED' ${w} ORDER BY i.created_at`, p);

    // claims nobody has decided. Not a cost until somebody does, so
    // they belong on a desk rather than in a report.
    const expenses = await one(
      `SELECT COUNT(*) AS n, COALESCE(SUM(claimed_amount), 0) AS amount,
              COALESCE(MAX(days_waiting), 0) AS oldest
         FROM v_site_expense WHERE (? IS NULL OR branch_id = ?) AND status = 'SUBMITTED'`,
      [bId || null, bId || null]);

    // what has come back to a site to be changed — the only PRNs and
    // claims that need the site's own hands, so the only ones its menu
    // counts. What is waiting on an approver is counted in Approvals.
    const indentsSentBack = await many(
      `SELECT i.id, i.doc_no, s.id AS site_id
         FROM indents i JOIN sites s ON s.id = i.site_id
        WHERE i.status = 'RETURNED' ${w} ORDER BY i.created_at`, p);
    const expensesSentBack = await many(
      `SELECT expense_id AS id, doc_no, site_id FROM v_site_expense
        WHERE (? IS NULL OR branch_id = ?) AND status = 'RETURNED'`,
      [bId || null, bId || null]);

    res.json({
      amendmentDue, awaitingBoq, boqDrafts, indentsWaiting: submitted,
      expensesWaiting: Number(expenses.n),
      expensesWaitingValue: Number(expenses.amount),
      expensesOldestDays: Number(expenses.oldest),
      indentsSentBack, expensesSentBack,
    });
  })
);

module.exports = router;
