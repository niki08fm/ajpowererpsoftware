-- =====================================================================
--  AJ Power ERP — schema 001
--  Planning and Site only. No permissions, no visibility rules: who
--  sees what is a later decision and it does not belong in the way of
--  getting the departments right first.
--
--  Users exist because a document has to record who raised it, not
--  because anything checks them.
--
--  Two rules the legacy system broke, enforced here rather than in
--  application code:
--    1. Nothing stores a running balance. Every quantity that could
--       drift is derived from the documents that caused it.
--    2. Quantities are DECIMAL(18,3), money is DECIMAL(18,2).
--       No floats anywhere near either.
-- =====================================================================

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

-- ---------------------------------------------------------------- org
CREATE TABLE branches (
  id          INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  code        VARCHAR(12)   NOT NULL,
  name        VARCHAR(120)  NOT NULL,
  gstin       VARCHAR(15)   NULL,
  address     VARCHAR(400)  NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_branch_code (code)
) ENGINE=InnoDB;

-- a person. 'department' is a label for display only — nothing keys off it
CREATE TABLE users (
  id          INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  emp_code    VARCHAR(24)   NOT NULL,
  name        VARCHAR(120)  NOT NULL,
  email       VARCHAR(160)  NOT NULL,
  phone       VARCHAR(20)   NULL,
  department  VARCHAR(40)   NOT NULL DEFAULT 'Planning',
  is_active   TINYINT(1)    NOT NULL DEFAULT 1,
  created_at  TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_user_email (email),
  UNIQUE KEY uq_user_emp (emp_code)
) ENGINE=InnoDB;

CREATE TABLE clients (
  id            INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  branch_id     INT UNSIGNED  NOT NULL,
  name          VARCHAR(180)  NOT NULL,
  norm_key      VARCHAR(255)  NOT NULL,
  sort_key      VARCHAR(255)  NOT NULL,
  gstin         VARCHAR(15)   NULL,
  address       VARCHAR(400)  NULL,
  contact_name  VARCHAR(120)  NULL,
  contact_phone VARCHAR(20)   NULL,
  created_at    TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_client_key (norm_key),
  KEY ix_client_branch (branch_id),
  CONSTRAINT fk_client_branch FOREIGN KEY (branch_id) REFERENCES branches (id)
) ENGINE=InnoDB;

-- ------------------------------------------------------- item master
CREATE TABLE uoms (
  id    INT UNSIGNED NOT NULL AUTO_INCREMENT,
  code  VARCHAR(12)  NOT NULL,
  name  VARCHAR(40)  NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_uom_code (code)
) ENGINE=InnoDB;

CREATE TABLE item_categories (
  id    INT UNSIGNED NOT NULL AUTO_INCREMENT,
  code  CHAR(3)      NOT NULL,        -- ARM, WIR, MCB … drives the item code
  name  VARCHAR(80)  NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_cat_code (code)
) ENGINE=InnoDB;

CREATE TABLE makes (
  id    INT UNSIGNED NOT NULL AUTO_INCREMENT,
  name  VARCHAR(80)  NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_make_name (name)
) ENGINE=InnoDB;

CREATE TABLE items (
  id           INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  code         VARCHAR(16)   NOT NULL,     -- ARM-0001
  name         VARCHAR(255)  NOT NULL,
  -- the duplicate guard. norm_key is order preserving and UNIQUE: it
  -- catches the same name typed differently ("MCB 32A" = "M.C.B-32A").
  -- sort_key has the tokens sorted and is only indexed: it catches a
  -- different word order ("32A MCB"), which is a likely duplicate, so
  -- the API warns on it rather than refusing the save.
  norm_key     VARCHAR(255)  NOT NULL,
  sort_key     VARCHAR(255)  NOT NULL,
  category_id  INT UNSIGNED  NOT NULL,
  uom_id       INT UNSIGNED  NOT NULL,
  item_type    ENUM('BILLABLE','CONSUMABLE') NOT NULL DEFAULT 'BILLABLE',
  gst_rate     DECIMAL(5,2)  NOT NULL DEFAULT 18.00,
  hsn          VARCHAR(12)   NULL,
  std_rate     DECIMAL(18,2) NOT NULL DEFAULT 0,
  opening_qty  DECIMAL(18,3) NOT NULL DEFAULT 0,
  status       ENUM('ACTIVE','INACTIVE') NOT NULL DEFAULT 'ACTIVE',
  created_by   INT UNSIGNED  NULL,
  created_at   TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_item_code (code),
  UNIQUE KEY uq_item_key (norm_key),
  KEY ix_item_sort (sort_key),
  KEY ix_item_cat (category_id),
  KEY ix_item_name (name(64)),
  CONSTRAINT fk_item_cat  FOREIGN KEY (category_id) REFERENCES item_categories (id),
  CONSTRAINT fk_item_uom  FOREIGN KEY (uom_id)      REFERENCES uoms (id),
  CONSTRAINT fk_item_user FOREIGN KEY (created_by)  REFERENCES users (id)
) ENGINE=InnoDB;

CREATE TABLE item_makes (
  item_id INT UNSIGNED NOT NULL,
  make_id INT UNSIGNED NOT NULL,
  PRIMARY KEY (item_id, make_id),
  KEY ix_im_make (make_id),
  CONSTRAINT fk_im_item FOREIGN KEY (item_id) REFERENCES items (id) ON DELETE CASCADE,
  CONSTRAINT fk_im_make FOREIGN KEY (make_id) REFERENCES makes (id)
) ENGINE=InnoDB;

-- ---------------------------------------------------- sites & stores
CREATE TABLE sites (
  id                INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  code              VARCHAR(20)   NOT NULL,
  name              VARCHAR(180)  NOT NULL,
  norm_key          VARCHAR(255)  NOT NULL,
  sort_key          VARCHAR(255)  NOT NULL,
  site_type         ENUM('SITE','STORE') NOT NULL DEFAULT 'SITE',
  branch_id         INT UNSIGNED  NOT NULL,
  client_id         INT UNSIGNED  NULL,     -- a store has no client
  head_user_id      INT UNSIGNED  NULL,
  keeper_user_id    INT UNSIGNED  NULL,
  location          VARCHAR(300)  NULL,
  billing_address   VARCHAR(500)  NULL,
  start_date        DATE          NULL,
  target_completion DATE          NULL,
  status            ENUM('ACTIVE','CLOSED') NOT NULL DEFAULT 'ACTIVE',
  created_by        INT UNSIGNED  NULL,
  created_at        TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_site_code (code),
  UNIQUE KEY uq_site_key (norm_key),
  KEY ix_site_branch (branch_id, site_type, status),
  CONSTRAINT fk_site_branch FOREIGN KEY (branch_id)      REFERENCES branches (id),
  CONSTRAINT fk_site_client FOREIGN KEY (client_id)      REFERENCES clients (id),
  CONSTRAINT fk_site_head   FOREIGN KEY (head_user_id)   REFERENCES users (id),
  CONSTRAINT fk_site_keeper FOREIGN KEY (keeper_user_id) REFERENCES users (id),
  CONSTRAINT fk_site_by     FOREIGN KEY (created_by)     REFERENCES users (id),
  CONSTRAINT ck_site_client CHECK (site_type = 'STORE' OR client_id IS NOT NULL)
) ENGINE=InnoDB;

-- recorded now, used when we decide who sees what
CREATE TABLE site_team (
  site_id   INT UNSIGNED NOT NULL,
  user_id   INT UNSIGNED NOT NULL,
  added_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (site_id, user_id),
  KEY ix_st_user (user_id),
  CONSTRAINT fk_st_site FOREIGN KEY (site_id) REFERENCES sites (id) ON DELETE CASCADE,
  CONSTRAINT fk_st_user FOREIGN KEY (user_id) REFERENCES users (id)
) ENGINE=InnoDB;

-- ------------------------------------------------------- work orders
-- The client's document. Their wording, their quantity, their rate.
-- Written once, never edited.
CREATE TABLE work_orders (
  id            INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  doc_no        VARCHAR(32)   NOT NULL,     -- WO/26-27/0001
  site_id       INT UNSIGNED  NOT NULL,
  branch_id     INT UNSIGNED  NOT NULL,
  client_wo_no  VARCHAR(64)   NULL,
  wo_date       DATE          NOT NULL,
  status        ENUM('LOCKED','CLOSED') NOT NULL DEFAULT 'LOCKED',
  created_by    INT UNSIGNED  NULL,
  created_at    TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_wo_doc (doc_no),
  UNIQUE KEY uq_wo_site (site_id),          -- one work order per site
  CONSTRAINT fk_wo_site   FOREIGN KEY (site_id)    REFERENCES sites (id),
  CONSTRAINT fk_wo_branch FOREIGN KEY (branch_id)  REFERENCES branches (id),
  CONSTRAINT fk_wo_by     FOREIGN KEY (created_by) REFERENCES users (id)
) ENGINE=InnoDB;

CREATE TABLE work_order_lines (
  id            INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  work_order_id INT UNSIGNED  NOT NULL,
  sno           INT UNSIGNED  NOT NULL,
  description   VARCHAR(500)  NOT NULL,     -- the client's wording, not an item
  uom_id        INT UNSIGNED  NOT NULL,
  qty           DECIMAL(18,3) NOT NULL,
  supply_rate   DECIMAL(18,2) NOT NULL DEFAULT 0,
  inst_rate     DECIMAL(18,2) NOT NULL DEFAULT 0,
  supply_amount DECIMAL(20,2) AS (ROUND(qty * supply_rate, 2)) STORED,
  inst_amount   DECIMAL(20,2) AS (ROUND(qty * inst_rate, 2))   STORED,
  line_total    DECIMAL(20,2) AS (ROUND(qty * supply_rate, 2) + ROUND(qty * inst_rate, 2)) STORED,
  PRIMARY KEY (id),
  UNIQUE KEY uq_wol_sno (work_order_id, sno),
  CONSTRAINT fk_wol_wo  FOREIGN KEY (work_order_id) REFERENCES work_orders (id) ON DELETE CASCADE,
  CONSTRAINT fk_wol_uom FOREIGN KEY (uom_id)        REFERENCES uoms (id),
  CONSTRAINT ck_wol_qty CHECK (qty > 0)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------- BOQ
CREATE TABLE boqs (
  id            INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  doc_no        VARCHAR(32)   NOT NULL,
  site_id       INT UNSIGNED  NOT NULL,
  branch_id     INT UNSIGNED  NOT NULL,
  work_order_id INT UNSIGNED  NOT NULL,
  status        ENUM('DRAFT','LOCKED') NOT NULL DEFAULT 'DRAFT',
  over_allow    TINYINT(1)    NOT NULL DEFAULT 0,
  over_pct      DECIMAL(6,2)  NOT NULL DEFAULT 0,   -- 0 + allow = no ceiling
  submitted_at  DATETIME      NULL,
  amended_on    DATE          NULL,
  created_by    INT UNSIGNED  NULL,
  created_at    TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_boq_doc (doc_no),
  UNIQUE KEY uq_boq_wo (work_order_id),
  KEY ix_boq_site (site_id, status),
  CONSTRAINT fk_boq_site FOREIGN KEY (site_id)       REFERENCES sites (id),
  CONSTRAINT fk_boq_br   FOREIGN KEY (branch_id)     REFERENCES branches (id),
  CONSTRAINT fk_boq_wo   FOREIGN KEY (work_order_id) REFERENCES work_orders (id),
  CONSTRAINT fk_boq_by   FOREIGN KEY (created_by)    REFERENCES users (id),
  CONSTRAINT ck_boq_pct  CHECK (over_pct >= 0 AND over_pct <= 500)
) ENGINE=InnoDB;

CREATE TABLE boq_wo_lines (
  id         INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  boq_id     INT UNSIGNED  NOT NULL,
  wo_line_id INT UNSIGNED  NOT NULL,
  est_qty    DECIMAL(18,3) NOT NULL DEFAULT 0,   -- typed by hand
  PRIMARY KEY (id),
  UNIQUE KEY uq_bwl (boq_id, wo_line_id),
  CONSTRAINT fk_bwl_boq FOREIGN KEY (boq_id)     REFERENCES boqs (id) ON DELETE CASCADE,
  CONSTRAINT fk_bwl_wol FOREIGN KEY (wo_line_id) REFERENCES work_order_lines (id)
) ENGINE=InnoDB;

CREATE TABLE boq_lines (
  id             INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  boq_id         INT UNSIGNED  NOT NULL,
  boq_wo_line_id INT UNSIGNED  NOT NULL,
  sno            VARCHAR(12)   NOT NULL,   -- 1a, 1b, 2a …
  item_id        INT UNSIGNED  NOT NULL,
  make_id        INT UNSIGNED  NULL,
  uom_id         INT UNSIGNED  NOT NULL,
  item_qty       DECIMAL(18,3) NOT NULL,   -- how many go into ONE of the WO line
  boq_qty        DECIMAL(18,3) NOT NULL,   -- item_qty x WO line qty. Calculated.
  est_qty        DECIMAL(18,3) NOT NULL,   -- what Planning expects to procure
  est_manual     TINYINT(1)    NOT NULL DEFAULT 0,
  var_qty        DECIMAL(18,3) NOT NULL DEFAULT 0,   -- added by amendment
  PRIMARY KEY (id),
  UNIQUE KEY uq_boql_sno (boq_id, sno),
  UNIQUE KEY uq_boql_item (boq_wo_line_id, item_id),
  KEY ix_boql_boq (boq_id),
  CONSTRAINT fk_boql_boq  FOREIGN KEY (boq_id)         REFERENCES boqs (id) ON DELETE CASCADE,
  CONSTRAINT fk_boql_bwl  FOREIGN KEY (boq_wo_line_id) REFERENCES boq_wo_lines (id) ON DELETE CASCADE,
  CONSTRAINT fk_boql_item FOREIGN KEY (item_id)        REFERENCES items (id),
  CONSTRAINT fk_boql_make FOREIGN KEY (make_id)        REFERENCES makes (id),
  CONSTRAINT fk_boql_uom  FOREIGN KEY (uom_id)         REFERENCES uoms (id),
  CONSTRAINT ck_boql_qty  CHECK (item_qty > 0 AND boq_qty >= 0 AND est_qty >= 0 AND var_qty >= 0)
) ENGINE=InnoDB;

CREATE TABLE boq_amendments (
  id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  boq_id      INT UNSIGNED NOT NULL,
  reason      VARCHAR(500) NOT NULL,
  created_by  INT UNSIGNED NULL,
  created_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY ix_ba_boq (boq_id),
  CONSTRAINT fk_ba_boq FOREIGN KEY (boq_id)     REFERENCES boqs (id),
  CONSTRAINT fk_ba_by  FOREIGN KEY (created_by) REFERENCES users (id)
) ENGINE=InnoDB;

CREATE TABLE boq_amendment_lines (
  id           INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  amendment_id INT UNSIGNED  NOT NULL,
  boq_line_id  INT UNSIGNED  NOT NULL,
  qty          DECIMAL(18,3) NOT NULL,
  PRIMARY KEY (id),
  KEY ix_bal_am (amendment_id),
  CONSTRAINT fk_bal_am   FOREIGN KEY (amendment_id) REFERENCES boq_amendments (id) ON DELETE CASCADE,
  CONSTRAINT fk_bal_line FOREIGN KEY (boq_line_id)  REFERENCES boq_lines (id),
  CONSTRAINT ck_bal_qty  CHECK (qty > 0)
) ENGINE=InnoDB;

-- ------------------------------------------------------------ indents
-- A cart, then a document. status carries the whole life:
--   DRAFT      editable, eats no balance, nobody else sees it
--   SUBMITTED  in the queue
--   APPROVED   committed
--   RETURNED   sent back, editable again
CREATE TABLE indents (
  id          INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  doc_no      VARCHAR(32)   NOT NULL,
  site_id     INT UNSIGNED  NOT NULL,
  branch_id   INT UNSIGNED  NOT NULL,
  boq_id      INT UNSIGNED  NOT NULL,
  indent_date DATE          NOT NULL,
  needed_by   DATE          NULL,
  status      ENUM('DRAFT','SUBMITTED','APPROVED','RETURNED') NOT NULL DEFAULT 'DRAFT',
  raised_by   INT UNSIGNED  NULL,
  created_at  TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_ind_doc (doc_no),
  KEY ix_ind_site (site_id, status),
  KEY ix_ind_boq (boq_id),
  CONSTRAINT fk_ind_site FOREIGN KEY (site_id)   REFERENCES sites (id),
  CONSTRAINT fk_ind_br   FOREIGN KEY (branch_id) REFERENCES branches (id),
  CONSTRAINT fk_ind_boq  FOREIGN KEY (boq_id)    REFERENCES boqs (id),
  CONSTRAINT fk_ind_by   FOREIGN KEY (raised_by) REFERENCES users (id)
) ENGINE=InnoDB;

CREATE TABLE indent_lines (
  id          INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  indent_id   INT UNSIGNED  NOT NULL,
  boq_line_id INT UNSIGNED  NOT NULL,
  item_id     INT UNSIGNED  NOT NULL,
  make_id     INT UNSIGNED  NULL,
  qty         DECIMAL(18,3) NOT NULL,
  -- how much of qty sat past the estimate when it was raised; kept so
  -- the flag survives a later amendment moving the estimate underneath
  over_qty    DECIMAL(18,3) NOT NULL DEFAULT 0,
  remark      VARCHAR(300)  NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_indl (indent_id, boq_line_id),
  KEY ix_indl_boql (boq_line_id),
  CONSTRAINT fk_indl_ind  FOREIGN KEY (indent_id)   REFERENCES indents (id) ON DELETE CASCADE,
  CONSTRAINT fk_indl_boql FOREIGN KEY (boq_line_id) REFERENCES boq_lines (id),
  CONSTRAINT fk_indl_item FOREIGN KEY (item_id)     REFERENCES items (id),
  CONSTRAINT fk_indl_make FOREIGN KEY (make_id)     REFERENCES makes (id),
  CONSTRAINT ck_indl_qty  CHECK (qty > 0)
) ENGINE=InnoDB;

-- who did what to a document, so the trail exists from day one
CREATE TABLE indent_events (
  id         INT UNSIGNED NOT NULL AUTO_INCREMENT,
  indent_id  INT UNSIGNED NOT NULL,
  action     VARCHAR(24)  NOT NULL,   -- SUBMITTED, APPROVED, RETURNED
  user_id    INT UNSIGNED NULL,
  note       VARCHAR(500) NULL,
  created_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY ix_ie_ind (indent_id),
  CONSTRAINT fk_ie_ind  FOREIGN KEY (indent_id) REFERENCES indents (id) ON DELETE CASCADE,
  CONSTRAINT fk_ie_user FOREIGN KEY (user_id)   REFERENCES users (id)
) ENGINE=InnoDB;

-- ------------------------------------------------- numbering & audit
-- Numbers come from here under a row lock, so two people pressing
-- Submit at the same moment cannot take the same one.
CREATE TABLE doc_counters (
  doc_type  VARCHAR(24)  NOT NULL,
  fy        CHAR(5)      NOT NULL,     -- 26-27
  last_no   INT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (doc_type, fy)
) ENGINE=InnoDB;

CREATE TABLE item_code_counters (
  category_code CHAR(3)      NOT NULL,
  last_no       INT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (category_code)
) ENGINE=InnoDB;

CREATE TABLE audit_log (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  entity     VARCHAR(32)   NOT NULL,
  entity_id  INT UNSIGNED  NULL,
  doc_no     VARCHAR(32)   NULL,
  action     VARCHAR(60)   NOT NULL,
  detail     VARCHAR(600)  NULL,
  user_id    INT UNSIGNED  NULL,
  created_at TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY ix_audit_entity (entity, entity_id),
  KEY ix_audit_time (created_at)
) ENGINE=InnoDB;

SET FOREIGN_KEY_CHECKS = 1;
