-- =====================================================================
--  SOURCING A PRN FROM ANOTHER SITE
--
--  A site raises a PRN. The central store looks at it, hasn't got the
--  material, and knows another site is sitting on it. Rather than buy
--  it again, the store asks that site to send it straight across.
--
--  The store is the only party that may ask. Sites do not trade with
--  each other directly — the store decides what moves, because the
--  store is what knows where everything is.
--
--    TR  transfer request — the store asks site A to send to site B,
--                           against B's PRN
--
--  Site A accepts, then writes an ORDINARY delivery challan. Site B
--  acknowledges it in the ordinary way: to B this is simply its PRN
--  arriving, and there is nothing new on that end to learn.
--
--  Two accounting rules hold this together, and both are about not
--  counting the same material twice.
--
--  1. The material never touches the central store, so it never
--     appears in the central store's stock ledger. That already falls
--     out of the schema: a challan writes DC_OUT against from_site_id
--     and DC_IN against to_site_id, and neither of those is the store.
--
--  2. Site A has now given away material it indented for its own work,
--     and will want it replaced. That replacement PRN is a real
--     requirement on the store and must be fulfilled — but it is NOT a
--     fresh claim on site A's work order. Site A already indented that
--     cable once. Counting it again would overstate the BOQ, invite a
--     spurious amendment, and double the ceiling on what A may invoice.
--
--     So an indent gains a kind. DEMAND is everything that came
--     before. REPLACEMENT is a reorder of lent material, and the two
--     views that answer "how much has been indented" refuse to see it.
--     Everything that answers "what still has to be delivered" sees it
--     perfectly well, because somebody does have to send it.
-- =====================================================================

SET FOREIGN_KEY_CHECKS = 0;

-- ------------------------------------------------- the request itself
CREATE TABLE transfer_requests (
  id            INT UNSIGNED NOT NULL AUTO_INCREMENT,
  doc_no        VARCHAR(32)  NOT NULL,       -- TR/26-27/0001
  branch_id     INT UNSIGNED NOT NULL,
  store_id      INT UNSIGNED NOT NULL,       -- the central store that asked
  from_site_id  INT UNSIGNED NOT NULL,       -- asked to send; holds the stock
  to_site_id    INT UNSIGNED NOT NULL,       -- where it goes; owns the PRN
  -- the PRN being sourced. Always present: this document exists only
  -- because a site asked for something and the store chose to answer
  -- it from somewhere other than its own shelf.
  indent_id     INT UNSIGNED NOT NULL,
  request_date  DATE         NOT NULL,
  needed_by     DATE         NULL,
  status        ENUM('SUBMITTED','ACCEPTED','REJECTED','CANCELLED')
                NOT NULL DEFAULT 'SUBMITTED',
  note          VARCHAR(400) NULL,
  decided_at    DATETIME     NULL,
  decided_by    INT UNSIGNED NULL,
  decide_note   VARCHAR(400) NULL,
  raised_by     INT UNSIGNED NULL,
  created_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_tr_doc (doc_no),
  KEY ix_tr_from (from_site_id, status),
  KEY ix_tr_to (to_site_id, status),
  KEY ix_tr_store (store_id, status),
  KEY ix_tr_indent (indent_id),
  CONSTRAINT fk_tr_branch  FOREIGN KEY (branch_id)    REFERENCES branches (id),
  CONSTRAINT fk_tr_store   FOREIGN KEY (store_id)     REFERENCES sites (id),
  CONSTRAINT fk_tr_from    FOREIGN KEY (from_site_id) REFERENCES sites (id),
  CONSTRAINT fk_tr_to      FOREIGN KEY (to_site_id)   REFERENCES sites (id),
  CONSTRAINT fk_tr_indent  FOREIGN KEY (indent_id)    REFERENCES indents (id),
  CONSTRAINT fk_tr_decided FOREIGN KEY (decided_by)   REFERENCES users (id),
  CONSTRAINT fk_tr_by      FOREIGN KEY (raised_by)    REFERENCES users (id),
  CONSTRAINT ck_tr_diff    CHECK (from_site_id <> to_site_id)
) ENGINE=InnoDB;

CREATE TABLE transfer_request_lines (
  id      INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  tr_id   INT UNSIGNED  NOT NULL,
  item_id INT UNSIGNED  NOT NULL,
  make_id INT UNSIGNED  NULL,
  uom_id  INT UNSIGNED  NOT NULL,
  qty     DECIMAL(18,3) NOT NULL,
  remark  VARCHAR(300)  NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_trl (tr_id, item_id, make_id),
  KEY ix_trl_item (item_id),
  CONSTRAINT fk_trl_tr   FOREIGN KEY (tr_id)   REFERENCES transfer_requests (id) ON DELETE CASCADE,
  CONSTRAINT fk_trl_item FOREIGN KEY (item_id) REFERENCES items (id),
  CONSTRAINT fk_trl_make FOREIGN KEY (make_id) REFERENCES makes (id),
  CONSTRAINT fk_trl_uom  FOREIGN KEY (uom_id)  REFERENCES uoms (id),
  CONSTRAINT ck_trl_qty  CHECK (qty > 0)
) ENGINE=InnoDB;

CREATE TABLE tr_events (
  id         INT UNSIGNED NOT NULL AUTO_INCREMENT,
  tr_id      INT UNSIGNED NOT NULL,
  action     VARCHAR(24)  NOT NULL,   -- RAISED ACCEPTED REJECTED CANCELLED
  user_id    INT UNSIGNED NULL,
  note       VARCHAR(500) NULL,
  created_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY ix_tre_tr (tr_id),
  CONSTRAINT fk_tre_tr   FOREIGN KEY (tr_id)   REFERENCES transfer_requests (id) ON DELETE CASCADE,
  CONSTRAINT fk_tre_user FOREIGN KEY (user_id) REFERENCES users (id)
) ENGINE=InnoDB;

-- which request a challan line answers — the same shape as
-- dc_line_indents, because it is the same idea
CREATE TABLE dc_line_trs (
  dc_line_id INT UNSIGNED  NOT NULL,
  tr_id      INT UNSIGNED  NOT NULL,
  qty        DECIMAL(18,3) NOT NULL,
  PRIMARY KEY (dc_line_id, tr_id),
  KEY ix_dclt_tr (tr_id),
  CONSTRAINT fk_dclt_line FOREIGN KEY (dc_line_id) REFERENCES delivery_challan_lines (id) ON DELETE CASCADE,
  CONSTRAINT fk_dclt_tr   FOREIGN KEY (tr_id)      REFERENCES transfer_requests (id),
  CONSTRAINT ck_dclt_qty  CHECK (qty > 0)
) ENGINE=InnoDB;

-- ------------------------------------------- an indent gains a kind
ALTER TABLE indents
  ADD COLUMN kind ENUM('DEMAND','REPLACEMENT') NOT NULL DEFAULT 'DEMAND' AFTER boq_id,
  ADD KEY ix_ind_kind (site_id, kind, status);

SET FOREIGN_KEY_CHECKS = 1;

-- =====================================================================
--  The two views that answer "how much has been indented"
--
--  Restated so they cannot see a replacement. This is the whole of the
--  no-double-counting rule: everything downstream that matters —
--  v_boq_line_status, the BOQ balance, the amendment trigger,
--  v_wo_line_indented and through it the billing ceiling — is built on
--  these two and inherits the exclusion without knowing about it.
--
--  Nothing that answers "what still has to be delivered" is touched.
--  v_indent_rollup, v_indent_item_flow and v_indent_pipeline all see
--  replacements in full, because a replacement is a real requirement
--  and somebody really does have to send it.
-- =====================================================================
CREATE OR REPLACE VIEW v_boq_item_indented AS
SELECT
  bl.boq_id,
  bl.item_id,
  COALESCE(SUM(CASE WHEN i.status = 'APPROVED'  THEN il.qty END), 0) AS approved_qty,
  COALESCE(SUM(CASE WHEN i.status = 'SUBMITTED' THEN il.qty END), 0) AS pending_qty,
  COALESCE(SUM(CASE WHEN i.status IN ('APPROVED','SUBMITTED') THEN il.qty END), 0) AS indented_qty
FROM boq_lines bl
LEFT JOIN indent_lines il ON il.boq_line_id = bl.id
LEFT JOIN indents i       ON i.id = il.indent_id AND i.kind = 'DEMAND'
GROUP BY bl.boq_id, bl.item_id;

CREATE OR REPLACE VIEW v_boq_line_movement AS
SELECT
  bl.id AS boq_line_id,
  COALESCE((SELECT SUM(il.qty) FROM indent_lines il
              JOIN indents i ON i.id = il.indent_id
             WHERE il.boq_line_id = bl.id AND i.status = 'APPROVED'
               AND i.kind = 'DEMAND'), 0)  AS approved_qty,
  COALESCE((SELECT SUM(il.qty) FROM indent_lines il
              JOIN indents i ON i.id = il.indent_id
             WHERE il.boq_line_id = bl.id AND i.status = 'SUBMITTED'
               AND i.kind = 'DEMAND'), 0) AS pending_qty,
  COALESCE((SELECT SUM(il.qty) FROM indent_lines il
              JOIN indents i ON i.id = il.indent_id
             WHERE il.boq_line_id = bl.id AND i.status IN ('APPROVED','SUBMITTED')
               AND i.kind = 'DEMAND'), 0) AS committed_qty
FROM boq_lines bl;

-- ------------------------------------------------- request line status
CREATE OR REPLACE VIEW v_tr_line_status AS
SELECT
  l.id AS tr_line_id, l.tr_id, l.item_id, l.make_id,
  it.code AS item_code, it.name AS item_name,
  u.code AS uom, mk.name AS make_name,
  l.qty AS requested_qty,
  COALESCE(s.sent_qty, 0)  AS sent_qty,
  COALESCE(s.acked_qty, 0) AS acked_qty,
  GREATEST(l.qty - COALESCE(s.sent_qty, 0), 0) AS pending_qty,
  l.remark
FROM transfer_request_lines l
JOIN items it      ON it.id = l.item_id
JOIN uoms u        ON u.id  = l.uom_id
LEFT JOIN makes mk ON mk.id = l.make_id
LEFT JOIN (
  SELECT dt.tr_id, dl.item_id,
         SUM(dt.qty) AS sent_qty,
         SUM(CASE WHEN dl.qty > 0 THEN dls.acked_qty * (dt.qty / dl.qty) ELSE 0 END) AS acked_qty
    FROM dc_line_trs dt
    JOIN delivery_challan_lines dl ON dl.id = dt.dc_line_id
    JOIN delivery_challans dc      ON dc.id = dl.dc_id
    JOIN v_dc_line_status dls      ON dls.dc_line_id = dl.id
   WHERE dc.status IN ('DISPATCHED', 'PART_ACK', 'ACKNOWLEDGED')
   GROUP BY dt.tr_id, dl.item_id
) s ON s.tr_id = l.tr_id AND s.item_id = l.item_id;

CREATE OR REPLACE VIEW v_tr_status AS
SELECT
  r.id AS tr_id, r.doc_no, r.branch_id, r.status, r.store_id,
  r.from_site_id, f.name AS from_name, f.code AS from_code,
  r.to_site_id,   t.name AS to_name,   t.code AS to_code,
  r.indent_id, i.doc_no AS indent_no, i.needed_by AS indent_needed_by,
  r.request_date, r.needed_by, r.note,
  r.decided_at, r.decide_note, du.name AS decided_by_name, ru.name AS raised_by_name,
  COUNT(l.tr_line_id)               AS line_count,
  COALESCE(SUM(l.requested_qty), 0) AS requested_qty,
  COALESCE(SUM(l.sent_qty), 0)      AS sent_qty,
  COALESCE(SUM(l.acked_qty), 0)     AS acked_qty,
  COALESCE(SUM(l.pending_qty), 0)   AS pending_qty,
  CASE WHEN r.needed_by IS NOT NULL AND r.needed_by < CURDATE()
            AND COALESCE(SUM(l.pending_qty), 0) > 0.0005
       THEN DATEDIFF(CURDATE(), r.needed_by) ELSE 0 END AS days_late,
  CASE
    WHEN r.status = 'CANCELLED' THEN 'CANCELLED'
    WHEN r.status = 'REJECTED'  THEN 'REJECTED'
    WHEN r.status = 'SUBMITTED' THEN 'AWAITING'
    WHEN COALESCE(SUM(l.sent_qty), 0) <= 0.0005   THEN 'TO_SEND'
    WHEN COALESCE(SUM(l.pending_qty), 0) > 0.0005 THEN 'PART_SENT'
    WHEN COALESCE(SUM(l.acked_qty), 0)
         >= COALESCE(SUM(l.sent_qty), 0) - 0.0005 THEN 'COMPLETE'
    ELSE 'IN_TRANSIT'
  END COLLATE utf8mb4_unicode_ci AS state
FROM transfer_requests r
JOIN sites f       ON f.id = r.from_site_id
JOIN sites t       ON t.id = r.to_site_id
JOIN indents i     ON i.id = r.indent_id
LEFT JOIN users du ON du.id = r.decided_by
LEFT JOIN users ru ON ru.id = r.raised_by
LEFT JOIN v_tr_line_status l ON l.tr_id = r.id
GROUP BY r.id;

-- =====================================================================
--  What a site has lent out, and how much of it it has got back on
--  order
--
--  Only material that left on a TRANSFER challan counts. Material
--  issued to a person on this site was spent doing this site's own
--  work; it is gone because the job consumed it, not because somebody
--  borrowed it, and reordering it would be a fresh claim on the work
--  order rather than a replacement.
-- =====================================================================
CREATE OR REPLACE VIEW v_site_lent_out AS
SELECT
  x.site_id, x.item_id,
  it.code AS item_code, it.name AS item_name, u.code AS uom,
  x.lent_qty,
  COALESCE(r.reordered_qty, 0) AS reordered_qty,
  GREATEST(x.lent_qty - COALESCE(r.reordered_qty, 0), 0) AS to_reorder_qty,
  x.last_sent_on, x.challan_count
FROM (
  SELECT dc.from_site_id AS site_id, dl.item_id,
         SUM(dt.qty)               AS lent_qty,
         MAX(dc.dc_date)           AS last_sent_on,
         COUNT(DISTINCT dc.id)     AS challan_count
    FROM dc_line_trs dt
    JOIN delivery_challan_lines dl ON dl.id = dt.dc_line_id
    JOIN delivery_challans dc      ON dc.id = dl.dc_id
   WHERE dc.status IN ('DISPATCHED', 'PART_ACK', 'ACKNOWLEDGED')
   GROUP BY dc.from_site_id, dl.item_id
) x
JOIN items it ON it.id = x.item_id
JOIN uoms u   ON u.id  = it.uom_id
LEFT JOIN (
  -- everything already asked for back, whatever stage it has reached.
  -- A cancelled or refused reorder frees the quantity up again.
  SELECT i.site_id, il.item_id, SUM(il.qty) AS reordered_qty
    FROM indent_lines il
    JOIN indents i ON i.id = il.indent_id
   WHERE i.kind = 'REPLACEMENT' AND i.status IN ('DRAFT', 'SUBMITTED', 'APPROVED')
   GROUP BY i.site_id, il.item_id
) r ON r.site_id = x.site_id AND r.item_id = x.item_id;
