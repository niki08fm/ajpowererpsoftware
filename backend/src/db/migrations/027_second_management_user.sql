-- The second signature needs a second signatory.
--
-- Two-level approval means Management signs after the GM, and the same
-- person may not do both. A database seeded before that rule existed
-- has exactly one Management user, so every chain would stall at level
-- two with nobody able to sign it.
--
-- Seeds only load into an empty database, so this cannot be a seed
-- change: it has to reach the databases that already exist.
INSERT INTO users (emp_code, name, email, department)
SELECT 'E006', 'Deepak Shetty', 'deepak@ajpower.test', 'Management'
 WHERE NOT EXISTS (SELECT 1 FROM users WHERE emp_code = 'E006');
