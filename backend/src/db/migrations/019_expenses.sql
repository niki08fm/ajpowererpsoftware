-- =====================================================================
--  WHAT A SITE SPENDS THAT IS NOT MATERIAL
--
--  Material cost is already answered: every issue and return is
--  stamped with what the central store was holding the item at that
--  day, and v_consumption_event adds them up. But a site spends money
--  on things that never touch a shelf — a lorry, diesel, food for a
--  gang working late, a bill from a man who came to fix the generator.
--  None of that is stock and none of it can be derived from anything.
--  Somebody has to type it in.
--
--  Which is exactly why it needs approving. A quantity of cable can be
--  checked against a shelf; a claim for ₹4,000 of transport can only be
--  checked by somebody who knows whether that lorry ran. So an expense
--  is claimed at site and decided elsewhere, and the two numbers are
--  kept apart:
--
--    claimed_amount   what the site asked for
--    approved_amount  what was allowed, and the only figure that costs
--
--  Partial approval is the normal case, not an edge one. ₹4,000 claimed
--  and ₹3,200 allowed is one expense with two numbers on it, not a
--  rejection followed by a fresh claim — and keeping both is what lets
--  anyone ask later how much of what sites asked for was granted.
--
--  Nothing unapproved is ever counted. A claim sitting in somebody's
--  queue is not a cost, and a report that included it would be telling
--  you about money that may never be spent.
-- =====================================================================

SET FOREIGN_KEY_CHECKS = 0;

-- What a site spends money on. A table rather than an enum, because
-- the list is a business decision and will grow — and growing it
-- should not need a migration.
CREATE TABLE expense_categories (
  id         INT UNSIGNED NOT NULL AUTO_INCREMENT,
  name       VARCHAR(80)  NOT NULL,
  norm_key   VARCHAR(80)  NOT NULL,      -- the duplicate guard, as elsewhere
  is_active  TINYINT(1)   NOT NULL DEFAULT 1,
  sort_no    INT UNSIGNED NOT NULL DEFAULT 100,
  created_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_expcat_key (norm_key)
) ENGINE=InnoDB;

INSERT INTO expense_categories (name, norm_key, sort_no) VALUES
  ('Transport',            'transport',            10),
  ('Fuel',                 'fuel',                 20),
  ('Freight and cartage',  'freight and cartage',  30),
  ('Food and refreshment', 'food and refreshment', 40),
  ('Accommodation',        'accommodation',        50),
  ('Tools and consumables','tools and consumables',60),
  ('Hire charges',         'hire charges',         70),
  ('Repairs',              'repairs',              80),
  ('Site office',          'site office',          90),
  ('Miscellaneous',        'miscellaneous',       999);

CREATE TABLE site_expenses (
  id              INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  doc_no          VARCHAR(32)   NOT NULL,        -- EXP/26-27/0001
  site_id         INT UNSIGNED  NOT NULL,
  branch_id       INT UNSIGNED  NOT NULL,
  category_id     INT UNSIGNED  NOT NULL,
  spent_on        DATE          NOT NULL,
  description     VARCHAR(400)  NOT NULL,
  paid_to         VARCHAR(160)  NULL,            -- the lorry driver, the shop
  bill_no         VARCHAR(64)   NULL,
  claimed_amount  DECIMAL(18,2) NOT NULL,
  -- NULL until somebody decides. Not 0 — 0 is a decision, and a
  -- claim nobody has looked at is not the same as one refused.
  approved_amount DECIMAL(18,2) NULL,
  status          ENUM('DRAFT','SUBMITTED','APPROVED','REJECTED','RETURNED')
                  NOT NULL DEFAULT 'DRAFT',
  note            VARCHAR(400)  NULL,
  raised_by       INT UNSIGNED  NULL,
  submitted_at    DATETIME      NULL,
  decided_by      INT UNSIGNED  NULL,
  decided_at      DATETIME      NULL,
  decision_note   VARCHAR(400)  NULL,
  created_at      TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_exp_doc (doc_no),
  KEY ix_exp_site (site_id, status),
  KEY ix_exp_branch (branch_id, status),
  KEY ix_exp_date (spent_on),
  CONSTRAINT fk_exp_site FOREIGN KEY (site_id)     REFERENCES sites (id),
  CONSTRAINT fk_exp_br   FOREIGN KEY (branch_id)   REFERENCES branches (id),
  CONSTRAINT fk_exp_cat  FOREIGN KEY (category_id) REFERENCES expense_categories (id),
  CONSTRAINT fk_exp_by   FOREIGN KEY (raised_by)   REFERENCES users (id),
  CONSTRAINT fk_exp_dec  FOREIGN KEY (decided_by)  REFERENCES users (id),
  CONSTRAINT ck_exp_claim CHECK (claimed_amount > 0),
  -- allowed to be less than claimed, never more: an approver may cut
  -- a claim down, but inventing money the site never asked for is not
  -- an approval, it is a different document
  CONSTRAINT ck_exp_appr  CHECK (approved_amount IS NULL
                                 OR (approved_amount >= 0
                                     AND approved_amount <= claimed_amount))
) ENGINE=InnoDB;

-- who did what to a claim, so an argument about it has an answer
CREATE TABLE site_expense_events (
  id         INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  expense_id INT UNSIGNED  NOT NULL,
  action     VARCHAR(24)   NOT NULL,   -- SUBMITTED, APPROVED, REJECTED, RETURNED, EDITED
  amount     DECIMAL(18,2) NULL,       -- what was allowed, on a decision
  user_id    INT UNSIGNED  NULL,
  note       VARCHAR(400)  NULL,
  created_at TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY ix_expev_exp (expense_id),
  CONSTRAINT fk_expev_exp  FOREIGN KEY (expense_id) REFERENCES site_expenses (id) ON DELETE CASCADE,
  CONSTRAINT fk_expev_user FOREIGN KEY (user_id)    REFERENCES users (id)
) ENGINE=InnoDB;

SET FOREIGN_KEY_CHECKS = 1;
