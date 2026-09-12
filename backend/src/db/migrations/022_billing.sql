-- =====================================================================
--  BILLING — the first document in this system that earns money
--
--  Everything up to here spends. A work order says what a client
--  agreed to pay; it is not revenue, and the profit and loss screen
--  has been refusing to exist on exactly that ground. A bill is what
--  turns the agreement into a number the business can count.
--
--  It is raised against WORK ORDER LINES, not against items. The
--  client agreed to "supply and install 100 socket points at ₹900";
--  they did not agree to buy metal boxes. So the billable quantity is
--  in the client's units, at the client's rate, on the client's
--  wording — and the whole BOQ, indent and consumption machinery sits
--  underneath as evidence rather than as the thing being billed.
--
--  Three rules.
--
--  The rate is the one on the work order, stamped onto the bill line
--  when it is raised. Same reasoning as material rates: what was
--  billed is what it was billed at, and a later correction to a work
--  order must not silently reprice an invoice already with a client.
--
--  Nothing may be billed twice. Bills run in sequence — RA 1, RA 2,
--  RA 3 — each one billing the quantity done since the last, and the
--  system holds the running total so nobody has to.
--
--  And nothing counts until it is raised. A draft bill is a working
--  note, it is not revenue, and the profit and loss will not see it.
-- =====================================================================

SET FOREIGN_KEY_CHECKS = 0;

CREATE TABLE bills (
  id             INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  doc_no         VARCHAR(32)   NOT NULL,        -- RA/26-27/0001
  -- the running account number for THIS site: 1, 2, 3. What the
  -- client's engineer calls it, and what everybody argues about.
  ra_no          INT UNSIGNED  NOT NULL,
  site_id        INT UNSIGNED  NOT NULL,
  branch_id      INT UNSIGNED  NOT NULL,
  work_order_id  INT UNSIGNED  NOT NULL,
  client_id      INT UNSIGNED  NULL,
  bill_date      DATE          NOT NULL,
  period_from    DATE          NULL,
  period_to      DATE          NULL,
  status         ENUM('DRAFT','RAISED','CANCELLED') NOT NULL DEFAULT 'DRAFT',
  client_ref     VARCHAR(64)   NULL,            -- their certificate number
  note           VARCHAR(400)  NULL,
  raised_at      DATETIME      NULL,
  raised_by      INT UNSIGNED  NULL,
  created_by     INT UNSIGNED  NULL,
  created_at     TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_bill_doc (doc_no),
  -- one RA number per site, and no arguing about which is which
  UNIQUE KEY uq_bill_ra (site_id, ra_no),
  KEY ix_bill_site (site_id, status),
  KEY ix_bill_branch (branch_id, status),
  KEY ix_bill_date (bill_date),
  CONSTRAINT fk_bill_site   FOREIGN KEY (site_id)       REFERENCES sites (id),
  CONSTRAINT fk_bill_br     FOREIGN KEY (branch_id)     REFERENCES branches (id),
  CONSTRAINT fk_bill_wo     FOREIGN KEY (work_order_id) REFERENCES work_orders (id),
  CONSTRAINT fk_bill_client FOREIGN KEY (client_id)     REFERENCES clients (id),
  CONSTRAINT fk_bill_raised FOREIGN KEY (raised_by)     REFERENCES users (id),
  CONSTRAINT fk_bill_by     FOREIGN KEY (created_by)    REFERENCES users (id)
) ENGINE=InnoDB;

CREATE TABLE bill_lines (
  id            INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  bill_id       INT UNSIGNED  NOT NULL,
  wo_line_id    INT UNSIGNED  NOT NULL,
  qty           DECIMAL(18,3) NOT NULL,
  -- stamped from the work order. The client agreed to these; a later
  -- correction upstream must not reprice an invoice already sent.
  supply_rate   DECIMAL(18,2) NOT NULL DEFAULT 0,
  inst_rate     DECIMAL(18,2) NOT NULL DEFAULT 0,
  supply_amount DECIMAL(20,2) AS (ROUND(qty * supply_rate, 2)) STORED,
  inst_amount   DECIMAL(20,2) AS (ROUND(qty * inst_rate, 2))   STORED,
  line_total    DECIMAL(20,2) AS (ROUND(qty * supply_rate, 2) + ROUND(qty * inst_rate, 2))
                STORED,
  remark        VARCHAR(300)  NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_bl (bill_id, wo_line_id),
  KEY ix_bl_wol (wo_line_id),
  CONSTRAINT fk_bl_bill FOREIGN KEY (bill_id)    REFERENCES bills (id) ON DELETE CASCADE,
  CONSTRAINT fk_bl_wol  FOREIGN KEY (wo_line_id) REFERENCES work_order_lines (id),
  CONSTRAINT ck_bl_qty  CHECK (qty > 0)
) ENGINE=InnoDB;

SET FOREIGN_KEY_CHECKS = 1;
