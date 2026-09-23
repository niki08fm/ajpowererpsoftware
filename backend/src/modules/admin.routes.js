'use strict';
const router = require('express').Router();
const { z } = require('zod');
const { many, one, run, tx } = require('../config/db');
const { validate, wrap } = require('../middleware/validate');
const { conflict, notFound, badRequest } = require('../lib/errors');
const { log } = require('../lib/audit');
const password = require('../lib/password');
const { ROLES, ALL_ROLES } = require('../lib/access');
const { plural } = require('../lib/words');

/**
 * Logins, and what each one can reach. Management only — lib/access.js
 * refuses everybody else before a request gets here.
 *
 * A login's role is its department. Which sites it reaches is not a
 * separate permission list; it is the site's own record — its GM, its
 * store keeper, its team — so "who runs this site" and "who can see
 * this site" can never disagree.
 */

const shapeUser = (u, places) => ({
  id: u.id, empCode: u.emp_code, name: u.name, email: u.email, phone: u.phone,
  department: u.department, isActive: !!u.is_active, lastLoginAt: u.last_login_at,
  hasPassword: !!u.password_hash,
  sites: places.filter((p) => Number(p.user_id) === Number(u.id))
    .map((p) => ({ siteId: p.site_id, code: p.code, name: p.name, as: p.as_what })),
});

const PLACES = `
  SELECT gm_user_id AS user_id, id AS site_id, code, name, 'GM' AS as_what
    FROM sites WHERE site_type = 'SITE' AND gm_user_id IS NOT NULL
  UNION ALL
  SELECT head_user_id, id, code, name, 'HEAD' FROM sites
   WHERE site_type = 'SITE' AND head_user_id IS NOT NULL
  UNION ALL
  SELECT keeper_user_id, id, code, name, 'KEEPER' FROM sites
   WHERE site_type = 'SITE' AND keeper_user_id IS NOT NULL
  UNION ALL
  SELECT st.user_id, s.id, s.code, s.name, 'TEAM' FROM site_team st
    JOIN sites s ON s.id = st.site_id`;

router.get('/users', wrap(async (_req, res) => {
  const users = await many(
    `SELECT id, emp_code, name, email, phone, department, is_active, last_login_at, password_hash
       FROM users ORDER BY is_active DESC, name`);
  const places = await many(`${PLACES} ORDER BY name`);
  res.json({ roles: ALL_ROLES, users: users.map((u) => shapeUser(u, places)) });
}));

const userFields = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().toLowerCase().email('That is not an email address').max(160),
  phone: z.string().trim().max(20).optional(),
  empCode: z.string().trim().max(24).optional(),
  department: z.enum(ALL_ROLES),
  password: z.string().min(8, 'A password needs at least 8 characters').max(200),
});

router.post('/users', validate(userFields), wrap(async (req, res) => {
  const b = req.body;
  if (await one(`SELECT id FROM users WHERE LOWER(email) = ?`, [b.email])) {
    throw conflict('Somebody already signs in with that email');
  }
  let code = b.empCode;
  if (!code) {
    const last = await one(
      `SELECT MAX(CAST(SUBSTRING(emp_code, 2) AS UNSIGNED)) AS n FROM users WHERE emp_code REGEXP '^E[0-9]+$'`);
    code = `E${String(Number(last?.n || 0) + 1).padStart(3, '0')}`;
  }
  const r = await run(
    `INSERT INTO users (emp_code, name, email, phone, department, password_hash)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [code, b.name, b.email, b.phone || null, b.department, await password.hash(b.password)]);
  await log(null, { entity: 'USER', entityId: r.insertId, docNo: code, action: 'Login created',
    detail: `${b.name} · ${b.department}`, user: req.user });
  res.status(201).json({ id: r.insertId, empCode: code });
}));

router.patch('/users/:id',
  validate(userFields.partial().extend({ isActive: z.boolean().optional() })),
  wrap(async (req, res) => {
    const b = req.body;
    const u = await one(`SELECT * FROM users WHERE id = ?`, [req.params.id]);
    if (!u) throw notFound('No such person');
    const self = Number(u.id) === Number(req.user.id);
    // the one mistake that cannot be undone from this screen
    if (self && (b.isActive === false || (b.department && b.department !== ROLES.MANAGEMENT))) {
      throw badRequest('You cannot take away your own Management login — ask another Management user');
    }
    if (b.email && await one(`SELECT id FROM users WHERE LOWER(email) = ? AND id <> ?`, [b.email, u.id])) {
      throw conflict('Somebody already signs in with that email');
    }
    await run(
      `UPDATE users SET name = COALESCE(?, name), email = COALESCE(?, email),
              phone = COALESCE(?, phone), department = COALESCE(?, department),
              is_active = COALESCE(?, is_active),
              password_hash = COALESCE(?, password_hash)
        WHERE id = ?`,
      [b.name ?? null, b.email ?? null, b.phone ?? null, b.department ?? null,
       b.isActive == null ? null : (b.isActive ? 1 : 0),
       b.password ? await password.hash(b.password) : null, u.id]);
    // a changed password or a switched-off login ends every session it had
    if (b.password || b.isActive === false) {
      await run(`DELETE FROM user_sessions WHERE user_id = ?`, [u.id]);
    }
    const what = [
      b.department && b.department !== u.department && `role ${u.department} → ${b.department}`,
      b.isActive === false && 'switched off', b.isActive === true && !u.is_active && 'switched on',
      b.password && 'password reset',
    ].filter(Boolean).join(', ');
    await log(null, { entity: 'USER', entityId: u.id, docNo: u.emp_code, action: 'Login edited',
      detail: what || u.name, user: req.user });
    res.json({ ok: true });
  })
);

/**
 * Which sites a login reaches.
 *
 *   General Manager  the projects they are GM of. A project cannot be
 *                    without one, so a project is taken off a GM by
 *                    giving it to another, not by unticking it here.
 *   Site             the sites they work on, and on which of those
 *                    they are the store keeper — the one person who
 *                    issues that site's material.
 *
 * Every other role sees every site and has nothing to set.
 */
router.put('/users/:id/sites',
  validate(z.object({
    sites: z.array(z.object({
      siteId: z.coerce.number().int().positive(),
      as: z.enum(['GM', 'TEAM', 'KEEPER']),
    })).max(200),
  })),
  wrap(async (req, res) => {
    const u = await one(`SELECT id, name, emp_code, department FROM users WHERE id = ?`, [req.params.id]);
    if (!u) throw notFound('No such person');
    const want = req.body.sites;

    await tx(async (conn) => {
      if (u.department === ROLES.GM) {
        const ids = want.filter((s) => s.as === 'GM').map((s) => s.siteId);
        const had = (await many(`SELECT id, name FROM sites WHERE gm_user_id = ?`, [u.id]));
        const dropped = had.filter((s) => !ids.includes(Number(s.id)));
        if (dropped.length) {
          throw badRequest(`${dropped.map((s) => s.name).join(', ')} would have no GM. `
            + 'Give the project to its new GM instead — that takes it off this one.');
        }
        if (ids.length) {
          await run(`UPDATE sites SET gm_user_id = ? WHERE site_type = 'SITE' AND id IN (?)`, [u.id, ids], conn);
        }
      } else if (u.department === ROLES.SITE) {
        const on = want.map((s) => s.siteId);
        const keeps = want.filter((s) => s.as === 'KEEPER').map((s) => s.siteId);
        await run(`DELETE FROM site_team WHERE user_id = ?`, [u.id], conn);
        for (const id of new Set(on)) {
          await run(`INSERT IGNORE INTO site_team (site_id, user_id) VALUES (?, ?)`, [id, u.id], conn);
        }
        // no longer the keeper where they were — the site has none until
        // somebody is named, which is better than the wrong person
        await run(
          `UPDATE sites SET keeper_user_id = NULL WHERE keeper_user_id = ? ${keeps.length ? 'AND id NOT IN (?)' : ''}`,
          keeps.length ? [u.id, keeps] : [u.id], conn);
        if (keeps.length) {
          await run(`UPDATE sites SET keeper_user_id = ? WHERE site_type = 'SITE' AND id IN (?)`, [u.id, keeps], conn);
        }
      } else {
        throw badRequest(`A ${u.department} login sees every site; there is nothing to choose`);
      }
      await log(conn, { entity: 'USER', entityId: u.id, docNo: u.emp_code, action: 'Sites changed',
        detail: `${plural(want.length, 'site')}`, user: req.user });
    });
    res.json({ ok: true });
  })
);

module.exports = router;
