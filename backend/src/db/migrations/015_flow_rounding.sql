-- =====================================================================
--  Proportional splits, rounded where quantities are rounded.
--
--  One purchase order line answers several PRNs, so what a PRN has
--  received is its share of what the line received — a multiplication
--  by a fraction. 35 sent against a 15/20 split gives 14.999999, and a
--  screen that tells a storekeeper 14.999999 boxes are on the road is
--  simply wrong, however defensible the arithmetic.
--
--  Quantities are DECIMAL(18,3) everywhere else. The splits round to
--  match, and a requirement is met when it is within half a thousandth
--  of met, which is what the 0.0005 comparisons have always meant.
-- =====================================================================

CREATE OR REPLACE VIEW v_indent_item_flow AS
SELECT
  r.indent_id, r.item_id, r.make_id,
  r.item_code, r.item_name, r.uom, r.make_name,
  r.qty AS indented_qty,
  COALESCE(o.committed_qty, 0)  AS committed_qty,
  COALESCE(o.ordered_qty, 0)    AS ordered_qty,
  COALESCE(o.pending_gm_qty, 0) AS pending_gm_qty,
  COALESCE(o.received_qty, 0)   AS received_qty,
  COALESCE(d.sent_qty, 0)       AS issued_qty,
  -- at site = whatever a PO put there directly, plus whatever a
  -- challan has been signed for
  ROUND(COALESCE(o.direct_qty, 0) + COALESCE(d.acked_qty, 0), 3) AS at_site_qty,
  COALESCE(d.in_transit_qty, 0) AS in_transit_qty,
  GREATEST(ROUND(r.qty - COALESCE(o.committed_qty, 0), 3), 0) AS to_order_qty,
  GREATEST(ROUND(r.qty - COALESCE(o.received_qty, 0), 3), 0)  AS to_receive_qty,
  GREATEST(ROUND(r.qty - COALESCE(o.direct_qty, 0) - COALESCE(d.acked_qty, 0), 3), 0)
    AS to_deliver_qty
FROM v_indent_rollup r
LEFT JOIN (
  SELECT
    pli.indent_id, pol.item_id,
    SUM(CASE WHEN po.status IN ('SUBMITTED','APPROVED') THEN pli.qty ELSE 0 END) AS committed_qty,
    SUM(CASE WHEN po.status = 'APPROVED'  THEN pli.qty ELSE 0 END) AS ordered_qty,
    SUM(CASE WHEN po.status = 'SUBMITTED' THEN pli.qty ELSE 0 END) AS pending_gm_qty,
    ROUND(SUM(CASE WHEN po.status = 'APPROVED' AND pol.qty > 0
             THEN ls.received_qty * (pli.qty / pol.qty) ELSE 0 END), 3) AS received_qty,
    -- delivered straight to the site the indent belongs to: no challan
    -- is coming, it is already there
    ROUND(SUM(CASE WHEN po.status = 'APPROVED' AND pol.qty > 0 AND d2.site_type = 'SITE'
             THEN ls.received_qty * (pli.qty / pol.qty) ELSE 0 END), 3) AS direct_qty
  FROM po_line_indents pli
  JOIN purchase_order_lines pol ON pol.id = pli.po_line_id
  JOIN purchase_orders po       ON po.id  = pol.po_id
  JOIN sites d2                 ON d2.id  = po.deliver_to_id
  JOIN v_po_line_status ls      ON ls.po_line_id = pol.id
  WHERE po.status IN ('SUBMITTED','APPROVED')
  GROUP BY pli.indent_id, pol.item_id
) o ON o.indent_id = r.indent_id AND o.item_id = r.item_id
LEFT JOIN (
  SELECT
    dli.indent_id, dl.item_id,
    SUM(dli.qty) AS sent_qty,
    ROUND(SUM(CASE WHEN dl.qty > 0
              THEN dls.acked_qty * (dli.qty / dl.qty) ELSE 0 END), 3) AS acked_qty,
    ROUND(SUM(CASE WHEN dl.qty > 0
              THEN dls.in_transit_qty * (dli.qty / dl.qty) ELSE 0 END), 3) AS in_transit_qty
  FROM dc_line_indents dli
  JOIN delivery_challan_lines dl ON dl.id = dli.dc_line_id
  JOIN delivery_challans dc      ON dc.id = dl.dc_id
  JOIN v_dc_line_status dls      ON dls.dc_line_id = dl.id
  WHERE dc.status IN ('DISPATCHED','PART_ACK','ACKNOWLEDGED')
  GROUP BY dli.indent_id, dl.item_id
) d ON d.indent_id = r.indent_id AND d.item_id = r.item_id;
