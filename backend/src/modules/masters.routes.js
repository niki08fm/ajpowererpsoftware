'use strict';
const router = require('express').Router();
const { z } = require('zod');
const { many, one, tx, run } = require('../config/db');
const { validate, wrap } = require('../middleware/validate');
const { normKey, sortKey } = require('../lib/normKey');
const { log } = require('../lib/audit');
const { conflict, notFound, badRequest } = require('../lib/errors');
const { plural } = require('../lib/words');

router.get('/branches', wrap(async (_req, res) =>
  res.json(await many(`SELECT id, code, name, gstin, address FROM branches ORDER BY name`))));

router.get('/uoms', wrap(async (_req, res) =>
  res.json(await many(`SELECT id, code, name FROM uoms ORDER BY code`))));

router.get('/categories', wrap(async (_req, res) =>
  res.json(await many(
    `SELECT c.id, c.code, c.name, COUNT(i.id) AS item_count
       FROM item_categories c LEFT JOIN items i ON i.category_id = c.id
      GROUP BY c.id ORDER BY c.name`))));

router.get('/makes', wrap(async (_req, res) =>
  res.json(await many(`SELECT id, name FROM makes ORDER BY name`))));

/** People, for the head / storekeeper / team pickers. */
router.get('/users',
  validate(z.object({ department: z.string().trim().max(40).optional() }), 'query'),
  wrap(async (req, res) => res.json(await many(
    `SELECT id, emp_code, name, email, department FROM users
      WHERE is_active = 1 ${req.query.department ? 'AND department = ?' : ''} ORDER BY name`,
    req.query.department ? [req.query.department] : []
  ))));

/**
 * The client list.
 *
 * Filtered to a branch wherever a site is being created, because a site
 * may only belong to a client of its own branch — sites.routes refuses
 * the pairing otherwise. Left unfiltered on the Clients screen, which
 * is the one place the whole list has to be visible, including the
 * client somebody filed under the wrong branch and then could not find.
 */
router.get('/clients',
  validate(z.object({ branchId: z.coerce.number().int().positive().optional() }), 'query'),
  wrap(async (req, res) => res.json(await many(
    `SELECT c.id, c.branch_id, b.name AS branch_name, c.name, c.gstin, c.address,
            c.contact_name, c.contact_phone,
            COUNT(s.id) AS site_count,
            COALESCE(SUM(s.status = 'ACTIVE'), 0) AS active_site_count
       FROM clients c
       JOIN branches b ON b.id = c.branch_id
       LEFT JOIN sites s ON s.client_id = c.id AND s.site_type = 'SITE'
      ${req.query.branchId ? 'WHERE c.branch_id = ?' : ''}
      GROUP BY c.id ORDER BY c.name`,
    req.query.branchId ? [req.query.branchId] : []
  ))));

/**
 * Editing one.
 *
 * The branch may be changed only while the client has no sites. A site
 * carries its own branch_id and the two must agree; moving a client out
 * from under a live site would leave a pairing the system refuses to
 * create in the first place.
 */
router.patch('/clients/:id',
  validate(z.object({
    name: z.string().trim().min(2).max(180).optional(),
    branchId: z.coerce.number().int().positive().optional(),
    gstin: z.string().trim().length(15).optional().or(z.literal('')),
    address: z.string().trim().max(400).optional().or(z.literal('')),
    contactName: z.string().trim().max(120).optional().or(z.literal('')),
    contactPhone: z.string().trim().max(20).optional().or(z.literal('')),
  })),
  wrap(async (req, res) => {
    const b = req.body;
    const client = await one(`SELECT * FROM clients WHERE id = ?`, [req.params.id]);
    if (!client) throw notFound('No such client');

    if (b.name) {
      const clash = await one(
        `SELECT id, name FROM clients WHERE norm_key = ? AND id <> ?`,
        [normKey(b.name), client.id]);
      if (clash) throw conflict(`Already on the list as "${clash.name}"`, { clientId: clash.id });
    }

    if (b.branchId && b.branchId !== client.branch_id) {
      const used = await one(
        `SELECT COUNT(*) AS n FROM sites WHERE client_id = ?`, [client.id]);
      if (Number(used.n) > 0) {
        throw conflict(
          `${client.name} already has ${plural(used.n, 'site')}, so its branch cannot be changed — `
          + 'a site and its client must be in the same branch.',
          { clientId: client.id, sites: Number(used.n) }
        );
      }
      const br = await one(`SELECT id FROM branches WHERE id = ?`, [b.branchId]);
      if (!br) throw badRequest('No such branch');
    }

    await tx(async (conn) => {
      await run(
        `UPDATE clients SET
           name = COALESCE(?, name), norm_key = COALESCE(?, norm_key), sort_key = COALESCE(?, sort_key),
           branch_id = COALESCE(?, branch_id), gstin = ?, address = ?,
           contact_name = ?, contact_phone = ?
         WHERE id = ?`,
        [b.name ?? null, b.name ? normKey(b.name) : null, b.name ? sortKey(b.name) : null,
         b.branchId ?? null,
         b.gstin === undefined ? client.gstin : (b.gstin || null),
         b.address === undefined ? client.address : (b.address || null),
         b.contactName === undefined ? client.contact_name : (b.contactName || null),
         b.contactPhone === undefined ? client.contact_phone : (b.contactPhone || null),
         client.id], conn);
      await log(conn, { entity: 'CLIENT', entityId: client.id, action: 'Edited',
        detail: b.name || client.name, user: req.user });
    });
    res.json({ ok: true, id: client.id });
  })
);

router.post('/clients',
  validate(z.object({
    name: z.string().trim().min(2).max(180),
    branchId: z.coerce.number().int().positive(),
    gstin: z.string().trim().length(15).optional().or(z.literal('')),
    address: z.string().trim().max(400).optional(),
    contactName: z.string().trim().max(120).optional(),
    contactPhone: z.string().trim().max(20).optional(),
  })),
  wrap(async (req, res) => {
    const b = req.body;
    const key = normKey(b.name);
    const clash = await one(`SELECT id, name FROM clients WHERE norm_key = ?`, [key]);
    if (clash) throw conflict(`Already on the list as "${clash.name}"`, { clientId: clash.id });
    const id = await tx(async (conn) => {
      const r = await run(
        `INSERT INTO clients (branch_id, name, norm_key, sort_key, gstin, address, contact_name, contact_phone)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [b.branchId, b.name, key, sortKey(b.name), b.gstin || null, b.address || null,
         b.contactName || null, b.contactPhone || null], conn
      );
      await log(conn, { entity: 'CLIENT', entityId: r.insertId, action: 'Created', detail: b.name, user: req.user });
      return r.insertId;
    });
    res.status(201).json({ id, name: b.name });
  })
);

module.exports = router;
