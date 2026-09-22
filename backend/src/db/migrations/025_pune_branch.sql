-- =====================================================================
--  A third branch: Pune.
--
--  Added only where branches already exist. On a fresh install this file
--  runs before the seeds, and inserting here would hand Pune id 1 —
--  quietly moving Hyderabad and Bengaluru to 2 and 3 under everything
--  that refers to them by number. A fresh install gets Pune from the
--  seed instead, after the other two.
--
--  No GSTIN yet. It is a tax registration and is not guessed at; it goes
--  in when the real one is to hand.
-- =====================================================================
INSERT INTO branches (code, name, gstin, address)
SELECT 'PUN', 'Pune', NULL, 'Pune, Maharashtra'
  FROM DUAL
 WHERE EXISTS (SELECT 1 FROM branches)
   AND NOT EXISTS (SELECT 1 FROM branches WHERE code = 'PUN');
