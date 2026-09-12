-- The roll-up grouped by item but selected the item's own columns, and
-- only_full_group_by is right to object: it cannot know they are
-- functionally dependent across a join. They go in the GROUP BY.
--
-- The unit now comes from the item rather than the BOQ line it was
-- ordered against, which is where it belonged anyway — an item has one
-- unit however many lines ask for it.
CREATE OR REPLACE VIEW v_indent_rollup AS
SELECT
  il.indent_id,
  il.item_id,
  il.make_id,
  it.code AS item_code,
  it.name AS item_name,
  u.code  AS uom,
  mk.name AS make_name,
  SUM(il.qty) AS qty,
  COUNT(*)    AS from_lines,
  GROUP_CONCAT(bl.sno ORDER BY bl.sno SEPARATOR ', ') AS boq_snos
FROM indent_lines il
JOIN boq_lines bl ON bl.id = il.boq_line_id
JOIN items it     ON it.id = il.item_id
JOIN uoms u       ON u.id  = it.uom_id
LEFT JOIN makes mk ON mk.id = il.make_id
GROUP BY il.indent_id, il.item_id, il.make_id, it.code, it.name, u.code, mk.name;
