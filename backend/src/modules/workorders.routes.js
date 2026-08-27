'use strict';
const router = require('express').Router();
const multer = require('multer');
const { z } = require('zod');
const { many, one, run, tx } = require('../config/db');
const { validate, wrap } = require('../middleware/validate');
const { nextDocNo } = require('../lib/docNo');
const { parseWorkOrder } = require('../lib/woImport');
const { log } = require('../lib/audit');
const { conflict, notFound, badRequest } = require('../lib/errors');

/**
 * The work order is the client's document. Their wording, their
 * quantity, their rate. It is written once and never edited — a change
 * is an amendment, which is a separate document with its own trail.
 */

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok = /\.(xlsx|xls|csv|txt)$/i.test(file.originalname);
    cb(ok ? null : badRequest('Upload an .xlsx, .xls or .csv file'), ok);
  },
});

/** Read a client's sheet and hand back the lines. Nothing is saved here. */
router.post('/parse', upload.single('file'),
  wrap(async (req, res) => {
    if (!req.file) throw badRequest('No file came through');
    const uoms = (await many(`SELECT code FROM uoms ORDER BY code`)).map((u) => u.code);
    const parsed = parseWorkOrder(req.file.buffer, { uomCodes: uoms });
    if (!parsed.lines.length) {
      throw badRequest('No work order lines found — check there is a description column and a quantity column');
    }
    const value = parsed.lines.reduce((a, l) => a + l.qty * (l.supplyRate + l.instRate), 0);
    res.json({
      ...parsed,
      value: Math.round(value * 100) / 100,
      incomplete: parsed.lines.filter((l) => !l.qty || (!l.supplyRate && !l.instRate)).length,
      unknownUoms: [...new Set(parsed.lines.map((l) => l.uom).filter((u) => u && !uoms.includes(u)))],
    });
  })
);

const woBody = z.object({
  siteId: z.coerce.number().int().positive(),
  clientWoNo: z.string().trim().max(64).optional(),
  woDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  lines: z.array(z.object({
    description: z.string().trim().min(2).max(500),
    uom: z.string().trim().min(1).max(12),
    qty: z.coerce.number().positive(),
    supplyRate: z.coerce.number().min(0).default(0),
    instRate: z.coerce.number().min(0).default(0),
  })).min(1).max(2000),
}).refine((v) => v.lines.every((l) => l.supplyRate > 0 || l.instRate > 0),
  { message: 'Every line needs a supply rate or an installation rate', path: ['lines'] });

router.post('/', validate(woBody),
  wrap(async (req, res) => {
    const b = req.body;
    const site = await one(`SELECT * FROM sites WHERE id = ? AND site_type = 'SITE'`, [b.siteId]);
    if (!site) throw notFound('No such site');
    const existing = await one(`SELECT doc_no FROM work_orders WHERE site_id = ?`, [b.siteId]);
    if (existing) throw conflict(`This site already has work order ${existing.doc_no}`);

    const out = await tx(async (conn) => {
      const docNo = await nextDocNo(conn, 'WO', b.woDate);
      const wo = await run(
        `INSERT INTO work_orders (doc_no, site_id, branch_id, client_wo_no, wo_date, created_by)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [docNo, b.siteId, site.branch_id, b.clientWoNo || null, b.woDate, req.user?.id || null], conn
      );
      let sno = 0;
      for (const l of b.lines) {
        // a unit the client used that we do not stock yet becomes one we do
        await run(`INSERT IGNORE INTO uoms (code, name) VALUES (?, ?)`, [l.uom, l.uom], conn);
        await run(
          `INSERT INTO work_order_lines (work_order_id, sno, description, uom_id, qty, supply_rate, inst_rate)
           VALUES (?, ?, ?, (SELECT id FROM uoms WHERE code = ?), ?, ?, ?)`,
          [wo.insertId, ++sno, l.description, l.uom, l.qty, l.supplyRate, l.instRate], conn
        );
      }
      const v = await one(`SELECT wo_value FROM v_work_order_value WHERE work_order_id = ?`, [wo.insertId], conn);
      await log(conn, {
        entity: 'WO', entityId: wo.insertId, docNo, action: 'Loaded and locked',
        detail: `${sno} lines · ${v.wo_value} · ${site.name}`, user: req.user,
      });
      return { id: wo.insertId, docNo, lineCount: sno, value: v.wo_value };
    });
    res.status(201).json(out);
  })
);

router.get('/site/:siteId', wrap(async (req, res) => {
  const wo = await one(
    `SELECT wo.*, v.wo_value, v.supply_value, v.inst_value, v.line_count
       FROM work_orders wo
       LEFT JOIN v_work_order_value v ON v.work_order_id = wo.id
      WHERE wo.site_id = ?`, [req.params.siteId]
  );
  if (!wo) throw notFound('This site has no work order yet');
  const lines = await many(
    `SELECT wol.id, wol.sno, wol.description, u.code AS uom, wol.qty,
            wol.supply_rate, wol.inst_rate, wol.supply_amount, wol.inst_amount, wol.line_total
       FROM work_order_lines wol JOIN uoms u ON u.id = wol.uom_id
      WHERE wol.work_order_id = ? ORDER BY wol.sno`, [wo.id]
  );
  res.json({
    id: wo.id, docNo: wo.doc_no, clientWoNo: wo.client_wo_no, woDate: wo.wo_date,
    status: wo.status, value: wo.wo_value, supplyValue: wo.supply_value, instValue: wo.inst_value,
    lineCount: wo.line_count, lines,
  });
}));

module.exports = router;
