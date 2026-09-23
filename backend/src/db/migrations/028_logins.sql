-- =====================================================================
--  Logins.
--
--  Until now "who you are" was a dropdown. From here a person signs in
--  with an email and a password, and what they see and may do follows
--  from their role.
--
--  The role is the `department` column, which already carried it in all
--  but name — approvals key off 'Management'. The departments are:
--
--    Management       everything, read-only; signs level 2; makes logins
--    General Manager  the same, but only the projects they are GM of
--    Planning         sites, work orders, BOQs, clients
--    Site             indents, site store, expenses — their sites only;
--                     only a site's store keeper issues its material
--    Store            PRNs, GRNs, challans, stock
--    Procurement      the buy list, comparisons, orders, suppliers
--    Billing          bills
--
--  The password is never stored, only its scrypt hash (see
--  lib/password.js). A session is a random token handed to the browser;
--  only its SHA-256 is kept here, so a copy of this table signs nobody in.
-- =====================================================================

ALTER TABLE users
  ADD COLUMN password_hash VARCHAR(255) NULL AFTER phone,
  ADD COLUMN last_login_at DATETIME     NULL AFTER is_active;

CREATE TABLE user_sessions (
  token_hash   CHAR(64)     NOT NULL,
  user_id      INT UNSIGNED NOT NULL,
  created_at   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at   DATETIME     NOT NULL,
  PRIMARY KEY (token_hash),
  KEY ix_sess_user (user_id),
  CONSTRAINT fk_sess_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- Three departments had nobody in them. One person each, so every
-- login in the trial can be tried. Management can add the rest.
INSERT INTO users (emp_code, name, email, department)
SELECT 'E007', 'Kavya Reddy', 'kavya@ajpower.test', 'General Manager'
 WHERE NOT EXISTS (SELECT 1 FROM users WHERE emp_code = 'E007');
INSERT INTO users (emp_code, name, email, department)
SELECT 'E008', 'Prakash Jain', 'prakash@ajpower.test', 'Procurement'
 WHERE NOT EXISTS (SELECT 1 FROM users WHERE emp_code = 'E008');
INSERT INTO users (emp_code, name, email, department)
SELECT 'E009', 'Lakshmi Devi', 'lakshmi@ajpower.test', 'Billing'
 WHERE NOT EXISTS (SELECT 1 FROM users WHERE emp_code = 'E009');
