-- =====================================================================
--  Every project has a general manager, and it is not optional.
--
--  A site already records who runs it day to day (head) and who keeps
--  its material (keeper). The GM is the third: the person the project
--  answers to. Recorded now; what he signs is a later decision, and
--  that decision is much easier to take once the column exists.
--
--  A STORE has no GM, the same way it has no client — it is a branch
--  warehouse, not a project.
-- =====================================================================

ALTER TABLE sites
  ADD COLUMN gm_user_id INT UNSIGNED NULL AFTER keeper_user_id,
  ADD CONSTRAINT fk_site_gm FOREIGN KEY (gm_user_id) REFERENCES users (id);

-- sites that predate the column get the first person in Management, so
-- the constraint below can be added without a gap
UPDATE sites
   SET gm_user_id = (SELECT id FROM users
                      WHERE department = 'Management' AND is_active = 1
                      ORDER BY id LIMIT 1)
 WHERE site_type = 'SITE' AND gm_user_id IS NULL;

-- and from here on the database itself insists
ALTER TABLE sites
  ADD CONSTRAINT ck_site_gm CHECK (site_type = 'STORE' OR gm_user_id IS NOT NULL);
