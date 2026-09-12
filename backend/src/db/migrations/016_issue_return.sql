-- =====================================================================
--  ISSUE FOR CONSUMPTION, AND RETURN TO THE SITE STORE
--
--  Material that reached a site is not spent yet. It sits on the site's
--  shelf until somebody walks up and takes it, and the moment it leaves
--  that shelf in a person's hands is the moment it becomes a cost. That
--  moment had no document. Stock arrived at site and then, as far as
--  this system was concerned, nothing ever happened to it again.
--
--  Two documents close that gap:
--
--    CON  issued for consumption — off the shelf, into someone's hands
--    RET  returned unused        — back on the shelf, cost reversed
--
--  Three things are worth saying about how they are shaped.
--
--  1. An issue names an ITEM, not a BOQ line. Asking a storekeeper to
--     decide which BOQ line a coil of wire belongs to, at the moment
--     somebody is standing in front of him waiting for it, is how you
--     get a system nobody uses. boq_line_id is kept and made NULL-able
--     so that link can be turned on later without moving any data.
--
--  2. An issue names a PERSON by hand. There is no site login yet, and
--     the people drawing material are often not system users at all.
--     issued_to_user_id is reserved for when site attendance arrives;
--     until then the typed name is the record, and it is the thing the
--     audit searches on.
--
--  3. Every line carries a RATE, stamped from the central store at the
--     moment it moves. This is the one place this schema writes down a
--     number it could derive, and it is deliberate: an expense report
--     whose past changes every time the store buys cable at a new price
--     is not a report, it is a rumour. What it cost is what it cost on
--     the day. A return is stamped the same way, so reversing an issue
--     gives the money back at the price it was taken out at.
-- =====================================================================

SET FOREIGN_KEY_CHECKS = 0;

-- --------------------------------------------------- issue: header
-- The table was laid down in 003 for a consumption document tied to the
-- BOQ, and never written to. It is reshaped here rather than replaced,
-- because it holds no rows and the name is still the right one.

ALTER TABLE consumptions
  -- a site with no BOQ can still spend material
  MODIFY COLUMN boq_id INT UNSIGNED NULL,
  ADD COLUMN issued_to_name VARCHAR(160) NULL AFTER used_on,
  ADD COLUMN issued_to_user_id INT UNSIGNED NULL AFTER issued_to_name,
  ADD COLUMN purpose VARCHAR(300) NULL AFTER issued_to_user_id,
  ADD KEY ix_con_person (issued_to_name),
  ADD KEY ix_con_date (used_on),
  ADD CONSTRAINT fk_con_to_user FOREIGN KEY (issued_to_user_id) REFERENCES users (id);

-- --------------------------------------------------- issue: lines
ALTER TABLE consumption_lines
  DROP INDEX uq_conl,
  MODIFY COLUMN boq_line_id INT UNSIGNED NULL,
  ADD COLUMN make_id INT UNSIGNED NULL AFTER item_id,
  ADD COLUMN uom_id  INT UNSIGNED NULL AFTER make_id,
  -- what the central store held it at when it left the shelf
  ADD COLUMN rate DECIMAL(18,2) NOT NULL DEFAULT 0 AFTER qty,
  ADD UNIQUE KEY uq_conl (consumption_id, item_id, make_id),
  ADD KEY ix_conl_item (item_id),
  ADD CONSTRAINT fk_conl_make FOREIGN KEY (make_id) REFERENCES makes (id),
  ADD CONSTRAINT fk_conl_uom  FOREIGN KEY (uom_id)  REFERENCES uoms (id);

-- ------------------------------------------------------------ return
CREATE TABLE stock_returns (
  id             INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  doc_no         VARCHAR(32)   NOT NULL,        -- RET/26-27/0001
  site_id        INT UNSIGNED  NOT NULL,
  branch_id      INT UNSIGNED  NOT NULL,
  returned_on    DATE          NOT NULL,
  -- who is handing it back. Same story as an issue: a typed name now,
  -- a linked person once site attendance exists.
  returned_by_name    VARCHAR(160) NULL,
  returned_by_user_id INT UNSIGNED NULL,
  -- the issue this undoes, when it is undoing one. Optional: material
  -- comes back off a site in a heap far more often than it comes back
  -- against the slip it went out on.
  consumption_id INT UNSIGNED  NULL,
  reason         VARCHAR(300)  NULL,
  status         ENUM('DRAFT','CONFIRMED') NOT NULL DEFAULT 'DRAFT',
  recorded_by    INT UNSIGNED  NULL,
  created_at     TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_ret_doc (doc_no),
  KEY ix_ret_site (site_id, status),
  KEY ix_ret_person (returned_by_name),
  KEY ix_ret_date (returned_on),
  CONSTRAINT fk_ret_site FOREIGN KEY (site_id)             REFERENCES sites (id),
  CONSTRAINT fk_ret_br   FOREIGN KEY (branch_id)           REFERENCES branches (id),
  CONSTRAINT fk_ret_con  FOREIGN KEY (consumption_id)      REFERENCES consumptions (id),
  CONSTRAINT fk_ret_to   FOREIGN KEY (returned_by_user_id) REFERENCES users (id),
  CONSTRAINT fk_ret_by   FOREIGN KEY (recorded_by)         REFERENCES users (id)
) ENGINE=InnoDB;

CREATE TABLE stock_return_lines (
  id        INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  return_id INT UNSIGNED  NOT NULL,
  item_id   INT UNSIGNED  NOT NULL,
  make_id   INT UNSIGNED  NULL,
  uom_id    INT UNSIGNED  NULL,
  qty       DECIMAL(18,3) NOT NULL,
  -- the price the cost is given back at
  rate      DECIMAL(18,2) NOT NULL DEFAULT 0,
  remark    VARCHAR(300)  NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_retl (return_id, item_id, make_id),
  KEY ix_retl_item (item_id),
  CONSTRAINT fk_retl_ret  FOREIGN KEY (return_id) REFERENCES stock_returns (id) ON DELETE CASCADE,
  CONSTRAINT fk_retl_item FOREIGN KEY (item_id)   REFERENCES items (id),
  CONSTRAINT fk_retl_make FOREIGN KEY (make_id)   REFERENCES makes (id),
  CONSTRAINT fk_retl_uom  FOREIGN KEY (uom_id)    REFERENCES uoms (id),
  CONSTRAINT ck_retl_qty  CHECK (qty > 0)
) ENGINE=InnoDB;

SET FOREIGN_KEY_CHECKS = 1;
