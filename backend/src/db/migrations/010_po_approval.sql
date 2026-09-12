-- =====================================================================
--  A purchase order is signed before it is sent.
--
--  DRAFT      the buyer is building it. Holds nothing.
--  SUBMITTED  with the GM. Holds quantity, so the same requirement
--             cannot be ordered twice while he is looking at it.
--  RETURNED   sent back with a remark. Editable again — resubmit it,
--             or cancel it.
--  APPROVED   signed. This is the moment it goes to the supplier.
--  CANCELLED  dead, and stops holding anything.
--
--  There is no closing an order short. A partly delivered order stays
--  in the delivery pipeline until it is fully received; anything else
--  quietly writes off material somebody is still owed.
-- =====================================================================

-- widen first so the old values survive the update
ALTER TABLE purchase_orders
  MODIFY COLUMN status ENUM('DRAFT','PLACED','CLOSED','CANCELLED',
                            'SUBMITTED','RETURNED','APPROVED') NOT NULL DEFAULT 'DRAFT';
UPDATE purchase_orders SET status = 'APPROVED' WHERE status IN ('PLACED','CLOSED');
ALTER TABLE purchase_orders
  MODIFY COLUMN status ENUM('DRAFT','SUBMITTED','RETURNED','APPROVED','CANCELLED')
    NOT NULL DEFAULT 'DRAFT';

ALTER TABLE purchase_orders
  ADD COLUMN submitted_at DATETIME NULL AFTER status,
  ADD COLUMN decided_at   DATETIME NULL AFTER submitted_at,
  ADD COLUMN decided_by   INT UNSIGNED NULL AFTER decided_at,
  ADD CONSTRAINT fk_po_decided FOREIGN KEY (decided_by) REFERENCES users (id);

-- who did what to it, so a returned order says why
CREATE TABLE po_events (
  id         INT UNSIGNED NOT NULL AUTO_INCREMENT,
  po_id      INT UNSIGNED NOT NULL,
  action     VARCHAR(24)  NOT NULL,   -- SUBMITTED, APPROVED, RETURNED, CANCELLED, EDITED
  user_id    INT UNSIGNED NULL,
  note       VARCHAR(500) NULL,
  created_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY ix_poe_po (po_id),
  CONSTRAINT fk_poe_po   FOREIGN KEY (po_id)   REFERENCES purchase_orders (id) ON DELETE CASCADE,
  CONSTRAINT fk_poe_user FOREIGN KEY (user_id) REFERENCES users (id)
) ENGINE=InnoDB;

-- ------------------------------------------------------- PO, restated
CREATE OR REPLACE VIEW v_po_status AS
SELECT
  po.id AS po_id, po.doc_no, po.branch_id, po.supplier_id, po.status,
  po.po_date, po.expected_date, po.deliver_to_id,
  po.submitted_at, po.decided_at,
  sp.name AS supplier_name,
  d.name  AS deliver_to_name, d.site_type AS deliver_to_type,
  du.name AS decided_by_name,
  COUNT(l.po_line_id)              AS line_count,
  COALESCE(SUM(l.ordered_qty), 0)  AS ordered_qty,
  COALESCE(SUM(l.received_qty), 0) AS received_qty,
  COALESCE(SUM(l.pending_qty), 0)  AS pending_qty,
  COALESCE(SUM(l.total), 0)        AS po_value,
  -- only a signed order is in the delivery pipeline at all
  CASE
    WHEN po.status <> 'APPROVED' THEN 'NOT_SENT'
    WHEN COALESCE(SUM(l.received_qty), 0) <= 0     THEN 'AWAITING'
    WHEN COALESCE(SUM(l.pending_qty), 0)  <= 0.0005 THEN 'RECEIVED'
    ELSE 'PARTIAL'
  END COLLATE utf8mb4_unicode_ci AS receipt_state,
  -- what the buyer's list is sorted and filtered by: one column that
  -- says where it is, whether that is a signature or a delivery
  CASE
    WHEN po.status = 'DRAFT'     THEN 'DRAFT'
    WHEN po.status = 'SUBMITTED' THEN 'AWAITING_GM'
    WHEN po.status = 'RETURNED'  THEN 'RETURNED'
    WHEN po.status = 'CANCELLED' THEN 'CANCELLED'
    WHEN COALESCE(SUM(l.received_qty), 0) <= 0      THEN 'AWAITING'
    WHEN COALESCE(SUM(l.pending_qty), 0)  <= 0.0005 THEN 'RECEIVED'
    ELSE 'PARTIAL'
  END COLLATE utf8mb4_unicode_ci AS stage,
  (po.expected_date IS NOT NULL
    AND po.expected_date < CURDATE()
    AND po.status = 'APPROVED'
    AND COALESCE(SUM(l.pending_qty), 0) > 0.0005) AS overdue
FROM purchase_orders po
JOIN suppliers sp ON sp.id = po.supplier_id
JOIN sites d      ON d.id  = po.deliver_to_id
LEFT JOIN users du ON du.id = po.decided_by
LEFT JOIN v_po_line_status l ON l.po_id = po.id
GROUP BY po.id;

-- ------------------------------------------- the indent, restated
-- Committed is what is spoken for and must not be ordered twice:
-- an order with the GM counts, a draft does not. Ordered is what has
-- actually been signed and sent.
CREATE OR REPLACE VIEW v_indent_item_flow AS
SELECT
  r.indent_id, r.item_id, r.make_id,
  r.item_code, r.item_name, r.uom, r.make_name,
  r.qty AS indented_qty,
  COALESCE(o.committed_qty, 0) AS committed_qty,
  COALESCE(o.ordered_qty, 0)   AS ordered_qty,
  COALESCE(o.pending_gm_qty, 0) AS pending_gm_qty,
  COALESCE(o.received_qty, 0)  AS received_qty,
  GREATEST(r.qty - COALESCE(o.committed_qty, 0), 0) AS to_order_qty,
  GREATEST(r.qty - COALESCE(o.received_qty, 0), 0)  AS to_receive_qty
FROM v_indent_rollup r
LEFT JOIN (
  SELECT
    pli.indent_id,
    pol.item_id,
    SUM(CASE WHEN po.status IN ('SUBMITTED','APPROVED') THEN pli.qty ELSE 0 END) AS committed_qty,
    SUM(CASE WHEN po.status = 'APPROVED'  THEN pli.qty ELSE 0 END) AS ordered_qty,
    SUM(CASE WHEN po.status = 'SUBMITTED' THEN pli.qty ELSE 0 END) AS pending_gm_qty,
    SUM(CASE WHEN po.status = 'APPROVED' AND pol.qty > 0
             THEN ls.received_qty * (pli.qty / pol.qty) ELSE 0 END) AS received_qty
  FROM po_line_indents pli
  JOIN purchase_order_lines pol ON pol.id = pli.po_line_id
  JOIN purchase_orders po       ON po.id  = pol.po_id
  JOIN v_po_line_status ls      ON ls.po_line_id = pol.id
  WHERE po.status IN ('SUBMITTED','APPROVED')
  GROUP BY pli.indent_id, pol.item_id
) o ON o.indent_id = r.indent_id AND o.item_id = r.item_id;

CREATE OR REPLACE VIEW v_indent_pipeline AS
SELECT
  i.id AS indent_id, i.doc_no, i.site_id, i.branch_id, i.status,
  i.indent_date, i.needed_by,
  COUNT(f.item_id)                   AS item_count,
  COALESCE(SUM(f.indented_qty), 0)   AS indented_qty,
  COALESCE(SUM(f.committed_qty), 0)  AS committed_qty,
  COALESCE(SUM(f.ordered_qty), 0)    AS ordered_qty,
  COALESCE(SUM(f.pending_gm_qty), 0) AS pending_gm_qty,
  COALESCE(SUM(f.received_qty), 0)   AS received_qty,
  COALESCE(SUM(f.to_order_qty), 0)   AS to_order_qty,
  COALESCE(SUM(f.to_receive_qty), 0) AS to_receive_qty,
  (SELECT COUNT(DISTINCT poi.po_id)
     FROM purchase_order_indents poi
     JOIN purchase_orders p2 ON p2.id = poi.po_id
    WHERE poi.indent_id = i.id AND p2.status <> 'CANCELLED') AS po_count,
  CASE
    WHEN i.status <> 'APPROVED' THEN 'NOT_APPROVED'
    WHEN COALESCE(SUM(f.received_qty), 0) > 0
     AND COALESCE(SUM(f.to_receive_qty), 0) <= 0.0005      THEN 'RECEIVED'
    WHEN COALESCE(SUM(f.received_qty), 0) > 0              THEN 'PART_RECEIVED'
    WHEN COALESCE(SUM(f.ordered_qty), 0) > 0
     AND COALESCE(SUM(f.to_order_qty), 0) <= 0.0005        THEN 'ORDERED'
    WHEN COALESCE(SUM(f.ordered_qty), 0) > 0               THEN 'PART_ORDERED'
    -- raised, but nobody has signed it yet
    WHEN COALESCE(SUM(f.pending_gm_qty), 0) > 0            THEN 'PO_WITH_GM'
    ELSE 'AWAITING_PO'
  END COLLATE utf8mb4_unicode_ci AS stage
FROM indents i
LEFT JOIN v_indent_item_flow f ON f.indent_id = i.id
GROUP BY i.id;
