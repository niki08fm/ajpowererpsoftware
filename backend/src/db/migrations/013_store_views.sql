-- =====================================================================
--  What the store can answer.
--
--  In transit is the number that matters here: sent and not yet signed
--  for. It is off the store's books and not yet on the site's, and a
--  system that does not name it is a system where material goes missing
--  without anyone being able to say when.
--
--  Valuation follows the latest purchase rate. A weighted average is
--  more defensible in the abstract, but a store that bought cable at
--  112 last week and 128 this week is going to be asked what the cable
--  on the floor is worth today, and the answer people act on is 128.
--  Both are carried; the screens show the latest.
-- =====================================================================

CREATE OR REPLACE VIEW v_dc_line_status AS
SELECT
  l.id AS dc_line_id, l.dc_id, l.item_id, l.make_id,
  it.code AS item_code, it.name AS item_name, u.code AS uom, mk.name AS make_name,
  l.qty AS sent_qty, l.rate, l.remark,
  COALESCE((SELECT SUM(al.qty) FROM dc_acknowledgement_lines al
             WHERE al.dc_line_id = l.id), 0) AS acked_qty,
  GREATEST(l.qty - COALESCE((SELECT SUM(al.qty) FROM dc_acknowledgement_lines al
             WHERE al.dc_line_id = l.id), 0), 0) AS in_transit_qty,
  ROUND(l.qty * l.rate, 2) AS line_value
FROM delivery_challan_lines l
JOIN items it ON it.id = l.item_id
JOIN uoms  u  ON u.id  = l.uom_id
LEFT JOIN makes mk ON mk.id = l.make_id;

CREATE OR REPLACE VIEW v_dc_status AS
SELECT
  dc.id AS dc_id, dc.doc_no, dc.branch_id, dc.status,
  dc.dc_date, dc.dispatched_at, dc.vehicle_no, dc.driver, dc.note,
  dc.from_site_id, f.name AS from_name, f.code AS from_code,
  dc.to_site_id,   t.name AS to_name,   t.code AS to_code,
  du.name AS dispatched_by_name, cu.name AS created_by_name,
  COUNT(l.dc_line_id)                    AS line_count,
  COALESCE(SUM(l.sent_qty), 0)           AS sent_qty,
  COALESCE(SUM(l.acked_qty), 0)          AS acked_qty,
  COALESCE(SUM(l.in_transit_qty), 0)     AS in_transit_qty,
  COALESCE(SUM(l.line_value), 0)         AS dc_value,
  CASE
    WHEN dc.status = 'DRAFT'     THEN 'DRAFT'
    WHEN dc.status = 'CANCELLED' THEN 'CANCELLED'
    WHEN COALESCE(SUM(l.acked_qty), 0) <= 0            THEN 'IN_TRANSIT'
    WHEN COALESCE(SUM(l.in_transit_qty), 0) <= 0.0005  THEN 'ACKNOWLEDGED'
    ELSE 'PART_ACK'
  END COLLATE utf8mb4_unicode_ci AS state,
  -- how long it has been on the road unaccounted for
  CASE WHEN dc.dispatched_at IS NOT NULL
            AND COALESCE(SUM(l.in_transit_qty), 0) > 0.0005
       THEN DATEDIFF(CURDATE(), DATE(dc.dispatched_at)) ELSE 0 END AS days_out
FROM delivery_challans dc
JOIN sites f ON f.id = dc.from_site_id
JOIN sites t ON t.id = dc.to_site_id
LEFT JOIN users du ON du.id = dc.dispatched_by
LEFT JOIN users cu ON cu.id = dc.created_by
LEFT JOIN v_dc_line_status l ON l.dc_id = dc.id
GROUP BY dc.id;

-- ------------------------------------------------------------- stock
CREATE OR REPLACE VIEW v_stock_balance AS
SELECT
  s.id   AS site_id,
  s.name AS site_name,
  s.code AS site_code,
  s.site_type,
  s.is_central,
  s.branch_id,
  i.id   AS item_id,
  i.code AS item_code,
  i.name AS item_name,
  i.category_id,
  u.code AS uom,
  COALESCE(SUM(m.qty), 0) AS qty,
  CASE WHEN COALESCE(SUM(CASE WHEN m.qty > 0 THEN m.qty END), 0) > 0
       THEN ROUND(SUM(CASE WHEN m.qty > 0 THEN m.qty * m.rate END)
                  / SUM(CASE WHEN m.qty > 0 THEN m.qty END), 2)
       ELSE 0 END AS avg_rate,
  -- what it was last bought at, which is what the store is valued on
  COALESCE((SELECT m2.rate FROM stock_movements m2
             WHERE m2.site_id = s.id AND m2.item_id = i.id
               AND m2.qty > 0 AND m2.rate > 0
             ORDER BY m2.moved_on DESC, m2.id DESC LIMIT 1), 0) AS latest_rate,
  MAX(CASE WHEN m.qty > 0 THEN m.moved_on END) AS last_in,
  MAX(m.moved_on) AS last_moved
FROM stock_movements m
JOIN sites s ON s.id = m.site_id
JOIN items i ON i.id = m.item_id
JOIN uoms  u ON u.id = i.uom_id
GROUP BY s.id, i.id;

-- the ledger as a person reads it: what moved, where, why, and on
-- whose document
CREATE OR REPLACE VIEW v_stock_movement AS
SELECT
  m.id, m.moved_on, m.site_id, s.name AS site_name, s.code AS site_code,
  s.site_type, s.branch_id,
  m.item_id, i.code AS item_code, i.name AS item_name, u.code AS uom,
  m.make_id, mk.name AS make_name,
  m.qty, m.rate, ROUND(ABS(m.qty) * m.rate, 2) AS value,
  m.kind, m.ref_type, m.ref_id, m.ref_no,
  CASE WHEN m.qty > 0 THEN 'IN' ELSE 'OUT' END COLLATE utf8mb4_unicode_ci AS direction,
  us.name AS by_name, m.created_at
FROM stock_movements m
JOIN sites s ON s.id = m.site_id
JOIN items i ON i.id = m.item_id
JOIN uoms  u ON u.id = i.uom_id
LEFT JOIN makes mk ON mk.id = m.make_id
LEFT JOIN users us ON us.id = m.created_by;

-- ------------------------------------------- the indent, once more
-- Received on a purchase order is not the same as arrived at site. An
-- order delivered to the store still has to travel, and until the site
-- signs for it the requirement is not met.
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
  COALESCE(o.direct_qty, 0) + COALESCE(d.acked_qty, 0) AS at_site_qty,
  COALESCE(d.in_transit_qty, 0) AS in_transit_qty,
  GREATEST(r.qty - COALESCE(o.committed_qty, 0), 0) AS to_order_qty,
  GREATEST(r.qty - COALESCE(o.received_qty, 0), 0)  AS to_receive_qty,
  GREATEST(r.qty - COALESCE(o.direct_qty, 0) - COALESCE(d.acked_qty, 0), 0) AS to_deliver_qty
FROM v_indent_rollup r
LEFT JOIN (
  SELECT
    pli.indent_id, pol.item_id,
    SUM(CASE WHEN po.status IN ('SUBMITTED','APPROVED') THEN pli.qty ELSE 0 END) AS committed_qty,
    SUM(CASE WHEN po.status = 'APPROVED'  THEN pli.qty ELSE 0 END) AS ordered_qty,
    SUM(CASE WHEN po.status = 'SUBMITTED' THEN pli.qty ELSE 0 END) AS pending_gm_qty,
    SUM(CASE WHEN po.status = 'APPROVED' AND pol.qty > 0
             THEN ls.received_qty * (pli.qty / pol.qty) ELSE 0 END) AS received_qty,
    -- delivered straight to the site the indent belongs to: no challan
    -- is coming, it is already there
    SUM(CASE WHEN po.status = 'APPROVED' AND pol.qty > 0 AND d2.site_type = 'SITE'
             THEN ls.received_qty * (pli.qty / pol.qty) ELSE 0 END) AS direct_qty
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
    SUM(CASE WHEN dl.qty > 0 THEN dls.acked_qty * (dli.qty / dl.qty) ELSE 0 END) AS acked_qty,
    SUM(CASE WHEN dl.qty > 0 THEN dls.in_transit_qty * (dli.qty / dl.qty) ELSE 0 END) AS in_transit_qty
  FROM dc_line_indents dli
  JOIN delivery_challan_lines dl ON dl.id = dli.dc_line_id
  JOIN delivery_challans dc      ON dc.id = dl.dc_id
  JOIN v_dc_line_status dls      ON dls.dc_line_id = dl.id
  WHERE dc.status IN ('DISPATCHED','PART_ACK','ACKNOWLEDGED')
  GROUP BY dli.indent_id, dl.item_id
) d ON d.indent_id = r.indent_id AND d.item_id = r.item_id;

CREATE OR REPLACE VIEW v_indent_pipeline AS
SELECT
  i.id AS indent_id, i.doc_no, i.site_id, i.branch_id, i.status,
  i.indent_date, i.needed_by,
  COUNT(f.item_id)                    AS item_count,
  COALESCE(SUM(f.indented_qty), 0)    AS indented_qty,
  COALESCE(SUM(f.committed_qty), 0)   AS committed_qty,
  COALESCE(SUM(f.ordered_qty), 0)     AS ordered_qty,
  COALESCE(SUM(f.pending_gm_qty), 0)  AS pending_gm_qty,
  COALESCE(SUM(f.received_qty), 0)    AS received_qty,
  COALESCE(SUM(f.issued_qty), 0)      AS issued_qty,
  COALESCE(SUM(f.at_site_qty), 0)     AS at_site_qty,
  COALESCE(SUM(f.in_transit_qty), 0)  AS in_transit_qty,
  COALESCE(SUM(f.to_order_qty), 0)    AS to_order_qty,
  COALESCE(SUM(f.to_receive_qty), 0)  AS to_receive_qty,
  COALESCE(SUM(f.to_deliver_qty), 0)  AS to_deliver_qty,
  (SELECT COUNT(DISTINCT poi.po_id) FROM purchase_order_indents poi
     JOIN purchase_orders p2 ON p2.id = poi.po_id
    WHERE poi.indent_id = i.id AND p2.status <> 'CANCELLED') AS po_count,
  CASE
    WHEN i.status <> 'APPROVED' THEN 'NOT_APPROVED'
    WHEN COALESCE(SUM(f.at_site_qty), 0) > 0
     AND COALESCE(SUM(f.to_deliver_qty), 0) <= 0.0005 THEN 'AT_SITE'
    WHEN COALESCE(SUM(f.at_site_qty), 0) > 0          THEN 'PART_AT_SITE'
    WHEN COALESCE(SUM(f.in_transit_qty), 0) > 0.0005  THEN 'IN_TRANSIT'
    WHEN COALESCE(SUM(f.received_qty), 0) > 0
     AND COALESCE(SUM(f.to_receive_qty), 0) <= 0.0005 THEN 'AT_STORE'
    WHEN COALESCE(SUM(f.received_qty), 0) > 0         THEN 'PART_RECEIVED'
    WHEN COALESCE(SUM(f.ordered_qty), 0) > 0
     AND COALESCE(SUM(f.to_order_qty), 0) <= 0.0005   THEN 'ORDERED'
    WHEN COALESCE(SUM(f.ordered_qty), 0) > 0          THEN 'PART_ORDERED'
    WHEN COALESCE(SUM(f.pending_gm_qty), 0) > 0       THEN 'PO_WITH_GM'
    ELSE 'AWAITING_PO'
  END COLLATE utf8mb4_unicode_ci AS stage
FROM indents i
LEFT JOIN v_indent_item_flow f ON f.indent_id = i.id
GROUP BY i.id;
