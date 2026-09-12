-- =====================================================================
--  LABOUR IS AN EXPENSE, BUT IT IS NOT THE SAME KIND OF EXPENSE
--
--  Every cost statement anybody in this trade has ever read is laid
--  out the same way: material first, item by item; then labour; then
--  everything else. Not because labour is special in the ledger — it
--  is claimed and approved exactly like a lorry is — but because it
--  is the figure people compare against material, and burying it in
--  an alphabetical list of categories makes the one comparison the
--  statement exists for impossible to make.
--
--  So the category carries a kind. The report sections on it, and a
--  business that decides tomorrow that 'Hire charges' is really
--  labour moves one row rather than editing a query.
-- =====================================================================

ALTER TABLE expense_categories
  ADD COLUMN kind ENUM('LABOUR','OTHER') NOT NULL DEFAULT 'OTHER' AFTER name;

INSERT INTO expense_categories (name, norm_key, kind, sort_no) VALUES
  ('Labour',           'labour',           'LABOUR', 1),
  ('Sub-contract',     'sub contract',     'LABOUR', 2),
  ('Overtime',         'overtime',         'LABOUR', 3)
ON DUPLICATE KEY UPDATE kind = VALUES(kind);

CREATE OR REPLACE VIEW v_site_expense AS
SELECT
  e.id AS expense_id, e.doc_no, e.site_id, e.branch_id,
  e.spent_on, e.description, e.paid_to, e.bill_no, e.note,
  e.claimed_amount,
  e.approved_amount,
  CASE WHEN e.status = 'APPROVED' THEN COALESCE(e.approved_amount, 0) ELSE 0 END
    AS cost_amount,
  CASE WHEN e.status = 'APPROVED'
       THEN e.claimed_amount - COALESCE(e.approved_amount, 0)
       WHEN e.status = 'REJECTED' THEN e.claimed_amount
       ELSE 0 END AS disallowed_amount,
  e.status,
  CASE
    WHEN e.status <> 'APPROVED' THEN e.status
    WHEN COALESCE(e.approved_amount, 0) >= e.claimed_amount THEN 'APPROVED'
    WHEN COALESCE(e.approved_amount, 0) > 0 THEN 'PART_APPROVED'
    ELSE 'NIL_APPROVED'
  END COLLATE utf8mb4_unicode_ci AS outcome,
  e.category_id, c.name AS category, c.kind AS category_kind,
  s.name AS site_name, s.code AS site_code,
  ru.name AS raised_by_name, du.name AS decided_by_name,
  e.submitted_at, e.decided_at, e.decision_note, e.created_at,
  CASE WHEN e.status = 'SUBMITTED' AND e.submitted_at IS NOT NULL
       THEN DATEDIFF(CURDATE(), DATE(e.submitted_at)) ELSE 0 END AS days_waiting
FROM site_expenses e
JOIN expense_categories c ON c.id = e.category_id
JOIN sites s              ON s.id = e.site_id
LEFT JOIN users ru        ON ru.id = e.raised_by
LEFT JOIN users du        ON du.id = e.decided_by;

-- the cost ledger gains the same distinction, so the statement can be
-- sectioned without a second query
CREATE OR REPLACE VIEW v_cost_event AS
SELECT
  'MATERIAL' COLLATE utf8mb4_unicode_ci AS source,
  'MATERIAL' COLLATE utf8mb4_unicode_ci AS kind,
  e.line_id AS row_id, e.doc_id AS ref_id, e.doc_no, e.event_date,
  e.site_id, e.branch_id,
  NULL AS category_id,
  CASE WHEN e.source = 'ISSUE' THEN 'Material issued' ELSE 'Material returned' END
    COLLATE utf8mb4_unicode_ci AS category,
  e.item_id, e.item_code,
  e.item_name COLLATE utf8mb4_unicode_ci AS label,
  e.uom, e.qty, e.rate,
  e.value AS amount,
  e.person AS who,
  NULL AS note,
  e.recorded_by
FROM v_consumption_event e

UNION ALL

SELECT
  'EXPENSE' COLLATE utf8mb4_unicode_ci AS source,
  x.category_kind COLLATE utf8mb4_unicode_ci AS kind,
  x.expense_id AS row_id, x.expense_id AS ref_id, x.doc_no,
  x.spent_on AS event_date,
  x.site_id, x.branch_id,
  x.category_id,
  x.category COLLATE utf8mb4_unicode_ci AS category,
  NULL AS item_id, NULL AS item_code,
  x.description COLLATE utf8mb4_unicode_ci AS label,
  NULL AS uom, NULL AS qty, NULL AS rate,
  x.cost_amount AS amount,
  x.paid_to AS who,
  x.note COLLATE utf8mb4_unicode_ci AS note,
  NULL AS recorded_by
FROM v_site_expense x
WHERE x.status = 'APPROVED' AND x.cost_amount <> 0;
