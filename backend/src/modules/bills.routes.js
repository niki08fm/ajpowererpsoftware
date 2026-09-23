'use strict';
const router = require('express').Router();
const { z } = require('zod');
const { many, one, run, tx } = require('../config/db');
const { validate, wrap } = require('../middleware/validate');
const { nextDocNo } = require('../lib/docNo');
const { log } = require('../lib/audit');
const { conflict, notFound, badRequest } = require('../lib/errors');
const chain = require('../lib/approvals');

/**
 * Billing the client.
 *
 * This is the first document in the system that earns money. Every
 * other one spends, and the profit and loss screen has been refusing
 * to exist on the ground that a work order is an agreement rather
 * than income. A raised bill is what changes that.
 *
 * It is raised against WORK ORDER LINES. The client agreed to supply
 * and install a hundred socket points; they did not agree to buy
 * metal boxes. So the quantity billed is in their units, at their
 * rate, against their wording — and the BOQ, the indents and the
 * consumption sit underneath as evidence rather than as the thing
 * being billed.
 *
 * Bills run in sequence, RA 1, RA 2, RA 3, each billing what has been
 * done since the last. The running total is held here so nobody has
 * to keep it on paper, and nothing may be billed twice.
 *
 * What may be billed has one ceiling: what material has been
 * indented for. A line agreed at 100 with material in for 60 bills
 * to 60 — work nobody has asked for material for has not been done,
 * and invoicing it is how a running account bill gets thrown back.
 *
 * The agreed quantity is not a second ceiling. Indenting past the
 * estimate takes a BOQ that permits it, and permitting it is a
 * deliberate decision that more work is being done than was first
 * written down, so the billing follows the material. What it does
 * not do is happen quietly — a line running past the work order is
 * reported back and shown.
 */

const money = (n) => Math.round(Number(n) * 100) / 100;
const round3 = (n) => Math.round(Number(n) * 1000) / 1000;
const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const EDITABLE = ['DRAFT'];

async function requireBill(id, conn) {
  const b = await one(`SELECT * FROM bills WHERE id = ?`, [id], conn);
  if (!b) throw notFound('No such bill');
  return b;
}

/* ==================================================================
   Sites that can be billed at all
   ================================================================== */
router.get('/sites',
  validate(z.object({
    branchId: z.coerce.number().int().positive().optional(),
    clientId: z.coerce.number().int().positive().optional(),
    q: z.string().trim().optional(),
  }), 'query'),
  wrap(async (req, res) => {
    const where = [`s.site_type = 'SITE'`];
    const params = [];
    if (req.query.branchId) { where.push('s.branch_id = ?'); params.push(req.query.branchId); }
    if (req.query.clientId) { where.push('s.client_id = ?'); params.push(req.query.clientId); }
    if (req.query.q) {
      // a site is as often remembered by its client as by its own name
      where.push('(s.name LIKE ? OR c.name LIKE ?)');
      params.push(`%${req.query.q}%`, `%${req.query.q}%`);
    }

    const rows = await many(
      `SELECT s.id AS site_id, s.code, s.name, s.status,
              c.name AS client_name,
              wo.id AS work_order_id, wo.doc_no AS wo_no, wo.client_wo_no, wo.wo_date,
              COALESCE((SELECT SUM(v.contract_value) FROM v_billing_line v
                         WHERE v.work_order_id = wo.id), 0) AS contract_value,
              COALESCE(r.revenue, 0) AS billed_value,
              COALESCE(r.bills, 0)   AS bills,
              r.last_ra_no, r.last_billed_on,
              (SELECT COUNT(*) FROM bills d
                WHERE d.site_id = s.id AND d.status = 'DRAFT') AS drafts
         FROM sites s
         JOIN work_orders wo ON wo.site_id = s.id
         LEFT JOIN clients c ON c.id = s.client_id
         LEFT JOIN v_site_revenue r ON r.site_id = s.id
        WHERE ${where.join(' AND ')}
        ORDER BY s.name`, params);

    res.json({
      rows: rows.map((r) => ({
        ...r,
        to_bill_value: money(Number(r.contract_value) - Number(r.billed_value)),
        billed_pct: Number(r.contract_value) > 0
          ? Math.round((Number(r.billed_value) / Number(r.contract_value)) * 10000) / 100
          : 0,
      })),
      totals: {
        sites: rows.length,
        contractValue: money(rows.reduce((t, r) => t + Number(r.contract_value), 0)),
        billedValue: money(rows.reduce((t, r) => t + Number(r.billed_value), 0)),
        unbilled: rows.filter((r) => Number(r.bills) === 0).length,
      },
    });
  })
);

/* ==================================================================
   The sheet: one row per work order line
   ================================================================== */
router.get('/sheet/:siteId', wrap(async (req, res) => {
  const site = await one(
    `SELECT s.id, s.code, s.name, s.status, s.branch_id, s.client_id,
            c.name AS client_name, c.gstin AS client_gstin, s.billing_address
       FROM sites s LEFT JOIN clients c ON c.id = s.client_id
      WHERE s.id = ?`, [req.params.siteId]);
  if (!site) throw notFound('No such site');

  const wo = await one(
    `SELECT id, doc_no, client_wo_no, wo_date FROM work_orders WHERE site_id = ?`, [site.id]);
  if (!wo) {
    throw badRequest(
      `${site.name} has no work order, so there is nothing to bill against. `
      + 'A bill is raised on the client\'s own lines and rates.');
  }

  const lines = await many(
    `SELECT * FROM v_billing_line WHERE work_order_id = ? ORDER BY sno`, [wo.id]);

  const bills = await many(
    `SELECT bill_id, doc_no, ra_no, bill_date, status, line_count, bill_qty, bill_value,
            period_from, period_to, client_ref, raised_by_name, raised_at
       FROM v_bill_status WHERE site_id = ? ORDER BY ra_no DESC`, [site.id]);

  const draft = bills.find((b) => b.status === 'DRAFT') || null;
  // a draft's own quantities are already counted in billed_qty? No —
  // only raised bills are. So the sheet shows what the draft holds
  // separately, and the biller sees both.
  const draftLines = draft
    ? await many(`SELECT * FROM v_bill_line WHERE bill_id = ?`, [draft.bill_id])
    : [];
  const draftBy = Object.fromEntries(draftLines.map((l) => [l.wo_line_id, l]));

  const sum = (k) => money(lines.reduce((t, l) => t + Number(l[k]), 0));
  const contract = sum('contract_value');
  res.json({
    site,
    workOrder: wo,
    lines: lines.map((l) => ({ ...l, draft_qty: Number(draftBy[l.wo_line_id]?.qty || 0) })),
    bills,
    draft,
    nextRaNo: (bills.reduce((m, b) => Math.max(m, Number(b.ra_no)), 0) || 0) + 1,
    totals: {
      lines: lines.length,
      contractValue: contract,
      billedValue: sum('billed_value'),
      // billable and billed beyond what the client signed. Allowed,
      // and never left for them to discover.
      overContractValue: sum('over_contract_value'),
      // what can go on a bill today: provisioned, agreed, not yet billed
      toBillValue: sum('to_bill_value'),
      // and what cannot, because nobody has asked for the material.
      // Named rather than left as an unexplained gap in the total.
      unprovisionedValue: sum('unprovisioned_value'),
      billedPct: contract > 0 ? Math.round((sum('billed_value') / contract) * 10000) / 100 : 0,
    },
  });
}));

/* ==================================================================
   Raising one
   ================================================================== */
const billBody = z.object({
  siteId: z.coerce.number().int().positive(),
  billDate: DATE,
  periodFrom: DATE.optional(),
  periodTo: DATE.optional(),
  clientRef: z.string().trim().max(64).optional(),
  note: z.string().trim().max(400).optional(),
  lines: z.array(z.object({
    woLineId: z.coerce.number().int().positive(),
    qty: z.coerce.number().positive(),
    remark: z.string().trim().max(300).optional(),
  })).min(1, 'Nothing to bill').max(500),
  raise: z.coerce.boolean().default(false),
});

/**
 * Check a basket of quantities against what is left to bill.
 *
 * `exceptBillId` lets a draft be re-checked without its own previous
 * quantities counting against it — otherwise editing a draft to the
 * same numbers would fail.
 */
async function checkLines(conn, workOrderId, lines, exceptBillId = null) {
  const out = [];
  for (const l of lines) {
    const v = await one(
      `SELECT * FROM v_billing_line WHERE wo_line_id = ? AND work_order_id = ?`,
      [l.woLineId, workOrderId], conn);
    if (!v) throw badRequest('One of those lines is not on this work order');

    const already = Number(v.billed_qty);
    const agreed = Number(v.boq_qty);
    const indented = Number(v.indented_qty);
    const room = round3(Number(v.to_bill_qty));

    if (Number(l.qty) > room + 0.0005) {
      throw conflict(
        indented <= 0
          ? `Line ${v.sno} — ${v.description}: no material has been requested on a PRN for this `
            + 'line, so there is nothing to bill. The site raises a PRN first.'
          : `Line ${v.sno} — ${v.description}: ${round3(indented)} ${v.uom} has been `
            + `requested on PRNs and ${round3(already)} is already billed, so `
            + `${Math.max(room, 0)} can be billed. The rest needs a PRN before it can be billed.`,
        {
          woLineId: l.woLineId,
          agreed,
          indented,
          billed: already,
          left: room,
          limitedBy: 'INDENTED',
        }
      );
    }

    // Running past the work order is allowed — indenting beyond the
    // estimate takes a BOQ that permits it, and that is a decision
    // that more work is being done. It is reported back so the screen
    // can say so rather than letting it go by unnoticed.
    const overBy = round3(already + Number(l.qty) - agreed);
    out.push({ ...l, line: v, overContract: overBy > 0.0005 ? overBy : 0 });
  }
  return out;
}

/** The running account number for a site, taken under the site's lock. */
async function nextRaNo(conn, siteId) {
  const r = await one(
    `SELECT COALESCE(MAX(ra_no), 0) AS n FROM bills WHERE site_id = ? FOR UPDATE`,
    [siteId], conn);
  return Number(r.n) + 1;
}

router.post('/', validate(billBody), wrap(async (req, res) => {
  const b = req.body;
  const site = await one(`SELECT * FROM sites WHERE id = ?`, [b.siteId]);
  if (!site) throw notFound('No such site');
  const wo = await one(`SELECT * FROM work_orders WHERE site_id = ?`, [site.id]);
  if (!wo) throw badRequest(`${site.name} has no work order to bill against`);

  const seen = new Set();
  for (const l of b.lines) {
    if (seen.has(l.woLineId)) throw badRequest('The same line is on this bill twice');
    seen.add(l.woLineId);
  }

  const out = await tx(async (conn) => {
    const open = await one(
      `SELECT doc_no FROM bills WHERE site_id = ? AND status = 'DRAFT' LIMIT 1`,
      [site.id], conn);
    if (open) {
      throw conflict(
        `${site.name} already has ${open.doc_no} open as a draft. `
        + 'Finish or delete that one before starting another.');
    }

    const checked = await checkLines(conn, wo.id, b.lines);
    const raNo = await nextRaNo(conn, site.id);
    const docNo = await nextDocNo(conn, 'RA', b.billDate);

    const bill = await run(
      `INSERT INTO bills
         (doc_no, ra_no, site_id, branch_id, work_order_id, client_id, bill_date,
          period_from, period_to, status, client_ref, note, created_by, raised_by, raised_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [docNo, raNo, site.id, site.branch_id, wo.id, site.client_id, b.billDate,
       // "raise" now means "send it to be signed": a bill is the
       // company asking a client for money, and two people say so
       b.periodFrom || null, b.periodTo || null, b.raise ? 'SUBMITTED' : 'DRAFT',
       b.clientRef || null, b.note || null, req.user?.id || null,
       null, null], conn);

    for (const c of checked) {
      await run(
        `INSERT INTO bill_lines (bill_id, wo_line_id, qty, supply_rate, inst_rate, remark)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [bill.insertId, c.woLineId, c.qty, c.line.supply_rate, c.line.inst_rate,
         c.remark || null], conn);
    }

    if (b.raise) {
      await chain.open(conn, { docType: 'BILL', docId: bill.insertId, docNo,
        branchId: site.branch_id, siteId: site.id, userId: req.user?.id });
    }

    const v = await one(`SELECT * FROM v_bill_status WHERE bill_id = ?`, [bill.insertId], conn);
    await log(conn, {
      entity: 'RA', entityId: bill.insertId, docNo,
      action: b.raise ? 'Sent for approval' : 'Drafted',
      detail: `${site.name} · RA ${raNo} · ₹${money(v.bill_value)}`,
      user: req.user,
    });
    return { id: bill.insertId, docNo, raNo, value: money(v.bill_value) };
  });

  res.status(201).json(out);
}));

router.put('/:id', validate(billBody.partial().omit({ siteId: true, raise: true })),
  wrap(async (req, res) => {
    const bill = await requireBill(req.params.id);
    if (!EDITABLE.includes(bill.status)) {
      throw conflict(bill.status === 'RAISED'
        ? 'This bill has been raised — it is with the client and cannot be changed'
        : bill.status === 'SUBMITTED'
          ? 'This bill is with its approvers — it can be changed only after it is sent back'
          : 'This bill is cancelled');
    }
    const b = req.body;
    await tx(async (conn) => {
      await run(
        `UPDATE bills SET bill_date = COALESCE(?, bill_date),
                          period_from = ?, period_to = ?, client_ref = ?, note = ?
          WHERE id = ?`,
        [b.billDate ?? null, b.periodFrom ?? bill.period_from, b.periodTo ?? bill.period_to,
         b.clientRef ?? bill.client_ref, b.note ?? bill.note, bill.id], conn);

      if (b.lines) {
        const checked = await checkLines(conn, bill.work_order_id, b.lines, bill.id);
        await run(`DELETE FROM bill_lines WHERE bill_id = ?`, [bill.id], conn);
        for (const c of checked) {
          await run(
            `INSERT INTO bill_lines (bill_id, wo_line_id, qty, supply_rate, inst_rate, remark)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [bill.id, c.woLineId, c.qty, c.line.supply_rate, c.line.inst_rate,
             c.remark || null], conn);
        }
      }
    });
    const v = await one(`SELECT * FROM v_bill_status WHERE bill_id = ?`, [bill.id]);
    res.json({ ok: true, value: Number(v.bill_value), qty: Number(v.bill_qty) });
  })
);

/**
 * Send it to be signed.
 *
 * This used to be the moment a bill became revenue. It is now the
 * moment it goes for signature — the site's GM, then Management — and
 * the second signature is what raises it. The route keeps its name
 * because it is still the same button: "this bill is finished".
 */
router.post('/:id/raise', wrap(async (req, res) => {
  const bill = await requireBill(req.params.id);
  if (bill.status === 'RAISED') throw conflict('This bill has already been raised');
  if (bill.status === 'SUBMITTED') throw conflict('This bill is already waiting for approval');
  if (bill.status === 'CANCELLED') throw conflict('This bill is cancelled');

  await tx(async (conn) => {
    const lines = await many(
      `SELECT wo_line_id, qty FROM bill_lines WHERE bill_id = ?`, [bill.id], conn);
    if (!lines.length) throw badRequest('There is nothing on this bill');
    await checkLines(conn, bill.work_order_id,
      lines.map((l) => ({ woLineId: l.wo_line_id, qty: Number(l.qty) })), bill.id);

    await run(`UPDATE bills SET status = 'SUBMITTED' WHERE id = ?`, [bill.id], conn);
    await chain.open(conn, { docType: 'BILL', docId: bill.id, docNo: bill.doc_no,
      branchId: bill.branch_id, siteId: bill.site_id, userId: req.user?.id });
    await log(conn, { entity: 'RA', entityId: bill.id, docNo: bill.doc_no,
      action: 'Sent for approval', detail: `RA ${bill.ra_no}`, user: req.user });
  });

  const v = await one(`SELECT * FROM v_bill_status WHERE bill_id = ?`, [bill.id]);
  res.json({
    ok: true, status: 'SUBMITTED', value: Number(v.bill_value),
    message: `${bill.doc_no} is with the site GM; it goes to the client once Management approves too`,
  });
}));

/**
 * Sign, or send back.
 *
 * The quantities are checked again on the last signature, not on the
 * first. Between the two, another bill may have been raised against
 * the same work order lines, and the figure that matters is the one
 * true at the moment the bill becomes the client's.
 */
router.post('/:id/decide',
  validate(z.object({
    action: z.enum(['APPROVED', 'RETURNED']),
    note: z.string().trim().max(500).optional(),
  })),
  wrap(async (req, res) => {
    const bill = await requireBill(req.params.id);
    if (bill.status !== 'SUBMITTED') {
      throw conflict(`This bill is ${bill.status.toLowerCase()}, not waiting for approval`);
    }
    if (req.body.action === 'RETURNED' && (req.body.note || '').trim().length < 5) {
      throw badRequest('Say why it is going back');
    }
    let step;
    await tx(async (conn) => {
      step = await chain.decide(conn, { docType: 'BILL', docId: bill.id,
        action: req.body.action, userId: req.user?.id, note: req.body.note });
      if (req.body.action === 'RETURNED') {
        await run(`UPDATE bills SET status = 'DRAFT' WHERE id = ?`, [bill.id], conn);
      } else if (step.done) {
        const lines = await many(
          `SELECT wo_line_id, qty FROM bill_lines WHERE bill_id = ?`, [bill.id], conn);
        await checkLines(conn, bill.work_order_id,
          lines.map((l) => ({ woLineId: l.wo_line_id, qty: Number(l.qty) })), bill.id);
        await run(
          `UPDATE bills SET status = 'RAISED', raised_at = NOW(), raised_by = ? WHERE id = ?`,
          [req.user?.id || null, bill.id], conn);
      }
      await log(conn, { entity: 'RA', entityId: bill.id, docNo: bill.doc_no,
        action: req.body.action === 'RETURNED' ? 'Returned to draft'
          : step.done ? 'Raised' : 'Signed by the GM',
        detail: `RA ${bill.ra_no}${req.body.note ? ` · ${req.body.note}` : ''}`, user: req.user });
    });
    const v = await one(`SELECT * FROM v_bill_status WHERE bill_id = ?`, [bill.id]);
    res.json({
      ok: true,
      status: req.body.action === 'RETURNED' ? 'DRAFT' : step.done ? 'RAISED' : 'SUBMITTED',
      level: step.level, levels: step.levels, done: step.done,
      value: Number(v.bill_value),
      message: req.body.action === 'RETURNED'
        ? `${bill.doc_no} is back in draft with billing`
        : step.done
          ? `${bill.doc_no} is raised — it is the client's now`
          : `${bill.doc_no} is approved at level 1 (GM) and is now with Management`,
    });
  })
);

/**
 * Cancelling one.
 *
 * A raised bill is with the client, so it is cancelled rather than
 * deleted — the number stays used and the trail stays readable. What
 * it billed stops counting, which frees those quantities to be billed
 * again on a later RA.
 */
router.post('/:id/cancel',
  validate(z.object({ note: z.string().trim().min(3, 'Say why').max(400) })),
  wrap(async (req, res) => {
    const bill = await requireBill(req.params.id);
    if (bill.status === 'CANCELLED') throw conflict('Already cancelled');
    const later = await one(
      `SELECT doc_no FROM bills WHERE site_id = ? AND ra_no > ? AND status = 'RAISED'
        ORDER BY ra_no LIMIT 1`, [bill.site_id, bill.ra_no]);
    if (later) {
      throw conflict(
        `${later.doc_no} was raised after this one. Cancel that first — `
        + 'running account bills come off in the order they went on.');
    }
    await tx(async (conn) => {
      await run(`UPDATE bills SET status = 'CANCELLED', note = ? WHERE id = ?`,
        [req.body.note, bill.id], conn);
      await log(conn, { entity: 'RA', entityId: bill.id, docNo: bill.doc_no,
        action: 'Cancelled', detail: req.body.note, user: req.user });
    });
    res.json({ ok: true, status: 'CANCELLED' });
  })
);

router.delete('/:id', wrap(async (req, res) => {
  const bill = await requireBill(req.params.id);
  if (bill.status !== 'DRAFT') {
    throw conflict('Only a draft can be deleted. A raised bill is cancelled, not removed.');
  }
  await tx(async (conn) => {
    await run(`DELETE FROM bills WHERE id = ?`, [bill.id], conn);
    await log(conn, { entity: 'RA', entityId: bill.id, docNo: bill.doc_no,
      action: 'Draft deleted', user: req.user });
  });
  res.json({ ok: true });
}));

/* ==================================================================
   Reading
   ================================================================== */
router.get('/',
  validate(z.object({
    branchId: z.coerce.number().int().positive().optional(),
    siteId: z.coerce.number().int().positive().optional(),
    clientId: z.coerce.number().int().positive().optional(),
    status: z.enum(['DRAFT', 'RAISED', 'CANCELLED', 'ALL']).default('ALL'),
    from: DATE.optional(),
    to: DATE.optional(),
    q: z.string().trim().optional(),
    limit: z.coerce.number().int().min(1).max(500).default(200),
  }), 'query'),
  wrap(async (req, res) => {
    const q = req.query;
    const where = [];
    const params = [];
    if (q.siteId) { where.push('v.site_id = ?'); params.push(q.siteId); }
    else if (q.branchId) { where.push('v.branch_id = ?'); params.push(q.branchId); }
    if (q.clientId) { where.push('v.client_id = ?'); params.push(q.clientId); }
    if (q.status !== 'ALL') { where.push('v.status = ?'); params.push(q.status); }
    if (q.from) { where.push('v.bill_date >= ?'); params.push(q.from); }
    if (q.to) { where.push('v.bill_date <= ?'); params.push(q.to); }
    if (q.q) {
      // whoever is looking for a bill knows one of four things about
      // it: its number, the site, the client, or the reference the
      // client put on their certificate. Any of them should find it.
      where.push(`(v.doc_no LIKE ? OR v.site_name LIKE ? OR v.client_name LIKE ?
                   OR v.client_ref LIKE ?)`);
      const like = `%${q.q}%`;
      params.push(like, like, like, like);
    }
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const rows = await many(
      `SELECT * FROM v_bill_status v ${clause}
        ORDER BY v.bill_date DESC, v.bill_id DESC LIMIT ${q.limit}`, params);

    const raised = rows.filter((r) => r.status === 'RAISED');
    res.json({
      rows,
      totals: {
        bills: rows.length,
        raised: raised.length,
        drafts: rows.filter((r) => r.status === 'DRAFT').length,
        value: money(raised.reduce((t, r) => t + Number(r.bill_value), 0)),
      },
    });
  })
);

router.get('/:id', wrap(async (req, res) => {
  const head = await one(`SELECT * FROM v_bill_status WHERE bill_id = ?`, [req.params.id]);
  if (!head) throw notFound('No such bill');
  const lines = await many(
    `SELECT * FROM v_bill_line WHERE bill_id = ? ORDER BY sno`, [head.bill_id]);
  res.json({
    head,
    lines: lines.map((l) => ({
      ...l,
      // an RA bill reads: up to the last one, this one, and to date
      to_date_qty: round3(Number(l.previous_qty) + Number(l.qty)),
    })),
    canEdit: EDITABLE.includes(head.status),
    canRaise: head.status === 'DRAFT',
    canCancel: head.status === 'RAISED',
    // whose desk it is on and at which level, with names
    approval: await chain.trail('BILL', head.bill_id, req.user?.id),
  });
}));

module.exports = router;
