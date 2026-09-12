-- =====================================================================
--  The indent becomes the BOQ sheet, and consumption comes out.
--
--  Two changes.
--
--  1. Balance is no longer the number the site works from. What it
--     wants to know is what has already been ordered for that item —
--     across the whole BOQ, not line by line, because the same switch
--     on line 1a and line 2a is one switch to whoever buys it.
--
--  2. Consumption is withdrawn. The tables stay so nothing is lost,
--     but the derived views stop referring to them; what replaces it
--     is a different mechanism and it will bring its own.
-- =====================================================================

-- How much of an item has already been ordered on this BOQ, whatever
-- line it was ordered against. A draft counts for nothing, the same
-- rule as everywhere else.
CREATE OR REPLACE VIEW v_boq_item_indented AS
SELECT
  bl.boq_id,
  bl.item_id,
  COALESCE(SUM(CASE WHEN i.status = 'APPROVED'  THEN il.qty END), 0) AS approved_qty,
  COALESCE(SUM(CASE WHEN i.status = 'SUBMITTED' THEN il.qty END), 0) AS pending_qty,
  COALESCE(SUM(CASE WHEN i.status IN ('APPROVED','SUBMITTED') THEN il.qty END), 0) AS indented_qty
FROM boq_lines bl
LEFT JOIN indent_lines il ON il.boq_line_id = bl.id
LEFT JOIN indents i       ON i.id = il.indent_id
GROUP BY bl.boq_id, bl.item_id;

-- movement drops consumption
CREATE OR REPLACE VIEW v_boq_line_movement AS
SELECT
  bl.id AS boq_line_id,
  COALESCE((SELECT SUM(il.qty) FROM indent_lines il
              JOIN indents i ON i.id = il.indent_id
             WHERE il.boq_line_id = bl.id AND i.status = 'APPROVED'), 0)  AS approved_qty,
  COALESCE((SELECT SUM(il.qty) FROM indent_lines il
              JOIN indents i ON i.id = il.indent_id
             WHERE il.boq_line_id = bl.id AND i.status = 'SUBMITTED'), 0) AS pending_qty,
  COALESCE((SELECT SUM(il.qty) FROM indent_lines il
              JOIN indents i ON i.id = il.indent_id
             WHERE il.boq_line_id = bl.id AND i.status IN ('APPROVED','SUBMITTED')), 0) AS committed_qty
FROM boq_lines bl;

-- the line status keeps the ceiling, loses consumption, and gains what
-- has already been ordered for the item
CREATE OR REPLACE VIEW v_boq_line_status AS
SELECT
  bl.id AS boq_line_id, bl.boq_id, b.site_id, b.branch_id,
  b.status AS boq_status, b.over_allow, b.over_pct,
  bwl.id AS boq_wo_line_id, bwl.wo_line_id,
  wol.sno AS wo_sno, wol.description AS wo_description,
  bl.sno, bl.item_id, it.code AS item_code, it.name AS item_name,
  bl.make_id, mk.name AS make_name, u.code AS uom,
  bl.item_qty, bl.boq_qty, bl.est_qty, bl.var_qty,
  (bl.est_qty + bl.var_qty) AS effective_est,
  m.approved_qty, m.pending_qty, m.committed_qty,
  ii.indented_qty AS item_indented_qty,
  (bl.est_qty + bl.var_qty - m.committed_qty) AS balance,
  CASE
    WHEN b.over_allow = 0 THEN (bl.est_qty + bl.var_qty)
    WHEN b.over_pct   = 0 THEN NULL
    ELSE ROUND((bl.est_qty + bl.var_qty) * (1 + b.over_pct / 100), 3)
  END AS ceiling_qty,
  GREATEST(m.committed_qty - (bl.est_qty + bl.var_qty), 0) AS over_qty,
  CASE WHEN (bl.est_qty + bl.var_qty) > 0
       THEN ROUND(GREATEST(m.committed_qty - (bl.est_qty + bl.var_qty), 0)
                  / (bl.est_qty + bl.var_qty) * 100, 2)
       ELSE 0 END AS over_pct_actual
FROM boq_lines bl
JOIN boqs b               ON b.id   = bl.boq_id
JOIN boq_wo_lines bwl     ON bwl.id = bl.boq_wo_line_id
JOIN work_order_lines wol ON wol.id = bwl.wo_line_id
JOIN items it             ON it.id  = bl.item_id
JOIN uoms u               ON u.id   = bl.uom_id
LEFT JOIN makes mk        ON mk.id  = bl.make_id
JOIN v_boq_line_movement m ON m.boq_line_id = bl.id
LEFT JOIN v_boq_item_indented ii ON ii.boq_id = bl.boq_id AND ii.item_id = bl.item_id;

-- site progress loses consumption with it
CREATE OR REPLACE VIEW v_site_progress AS
SELECT
  b.site_id,
  b.id AS boq_id,
  COUNT(s.boq_line_id)              AS boq_lines,
  COALESCE(SUM(s.effective_est), 0) AS estimated_qty,
  COALESCE(SUM(s.approved_qty), 0)  AS indented_qty,
  COALESCE(SUM(CASE WHEN s.over_qty > 0 THEN 1 ELSE 0 END), 0) AS over_lines
FROM boqs b
LEFT JOIN v_boq_line_status s ON s.boq_id = b.id
GROUP BY b.id;

-- What an approved indent actually orders: the same item asked for on
-- two BOQ lines is one line here, which is how Procurement and the
-- store read it. Raised against 1a and 2a; bought once.
CREATE OR REPLACE VIEW v_indent_rollup AS
SELECT
  il.indent_id,
  il.item_id,
  il.make_id,
  it.code AS item_code,
  it.name AS item_name,
  u.code  AS uom,
  mk.name AS make_name,
  SUM(il.qty)       AS qty,
  COUNT(*)          AS from_lines,
  GROUP_CONCAT(bl.sno ORDER BY bl.sno SEPARATOR ', ') AS boq_snos
FROM indent_lines il
JOIN boq_lines bl ON bl.id = il.boq_line_id
JOIN items it     ON it.id = il.item_id
JOIN uoms u       ON u.id  = bl.uom_id
LEFT JOIN makes mk ON mk.id = il.make_id
GROUP BY il.indent_id, il.item_id, il.make_id;
