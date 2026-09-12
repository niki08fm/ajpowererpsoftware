'use strict';
const router = require('express').Router();
const { z } = require('zod');
const { many, one, run, tx } = require('../config/db');
const { validate, wrap } = require('../middleware/validate');
const { normKey, sortKey } = require('../lib/normKey');
const { nextSiteCode } = require('../lib/docNo');
const { log } = require('../lib/audit');
const { conflict, notFound, badRequest } = require('../lib/errors');

/**
 * Sites and stores are two different things and get two endpoints.
 *
 *   A SITE  is a project: client, head, storekeeper, team, dates,
 *           a work order and a BOQ.
 *   A STORE is a branch warehouse: none of that.
 *
 * They were one screen in the old system and every column was half
 * empty, which is why they are split here at the schema.
 */

const SELECT = `
  SELECT s.id, s.code, s.name, s.site_type, s.status, s.location, s.billing_address,
         s.start_date, s.target_completion, s.created_at,
         b.id AS branch_id, b.code AS branch_code, b.name AS branch_name,
         c.id AS client_id, c.name AS client_name,
         hu.id AS head_id, hu.name AS head_name,
         ku.id AS keeper_id, ku.name AS keeper_name,
         gu.id AS gm_id, gu.name AS gm_name,
         wo.id AS wo_id, wo.doc_no AS wo_doc_no, wo.client_wo_no,
         wv.wo_value, wv.line_count AS wo_line_count,
         bq.id AS boq_id, bq.doc_no AS boq_doc_no,
         vb.state AS boq_state, vb.prepared_count, vb.wo_line_count AS boq_wo_lines,
         vb.over_line_count, vb.worst_over_pct,
         (SELECT COUNT(*) FROM site_team st WHERE st.site_id = s.id) AS team_count
    FROM sites s
    JOIN branches b ON b.id = s.branch_id
    LEFT JOIN clients c ON c.id = s.client_id
    LEFT JOIN users hu  ON hu.id = s.head_user_id
    LEFT JOIN users ku  ON ku.id = s.keeper_user_id
    LEFT JOIN users gu  ON gu.id = s.gm_user_id
    LEFT JOIN work_orders wo ON wo.site_id = s.id
    LEFT JOIN v_work_order_value wv ON wv.work_order_id = wo.id
    LEFT JOIN boqs bq ON bq.site_id = s.id
    LEFT JOIN v_boq_status vb ON vb.boq_id = bq.id`;

const shape = (r) => ({
  id: r.id, code: r.code, name: r.name, type: r.site_type, status: r.status,
  location: r.location, billingAddress: r.billing_address,
  startDate: r.start_date, targetCompletion: r.target_completion,
  branch: { id: r.branch_id, code: r.branch_code, name: r.branch_name },
  client: r.client_id ? { id: r.client_id, name: r.client_name } : null,
  head: r.head_id ? { id: r.head_id, name: r.head_name } : null,
  keeper: r.keeper_id ? { id: r.keeper_id, name: r.keeper_name } : null,
  gm: r.gm_id ? { id: r.gm_id, name: r.gm_name } : null,
  teamCount: r.team_count,
  workOrder: r.wo_id
    ? { id: r.wo_id, docNo: r.wo_doc_no, clientWoNo: r.client_wo_no, value: r.wo_value, lineCount: r.wo_line_count }
    : null,
  boq: r.boq_id
    ? { id: r.boq_id, docNo: r.boq_doc_no, state: r.boq_state,
        prepared: r.prepared_count, ofLines: r.boq_wo_lines,
        overLines: r.over_line_count, worstOverPct: r.worst_over_pct }
    : null,
});

/* ------------------------------------------------------------ sites */
router.get('/',
  validate(z.object({
    branchId: z.coerce.number().int().positive().optional(),
    includeClosed: z.coerce.boolean().default(false),
  }), 'query'),
  wrap(async (req, res) => {
    const where = [`s.site_type = 'SITE'`];
    const params = [];
    if (req.query.branchId) { where.push('s.branch_id = ?'); params.push(req.query.branchId); }
    if (!req.query.includeClosed) where.push(`s.status <> 'CLOSED'`);
    const rows = await many(`${SELECT} WHERE ${where.join(' AND ')} ORDER BY s.name`, params);
    res.json(rows.map(shape));
  })
);

router.get('/:id', wrap(async (req, res) => {
  const r = await one(`${SELECT} WHERE s.id = ?`, [req.params.id]);
  if (!r) throw notFound('No such site');
  const team = await many(
    `SELECT u.id, u.name, u.department FROM site_team st
       JOIN users u ON u.id = st.user_id WHERE st.site_id = ? ORDER BY u.name`,
    [req.params.id]
  );
  res.json({ ...shape(r), team });
}));

const siteFields = z.object({
  name: z.string().trim().min(3).max(180),
  branchId: z.coerce.number().int().positive(),
  clientId: z.coerce.number().int().positive(),
  headUserId: z.coerce.number().int().positive(),
  keeperUserId: z.coerce.number().int().positive(),
  gmUserId: z.coerce.number().int().positive(),
  location: z.string().trim().max(300).optional(),
  billingAddress: z.string().trim().max(500).optional(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  targetCompletion: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  team: z.array(z.coerce.number().int().positive()).max(30).default([]),
});
// .refine returns an effects wrapper with no .partial(), so keep the plain
// object around for PATCH and add the rule on top of it for POST
const datesMakeSense = (v) =>
  !v.startDate || !v.targetCompletion || v.targetCompletion >= v.startDate;
const DATE_MSG = { message: 'Completion cannot be before the start date', path: ['targetCompletion'] };
const siteBody = siteFields.refine(datesMakeSense, DATE_MSG);
const sitePatch = siteFields.partial().refine(datesMakeSense, DATE_MSG);

router.post('/', validate(siteBody), wrap(async (req, res) => {
  const b = req.body;
  const key = normKey(b.name);
  const clash = await one(`SELECT id, code, name FROM sites WHERE norm_key = ?`, [key]);
  if (clash) throw conflict(`Already on the list as ${clash.code} — ${clash.name}`, { siteId: clash.id });

  const client = await one(`SELECT id FROM clients WHERE id = ? AND branch_id = ?`, [b.clientId, b.branchId]);
  if (!client) throw badRequest('That client is not in that branch');

  const out = await tx(async (conn) => {
    const code = await nextSiteCode(conn, 'SITE');
    const r = await run(
      `INSERT INTO sites (code, name, norm_key, sort_key, site_type, branch_id, client_id,
                          head_user_id, keeper_user_id, gm_user_id, location, billing_address,
                          start_date, target_completion, created_by)
       VALUES (?, ?, ?, ?, 'SITE', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [code, b.name, key, sortKey(b.name), b.branchId, b.clientId, b.headUserId, b.keeperUserId,
       b.gmUserId, b.location || null, b.billingAddress || null, b.startDate || null,
       b.targetCompletion || null, req.user?.id || null], conn
    );
    for (const uid of new Set(b.team)) {
      if (uid === b.headUserId || uid === b.keeperUserId || uid === b.gmUserId) continue;
      await run(`INSERT IGNORE INTO site_team (site_id, user_id) VALUES (?, ?)`, [r.insertId, uid], conn);
    }
    await log(conn, { entity: 'SITE', entityId: r.insertId, docNo: code, action: 'Created', detail: b.name, user: req.user });
    return { id: r.insertId, code };
  });
  res.status(201).json({ ...out, name: b.name });
}));

router.patch('/:id', validate(sitePatch), wrap(async (req, res) => {
  const b = req.body;
  const site = await one(`SELECT * FROM sites WHERE id = ? AND site_type = 'SITE'`, [req.params.id]);
  if (!site) throw notFound('No such site');
  if (b.name) {
    const clash = await one(`SELECT id, code FROM sites WHERE norm_key = ? AND id <> ?`, [normKey(b.name), site.id]);
    if (clash) throw conflict(`Already on the list as ${clash.code}`);
  }
  await tx(async (conn) => {
    await run(
      `UPDATE sites SET name = COALESCE(?, name), norm_key = COALESCE(?, norm_key), sort_key = COALESCE(?, sort_key),
              client_id = COALESCE(?, client_id), head_user_id = COALESCE(?, head_user_id),
              keeper_user_id = COALESCE(?, keeper_user_id), gm_user_id = COALESCE(?, gm_user_id),
              location = COALESCE(?, location),
              billing_address = COALESCE(?, billing_address), start_date = COALESCE(?, start_date),
              target_completion = COALESCE(?, target_completion)
        WHERE id = ?`,
      [b.name ?? null, b.name ? normKey(b.name) : null, b.name ? sortKey(b.name) : null,
       b.clientId ?? null, b.headUserId ?? null, b.keeperUserId ?? null, b.gmUserId ?? null, b.location ?? null,
       b.billingAddress ?? null, b.startDate ?? null, b.targetCompletion ?? null, site.id], conn
    );
    if (b.team) {
      await run(`DELETE FROM site_team WHERE site_id = ?`, [site.id], conn);
      for (const uid of new Set(b.team)) {
        await run(`INSERT IGNORE INTO site_team (site_id, user_id) VALUES (?, ?)`, [site.id, uid], conn);
      }
    }
    await log(conn, { entity: 'SITE', entityId: site.id, docNo: site.code, action: 'Edited', detail: b.name || site.name, user: req.user });
  });
  res.json({ ok: true });
}));

/* ----------------------------------------------------------- stores */
router.get('/stores/list',
  validate(z.object({ branchId: z.coerce.number().int().positive().optional() }), 'query'),
  wrap(async (req, res) => {
    const rows = await many(
      `${SELECT} WHERE s.site_type = 'STORE' ${req.query.branchId ? 'AND s.branch_id = ?' : ''} ORDER BY s.name`,
      req.query.branchId ? [req.query.branchId] : []
    );
    res.json(rows.map(shape));
  })
);

router.post('/stores',
  validate(z.object({
    name: z.string().trim().min(3).max(180),
    branchId: z.coerce.number().int().positive(),
    keeperUserId: z.coerce.number().int().positive().optional(),
    location: z.string().trim().max(300).optional(),
  })),
  wrap(async (req, res) => {
    const b = req.body;
    const key = normKey(b.name);
    const clash = await one(`SELECT id, code, name FROM sites WHERE norm_key = ?`, [key]);
    if (clash) throw conflict(`Already on the list as ${clash.code} — ${clash.name}`);
    const out = await tx(async (conn) => {
      const code = await nextSiteCode(conn, 'STORE');
      const r = await run(
        `INSERT INTO sites (code, name, norm_key, sort_key, site_type, branch_id, keeper_user_id, location, created_by)
         VALUES (?, ?, ?, ?, 'STORE', ?, ?, ?, ?)`,
        [code, b.name, key, sortKey(b.name), b.branchId, b.keeperUserId || null, b.location || null,
         req.user?.id || null], conn
      );
      await log(conn, { entity: 'STORE', entityId: r.insertId, docNo: code, action: 'Created', detail: b.name, user: req.user });
      return { id: r.insertId, code };
    });
    res.status(201).json({ ...out, name: b.name });
  })
);

module.exports = router;
