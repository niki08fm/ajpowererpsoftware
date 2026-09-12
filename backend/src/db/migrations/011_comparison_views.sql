-- =====================================================================
--  Landed cost.
--
--  The cheapest quote and the cheapest buy are regularly two different
--  suppliers, and showing that is the only reason a comparison sheet
--  exists. A rate is not a price until the discount comes off and the
--  freight goes on.
--
--      basic   = sum of rate x quantity, over every line quoted
--      less    = basic x discount%
--      plus    = freight, charged on the whole consignment
--      landed  = basic - discount + freight
--
--  Credit days are carried alongside rather than priced in — a buyer
--  reads 45 days against 15 differently depending on the month, and
--  inventing a cost of capital here would hide that judgement.
-- =====================================================================

-- which indents a comparison was raised from, so the quantities and
-- later the order can be traced back
CREATE TABLE comparison_indents (
  comparison_id INT UNSIGNED NOT NULL,
  indent_id     INT UNSIGNED NOT NULL,
  PRIMARY KEY (comparison_id, indent_id),
  KEY ix_cmi_ind (indent_id),
  CONSTRAINT fk_cmi_cmp FOREIGN KEY (comparison_id) REFERENCES comparisons (id) ON DELETE CASCADE,
  CONSTRAINT fk_cmi_ind FOREIGN KEY (indent_id)     REFERENCES indents (id)
) ENGINE=InnoDB;

CREATE OR REPLACE VIEW v_comparison_supplier AS
SELECT
  cs.id AS comparison_supplier_id,
  cs.comparison_id,
  cs.supplier_id,
  sp.name  AS supplier_name,
  sp.gstin AS supplier_gstin,
  cs.discount_pct, cs.freight, cs.credit_days, cs.note,
  COUNT(q.comparison_item_id)                       AS quoted_lines,
  (SELECT COUNT(*) FROM comparison_items ci
    WHERE ci.comparison_id = cs.comparison_id)      AS total_lines,
  COALESCE(ROUND(SUM(q.rate * ci.qty), 2), 0)       AS basic,
  COALESCE(ROUND(SUM(q.rate * ci.qty) * cs.discount_pct / 100, 2), 0) AS discount_amt,
  COALESCE(ROUND(SUM(q.rate * ci.qty)
                 - SUM(q.rate * ci.qty) * cs.discount_pct / 100
                 + cs.freight, 2), cs.freight)      AS landed
FROM comparison_suppliers cs
JOIN suppliers sp ON sp.id = cs.supplier_id
LEFT JOIN comparison_quotes q ON q.comparison_supplier_id = cs.id
LEFT JOIN comparison_items  ci ON ci.id = q.comparison_item_id
GROUP BY cs.id;

-- one row per sheet: who is cheapest on the quote, who is cheapest
-- once it lands, and whether those are the same supplier
CREATE OR REPLACE VIEW v_comparison_status AS
SELECT
  c.id AS comparison_id, c.doc_no, c.branch_id, c.title, c.status,
  c.chosen_supplier_id, c.decided_note, c.decided_at, c.created_at,
  ch.name AS chosen_supplier_name,
  (SELECT COUNT(*) FROM comparison_items ci WHERE ci.comparison_id = c.id)     AS item_count,
  (SELECT COUNT(*) FROM comparison_suppliers cs WHERE cs.comparison_id = c.id) AS supplier_count,
  (SELECT vs.supplier_id FROM v_comparison_supplier vs
    WHERE vs.comparison_id = c.id AND vs.quoted_lines > 0
    ORDER BY vs.landed LIMIT 1)  AS best_landed_supplier_id,
  (SELECT vs.supplier_name FROM v_comparison_supplier vs
    WHERE vs.comparison_id = c.id AND vs.quoted_lines > 0
    ORDER BY vs.landed LIMIT 1)  AS best_landed_supplier_name,
  (SELECT vs.landed FROM v_comparison_supplier vs
    WHERE vs.comparison_id = c.id AND vs.quoted_lines > 0
    ORDER BY vs.landed LIMIT 1)  AS best_landed,
  (SELECT vs.supplier_id FROM v_comparison_supplier vs
    WHERE vs.comparison_id = c.id AND vs.quoted_lines > 0
    ORDER BY vs.basic LIMIT 1)   AS best_quoted_supplier_id,
  (SELECT vs.supplier_name FROM v_comparison_supplier vs
    WHERE vs.comparison_id = c.id AND vs.quoted_lines > 0
    ORDER BY vs.basic LIMIT 1)   AS best_quoted_supplier_name
FROM comparisons c
LEFT JOIN suppliers ch ON ch.id = c.chosen_supplier_id;
