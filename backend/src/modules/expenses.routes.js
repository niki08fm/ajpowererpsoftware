'use strict';
const router = require('express').Router();
const { z } = require('zod');
const { many, one, run, tx } = require('../config/db');
const { validate, wrap } = require('../middleware/validate');
const { nextDocNo } = require('../lib/docNo');
const { normKey } = require('../lib/normKey');
const { log } = require('../lib/audit');
const { conflict, notFound, badRequest } = require('../lib/errors');

/**
 * Money a site spends that never touches a shelf.
 *
 * A quantity of cable can be checked against a shelf. A claim for
 * ₹4,000 of transport can only be checked by somebody who knows
 * whether that lorry ran — so an expense is claimed at site and
 * decided elsewhere, and until it is decided it is not a cost.
 *
 * Partial approval is the normal case. ₹4,000 asked and ₹3,200
 * allowed is one document carrying both numbers, not a rejection
 * followed by a fresh claim. The approved figure is the only one that
 * ever reaches a report; the claimed figure stays so that anybody can
 * ask later how much of what sites asked for was granted.
 *
 * There is no permission check here, because there are none anywhere
 * in this system yet. Who may approve is a decision nobody has taken,
 * and guessing at it now would mean building screens around rules
 * that change. What the document records is who decided, which is the
 * part that has to be true whenever the rules do arrive.
 */

const money = (n) => Math.round(Number(n) * 100) / 100;
const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const EDITABLE = ['DRAFT', 'RETURNED'];

async function requireExpense(id, conn) {
  const e = await one(`SELECT * FROM site_expenses WHERE id = ?`, [id], conn);
  if (!e) throw notFound('No such expense');
  return e;
}

/* ==================================================================
   Categories. A list that grows without a migration.
   ================================================================== */
router.get('/categories', wrap(async (_req, res) => {
  res.json(await many(
    `SELECT c.id, c.name, c.kind, c.sort_no,
            (SELECT COUNT(*) FROM site_expenses e WHERE e.category_id = c.id) AS used
       FROM expense_categories c WHERE c.is_active = 1
      ORDER BY c.kind DESC, c.sort_no, c.name`));
}));

router.post('/categories',
  validate(z.object({ name: z.string().trim().min(2).max(80) })),
  wrap(async (req, res) => {
    const key = normKey(req.body.name);
    const dup = await one(`SELECT id, name FROM expense_categories WHERE norm_key = ?`, [key]);
    if (dup) throw conflict(`Already on the list as "${dup.name}"`, { id: dup.id });
    const r = await run(
      `INSERT INTO expense_categories (name, norm_key, sort_no) VALUES (?, ?, 500)`,
      [req.body.name, key]);
    res.status(201).json({ id: r.insertId, name: req.body.name });
  })
);

/* ==================================================================
   Claiming
   ================================================================== */
const expenseBody = z.object({
  siteId: z.coerce.number().int().positive(),
  categoryId: z.coerce.number().int().positive(),
  spentOn: DATE,
  description: z.string().trim().min(3, 'Say what it was for').max(400),
  paidTo: z.string().trim().max(160).optional(),
  billNo: z.string().trim().max(64).optional(),
  amount: z.coerce.number().positive('An amount is needed'),
  note: z.string().trim().max(400).optional(),
  send: z.coerce.boolean().default(false),
});

router.post('/', validate(expenseBody), wrap(async (req, res) => {
  const b = req.body;
  const site = await one(
    `SELECT id, name, branch_id FROM sites WHERE id = ?`, [b.siteId]);
  if (!site) throw notFound('No such site');

  const out = await tx(async (conn) => {
    const docNo = await nextDocNo(conn, 'EXP', b.spentOn);
    const r = await run(
      `INSERT INTO site_expenses
         (doc_no, site_id, branch_id, category_id, spent_on, description, paid_to,
          bill_no, claimed_amount, status, note, raised_by, submitted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [docNo, site.id, site.branch_id, b.categoryId, b.spentOn, b.description,
       b.paidTo || null, b.billNo || null, b.amount, b.send ? 'SUBMITTED' : 'DRAFT',
       b.note || null, req.user?.id || null, b.send ? new Date() : null], conn);

    if (b.send) {
      await run(
        `INSERT INTO site_expense_events (expense_id, action, amount, user_id)
         VALUES (?, 'SUBMITTED', ?, ?)`,
        [r.insertId, b.amount, req.user?.id || null], conn);
    }
    await log(conn, {
      entity: 'EXP', entityId: r.insertId, docNo,
      action: b.send ? 'Claimed and sent' : 'Drafted',
      detail: `${site.name} · ₹${money(b.amount)} · ${b.description}`,
      user: req.user,
    });
    return { id: r.insertId, docNo, status: b.send ? 'SUBMITTED' : 'DRAFT' };
  });
  res.status(201).json(out);
}));

router.put('/:id', validate(expenseBody.partial().omit({ siteId: true, send: true })),
  wrap(async (req, res) => {
    const e = await requireExpense(req.params.id);
    if (!EDITABLE.includes(e.status)) {
      throw conflict(e.status === 'SUBMITTED'
        ? 'This claim is waiting to be decided — pull it back first'
        : `This claim is ${e.status.toLowerCase()} and cannot be changed`);
    }
    const b = req.body;
    await tx(async (conn) => {
      await run(
        `UPDATE site_expenses SET
           category_id = COALESCE(?, category_id),
           spent_on = COALESCE(?, spent_on),
           description = COALESCE(?, description),
           paid_to = ?, bill_no = ?,
           claimed_amount = COALESCE(?, claimed_amount),
           note = ?
         WHERE id = ?`,
        [b.categoryId ?? null, b.spentOn ?? null, b.description ?? null,
         b.paidTo ?? e.paid_to, b.billNo ?? e.bill_no, b.amount ?? null,
         b.note ?? e.note, e.id], conn);
      await run(
        `INSERT INTO site_expense_events (expense_id, action, amount, user_id)
         VALUES (?, 'EDITED', ?, ?)`,
        [e.id, b.amount ?? e.claimed_amount, req.user?.id || null], conn);
    });
    res.json({ ok: true });
  })
);

router.post('/:id/submit', wrap(async (req, res) => {
  const e = await requireExpense(req.params.id);
  if (!EDITABLE.includes(e.status)) {
    throw conflict(`This claim is already ${e.status.toLowerCase()}`);
  }
  await tx(async (conn) => {
    await run(
      `UPDATE site_expenses SET status = 'SUBMITTED', submitted_at = NOW() WHERE id = ?`,
      [e.id], conn);
    await run(
      `INSERT INTO site_expense_events (expense_id, action, amount, user_id)
       VALUES (?, 'SUBMITTED', ?, ?)`,
      [e.id, e.claimed_amount, req.user?.id || null], conn);
    await log(conn, { entity: 'EXP', entityId: e.id, docNo: e.doc_no,
      action: 'Sent for approval', detail: `₹${money(e.claimed_amount)}`, user: req.user });
  });
  res.json({ ok: true, status: 'SUBMITTED' });
}));

/** Pulling a claim back out of the queue before anyone has decided. */
router.post('/:id/withdraw', wrap(async (req, res) => {
  const e = await requireExpense(req.params.id);
  if (e.status !== 'SUBMITTED') throw conflict('Only a claim waiting to be decided can be pulled back');
  await tx(async (conn) => {
    await run(`UPDATE site_expenses SET status = 'DRAFT', submitted_at = NULL WHERE id = ?`,
      [e.id], conn);
    await run(
      `INSERT INTO site_expense_events (expense_id, action, user_id) VALUES (?, 'WITHDRAWN', ?)`,
      [e.id, req.user?.id || null], conn);
  });
  res.json({ ok: true, status: 'DRAFT' });
}));

/* ==================================================================
   Deciding
   ================================================================== */
router.post('/:id/decide',
  validate(z.object({
    action: z.enum(['APPROVED', 'REJECTED', 'RETURNED']),
    // what is actually allowed. Left out on an approval, the whole
    // claim is allowed; given, it is a partial approval.
    amount: z.coerce.number().min(0).optional(),
    note: z.string().trim().max(400).optional(),
  })),
  wrap(async (req, res) => {
    const e = await requireExpense(req.params.id);
    if (e.status !== 'SUBMITTED') {
      throw conflict(e.status === 'DRAFT'
        ? 'This claim has not been sent for approval yet'
        : `This claim is already ${e.status.toLowerCase()}`);
    }

    const claimed = Number(e.claimed_amount);
    let approved = null;

    if (req.body.action === 'APPROVED') {
      approved = req.body.amount == null ? claimed : money(req.body.amount);
      if (approved > claimed + 0.004) {
        throw badRequest(
          `The site asked for ₹${money(claimed)}, so ₹${money(approved)} cannot be `
          + 'approved. Cutting a claim down is an approval; adding to it is a new claim.',
          { claimed });
      }
      if (approved <= 0) {
        throw badRequest('Approving nothing is a rejection — say so, and give a reason');
      }
    }

    // a claim that is cut, sent back or refused needs a reason. The
    // site is going to ask, and "the system does not say" is not an
    // answer anyone can work with.
    const cut = req.body.action === 'APPROVED' && approved < claimed - 0.004;
    if ((req.body.action !== 'APPROVED' || cut) && !req.body.note) {
      throw badRequest(
        req.body.action === 'REJECTED' ? 'Say why it is refused'
          : cut ? 'Say why it is cut down'
            : 'Say what the site has to fix'
      );
    }

    const status = req.body.action === 'RETURNED' ? 'RETURNED' : req.body.action;
    await tx(async (conn) => {
      await run(
        `UPDATE site_expenses
            SET status = ?, approved_amount = ?, decided_by = ?, decided_at = NOW(),
                decision_note = ?
          WHERE id = ?`,
        [status,
         req.body.action === 'APPROVED' ? approved
           : req.body.action === 'REJECTED' ? 0 : null,
         req.user?.id || null, req.body.note || null, e.id], conn);
      await run(
        `INSERT INTO site_expense_events (expense_id, action, amount, user_id, note)
         VALUES (?, ?, ?, ?, ?)`,
        [e.id, req.body.action, approved, req.user?.id || null, req.body.note || null], conn);
      await log(conn, {
        entity: 'EXP', entityId: e.id, docNo: e.doc_no,
        action: cut ? 'Part approved' : req.body.action === 'APPROVED' ? 'Approved'
          : req.body.action === 'REJECTED' ? 'Refused' : 'Sent back',
        detail: cut ? `₹${money(claimed)} claimed, ₹${money(approved)} allowed`
          : `₹${money(claimed)}`,
        user: req.user,
      });
    });

    const v = await one(`SELECT * FROM v_site_expense WHERE expense_id = ?`, [e.id]);
    res.json({
      ok: true,
      status: v.status,
      outcome: v.outcome,
      claimed: Number(v.claimed_amount),
      approved: v.approved_amount == null ? null : Number(v.approved_amount),
      cost: Number(v.cost_amount),
      disallowed: Number(v.disallowed_amount),
    });
  })
);

/* ==================================================================
   Reading
   ================================================================== */
router.get('/',
  validate(z.object({
    branchId: z.coerce.number().int().positive().optional(),
    siteId: z.coerce.number().int().positive().optional(),
    categoryId: z.coerce.number().int().positive().optional(),
    status: z.enum(['DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'RETURNED',
      'WAITING', 'MINE', 'ALL']).default('ALL'),
    from: DATE.optional(),
    to: DATE.optional(),
    q: z.string().trim().optional(),
    sort: z.enum(['recent', 'oldest', 'largest', 'waiting']).default('recent'),
    limit: z.coerce.number().int().min(1).max(500).default(200),
  }), 'query'),
  wrap(async (req, res) => {
    const q = req.query;
    const where = [];
    const params = [];
    if (q.siteId) { where.push('v.site_id = ?'); params.push(q.siteId); }
    else if (q.branchId) { where.push('v.branch_id = ?'); params.push(q.branchId); }
    if (q.categoryId) { where.push('v.category_id = ?'); params.push(q.categoryId); }
    if (q.from) { where.push('v.spent_on >= ?'); params.push(q.from); }
    if (q.to) { where.push('v.spent_on <= ?'); params.push(q.to); }
    if (q.q) {
      where.push('(v.doc_no LIKE ? OR v.description LIKE ? OR v.paid_to LIKE ? OR v.bill_no LIKE ?)');
      const like = `%${q.q}%`;
      params.push(like, like, like, like);
    }
    if (q.status === 'WAITING') where.push(`v.status = 'SUBMITTED'`);
    else if (q.status === 'MINE') {
      where.push(`v.status IN ('DRAFT','RETURNED')`);
    } else if (q.status !== 'ALL') { where.push('v.status = ?'); params.push(q.status); }

    const order = {
      recent: 'v.spent_on DESC, v.expense_id DESC',
      oldest: 'v.spent_on ASC, v.expense_id ASC',
      largest: 'v.claimed_amount DESC',
      waiting: 'v.days_waiting DESC, v.spent_on',
    }[q.sort];

    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const rows = await many(
      `SELECT * FROM v_site_expense v ${clause} ORDER BY ${order} LIMIT ${q.limit}`, params);

    const sums = await one(
      `SELECT COUNT(*) AS claims,
              COALESCE(SUM(v.claimed_amount), 0) AS claimed,
              COALESCE(SUM(v.cost_amount), 0)    AS approved,
              COALESCE(SUM(v.disallowed_amount), 0) AS disallowed,
              COALESCE(SUM(CASE WHEN v.status = 'SUBMITTED' THEN v.claimed_amount END), 0)
                AS waiting,
              COALESCE(SUM(v.status = 'SUBMITTED'), 0) AS waiting_count
         FROM v_site_expense v ${clause}`, params);

    res.json({
      rows,
      totals: {
        claims: Number(sums.claims),
        claimed: money(sums.claimed),
        approved: money(sums.approved),
        disallowed: money(sums.disallowed),
        waiting: money(sums.waiting),
        waitingCount: Number(sums.waiting_count),
      },
    });
  })
);

router.get('/:id', wrap(async (req, res) => {
  const head = await one(`SELECT * FROM v_site_expense WHERE expense_id = ?`, [req.params.id]);
  if (!head) throw notFound('No such expense');
  const events = await many(
    `SELECT ev.id, ev.action, ev.amount, ev.note, ev.created_at, u.name AS by_name
       FROM site_expense_events ev LEFT JOIN users u ON u.id = ev.user_id
      WHERE ev.expense_id = ? ORDER BY ev.id`, [head.expense_id]);
  res.json({
    head,
    events,
    canEdit: EDITABLE.includes(head.status),
    canDecide: head.status === 'SUBMITTED',
    canWithdraw: head.status === 'SUBMITTED',
  });
}));

module.exports = router;
