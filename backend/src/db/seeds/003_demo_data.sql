-- =====================================================================
--  DEMO DATA — 3 work orders, end-to-end ERP workflow
--
--  Work Order 1: GMR T2 Terminal Expansion (HYD) — full lifecycle
--    WO → BOQ → Indent → Comparison → PO → GRN → DC → Issue → Bill
--
--  Work Order 2: Brigade Nanakramguda Office (HYD) — mid-cycle
--    WO → BOQ → Indent → PO (approved) → GRN → DC (dispatched)
--
--  Work Order 3: Salarpuria Tech Park Phase 2 (BLR) — early stage
--    WO → BOQ → Indent (submitted, awaiting approval)
--
--  Expenses spread across WO1 and WO2.
--
--  Re-run safe: every block uses ON DUPLICATE KEY or explicit checks.
--  All document numbers use FY 25-26 (dates in June–Dec 2025).
-- =====================================================================

SET FOREIGN_KEY_CHECKS = 0;
SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;

-- =====================================================================
-- BLOCK 0 — doc_counters & item_code_counters bootstrap
-- =====================================================================

INSERT INTO item_code_counters (category_code, last_no) VALUES
  ('ST', 3),
  ('GD', 2)
ON DUPLICATE KEY UPDATE last_no = GREATEST(last_no, VALUES(last_no));

INSERT INTO doc_counters (doc_type, fy, last_no) VALUES
  ('WO',  '25-26', 3),
  ('BOQ', '25-26', 3),
  ('IND', '25-26', 5),
  ('CMP', '25-26', 2),
  ('PO',  '25-26', 3),
  ('GRN', '25-26', 2),
  ('DC',  '25-26', 2),
  ('CON', '25-26', 3),
  ('RET', '25-26', 1),
  ('EXP', '25-26', 6),
  ('RA',  '25-26', 2)
ON DUPLICATE KEY UPDATE last_no = GREATEST(last_no, VALUES(last_no));

-- =====================================================================
-- BLOCK 1 — SUPPLIERS
-- =====================================================================

INSERT INTO suppliers (code, name, norm_key, sort_key, gstin, address, contact_name, contact_phone, terms_days, status, created_by)
VALUES
  ('SUP-0001', 'Universal Electricals Pvt Ltd',
   'universal electricals pvt ltd', 'electricals pvt universal',
   '36AABCU1234A1Z5', 'Plot 45, IDA Nacharam, Hyderabad',
   'Rajesh Gupta', '9876543210', 30, 'ACTIVE', 1),
  ('SUP-0002', 'Prakash Cables & Wires',
   'prakash cables and wires', 'cables prakash wires',
   '36AABCP5678A1Z5', '12-A, ECIL Cross Roads, Hyderabad',
   'Sunita Prakash', '9845612300', 45, 'ACTIVE', 1),
  ('SUP-0003', 'Deccan Electrical Suppliers',
   'deccan electrical suppliers', 'deccan electrical suppliers',
   '29AABCD9012A1Z5', '#78, M.G. Road, Bengaluru',
   'Vivek Nair', '9900112233', 30, 'ACTIVE', 1)
ON DUPLICATE KEY UPDATE name = VALUES(name);

-- =====================================================================
-- BLOCK 2 — SITES: 2 stores + 3 project sites
-- =====================================================================

-- Store 1 (HYD Central — is_central=1)
INSERT INTO sites (code, name, norm_key, sort_key, site_type, branch_id,
                   client_id, head_user_id, keeper_user_id, gm_user_id,
                   is_central, location, start_date, status)
SELECT 'GD-0001', 'HYD Central Store',
       'hyd central store', 'central hyd store',
       'STORE',
       (SELECT id FROM branches WHERE code = 'HYD'),
       NULL,
       (SELECT id FROM users WHERE emp_code = 'E001'),
       (SELECT id FROM users WHERE emp_code = 'E003'),
       NULL,
       1, 'Kukatpally, Hyderabad', '2024-04-01', 'ACTIVE'
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM sites WHERE code = 'GD-0001');

-- Store 2 (BLR store)
INSERT INTO sites (code, name, norm_key, sort_key, site_type, branch_id,
                   client_id, head_user_id, keeper_user_id, gm_user_id,
                   is_central, location, start_date, status)
SELECT 'GD-0002', 'BLR Central Store',
       'blr central store', 'blr central store',
       'STORE',
       (SELECT id FROM branches WHERE code = 'BLR'),
       NULL,
       (SELECT id FROM users WHERE emp_code = 'E001'),
       (SELECT id FROM users WHERE emp_code = 'E003'),
       NULL,
       1, 'Yeshwanthpur, Bengaluru', '2024-04-01', 'ACTIVE'
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM sites WHERE code = 'GD-0002');

-- Site 1: GMR T2 Terminal Expansion (HYD)
INSERT INTO sites (code, name, norm_key, sort_key, site_type, branch_id,
                   client_id, head_user_id, keeper_user_id, gm_user_id,
                   is_central, location, billing_address, start_date, target_completion, status)
SELECT 'ST-0001', 'GMR T2 Terminal Expansion',
       'gmr t2 terminal expansion', 'expansion gmr t2 terminal',
       'SITE',
       (SELECT id FROM branches WHERE code = 'HYD'),
       (SELECT id FROM clients WHERE norm_key = 'gmr infrastructure ltd'),
       (SELECT id FROM users WHERE emp_code = 'E002'),
       (SELECT id FROM users WHERE emp_code = 'E003'),
       (SELECT id FROM users WHERE emp_code = 'E005'),
       0,
       'Shamshabad, Hyderabad',
       'GMR Infrastructure Ltd, T2 Terminal Building, Shamshabad, Hyderabad - 500108',
       '2025-06-01', '2026-03-31', 'ACTIVE'
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM sites WHERE code = 'ST-0001');

-- Site 2: Brigade Nanakramguda Office (HYD)
INSERT INTO sites (code, name, norm_key, sort_key, site_type, branch_id,
                   client_id, head_user_id, keeper_user_id, gm_user_id,
                   is_central, location, billing_address, start_date, target_completion, status)
SELECT 'ST-0002', 'Brigade Nanakramguda Office Tower',
       'brigade nanakramguda office tower', 'brigade nanakramguda office tower',
       'SITE',
       (SELECT id FROM branches WHERE code = 'HYD'),
       (SELECT id FROM clients WHERE norm_key = 'brigade enterprises ltd'),
       (SELECT id FROM users WHERE emp_code = 'E004'),
       (SELECT id FROM users WHERE emp_code = 'E003'),
       (SELECT id FROM users WHERE emp_code = 'E005'),
       0,
       'Nanakramguda, Financial District, Hyderabad',
       'Brigade Enterprises Ltd, Nanakramguda, Hyderabad - 500032',
       '2025-07-15', '2026-06-30', 'ACTIVE'
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM sites WHERE code = 'ST-0002');

-- Site 3: Salarpuria Tech Park (BLR)
INSERT INTO sites (code, name, norm_key, sort_key, site_type, branch_id,
                   client_id, head_user_id, keeper_user_id, gm_user_id,
                   is_central, location, billing_address, start_date, target_completion, status)
SELECT 'ST-0003', 'Salarpuria Tech Park Phase 2',
       'salarpuria tech park phase 2', '2 park phase salarpuria tech',
       'SITE',
       (SELECT id FROM branches WHERE code = 'BLR'),
       (SELECT id FROM clients WHERE norm_key = 'group salarpuria sattva'),
       (SELECT id FROM users WHERE emp_code = 'E004'),
       (SELECT id FROM users WHERE emp_code = 'E003'),
       (SELECT id FROM users WHERE emp_code = 'E005'),
       0,
       'Whitefield, Bengaluru',
       'Salarpuria Sattva Group, Tech Park Phase 2, Whitefield, Bengaluru - 560066',
       '2025-08-01', '2026-09-30', 'ACTIVE'
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM sites WHERE code = 'ST-0003');

-- Site teams
INSERT IGNORE INTO site_team (site_id, user_id)
SELECT s.id, u.id
FROM sites s, users u
WHERE (s.code = 'ST-0001' AND u.emp_code IN ('E001','E002','E003','E005'))
   OR (s.code = 'ST-0002' AND u.emp_code IN ('E001','E004','E003','E005'))
   OR (s.code = 'ST-0003' AND u.emp_code IN ('E001','E004','E003','E005'));

-- =====================================================================
-- BLOCK 3 — WORK ORDERS
-- =====================================================================

-- WO1: GMR T2 (full lifecycle)
INSERT INTO work_orders (doc_no, site_id, branch_id, client_wo_no, wo_date, status, created_by)
SELECT 'WO/25-26/0001',
       (SELECT id FROM sites WHERE code = 'ST-0001'),
       (SELECT id FROM branches WHERE code = 'HYD'),
       'GMR/EL/WO/2025/047', '2025-06-10', 'LOCKED',
       (SELECT id FROM users WHERE emp_code = 'E001')
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM work_orders WHERE doc_no = 'WO/25-26/0001');

INSERT INTO work_order_lines (work_order_id, sno, description, uom_id, qty, supply_rate, inst_rate)
SELECT wo.id, 1,
       'Supply and install light points (concealed conduit, FR-LSH wiring)',
       (SELECT id FROM uoms WHERE code = "No's"),
       200.000, 520.00, 380.00
FROM work_orders wo WHERE wo.doc_no = 'WO/25-26/0001'
  AND NOT EXISTS (SELECT 1 FROM work_order_lines wol WHERE wol.work_order_id = wo.id AND wol.sno = 1);

INSERT INTO work_order_lines (work_order_id, sno, description, uom_id, qty, supply_rate, inst_rate)
SELECT wo.id, 2,
       'Supply and install 1.5 sq mm FR-LSH wiring (all colours)',
       (SELECT id FROM uoms WHERE code = 'Mtrs'),
       8000.000, 32.00, 14.00
FROM work_orders wo WHERE wo.doc_no = 'WO/25-26/0001'
  AND NOT EXISTS (SELECT 1 FROM work_order_lines wol WHERE wol.work_order_id = wo.id AND wol.sno = 2);

INSERT INTO work_order_lines (work_order_id, sno, description, uom_id, qty, supply_rate, inst_rate)
SELECT wo.id, 3,
       'Supply and install MCBs (10A SP C-curve) in distribution boards',
       (SELECT id FROM uoms WHERE code = "No's"),
       120.000, 280.00, 95.00
FROM work_orders wo WHERE wo.doc_no = 'WO/25-26/0001'
  AND NOT EXISTS (SELECT 1 FROM work_order_lines wol WHERE wol.work_order_id = wo.id AND wol.sno = 3);

-- WO2: Brigade Nanakramguda (mid-cycle)
INSERT INTO work_orders (doc_no, site_id, branch_id, client_wo_no, wo_date, status, created_by)
SELECT 'WO/25-26/0002',
       (SELECT id FROM sites WHERE code = 'ST-0002'),
       (SELECT id FROM branches WHERE code = 'HYD'),
       'BEL/EL/WO/2025/012', '2025-07-18', 'LOCKED',
       (SELECT id FROM users WHERE emp_code = 'E001')
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM work_orders WHERE doc_no = 'WO/25-26/0002');

INSERT INTO work_order_lines (work_order_id, sno, description, uom_id, qty, supply_rate, inst_rate)
SELECT wo.id, 1,
       'Supply and install 3.5C x 50 SQ MM armoured cable (LT feeder)',
       (SELECT id FROM uoms WHERE code = 'Mtrs'),
       450.000, 620.00, 85.00
FROM work_orders wo WHERE wo.doc_no = 'WO/25-26/0002'
  AND NOT EXISTS (SELECT 1 FROM work_order_lines wol WHERE wol.work_order_id = wo.id AND wol.sno = 1);

INSERT INTO work_order_lines (work_order_id, sno, description, uom_id, qty, supply_rate, inst_rate)
SELECT wo.id, 2,
       'Supply and install junction boxes (GI, 110x110x50mm)',
       (SELECT id FROM uoms WHERE code = "No's"),
       80.000, 450.00, 120.00
FROM work_orders wo WHERE wo.doc_no = 'WO/25-26/0002'
  AND NOT EXISTS (SELECT 1 FROM work_order_lines wol WHERE wol.work_order_id = wo.id AND wol.sno = 2);

-- WO3: Salarpuria BLR (early stage)
INSERT INTO work_orders (doc_no, site_id, branch_id, client_wo_no, wo_date, status, created_by)
SELECT 'WO/25-26/0003',
       (SELECT id FROM sites WHERE code = 'ST-0003'),
       (SELECT id FROM branches WHERE code = 'BLR'),
       'SSG/EL/WO/2025/003', '2025-08-05', 'LOCKED',
       (SELECT id FROM users WHERE emp_code = 'E001')
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM work_orders WHERE doc_no = 'WO/25-26/0003');

INSERT INTO work_order_lines (work_order_id, sno, description, uom_id, qty, supply_rate, inst_rate)
SELECT wo.id, 1,
       'Supply and install 4C x 16 SQ MM copper armoured cable (sub-distribution)',
       (SELECT id FROM uoms WHERE code = 'Mtrs'),
       600.000, 850.00, 110.00
FROM work_orders wo WHERE wo.doc_no = 'WO/25-26/0003'
  AND NOT EXISTS (SELECT 1 FROM work_order_lines wol WHERE wol.work_order_id = wo.id AND wol.sno = 1);

INSERT INTO work_order_lines (work_order_id, sno, description, uom_id, qty, supply_rate, inst_rate)
SELECT wo.id, 2,
       'Supply and install light points (surface conduit, 1.5 sq mm wiring)',
       (SELECT id FROM uoms WHERE code = "No's"),
       350.000, 480.00, 340.00
FROM work_orders wo WHERE wo.doc_no = 'WO/25-26/0003'
  AND NOT EXISTS (SELECT 1 FROM work_order_lines wol WHERE wol.work_order_id = wo.id AND wol.sno = 2);

-- =====================================================================
-- BLOCK 4 — BOQs
-- =====================================================================

-- BOQ1: GMR T2 (LOCKED)
INSERT INTO boqs (doc_no, site_id, branch_id, work_order_id, status, over_allow, over_pct, submitted_at, created_by)
SELECT 'BOQ/25-26/0001',
       (SELECT id FROM sites WHERE code = 'ST-0001'),
       (SELECT id FROM branches WHERE code = 'HYD'),
       (SELECT id FROM work_orders WHERE doc_no = 'WO/25-26/0001'),
       'LOCKED', 1, 10.00, '2025-06-18 10:30:00',
       (SELECT id FROM users WHERE emp_code = 'E001')
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM boqs WHERE doc_no = 'BOQ/25-26/0001');

-- BOQ2: Brigade (LOCKED)
INSERT INTO boqs (doc_no, site_id, branch_id, work_order_id, status, over_allow, over_pct, submitted_at, created_by)
SELECT 'BOQ/25-26/0002',
       (SELECT id FROM sites WHERE code = 'ST-0002'),
       (SELECT id FROM branches WHERE code = 'HYD'),
       (SELECT id FROM work_orders WHERE doc_no = 'WO/25-26/0002'),
       'LOCKED', 0, 0.00, '2025-07-22 14:00:00',
       (SELECT id FROM users WHERE emp_code = 'E001')
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM boqs WHERE doc_no = 'BOQ/25-26/0002');

-- BOQ3: Salarpuria (DRAFT)
INSERT INTO boqs (doc_no, site_id, branch_id, work_order_id, status, over_allow, over_pct, created_by)
SELECT 'BOQ/25-26/0003',
       (SELECT id FROM sites WHERE code = 'ST-0003'),
       (SELECT id FROM branches WHERE code = 'BLR'),
       (SELECT id FROM work_orders WHERE doc_no = 'WO/25-26/0003'),
       'DRAFT', 1, 5.00,
       (SELECT id FROM users WHERE emp_code = 'E001')
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM boqs WHERE doc_no = 'BOQ/25-26/0003');

-- =====================================================================
-- BLOCK 5 — BOQ_WO_LINES  (one per WO line per BOQ)
-- =====================================================================

-- BOQ1 links to WO1 (3 WO lines)
INSERT IGNORE INTO boq_wo_lines (boq_id, wo_line_id, est_qty, var_qty)
SELECT b.id, wol.id, wol.qty, 0
FROM boqs b
JOIN work_orders wo  ON wo.id  = b.work_order_id
JOIN work_order_lines wol ON wol.work_order_id = wo.id
WHERE b.doc_no = 'BOQ/25-26/0001';

-- BOQ2 links to WO2 (2 WO lines)
INSERT IGNORE INTO boq_wo_lines (boq_id, wo_line_id, est_qty, var_qty)
SELECT b.id, wol.id, wol.qty, 0
FROM boqs b
JOIN work_orders wo  ON wo.id  = b.work_order_id
JOIN work_order_lines wol ON wol.work_order_id = wo.id
WHERE b.doc_no = 'BOQ/25-26/0002';

-- BOQ3 links to WO3 (2 WO lines)
INSERT IGNORE INTO boq_wo_lines (boq_id, wo_line_id, est_qty, var_qty)
SELECT b.id, wol.id, wol.qty, 0
FROM boqs b
JOIN work_orders wo  ON wo.id  = b.work_order_id
JOIN work_order_lines wol ON wol.work_order_id = wo.id
WHERE b.doc_no = 'BOQ/25-26/0003';

-- =====================================================================
-- BLOCK 6 — BOQ_LINES  (items under each WO line)
--
--  BOQ1 / WO1-Line1: light points
--    1a  20MM CONDUIT-HMS-BLACK (CDT-0040)  id=340  3m/point
--    1b  20MM 1-WAY JB-BLACK   (CDT-0006)  id=306  1 no/point
--    1c  1.5 SQMM WIRE BLACK FR-LSH (WIR-0013) id=2568  3m/point
--
--  BOQ1 / WO1-Line2: 1.5 sqmm wiring
--    2a  1.5 SQMM WIRE BLACK (WIR-0013) id=2568  1m/m
--    2b  1.5 SQMM WIRE BLUE  (WIR-0015) id=2570  1m/m
--    2c  1.5 SQMM WIRE GREEN (WIR-0017) id=2572  0.2m/m  (earth)
--
--  BOQ1 / WO1-Line3: MCBs
--    3a  10A SP C CURVE MCB (MCB-0007) id=1169  1no/no
--
--  BOQ2 / WO2-Line1: armoured cable
--    1a  3.5C x 50 SQ MM ALUM AR CABLE (ARM-0015) id=15  1m/m
--
--  BOQ2 / WO2-Line2: junction boxes
--    2a  110X110X50MM GI JB (JBX-0001) id=1133  1no/no
--
--  BOQ3 / WO3-Line1: 4C x 16 cable
--    1a  4C X 16 SQ MM COPPER AR CABLE (ARM-0035) id=34  1m/m
--
--  BOQ3 / WO3-Line2: light points (surface conduit)
--    2a  20MM CONDUIT-MMS-GREY (CDT-0045) id=345  3m/point
--    2b  1.5 SQMM WIRE BLACK (WIR-0013) id=2568  4m/point
-- =====================================================================

-- Helper: insert only if the sno doesn't already exist in this BOQ
-- BOQ1 / WO1-Line1 items
INSERT IGNORE INTO boq_lines (boq_id, boq_wo_line_id, sno, item_id, make_id, uom_id,
                               item_qty, boq_qty, est_qty, var_qty)
SELECT b.id, bwl.id, '1a',
       340, NULL,                               -- CDT-0040 conduit
       (SELECT id FROM uoms WHERE code = 'Mtrs'),
       3.000, 3.000 * wol.qty, ROUND(3.000 * wol.qty * 1.05, 3), 0
FROM boqs b
JOIN boq_wo_lines bwl ON bwl.boq_id = b.id
JOIN work_order_lines wol ON wol.id = bwl.wo_line_id
WHERE b.doc_no = 'BOQ/25-26/0001' AND wol.sno = 1;

INSERT IGNORE INTO boq_lines (boq_id, boq_wo_line_id, sno, item_id, make_id, uom_id,
                               item_qty, boq_qty, est_qty, var_qty)
SELECT b.id, bwl.id, '1b',
       306, NULL,                               -- CDT-0006 JB 1-way black
       (SELECT id FROM uoms WHERE code = "No's"),
       1.000, wol.qty, ROUND(wol.qty * 1.05, 3), 0
FROM boqs b
JOIN boq_wo_lines bwl ON bwl.boq_id = b.id
JOIN work_order_lines wol ON wol.id = bwl.wo_line_id
WHERE b.doc_no = 'BOQ/25-26/0001' AND wol.sno = 1;

INSERT IGNORE INTO boq_lines (boq_id, boq_wo_line_id, sno, item_id, make_id, uom_id,
                               item_qty, boq_qty, est_qty, var_qty)
SELECT b.id, bwl.id, '1c',
       2568,                                    -- WIR-0013 1.5mm wire black
       (SELECT id FROM makes WHERE name = 'POLY CAB'),
       (SELECT id FROM uoms WHERE code = 'Mtrs'),
       3.000, 3.000 * wol.qty, ROUND(3.000 * wol.qty * 1.05, 3), 0
FROM boqs b
JOIN boq_wo_lines bwl ON bwl.boq_id = b.id
JOIN work_order_lines wol ON wol.id = bwl.wo_line_id
WHERE b.doc_no = 'BOQ/25-26/0001' AND wol.sno = 1;

-- BOQ1 / WO1-Line2 items
INSERT IGNORE INTO boq_lines (boq_id, boq_wo_line_id, sno, item_id, make_id, uom_id,
                               item_qty, boq_qty, est_qty, var_qty)
SELECT b.id, bwl.id, '2a',
       2568,
       (SELECT id FROM makes WHERE name = 'POLY CAB'),
       (SELECT id FROM uoms WHERE code = 'Mtrs'),
       1.000, wol.qty, ROUND(wol.qty * 1.05, 3), 0
FROM boqs b
JOIN boq_wo_lines bwl ON bwl.boq_id = b.id
JOIN work_order_lines wol ON wol.id = bwl.wo_line_id
WHERE b.doc_no = 'BOQ/25-26/0001' AND wol.sno = 2;

INSERT IGNORE INTO boq_lines (boq_id, boq_wo_line_id, sno, item_id, make_id, uom_id,
                               item_qty, boq_qty, est_qty, var_qty)
SELECT b.id, bwl.id, '2b',
       2570,                                    -- WIR-0015 1.5mm wire blue
       (SELECT id FROM makes WHERE name = 'POLY CAB'),
       (SELECT id FROM uoms WHERE code = 'Mtrs'),
       1.000, wol.qty, ROUND(wol.qty * 1.05, 3), 0
FROM boqs b
JOIN boq_wo_lines bwl ON bwl.boq_id = b.id
JOIN work_order_lines wol ON wol.id = bwl.wo_line_id
WHERE b.doc_no = 'BOQ/25-26/0001' AND wol.sno = 2;

INSERT IGNORE INTO boq_lines (boq_id, boq_wo_line_id, sno, item_id, make_id, uom_id,
                               item_qty, boq_qty, est_qty, var_qty)
SELECT b.id, bwl.id, '2c',
       2572,                                    -- WIR-0017 1.5mm wire green
       (SELECT id FROM makes WHERE name = 'POLY CAB'),
       (SELECT id FROM uoms WHERE code = 'Mtrs'),
       0.200, ROUND(0.200 * wol.qty, 3), ROUND(0.200 * wol.qty * 1.05, 3), 0
FROM boqs b
JOIN boq_wo_lines bwl ON bwl.boq_id = b.id
JOIN work_order_lines wol ON wol.id = bwl.wo_line_id
WHERE b.doc_no = 'BOQ/25-26/0001' AND wol.sno = 2;

-- BOQ1 / WO1-Line3 items
INSERT IGNORE INTO boq_lines (boq_id, boq_wo_line_id, sno, item_id, make_id, uom_id,
                               item_qty, boq_qty, est_qty, var_qty)
SELECT b.id, bwl.id, '3a',
       1169,                                    -- MCB-0007 10A SP C
       (SELECT id FROM makes WHERE name = 'schneider'),
       (SELECT id FROM uoms WHERE code = "No's"),
       1.000, wol.qty, ROUND(wol.qty * 1.02, 3), 0
FROM boqs b
JOIN boq_wo_lines bwl ON bwl.boq_id = b.id
JOIN work_order_lines wol ON wol.id = bwl.wo_line_id
WHERE b.doc_no = 'BOQ/25-26/0001' AND wol.sno = 3;

-- BOQ2 / WO2-Line1
INSERT IGNORE INTO boq_lines (boq_id, boq_wo_line_id, sno, item_id, make_id, uom_id,
                               item_qty, boq_qty, est_qty, var_qty)
SELECT b.id, bwl.id, '1a',
       15,                                      -- ARM-0015 3.5C x 50 SQ MM
       (SELECT id FROM makes WHERE name = 'KEI'),
       (SELECT id FROM uoms WHERE code = 'Mtrs'),
       1.000, wol.qty, ROUND(wol.qty * 1.03, 3), 0
FROM boqs b
JOIN boq_wo_lines bwl ON bwl.boq_id = b.id
JOIN work_order_lines wol ON wol.id = bwl.wo_line_id
WHERE b.doc_no = 'BOQ/25-26/0002' AND wol.sno = 1;

-- BOQ2 / WO2-Line2
INSERT IGNORE INTO boq_lines (boq_id, boq_wo_line_id, sno, item_id, make_id, uom_id,
                               item_qty, boq_qty, est_qty, var_qty)
SELECT b.id, bwl.id, '2a',
       1133,                                    -- JBX-0001 GI JB 110x110
       NULL,
       (SELECT id FROM uoms WHERE code = "No's"),
       1.000, wol.qty, wol.qty, 0
FROM boqs b
JOIN boq_wo_lines bwl ON bwl.boq_id = b.id
JOIN work_order_lines wol ON wol.id = bwl.wo_line_id
WHERE b.doc_no = 'BOQ/25-26/0002' AND wol.sno = 2;

-- BOQ3 / WO3-Line1
INSERT IGNORE INTO boq_lines (boq_id, boq_wo_line_id, sno, item_id, make_id, uom_id,
                               item_qty, boq_qty, est_qty, var_qty)
SELECT b.id, bwl.id, '1a',
       34,                                      -- ARM-0035 4C x 16 SQ MM copper
       (SELECT id FROM makes WHERE name = 'Finolex'),
       (SELECT id FROM uoms WHERE code = 'Mtrs'),
       1.000, wol.qty, ROUND(wol.qty * 1.05, 3), 0
FROM boqs b
JOIN boq_wo_lines bwl ON bwl.boq_id = b.id
JOIN work_order_lines wol ON wol.id = bwl.wo_line_id
WHERE b.doc_no = 'BOQ/25-26/0003' AND wol.sno = 1;

-- BOQ3 / WO3-Line2
INSERT IGNORE INTO boq_lines (boq_id, boq_wo_line_id, sno, item_id, make_id, uom_id,
                               item_qty, boq_qty, est_qty, var_qty)
SELECT b.id, bwl.id, '2a',
       345, NULL,                               -- CDT-0045 20MM conduit MMS grey
       (SELECT id FROM uoms WHERE code = 'Mtrs'),
       3.000, 3.000 * wol.qty, ROUND(3.000 * wol.qty * 1.05, 3), 0
FROM boqs b
JOIN boq_wo_lines bwl ON bwl.boq_id = b.id
JOIN work_order_lines wol ON wol.id = bwl.wo_line_id
WHERE b.doc_no = 'BOQ/25-26/0003' AND wol.sno = 2;

INSERT IGNORE INTO boq_lines (boq_id, boq_wo_line_id, sno, item_id, make_id, uom_id,
                               item_qty, boq_qty, est_qty, var_qty)
SELECT b.id, bwl.id, '2b',
       2568,                                    -- WIR-0013 1.5mm wire black
       (SELECT id FROM makes WHERE name = 'POLY CAB'),
       (SELECT id FROM uoms WHERE code = 'Mtrs'),
       4.000, 4.000 * wol.qty, ROUND(4.000 * wol.qty * 1.05, 3), 0
FROM boqs b
JOIN boq_wo_lines bwl ON bwl.boq_id = b.id
JOIN work_order_lines wol ON wol.id = bwl.wo_line_id
WHERE b.doc_no = 'BOQ/25-26/0003' AND wol.sno = 2;

-- =====================================================================
-- BLOCK 7 — INDENTS
-- =====================================================================

-- IND1: Site1 — conduit + wire from WO1-Line1&2 (APPROVED)
INSERT INTO indents (doc_no, site_id, branch_id, boq_id, indent_date, needed_by, status, raised_by)
SELECT 'IND/25-26/0001',
       (SELECT id FROM sites WHERE code = 'ST-0001'),
       (SELECT id FROM branches WHERE code = 'HYD'),
       (SELECT id FROM boqs WHERE doc_no = 'BOQ/25-26/0001'),
       '2025-06-25', '2025-07-10', 'APPROVED',
       (SELECT id FROM users WHERE emp_code = 'E002')
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM indents WHERE doc_no = 'IND/25-26/0001');

INSERT IGNORE INTO indent_lines (indent_id, boq_line_id, item_id, make_id, qty, over_qty, remark)
SELECT i.id, bl.id, bl.item_id, bl.make_id, 650.000, 0.000, 'First floor conduit run'
FROM indents i, boq_lines bl
JOIN boqs b ON b.id = bl.boq_id
WHERE i.doc_no = 'IND/25-26/0001' AND b.doc_no = 'BOQ/25-26/0001' AND bl.sno = '1a';

INSERT IGNORE INTO indent_lines (indent_id, boq_line_id, item_id, make_id, qty, over_qty, remark)
SELECT i.id, bl.id, bl.item_id, bl.make_id, 220.000, 0.000, 'JB for first floor'
FROM indents i, boq_lines bl
JOIN boqs b ON b.id = bl.boq_id
WHERE i.doc_no = 'IND/25-26/0001' AND b.doc_no = 'BOQ/25-26/0001' AND bl.sno = '1b';

INSERT IGNORE INTO indent_lines (indent_id, boq_line_id, item_id, make_id, qty, over_qty, remark)
SELECT i.id, bl.id, bl.item_id, bl.make_id, 5000.000, 0.000, 'Wiring black - floors 1 to 3'
FROM indents i, boq_lines bl
JOIN boqs b ON b.id = bl.boq_id
WHERE i.doc_no = 'IND/25-26/0001' AND b.doc_no = 'BOQ/25-26/0001' AND bl.sno = '2a';

INSERT IGNORE INTO indent_lines (indent_id, boq_line_id, item_id, make_id, qty, over_qty, remark)
SELECT i.id, bl.id, bl.item_id, bl.make_id, 5000.000, 0.000, 'Wiring blue - floors 1 to 3'
FROM indents i, boq_lines bl
JOIN boqs b ON b.id = bl.boq_id
WHERE i.doc_no = 'IND/25-26/0001' AND b.doc_no = 'BOQ/25-26/0001' AND bl.sno = '2b';

INSERT IGNORE INTO indent_events (indent_id, action, user_id, note)
SELECT i.id, 'SUBMITTED', (SELECT id FROM users WHERE emp_code='E002'), 'Raised for first 3 floors'
FROM indents i WHERE i.doc_no = 'IND/25-26/0001'
  AND NOT EXISTS (SELECT 1 FROM indent_events ie WHERE ie.indent_id = i.id AND ie.action = 'SUBMITTED');

INSERT IGNORE INTO indent_events (indent_id, action, user_id, note)
SELECT i.id, 'APPROVED', (SELECT id FROM users WHERE emp_code='E005'), 'Approved — proceed with procurement'
FROM indents i WHERE i.doc_no = 'IND/25-26/0001'
  AND NOT EXISTS (SELECT 1 FROM indent_events ie WHERE ie.indent_id = i.id AND ie.action = 'APPROVED');

-- IND2: Site1 — MCBs (APPROVED)
INSERT INTO indents (doc_no, site_id, branch_id, boq_id, indent_date, needed_by, status, raised_by)
SELECT 'IND/25-26/0002',
       (SELECT id FROM sites WHERE code = 'ST-0001'),
       (SELECT id FROM branches WHERE code = 'HYD'),
       (SELECT id FROM boqs WHERE doc_no = 'BOQ/25-26/0001'),
       '2025-06-28', '2025-07-15', 'APPROVED',
       (SELECT id FROM users WHERE emp_code = 'E002')
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM indents WHERE doc_no = 'IND/25-26/0002');

INSERT IGNORE INTO indent_lines (indent_id, boq_line_id, item_id, make_id, qty, over_qty, remark)
SELECT i.id, bl.id, bl.item_id, bl.make_id, 120.000, 0.000, '10A SP MCBs for DB boards'
FROM indents i, boq_lines bl
JOIN boqs b ON b.id = bl.boq_id
WHERE i.doc_no = 'IND/25-26/0002' AND b.doc_no = 'BOQ/25-26/0001' AND bl.sno = '3a';

INSERT IGNORE INTO indent_events (indent_id, action, user_id, note)
SELECT i.id, 'SUBMITTED', (SELECT id FROM users WHERE emp_code='E002'), NULL
FROM indents i WHERE i.doc_no = 'IND/25-26/0002'
  AND NOT EXISTS (SELECT 1 FROM indent_events ie WHERE ie.indent_id = i.id AND ie.action = 'SUBMITTED');

INSERT IGNORE INTO indent_events (indent_id, action, user_id, note)
SELECT i.id, 'APPROVED', (SELECT id FROM users WHERE emp_code='E005'), 'Approved'
FROM indents i WHERE i.doc_no = 'IND/25-26/0002'
  AND NOT EXISTS (SELECT 1 FROM indent_events ie WHERE ie.indent_id = i.id AND ie.action = 'APPROVED');

-- IND3: Site2 — armoured cable (APPROVED)
INSERT INTO indents (doc_no, site_id, branch_id, boq_id, indent_date, needed_by, status, raised_by)
SELECT 'IND/25-26/0003',
       (SELECT id FROM sites WHERE code = 'ST-0002'),
       (SELECT id FROM branches WHERE code = 'HYD'),
       (SELECT id FROM boqs WHERE doc_no = 'BOQ/25-26/0002'),
       '2025-07-25', '2025-08-10', 'APPROVED',
       (SELECT id FROM users WHERE emp_code = 'E004')
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM indents WHERE doc_no = 'IND/25-26/0003');

INSERT IGNORE INTO indent_lines (indent_id, boq_line_id, item_id, make_id, qty, over_qty, remark)
SELECT i.id, bl.id, bl.item_id, bl.make_id, 465.000, 0.000, 'LT feeder run - basement to terrace'
FROM indents i, boq_lines bl
JOIN boqs b ON b.id = bl.boq_id
WHERE i.doc_no = 'IND/25-26/0003' AND b.doc_no = 'BOQ/25-26/0002' AND bl.sno = '1a';

INSERT IGNORE INTO indent_lines (indent_id, boq_line_id, item_id, make_id, qty, over_qty, remark)
SELECT i.id, bl.id, bl.item_id, bl.make_id, 80.000, 0.000, 'JBs for cable joints'
FROM indents i, boq_lines bl
JOIN boqs b ON b.id = bl.boq_id
WHERE i.doc_no = 'IND/25-26/0003' AND b.doc_no = 'BOQ/25-26/0002' AND bl.sno = '2a';

INSERT IGNORE INTO indent_events (indent_id, action, user_id, note)
SELECT i.id, 'SUBMITTED', (SELECT id FROM users WHERE emp_code='E004'), NULL
FROM indents i WHERE i.doc_no = 'IND/25-26/0003'
  AND NOT EXISTS (SELECT 1 FROM indent_events ie WHERE ie.indent_id = i.id AND ie.action = 'SUBMITTED');

INSERT IGNORE INTO indent_events (indent_id, action, user_id, note)
SELECT i.id, 'APPROVED', (SELECT id FROM users WHERE emp_code='E005'), 'Approved for procurement'
FROM indents i WHERE i.doc_no = 'IND/25-26/0003'
  AND NOT EXISTS (SELECT 1 FROM indent_events ie WHERE ie.indent_id = i.id AND ie.action = 'APPROVED');

-- IND4: Site3 — 4C cable (SUBMITTED, awaiting approval)
INSERT INTO indents (doc_no, site_id, branch_id, boq_id, indent_date, needed_by, status, raised_by)
SELECT 'IND/25-26/0004',
       (SELECT id FROM sites WHERE code = 'ST-0003'),
       (SELECT id FROM branches WHERE code = 'BLR'),
       (SELECT id FROM boqs WHERE doc_no = 'BOQ/25-26/0003'),
       '2025-08-12', '2025-08-28', 'SUBMITTED',
       (SELECT id FROM users WHERE emp_code = 'E004')
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM indents WHERE doc_no = 'IND/25-26/0004');

INSERT IGNORE INTO indent_lines (indent_id, boq_line_id, item_id, make_id, qty, over_qty, remark)
SELECT i.id, bl.id, bl.item_id, bl.make_id, 630.000, 0.000, '4C 16 SQ cable sub-distribution risers'
FROM indents i, boq_lines bl
JOIN boqs b ON b.id = bl.boq_id
WHERE i.doc_no = 'IND/25-26/0004' AND b.doc_no = 'BOQ/25-26/0003' AND bl.sno = '1a';

INSERT IGNORE INTO indent_events (indent_id, action, user_id, note)
SELECT i.id, 'SUBMITTED', (SELECT id FROM users WHERE emp_code='E004'), 'Urgent - site starting cable pulling'
FROM indents i WHERE i.doc_no = 'IND/25-26/0004'
  AND NOT EXISTS (SELECT 1 FROM indent_events ie WHERE ie.indent_id = i.id AND ie.action = 'SUBMITTED');

-- IND5: Site3 — conduit & wire for light points (DRAFT)
INSERT INTO indents (doc_no, site_id, branch_id, boq_id, indent_date, status, raised_by)
SELECT 'IND/25-26/0005',
       (SELECT id FROM sites WHERE code = 'ST-0003'),
       (SELECT id FROM branches WHERE code = 'BLR'),
       (SELECT id FROM boqs WHERE doc_no = 'BOQ/25-26/0003'),
       '2025-08-14', 'DRAFT',
       (SELECT id FROM users WHERE emp_code = 'E004')
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM indents WHERE doc_no = 'IND/25-26/0005');

INSERT IGNORE INTO indent_lines (indent_id, boq_line_id, item_id, make_id, qty, over_qty, remark)
SELECT i.id, bl.id, bl.item_id, bl.make_id, 1100.000, 0.000, 'Surface conduit for light points'
FROM indents i, boq_lines bl
JOIN boqs b ON b.id = bl.boq_id
WHERE i.doc_no = 'IND/25-26/0005' AND b.doc_no = 'BOQ/25-26/0003' AND bl.sno = '2a';

INSERT IGNORE INTO indent_lines (indent_id, boq_line_id, item_id, make_id, qty, over_qty, remark)
SELECT i.id, bl.id, bl.item_id, bl.make_id, 1500.000, 0.000, 'Wire black for light points'
FROM indents i, boq_lines bl
JOIN boqs b ON b.id = bl.boq_id
WHERE i.doc_no = 'IND/25-26/0005' AND b.doc_no = 'BOQ/25-26/0003' AND bl.sno = '2b';

-- =====================================================================
-- BLOCK 8 — COMPARISONS (for IND1 and IND3)
-- =====================================================================

-- CMP1: Conduit + wiring for IND1
INSERT INTO comparisons (doc_no, branch_id, title, status, chosen_supplier_id,
                          decided_note, decided_at, created_by)
SELECT 'CMP/25-26/0001',
       (SELECT id FROM branches WHERE code = 'HYD'),
       'Conduit & 1.5mm wire — IND/25-26/0001 (GMR T2)',
       'DECIDED',
       (SELECT id FROM suppliers WHERE code = 'SUP-0001'),
       'Universal Electricals L1 on conduit; Prakash Cables L1 on wire. Single order to Universal for simplicity.',
       '2025-07-02 16:00:00',
       (SELECT id FROM users WHERE emp_code = 'E001')
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM comparisons WHERE doc_no = 'CMP/25-26/0001');

INSERT IGNORE INTO comparison_indents (comparison_id, indent_id)
SELECT c.id, i.id FROM comparisons c, indents i
WHERE c.doc_no = 'CMP/25-26/0001' AND i.doc_no = 'IND/25-26/0001';

-- comparison items
INSERT IGNORE INTO comparison_items (comparison_id, item_id, make_id, qty)
SELECT c.id, 340, NULL, 650.000
FROM comparisons c WHERE c.doc_no = 'CMP/25-26/0001';

INSERT IGNORE INTO comparison_items (comparison_id, item_id, make_id, qty)
SELECT c.id, 2568, (SELECT id FROM makes WHERE name = 'POLY CAB'), 10000.000
FROM comparisons c WHERE c.doc_no = 'CMP/25-26/0001';

-- two comparison suppliers
INSERT IGNORE INTO comparison_suppliers (comparison_id, supplier_id, discount_pct, freight, credit_days, note)
SELECT c.id, (SELECT id FROM suppliers WHERE code = 'SUP-0001'),
       2.00, 800.00, 30, 'Includes delivery to store'
FROM comparisons c WHERE c.doc_no = 'CMP/25-26/0001';

INSERT IGNORE INTO comparison_suppliers (comparison_id, supplier_id, discount_pct, freight, credit_days, note)
SELECT c.id, (SELECT id FROM suppliers WHERE code = 'SUP-0002'),
       1.00, 1200.00, 45, 'Ex-works Nacharam'
FROM comparisons c WHERE c.doc_no = 'CMP/25-26/0001';

-- quotes: SUP-0001 rates
INSERT IGNORE INTO comparison_quotes (comparison_item_id, comparison_supplier_id, rate)
SELECT ci.id, cs.id, 21.50
FROM comparison_items ci
JOIN comparisons c ON c.id = ci.comparison_id
JOIN comparison_suppliers cs ON cs.comparison_id = c.id
JOIN suppliers s ON s.id = cs.supplier_id
WHERE c.doc_no = 'CMP/25-26/0001' AND ci.item_id = 340 AND s.code = 'SUP-0001';

INSERT IGNORE INTO comparison_quotes (comparison_item_id, comparison_supplier_id, rate)
SELECT ci.id, cs.id, 58.00
FROM comparison_items ci
JOIN comparisons c ON c.id = ci.comparison_id
JOIN comparison_suppliers cs ON cs.comparison_id = c.id
JOIN suppliers s ON s.id = cs.supplier_id
WHERE c.doc_no = 'CMP/25-26/0001' AND ci.item_id = 2568 AND s.code = 'SUP-0001';

-- quotes: SUP-0002 rates
INSERT IGNORE INTO comparison_quotes (comparison_item_id, comparison_supplier_id, rate)
SELECT ci.id, cs.id, 22.00
FROM comparison_items ci
JOIN comparisons c ON c.id = ci.comparison_id
JOIN comparison_suppliers cs ON cs.comparison_id = c.id
JOIN suppliers s ON s.id = cs.supplier_id
WHERE c.doc_no = 'CMP/25-26/0001' AND ci.item_id = 340 AND s.code = 'SUP-0002';

INSERT IGNORE INTO comparison_quotes (comparison_item_id, comparison_supplier_id, rate)
SELECT ci.id, cs.id, 56.50
FROM comparison_items ci
JOIN comparisons c ON c.id = ci.comparison_id
JOIN comparison_suppliers cs ON cs.comparison_id = c.id
JOIN suppliers s ON s.id = cs.supplier_id
WHERE c.doc_no = 'CMP/25-26/0001' AND ci.item_id = 2568 AND s.code = 'SUP-0002';

-- CMP2: Armoured cable for IND3 (DECIDED)
INSERT INTO comparisons (doc_no, branch_id, title, status, chosen_supplier_id,
                          decided_note, decided_at, created_by)
SELECT 'CMP/25-26/0002',
       (SELECT id FROM branches WHERE code = 'HYD'),
       '3.5C x 50 ARM cable + GI JBs — IND/25-26/0003 (Brigade)',
       'DECIDED',
       (SELECT id FROM suppliers WHERE code = 'SUP-0002'),
       'Prakash Cables L1 on armoured cable. JBs sourced locally.',
       '2025-08-01 11:00:00',
       (SELECT id FROM users WHERE emp_code = 'E001')
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM comparisons WHERE doc_no = 'CMP/25-26/0002');

INSERT IGNORE INTO comparison_indents (comparison_id, indent_id)
SELECT c.id, i.id FROM comparisons c, indents i
WHERE c.doc_no = 'CMP/25-26/0002' AND i.doc_no = 'IND/25-26/0003';

INSERT IGNORE INTO comparison_items (comparison_id, item_id, make_id, qty)
SELECT c.id, 15, (SELECT id FROM makes WHERE name = 'KEI'), 465.000
FROM comparisons c WHERE c.doc_no = 'CMP/25-26/0002';

INSERT IGNORE INTO comparison_suppliers (comparison_id, supplier_id, discount_pct, freight, credit_days)
SELECT c.id, (SELECT id FROM suppliers WHERE code = 'SUP-0002'),
       1.50, 1500.00, 45
FROM comparisons c WHERE c.doc_no = 'CMP/25-26/0002';

INSERT IGNORE INTO comparison_quotes (comparison_item_id, comparison_supplier_id, rate)
SELECT ci.id, cs.id, 595.00
FROM comparison_items ci
JOIN comparisons c ON c.id = ci.comparison_id
JOIN comparison_suppliers cs ON cs.comparison_id = c.id
WHERE c.doc_no = 'CMP/25-26/0002';

-- =====================================================================
-- BLOCK 9 — PURCHASE ORDERS
-- =====================================================================

-- PO1: Conduit + wire for GMR T2 (APPROVED)
INSERT INTO purchase_orders (doc_no, branch_id, supplier_id, comparison_id,
                              deliver_to_id, po_date, expected_date, status,
                              submitted_at, decided_at, decided_by, notes, created_by)
SELECT 'PO/25-26/0001',
       (SELECT id FROM branches WHERE code = 'HYD'),
       (SELECT id FROM suppliers WHERE code = 'SUP-0001'),
       (SELECT id FROM comparisons WHERE doc_no = 'CMP/25-26/0001'),
       (SELECT id FROM sites WHERE code = 'GD-0001'),
       '2025-07-05', '2025-07-20', 'APPROVED',
       '2025-07-05 12:00:00', '2025-07-06 09:30:00',
       (SELECT id FROM users WHERE emp_code = 'E005'),
       'Priority delivery — site target 10 July',
       (SELECT id FROM users WHERE emp_code = 'E001')
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM purchase_orders WHERE doc_no = 'PO/25-26/0001');

INSERT IGNORE INTO purchase_order_indents (po_id, indent_id)
SELECT po.id, i.id FROM purchase_orders po, indents i
WHERE po.doc_no = 'PO/25-26/0001' AND i.doc_no = 'IND/25-26/0001';

INSERT IGNORE INTO purchase_order_lines (po_id, item_id, make_id, uom_id, qty, rate, gst_rate, remark)
SELECT po.id, 340, NULL,
       (SELECT id FROM uoms WHERE code = 'Mtrs'),
       650.000, 21.50, 18.00, '20MM HMS conduit black'
FROM purchase_orders po WHERE po.doc_no = 'PO/25-26/0001';

INSERT IGNORE INTO purchase_order_lines (po_id, item_id, make_id, uom_id, qty, rate, gst_rate, remark)
SELECT po.id, 2568, (SELECT id FROM makes WHERE name = 'POLY CAB'),
       (SELECT id FROM uoms WHERE code = 'Mtrs'),
       10000.000, 58.00, 18.00, '1.5 SQMM FR-LSH wire black — POLY CAB'
FROM purchase_orders po WHERE po.doc_no = 'PO/25-26/0001';

-- po_line_indents
INSERT IGNORE INTO po_line_indents (po_line_id, indent_id, qty)
SELECT pol.id, i.id, 650.000
FROM purchase_order_lines pol
JOIN purchase_orders po ON po.id = pol.po_id
JOIN indents i ON i.doc_no = 'IND/25-26/0001'
WHERE po.doc_no = 'PO/25-26/0001' AND pol.item_id = 340;

INSERT IGNORE INTO po_line_indents (po_line_id, indent_id, qty)
SELECT pol.id, i.id, 10000.000
FROM purchase_order_lines pol
JOIN purchase_orders po ON po.id = pol.po_id
JOIN indents i ON i.doc_no = 'IND/25-26/0001'
WHERE po.doc_no = 'PO/25-26/0001' AND pol.item_id = 2568;

INSERT IGNORE INTO po_events (po_id, action, user_id, note)
SELECT po.id, 'SUBMITTED', (SELECT id FROM users WHERE emp_code='E001'), NULL
FROM purchase_orders po WHERE po.doc_no = 'PO/25-26/0001';

INSERT IGNORE INTO po_events (po_id, action, user_id, note)
SELECT po.id, 'APPROVED', (SELECT id FROM users WHERE emp_code='E005'), 'Signed — send to supplier'
FROM purchase_orders po WHERE po.doc_no = 'PO/25-26/0001';

-- PO2: MCBs for GMR T2 (APPROVED)
INSERT INTO purchase_orders (doc_no, branch_id, supplier_id, comparison_id,
                              deliver_to_id, po_date, expected_date, status,
                              submitted_at, decided_at, decided_by, notes, created_by)
SELECT 'PO/25-26/0002',
       (SELECT id FROM branches WHERE code = 'HYD'),
       (SELECT id FROM suppliers WHERE code = 'SUP-0001'),
       NULL,
       (SELECT id FROM sites WHERE code = 'GD-0001'),
       '2025-07-08', '2025-07-25', 'APPROVED',
       '2025-07-08 15:00:00', '2025-07-09 10:00:00',
       (SELECT id FROM users WHERE emp_code = 'E005'),
       'MCBs for distribution boards — all floors',
       (SELECT id FROM users WHERE emp_code = 'E001')
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM purchase_orders WHERE doc_no = 'PO/25-26/0002');

INSERT IGNORE INTO purchase_order_indents (po_id, indent_id)
SELECT po.id, i.id FROM purchase_orders po, indents i
WHERE po.doc_no = 'PO/25-26/0002' AND i.doc_no = 'IND/25-26/0002';

INSERT IGNORE INTO purchase_order_lines (po_id, item_id, make_id, uom_id, qty, rate, gst_rate, remark)
SELECT po.id, 1169, (SELECT id FROM makes WHERE name = 'schneider'),
       (SELECT id FROM uoms WHERE code = "No's"),
       125.000, 245.00, 18.00, '10A SP C-curve MCB — Schneider'
FROM purchase_orders po WHERE po.doc_no = 'PO/25-26/0002';

INSERT IGNORE INTO po_line_indents (po_line_id, indent_id, qty)
SELECT pol.id, i.id, 120.000
FROM purchase_order_lines pol
JOIN purchase_orders po ON po.id = pol.po_id
JOIN indents i ON i.doc_no = 'IND/25-26/0002'
WHERE po.doc_no = 'PO/25-26/0002' AND pol.item_id = 1169;

INSERT IGNORE INTO po_events (po_id, action, user_id, note)
SELECT po.id, 'SUBMITTED', (SELECT id FROM users WHERE emp_code='E001'), NULL
FROM purchase_orders po WHERE po.doc_no = 'PO/25-26/0002';

INSERT IGNORE INTO po_events (po_id, action, user_id, note)
SELECT po.id, 'APPROVED', (SELECT id FROM users WHERE emp_code='E005'), 'Approved'
FROM purchase_orders po WHERE po.doc_no = 'PO/25-26/0002';

-- PO3: Armoured cable for Brigade (APPROVED)
INSERT INTO purchase_orders (doc_no, branch_id, supplier_id, comparison_id,
                              deliver_to_id, po_date, expected_date, status,
                              submitted_at, decided_at, decided_by, notes, created_by)
SELECT 'PO/25-26/0003',
       (SELECT id FROM branches WHERE code = 'HYD'),
       (SELECT id FROM suppliers WHERE code = 'SUP-0002'),
       (SELECT id FROM comparisons WHERE doc_no = 'CMP/25-26/0002'),
       (SELECT id FROM sites WHERE code = 'GD-0001'),
       '2025-08-05', '2025-08-20', 'APPROVED',
       '2025-08-05 11:00:00', '2025-08-06 16:00:00',
       (SELECT id FROM users WHERE emp_code = 'E005'),
       'Armoured cable for Brigade feeder runs',
       (SELECT id FROM users WHERE emp_code = 'E001')
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM purchase_orders WHERE doc_no = 'PO/25-26/0003');

INSERT IGNORE INTO purchase_order_indents (po_id, indent_id)
SELECT po.id, i.id FROM purchase_orders po, indents i
WHERE po.doc_no = 'PO/25-26/0003' AND i.doc_no = 'IND/25-26/0003';

INSERT IGNORE INTO purchase_order_lines (po_id, item_id, make_id, uom_id, qty, rate, gst_rate, remark)
SELECT po.id, 15, (SELECT id FROM makes WHERE name = 'KEI'),
       (SELECT id FROM uoms WHERE code = 'Mtrs'),
       465.000, 595.00, 18.00, '3.5C x 50 SQ MM AL AR cable — KEI'
FROM purchase_orders po WHERE po.doc_no = 'PO/25-26/0003';

INSERT IGNORE INTO purchase_order_lines (po_id, item_id, make_id, uom_id, qty, rate, gst_rate, remark)
SELECT po.id, 1133, NULL,
       (SELECT id FROM uoms WHERE code = "No's"),
       80.000, 380.00, 18.00, '110x110 GI JBs'
FROM purchase_orders po WHERE po.doc_no = 'PO/25-26/0003';

INSERT IGNORE INTO po_line_indents (po_line_id, indent_id, qty)
SELECT pol.id, i.id, 465.000
FROM purchase_order_lines pol
JOIN purchase_orders po ON po.id = pol.po_id
JOIN indents i ON i.doc_no = 'IND/25-26/0003'
WHERE po.doc_no = 'PO/25-26/0003' AND pol.item_id = 15;

INSERT IGNORE INTO po_line_indents (po_line_id, indent_id, qty)
SELECT pol.id, i.id, 80.000
FROM purchase_order_lines pol
JOIN purchase_orders po ON po.id = pol.po_id
JOIN indents i ON i.doc_no = 'IND/25-26/0003'
WHERE po.doc_no = 'PO/25-26/0003' AND pol.item_id = 1133;

INSERT IGNORE INTO po_events (po_id, action, user_id, note)
SELECT po.id, 'SUBMITTED', (SELECT id FROM users WHERE emp_code='E001'), NULL
FROM purchase_orders po WHERE po.doc_no = 'PO/25-26/0003';

INSERT IGNORE INTO po_events (po_id, action, user_id, note)
SELECT po.id, 'APPROVED', (SELECT id FROM users WHERE emp_code='E005'), 'Approved — Brigade site urgent'
FROM purchase_orders po WHERE po.doc_no = 'PO/25-26/0003';

-- =====================================================================
-- BLOCK 10 — GOODS RECEIPTS (CONFIRMED) + STOCK MOVEMENTS (GRN in)
-- =====================================================================

-- GRN1: conduit + wire against PO1 (full receipt)
INSERT INTO goods_receipts (doc_no, po_id, received_at, receipt_date,
                             supplier_dc, status, note, received_by)
SELECT 'GRN/25-26/0001',
       (SELECT id FROM purchase_orders WHERE doc_no = 'PO/25-26/0001'),
       (SELECT id FROM sites WHERE code = 'GD-0001'),
       '2025-07-18', 'UNIV/DC/2025/0189',
       'CONFIRMED', 'Full quantity received, no damage', 3
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM goods_receipts WHERE doc_no = 'GRN/25-26/0001');

INSERT IGNORE INTO goods_receipt_lines (grn_id, po_line_id, qty, remark)
SELECT g.id, pol.id, 650.000, NULL
FROM goods_receipts g
JOIN purchase_orders po ON po.id = g.po_id
JOIN purchase_order_lines pol ON pol.po_id = po.id
WHERE g.doc_no = 'GRN/25-26/0001' AND pol.item_id = 340;

INSERT IGNORE INTO goods_receipt_lines (grn_id, po_line_id, qty, remark)
SELECT g.id, pol.id, 10000.000, NULL
FROM goods_receipts g
JOIN purchase_orders po ON po.id = g.po_id
JOIN purchase_order_lines pol ON pol.po_id = po.id
WHERE g.doc_no = 'GRN/25-26/0001' AND pol.item_id = 2568;

-- Stock in at HYD store for GRN1 conduit
INSERT IGNORE INTO stock_movements (site_id, item_id, make_id, qty, rate, kind,
                                     ref_type, ref_id, ref_no, moved_on, created_by)
SELECT (SELECT id FROM sites WHERE code='GD-0001'),
       pol.item_id, pol.make_id, 650.000, 21.50,
       'GRN', 'GRN', g.id, 'GRN/25-26/0001', '2025-07-18', 3
FROM goods_receipts g
JOIN purchase_orders po ON po.id = g.po_id
JOIN purchase_order_lines pol ON pol.po_id = po.id
WHERE g.doc_no = 'GRN/25-26/0001' AND pol.item_id = 340
  AND NOT EXISTS (SELECT 1 FROM stock_movements
                  WHERE ref_no='GRN/25-26/0001' AND item_id=340 AND qty > 0);

-- Stock in at HYD store for GRN1 wire
INSERT IGNORE INTO stock_movements (site_id, item_id, make_id, qty, rate, kind,
                                     ref_type, ref_id, ref_no, moved_on, created_by)
SELECT (SELECT id FROM sites WHERE code='GD-0001'),
       pol.item_id, pol.make_id, 10000.000, 58.00,
       'GRN', 'GRN', g.id, 'GRN/25-26/0001', '2025-07-18', 3
FROM goods_receipts g
JOIN purchase_orders po ON po.id = g.po_id
JOIN purchase_order_lines pol ON pol.po_id = po.id
WHERE g.doc_no = 'GRN/25-26/0001' AND pol.item_id = 2568
  AND NOT EXISTS (SELECT 1 FROM stock_movements
                  WHERE ref_no='GRN/25-26/0001' AND item_id=2568 AND qty > 0);

-- GRN2: MCBs against PO2 (full receipt)
INSERT INTO goods_receipts (doc_no, po_id, received_at, receipt_date,
                             supplier_dc, status, note, received_by)
SELECT 'GRN/25-26/0002',
       (SELECT id FROM purchase_orders WHERE doc_no = 'PO/25-26/0002'),
       (SELECT id FROM sites WHERE code = 'GD-0001'),
       '2025-07-24', 'UNIV/DC/2025/0201',
       'CONFIRMED', '125 nos received', 3
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM goods_receipts WHERE doc_no = 'GRN/25-26/0002');

INSERT IGNORE INTO goods_receipt_lines (grn_id, po_line_id, qty, remark)
SELECT g.id, pol.id, 125.000, NULL
FROM goods_receipts g
JOIN purchase_orders po ON po.id = g.po_id
JOIN purchase_order_lines pol ON pol.po_id = po.id
WHERE g.doc_no = 'GRN/25-26/0002' AND pol.item_id = 1169;

INSERT IGNORE INTO stock_movements (site_id, item_id, make_id, qty, rate, kind,
                                     ref_type, ref_id, ref_no, moved_on, created_by)
SELECT (SELECT id FROM sites WHERE code='GD-0001'),
       pol.item_id, pol.make_id, 125.000, 245.00,
       'GRN', 'GRN', g.id, 'GRN/25-26/0002', '2025-07-24', 3
FROM goods_receipts g
JOIN purchase_orders po ON po.id = g.po_id
JOIN purchase_order_lines pol ON pol.po_id = po.id
WHERE g.doc_no = 'GRN/25-26/0002' AND pol.item_id = 1169
  AND NOT EXISTS (SELECT 1 FROM stock_movements
                  WHERE ref_no='GRN/25-26/0002' AND item_id=1169 AND qty > 0);

-- =====================================================================
-- BLOCK 11 — DELIVERY CHALLANS (Store → Site)
-- =====================================================================

-- DC1: Conduit + wire from HYD Store → GMR T2  (ACKNOWLEDGED)
INSERT INTO delivery_challans (doc_no, branch_id, from_site_id, to_site_id,
                                dc_date, status, vehicle_no, driver,
                                dispatched_at, dispatched_by, created_by)
SELECT 'DC/25-26/0001',
       (SELECT id FROM branches WHERE code = 'HYD'),
       (SELECT id FROM sites WHERE code = 'GD-0001'),
       (SELECT id FROM sites WHERE code = 'ST-0001'),
       '2025-07-21', 'ACKNOWLEDGED',
       'TS09EA1234', 'Sunil Yadav',
       '2025-07-21 08:00:00',
       (SELECT id FROM users WHERE emp_code = 'E003'),
       (SELECT id FROM users WHERE emp_code = 'E003')
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM delivery_challans WHERE doc_no = 'DC/25-26/0001');

INSERT IGNORE INTO delivery_challan_lines (dc_id, item_id, make_id, uom_id, qty, rate, remark)
SELECT dc.id, 340, NULL,
       (SELECT id FROM uoms WHERE code = 'Mtrs'),
       500.000, 21.50, 'First dispatch — conduit'
FROM delivery_challans dc WHERE dc.doc_no = 'DC/25-26/0001';

INSERT IGNORE INTO delivery_challan_lines (dc_id, item_id, make_id, uom_id, qty, rate, remark)
SELECT dc.id, 2568, (SELECT id FROM makes WHERE name = 'POLY CAB'),
       (SELECT id FROM uoms WHERE code = 'Mtrs'),
       8000.000, 58.00, 'Wire black POLY CAB'
FROM delivery_challans dc WHERE dc.doc_no = 'DC/25-26/0001';

INSERT IGNORE INTO delivery_challan_lines (dc_id, item_id, make_id, uom_id, qty, rate, remark)
SELECT dc.id, 2570, (SELECT id FROM makes WHERE name = 'POLY CAB'),
       (SELECT id FROM uoms WHERE code = 'Mtrs'),
       8000.000, 58.00, 'Wire blue POLY CAB'
FROM delivery_challans dc WHERE dc.doc_no = 'DC/25-26/0001';

INSERT IGNORE INTO dc_line_indents (dc_line_id, indent_id, qty)
SELECT dcl.id, i.id, 500.000
FROM delivery_challan_lines dcl
JOIN delivery_challans dc ON dc.id = dcl.dc_id
JOIN indents i ON i.doc_no = 'IND/25-26/0001'
WHERE dc.doc_no = 'DC/25-26/0001' AND dcl.item_id = 340;

INSERT IGNORE INTO dc_line_indents (dc_line_id, indent_id, qty)
SELECT dcl.id, i.id, 8000.000
FROM delivery_challan_lines dcl
JOIN delivery_challans dc ON dc.id = dcl.dc_id
JOIN indents i ON i.doc_no = 'IND/25-26/0001'
WHERE dc.doc_no = 'DC/25-26/0001' AND dcl.item_id = 2568;

INSERT IGNORE INTO dc_line_indents (dc_line_id, indent_id, qty)
SELECT dcl.id, i.id, 8000.000
FROM delivery_challan_lines dcl
JOIN delivery_challans dc ON dc.id = dcl.dc_id
JOIN indents i ON i.doc_no = 'IND/25-26/0001'
WHERE dc.doc_no = 'DC/25-26/0001' AND dcl.item_id = 2570;

-- GRN stock for WIR-0015 blue wire (received at store together with GRN1)
INSERT IGNORE INTO stock_movements (site_id, item_id, make_id, qty, rate, kind,
                                     ref_type, ref_id, ref_no, moved_on, created_by)
SELECT (SELECT id FROM sites WHERE code='GD-0001'),
       2570,
       (SELECT id FROM makes WHERE name = 'POLY CAB'),
       8500.000, 57.00,
       'GRN', 'GRN', g.id, 'GRN/25-26/0001', '2025-07-18', 3
FROM goods_receipts g WHERE g.doc_no = 'GRN/25-26/0001'
  AND NOT EXISTS (SELECT 1 FROM stock_movements
                  WHERE ref_no='GRN/25-26/0001' AND item_id=2570 AND qty > 0);

-- DC1 acknowledgement
INSERT INTO dc_acknowledgements (dc_id, ack_date, note, acked_by)
SELECT dc.id, '2025-07-21',
       'Received 500m conduit, 8000m black wire, 8000m blue wire — all in good condition',
       (SELECT id FROM users WHERE emp_code = 'E002')
FROM delivery_challans dc WHERE dc.doc_no = 'DC/25-26/0001'
  AND NOT EXISTS (SELECT 1 FROM dc_acknowledgements da WHERE da.dc_id = dc.id);

INSERT IGNORE INTO dc_acknowledgement_lines (ack_id, dc_line_id, qty)
SELECT a.id, dcl.id, dcl.qty
FROM dc_acknowledgements a
JOIN delivery_challans dc ON dc.id = a.dc_id
JOIN delivery_challan_lines dcl ON dcl.dc_id = dc.id
WHERE dc.doc_no = 'DC/25-26/0001';

-- Stock movements: DC1 out of store, into site (all 3 items)
INSERT IGNORE INTO stock_movements (site_id, item_id, make_id, qty, rate, kind,
                                     ref_type, ref_id, ref_no, moved_on, created_by)
SELECT (SELECT id FROM sites WHERE code='GD-0001'),
       dcl.item_id, dcl.make_id, -dcl.qty, dcl.rate,
       'ISSUE', 'DC', dc.id, 'DC/25-26/0001', '2025-07-21', 3
FROM delivery_challans dc
JOIN delivery_challan_lines dcl ON dcl.dc_id = dc.id
WHERE dc.doc_no = 'DC/25-26/0001'
  AND NOT EXISTS (SELECT 1 FROM stock_movements
                  WHERE ref_no='DC/25-26/0001' AND site_id=(SELECT id FROM sites WHERE code='GD-0001')
                    AND item_id = dcl.item_id AND qty < 0);

INSERT IGNORE INTO stock_movements (site_id, item_id, make_id, qty, rate, kind,
                                     ref_type, ref_id, ref_no, moved_on, created_by)
SELECT (SELECT id FROM sites WHERE code='ST-0001'),
       dcl.item_id, dcl.make_id, dcl.qty, dcl.rate,
       'GRN', 'DC', dc.id, 'DC/25-26/0001', '2025-07-21', 2
FROM delivery_challans dc
JOIN delivery_challan_lines dcl ON dcl.dc_id = dc.id
WHERE dc.doc_no = 'DC/25-26/0001'
  AND NOT EXISTS (SELECT 1 FROM stock_movements
                  WHERE ref_no='DC/25-26/0001' AND site_id=(SELECT id FROM sites WHERE code='ST-0001')
                    AND item_id = dcl.item_id AND qty > 0);

-- DC2: MCBs from HYD Store → GMR T2 (ACKNOWLEDGED)
INSERT INTO delivery_challans (doc_no, branch_id, from_site_id, to_site_id,
                                dc_date, status, vehicle_no, driver,
                                dispatched_at, dispatched_by, created_by)
SELECT 'DC/25-26/0002',
       (SELECT id FROM branches WHERE code = 'HYD'),
       (SELECT id FROM sites WHERE code = 'GD-0001'),
       (SELECT id FROM sites WHERE code = 'ST-0001'),
       '2025-07-26', 'ACKNOWLEDGED',
       'TS09EA1234', 'Sunil Yadav',
       '2025-07-26 09:00:00',
       (SELECT id FROM users WHERE emp_code = 'E003'),
       (SELECT id FROM users WHERE emp_code = 'E003')
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM delivery_challans WHERE doc_no = 'DC/25-26/0002');

INSERT IGNORE INTO delivery_challan_lines (dc_id, item_id, make_id, uom_id, qty, rate)
SELECT dc.id, 1169, (SELECT id FROM makes WHERE name = 'schneider'),
       (SELECT id FROM uoms WHERE code = "No's"),
       120.000, 245.00
FROM delivery_challans dc WHERE dc.doc_no = 'DC/25-26/0002';

INSERT IGNORE INTO dc_line_indents (dc_line_id, indent_id, qty)
SELECT dcl.id, i.id, 120.000
FROM delivery_challan_lines dcl
JOIN delivery_challans dc ON dc.id = dcl.dc_id
JOIN indents i ON i.doc_no = 'IND/25-26/0002'
WHERE dc.doc_no = 'DC/25-26/0002' AND dcl.item_id = 1169;

INSERT INTO dc_acknowledgements (dc_id, ack_date, note, acked_by)
SELECT dc.id, '2025-07-26', '120 nos MCBs received OK',
       (SELECT id FROM users WHERE emp_code = 'E002')
FROM delivery_challans dc WHERE dc.doc_no = 'DC/25-26/0002'
  AND NOT EXISTS (SELECT 1 FROM dc_acknowledgements da WHERE da.dc_id = dc.id);

INSERT IGNORE INTO dc_acknowledgement_lines (ack_id, dc_line_id, qty)
SELECT a.id, dcl.id, dcl.qty
FROM dc_acknowledgements a
JOIN delivery_challans dc ON dc.id = a.dc_id
JOIN delivery_challan_lines dcl ON dcl.dc_id = dc.id
WHERE dc.doc_no = 'DC/25-26/0002';

-- DC2 stock movements
INSERT IGNORE INTO stock_movements (site_id, item_id, make_id, qty, rate, kind,
                                     ref_type, ref_id, ref_no, moved_on, created_by)
SELECT (SELECT id FROM sites WHERE code='GD-0001'),
       dcl.item_id, dcl.make_id, -dcl.qty, dcl.rate,
       'ISSUE', 'DC', dc.id, 'DC/25-26/0002', '2025-07-26', 3
FROM delivery_challans dc
JOIN delivery_challan_lines dcl ON dcl.dc_id = dc.id
WHERE dc.doc_no = 'DC/25-26/0002'
  AND NOT EXISTS (SELECT 1 FROM stock_movements
                  WHERE ref_no='DC/25-26/0002' AND site_id=(SELECT id FROM sites WHERE code='GD-0001') AND qty < 0);

INSERT IGNORE INTO stock_movements (site_id, item_id, make_id, qty, rate, kind,
                                     ref_type, ref_id, ref_no, moved_on, created_by)
SELECT (SELECT id FROM sites WHERE code='ST-0001'),
       dcl.item_id, dcl.make_id, dcl.qty, dcl.rate,
       'GRN', 'DC', dc.id, 'DC/25-26/0002', '2025-07-26', 2
FROM delivery_challans dc
JOIN delivery_challan_lines dcl ON dcl.dc_id = dc.id
WHERE dc.doc_no = 'DC/25-26/0002'
  AND NOT EXISTS (SELECT 1 FROM stock_movements
                  WHERE ref_no='DC/25-26/0002' AND site_id=(SELECT id FROM sites WHERE code='ST-0001') AND qty > 0);

-- =====================================================================
-- BLOCK 12 — ISSUE FOR CONSUMPTION (Site shelf → Site workers)
-- =====================================================================

-- CON1: Conduit issued for floor 1 conduit laying
INSERT INTO consumptions (doc_no, site_id, branch_id, boq_id, used_on,
                           issued_to_name, purpose, status, note, recorded_by)
SELECT 'CON/25-26/0001',
       (SELECT id FROM sites WHERE code = 'ST-0001'),
       (SELECT id FROM branches WHERE code = 'HYD'),
       (SELECT id FROM boqs WHERE doc_no = 'BOQ/25-26/0001'),
       '2025-07-24',
       'Ramesh — Gang Leader (Floor 1)',
       'Floor 1 concealed conduit laying — Zones A to D',
       'CONFIRMED', NULL,
       (SELECT id FROM users WHERE emp_code = 'E003')
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM consumptions WHERE doc_no = 'CON/25-26/0001');

INSERT IGNORE INTO consumption_lines (consumption_id, boq_line_id, item_id, make_id,
                                       uom_id, qty, rate, remark)
SELECT c.id, bl.id, bl.item_id, bl.make_id,
       (SELECT id FROM uoms WHERE code = 'Mtrs'),
       300.000, 21.50, 'F1 conduit 300m'
FROM consumptions c, boq_lines bl
JOIN boqs b ON b.id = bl.boq_id
WHERE c.doc_no = 'CON/25-26/0001' AND b.doc_no = 'BOQ/25-26/0001' AND bl.sno = '1a';

INSERT IGNORE INTO consumption_lines (consumption_id, boq_line_id, item_id, make_id,
                                       uom_id, qty, rate, remark)
SELECT c.id, bl.id, bl.item_id, bl.make_id,
       (SELECT id FROM uoms WHERE code = 'Mtrs'),
       2400.000, 58.00, 'F1 wire black 2400m'
FROM consumptions c, boq_lines bl
JOIN boqs b ON b.id = bl.boq_id
WHERE c.doc_no = 'CON/25-26/0001' AND b.doc_no = 'BOQ/25-26/0001' AND bl.sno = '2a';

-- Stock movement: out of ST-0001 site shelf
INSERT IGNORE INTO stock_movements (site_id, item_id, make_id, qty, rate, kind,
                                     ref_type, ref_id, ref_no, moved_on, created_by)
SELECT c.site_id, cl.item_id, cl.make_id, -cl.qty, cl.rate,
       'ISSUE', 'CON', c.id, 'CON/25-26/0001', c.used_on, 3
FROM consumptions c
JOIN consumption_lines cl ON cl.consumption_id = c.id
WHERE c.doc_no = 'CON/25-26/0001'
  AND NOT EXISTS (SELECT 1 FROM stock_movements
                  WHERE ref_no = 'CON/25-26/0001' AND item_id = cl.item_id AND qty < 0);

-- CON2: Wire blue issued for floor 1 wiring
INSERT INTO consumptions (doc_no, site_id, branch_id, boq_id, used_on,
                           issued_to_name, purpose, status, recorded_by)
SELECT 'CON/25-26/0002',
       (SELECT id FROM sites WHERE code = 'ST-0001'),
       (SELECT id FROM branches WHERE code = 'HYD'),
       (SELECT id FROM boqs WHERE doc_no = 'BOQ/25-26/0001'),
       '2025-07-28',
       'Ramesh — Gang Leader (Floor 1)',
       'Floor 1 FR-LSH wiring — all 3 phases + neutral',
       'CONFIRMED',
       (SELECT id FROM users WHERE emp_code = 'E003')
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM consumptions WHERE doc_no = 'CON/25-26/0002');

INSERT IGNORE INTO consumption_lines (consumption_id, boq_line_id, item_id, make_id,
                                       uom_id, qty, rate, remark)
SELECT c.id, bl.id, bl.item_id, bl.make_id,
       (SELECT id FROM uoms WHERE code = 'Mtrs'),
       2200.000, 58.00, 'F1 wire blue 2200m'
FROM consumptions c, boq_lines bl
JOIN boqs b ON b.id = bl.boq_id
WHERE c.doc_no = 'CON/25-26/0002' AND b.doc_no = 'BOQ/25-26/0001' AND bl.sno = '2b';

INSERT IGNORE INTO stock_movements (site_id, item_id, make_id, qty, rate, kind,
                                     ref_type, ref_id, ref_no, moved_on, created_by)
SELECT c.site_id, cl.item_id, cl.make_id, -cl.qty, cl.rate,
       'ISSUE', 'CON', c.id, 'CON/25-26/0002', c.used_on, 3
FROM consumptions c
JOIN consumption_lines cl ON cl.consumption_id = c.id
WHERE c.doc_no = 'CON/25-26/0002'
  AND NOT EXISTS (SELECT 1 FROM stock_movements
                  WHERE ref_no = 'CON/25-26/0002' AND qty < 0);

-- CON3: MCBs issued for floor 1-2 DB boards
INSERT INTO consumptions (doc_no, site_id, branch_id, boq_id, used_on,
                           issued_to_name, purpose, status, recorded_by)
SELECT 'CON/25-26/0003',
       (SELECT id FROM sites WHERE code = 'ST-0001'),
       (SELECT id FROM branches WHERE code = 'HYD'),
       (SELECT id FROM boqs WHERE doc_no = 'BOQ/25-26/0001'),
       '2025-07-30',
       'Srinivas — DB Fitter',
       'MCB loading in DB-F1-A, DB-F1-B, DB-F2-A, DB-F2-B',
       'CONFIRMED',
       (SELECT id FROM users WHERE emp_code = 'E003')
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM consumptions WHERE doc_no = 'CON/25-26/0003');

INSERT IGNORE INTO consumption_lines (consumption_id, boq_line_id, item_id, make_id,
                                       uom_id, qty, rate, remark)
SELECT c.id, bl.id, bl.item_id, bl.make_id,
       (SELECT id FROM uoms WHERE code = "No's"),
       80.000, 245.00, '80 nos MCBs for F1+F2 DBs'
FROM consumptions c, boq_lines bl
JOIN boqs b ON b.id = bl.boq_id
WHERE c.doc_no = 'CON/25-26/0003' AND b.doc_no = 'BOQ/25-26/0001' AND bl.sno = '3a';

INSERT IGNORE INTO stock_movements (site_id, item_id, make_id, qty, rate, kind,
                                     ref_type, ref_id, ref_no, moved_on, created_by)
SELECT c.site_id, cl.item_id, cl.make_id, -cl.qty, cl.rate,
       'ISSUE', 'CON', c.id, 'CON/25-26/0003', c.used_on, 3
FROM consumptions c
JOIN consumption_lines cl ON cl.consumption_id = c.id
WHERE c.doc_no = 'CON/25-26/0003'
  AND NOT EXISTS (SELECT 1 FROM stock_movements
                  WHERE ref_no = 'CON/25-26/0003' AND qty < 0);

-- =====================================================================
-- BLOCK 13 — STOCK RETURN (excess conduit returned to site shelf)
-- =====================================================================

INSERT INTO stock_returns (doc_no, site_id, branch_id, returned_on,
                            returned_by_name, reason, status, recorded_by)
SELECT 'RET/25-26/0001',
       (SELECT id FROM sites WHERE code = 'ST-0001'),
       (SELECT id FROM branches WHERE code = 'HYD'),
       '2025-07-31',
       'Ramesh — Gang Leader (Floor 1)',
       'Excess conduit from floor 1 not used — design change in Zone C',
       'CONFIRMED',
       (SELECT id FROM users WHERE emp_code = 'E003')
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM stock_returns WHERE doc_no = 'RET/25-26/0001');

INSERT IGNORE INTO stock_return_lines (return_id, item_id, make_id, uom_id, qty, rate, remark)
SELECT r.id, 340, NULL,
       (SELECT id FROM uoms WHERE code = 'Mtrs'),
       45.000, 21.50, 'Excess from Zone C redesign'
FROM stock_returns r WHERE r.doc_no = 'RET/25-26/0001';

INSERT IGNORE INTO stock_movements (site_id, item_id, make_id, qty, rate, kind,
                                     ref_type, ref_id, ref_no, moved_on, created_by)
SELECT r.site_id, rl.item_id, rl.make_id, rl.qty, rl.rate,
       'RETURN', 'RET', r.id, 'RET/25-26/0001', r.returned_on, 3
FROM stock_returns r
JOIN stock_return_lines rl ON rl.return_id = r.id
WHERE r.doc_no = 'RET/25-26/0001'
  AND NOT EXISTS (SELECT 1 FROM stock_movements WHERE ref_no = 'RET/25-26/0001');

-- =====================================================================
-- BLOCK 14 — SITE EXPENSES
-- =====================================================================

-- EXP1: GMR T2 — Transport (APPROVED)
INSERT INTO site_expenses (doc_no, site_id, branch_id, category_id,
                            spent_on, description, paid_to, bill_no,
                            claimed_amount, approved_amount, status, raised_by,
                            submitted_at, decided_by, decided_at, decision_note)
SELECT 'EXP/25-26/0001',
       (SELECT id FROM sites WHERE code = 'ST-0001'),
       (SELECT id FROM branches WHERE code = 'HYD'),
       (SELECT id FROM expense_categories WHERE name = 'Transport'),
       '2025-07-21',
       'Lorry hire — material transport from HYD store to GMR T2 site',
       'Raju Transport', 'RT/2025/0442',
       6500.00, 6000.00, 'APPROVED',
       (SELECT id FROM users WHERE emp_code = 'E002'),
       '2025-07-22 09:00:00',
       (SELECT id FROM users WHERE emp_code = 'E005'),
       '2025-07-23 11:30:00',
       'Approved ₹6000; ₹500 disallowed — no toll receipt'
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM site_expenses WHERE doc_no = 'EXP/25-26/0001');

INSERT IGNORE INTO site_expense_events (expense_id, action, amount, user_id, note)
SELECT id, 'SUBMITTED', NULL, (SELECT id FROM users WHERE emp_code='E002'), NULL
FROM site_expenses WHERE doc_no = 'EXP/25-26/0001';
INSERT IGNORE INTO site_expense_events (expense_id, action, amount, user_id, note)
SELECT id, 'APPROVED', 6000.00, (SELECT id FROM users WHERE emp_code='E005'),
       'Approved ₹6000 — tolls unreceipted portion rejected'
FROM site_expenses WHERE doc_no = 'EXP/25-26/0001';

-- EXP2: GMR T2 — Labour (APPROVED)
INSERT INTO site_expenses (doc_no, site_id, branch_id, category_id,
                            spent_on, description, paid_to, bill_no,
                            claimed_amount, approved_amount, status, raised_by,
                            submitted_at, decided_by, decided_at, decision_note)
SELECT 'EXP/25-26/0002',
       (SELECT id FROM sites WHERE code = 'ST-0001'),
       (SELECT id FROM branches WHERE code = 'HYD'),
       (SELECT id FROM expense_categories WHERE name = 'Labour'),
       '2025-07-31',
       'Skilled labour — conduit laying and wiring, floor 1 (July 2025)',
       'Ramesh Construction', NULL,
       42000.00, 42000.00, 'APPROVED',
       (SELECT id FROM users WHERE emp_code = 'E002'),
       '2025-08-01 10:00:00',
       (SELECT id FROM users WHERE emp_code = 'E005'),
       '2025-08-02 09:00:00',
       'Approved in full — attendance records verified'
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM site_expenses WHERE doc_no = 'EXP/25-26/0002');

INSERT IGNORE INTO site_expense_events (expense_id, action, amount, user_id, note)
SELECT id, 'SUBMITTED', NULL, (SELECT id FROM users WHERE emp_code='E002'), NULL
FROM site_expenses WHERE doc_no = 'EXP/25-26/0002';
INSERT IGNORE INTO site_expense_events (expense_id, action, amount, user_id, note)
SELECT id, 'APPROVED', 42000.00, (SELECT id FROM users WHERE emp_code='E005'), NULL
FROM site_expenses WHERE doc_no = 'EXP/25-26/0002';

-- EXP3: GMR T2 — Food (APPROVED, partial)
INSERT INTO site_expenses (doc_no, site_id, branch_id, category_id,
                            spent_on, description, paid_to, bill_no,
                            claimed_amount, approved_amount, status, raised_by,
                            submitted_at, decided_by, decided_at, decision_note)
SELECT 'EXP/25-26/0003',
       (SELECT id FROM sites WHERE code = 'ST-0001'),
       (SELECT id FROM branches WHERE code = 'HYD'),
       (SELECT id FROM expense_categories WHERE name = 'Food and refreshment'),
       '2025-07-31',
       'Lunch for 12 workers — July 2025 (24 working days)',
       'Annapurna Canteen', NULL,
       7200.00, 7200.00, 'APPROVED',
       (SELECT id FROM users WHERE emp_code = 'E002'),
       '2025-08-01 10:15:00',
       (SELECT id FROM users WHERE emp_code = 'E005'),
       '2025-08-02 09:00:00',
       'Approved'
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM site_expenses WHERE doc_no = 'EXP/25-26/0003');

INSERT IGNORE INTO site_expense_events (expense_id, action, amount, user_id, note)
SELECT id, 'SUBMITTED', NULL, (SELECT id FROM users WHERE emp_code='E002'), NULL
FROM site_expenses WHERE doc_no = 'EXP/25-26/0003';
INSERT IGNORE INTO site_expense_events (expense_id, action, amount, user_id, note)
SELECT id, 'APPROVED', 7200.00, (SELECT id FROM users WHERE emp_code='E005'), NULL
FROM site_expenses WHERE doc_no = 'EXP/25-26/0003';

-- EXP4: Brigade — Transport (SUBMITTED, pending approval)
INSERT INTO site_expenses (doc_no, site_id, branch_id, category_id,
                            spent_on, description, paid_to, bill_no,
                            claimed_amount, approved_amount, status, raised_by, submitted_at)
SELECT 'EXP/25-26/0004',
       (SELECT id FROM sites WHERE code = 'ST-0002'),
       (SELECT id FROM branches WHERE code = 'HYD'),
       (SELECT id FROM expense_categories WHERE name = 'Transport'),
       '2025-08-20',
       'Lorry hire — armoured cable transport from HYD store to Brigade site',
       'Raju Transport', 'RT/2025/0499',
       8500.00, NULL, 'SUBMITTED',
       (SELECT id FROM users WHERE emp_code = 'E004'),
       '2025-08-21 08:30:00'
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM site_expenses WHERE doc_no = 'EXP/25-26/0004');

INSERT IGNORE INTO site_expense_events (expense_id, action, amount, user_id, note)
SELECT id, 'SUBMITTED', NULL, (SELECT id FROM users WHERE emp_code='E004'), NULL
FROM site_expenses WHERE doc_no = 'EXP/25-26/0004';

-- EXP5: Brigade — Labour (APPROVED)
INSERT INTO site_expenses (doc_no, site_id, branch_id, category_id,
                            spent_on, description, paid_to, bill_no,
                            claimed_amount, approved_amount, status, raised_by,
                            submitted_at, decided_by, decided_at, decision_note)
SELECT 'EXP/25-26/0005',
       (SELECT id FROM sites WHERE code = 'ST-0002'),
       (SELECT id FROM branches WHERE code = 'HYD'),
       (SELECT id FROM expense_categories WHERE name = 'Labour'),
       '2025-08-31',
       'Skilled labour — cable pulling and termination, floors B2 to 5 (Aug 2025)',
       'Reddy Electricals Sub-contract', NULL,
       65000.00, 65000.00, 'APPROVED',
       (SELECT id FROM users WHERE emp_code = 'E004'),
       '2025-09-01 09:00:00',
       (SELECT id FROM users WHERE emp_code = 'E005'),
       '2025-09-02 10:00:00',
       'Approved in full'
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM site_expenses WHERE doc_no = 'EXP/25-26/0005');

INSERT IGNORE INTO site_expense_events (expense_id, action, amount, user_id, note)
SELECT id, 'SUBMITTED', NULL, (SELECT id FROM users WHERE emp_code='E004'), NULL
FROM site_expenses WHERE doc_no = 'EXP/25-26/0005';
INSERT IGNORE INTO site_expense_events (expense_id, action, amount, user_id, note)
SELECT id, 'APPROVED', 65000.00, (SELECT id FROM users WHERE emp_code='E005'), NULL
FROM site_expenses WHERE doc_no = 'EXP/25-26/0005';

-- EXP6: GMR T2 — Fuel (APPROVED)
INSERT INTO site_expenses (doc_no, site_id, branch_id, category_id,
                            spent_on, description, paid_to, bill_no,
                            claimed_amount, approved_amount, status, raised_by,
                            submitted_at, decided_by, decided_at, decision_note)
SELECT 'EXP/25-26/0006',
       (SELECT id FROM sites WHERE code = 'ST-0001'),
       (SELECT id FROM branches WHERE code = 'HYD'),
       (SELECT id FROM expense_categories WHERE name = 'Fuel'),
       '2025-08-15',
       'Generator fuel — power outage during DB board testing',
       'HP Petrol Pump', 'HP/2025/188',
       3200.00, 3200.00, 'APPROVED',
       (SELECT id FROM users WHERE emp_code = 'E002'),
       '2025-08-16 08:00:00',
       (SELECT id FROM users WHERE emp_code = 'E005'),
       '2025-08-16 18:00:00',
       'Approved'
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM site_expenses WHERE doc_no = 'EXP/25-26/0006');

INSERT IGNORE INTO site_expense_events (expense_id, action, amount, user_id, note)
SELECT id, 'SUBMITTED', NULL, (SELECT id FROM users WHERE emp_code='E002'), NULL
FROM site_expenses WHERE doc_no = 'EXP/25-26/0006';
INSERT IGNORE INTO site_expense_events (expense_id, action, amount, user_id, note)
SELECT id, 'APPROVED', 3200.00, (SELECT id FROM users WHERE emp_code='E005'), NULL
FROM site_expenses WHERE doc_no = 'EXP/25-26/0006';

-- =====================================================================
-- BLOCK 15 — BILLS (RA bills for GMR T2 and Brigade)
-- =====================================================================

-- RA1: GMR T2 — RA-1 (RAISED)
INSERT INTO bills (doc_no, ra_no, site_id, branch_id, work_order_id, client_id,
                   bill_date, period_from, period_to, status, client_ref,
                   note, raised_at, raised_by, created_by)
SELECT 'RA/25-26/0001', 1,
       (SELECT id FROM sites WHERE code = 'ST-0001'),
       (SELECT id FROM branches WHERE code = 'HYD'),
       (SELECT id FROM work_orders WHERE doc_no = 'WO/25-26/0001'),
       (SELECT client_id FROM sites WHERE code = 'ST-0001'),
       '2025-07-31', '2025-06-01', '2025-07-31',
       'RAISED', 'GMR/CERT/2025/041',
       'First running account bill — floor 1 work completed',
       '2025-07-31 17:00:00',
       (SELECT id FROM users WHERE emp_code = 'E005'),
       (SELECT id FROM users WHERE emp_code = 'E001')
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM bills WHERE doc_no = 'RA/25-26/0001');

INSERT IGNORE INTO bill_lines (bill_id, wo_line_id, qty, supply_rate, inst_rate, remark)
SELECT b.id, wol.id, 100.000, wol.supply_rate, wol.inst_rate,
       'RA-1: 100 light points completed — floor 1 (Jun–Jul 2025)'
FROM bills b
JOIN work_orders wo ON wo.id = b.work_order_id
JOIN work_order_lines wol ON wol.work_order_id = wo.id
WHERE b.doc_no = 'RA/25-26/0001' AND wol.sno = 1;

INSERT IGNORE INTO bill_lines (bill_id, wo_line_id, qty, supply_rate, inst_rate, remark)
SELECT b.id, wol.id, 3500.000, wol.supply_rate, wol.inst_rate,
       'RA-1: 3500m wiring completed — floor 1'
FROM bills b
JOIN work_orders wo ON wo.id = b.work_order_id
JOIN work_order_lines wol ON wol.work_order_id = wo.id
WHERE b.doc_no = 'RA/25-26/0001' AND wol.sno = 2;

INSERT IGNORE INTO bill_lines (bill_id, wo_line_id, qty, supply_rate, inst_rate, remark)
SELECT b.id, wol.id, 60.000, wol.supply_rate, wol.inst_rate,
       'RA-1: 60 MCBs installed — DB boards F1 and F2'
FROM bills b
JOIN work_orders wo ON wo.id = b.work_order_id
JOIN work_order_lines wol ON wol.work_order_id = wo.id
WHERE b.doc_no = 'RA/25-26/0001' AND wol.sno = 3;

-- RA2: GMR T2 — RA-2 DRAFT (in progress)
INSERT INTO bills (doc_no, ra_no, site_id, branch_id, work_order_id, client_id,
                   bill_date, period_from, period_to, status, note, created_by)
SELECT 'RA/25-26/0002', 2,
       (SELECT id FROM sites WHERE code = 'ST-0001'),
       (SELECT id FROM branches WHERE code = 'HYD'),
       (SELECT id FROM work_orders WHERE doc_no = 'WO/25-26/0001'),
       (SELECT client_id FROM sites WHERE code = 'ST-0001'),
       '2025-08-31', '2025-08-01', '2025-08-31',
       'DRAFT', 'Second RA being prepared — floor 2 work',
       (SELECT id FROM users WHERE emp_code = 'E001')
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM bills WHERE doc_no = 'RA/25-26/0002');

INSERT IGNORE INTO bill_lines (bill_id, wo_line_id, qty, supply_rate, inst_rate, remark)
SELECT b.id, wol.id, 60.000, wol.supply_rate, wol.inst_rate,
       'RA-2 DRAFT: 60 light points — floor 2 (in progress)'
FROM bills b
JOIN work_orders wo ON wo.id = b.work_order_id
JOIN work_order_lines wol ON wol.work_order_id = wo.id
WHERE b.doc_no = 'RA/25-26/0002' AND wol.sno = 1;

SET FOREIGN_KEY_CHECKS = 1;
