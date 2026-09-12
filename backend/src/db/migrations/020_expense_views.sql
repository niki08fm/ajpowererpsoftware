-- =====================================================================
--  WHAT A SITE HAS COST
--
--  Two things spend money and they are spent in completely different
--  ways. Material leaves a shelf and is priced by the store. Money
--  leaves a pocket and is priced by whoever is asking to be paid back.
--  One is derived, the other is claimed and approved.
--
--  v_cost_event is where they meet. One row per cost, signed, with a
--  date on it:
--
--    MATERIAL  every issue (+) and every return (-), at the rate
--              stamped on the line — so a day's material cost is that
--              day's net quantity at that day's central store rate
--    EXPENSE   every approved claim, at the amount approved, never at
--              the amount asked for
--
--  Sum it for a window and that is what the site cost in the window.
--  Sum everything up to a date and that is the cost to date. There is
--  no third place where either number is worked out differently.
--
--  Two things are deliberately absent. A claim nobody has decided is
--  not here, because money that may never be spent is not a cost. And
--  revenue is not here at all — until the client is billed there is
--  no revenue to net this against, which is why there is a cost
--  report and not yet a profit and loss.
-- =====================================================================

CREATE OR REPLACE VIEW v_site_expense AS
SELECT
  e.id AS expense_id, e.doc_no, e.site_id, e.branch_id,
  e.spent_on, e.description, e.paid_to, e.bill_no, e.note,
  e.claimed_amount,
  e.approved_amount,
  -- what it actually costs: nothing until it is approved
  CASE WHEN e.status = 'APPROVED' THEN COALESCE(e.approved_amount, 0) ELSE 0 END
    AS cost_amount,
  -- what was asked for and not allowed, which is the number anybody
  -- arguing about an expense policy actually wants
  CASE WHEN e.status = 'APPROVED'
       THEN e.claimed_amount - COALESCE(e.approved_amount, 0)
       WHEN e.status = 'REJECTED' THEN e.claimed_amount
       ELSE 0 END AS disallowed_amount,
  e.status,
  -- a partial approval is not a status of its own, it is a decision
  -- with two numbers on it. Derived, so it cannot disagree with them.
  CASE
    WHEN e.status <> 'APPROVED' THEN e.status
    WHEN COALESCE(e.approved_amount, 0) >= e.claimed_amount THEN 'APPROVED'
    WHEN COALESCE(e.approved_amount, 0) > 0 THEN 'PART_APPROVED'
    ELSE 'NIL_APPROVED'
  END COLLATE utf8mb4_unicode_ci AS outcome,
  e.category_id, c.name AS category,
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

-- =====================================================================
--  The one cost ledger.
-- =====================================================================
CREATE OR REPLACE VIEW v_cost_event AS
SELECT
  'MATERIAL' COLLATE utf8mb4_unicode_ci AS source,
  e.line_id     AS row_id,
  e.doc_id      AS ref_id,
  e.doc_no,
  e.event_date,
  e.site_id, e.branch_id,
  NULL          AS category_id,
  CASE WHEN e.source = 'ISSUE' THEN 'Material issued' ELSE 'Material returned' END
    COLLATE utf8mb4_unicode_ci AS category,
  e.item_id, e.item_code,
  e.item_name   COLLATE utf8mb4_unicode_ci AS label,
  e.uom,
  e.qty,
  e.rate,
  e.value       AS amount,
  e.person      AS who,
  e.recorded_by
FROM v_consumption_event e

UNION ALL

SELECT
  'EXPENSE' COLLATE utf8mb4_unicode_ci AS source,
  x.expense_id  AS row_id,
  x.expense_id  AS ref_id,
  x.doc_no,
  x.spent_on    AS event_date,
  x.site_id, x.branch_id,
  x.category_id,
  x.category    COLLATE utf8mb4_unicode_ci AS category,
  NULL          AS item_id,
  NULL          AS item_code,
  x.description COLLATE utf8mb4_unicode_ci AS label,
  NULL          AS uom,
  NULL          AS qty,
  NULL          AS rate,
  x.cost_amount AS amount,
  x.paid_to     AS who,
  NULL          AS recorded_by
FROM v_site_expense x
WHERE x.status = 'APPROVED' AND x.cost_amount <> 0;

-- What each site has cost, all time. Windows are summed from the
-- ledger itself; this is for the screens that want "ever".
CREATE OR REPLACE VIEW v_site_cost AS
SELECT
  c.site_id, s.name AS site_name, s.code AS site_code, s.branch_id,
  s.client_id, cl.name AS client_name, s.status AS site_status,
  SUM(CASE WHEN c.source = 'MATERIAL' THEN c.amount ELSE 0 END) AS material_cost,
  SUM(CASE WHEN c.source = 'EXPENSE'  THEN c.amount ELSE 0 END) AS expense_cost,
  SUM(c.amount) AS total_cost,
  MIN(c.event_date) AS first_on,
  MAX(c.event_date) AS last_on
FROM v_cost_event c
JOIN sites s      ON s.id = c.site_id
LEFT JOIN clients cl ON cl.id = s.client_id
GROUP BY c.site_id, s.name, s.code, s.branch_id, s.client_id, cl.name, s.status;
