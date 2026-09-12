-- =====================================================================
--  The goods receipt as a document in its own right.
--
--  Until now a GRN existed only as a consequence of a purchase order —
--  you could see it from the order it answered and nowhere else. But
--  the store's own question is not "what came against PO 41", it is
--  "what arrived last Tuesday, on whose challan, and who signed it in".
--  That question needs a register.
--
--  Nothing here stores a number. A receipt's value is its lines priced
--  at what the order agreed; the stock it created is the movements it
--  wrote. Both are read back, never written down.
-- =====================================================================

CREATE OR REPLACE VIEW v_grn_line AS
SELECT
  gl.id         AS grn_line_id,
  gl.grn_id,
  gl.po_line_id,
  gl.qty,
  gl.remark,
  pol.item_id, pol.make_id, pol.uom_id,
  pol.rate, pol.gst_rate,
  it.code AS item_code, it.name AS item_name,
  u.code  AS uom,       mk.name AS make_name,
  pol.qty AS ordered_qty,
  -- everything this order line has had against it, this receipt included
  COALESCE((SELECT SUM(x.qty) FROM goods_receipt_lines x
             JOIN goods_receipts xg ON xg.id = x.grn_id
            WHERE x.po_line_id = gl.po_line_id AND xg.status = 'CONFIRMED'), 0)
    AS received_qty,
  ROUND(gl.qty * pol.rate, 2)                            AS basic,
  ROUND(gl.qty * pol.rate * pol.gst_rate / 100, 2)       AS gst_amt,
  ROUND(gl.qty * pol.rate * (1 + pol.gst_rate / 100), 2) AS line_value
FROM goods_receipt_lines gl
JOIN purchase_order_lines pol ON pol.id = gl.po_line_id
JOIN items it ON it.id = pol.item_id
JOIN uoms  u  ON u.id  = pol.uom_id
LEFT JOIN makes mk ON mk.id = pol.make_id;

CREATE OR REPLACE VIEW v_grn_status AS
SELECT
  g.id AS grn_id, g.doc_no, g.receipt_date, g.status, g.supplier_dc, g.note, g.created_at,
  g.po_id, po.doc_no AS po_no, po.po_date, po.expected_date, po.branch_id,
  po.supplier_id, sup.name AS supplier_name,
  g.received_at AS site_id, st.name AS site_name, st.code AS site_code,
  st.site_type, st.is_central,
  ru.name AS received_by_name,
  COUNT(l.grn_line_id)              AS line_count,
  COALESCE(SUM(l.qty), 0)           AS grn_qty,
  COALESCE(SUM(l.basic), 0)         AS grn_basic,
  COALESCE(SUM(l.gst_amt), 0)       AS grn_gst,
  COALESCE(SUM(l.line_value), 0)    AS grn_value,
  -- how late it turned up against the date the order asked for
  CASE WHEN po.expected_date IS NOT NULL AND g.receipt_date > po.expected_date
       THEN DATEDIFF(g.receipt_date, po.expected_date) ELSE 0 END AS days_late,
  -- a receipt that is drafted has not put anything on a shelf
  CASE WHEN g.status = 'DRAFT' THEN 'DRAFT' ELSE 'IN_STOCK' END
    COLLATE utf8mb4_unicode_ci AS stock_state
FROM goods_receipts g
JOIN purchase_orders po ON po.id = g.po_id
JOIN suppliers sup      ON sup.id = po.supplier_id
JOIN sites st           ON st.id = g.received_at
LEFT JOIN users ru      ON ru.id = g.received_by
LEFT JOIN v_grn_line l  ON l.grn_id = g.id
GROUP BY g.id;
