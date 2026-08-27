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
 * The item master. 2,600 items, so everything here is paged and
 * searched server-side — the client never holds the whole list.
 *
 * Adding to it is Store's job and nobody else's. Everyone else picks
 * from it, and raises a remark when something is missing.
 */

const SELECT_ITEM = `
  SELECT i.id, i.code, i.name, i.item_type, i.gst_rate, i.hsn, i.std_rate,
         i.opening_qty, i.status,
         c.id AS category_id, c.code AS category_code, c.name AS category_name,
         u.id AS uom_id, u.code AS uom,
         COALESCE(GROUP_CONCAT(mk.name ORDER BY mk.name SEPARATOR '|'), '') AS makes
    FROM items i
    JOIN item_categories c ON c.id = i.category_id
    JOIN uoms u ON u.id = i.uom_id
    LEFT JOIN item_makes im ON im.item_id = i.id
    LEFT JOIN makes mk ON mk.id = im.make_id`;

const shape = (r) => ({
  id: r.id, code: r.code, name: r.name, type: r.item_type,
  uom: r.uom, uomId: r.uom_id,
  category: { id: r.category_id, code: r.category_code, name: r.category_name },
  gstRate: r.gst_rate, hsn: r.hsn, stdRate: r.std_rate, openingQty: r.opening_qty,
  status: r.status,
  makes: r.makes ? r.makes.split('|') : [],
});

router.get('/',
  validate(z.object({
    q: z.string().trim().max(120).optional(),
    categoryId: z.coerce.number().int().positive().optional(),
    type: z.enum(['BILLABLE', 'CONSUMABLE']).optional(),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(200).default(60),
  }), 'query'),
  wrap(async (req, res) => {
    const { q, categoryId, type, page, pageSize } = req.query;
    const where = [`i.status = 'ACTIVE'`];
    const params = [];
    if (categoryId) { where.push('i.category_id = ?'); params.push(categoryId); }
    if (type) { where.push('i.item_type = ?'); params.push(type); }
    if (q) {
      // every word must appear somewhere, in any order: "red wire 1.5"
      for (const w of q.split(/\s+/).filter(Boolean).slice(0, 6)) {
        where.push(`CONCAT(i.code, ' ', i.name) LIKE ?`);
        params.push(`%${w}%`);
      }
    }
    const clause = `WHERE ${where.join(' AND ')}`;
    const { total } = await one(`SELECT COUNT(*) AS total FROM items i ${clause}`, params);
    const rows = await many(
      `${SELECT_ITEM} ${clause} GROUP BY i.id ORDER BY i.code LIMIT ? OFFSET ?`,
      [...params, pageSize, (page - 1) * pageSize]
    );
    res.json({ total, page, pageSize, items: rows.map(shape) });
  })
);

/** The typeahead the BOQ builder uses. Deliberately small and fast. */
router.get('/search',
  validate(z.object({ q: z.string().trim().min(2).max(120), limit: z.coerce.number().int().min(1).max(25).default(12) }), 'query'),
  wrap(async (req, res) => {
    const words = req.query.q.split(/\s+/).filter(Boolean).slice(0, 6);
    const where = words.map(() => `CONCAT(i.code,' ',i.name) LIKE ?`).join(' AND ');
    const rows = await many(
      `${SELECT_ITEM} WHERE i.status='ACTIVE' AND ${where}
       GROUP BY i.id ORDER BY CHAR_LENGTH(i.name) LIMIT ?`,
      [...words.map((w) => `%${w}%`), req.query.limit]
    );
    res.json(rows.map(shape));
  })
);

router.get('/:id', wrap(async (req, res) => {
  const r = await one(`${SELECT_ITEM} WHERE i.id = ? GROUP BY i.id`, [req.params.id]);
  if (!r) throw notFound('No such item');
  res.json(shape(r));
}));

const itemBody = z.object({
  name: z.string().trim().min(3).max(255),
  categoryId: z.coerce.number().int().positive(),
  uomId: z.coerce.number().int().positive(),
  type: z.enum(['BILLABLE', 'CONSUMABLE']).default('BILLABLE'),
  gstRate: z.coerce.number().min(0).max(28).default(18),
  hsn: z.string().trim().max(12).optional(),
  stdRate: z.coerce.number().min(0).default(0),
  makes: z.array(z.string().trim().min(1).max(80)).max(20).default([]),
});

router.post('/', validate(itemBody), wrap(async (req, res) => {
  const b = req.body;
  const key = normKey(b.name);

  // the hard guard: same name, differently typed
  const exact = await one(`SELECT id, code, name FROM items WHERE norm_key = ?`, [key]);
  if (exact) throw conflict(`Already in the master as ${exact.code} — ${exact.name}`, { itemId: exact.id });

  const out = await tx(async (conn) => {
    const cat = await one(`SELECT code FROM item_categories WHERE id = ?`, [b.categoryId], conn);
    if (!cat) throw notFound('No such category');
    const code = await nextItemCode(conn, cat.code);
    const r = await run(
      `INSERT INTO items (code, name, norm_key, sort_key, category_id, uom_id, item_type, gst_rate, hsn, std_rate, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [code, b.name, key, sortKey(b.name), b.categoryId, b.uomId, b.type, b.gstRate, b.hsn || null, b.stdRate, req.user?.id || null],
      conn
    );
    for (const m of b.makes) {
      await run(`INSERT IGNORE INTO makes (name) VALUES (?)`, [m], conn);
      await run(
        `INSERT IGNORE INTO item_makes (item_id, make_id) VALUES (?, (SELECT id FROM makes WHERE name = ?))`,
        [r.insertId, m], conn
      );
    }
    await log(conn, { entity: 'ITEM', entityId: r.insertId, docNo: code, action: 'Added by Store', detail: b.name, user: req.user });
    return { id: r.insertId, code };
  });

  // the soft guard: same words, different order. Saved, but say so.
  const similar = await many(
    `SELECT id, code, name FROM items WHERE sort_key = ? AND id <> ? LIMIT 3`,
    [sortKey(b.name), out.id]
  );
  res.status(201).json({
    ...out, name: b.name,
    ...(similar.length ? {
      warning: 'Saved, but these look like the same thing written differently — check before using it',
      similar,
    } : {}),
  });
}));

router.patch('/:id', validate(itemBody.partial()), wrap(async (req, res) => {
  const b = req.body;
  const item = await one(`SELECT * FROM items WHERE id = ?`, [req.params.id]);
  if (!item) throw notFound('No such item');
  if (b.name) {
    const clash = await one(`SELECT id, code, name FROM items WHERE norm_key = ? AND id <> ?`, [normKey(b.name), item.id]);
    if (clash) throw conflict(`Already in the master as ${clash.code} — ${clash.name}`);
  }
  await tx(async (conn) => {
    await run(
      `UPDATE items SET name = COALESCE(?, name), norm_key = COALESCE(?, norm_key), sort_key = COALESCE(?, sort_key),
              category_id = COALESCE(?, category_id), uom_id = COALESCE(?, uom_id), item_type = COALESCE(?, item_type),
              gst_rate = COALESCE(?, gst_rate), hsn = COALESCE(?, hsn), std_rate = COALESCE(?, std_rate)
        WHERE id = ?`,
      [b.name ?? null, b.name ? normKey(b.name) : null, b.name ? sortKey(b.name) : null,
       b.categoryId ?? null, b.uomId ?? null, b.type ?? null,
       b.gstRate ?? null, b.hsn ?? null, b.stdRate ?? null, item.id], conn
    );
    if (b.makes) {
      await run(`DELETE FROM item_makes WHERE item_id = ?`, [item.id], conn);
      for (const m of b.makes) {
        await run(`INSERT IGNORE INTO makes (name) VALUES (?)`, [m], conn);
        await run(`INSERT IGNORE INTO item_makes (item_id, make_id) VALUES (?, (SELECT id FROM makes WHERE name = ?))`,
          [item.id, m], conn);
      }
    }
    await log(conn, { entity: 'ITEM', entityId: item.id, docNo: item.code, action: 'Edited', detail: b.name || item.name, user: req.user });
  });
  res.json({ ok: true });
}));

module.exports = router;
