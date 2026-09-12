-- =====================================================================
--  What consumption can answer.
--
--  There is one view here that matters, and the rest are conveniences
--  around it. v_consumption_event puts every issue line and every
--  return line on the same ledger, signed: an issue is positive, a
--  return is negative, and the net of the two is what the site spent.
--
--  That one shape answers four different questions that would
--  otherwise each want their own query and each drift from the others:
--
--    what moved, with filters          -> read it, filter it
--    everything about one item         -> filter by item
--    everything one person took        -> filter by person
--    consumed to date, by item         -> sum it between two dates
--
--  Money follows the same rule. value is qty x the rate stamped on the
--  line, so the sum of value over any window is the material cost of
--  that window, and a return inside the window takes its own cost back
--  out at the price it went out at.
-- =====================================================================

-- --------------------------------------------------- issue: a line
CREATE OR REPLACE VIEW v_consumption_line AS
SELECT
  cl.id AS line_id, cl.consumption_id,
  cl.item_id, cl.make_id, cl.boq_line_id,
  it.code AS item_code, it.name AS item_name, it.category_id,
  COALESCE(u2.code, u.code) AS uom,
  mk.name AS make_name,
  cl.qty, cl.rate, ROUND(cl.qty * cl.rate, 2) AS value,
  cl.remark
FROM consumption_lines cl
JOIN items it      ON it.id = cl.item_id
JOIN uoms  u       ON u.id  = it.uom_id
LEFT JOIN uoms u2  ON u2.id = cl.uom_id
LEFT JOIN makes mk ON mk.id = cl.make_id;

-- ------------------------------------------------- issue: a document
CREATE OR REPLACE VIEW v_consumption_status AS
SELECT
  c.id AS consumption_id, c.doc_no, c.site_id, c.branch_id, c.boq_id,
  c.used_on, c.status, c.note, c.purpose, c.created_at,
  c.issued_to_name, c.issued_to_user_id,
  COALESCE(tu.name, c.issued_to_name) AS issued_to,
  s.name AS site_name, s.code AS site_code,
  ru.name AS recorded_by_name,
  COUNT(l.line_id)            AS line_count,
  COALESCE(SUM(l.qty), 0)     AS issued_qty,
  COALESCE(SUM(l.value), 0)   AS issued_value,
  -- what has since come back against this slip
  COALESCE((SELECT SUM(rl.qty) FROM stock_return_lines rl
              JOIN stock_returns r ON r.id = rl.return_id
             WHERE r.consumption_id = c.id AND r.status = 'CONFIRMED'), 0) AS returned_qty,
  COALESCE((SELECT SUM(ROUND(rl.qty * rl.rate, 2)) FROM stock_return_lines rl
              JOIN stock_returns r ON r.id = rl.return_id
             WHERE r.consumption_id = c.id AND r.status = 'CONFIRMED'), 0) AS returned_value
FROM consumptions c
JOIN sites s       ON s.id  = c.site_id
LEFT JOIN users ru ON ru.id = c.recorded_by
LEFT JOIN users tu ON tu.id = c.issued_to_user_id
LEFT JOIN v_consumption_line l ON l.consumption_id = c.id
GROUP BY c.id;

-- -------------------------------------------------- return: a line
CREATE OR REPLACE VIEW v_return_line AS
SELECT
  rl.id AS line_id, rl.return_id,
  rl.item_id, rl.make_id,
  it.code AS item_code, it.name AS item_name, it.category_id,
  COALESCE(u2.code, u.code) AS uom,
  mk.name AS make_name,
  rl.qty, rl.rate, ROUND(rl.qty * rl.rate, 2) AS value,
  rl.remark
FROM stock_return_lines rl
JOIN items it      ON it.id = rl.item_id
JOIN uoms  u       ON u.id  = it.uom_id
LEFT JOIN uoms u2  ON u2.id = rl.uom_id
LEFT JOIN makes mk ON mk.id = rl.make_id;

-- ---------------------------------------------- return: a document
CREATE OR REPLACE VIEW v_return_status AS
SELECT
  r.id AS return_id, r.doc_no, r.site_id, r.branch_id,
  r.returned_on, r.status, r.reason, r.created_at,
  r.returned_by_name, r.returned_by_user_id,
  COALESCE(bu.name, r.returned_by_name) AS returned_by,
  r.consumption_id, c.doc_no AS against_doc_no,
  s.name AS site_name, s.code AS site_code,
  ru.name AS recorded_by_name,
  COUNT(l.line_id)          AS line_count,
  COALESCE(SUM(l.qty), 0)   AS returned_qty,
  COALESCE(SUM(l.value), 0) AS returned_value
FROM stock_returns r
JOIN sites s       ON s.id  = r.site_id
LEFT JOIN consumptions c ON c.id = r.consumption_id
LEFT JOIN users ru ON ru.id = r.recorded_by
LEFT JOIN users bu ON bu.id = r.returned_by_user_id
LEFT JOIN v_return_line l ON l.return_id = r.id
GROUP BY r.id;

-- =====================================================================
--  The one ledger. Issues positive, returns negative.
-- =====================================================================
CREATE OR REPLACE VIEW v_consumption_event AS
SELECT
  'ISSUE' COLLATE utf8mb4_unicode_ci AS source,
  l.line_id,
  c.id        AS doc_id,
  c.doc_no    AS doc_no,
  c.used_on   AS event_date,
  c.site_id, c.branch_id,
  l.item_id, l.make_id, l.boq_line_id,
  l.item_code, l.item_name, l.category_id, l.uom, l.make_name,
  l.qty       AS qty,
  l.rate,
  ROUND(l.qty * l.rate, 2) AS value,
  COALESCE(tu.name, c.issued_to_name) COLLATE utf8mb4_unicode_ci AS person,
  c.issued_to_user_id AS person_user_id,
  c.purpose   AS purpose,
  l.remark,
  c.recorded_by, c.created_at
FROM v_consumption_line l
JOIN consumptions c ON c.id = l.consumption_id
LEFT JOIN users tu  ON tu.id = c.issued_to_user_id
WHERE c.status = 'CONFIRMED'

UNION ALL

SELECT
  'RETURN' COLLATE utf8mb4_unicode_ci AS source,
  l.line_id,
  r.id        AS doc_id,
  r.doc_no    AS doc_no,
  r.returned_on AS event_date,
  r.site_id, r.branch_id,
  l.item_id, l.make_id, NULL AS boq_line_id,
  l.item_code, l.item_name, l.category_id, l.uom, l.make_name,
  -l.qty      AS qty,
  l.rate,
  -ROUND(l.qty * l.rate, 2) AS value,
  COALESCE(bu.name, r.returned_by_name) COLLATE utf8mb4_unicode_ci AS person,
  r.returned_by_user_id AS person_user_id,
  r.reason    AS purpose,
  l.remark,
  r.recorded_by, r.created_at
FROM v_return_line l
JOIN stock_returns r ON r.id = l.return_id
LEFT JOIN users bu   ON bu.id = r.returned_by_user_id
WHERE r.status = 'CONFIRMED';

-- Net consumption per site and item, all time. The screens that want a
-- date window sum v_consumption_event themselves; this is for the ones
-- that want "what has this site used, ever".
CREATE OR REPLACE VIEW v_site_consumption AS
SELECT
  e.site_id, e.item_id,
  e.item_code, e.item_name, e.category_id, e.uom,
  SUM(CASE WHEN e.source = 'ISSUE'  THEN e.qty   ELSE 0 END) AS issued_qty,
  SUM(CASE WHEN e.source = 'RETURN' THEN -e.qty  ELSE 0 END) AS returned_qty,
  SUM(e.qty)   AS consumed_qty,
  SUM(e.value) AS consumed_value,
  COUNT(DISTINCT CASE WHEN e.source = 'ISSUE' THEN e.doc_id END) AS issue_count,
  COUNT(DISTINCT e.person) AS people,
  MIN(e.event_date) AS first_on,
  MAX(e.event_date) AS last_on
FROM v_consumption_event e
-- the item columns come through a UNION, so the optimiser cannot see
-- that they follow from item_id and only_full_group_by wants them named
GROUP BY e.site_id, e.item_id, e.item_code, e.item_name, e.category_id, e.uom;
