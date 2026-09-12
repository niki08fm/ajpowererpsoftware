-- =====================================================================
--  What billing can answer.
--
--  The sheet a biller works on is one row per work order line, and it
--  has to carry four numbers that come from four different places:
--
--    what was agreed      the work order, plus any amendment
--    what was provisioned the indents raised under it
--    what has been billed every bill before this one
--    what is left         the first less the third
--
--  "What was provisioned" is the awkward one. Indents are raised per
--  ITEM, and a work order line is not an item — it is 100 socket
--  points, each needing one box and two plates. So the honest
--  translation into the client's units is the item that has been
--  provisioned least: if boxes are in for 80 points and plates for
--  only 60, then 60 points have their material, not 80. That is a
--  MIN across the items, and it is the number a biller can defend.
-- =====================================================================

-- How much of a work order line the indents have provisioned for,
-- expressed in the client's units.
CREATE OR REPLACE VIEW v_wo_line_indented AS
SELECT
  s.wo_line_id,
  s.boq_id,
  COUNT(*) AS item_count,
  -- the least-provisioned item is what the line can actually be built
  -- to. Items with no quantity per unit cannot answer, and are left
  -- out rather than counted as nothing.
  MIN(CASE WHEN s.item_qty > 0 THEN s.approved_qty / s.item_qty END) AS indented_qty
FROM v_boq_line_status s
GROUP BY s.wo_line_id, s.boq_id;

-- Everything billed against a work order line, across every raised
-- bill. A draft bill is a working note and is not counted.
CREATE OR REPLACE VIEW v_wo_line_billed AS
SELECT
  l.wo_line_id,
  COUNT(*)                  AS bill_count,
  SUM(l.qty)                AS billed_qty,
  SUM(l.line_total)         AS billed_value,
  MAX(b.bill_date)          AS last_billed_on,
  MAX(b.ra_no)              AS last_ra_no
FROM bill_lines l
JOIN bills b ON b.id = l.bill_id
WHERE b.status = 'RAISED'
GROUP BY l.wo_line_id;

-- ---------------------------------------------------------- the sheet
CREATE OR REPLACE VIEW v_billing_line AS
SELECT
  wol.id AS wo_line_id,
  wo.id  AS work_order_id,
  wo.site_id, wo.branch_id,
  wol.sno, wol.description,
  wol.uom_id, u.code AS uom,
  wol.qty        AS contracted_qty,
  COALESCE(bwl.var_qty, 0) AS var_qty,
  (wol.qty + COALESCE(bwl.var_qty, 0)) AS boq_qty,
  wol.supply_rate, wol.inst_rate,
  (wol.supply_rate + wol.inst_rate) AS rate,
  wol.line_total AS contract_value,
  COALESCE(ind.indented_qty, 0) AS indented_qty,
  COALESCE(bd.billed_qty, 0)    AS billed_qty,
  COALESCE(bd.billed_value, 0)  AS billed_value,
  bd.last_ra_no, bd.last_billed_on,
  GREATEST((wol.qty + COALESCE(bwl.var_qty, 0)) - COALESCE(bd.billed_qty, 0), 0)
    AS to_bill_qty,
  ROUND(GREATEST((wol.qty + COALESCE(bwl.var_qty, 0)) - COALESCE(bd.billed_qty, 0), 0)
        * (wol.supply_rate + wol.inst_rate), 2) AS to_bill_value,
  CASE WHEN (wol.qty + COALESCE(bwl.var_qty, 0)) > 0
       THEN ROUND(COALESCE(bd.billed_qty, 0)
                  / (wol.qty + COALESCE(bwl.var_qty, 0)) * 100, 2)
       ELSE 0 END AS billed_pct
FROM work_order_lines wol
JOIN work_orders wo        ON wo.id = wol.work_order_id
JOIN uoms u                ON u.id  = wol.uom_id
LEFT JOIN boq_wo_lines bwl ON bwl.wo_line_id = wol.id
LEFT JOIN v_wo_line_indented ind ON ind.wo_line_id = wol.id
LEFT JOIN v_wo_line_billed bd    ON bd.wo_line_id = wol.id;

-- ------------------------------------------------------ the documents
CREATE OR REPLACE VIEW v_bill_line AS
SELECT
  l.id AS line_id, l.bill_id, l.wo_line_id,
  wol.sno, wol.description, u.code AS uom,
  l.qty, l.supply_rate, l.inst_rate,
  (l.supply_rate + l.inst_rate) AS rate,
  l.supply_amount, l.inst_amount, l.line_total,
  l.remark,
  wol.qty + COALESCE(bwl.var_qty, 0) AS boq_qty,
  -- what this line stood at before this bill, so an RA bill reads the
  -- way an RA bill is meant to read: up to date, this bill, to date
  COALESCE((SELECT SUM(x.qty) FROM bill_lines x
              JOIN bills xb ON xb.id = x.bill_id
             WHERE x.wo_line_id = l.wo_line_id AND xb.status = 'RAISED'
               AND xb.ra_no < (SELECT ra_no FROM bills WHERE id = l.bill_id)), 0)
    AS previous_qty
FROM bill_lines l
JOIN work_order_lines wol ON wol.id = l.wo_line_id
JOIN uoms u               ON u.id  = wol.uom_id
LEFT JOIN boq_wo_lines bwl ON bwl.wo_line_id = wol.id;

CREATE OR REPLACE VIEW v_bill_status AS
SELECT
  b.id AS bill_id, b.doc_no, b.ra_no, b.site_id, b.branch_id, b.work_order_id,
  b.bill_date, b.period_from, b.period_to, b.status, b.client_ref, b.note,
  b.raised_at, b.created_at,
  s.name AS site_name, s.code AS site_code,
  c.name AS client_name, b.client_id,
  wo.doc_no AS wo_no, wo.client_wo_no,
  ru.name AS raised_by_name, cu.name AS created_by_name,
  COUNT(l.line_id)                     AS line_count,
  COALESCE(SUM(l.qty), 0)              AS bill_qty,
  COALESCE(SUM(l.supply_amount), 0)    AS supply_value,
  COALESCE(SUM(l.inst_amount), 0)      AS inst_value,
  COALESCE(SUM(l.line_total), 0)       AS bill_value
FROM bills b
JOIN sites s              ON s.id = b.site_id
JOIN work_orders wo       ON wo.id = b.work_order_id
LEFT JOIN clients c       ON c.id = b.client_id
LEFT JOIN users ru        ON ru.id = b.raised_by
LEFT JOIN users cu        ON cu.id = b.created_by
LEFT JOIN v_bill_line l   ON l.bill_id = b.id
GROUP BY b.id;

-- ------------------------------------------------- revenue, at last
-- Raised bills only. A draft is a working note and the profit and
-- loss must never see one.
CREATE OR REPLACE VIEW v_site_revenue AS
SELECT
  b.site_id, b.branch_id,
  COUNT(DISTINCT b.id)             AS bills,
  MAX(b.ra_no)                     AS last_ra_no,
  COALESCE(SUM(l.line_total), 0)   AS revenue,
  COALESCE(SUM(l.supply_amount), 0) AS supply_revenue,
  COALESCE(SUM(l.inst_amount), 0)   AS inst_revenue,
  MIN(b.bill_date)                 AS first_billed_on,
  MAX(b.bill_date)                 AS last_billed_on
FROM bills b
JOIN bill_lines l ON l.bill_id = b.id
WHERE b.status = 'RAISED'
GROUP BY b.site_id, b.branch_id;
