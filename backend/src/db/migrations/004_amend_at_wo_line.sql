-- =====================================================================
--  Amendment moves to the work order line.
--
--  Before: an amendment was typed against each BOQ item. Fifteen items
--  under one work order line meant fifteen numbers, and only the
--  estimate moved — the BOQ quantity never did.
--
--  After: one number against the work order line, and every item under
--  it recomputes on the same formula preparation uses:
--
--      boq_qty = item_qty x (wo line qty + amendment)
--      est_qty = item_qty x (wo line est + amendment)
--
--  The client's work_order_lines.qty is never touched. It is what they
--  signed. The amendment accumulates on the BOQ's own copy of that
--  line, so "contracted 100, amended to 120" can always be shown.
-- =====================================================================

-- accumulated amendment against this work order line
ALTER TABLE boq_wo_lines
  ADD COLUMN var_qty DECIMAL(18,3) NOT NULL DEFAULT 0 AFTER est_qty;

-- an amendment line now names a work order line, not an item.
-- boq_line_id stays, nullable, so amendments raised before this
-- migration still read back.
ALTER TABLE boq_amendment_lines
  ADD COLUMN boq_wo_line_id INT UNSIGNED NULL AFTER amendment_id,
  ADD COLUMN from_qty DECIMAL(18,3) NULL AFTER qty,
  ADD COLUMN to_qty   DECIMAL(18,3) NULL AFTER from_qty,
  MODIFY COLUMN boq_line_id INT UNSIGNED NULL,
  MODIFY COLUMN qty DECIMAL(18,3) NOT NULL,
  ADD KEY ix_bal_bwl (boq_wo_line_id),
  ADD CONSTRAINT fk_bal_bwl FOREIGN KEY (boq_wo_line_id)
      REFERENCES boq_wo_lines (id) ON DELETE CASCADE;

-- a cut is allowed, so the quantity may be negative; it may not be zero
ALTER TABLE boq_amendment_lines DROP CHECK ck_bal_qty;
ALTER TABLE boq_amendment_lines ADD CONSTRAINT ck_bal_qty CHECK (qty <> 0);

-- the effective work order quantity, contracted plus amended, in one
-- place so nothing has to remember to add the two together
CREATE OR REPLACE VIEW v_boq_wo_line AS
SELECT
  bwl.id AS boq_wo_line_id, bwl.boq_id, bwl.wo_line_id,
  wol.sno, wol.description, wol.uom_id, u.code AS uom,
  wol.qty        AS contracted_qty,
  bwl.var_qty,
  (wol.qty + bwl.var_qty) AS effective_qty,
  bwl.est_qty    AS contracted_est,
  (bwl.est_qty + bwl.var_qty) AS effective_est,
  wol.supply_rate, wol.inst_rate, wol.line_total,
  (SELECT COUNT(*) FROM boq_lines bl WHERE bl.boq_wo_line_id = bwl.id) AS item_count
FROM boq_wo_lines bwl
JOIN work_order_lines wol ON wol.id = bwl.wo_line_id
JOIN uoms u ON u.id = wol.uom_id;
