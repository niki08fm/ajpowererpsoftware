-- =====================================================================
-- Two levels on everything Management has to see.
--
-- The process sheet marks five points with "Management Approval": the
-- BOQ, the site's PRN, the rate comparison, the purchase order and the
-- bill. At each of them the document is signed twice — the GM of the
-- site first, then Management — and the same person may not sign both
-- levels, which is the whole point of having two.
--
-- The chain lives in its own table rather than as more columns on five
-- documents, because it is one mechanism and it should be written once.
-- The document keeps its own status and its own event log; it simply
-- does not reach its approved state until the chain says both levels
-- are in. So every existing query still reads the document, and a
-- half-approved document is not "approved" anywhere.
-- =====================================================================

-- A BOQ waits between being prepared and being locked.
ALTER TABLE boqs
  MODIFY status ENUM('DRAFT','SUBMITTED','LOCKED') NOT NULL DEFAULT 'DRAFT';

-- A comparison is DECIDED by the buyer when a winner is picked, and
-- APPROVED when Management has signed it. A PO may only be raised off
-- an approved one.
ALTER TABLE comparisons
  MODIFY status ENUM('DRAFT','DECIDED','APPROVED') NOT NULL DEFAULT 'DRAFT';

-- A bill is prepared, signed, and only then raised to the client.
ALTER TABLE bills
  MODIFY status ENUM('DRAFT','SUBMITTED','RAISED','CANCELLED') NOT NULL DEFAULT 'DRAFT';

CREATE TABLE approval_chains (
  id            INT UNSIGNED NOT NULL AUTO_INCREMENT,
  doc_type      ENUM('BOQ','PRN','COMPARISON','PO','BILL') NOT NULL,
  doc_id        INT UNSIGNED NOT NULL,
  doc_no        VARCHAR(32)  NOT NULL,
  branch_id     INT UNSIGNED NOT NULL,
  site_id       INT UNSIGNED NULL,          -- a comparison has no one site
  levels        TINYINT UNSIGNED NOT NULL DEFAULT 2,
  level         TINYINT UNSIGNED NOT NULL DEFAULT 1,   -- the one waiting now
  status        ENUM('PENDING','APPROVED','RETURNED') NOT NULL DEFAULT 'PENDING',
  level1_by     INT UNSIGNED NULL,
  level1_at     DATETIME     NULL,
  level2_by     INT UNSIGNED NULL,
  level2_at     DATETIME     NULL,
  -- when it landed on the CURRENT approver's desk; lateness is time
  -- spent with the person who has to act, not since it was drafted
  waiting_since DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  raised_by     INT UNSIGNED NULL,
  created_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  -- one live chain per document: submitting again reopens this row
  UNIQUE KEY uq_chain_doc (doc_type, doc_id),
  KEY ix_chain_wait (status, level, branch_id),
  CONSTRAINT fk_chain_br   FOREIGN KEY (branch_id) REFERENCES branches (id),
  CONSTRAINT fk_chain_site FOREIGN KEY (site_id)   REFERENCES sites (id),
  CONSTRAINT fk_chain_l1   FOREIGN KEY (level1_by) REFERENCES users (id),
  CONSTRAINT fk_chain_l2   FOREIGN KEY (level2_by) REFERENCES users (id),
  CONSTRAINT fk_chain_by   FOREIGN KEY (raised_by) REFERENCES users (id)
) ENGINE=InnoDB;

-- Every signature, and every time it went back. The document's own log
-- keeps its own copy; this one is the chain's, so "who signed level 1
-- on the third attempt" is answerable.
CREATE TABLE approval_chain_events (
  id         INT UNSIGNED NOT NULL AUTO_INCREMENT,
  chain_id   INT UNSIGNED NOT NULL,
  level      TINYINT UNSIGNED NOT NULL,
  action     ENUM('SUBMITTED','APPROVED','RETURNED') NOT NULL,
  user_id    INT UNSIGNED NULL,
  note       VARCHAR(500) NULL,
  created_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY ix_ace_chain (chain_id, created_at),
  CONSTRAINT fk_ace_chain FOREIGN KEY (chain_id) REFERENCES approval_chains (id)
    ON DELETE CASCADE,
  CONSTRAINT fk_ace_user  FOREIGN KEY (user_id)  REFERENCES users (id)
) ENGINE=InnoDB;
