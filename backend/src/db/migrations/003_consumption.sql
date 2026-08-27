-- =====================================================================
--  Consumption — what the site actually used.
--
--  This is the end of the spine: a work order line becomes BOQ lines,
--  BOQ lines are indented, and indented material is consumed against
--  the same BOQ line. That one thread is what lets anyone ask "how
--  much of line 1a is left" and get an answer that agrees with every
--  document behind it.
--
--  There is no stock ledger yet (the store side is not built), so what
--  a site may consume is capped by what was approved on its indents.
--  You cannot use what was never asked for.
-- =====================================================================

CREATE TABLE consumptions (
  id          INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  doc_no      VARCHAR(32)   NOT NULL,       -- CON/26-27/0001
  site_id     INT UNSIGNED  NOT NULL,
  branch_id   INT UNSIGNED  NOT NULL,
  boq_id      INT UNSIGNED  NOT NULL,
  used_on     DATE          NOT NULL,
  -- a draft is a working note; only CONFIRMED counts as consumed
  status      ENUM('DRAFT','CONFIRMED') NOT NULL DEFAULT 'DRAFT',
  note        VARCHAR(300)  NULL,
  recorded_by INT UNSIGNED  NULL,
  created_at  TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_con_doc (doc_no),
  KEY ix_con_site (site_id, status),
  KEY ix_con_boq (boq_id),
  CONSTRAINT fk_con_site FOREIGN KEY (site_id)     REFERENCES sites (id),
  CONSTRAINT fk_con_br   FOREIGN KEY (branch_id)   REFERENCES branches (id),
  CONSTRAINT fk_con_boq  FOREIGN KEY (boq_id)      REFERENCES boqs (id),
  CONSTRAINT fk_con_by   FOREIGN KEY (recorded_by) REFERENCES users (id)
) ENGINE=InnoDB;

CREATE TABLE consumption_lines (
  id             INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  consumption_id INT UNSIGNED  NOT NULL,
  boq_line_id    INT UNSIGNED  NOT NULL,
  item_id        INT UNSIGNED  NOT NULL,
  qty            DECIMAL(18,3) NOT NULL,
  remark         VARCHAR(300)  NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_conl (consumption_id, boq_line_id),
  KEY ix_conl_boql (boq_line_id),
  CONSTRAINT fk_conl_con  FOREIGN KEY (consumption_id) REFERENCES consumptions (id) ON DELETE CASCADE,
  CONSTRAINT fk_conl_boql FOREIGN KEY (boq_line_id)    REFERENCES boq_lines (id),
  CONSTRAINT fk_conl_item FOREIGN KEY (item_id)        REFERENCES items (id),
  CONSTRAINT ck_conl_qty  CHECK (qty > 0)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- The movement view gains consumption, so every quantity on a BOQ line
-- still comes from the documents that caused it.
-- ---------------------------------------------------------------------
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
             WHERE il.boq_line_id = bl.id AND i.status IN ('APPROVED','SUBMITTED')), 0) AS committed_qty,
  COALESCE((SELECT SUM(cl.qty) FROM consumption_lines cl
              JOIN consumptions c ON c.id = cl.consumption_id
             WHERE cl.boq_line_id = bl.id AND c.status = 'CONFIRMED'), 0) AS consumed_qty
FROM boq_lines bl;

CREATE OR REPLACE VIEW v_boq_line_status AS
SELECT
  bl.id AS boq_line_id, bl.boq_id, b.site_id, b.branch_id,
  b.status AS boq_status, b.over_allow, b.over_pct,
  bwl.wo_line_id, wol.sno AS wo_sno, wol.description AS wo_description,
  bl.sno, bl.item_id, it.code AS item_code, it.name AS item_name,
  bl.make_id, mk.name AS make_name, u.code AS uom,
  bl.item_qty, bl.boq_qty, bl.est_qty, bl.var_qty,
  (bl.est_qty + bl.var_qty) AS effective_est,
  m.approved_qty, m.pending_qty, m.committed_qty, m.consumed_qty,
  (bl.est_qty + bl.var_qty - m.committed_qty) AS balance,
  -- what is at site to use: approved on indents, less what is used
  (m.approved_qty - m.consumed_qty) AS available_qty,
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

-- How far each site has got: indented, and how much of it is used.
CREATE OR REPLACE VIEW v_site_progress AS
SELECT
  b.site_id,
  b.id AS boq_id,
  COUNT(s.boq_line_id)                       AS boq_lines,
  COALESCE(SUM(s.effective_est), 0)          AS estimated_qty,
  COALESCE(SUM(s.approved_qty), 0)           AS indented_qty,
  COALESCE(SUM(s.consumed_qty), 0)           AS consumed_qty,
  COALESCE(SUM(s.approved_qty - s.consumed_qty), 0) AS at_site_qty,
  COALESCE(SUM(CASE WHEN s.over_qty > 0 THEN 1 ELSE 0 END), 0) AS over_lines
FROM boqs b
LEFT JOIN v_boq_line_status s ON s.boq_id = b.id
GROUP BY b.id;
