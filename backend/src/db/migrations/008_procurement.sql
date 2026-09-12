-- =====================================================================
--  PROCUREMENT
--
--  What the department is handed: approved indents, rolled up by item.
--  What it decides: buy it, or take it from a store that already holds
--  it. What it produces: a purchase order, and later a receipt against
--  that order.
--
--  Two rules carried over from everything before this:
--    * nothing stores a running balance. Ordered, received and pending
--      are derived from the documents that caused them.
--    * a quantity is DECIMAL(18,3), money is DECIMAL(18,2).
-- =====================================================================

SET FOREIGN_KEY_CHECKS = 0;

-- ----------------------------------------------------------- suppliers
CREATE TABLE suppliers (
  id            INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  code          VARCHAR(16)   NOT NULL,          -- SUP-0001
  name          VARCHAR(180)  NOT NULL,
  norm_key      VARCHAR(255)  NOT NULL,          -- the same duplicate guard as items
  sort_key      VARCHAR(255)  NOT NULL,
  gstin         VARCHAR(15)   NULL,
  address       VARCHAR(400)  NULL,
  contact_name  VARCHAR(120)  NULL,
  contact_phone VARCHAR(20)   NULL,
  email         VARCHAR(160)  NULL,
  terms_days    INT UNSIGNED  NOT NULL DEFAULT 30,
  status        ENUM('ACTIVE','INACTIVE') NOT NULL DEFAULT 'ACTIVE',
  created_by    INT UNSIGNED  NULL,
  created_at    TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_sup_code (code),
  UNIQUE KEY uq_sup_key (norm_key),
  KEY ix_sup_sort (sort_key),
  CONSTRAINT fk_sup_by FOREIGN KEY (created_by) REFERENCES users (id)
) ENGINE=InnoDB;

-- which makes a supplier actually carries, so a comparison can offer
-- the right people rather than the whole list
CREATE TABLE supplier_makes (
  supplier_id INT UNSIGNED NOT NULL,
  make_id     INT UNSIGNED NOT NULL,
  PRIMARY KEY (supplier_id, make_id),
  KEY ix_sm_make (make_id),
  CONSTRAINT fk_sm_sup  FOREIGN KEY (supplier_id) REFERENCES suppliers (id) ON DELETE CASCADE,
  CONSTRAINT fk_sm_make FOREIGN KEY (make_id)     REFERENCES makes (id)
) ENGINE=InnoDB;

-- one store per branch is the one a multi-site order is delivered to
ALTER TABLE sites ADD COLUMN is_central TINYINT(1) NOT NULL DEFAULT 0 AFTER site_type;

-- ------------------------------------------------- the stock ledger
-- Every movement of every item at every location. A balance is the sum
-- of these and is never written down anywhere.
CREATE TABLE stock_movements (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  site_id    INT UNSIGNED  NOT NULL,        -- a SITE or a STORE; both hold stock
  item_id    INT UNSIGNED  NOT NULL,
  make_id    INT UNSIGNED  NULL,
  qty        DECIMAL(18,3) NOT NULL,        -- negative is out
  rate       DECIMAL(18,2) NOT NULL DEFAULT 0,   -- what it came in at
  kind       VARCHAR(24)   NOT NULL,        -- GRN, ISSUE, RETURN, ADJUST
  ref_type   VARCHAR(24)   NULL,
  ref_id     INT UNSIGNED  NULL,
  ref_no     VARCHAR(32)   NULL,
  moved_on   DATE          NOT NULL,
  created_by INT UNSIGNED  NULL,
  created_at TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY ix_sm_site_item (site_id, item_id),
  KEY ix_sm_ref (ref_type, ref_id),
  CONSTRAINT fk_smv_site FOREIGN KEY (site_id) REFERENCES sites (id),
  CONSTRAINT fk_smv_item FOREIGN KEY (item_id) REFERENCES items (id),
  CONSTRAINT fk_smv_make FOREIGN KEY (make_id) REFERENCES makes (id),
  CONSTRAINT fk_smv_by   FOREIGN KEY (created_by) REFERENCES users (id),
  CONSTRAINT ck_smv_qty  CHECK (qty <> 0)
) ENGINE=InnoDB;

-- ------------------------------------------------- rate comparison
CREATE TABLE comparisons (
  id         INT UNSIGNED NOT NULL AUTO_INCREMENT,
  doc_no     VARCHAR(32)  NOT NULL,
  branch_id  INT UNSIGNED NOT NULL,
  title      VARCHAR(200) NULL,
  status     ENUM('DRAFT','DECIDED') NOT NULL DEFAULT 'DRAFT',
  chosen_supplier_id INT UNSIGNED NULL,
  decided_note VARCHAR(400) NULL,
  decided_at DATETIME     NULL,
  created_by INT UNSIGNED NULL,
  created_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_cmp_doc (doc_no),
  KEY ix_cmp_branch (branch_id, status),
  CONSTRAINT fk_cmp_br  FOREIGN KEY (branch_id) REFERENCES branches (id),
  CONSTRAINT fk_cmp_sup FOREIGN KEY (chosen_supplier_id) REFERENCES suppliers (id),
  CONSTRAINT fk_cmp_by  FOREIGN KEY (created_by) REFERENCES users (id)
) ENGINE=InnoDB;

CREATE TABLE comparison_items (
  id            INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  comparison_id INT UNSIGNED  NOT NULL,
  item_id       INT UNSIGNED  NOT NULL,
  make_id       INT UNSIGNED  NULL,
  qty           DECIMAL(18,3) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_ci (comparison_id, item_id, make_id),
  CONSTRAINT fk_ci_cmp  FOREIGN KEY (comparison_id) REFERENCES comparisons (id) ON DELETE CASCADE,
  CONSTRAINT fk_ci_item FOREIGN KEY (item_id)       REFERENCES items (id),
  CONSTRAINT fk_ci_make FOREIGN KEY (make_id)       REFERENCES makes (id),
  CONSTRAINT ck_ci_qty  CHECK (qty > 0)
) ENGINE=InnoDB;

-- what each supplier attaches to their whole quote, not to one line:
-- this is what turns a rate into a landed cost
CREATE TABLE comparison_suppliers (
  id            INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  comparison_id INT UNSIGNED  NOT NULL,
  supplier_id   INT UNSIGNED  NOT NULL,
  discount_pct  DECIMAL(6,2)  NOT NULL DEFAULT 0,
  freight       DECIMAL(18,2) NOT NULL DEFAULT 0,
  credit_days   INT UNSIGNED  NOT NULL DEFAULT 30,
  note          VARCHAR(300)  NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_cs (comparison_id, supplier_id),
  CONSTRAINT fk_cs_cmp FOREIGN KEY (comparison_id) REFERENCES comparisons (id) ON DELETE CASCADE,
  CONSTRAINT fk_cs_sup FOREIGN KEY (supplier_id)   REFERENCES suppliers (id)
) ENGINE=InnoDB;

CREATE TABLE comparison_quotes (
  comparison_item_id     INT UNSIGNED  NOT NULL,
  comparison_supplier_id INT UNSIGNED  NOT NULL,
  rate                   DECIMAL(18,2) NOT NULL,
  PRIMARY KEY (comparison_item_id, comparison_supplier_id),
  KEY ix_cq_sup (comparison_supplier_id),
  CONSTRAINT fk_cq_item FOREIGN KEY (comparison_item_id)     REFERENCES comparison_items (id) ON DELETE CASCADE,
  CONSTRAINT fk_cq_sup  FOREIGN KEY (comparison_supplier_id) REFERENCES comparison_suppliers (id) ON DELETE CASCADE,
  CONSTRAINT ck_cq_rate CHECK (rate >= 0)
) ENGINE=InnoDB;

-- ------------------------------------------------- purchase orders
CREATE TABLE purchase_orders (
  id             INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  doc_no         VARCHAR(32)   NOT NULL,
  branch_id      INT UNSIGNED  NOT NULL,
  supplier_id    INT UNSIGNED  NOT NULL,
  comparison_id  INT UNSIGNED  NULL,
  -- where the supplier delivers. A SITE when every indent on this order
  -- is that site's; a STORE when they are not.
  deliver_to_id  INT UNSIGNED  NOT NULL,
  po_date        DATE          NOT NULL,
  expected_date  DATE          NULL,
  status         ENUM('DRAFT','PLACED','CLOSED','CANCELLED') NOT NULL DEFAULT 'DRAFT',
  closed_note    VARCHAR(300)  NULL,
  notes          VARCHAR(500)  NULL,
  created_by     INT UNSIGNED  NULL,
  created_at     TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_po_doc (doc_no),
  KEY ix_po_branch (branch_id, status),
  KEY ix_po_sup (supplier_id),
  CONSTRAINT fk_po_br  FOREIGN KEY (branch_id)     REFERENCES branches (id),
  CONSTRAINT fk_po_sup FOREIGN KEY (supplier_id)   REFERENCES suppliers (id),
  CONSTRAINT fk_po_cmp FOREIGN KEY (comparison_id) REFERENCES comparisons (id),
  CONSTRAINT fk_po_to  FOREIGN KEY (deliver_to_id) REFERENCES sites (id),
  CONSTRAINT fk_po_by  FOREIGN KEY (created_by)    REFERENCES users (id)
) ENGINE=InnoDB;

-- which indents this order is filling. Several, on purpose: the same
-- cable wanted by three sites is one negotiation.
CREATE TABLE purchase_order_indents (
  po_id     INT UNSIGNED NOT NULL,
  indent_id INT UNSIGNED NOT NULL,
  PRIMARY KEY (po_id, indent_id),
  KEY ix_poi_ind (indent_id),
  CONSTRAINT fk_poi_po  FOREIGN KEY (po_id)     REFERENCES purchase_orders (id) ON DELETE CASCADE,
  CONSTRAINT fk_poi_ind FOREIGN KEY (indent_id) REFERENCES indents (id)
) ENGINE=InnoDB;

CREATE TABLE purchase_order_lines (
  id       INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  po_id    INT UNSIGNED  NOT NULL,
  item_id  INT UNSIGNED  NOT NULL,
  make_id  INT UNSIGNED  NULL,
  uom_id   INT UNSIGNED  NOT NULL,
  qty      DECIMAL(18,3) NOT NULL,
  rate     DECIMAL(18,2) NOT NULL,
  gst_rate DECIMAL(5,2)  NOT NULL DEFAULT 18.00,
  remark   VARCHAR(300)  NULL,
  basic    DECIMAL(20,2) AS (ROUND(qty * rate, 2)) STORED,
  gst_amt  DECIMAL(20,2) AS (ROUND(ROUND(qty * rate, 2) * gst_rate / 100, 2)) STORED,
  total    DECIMAL(20,2) AS (ROUND(qty * rate, 2)
                             + ROUND(ROUND(qty * rate, 2) * gst_rate / 100, 2)) STORED,
  PRIMARY KEY (id),
  UNIQUE KEY uq_pol (po_id, item_id, make_id),
  KEY ix_pol_item (item_id),
  CONSTRAINT fk_pol_po   FOREIGN KEY (po_id)   REFERENCES purchase_orders (id) ON DELETE CASCADE,
  CONSTRAINT fk_pol_item FOREIGN KEY (item_id) REFERENCES items (id),
  CONSTRAINT fk_pol_make FOREIGN KEY (make_id) REFERENCES makes (id),
  CONSTRAINT fk_pol_uom  FOREIGN KEY (uom_id)  REFERENCES uoms (id),
  CONSTRAINT ck_pol_qty  CHECK (qty > 0 AND rate >= 0)
) ENGINE=InnoDB;

-- ----------------------------------------------------- goods receipt
-- Acknowledged by whoever the order was directed to: the store for a
-- multi-site order, the site itself when it was delivered direct.
CREATE TABLE goods_receipts (
  id            INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  doc_no        VARCHAR(32)   NOT NULL,
  po_id         INT UNSIGNED  NOT NULL,
  received_at   INT UNSIGNED  NOT NULL,     -- the site or store
  receipt_date  DATE          NOT NULL,
  supplier_dc   VARCHAR(64)   NULL,         -- their challan / invoice number
  status        ENUM('DRAFT','CONFIRMED') NOT NULL DEFAULT 'DRAFT',
  note          VARCHAR(400)  NULL,
  received_by   INT UNSIGNED  NULL,
  created_at    TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_grn_doc (doc_no),
  KEY ix_grn_po (po_id, status),
  CONSTRAINT fk_grn_po   FOREIGN KEY (po_id)       REFERENCES purchase_orders (id),
  CONSTRAINT fk_grn_at   FOREIGN KEY (received_at) REFERENCES sites (id),
  CONSTRAINT fk_grn_by   FOREIGN KEY (received_by) REFERENCES users (id)
) ENGINE=InnoDB;

CREATE TABLE goods_receipt_lines (
  id         INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  grn_id     INT UNSIGNED  NOT NULL,
  po_line_id INT UNSIGNED  NOT NULL,
  qty        DECIMAL(18,3) NOT NULL,
  remark     VARCHAR(300)  NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_grnl (grn_id, po_line_id),
  KEY ix_grnl_pol (po_line_id),
  CONSTRAINT fk_grnl_grn FOREIGN KEY (grn_id)     REFERENCES goods_receipts (id) ON DELETE CASCADE,
  CONSTRAINT fk_grnl_pol FOREIGN KEY (po_line_id) REFERENCES purchase_order_lines (id),
  CONSTRAINT ck_grnl_qty CHECK (qty > 0)
) ENGINE=InnoDB;

SET FOREIGN_KEY_CHECKS = 1;
