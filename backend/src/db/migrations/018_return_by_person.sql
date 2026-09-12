-- =====================================================================
--  A RETURN ANSWERS TO A PERSON, NOT TO A DOCUMENT
--
--  016 let a return name the issue it was undoing. In practice nobody
--  can. Material comes back off a site in a heap, days later, and the
--  man carrying it does not know which slip it left on — asking him to
--  pick one from a list means he picks the first one, and then the
--  link is worse than no link because it looks authoritative.
--
--  So the link goes. What the storekeeper does know, always, is who is
--  standing in front of him. That is the handle: a return names a
--  person, the screen offers what that person still has out, and the
--  cost comes back at the weighted average of what is still out for
--  that item — which is what it went out at, averaged over however
--  many slips it went out on.
--
--  Dropping the column costs one thing and it is worth naming:
--  "how much of THIS issue has come back" is no longer answerable.
--  It never really was. Better an honest gap than a wrong number.
-- =====================================================================

ALTER TABLE stock_returns
  DROP FOREIGN KEY fk_ret_con,
  DROP COLUMN consumption_id;

-- the header loses the two columns that counted returns against it
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
  COALESCE(SUM(l.value), 0)   AS issued_value
FROM consumptions c
JOIN sites s       ON s.id  = c.site_id
LEFT JOIN users ru ON ru.id = c.recorded_by
LEFT JOIN users tu ON tu.id = c.issued_to_user_id
LEFT JOIN v_consumption_line l ON l.consumption_id = c.id
GROUP BY c.id;

CREATE OR REPLACE VIEW v_return_status AS
SELECT
  r.id AS return_id, r.doc_no, r.site_id, r.branch_id,
  r.returned_on, r.status, r.reason, r.created_at,
  r.returned_by_name, r.returned_by_user_id,
  COALESCE(bu.name, r.returned_by_name) AS returned_by,
  s.name AS site_name, s.code AS site_code,
  ru.name AS recorded_by_name,
  COUNT(l.line_id)          AS line_count,
  COALESCE(SUM(l.qty), 0)   AS returned_qty,
  COALESCE(SUM(l.value), 0) AS returned_value
FROM stock_returns r
JOIN sites s       ON s.id  = r.site_id
LEFT JOIN users ru ON ru.id = r.recorded_by
LEFT JOIN users bu ON bu.id = r.returned_by_user_id
LEFT JOIN v_return_line l ON l.return_id = r.id
GROUP BY r.id;

-- =====================================================================
--  What one person still has out.
--
--  Issued to them, less returned by them, per item. This is the list
--  the return screen offers, and the cap it enforces.
-- =====================================================================
CREATE OR REPLACE VIEW v_person_outstanding AS
SELECT
  e.site_id, e.person, e.item_id,
  e.item_code, e.item_name, e.uom, e.category_id,
  SUM(CASE WHEN e.source = 'ISSUE'  THEN e.qty  ELSE 0 END) AS issued_qty,
  SUM(CASE WHEN e.source = 'RETURN' THEN -e.qty ELSE 0 END) AS returned_qty,
  SUM(e.qty)   AS open_qty,
  SUM(e.value) AS open_value,
  ROUND(CASE WHEN SUM(e.qty) > 0 THEN SUM(e.value) / SUM(e.qty) ELSE 0 END, 2) AS rate,
  MAX(CASE WHEN e.source = 'ISSUE' THEN e.event_date END) AS last_issued_on
FROM v_consumption_event e
WHERE e.person IS NOT NULL
GROUP BY e.site_id, e.person, e.item_id,
         e.item_code, e.item_name, e.uom, e.category_id;
