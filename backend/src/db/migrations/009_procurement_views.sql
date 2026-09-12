-- =====================================================================
--  What is ordered, what has arrived, what is still owed — all derived.
--
--  One purchase order can fill several indents, so the quantity on a PO
--  line is split across the indents it answers. That split is recorded
--  rather than guessed: the buyer is the one deciding which indents an
--  order fills, and a stored allocation makes every question below a
--  join instead of an argument.
--
--  Receipts follow the same split in proportion — half a line received
--  is half of each indent's share received.
-- =====================================================================

CREATE TABLE po_line_indents (
  po_line_id INT UNSIGNED  NOT NULL,
  indent_id  INT UNSIGNED  NOT NULL,
  qty        DECIMAL(18,3) NOT NULL,
  PRIMARY KEY (po_line_id, indent_id),
  KEY ix_pli_ind (indent_id),
  CONSTRAINT fk_pli_pol FOREIGN KEY (po_line_id) REFERENCES purchase_order_lines (id) ON DELETE CASCADE,
  CONSTRAINT fk_pli_ind FOREIGN KEY (indent_id)  REFERENCES indents (id),
  CONSTRAINT ck_pli_qty CHECK (qty > 0)
) ENGINE=InnoDB;

-- ------------------------------------------------------------- stock
-- Opening balance plus every movement since. Never written down.
CREATE OR REPLACE VIEW v_stock_balance AS
SELECT
  s.id   AS site_id,
  s.name AS site_name,
  s.site_type,
  s.is_central,
  i.id   AS item_id,
  i.code AS item_code,
  i.name AS item_name,
  u.code AS uom,
  COALESCE(SUM(m.qty), 0) AS qty,
  -- what the stock on hand actually cost: weighted over what came in
  CASE WHEN COALESCE(SUM(CASE WHEN m.qty > 0 THEN m.qty END), 0) > 0
       THEN ROUND(SUM(CASE WHEN m.qty > 0 THEN m.qty * m.rate END)
                  / SUM(CASE WHEN m.qty > 0 THEN m.qty END), 2)
       ELSE 0 END AS avg_rate,
  MAX(CASE WHEN m.qty > 0 THEN m.moved_on END) AS last_in
FROM stock_movements m
JOIN sites s ON s.id = m.site_id
JOIN items i ON i.id = m.item_id
JOIN uoms  u ON u.id = i.uom_id
GROUP BY s.id, i.id;

-- ------------------------------------------------------ PO progress
CREATE OR REPLACE VIEW v_po_line_status AS
SELECT
  pol.id AS po_line_id, pol.po_id, pol.item_id, pol.make_id,
  it.code AS item_code, it.name AS item_name, u.code AS uom, mk.name AS make_name,
  pol.qty AS ordered_qty, pol.rate, pol.gst_rate, pol.basic, pol.gst_amt, pol.total,
  COALESCE((SELECT SUM(gl.qty) FROM goods_receipt_lines gl
              JOIN goods_receipts g ON g.id = gl.grn_id
             WHERE gl.po_line_id = pol.id AND g.status = 'CONFIRMED'), 0) AS received_qty,
  GREATEST(pol.qty - COALESCE((SELECT SUM(gl.qty) FROM goods_receipt_lines gl
              JOIN goods_receipts g ON g.id = gl.grn_id
             WHERE gl.po_line_id = pol.id AND g.status = 'CONFIRMED'), 0), 0) AS pending_qty
FROM purchase_order_lines pol
JOIN items it  ON it.id = pol.item_id
JOIN uoms  u   ON u.id  = pol.uom_id
LEFT JOIN makes mk ON mk.id = pol.make_id;

CREATE OR REPLACE VIEW v_po_status AS
SELECT
  po.id AS po_id, po.doc_no, po.branch_id, po.supplier_id, po.status,
  po.po_date, po.expected_date, po.deliver_to_id,
  sp.name AS supplier_name,
  d.name  AS deliver_to_name, d.site_type AS deliver_to_type,
  COUNT(l.po_line_id)                      AS line_count,
  COALESCE(SUM(l.ordered_qty), 0)          AS ordered_qty,
  COALESCE(SUM(l.received_qty), 0)         AS received_qty,
  COALESCE(SUM(l.pending_qty), 0)          AS pending_qty,
  COALESCE(SUM(l.total), 0)                AS po_value,
  CASE
    WHEN po.status = 'DRAFT'     THEN 'DRAFT'
    WHEN po.status = 'CANCELLED' THEN 'CANCELLED'
    WHEN po.status = 'CLOSED'    THEN 'CLOSED'
    WHEN COALESCE(SUM(l.received_qty), 0) <= 0                  THEN 'AWAITING'
    WHEN COALESCE(SUM(l.pending_qty), 0)  <= 0                  THEN 'RECEIVED'
    ELSE 'PARTIAL'
  END COLLATE utf8mb4_unicode_ci AS receipt_state,
  (po.expected_date IS NOT NULL
    AND po.expected_date < CURDATE()
    AND COALESCE(SUM(l.pending_qty), 0) > 0
    AND po.status = 'PLACED') AS overdue
FROM purchase_orders po
JOIN suppliers sp ON sp.id = po.supplier_id
JOIN sites d      ON d.id  = po.deliver_to_id
LEFT JOIN v_po_line_status l ON l.po_id = po.id
GROUP BY po.id;

-- --------------------------------------------- one indent, item by item
-- Indented is the roll-up. Ordered is this indent's share of the PO
-- lines that answer it. Received is that share of what has arrived.
CREATE OR REPLACE VIEW v_indent_item_flow AS
SELECT
  r.indent_id,
  r.item_id,
  r.make_id,
  r.item_code, r.item_name, r.uom, r.make_name,
  r.qty AS indented_qty,
  COALESCE(o.ordered_qty, 0)  AS ordered_qty,
  COALESCE(o.received_qty, 0) AS received_qty,
  GREATEST(r.qty - COALESCE(o.ordered_qty, 0), 0)  AS to_order_qty,
  GREATEST(r.qty - COALESCE(o.received_qty, 0), 0) AS to_receive_qty
FROM v_indent_rollup r
LEFT JOIN (
  SELECT
    pli.indent_id,
    pol.item_id,
    SUM(pli.qty) AS ordered_qty,
    -- this indent's share of the line, applied to what has arrived
    SUM(CASE WHEN pol.qty > 0
             THEN ls.received_qty * (pli.qty / pol.qty) ELSE 0 END) AS received_qty
  FROM po_line_indents pli
  JOIN purchase_order_lines pol ON pol.id = pli.po_line_id
  JOIN purchase_orders po       ON po.id  = pol.po_id
  JOIN v_po_line_status ls      ON ls.po_line_id = pol.id
  WHERE po.status <> 'CANCELLED'
  GROUP BY pli.indent_id, pol.item_id
) o ON o.indent_id = r.indent_id AND o.item_id = r.item_id;

-- ------------------------------------- the bar the site team follows
-- APPROVED -> ORDERED (part or full) -> RECEIVED (part or full)
CREATE OR REPLACE VIEW v_indent_pipeline AS
SELECT
  i.id AS indent_id, i.doc_no, i.site_id, i.branch_id, i.status,
  i.indent_date, i.needed_by,
  COUNT(f.item_id)                        AS item_count,
  COALESCE(SUM(f.indented_qty), 0)        AS indented_qty,
  COALESCE(SUM(f.ordered_qty), 0)         AS ordered_qty,
  COALESCE(SUM(f.received_qty), 0)        AS received_qty,
  COALESCE(SUM(f.to_order_qty), 0)        AS to_order_qty,
  COALESCE(SUM(f.to_receive_qty), 0)      AS to_receive_qty,
  (SELECT COUNT(DISTINCT poi.po_id) FROM purchase_order_indents poi
    WHERE poi.indent_id = i.id)           AS po_count,
  CASE
    WHEN i.status <> 'APPROVED' THEN 'NOT_APPROVED'
    WHEN COALESCE(SUM(f.received_qty), 0) > 0
     AND COALESCE(SUM(f.to_receive_qty), 0) <= 0.0005 THEN 'RECEIVED'
    WHEN COALESCE(SUM(f.received_qty), 0) > 0         THEN 'PART_RECEIVED'
    WHEN COALESCE(SUM(f.ordered_qty), 0) > 0
     AND COALESCE(SUM(f.to_order_qty), 0) <= 0.0005   THEN 'ORDERED'
    WHEN COALESCE(SUM(f.ordered_qty), 0) > 0          THEN 'PART_ORDERED'
    ELSE 'AWAITING_PO'
  END COLLATE utf8mb4_unicode_ci AS stage
FROM indents i
LEFT JOIN v_indent_item_flow f ON f.indent_id = i.id
GROUP BY i.id;
