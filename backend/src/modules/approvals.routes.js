'use strict';
const router = require('express').Router();
const { z } = require('zod');
const { many, one, run, tx } = require('../config/db');
const { validate, wrap } = require('../middleware/validate');
const { notFound, conflict, badRequest } = require('../lib/errors');
const { log } = require('../lib/audit');
const chain = require('../lib/approvals');

// "1 line", "3 lines": the count is cheap, so SQL simply asks for it twice
const linesOf = (count) => `${count}, IF(${count} = 1, ' line', ' lines')`;

/**
 * Everything waiting on somebody's decision, in one place.
 *
 * The engine itself is lib/approvals.js, and the documents still own
 * their own decisions — /indents/:id/decide, /boq/:id/decide,
 * /comparisons/:id/decide-approval, /purchase-orders/:id/decide,
 * /bills/:id/decide, /expenses/:id/decide, /transfers/:id/decide. This
 * module answers three questions across all of them: what is waiting
 * on me, what have I decided, and — through /decide below — lets one
 * screen act on any of them without knowing which module owns what.
 *
 * Five documents run the two-level chain from the process sheet. The
 * site's GM signs first and Management signs second, and the same
 * person may not do both:
 *
 *   BOQ              GM of the site, then Management — then it locks
 *   PRN              GM of the site, then Management
 *   rate comparison  Management twice (it belongs to a branch, not a
 *                    site, so there is no GM of it) — then a PO may
 *                    be raised off it
 *   purchase order   GM of the delivery site, then Management
 *   bill             GM of the site, then Management — then it is
 *                    raised to the client
 *
 * Two are single-signature and stay that way. An expense claim is the
 * site's own money and the GM decides it; a transfer request is one
 * site asking another for stock, and only the site being asked can
 * say yes.
 *
 * With no login yet, "me" is whoever the top bar says you are working
 * as. That makes the routing strict about what is SHOWN; it cannot stop
 * somebody switching who they are. Real enforcement arrives with login.
 *
 * Lateness is time spent waiting with the approver — from the moment
 * the document landed on their desk, not from the day it was drafted.
 */

// One row shape for every type, so the inbox can sort them together.
// Each runs on its own, so every column is named in every query.
//
// The five chained documents are read FROM the chain: it is the chain
// that knows which level is waiting and since when, and reading the
// document's status instead would show a PRN the GM has already signed
// as though nobody had touched it.
const CHAINED = {
  BOQ: `
    SELECT 'BOQ' AS type, b.id, b.doc_no, b.site_id, s.name AS site_name, s.code AS site_code,
           b.branch_id, br.name AS branch_name, ru.name AS raised_by_name,
           DATE(b.submitted_at) AS raised_on, NULL AS needed_by,
           ac.waiting_since, v.contract_value AS amount,
           CONCAT(wo.doc_no, ' · ',
                  ${linesOf('(SELECT COUNT(*) FROM boq_lines bl WHERE bl.boq_id = b.id)')},
                  IF(b.over_allow, CONCAT(' · beyond estimate ',
                     IF(b.over_pct > 0, CONCAT(b.over_pct, '% allowed'), 'allowed, no ceiling')),
                     '')) AS summary,
           IF(b.over_allow, 1, 0) AS flags,
           s.gm_user_id AS approver_id, ac.level, ac.levels, ac.level1_by
      FROM approval_chains ac
      JOIN boqs b       ON b.id = ac.doc_id
      JOIN sites s      ON s.id = b.site_id
      JOIN branches br  ON br.id = b.branch_id
      JOIN work_orders wo ON wo.id = b.work_order_id
      LEFT JOIN users ru  ON ru.id = b.created_by
      LEFT JOIN (SELECT work_order_id, SUM(line_total) AS contract_value
                   FROM work_order_lines GROUP BY work_order_id) v
             ON v.work_order_id = b.work_order_id
     WHERE ac.doc_type = 'BOQ' AND ac.status = 'PENDING'`,

  PRN: `
    SELECT 'PRN' AS type, i.id, i.doc_no, i.site_id, s.name AS site_name, s.code AS site_code,
           i.branch_id, br.name AS branch_name, ru.name AS raised_by_name,
           i.indent_date AS raised_on, i.needed_by,
           ac.waiting_since, NULL AS amount,
           CONCAT(${linesOf('(SELECT COUNT(*) FROM indent_lines il WHERE il.indent_id = i.id)')},
                  IF(i.kind = 'REPLACEMENT', ' · replacing lent stock', '')) AS summary,
           (SELECT COUNT(*) FROM indent_lines il WHERE il.indent_id = i.id AND il.over_qty > 0)
             AS flags,
           s.gm_user_id AS approver_id, ac.level, ac.levels, ac.level1_by
      FROM approval_chains ac
      JOIN indents i   ON i.id = ac.doc_id
      JOIN sites s     ON s.id = i.site_id
      JOIN branches br ON br.id = i.branch_id
      LEFT JOIN users ru ON ru.id = i.raised_by
     WHERE ac.doc_type = 'PRN' AND ac.status = 'PENDING'`,

  COMPARISON: `
    SELECT 'COMPARISON' AS type, c.id, c.doc_no, NULL AS site_id,
           NULL AS site_name, NULL AS site_code,
           c.branch_id, br.name AS branch_name, ru.name AS raised_by_name,
           DATE(c.created_at) AS raised_on, NULL AS needed_by,
           ac.waiting_since, q.landed AS amount,
           CONCAT(COALESCE(sp.name, 'a supplier'), ' chosen',
                  IF(c.decided_note IS NULL, '', CONCAT(' · ', c.decided_note))) AS summary,
           0 AS flags,
           NULL AS approver_id, ac.level, ac.levels, ac.level1_by
      FROM approval_chains ac
      JOIN comparisons c ON c.id = ac.doc_id
      JOIN branches br   ON br.id = c.branch_id
      LEFT JOIN suppliers sp ON sp.id = c.chosen_supplier_id
      LEFT JOIN users ru     ON ru.id = c.created_by
      LEFT JOIN v_comparison_supplier q
             ON q.comparison_id = c.id AND q.supplier_id = c.chosen_supplier_id
     WHERE ac.doc_type = 'COMPARISON' AND ac.status = 'PENDING'`,

  PO: `
    SELECT 'PO' AS type, po.id, po.doc_no, po.deliver_to_id AS site_id,
           d.name AS site_name, d.code AS site_code,
           po.branch_id, br.name AS branch_name, ru.name AS raised_by_name,
           po.po_date AS raised_on, po.expected_date AS needed_by,
           ac.waiting_since, v.po_value AS amount,
           CONCAT(sp.name, ' · ', ${linesOf('v.line_count')}) AS summary,
           0 AS flags,
           d.gm_user_id AS approver_id, ac.level, ac.levels, ac.level1_by
      FROM approval_chains ac
      JOIN purchase_orders po ON po.id = ac.doc_id
      JOIN v_po_status v ON v.po_id = po.id
      JOIN sites d       ON d.id = po.deliver_to_id
      JOIN branches br   ON br.id = po.branch_id
      JOIN suppliers sp  ON sp.id = po.supplier_id
      LEFT JOIN users ru ON ru.id = po.created_by
     WHERE ac.doc_type = 'PO' AND ac.status = 'PENDING'`,

  BILL: `
    SELECT 'BILL' AS type, b.id, b.doc_no, b.site_id, s.name AS site_name, s.code AS site_code,
           b.branch_id, br.name AS branch_name, ru.name AS raised_by_name,
           b.bill_date AS raised_on, NULL AS needed_by,
           ac.waiting_since, v.bill_value AS amount,
           CONCAT('RA ', b.ra_no, ' · ', COALESCE(cl.name, 'the client'),
                  IF(b.period_to IS NULL, '', CONCAT(' · to ', DATE_FORMAT(b.period_to, '%d/%m/%y')))
                 ) AS summary,
           0 AS flags,
           s.gm_user_id AS approver_id, ac.level, ac.levels, ac.level1_by
      FROM approval_chains ac
      JOIN bills b     ON b.id = ac.doc_id
      JOIN sites s     ON s.id = b.site_id
      JOIN branches br ON br.id = b.branch_id
      JOIN v_bill_status v ON v.bill_id = b.id
      LEFT JOIN clients cl ON cl.id = b.client_id
      LEFT JOIN users ru   ON ru.id = b.created_by
     WHERE ac.doc_type = 'BILL' AND ac.status = 'PENDING'`,
};

// The two that are decided once, by one person, and are not part of
// the Management chain.
const SINGLE = {
  EXPENSE: `
    SELECT 'EXPENSE' AS type, e.id, e.doc_no, e.site_id, s.name AS site_name, s.code AS site_code,
           e.branch_id, br.name AS branch_name, ru.name AS raised_by_name,
           e.spent_on AS raised_on, NULL AS needed_by,
           COALESCE(e.submitted_at, e.updated_at) AS waiting_since,
           e.claimed_amount AS amount,
           CONCAT(COALESCE(c.name, 'Expense'), ' · ', LEFT(e.description, 60)) AS summary,
           0 AS flags,
           s.gm_user_id AS approver_id, 1 AS level, 1 AS levels, NULL AS level1_by
      FROM site_expenses e
      JOIN sites s     ON s.id = e.site_id
      JOIN branches br ON br.id = e.branch_id
      LEFT JOIN users ru ON ru.id = e.raised_by
      LEFT JOIN expense_categories c ON c.id = e.category_id
     WHERE e.status = 'SUBMITTED'`,

  TRANSFER: `
    SELECT 'TRANSFER' AS type, r.id, r.doc_no, r.from_site_id AS site_id,
           f.name AS site_name, f.code AS site_code,
           r.branch_id, br.name AS branch_name, ru.name AS raised_by_name,
           r.request_date AS raised_on, r.needed_by,
           r.created_at AS waiting_since,
           NULL AS amount,
           CONCAT('Send to ', t.name, ' · against ', i.doc_no) AS summary,
           0 AS flags,
           f.head_user_id AS approver_id, 1 AS level, 1 AS levels, NULL AS level1_by
      FROM transfer_requests r
      JOIN sites f     ON f.id = r.from_site_id
      JOIN sites t     ON t.id = r.to_site_id
      JOIN indents i   ON i.id = r.indent_id
      JOIN branches br ON br.id = r.branch_id
      LEFT JOIN users ru ON ru.id = r.raised_by
     WHERE r.status = 'SUBMITTED'`,
};

const QUERIES = { ...CHAINED, ...SINGLE };

/**
 * Is this row routed to this person, at the level it is waiting at?
 *
 * The same rules as the chain itself, and deliberately the same words:
 * level 1 of a site document is its GM and nobody else; every other
 * level is Management, minus anyone who has already signed this
 * document once.
 */
function mine(row, me) {
  if (!me) return false;
  const level = Number(row.level || 1);
  const firstIsGm = chain.TYPES[row.type] ? chain.TYPES[row.type].firstLevel === 'GM' : true;

  // level 1 of a site document is its GM — unless there is no GM
  // behind it (a central store has none), in which case it falls
  // through to Management exactly as the chain itself does
  if (level === 1 && firstIsGm && row.approver_id) {
    return Number(row.approver_id) === Number(me.id);
  }
  // a Management level: anyone in Management who has not signed it yet
  if (me.department !== 'Management') return false;
  return Number(row.level1_by || 0) !== Number(me.id);
}

const shape = (r) => {
  // measured by the database, on the same clock that stamped it; doing
  // the subtraction in Node puts the server's timezone offset into it
  const days = Math.max(0, Math.floor(Number(r.hours_waiting || 0) / 24));
  const level = Number(r.level || 1);
  const levels = Number(r.levels || 1);
  return {
    type: r.type, id: r.id, docNo: r.doc_no,
    site: { id: r.site_id, name: r.site_name, code: r.site_code },
    branch: { id: r.branch_id, name: r.branch_name },
    raisedBy: r.raised_by_name, raisedOn: r.raised_on, neededBy: r.needed_by,
    waitingSince: r.waiting_since, daysWaiting: days,
    amount: r.amount === null ? null : Number(r.amount),
    summary: r.summary, flags: Number(r.flags || 0),
    // where in the chain it is, so the inbox can say "second signature"
    // rather than leaving somebody to wonder who else has seen it
    level,
    levels,
    stage: levels < 2 ? null
      : level === 1 ? 'Level 1 of 2' : 'Level 2 of 2',
    signedFirstBy: r.level1_by ? Number(r.level1_by) : null,
  };
};

async function pending(me, type) {
  const types = type ? [type] : Object.keys(QUERIES);
  const rows = [];
  for (const t of types) {
    rows.push(...await many(
      `SELECT q.*, TIMESTAMPDIFF(HOUR, q.waiting_since, NOW()) AS hours_waiting
         FROM (${QUERIES[t]}) q`));
  }
  return rows.filter((r) => mine(r, me))
    .map(shape)
    // oldest on the desk first: that is the one somebody is chasing
    .sort((a, b) => b.daysWaiting - a.daysWaiting
      || String(a.waitingSince).localeCompare(String(b.waitingSince)));
}

router.get('/',
  validate(z.object({
    type: z.enum(['PRN', 'EXPENSE', 'PO', 'TRANSFER']).optional(),
  }), 'query'),
  wrap(async (req, res) => {
    const me = req.user ? await one(`SELECT id, name, department FROM users WHERE id = ?`, [req.user.id]) : null;
    const rows = await pending(me, req.query.type);
    const byType = {};
    for (const r of rows) byType[r.type] = (byType[r.type] || 0) + 1;
    res.json({
      me,
      rows,
      totals: {
        waiting: rows.length,
        byType,
        overTwoDays: rows.filter((r) => r.daysWaiting > 2).length,
        oldestDays: rows.reduce((m, r) => Math.max(m, r.daysWaiting), 0),
        value: rows.reduce((t, r) => t + (r.amount || 0), 0),
      },
    });
  })
);

/** The rail badge: just the count, cheaply. */
router.get('/count', wrap(async (req, res) => {
  const me = req.user ? await one(`SELECT id, name, department FROM users WHERE id = ?`, [req.user.id]) : null;
  res.json({ waiting: (await pending(me)).length });
}));

/**
 * What I have decided.
 *
 * The five chained documents are read from the chain's own log, which
 * is the only place that knows a first signature from a second one.
 * The two unchained ones are read from their own event tables, as
 * before. Either way it is read back from what was written at the
 * moment of the decision, so this screen can never drift from the
 * document it is describing.
 */
router.get('/decided',
  validate(z.object({ days: z.coerce.number().int().min(1).max(365).default(60) }), 'query'),
  wrap(async (req, res) => {
    if (!req.user) return res.json({ rows: [] });
    const me = req.user.id;
    const days = req.query.days;

    const chained = await many(
      `SELECT ac.doc_type AS type, ac.doc_id AS id, ac.doc_no,
              COALESCE(s.name, br.name) AS site_name,
              e.action, e.note, e.level, ac.levels, e.created_at,
              NULL AS amount
         FROM approval_chain_events e
         JOIN approval_chains ac ON ac.id = e.chain_id
         LEFT JOIN sites s    ON s.id = ac.site_id
         JOIN branches br     ON br.id = ac.branch_id
        WHERE e.user_id = ? AND e.action IN ('APPROVED','RETURNED')
          AND e.created_at >= NOW() - INTERVAL ? DAY`, [me, days]);

    const single = await many(
      `SELECT * FROM (
         SELECT 'EXPENSE' AS type, x.id, x.doc_no, s.name AS site_name, e.action, e.note,
                1 AS level, 1 AS levels, e.amount, e.created_at
           FROM site_expense_events e JOIN site_expenses x ON x.id = e.expense_id
           JOIN sites s ON s.id = x.site_id
          WHERE e.user_id = ? AND e.action IN ('APPROVED','REJECTED','RETURNED','PARTIAL')
            AND e.created_at >= NOW() - INTERVAL ? DAY
         UNION ALL
         SELECT 'TRANSFER', r.id, r.doc_no, f.name, e.action, e.note,
                1, 1, NULL, e.created_at
           FROM tr_events e JOIN transfer_requests r ON r.id = e.tr_id
           JOIN sites f ON f.id = r.from_site_id
          WHERE e.user_id = ? AND e.action IN ('ACCEPTED','REJECTED')
            AND e.created_at >= NOW() - INTERVAL ? DAY
       ) x`, [me, days, me, days]);

    const rows = [...chained, ...single]
      .sort((x, y) => String(y.created_at).localeCompare(String(x.created_at)))
      .slice(0, 200);

    res.json({
      rows: rows.map((r) => ({
        type: r.type, id: r.id, docNo: r.doc_no, site: r.site_name,
        action: r.action, note: r.note,
        // which of the two it was, so "I approved that" and "I approved
        // that, and somebody else has to as well" do not read alike
        level: Number(r.level), levels: Number(r.levels),
        stage: Number(r.levels) < 2 ? null
          : Number(r.level) === 1 ? 'Level 1 of 2' : 'Level 2 of 2',
        amount: r.amount === null || r.amount === undefined ? null : Number(r.amount),
        at: r.created_at,
      })),
    });
  })
);

module.exports = router;
