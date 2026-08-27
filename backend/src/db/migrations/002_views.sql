-- =====================================================================
--  Derived quantities. Nothing below is stored anywhere.
--  The legacy system kept running totals in columns and they drifted.
-- =====================================================================

-- What each BOQ line has been asked for. A DRAFT counts for nothing:
-- a cart is not a commitment, and a site manager building one over
-- three days must not be silently holding quantity nobody can see.
CREATE OR REPLACE VIEW v_boq_line_movement AS
SELECT
  bl.id AS boq_line_id,
  COALESCE(SUM(CASE WHEN i.status = 'APPROVED'  THEN il.qty END), 0) AS approved_qty,
  COALESCE(SUM(CASE WHEN i.status = 'SUBMITTED' THEN il.qty END), 0) AS pending_qty,
  COALESCE(SUM(CASE WHEN i.status IN ('APPROVED','SUBMITTED') THEN il.qty END), 0) AS committed_qty
FROM boq_lines bl
LEFT JOIN indent_lines il ON il.boq_line_id = bl.id
LEFT JOIN indents i ON i.id = il.indent_id
GROUP BY bl.id;

-- A BOQ line with everything an indent screen needs, in one row.
--   effective_est = est_qty + var_qty     (an amendment moves this)
--   ceiling_qty   = NULL when the BOQ allows overspill with no cap
--   balance       = effective_est - committed; may go negative, which
--                   is exactly the signal that an amendment is due
CREATE OR REPLACE VIEW v_boq_line_status AS
SELECT
  bl.id AS boq_line_id, bl.boq_id, b.site_id, b.branch_id,
  b.status AS boq_status, b.over_allow, b.over_pct,
  bwl.wo_line_id, wol.sno AS wo_sno, wol.description AS wo_description,
  bl.sno, bl.item_id, it.code AS item_code, it.name AS item_name,
  bl.make_id, mk.name AS make_name, u.code AS uom,
  bl.item_qty, bl.boq_qty, bl.est_qty, bl.var_qty,
  (bl.est_qty + bl.var_qty) AS effective_est,
  m.approved_qty, m.pending_qty, m.committed_qty,
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
JOIN v_boq_line_movement m ON m.boq_line_id = bl.id;

-- One row per BOQ: how far it is prepared, and whether anything on it
-- has been indented past its estimate.
CREATE OR REPLACE VIEW v_boq_status AS
SELECT
  b.id AS boq_id, b.doc_no, b.site_id, b.branch_id, b.status,
  b.over_allow, b.over_pct,
  (SELECT COUNT(*) FROM work_order_lines wl WHERE wl.work_order_id = b.work_order_id) AS wo_line_count,
  (SELECT COUNT(DISTINCT bwl.wo_line_id)
     FROM boq_wo_lines bwl JOIN boq_lines bl2 ON bl2.boq_wo_line_id = bwl.id
    WHERE bwl.boq_id = b.id) AS prepared_count,
  COALESCE(SUM(CASE WHEN s.over_qty > 0 THEN 1 ELSE 0 END), 0) AS over_line_count,
  COALESCE(MAX(s.over_pct_actual), 0) AS worst_over_pct,
  CASE
    WHEN b.status <> 'LOCKED' THEN 'DRAFT'
    WHEN COALESCE(SUM(CASE WHEN s.over_qty > 0 THEN 1 ELSE 0 END), 0) > 0 THEN 'AMENDMENT_DUE'
    ELSE 'LOCKED'
  -- pinned so comparing this against a literal cannot raise
  -- ER_CANT_AGGREGATE_2COLLATIONS whatever the session default is
  END COLLATE utf8mb4_unicode_ci AS state
FROM boqs b
LEFT JOIN v_boq_line_status s ON s.boq_id = b.id
GROUP BY b.id;

CREATE OR REPLACE VIEW v_work_order_value AS
SELECT
  wo.id AS work_order_id, wo.site_id,
  COUNT(wol.id) AS line_count,
  COALESCE(SUM(wol.supply_amount), 0) AS supply_value,
  COALESCE(SUM(wol.inst_amount), 0)   AS inst_value,
  COALESCE(SUM(wol.line_total), 0)    AS wo_value
FROM work_orders wo
LEFT JOIN work_order_lines wol ON wol.work_order_id = wo.id
GROUP BY wo.id;
