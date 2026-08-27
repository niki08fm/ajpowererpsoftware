'use strict';
const router = require('express').Router();
const { z } = require('zod');
const { many, one, tx, run } = require('../config/db');
const { validate, wrap } = require('../middleware/validate');
const { normKey, sortKey } = require('../lib/normKey');
const { log } = require('../lib/audit');
const { conflict } = require('../lib/errors');

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

router.get('/clients',
  validate(z.object({ branchId: z.coerce.number().int().positive().optional() }), 'query'),
  wrap(async (req, res) => res.json(await many(
    `SELECT id, branch_id, name, gstin, address, contact_name, contact_phone
       FROM clients ${req.query.branchId ? 'WHERE branch_id = ?' : ''} ORDER BY name`,
    req.query.branchId ? [req.query.branchId] : []
  ))));

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
