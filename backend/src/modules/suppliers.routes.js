'use strict';
const router = require('express').Router();
const { z } = require('zod');
const { many, one, run, tx } = require('../config/db');
const { validate, wrap } = require('../middleware/validate');
const { normKey, sortKey } = require('../lib/normKey');
const { nextItemCode } = require('../lib/docNo');
const { log } = require('../lib/audit');
const { conflict, notFound } = require('../lib/errors');

/**
 * Suppliers. The same duplicate guard as the item master, for the same
 * reason: "Polycab Distributors" and "polycab distributors." becoming
 * two ledgers is how a company loses track of what it owes whom.
 *
 * A supplier carries the makes they actually stock, so a comparison can
 * offer the right people rather than the whole list.
 */

const SELECT = `
  SELECT s.*,
         (SELECT COUNT(*) FROM purchase_orders p WHERE p.supplier_id = s.id) AS po_count,
         (SELECT GROUP_CONCAT(m.name ORDER BY m.name SEPARATOR ', ')
            FROM supplier_makes sm JOIN makes m ON m.id = sm.make_id
           WHERE sm.supplier_id = s.id) AS makes
    FROM suppliers s`;

router.get('/',
  validate(z.object({
    q: z.string().trim().optional(),
    makeId: z.coerce.number().int().positive().optional(),
    includeInactive: z.coerce.boolean().default(false),
  }), 'query'),
  wrap(async (req, res) => {
    const where = [];
    const params = [];
    if (!req.query.includeInactive) where.push(`s.status = 'ACTIVE'`);
    if (req.query.q) {
      where.push('(s.name LIKE ? OR s.code LIKE ? OR s.gstin LIKE ?)');
      const like = `%${req.query.q}%`;
      params.push(like, like, like);
    }
    if (req.query.makeId) {
      where.push('EXISTS (SELECT 1 FROM supplier_makes sm WHERE sm.supplier_id = s.id AND sm.make_id = ?)');
      params.push(req.query.makeId);
    }
    res.json(await many(
      `${SELECT} ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY s.name`, params));
  })
);

router.get('/:id', wrap(async (req, res) => {
  const s = await one(`${SELECT} WHERE s.id = ?`, [req.params.id]);
  if (!s) throw notFound('No such supplier');
  const makes = await many(
    `SELECT m.id, m.name FROM supplier_makes sm JOIN makes m ON m.id = sm.make_id
      WHERE sm.supplier_id = ? ORDER BY m.name`, [s.id]);
  res.json({ ...s, makeList: makes });
}));

const fields = z.object({
  name: z.string().trim().min(2).max(180),
  gstin: z.string().trim().length(15).optional().or(z.literal('')),
  address: z.string().trim().max(400).optional(),
  contactName: z.string().trim().max(120).optional(),
  contactPhone: z.string().trim().max(20).optional(),
  email: z.string().trim().email().max(160).optional().or(z.literal('')),
  termsDays: z.coerce.number().int().min(0).max(365).default(30),
  makes: z.array(z.coerce.number().int().positive()).max(60).default([]),
});

router.post('/', validate(fields), wrap(async (req, res) => {
  const b = req.body;
  const key = normKey(b.name);
  const clash = await one(`SELECT id, code, name FROM suppliers WHERE norm_key = ?`, [key]);
  if (clash) throw conflict(`Already on the list as ${clash.code} — ${clash.name}`, { supplierId: clash.id });

  const out = await tx(async (conn) => {
    const code = await nextItemCode(conn, 'SUP');
    const r = await run(
      `INSERT INTO suppliers (code, name, norm_key, sort_key, gstin, address,
                              contact_name, contact_phone, email, terms_days, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [code, b.name, key, sortKey(b.name), b.gstin || null, b.address || null,
       b.contactName || null, b.contactPhone || null, b.email || null, b.termsDays,
       req.user?.id || null], conn
    );
    for (const m of new Set(b.makes)) {
      await run(`INSERT IGNORE INTO supplier_makes (supplier_id, make_id) VALUES (?, ?)`,
        [r.insertId, m], conn);
    }
    await log(conn, { entity: 'SUPPLIER', entityId: r.insertId, docNo: code,
      action: 'Added', detail: b.name, user: req.user });
    return { id: r.insertId, code };
  });
  res.status(201).json({ ...out, name: b.name });
}));

router.patch('/:id', validate(fields.partial()), wrap(async (req, res) => {
  const b = req.body;
  const s = await one(`SELECT * FROM suppliers WHERE id = ?`, [req.params.id]);
  if (!s) throw notFound('No such supplier');
  if (b.name) {
    const clash = await one(`SELECT id, code FROM suppliers WHERE norm_key = ? AND id <> ?`,
      [normKey(b.name), s.id]);
    if (clash) throw conflict(`Already on the list as ${clash.code}`);
  }
  await tx(async (conn) => {
    await run(
      `UPDATE suppliers SET name = COALESCE(?, name),
              norm_key = COALESCE(?, norm_key), sort_key = COALESCE(?, sort_key),
              gstin = COALESCE(?, gstin), address = COALESCE(?, address),
              contact_name = COALESCE(?, contact_name), contact_phone = COALESCE(?, contact_phone),
              email = COALESCE(?, email), terms_days = COALESCE(?, terms_days)
        WHERE id = ?`,
      [b.name ?? null, b.name ? normKey(b.name) : null, b.name ? sortKey(b.name) : null,
       b.gstin ?? null, b.address ?? null, b.contactName ?? null, b.contactPhone ?? null,
       b.email ?? null, b.termsDays ?? null, s.id], conn
    );
    if (b.makes) {
      await run(`DELETE FROM supplier_makes WHERE supplier_id = ?`, [s.id], conn);
      for (const m of new Set(b.makes)) {
        await run(`INSERT IGNORE INTO supplier_makes (supplier_id, make_id) VALUES (?, ?)`, [s.id, m], conn);
      }
    }
    await log(conn, { entity: 'SUPPLIER', entityId: s.id, docNo: s.code,
      action: 'Edited', detail: b.name || s.name, user: req.user });
  });
  res.json({ ok: true });
}));

module.exports = router;
