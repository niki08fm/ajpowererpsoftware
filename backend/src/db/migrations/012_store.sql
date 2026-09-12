-- =====================================================================
--  THE STORE
--
--  Material arrives on a purchase order and leaves on a challan. The
--  gap between those two is the part every paper system loses: what
--  left the store yesterday and has not been signed for at site is in
--  neither place, and if nothing holds it, it quietly disappears.
--
--  So a challan is dispatched, and separately acknowledged. What was
--  sent leaves the store at once. What arrives only becomes the site's
--  when the site says it has it. The difference is in transit, it
--  belongs to nobody, and it stays on the screen until somebody
--  accounts for it.
-- =====================================================================

SET FOREIGN_KEY_CHECKS = 0;

CREATE TABLE delivery_challans (
  id             INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  doc_no         VARCHAR(32)   NOT NULL,       -- DC/26-27/0001
  branch_id      INT UNSIGNED  NOT NULL,
  from_site_id   INT UNSIGNED  NOT NULL,       -- the store it leaves
  to_site_id     INT UNSIGNED  NOT NULL,       -- the site it is for
  dc_date        DATE          NOT NULL,
  status         ENUM('DRAFT','DISPATCHED','PART_ACK','ACKNOWLEDGED','CANCELLED')
                 NOT NULL DEFAULT 'DRAFT',
  vehicle_no     VARCHAR(32)   NULL,
  driver         VARCHAR(120)  NULL,
  note           VARCHAR(400)  NULL,
  dispatched_at  DATETIME      NULL,
  dispatched_by  INT UNSIGNED  NULL,
  created_by     INT UNSIGNED  NULL,
  created_at     TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_dc_doc (doc_no),
  KEY ix_dc_from (from_site_id, status),
  KEY ix_dc_to (to_site_id, status),
  CONSTRAINT fk_dc_br   FOREIGN KEY (branch_id)     REFERENCES branches (id),
  CONSTRAINT fk_dc_from FOREIGN KEY (from_site_id)  REFERENCES sites (id),
  CONSTRAINT fk_dc_to   FOREIGN KEY (to_site_id)    REFERENCES sites (id),
  CONSTRAINT fk_dc_disp FOREIGN KEY (dispatched_by) REFERENCES users (id),
  CONSTRAINT fk_dc_by   FOREIGN KEY (created_by)    REFERENCES users (id),
  CONSTRAINT ck_dc_diff CHECK (from_site_id <> to_site_id)
) ENGINE=InnoDB;

CREATE TABLE delivery_challan_lines (
  id        INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  dc_id     INT UNSIGNED  NOT NULL,
  item_id   INT UNSIGNED  NOT NULL,
  make_id   INT UNSIGNED  NULL,
  uom_id    INT UNSIGNED  NOT NULL,
  qty       DECIMAL(18,3) NOT NULL,       -- what left the store
  rate      DECIMAL(18,2) NOT NULL DEFAULT 0,   -- what it stood at when it left
  remark    VARCHAR(300)  NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_dcl (dc_id, item_id, make_id),
  KEY ix_dcl_item (item_id),
  CONSTRAINT fk_dcl_dc   FOREIGN KEY (dc_id)   REFERENCES delivery_challans (id) ON DELETE CASCADE,
  CONSTRAINT fk_dcl_item FOREIGN KEY (item_id) REFERENCES items (id),
  CONSTRAINT fk_dcl_make FOREIGN KEY (make_id) REFERENCES makes (id),
  CONSTRAINT fk_dcl_uom  FOREIGN KEY (uom_id)  REFERENCES uoms (id),
  CONSTRAINT ck_dcl_qty  CHECK (qty > 0)
) ENGINE=InnoDB;

-- which indents a challan is answering, so a site can see its own
-- requirement arrive rather than a heap of material with no story
CREATE TABLE dc_line_indents (
  dc_line_id INT UNSIGNED  NOT NULL,
  indent_id  INT UNSIGNED  NOT NULL,
  qty        DECIMAL(18,3) NOT NULL,
  PRIMARY KEY (dc_line_id, indent_id),
  KEY ix_dcli_ind (indent_id),
  CONSTRAINT fk_dcli_line FOREIGN KEY (dc_line_id) REFERENCES delivery_challan_lines (id) ON DELETE CASCADE,
  CONSTRAINT fk_dcli_ind  FOREIGN KEY (indent_id)  REFERENCES indents (id),
  CONSTRAINT ck_dcli_qty  CHECK (qty > 0)
) ENGINE=InnoDB;

-- the site signing for it, possibly more than once
CREATE TABLE dc_acknowledgements (
  id         INT UNSIGNED NOT NULL AUTO_INCREMENT,
  dc_id      INT UNSIGNED NOT NULL,
  ack_date   DATE         NOT NULL,
  note       VARCHAR(400) NULL,
  acked_by   INT UNSIGNED NULL,
  created_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY ix_dca_dc (dc_id),
  CONSTRAINT fk_dca_dc FOREIGN KEY (dc_id)    REFERENCES delivery_challans (id) ON DELETE CASCADE,
  CONSTRAINT fk_dca_by FOREIGN KEY (acked_by) REFERENCES users (id)
) ENGINE=InnoDB;

CREATE TABLE dc_acknowledgement_lines (
  id         INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  ack_id     INT UNSIGNED  NOT NULL,
  dc_line_id INT UNSIGNED  NOT NULL,
  qty        DECIMAL(18,3) NOT NULL,
  remark     VARCHAR(300)  NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_dcal (ack_id, dc_line_id),
  KEY ix_dcal_line (dc_line_id),
  CONSTRAINT fk_dcal_ack  FOREIGN KEY (ack_id)     REFERENCES dc_acknowledgements (id) ON DELETE CASCADE,
  CONSTRAINT fk_dcal_line FOREIGN KEY (dc_line_id) REFERENCES delivery_challan_lines (id),
  CONSTRAINT ck_dcal_qty  CHECK (qty > 0)
) ENGINE=InnoDB;

SET FOREIGN_KEY_CHECKS = 1;
