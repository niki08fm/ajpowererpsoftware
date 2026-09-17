-- =====================================================================
--  EXPANDED DEMO DATA — doubles the existing dataset
--  Adds: 2 new clients, 1 more HYD store, 1 more BLR store,
--        5 new project sites (3 HYD, 2 BLR),
--        6 new work orders with full BOQ/indent lifecycles covering
--        every pipeline stage so every dashboard page has rows.
--
--  Pipeline coverage designed here:
--    WO4 (Prestige HYD)  → full lifecycle + second RA bill
--    WO5 (DLF HYD)       → approved, DC IN_TRANSIT (store desk "out unsigned")
--    WO6 (Sobha HYD)     → indent AWAITING_PO (procurement queue default)
--    WO7 (Prestige BLR)  → PO APPROVED awaiting GRN (store desk "coming in")
--    WO8 (Embassy BLR)   → indent SUBMITTED only (NOT yet approved)
--    WO9 (DLF BLR)       → DRAFT BOQ (planning early stage)
--
--  All doc numbers use FY 25-26 continuing from 003_demo_data.sql.
-- =====================================================================

SET FOREIGN_KEY_CHECKS = 0;
SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;

-- =====================================================================
-- BLOCK 0 — counter bootstraps
-- =====================================================================
INSERT INTO item_code_counters (category_code, last_no) VALUES
  ('ST', 8), ('GD', 4)
ON DUPLICATE KEY UPDATE last_no = GREATEST(last_no, VALUES(last_no));

INSERT INTO doc_counters (doc_type, fy, last_no) VALUES
  ('WO',  '25-26', 9),
  ('BOQ', '25-26', 9),
  ('IND', '25-26', 16),
  ('CMP', '25-26', 6),
  ('PO',  '25-26', 8),
  ('GRN', '25-26', 5),
  ('DC',  '25-26', 7),
  ('CON', '25-26', 8),
  ('RET', '25-26', 3),
  ('EXP', '25-26', 18),
  ('RA',  '25-26', 7)
ON DUPLICATE KEY UPDATE last_no = GREATEST(last_no, VALUES(last_no));

-- =====================================================================
-- BLOCK 1 — new clients
-- =====================================================================
INSERT INTO clients (branch_id, name, norm_key, sort_key, gstin, address, contact_name, contact_phone)
VALUES
  (1, 'Prestige Estates Projects Ltd',
   'prestige estates projects ltd', 'estates ltd prestige projects',
   '36AABCP9876A1Z5', 'Banjara Hills, Hyderabad', 'Rajiv Menon', '9912345678'),
  (1, 'DLF Ltd Hyderabad',
   'dlf ltd hyderabad', 'dlf hyderabad ltd',
   '36AABCD5432A1Z5', 'Gachibowli, Hyderabad', 'Priya Sharma', '9876501234'),
  (2, 'Embassy Office Parks REIT',
   'embassy office parks reit', 'embassy office parks reit',
   '29AABCE6789A1Z5', 'Outer Ring Road, Bengaluru', 'Suresh Nambiar', '9845098765'),
  (2, 'Sobha Ltd',
   'sobha ltd', 'ltd sobha',
   '29AABCS3456A1Z5', 'Hebbal, Bengaluru', 'Anitha Kumar', '9900445566')
ON DUPLICATE KEY UPDATE name = VALUES(name);

-- =====================================================================
-- BLOCK 2 — new suppliers
-- =====================================================================
INSERT INTO suppliers (code, name, norm_key, sort_key, gstin, address,
                       contact_name, contact_phone, terms_days, status, created_by)
VALUES
  ('SUP-0004', 'Hyderabad Cable Traders',
   'hyderabad cable traders', 'cable hyderabad traders',
   '36AABHC7890A1Z5', '44, SD Road, Secunderabad',
   'Mohan Rao', '9848012345', 30, 'ACTIVE', 1),
  ('SUP-0005', 'South India Electricals',
   'south india electricals', 'electricals india south',
   '29AABSI4321A1Z5', '22, Brigade Road, Bengaluru',
   'Deepa Krishnan', '9980123456', 45, 'ACTIVE', 1)
ON DUPLICATE KEY UPDATE name = VALUES(name);

-- =====================================================================
-- BLOCK 3 — stores (2 more: one HYD secondary, one BLR secondary)
-- =====================================================================

-- HYD Site Store (Shamshabad — closer to airport sites)
INSERT INTO sites (code, name, norm_key, sort_key, site_type, branch_id,
                   client_id, head_user_id, keeper_user_id, gm_user_id,
                   is_central, location, start_date, status)
SELECT 'GD-0003', 'HYD Shamshabad Store',
       'hyd shamshabad store', 'hyd shamshabad store',
       'STORE', 1, NULL,
       (SELECT id FROM users WHERE emp_code='E001'),
       (SELECT id FROM users WHERE emp_code='E003'),
       NULL, 0, 'Shamshabad, Hyderabad', '2024-10-01', 'ACTIVE'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM sites WHERE code='GD-0003');

-- BLR Whitefield Store
INSERT INTO sites (code, name, norm_key, sort_key, site_type, branch_id,
                   client_id, head_user_id, keeper_user_id, gm_user_id,
                   is_central, location, start_date, status)
SELECT 'GD-0004', 'BLR Whitefield Store',
       'blr whitefield store', 'blr whitefield store',
       'STORE', 2, NULL,
       (SELECT id FROM users WHERE emp_code='E001'),
       (SELECT id FROM users WHERE emp_code='E003'),
       NULL, 0, 'Whitefield, Bengaluru', '2024-10-01', 'ACTIVE'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM sites WHERE code='GD-0004');

-- =====================================================================
-- BLOCK 4 — 5 new project sites
-- =====================================================================

-- ST-0004: Prestige Hi-Tech City (HYD)
INSERT INTO sites (code, name, norm_key, sort_key, site_type, branch_id,
                   client_id, head_user_id, keeper_user_id, gm_user_id, is_central,
                   location, billing_address, start_date, target_completion, status)
SELECT 'ST-0004', 'Prestige Hi-Tech City Tower C',
       'prestige hi tech city tower c', 'c city hi prestige tech tower',
       'SITE', 1,
       (SELECT id FROM clients WHERE norm_key='prestige estates projects ltd'),
       (SELECT id FROM users WHERE emp_code='E002'),
       (SELECT id FROM users WHERE emp_code='E003'),
       (SELECT id FROM users WHERE emp_code='E005'),
       0, 'Hi-Tech City, Hyderabad',
       'Prestige Estates Projects Ltd, Hi-Tech City, Hyderabad - 500081',
       '2025-06-15', '2026-04-30', 'ACTIVE'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM sites WHERE code='ST-0004');

-- ST-0005: DLF Cybercity (HYD)
INSERT INTO sites (code, name, norm_key, sort_key, site_type, branch_id,
                   client_id, head_user_id, keeper_user_id, gm_user_id, is_central,
                   location, billing_address, start_date, target_completion, status)
SELECT 'ST-0005', 'DLF Cybercity Phase 3',
       'dlf cybercity phase 3', '3 cybercity dlf phase',
       'SITE', 1,
       (SELECT id FROM clients WHERE norm_key='dlf ltd hyderabad'),
       (SELECT id FROM users WHERE emp_code='E004'),
       (SELECT id FROM users WHERE emp_code='E003'),
       (SELECT id FROM users WHERE emp_code='E005'),
       0, 'Gachibowli, Hyderabad',
       'DLF Ltd, Cybercity Phase 3, Gachibowli, Hyderabad - 500032',
       '2025-08-01', '2026-07-31', 'ACTIVE'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM sites WHERE code='ST-0005');

-- ST-0006: Sobha Dream Acres (HYD)
INSERT INTO sites (code, name, norm_key, sort_key, site_type, branch_id,
                   client_id, head_user_id, keeper_user_id, gm_user_id, is_central,
                   location, billing_address, start_date, target_completion, status)
SELECT 'ST-0006', 'Sobha Dream Acres Block D',
       'sobha dream acres block d', 'acres block d dream sobha',
       'SITE', 1,
       (SELECT id FROM clients WHERE norm_key='sobha ltd'),
       (SELECT id FROM users WHERE emp_code='E002'),
       (SELECT id FROM users WHERE emp_code='E003'),
       (SELECT id FROM users WHERE emp_code='E005'),
       0, 'Kothur, Hyderabad',
       'Sobha Ltd, Dream Acres Block D, Kothur, Hyderabad - 509228',
       '2025-09-01', '2026-12-31', 'ACTIVE'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM sites WHERE code='ST-0006');

-- ST-0007: Embassy Manyata (BLR)
INSERT INTO sites (code, name, norm_key, sort_key, site_type, branch_id,
                   client_id, head_user_id, keeper_user_id, gm_user_id, is_central,
                   location, billing_address, start_date, target_completion, status)
SELECT 'ST-0007', 'Embassy Manyata Business Park G1',
       'embassy manyata business park g1', 'business embassy g1 manyata park',
       'SITE', 2,
       (SELECT id FROM clients WHERE norm_key='embassy office parks reit'),
       (SELECT id FROM users WHERE emp_code='E004'),
       (SELECT id FROM users WHERE emp_code='E003'),
       (SELECT id FROM users WHERE emp_code='E005'),
       0, 'Manyata Tech Park, Bengaluru',
       'Embassy Office Parks REIT, Manyata Business Park, Bengaluru - 560045',
       '2025-07-01', '2026-05-31', 'ACTIVE'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM sites WHERE code='ST-0007');

-- ST-0008: DLF Downtown BLR
INSERT INTO sites (code, name, norm_key, sort_key, site_type, branch_id,
                   client_id, head_user_id, keeper_user_id, gm_user_id, is_central,
                   location, billing_address, start_date, target_completion, status)
SELECT 'ST-0008', 'DLF Downtown Bengaluru Tower A',
       'dlf downtown bengaluru tower a', 'a bengaluru dlf downtown tower',
       'SITE', 2,
       (SELECT id FROM clients WHERE norm_key='embassy office parks reit'),
       (SELECT id FROM users WHERE emp_code='E004'),
       (SELECT id FROM users WHERE emp_code='E003'),
       (SELECT id FROM users WHERE emp_code='E005'),
       0, 'Hebbal, Bengaluru',
       'Embassy Office Parks, DLF Downtown, Hebbal, Bengaluru - 560024',
       '2025-10-01', '2027-03-31', 'ACTIVE'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM sites WHERE code='ST-0008');

-- Site teams
INSERT IGNORE INTO site_team (site_id, user_id)
SELECT s.id, u.id FROM sites s, users u
WHERE (s.code = 'ST-0004' AND u.emp_code IN ('E001','E002','E003','E005'))
   OR (s.code = 'ST-0005' AND u.emp_code IN ('E001','E004','E003','E005'))
   OR (s.code = 'ST-0006' AND u.emp_code IN ('E001','E002','E003','E005'))
   OR (s.code = 'ST-0007' AND u.emp_code IN ('E001','E004','E003','E005'))
   OR (s.code = 'ST-0008' AND u.emp_code IN ('E001','E004','E003','E005'));

-- =====================================================================
-- BLOCK 5 — 6 new work orders
-- =====================================================================

-- WO4: Prestige Hi-Tech City (HYD) — full lifecycle
INSERT INTO work_orders (doc_no, site_id, branch_id, client_wo_no, wo_date, status, created_by)
SELECT 'WO/25-26/0004', (SELECT id FROM sites WHERE code='ST-0004'), 1,
       'PEPL/EL/WO/2025/019', '2025-06-20', 'LOCKED',
       (SELECT id FROM users WHERE emp_code='E001')
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM work_orders WHERE doc_no='WO/25-26/0004');

INSERT INTO work_order_lines (work_order_id, sno, description, uom_id, qty, supply_rate, inst_rate)
SELECT wo.id, 1, 'Supply and install switch & socket points (concealed)',
       (SELECT id FROM uoms WHERE code="No's"), 300.000, 680.00, 420.00
FROM work_orders wo WHERE wo.doc_no='WO/25-26/0004'
  AND NOT EXISTS (SELECT 1 FROM work_order_lines x WHERE x.work_order_id=wo.id AND x.sno=1);

INSERT INTO work_order_lines (work_order_id, sno, description, uom_id, qty, supply_rate, inst_rate)
SELECT wo.id, 2, 'Supply and install LED downlights (12W recessed)',
       (SELECT id FROM uoms WHERE code="No's"), 180.000, 950.00, 280.00
FROM work_orders wo WHERE wo.doc_no='WO/25-26/0004'
  AND NOT EXISTS (SELECT 1 FROM work_order_lines x WHERE x.work_order_id=wo.id AND x.sno=2);

INSERT INTO work_order_lines (work_order_id, sno, description, uom_id, qty, supply_rate, inst_rate)
SELECT wo.id, 3, 'Supply and install 2.5 sq mm FR-LSH wiring',
       (SELECT id FROM uoms WHERE code='Mtrs'), 6000.000, 42.00, 18.00
FROM work_orders wo WHERE wo.doc_no='WO/25-26/0004'
  AND NOT EXISTS (SELECT 1 FROM work_order_lines x WHERE x.work_order_id=wo.id AND x.sno=3);

-- WO5: DLF Cybercity (HYD) — DC in transit, store desk shows "out unsigned"
INSERT INTO work_orders (doc_no, site_id, branch_id, client_wo_no, wo_date, status, created_by)
SELECT 'WO/25-26/0005', (SELECT id FROM sites WHERE code='ST-0005'), 1,
       'DLF/EL/WO/2025/007', '2025-07-10', 'LOCKED',
       (SELECT id FROM users WHERE emp_code='E001')
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM work_orders WHERE doc_no='WO/25-26/0005');

INSERT INTO work_order_lines (work_order_id, sno, description, uom_id, qty, supply_rate, inst_rate)
SELECT wo.id, 1, 'Supply and install cable trays (GI perforated 100x50)',
       (SELECT id FROM uoms WHERE code='Mtrs'), 800.000, 380.00, 95.00
FROM work_orders wo WHERE wo.doc_no='WO/25-26/0005'
  AND NOT EXISTS (SELECT 1 FROM work_order_lines x WHERE x.work_order_id=wo.id AND x.sno=1);

INSERT INTO work_order_lines (work_order_id, sno, description, uom_id, qty, supply_rate, inst_rate)
SELECT wo.id, 2, 'Supply and install 4C x 10 SQ MM copper armoured cable',
       (SELECT id FROM uoms WHERE code='Mtrs'), 1200.000, 720.00, 90.00
FROM work_orders wo WHERE wo.doc_no='WO/25-26/0005'
  AND NOT EXISTS (SELECT 1 FROM work_order_lines x WHERE x.work_order_id=wo.id AND x.sno=2);

-- WO6: Sobha Dream Acres (HYD) — indent AWAITING_PO (procurement queue default view)
INSERT INTO work_orders (doc_no, site_id, branch_id, client_wo_no, wo_date, status, created_by)
SELECT 'WO/25-26/0006', (SELECT id FROM sites WHERE code='ST-0006'), 1,
       'SL/EL/WO/2025/033', '2025-09-05', 'LOCKED',
       (SELECT id FROM users WHERE emp_code='E001')
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM work_orders WHERE doc_no='WO/25-26/0006');

INSERT INTO work_order_lines (work_order_id, sno, description, uom_id, qty, supply_rate, inst_rate)
SELECT wo.id, 1, 'Supply and install earthing system (GI flat + base plates)',
       (SELECT id FROM uoms WHERE code="No's"), 40.000, 3200.00, 1800.00
FROM work_orders wo WHERE wo.doc_no='WO/25-26/0006'
  AND NOT EXISTS (SELECT 1 FROM work_order_lines x WHERE x.work_order_id=wo.id AND x.sno=1);

INSERT INTO work_order_lines (work_order_id, sno, description, uom_id, qty, supply_rate, inst_rate)
SELECT wo.id, 2, 'Supply and install 4C x 2.5 SQ MM copper armoured cable (sub-mains)',
       (SELECT id FROM uoms WHERE code='Mtrs'), 900.000, 285.00, 65.00
FROM work_orders wo WHERE wo.doc_no='WO/25-26/0006'
  AND NOT EXISTS (SELECT 1 FROM work_order_lines x WHERE x.work_order_id=wo.id AND x.sno=2);

-- WO7: Embassy Manyata BLR — PO approved, GRN pending (store desk "coming in")
INSERT INTO work_orders (doc_no, site_id, branch_id, client_wo_no, wo_date, status, created_by)
SELECT 'WO/25-26/0007', (SELECT id FROM sites WHERE code='ST-0007'), 2,
       'EMREIT/EL/WO/2025/011', '2025-07-05', 'LOCKED',
       (SELECT id FROM users WHERE emp_code='E001')
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM work_orders WHERE doc_no='WO/25-26/0007');

INSERT INTO work_order_lines (work_order_id, sno, description, uom_id, qty, supply_rate, inst_rate)
SELECT wo.id, 1, 'Supply and install RCCB (25A DP 30mA) in tenant DB boards',
       (SELECT id FROM uoms WHERE code="No's"), 160.000, 1850.00, 320.00
FROM work_orders wo WHERE wo.doc_no='WO/25-26/0007'
  AND NOT EXISTS (SELECT 1 FROM work_order_lines x WHERE x.work_order_id=wo.id AND x.sno=1);

INSERT INTO work_order_lines (work_order_id, sno, description, uom_id, qty, supply_rate, inst_rate)
SELECT wo.id, 2, 'Supply and install 16A SP MCBs (tenant circuit protection)',
       (SELECT id FROM uoms WHERE code="No's"), 480.000, 320.00, 85.00
FROM work_orders wo WHERE wo.doc_no='WO/25-26/0007'
  AND NOT EXISTS (SELECT 1 FROM work_order_lines x WHERE x.work_order_id=wo.id AND x.sno=2);

-- WO8: DLF Downtown BLR — indent submitted, not yet approved
INSERT INTO work_orders (doc_no, site_id, branch_id, client_wo_no, wo_date, status, created_by)
SELECT 'WO/25-26/0008', (SELECT id FROM sites WHERE code='ST-0008'), 2,
       'DLF/BLR/EL/WO/2025/002', '2025-10-10', 'LOCKED',
       (SELECT id FROM users WHERE emp_code='E001')
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM work_orders WHERE doc_no='WO/25-26/0008');

INSERT INTO work_order_lines (work_order_id, sno, description, uom_id, qty, supply_rate, inst_rate)
SELECT wo.id, 1, 'Supply and install isolators (100A FP, main incomer)',
       (SELECT id FROM uoms WHERE code="No's"), 24.000, 8500.00, 2200.00
FROM work_orders wo WHERE wo.doc_no='WO/25-26/0008'
  AND NOT EXISTS (SELECT 1 FROM work_order_lines x WHERE x.work_order_id=wo.id AND x.sno=1);

INSERT INTO work_order_lines (work_order_id, sno, description, uom_id, qty, supply_rate, inst_rate)
SELECT wo.id, 2, 'Supply and install 4C x 16 SQ MM aluminium armoured cable (risers)',
       (SELECT id FROM uoms WHERE code='Mtrs'), 1500.000, 420.00, 75.00
FROM work_orders wo WHERE wo.doc_no='WO/25-26/0008'
  AND NOT EXISTS (SELECT 1 FROM work_order_lines x WHERE x.work_order_id=wo.id AND x.sno=2);

-- WO9 removed (ST-0003 already has WO/25-26/0003; one WO per site enforced by schema)

-- Note: ST-0003 already has WO/25-26/0003 (one WO per site enforced by schema).
-- DLF Downtown BLR (ST-0008) gets WO8 as its only work order.

-- =====================================================================
-- BLOCK 6 — BOQs for new WOs
-- =====================================================================

-- BOQ4: Prestige Hi-Tech (LOCKED)
INSERT INTO boqs (doc_no, site_id, branch_id, work_order_id, status, over_allow, over_pct, submitted_at, created_by)
SELECT 'BOQ/25-26/0004',
       (SELECT id FROM sites WHERE code='ST-0004'), 1,
       (SELECT id FROM work_orders WHERE doc_no='WO/25-26/0004'),
       'LOCKED', 1, 5.00, '2025-06-28 11:00:00',
       (SELECT id FROM users WHERE emp_code='E001')
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM boqs WHERE doc_no='BOQ/25-26/0004');

-- BOQ5: DLF Cybercity (LOCKED)
INSERT INTO boqs (doc_no, site_id, branch_id, work_order_id, status, over_allow, over_pct, submitted_at, created_by)
SELECT 'BOQ/25-26/0005',
       (SELECT id FROM sites WHERE code='ST-0005'), 1,
       (SELECT id FROM work_orders WHERE doc_no='WO/25-26/0005'),
       'LOCKED', 0, 0.00, '2025-07-15 14:00:00',
       (SELECT id FROM users WHERE emp_code='E001')
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM boqs WHERE doc_no='BOQ/25-26/0005');

-- BOQ6: Sobha HYD (LOCKED)
INSERT INTO boqs (doc_no, site_id, branch_id, work_order_id, status, over_allow, over_pct, submitted_at, created_by)
SELECT 'BOQ/25-26/0006',
       (SELECT id FROM sites WHERE code='ST-0006'), 1,
       (SELECT id FROM work_orders WHERE doc_no='WO/25-26/0006'),
       'LOCKED', 1, 8.00, '2025-09-10 10:00:00',
       (SELECT id FROM users WHERE emp_code='E001')
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM boqs WHERE doc_no='BOQ/25-26/0006');

-- BOQ7: Embassy Manyata BLR (LOCKED)
INSERT INTO boqs (doc_no, site_id, branch_id, work_order_id, status, over_allow, over_pct, submitted_at, created_by)
SELECT 'BOQ/25-26/0007',
       (SELECT id FROM sites WHERE code='ST-0007'), 2,
       (SELECT id FROM work_orders WHERE doc_no='WO/25-26/0007'),
       'LOCKED', 0, 0.00, '2025-07-12 09:00:00',
       (SELECT id FROM users WHERE emp_code='E001')
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM boqs WHERE doc_no='BOQ/25-26/0007');

-- BOQ8: DLF Downtown BLR (DRAFT — planning in progress)
INSERT INTO boqs (doc_no, site_id, branch_id, work_order_id, status, over_allow, over_pct, created_by)
SELECT 'BOQ/25-26/0008',
       (SELECT id FROM sites WHERE code='ST-0008'), 2,
       (SELECT id FROM work_orders WHERE doc_no='WO/25-26/0008'),
       'DRAFT', 1, 10.00,
       (SELECT id FROM users WHERE emp_code='E001')
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM boqs WHERE doc_no='BOQ/25-26/0008');

-- =====================================================================
-- BLOCK 7 — BOQ_WO_LINES for new BOQs
-- =====================================================================
INSERT IGNORE INTO boq_wo_lines (boq_id, wo_line_id, est_qty, var_qty)
SELECT b.id, wol.id, wol.qty, 0
FROM boqs b
JOIN work_orders wo ON wo.id=b.work_order_id
JOIN work_order_lines wol ON wol.work_order_id=wo.id
WHERE b.doc_no IN ('BOQ/25-26/0004','BOQ/25-26/0005','BOQ/25-26/0006',
                   'BOQ/25-26/0007','BOQ/25-26/0008');

-- =====================================================================
-- BLOCK 8 — BOQ_LINES for new BOQs
-- =====================================================================

-- BOQ4 / WO4-Line1 (switch & socket): metal box, switch white, front plate
INSERT IGNORE INTO boq_lines (boq_id, boq_wo_line_id, sno, item_id, make_id, uom_id, item_qty, boq_qty, est_qty, var_qty)
SELECT b.id, bwl.id, '1a', 1487, NULL,
       (SELECT id FROM uoms WHERE code="No's"),
       1.000, wol.qty, ROUND(wol.qty*1.05,3), 0
FROM boqs b JOIN boq_wo_lines bwl ON bwl.boq_id=b.id JOIN work_order_lines wol ON wol.id=bwl.wo_line_id
WHERE b.doc_no='BOQ/25-26/0004' AND wol.sno=1;  -- SWS-0001 metal box

INSERT IGNORE INTO boq_lines (boq_id, boq_wo_line_id, sno, item_id, make_id, uom_id, item_qty, boq_qty, est_qty, var_qty)
SELECT b.id, bwl.id, '1b', 1490, NULL,
       (SELECT id FROM uoms WHERE code="No's"),
       1.000, wol.qty, ROUND(wol.qty*1.05,3), 0
FROM boqs b JOIN boq_wo_lines bwl ON bwl.boq_id=b.id JOIN work_order_lines wol ON wol.id=bwl.wo_line_id
WHERE b.doc_no='BOQ/25-26/0004' AND wol.sno=1;  -- SWS-0004 switch white

INSERT IGNORE INTO boq_lines (boq_id, boq_wo_line_id, sno, item_id, make_id, uom_id, item_qty, boq_qty, est_qty, var_qty)
SELECT b.id, bwl.id, '1c', 1491, NULL,
       (SELECT id FROM uoms WHERE code="No's"),
       1.000, wol.qty, ROUND(wol.qty*1.05,3), 0
FROM boqs b JOIN boq_wo_lines bwl ON bwl.boq_id=b.id JOIN work_order_lines wol ON wol.id=bwl.wo_line_id
WHERE b.doc_no='BOQ/25-26/0004' AND wol.sno=1;  -- SWS-0005 front plate white

-- BOQ4 / WO4-Line2 (LED downlights)
INSERT IGNORE INTO boq_lines (boq_id, boq_wo_line_id, sno, item_id, make_id, uom_id, item_qty, boq_qty, est_qty, var_qty)
SELECT b.id, bwl.id, '2a', 1150, NULL,
       (SELECT id FROM uoms WHERE code="No's"),
       1.000, wol.qty, ROUND(wol.qty*1.03,3), 0
FROM boqs b JOIN boq_wo_lines bwl ON bwl.boq_id=b.id JOIN work_order_lines wol ON wol.id=bwl.wo_line_id
WHERE b.doc_no='BOQ/25-26/0004' AND wol.sno=2;  -- LIT-0002 12W LED

-- BOQ4 / WO4-Line3 (2.5mm wiring — black + blue + green)
INSERT IGNORE INTO boq_lines (boq_id, boq_wo_line_id, sno, item_id, make_id, uom_id, item_qty, boq_qty, est_qty, var_qty)
SELECT b.id, bwl.id, '3a', 2578,
       (SELECT id FROM makes WHERE name='POLY CAB'),
       (SELECT id FROM uoms WHERE code='Mtrs'),
       1.000, wol.qty, ROUND(wol.qty*1.05,3), 0
FROM boqs b JOIN boq_wo_lines bwl ON bwl.boq_id=b.id JOIN work_order_lines wol ON wol.id=bwl.wo_line_id
WHERE b.doc_no='BOQ/25-26/0004' AND wol.sno=3;  -- WIR-0023 2.5mm black

INSERT IGNORE INTO boq_lines (boq_id, boq_wo_line_id, sno, item_id, make_id, uom_id, item_qty, boq_qty, est_qty, var_qty)
SELECT b.id, bwl.id, '3b', 2580,
       (SELECT id FROM makes WHERE name='POLY CAB'),
       (SELECT id FROM uoms WHERE code='Mtrs'),
       1.000, wol.qty, ROUND(wol.qty*1.05,3), 0
FROM boqs b JOIN boq_wo_lines bwl ON bwl.boq_id=b.id JOIN work_order_lines wol ON wol.id=bwl.wo_line_id
WHERE b.doc_no='BOQ/25-26/0004' AND wol.sno=3;  -- WIR-0025 2.5mm blue

-- BOQ5 / WO5-Line1 (cable trays)
INSERT IGNORE INTO boq_lines (boq_id, boq_wo_line_id, sno, item_id, make_id, uom_id, item_qty, boq_qty, est_qty, var_qty)
SELECT b.id, bwl.id, '1a', 131, NULL,
       (SELECT id FROM uoms WHERE code='Mtrs'),
       1.000, wol.qty, ROUND(wol.qty*1.05,3), 0
FROM boqs b JOIN boq_wo_lines bwl ON bwl.boq_id=b.id JOIN work_order_lines wol ON wol.id=bwl.wo_line_id
WHERE b.doc_no='BOQ/25-26/0005' AND wol.sno=1;  -- CTR-0001 GI ladder tray

-- BOQ5 / WO5-Line2 (4C x 10 SQ MM AR cable)
INSERT IGNORE INTO boq_lines (boq_id, boq_wo_line_id, sno, item_id, make_id, uom_id, item_qty, boq_qty, est_qty, var_qty)
SELECT b.id, bwl.id, '2a', 32,
       (SELECT id FROM makes WHERE name='KEI'),
       (SELECT id FROM uoms WHERE code='Mtrs'),
       1.000, wol.qty, ROUND(wol.qty*1.03,3), 0
FROM boqs b JOIN boq_wo_lines bwl ON bwl.boq_id=b.id JOIN work_order_lines wol ON wol.id=bwl.wo_line_id
WHERE b.doc_no='BOQ/25-26/0005' AND wol.sno=2;  -- ARM-0033 4C x 10

-- BOQ6 / WO6-Line1 (earthing: GI flat + base plates)
INSERT IGNORE INTO boq_lines (boq_id, boq_wo_line_id, sno, item_id, make_id, uom_id, item_qty, boq_qty, est_qty, var_qty)
SELECT b.id, bwl.id, '1a', 778, NULL,
       (SELECT id FROM uoms WHERE code='Mtrs'),
       8.000, 8.000*wol.qty, ROUND(8.000*wol.qty*1.05,3), 0
FROM boqs b JOIN boq_wo_lines bwl ON bwl.boq_id=b.id JOIN work_order_lines wol ON wol.id=bwl.wo_line_id
WHERE b.doc_no='BOQ/25-26/0006' AND wol.sno=1;  -- EAR-0008 GI flat 25x3

INSERT IGNORE INTO boq_lines (boq_id, boq_wo_line_id, sno, item_id, make_id, uom_id, item_qty, boq_qty, est_qty, var_qty)
SELECT b.id, bwl.id, '1b', 771, NULL,
       (SELECT id FROM uoms WHERE code="No's"),
       1.000, wol.qty, ROUND(wol.qty*1.02,3), 0
FROM boqs b JOIN boq_wo_lines bwl ON bwl.boq_id=b.id JOIN work_order_lines wol ON wol.id=bwl.wo_line_id
WHERE b.doc_no='BOQ/25-26/0006' AND wol.sno=1;  -- EAR-0001 MS base plate

-- BOQ6 / WO6-Line2 (4C x 2.5 copper AR cable)
INSERT IGNORE INTO boq_lines (boq_id, boq_wo_line_id, sno, item_id, make_id, uom_id, item_qty, boq_qty, est_qty, var_qty)
SELECT b.id, bwl.id, '2a', 36,
       (SELECT id FROM makes WHERE name='Finolex'),
       (SELECT id FROM uoms WHERE code='Mtrs'),
       1.000, wol.qty, ROUND(wol.qty*1.05,3), 0
FROM boqs b JOIN boq_wo_lines bwl ON bwl.boq_id=b.id JOIN work_order_lines wol ON wol.id=bwl.wo_line_id
WHERE b.doc_no='BOQ/25-26/0006' AND wol.sno=2;  -- ARM-0037 4C x 2.5 copper

-- BOQ7 / WO7-Line1 (RCCBs)
INSERT IGNORE INTO boq_lines (boq_id, boq_wo_line_id, sno, item_id, make_id, uom_id, item_qty, boq_qty, est_qty, var_qty)
SELECT b.id, bwl.id, '1a', 1264,
       (SELECT id FROM makes WHERE name='schneider'),
       (SELECT id FROM uoms WHERE code="No's"),
       1.000, wol.qty, ROUND(wol.qty*1.05,3), 0
FROM boqs b JOIN boq_wo_lines bwl ON bwl.boq_id=b.id JOIN work_order_lines wol ON wol.id=bwl.wo_line_id
WHERE b.doc_no='BOQ/25-26/0007' AND wol.sno=1;  -- RCC-0003 25A DP 30mA

-- BOQ7 / WO7-Line2 (16A SP MCBs)
INSERT IGNORE INTO boq_lines (boq_id, boq_wo_line_id, sno, item_id, make_id, uom_id, item_qty, boq_qty, est_qty, var_qty)
SELECT b.id, bwl.id, '2a', 1179,
       (SELECT id FROM makes WHERE name='schneider'),
       (SELECT id FROM uoms WHERE code="No's"),
       1.000, wol.qty, ROUND(wol.qty*1.02,3), 0
FROM boqs b JOIN boq_wo_lines bwl ON bwl.boq_id=b.id JOIN work_order_lines wol ON wol.id=bwl.wo_line_id
WHERE b.doc_no='BOQ/25-26/0007' AND wol.sno=2;  -- MCB-0017 16A SP C

-- BOQ8 / WO8-Line1 (isolators — DRAFT BOQ)
INSERT IGNORE INTO boq_lines (boq_id, boq_wo_line_id, sno, item_id, make_id, uom_id, item_qty, boq_qty, est_qty, var_qty)
SELECT b.id, bwl.id, '1a', 1122, NULL,
       (SELECT id FROM uoms WHERE code="No's"),
       1.000, wol.qty, ROUND(wol.qty*1.02,3), 0
FROM boqs b JOIN boq_wo_lines bwl ON bwl.boq_id=b.id JOIN work_order_lines wol ON wol.id=bwl.wo_line_id
WHERE b.doc_no='BOQ/25-26/0008' AND wol.sno=1;  -- ISO-0001 100A FP isolator

-- BOQ8 / WO8-Line2 (4C x 16 AL cable)
INSERT IGNORE INTO boq_lines (boq_id, boq_wo_line_id, sno, item_id, make_id, uom_id, item_qty, boq_qty, est_qty, var_qty)
SELECT b.id, bwl.id, '2a', 33,
       (SELECT id FROM makes WHERE name='Finolex'),
       (SELECT id FROM uoms WHERE code='Mtrs'),
       1.000, wol.qty, ROUND(wol.qty*1.05,3), 0
FROM boqs b JOIN boq_wo_lines bwl ON bwl.boq_id=b.id JOIN work_order_lines wol ON wol.id=bwl.wo_line_id
WHERE b.doc_no='BOQ/25-26/0008' AND wol.sno=2;  -- ARM-0034 4C x 16 AL

-- =====================================================================
-- BLOCK 9 — INDENTS (one per site, various statuses for full coverage)
-- =====================================================================

-- IND6: Prestige Hi-Tech (APPROVED) — covers switch/socket + wiring
INSERT INTO indents (doc_no, site_id, branch_id, boq_id, indent_date, needed_by, status, raised_by)
SELECT 'IND/25-26/0006',
       (SELECT id FROM sites WHERE code='ST-0004'), 1,
       (SELECT id FROM boqs WHERE doc_no='BOQ/25-26/0004'),
       '2025-07-02', '2025-07-20', 'APPROVED',
       (SELECT id FROM users WHERE emp_code='E002')
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM indents WHERE doc_no='IND/25-26/0006');

INSERT IGNORE INTO indent_lines (indent_id, boq_line_id, item_id, make_id, qty, over_qty, remark)
SELECT i.id, bl.id, bl.item_id, bl.make_id, 315.000, 0.000, 'Metal boxes — all floors'
FROM indents i, boq_lines bl JOIN boqs b ON b.id=bl.boq_id
WHERE i.doc_no='IND/25-26/0006' AND b.doc_no='BOQ/25-26/0004' AND bl.sno='1a';

INSERT IGNORE INTO indent_lines (indent_id, boq_line_id, item_id, make_id, qty, over_qty, remark)
SELECT i.id, bl.id, bl.item_id, bl.make_id, 315.000, 0.000, 'Switches white'
FROM indents i, boq_lines bl JOIN boqs b ON b.id=bl.boq_id
WHERE i.doc_no='IND/25-26/0006' AND b.doc_no='BOQ/25-26/0004' AND bl.sno='1b';

INSERT IGNORE INTO indent_lines (indent_id, boq_line_id, item_id, make_id, qty, over_qty, remark)
SELECT i.id, bl.id, bl.item_id, bl.make_id, 185.000, 0.000, 'LED 12W downlights'
FROM indents i, boq_lines bl JOIN boqs b ON b.id=bl.boq_id
WHERE i.doc_no='IND/25-26/0006' AND b.doc_no='BOQ/25-26/0004' AND bl.sno='2a';

INSERT IGNORE INTO indent_lines (indent_id, boq_line_id, item_id, make_id, qty, over_qty, remark)
SELECT i.id, bl.id, bl.item_id, bl.make_id, 6300.000, 0.000, '2.5mm wire black'
FROM indents i, boq_lines bl JOIN boqs b ON b.id=bl.boq_id
WHERE i.doc_no='IND/25-26/0006' AND b.doc_no='BOQ/25-26/0004' AND bl.sno='3a';

INSERT IGNORE INTO indent_lines (indent_id, boq_line_id, item_id, make_id, qty, over_qty, remark)
SELECT i.id, bl.id, bl.item_id, bl.make_id, 6300.000, 0.000, '2.5mm wire blue'
FROM indents i, boq_lines bl JOIN boqs b ON b.id=bl.boq_id
WHERE i.doc_no='IND/25-26/0006' AND b.doc_no='BOQ/25-26/0004' AND bl.sno='3b';

INSERT IGNORE INTO indent_events (indent_id, action, user_id, note)
SELECT i.id, 'SUBMITTED', (SELECT id FROM users WHERE emp_code='E002'), NULL
FROM indents i WHERE i.doc_no='IND/25-26/0006'
  AND NOT EXISTS (SELECT 1 FROM indent_events ie WHERE ie.indent_id=i.id AND ie.action='SUBMITTED');
INSERT IGNORE INTO indent_events (indent_id, action, user_id, note)
SELECT i.id, 'APPROVED', (SELECT id FROM users WHERE emp_code='E005'), 'Approved — proceed'
FROM indents i WHERE i.doc_no='IND/25-26/0006'
  AND NOT EXISTS (SELECT 1 FROM indent_events ie WHERE ie.indent_id=i.id AND ie.action='APPROVED');

-- IND7: DLF Cybercity (APPROVED) — cable trays + AR cable
INSERT INTO indents (doc_no, site_id, branch_id, boq_id, indent_date, needed_by, status, raised_by)
SELECT 'IND/25-26/0007',
       (SELECT id FROM sites WHERE code='ST-0005'), 1,
       (SELECT id FROM boqs WHERE doc_no='BOQ/25-26/0005'),
       '2025-07-18', '2025-08-05', 'APPROVED',
       (SELECT id FROM users WHERE emp_code='E004')
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM indents WHERE doc_no='IND/25-26/0007');

INSERT IGNORE INTO indent_lines (indent_id, boq_line_id, item_id, make_id, qty, over_qty, remark)
SELECT i.id, bl.id, bl.item_id, bl.make_id, 840.000, 0.000, 'GI ladder tray full run'
FROM indents i, boq_lines bl JOIN boqs b ON b.id=bl.boq_id
WHERE i.doc_no='IND/25-26/0007' AND b.doc_no='BOQ/25-26/0005' AND bl.sno='1a';

INSERT IGNORE INTO indent_lines (indent_id, boq_line_id, item_id, make_id, qty, over_qty, remark)
SELECT i.id, bl.id, bl.item_id, bl.make_id, 1240.000, 0.000, '4C x 10 AR cable basement to roof'
FROM indents i, boq_lines bl JOIN boqs b ON b.id=bl.boq_id
WHERE i.doc_no='IND/25-26/0007' AND b.doc_no='BOQ/25-26/0005' AND bl.sno='2a';

INSERT IGNORE INTO indent_events (indent_id, action, user_id, note)
SELECT i.id, 'SUBMITTED', (SELECT id FROM users WHERE emp_code='E004'), NULL
FROM indents i WHERE i.doc_no='IND/25-26/0007'
  AND NOT EXISTS (SELECT 1 FROM indent_events ie WHERE ie.indent_id=i.id AND ie.action='SUBMITTED');
INSERT IGNORE INTO indent_events (indent_id, action, user_id, note)
SELECT i.id, 'APPROVED', (SELECT id FROM users WHERE emp_code='E005'), 'Approved'
FROM indents i WHERE i.doc_no='IND/25-26/0007'
  AND NOT EXISTS (SELECT 1 FROM indent_events ie WHERE ie.indent_id=i.id AND ie.action='APPROVED');

-- IND8: Sobha HYD (APPROVED) — earthing + AR cable — AWAITING_PO (no PO yet)
INSERT INTO indents (doc_no, site_id, branch_id, boq_id, indent_date, needed_by, status, raised_by)
SELECT 'IND/25-26/0008',
       (SELECT id FROM sites WHERE code='ST-0006'), 1,
       (SELECT id FROM boqs WHERE doc_no='BOQ/25-26/0006'),
       '2025-09-12', '2025-09-30', 'APPROVED',
       (SELECT id FROM users WHERE emp_code='E002')
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM indents WHERE doc_no='IND/25-26/0008');

INSERT IGNORE INTO indent_lines (indent_id, boq_line_id, item_id, make_id, qty, over_qty, remark)
SELECT i.id, bl.id, bl.item_id, bl.make_id, 350.000, 0.000, 'GI flat 25x3 earthing'
FROM indents i, boq_lines bl JOIN boqs b ON b.id=bl.boq_id
WHERE i.doc_no='IND/25-26/0008' AND b.doc_no='BOQ/25-26/0006' AND bl.sno='1a';

INSERT IGNORE INTO indent_lines (indent_id, boq_line_id, item_id, make_id, qty, over_qty, remark)
SELECT i.id, bl.id, bl.item_id, bl.make_id, 42.000, 0.000, 'MS base plates'
FROM indents i, boq_lines bl JOIN boqs b ON b.id=bl.boq_id
WHERE i.doc_no='IND/25-26/0008' AND b.doc_no='BOQ/25-26/0006' AND bl.sno='1b';

INSERT IGNORE INTO indent_lines (indent_id, boq_line_id, item_id, make_id, qty, over_qty, remark)
SELECT i.id, bl.id, bl.item_id, bl.make_id, 945.000, 0.000, '4C x 2.5 copper AR cable'
FROM indents i, boq_lines bl JOIN boqs b ON b.id=bl.boq_id
WHERE i.doc_no='IND/25-26/0008' AND b.doc_no='BOQ/25-26/0006' AND bl.sno='2a';

INSERT IGNORE INTO indent_events (indent_id, action, user_id, note)
SELECT i.id, 'SUBMITTED', (SELECT id FROM users WHERE emp_code='E002'), 'Urgent — earthing before monsoon ends'
FROM indents i WHERE i.doc_no='IND/25-26/0008'
  AND NOT EXISTS (SELECT 1 FROM indent_events ie WHERE ie.indent_id=i.id AND ie.action='SUBMITTED');
INSERT IGNORE INTO indent_events (indent_id, action, user_id, note)
SELECT i.id, 'APPROVED', (SELECT id FROM users WHERE emp_code='E005'), 'Approved'
FROM indents i WHERE i.doc_no='IND/25-26/0008'
  AND NOT EXISTS (SELECT 1 FROM indent_events ie WHERE ie.indent_id=i.id AND ie.action='APPROVED');

-- IND9: Embassy Manyata BLR (APPROVED) — RCCBs + 16A MCBs
INSERT INTO indents (doc_no, site_id, branch_id, boq_id, indent_date, needed_by, status, raised_by)
SELECT 'IND/25-26/0009',
       (SELECT id FROM sites WHERE code='ST-0007'), 2,
       (SELECT id FROM boqs WHERE doc_no='BOQ/25-26/0007'),
       '2025-07-15', '2025-08-01', 'APPROVED',
       (SELECT id FROM users WHERE emp_code='E004')
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM indents WHERE doc_no='IND/25-26/0009');

INSERT IGNORE INTO indent_lines (indent_id, boq_line_id, item_id, make_id, qty, over_qty, remark)
SELECT i.id, bl.id, bl.item_id, bl.make_id, 168.000, 0.000, 'RCCBs for tenant DB boards'
FROM indents i, boq_lines bl JOIN boqs b ON b.id=bl.boq_id
WHERE i.doc_no='IND/25-26/0009' AND b.doc_no='BOQ/25-26/0007' AND bl.sno='1a';

INSERT IGNORE INTO indent_lines (indent_id, boq_line_id, item_id, make_id, qty, over_qty, remark)
SELECT i.id, bl.id, bl.item_id, bl.make_id, 490.000, 0.000, '16A SP MCBs circuit protection'
FROM indents i, boq_lines bl JOIN boqs b ON b.id=bl.boq_id
WHERE i.doc_no='IND/25-26/0009' AND b.doc_no='BOQ/25-26/0007' AND bl.sno='2a';

INSERT IGNORE INTO indent_events (indent_id, action, user_id, note)
SELECT i.id, 'SUBMITTED', (SELECT id FROM users WHERE emp_code='E004'), NULL
FROM indents i WHERE i.doc_no='IND/25-26/0009'
  AND NOT EXISTS (SELECT 1 FROM indent_events ie WHERE ie.indent_id=i.id AND ie.action='SUBMITTED');
INSERT IGNORE INTO indent_events (indent_id, action, user_id, note)
SELECT i.id, 'APPROVED', (SELECT id FROM users WHERE emp_code='E005'), 'Approved — BLR urgent'
FROM indents i WHERE i.doc_no='IND/25-26/0009'
  AND NOT EXISTS (SELECT 1 FROM indent_events ie WHERE ie.indent_id=i.id AND ie.action='APPROVED');

-- IND10: DLF Downtown BLR (SUBMITTED — awaiting GM approval)
INSERT INTO indents (doc_no, site_id, branch_id, boq_id, indent_date, needed_by, status, raised_by)
SELECT 'IND/25-26/0010',
       (SELECT id FROM sites WHERE code='ST-0008'), 2,
       (SELECT id FROM boqs WHERE doc_no='BOQ/25-26/0008'),
       '2025-10-15', '2025-11-01', 'SUBMITTED',
       (SELECT id FROM users WHERE emp_code='E004')
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM indents WHERE doc_no='IND/25-26/0010');

INSERT IGNORE INTO indent_lines (indent_id, boq_line_id, item_id, make_id, qty, over_qty, remark)
SELECT i.id, bl.id, bl.item_id, bl.make_id, 25.000, 0.000, 'Isolators for main incomer panels'
FROM indents i, boq_lines bl JOIN boqs b ON b.id=bl.boq_id
WHERE i.doc_no='IND/25-26/0010' AND b.doc_no='BOQ/25-26/0008' AND bl.sno='1a';

INSERT IGNORE INTO indent_lines (indent_id, boq_line_id, item_id, make_id, qty, over_qty, remark)
SELECT i.id, bl.id, bl.item_id, bl.make_id, 1575.000, 0.000, '4C x 16 AL cable riser shafts'
FROM indents i, boq_lines bl JOIN boqs b ON b.id=bl.boq_id
WHERE i.doc_no='IND/25-26/0010' AND b.doc_no='BOQ/25-26/0008' AND bl.sno='2a';

INSERT IGNORE INTO indent_events (indent_id, action, user_id, note)
SELECT i.id, 'SUBMITTED', (SELECT id FROM users WHERE emp_code='E004'), 'Please approve — project kick-off on 1 Nov'
FROM indents i WHERE i.doc_no='IND/25-26/0010'
  AND NOT EXISTS (SELECT 1 FROM indent_events ie WHERE ie.indent_id=i.id AND ie.action='SUBMITTED');

-- =====================================================================
-- BLOCK 10 — COMPARISONS
-- =====================================================================

-- CMP3: Prestige switch/socket + wiring (DECIDED)
INSERT INTO comparisons (doc_no, branch_id, title, status, chosen_supplier_id, decided_note, decided_at, created_by)
SELECT 'CMP/25-26/0003', 1,
       'Switch-socket + 2.5mm wire — IND/25-26/0006 (Prestige)',
       'DECIDED',
       (SELECT id FROM suppliers WHERE code='SUP-0001'),
       'Universal Electricals best overall landed cost.', '2025-07-05 14:00:00',
       (SELECT id FROM users WHERE emp_code='E001')
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM comparisons WHERE doc_no='CMP/25-26/0003');

INSERT IGNORE INTO comparison_indents (comparison_id, indent_id)
SELECT c.id, i.id FROM comparisons c, indents i
WHERE c.doc_no='CMP/25-26/0003' AND i.doc_no='IND/25-26/0006';

INSERT IGNORE INTO comparison_items (comparison_id, item_id, make_id, qty)
SELECT c.id, 1487, NULL, 315.000 FROM comparisons c WHERE c.doc_no='CMP/25-26/0003';
INSERT IGNORE INTO comparison_items (comparison_id, item_id, make_id, qty)
SELECT c.id, 1490, NULL, 315.000 FROM comparisons c WHERE c.doc_no='CMP/25-26/0003';
INSERT IGNORE INTO comparison_items (comparison_id, item_id, make_id, qty)
SELECT c.id, 2578, (SELECT id FROM makes WHERE name='POLY CAB'), 6300.000 FROM comparisons c WHERE c.doc_no='CMP/25-26/0003';

INSERT IGNORE INTO comparison_suppliers (comparison_id, supplier_id, discount_pct, freight, credit_days)
SELECT c.id, (SELECT id FROM suppliers WHERE code='SUP-0001'), 2.00, 600.00, 30
FROM comparisons c WHERE c.doc_no='CMP/25-26/0003';
INSERT IGNORE INTO comparison_suppliers (comparison_id, supplier_id, discount_pct, freight, credit_days)
SELECT c.id, (SELECT id FROM suppliers WHERE code='SUP-0004'), 1.50, 800.00, 30
FROM comparisons c WHERE c.doc_no='CMP/25-26/0003';

-- Quotes SUP-0001
INSERT IGNORE INTO comparison_quotes (comparison_item_id, comparison_supplier_id, rate)
SELECT ci.id, cs.id, 185.00 FROM comparison_items ci
JOIN comparisons c ON c.id=ci.comparison_id
JOIN comparison_suppliers cs ON cs.comparison_id=c.id
JOIN suppliers s ON s.id=cs.supplier_id
WHERE c.doc_no='CMP/25-26/0003' AND ci.item_id=1487 AND s.code='SUP-0001';

INSERT IGNORE INTO comparison_quotes (comparison_item_id, comparison_supplier_id, rate)
SELECT ci.id, cs.id, 95.00 FROM comparison_items ci
JOIN comparisons c ON c.id=ci.comparison_id
JOIN comparison_suppliers cs ON cs.comparison_id=c.id
JOIN suppliers s ON s.id=cs.supplier_id
WHERE c.doc_no='CMP/25-26/0003' AND ci.item_id=1490 AND s.code='SUP-0001';

INSERT IGNORE INTO comparison_quotes (comparison_item_id, comparison_supplier_id, rate)
SELECT ci.id, cs.id, 92.00 FROM comparison_items ci
JOIN comparisons c ON c.id=ci.comparison_id
JOIN comparison_suppliers cs ON cs.comparison_id=c.id
JOIN suppliers s ON s.id=cs.supplier_id
WHERE c.doc_no='CMP/25-26/0003' AND ci.item_id=2578 AND s.code='SUP-0001';

-- Quotes SUP-0004
INSERT IGNORE INTO comparison_quotes (comparison_item_id, comparison_supplier_id, rate)
SELECT ci.id, cs.id, 190.00 FROM comparison_items ci
JOIN comparisons c ON c.id=ci.comparison_id
JOIN comparison_suppliers cs ON cs.comparison_id=c.id
JOIN suppliers s ON s.id=cs.supplier_id
WHERE c.doc_no='CMP/25-26/0003' AND ci.item_id=1487 AND s.code='SUP-0004';

INSERT IGNORE INTO comparison_quotes (comparison_item_id, comparison_supplier_id, rate)
SELECT ci.id, cs.id, 98.00 FROM comparison_items ci
JOIN comparisons c ON c.id=ci.comparison_id
JOIN comparison_suppliers cs ON cs.comparison_id=c.id
JOIN suppliers s ON s.id=cs.supplier_id
WHERE c.doc_no='CMP/25-26/0003' AND ci.item_id=1490 AND s.code='SUP-0004';

INSERT IGNORE INTO comparison_quotes (comparison_item_id, comparison_supplier_id, rate)
SELECT ci.id, cs.id, 89.50 FROM comparison_items ci
JOIN comparisons c ON c.id=ci.comparison_id
JOIN comparison_suppliers cs ON cs.comparison_id=c.id
JOIN suppliers s ON s.id=cs.supplier_id
WHERE c.doc_no='CMP/25-26/0003' AND ci.item_id=2578 AND s.code='SUP-0004';

-- CMP4: DLF Cybercity — cable trays + AR cable (DECIDED)
INSERT INTO comparisons (doc_no, branch_id, title, status, chosen_supplier_id, decided_note, decided_at, created_by)
SELECT 'CMP/25-26/0004', 1,
       'Cable trays + 4C x 10 AR cable — IND/25-26/0007 (DLF)',
       'DECIDED',
       (SELECT id FROM suppliers WHERE code='SUP-0004'),
       'Hyderabad Cable Traders L1 on AR cable, matched on trays.', '2025-07-22 16:00:00',
       (SELECT id FROM users WHERE emp_code='E001')
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM comparisons WHERE doc_no='CMP/25-26/0004');

INSERT IGNORE INTO comparison_indents (comparison_id, indent_id)
SELECT c.id, i.id FROM comparisons c, indents i
WHERE c.doc_no='CMP/25-26/0004' AND i.doc_no='IND/25-26/0007';

INSERT IGNORE INTO comparison_items (comparison_id, item_id, make_id, qty)
SELECT c.id, 131, NULL, 840.000 FROM comparisons c WHERE c.doc_no='CMP/25-26/0004';
INSERT IGNORE INTO comparison_items (comparison_id, item_id, make_id, qty)
SELECT c.id, 32, (SELECT id FROM makes WHERE name='KEI'), 1240.000 FROM comparisons c WHERE c.doc_no='CMP/25-26/0004';

INSERT IGNORE INTO comparison_suppliers (comparison_id, supplier_id, discount_pct, freight, credit_days)
SELECT c.id, (SELECT id FROM suppliers WHERE code='SUP-0004'), 1.00, 1000.00, 30
FROM comparisons c WHERE c.doc_no='CMP/25-26/0004';

INSERT IGNORE INTO comparison_quotes (comparison_item_id, comparison_supplier_id, rate)
SELECT ci.id, cs.id, 340.00 FROM comparison_items ci
JOIN comparisons c ON c.id=ci.comparison_id
JOIN comparison_suppliers cs ON cs.comparison_id=c.id
WHERE c.doc_no='CMP/25-26/0004' AND ci.item_id=131;

INSERT IGNORE INTO comparison_quotes (comparison_item_id, comparison_supplier_id, rate)
SELECT ci.id, cs.id, 685.00 FROM comparison_items ci
JOIN comparisons c ON c.id=ci.comparison_id
JOIN comparison_suppliers cs ON cs.comparison_id=c.id
WHERE c.doc_no='CMP/25-26/0004' AND ci.item_id=32;

-- CMP5: Embassy BLR — RCCBs + 16A MCBs (DECIDED)
INSERT INTO comparisons (doc_no, branch_id, title, status, chosen_supplier_id, decided_note, decided_at, created_by)
SELECT 'CMP/25-26/0005', 2,
       'RCCBs + 16A MCBs — IND/25-26/0009 (Embassy Manyata)',
       'DECIDED',
       (SELECT id FROM suppliers WHERE code='SUP-0005'),
       'South India Electricals best price on switchgear.', '2025-07-20 11:00:00',
       (SELECT id FROM users WHERE emp_code='E001')
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM comparisons WHERE doc_no='CMP/25-26/0005');

INSERT IGNORE INTO comparison_indents (comparison_id, indent_id)
SELECT c.id, i.id FROM comparisons c, indents i
WHERE c.doc_no='CMP/25-26/0005' AND i.doc_no='IND/25-26/0009';

INSERT IGNORE INTO comparison_items (comparison_id, item_id, make_id, qty)
SELECT c.id, 1264, (SELECT id FROM makes WHERE name='schneider'), 168.000 FROM comparisons c WHERE c.doc_no='CMP/25-26/0005';
INSERT IGNORE INTO comparison_items (comparison_id, item_id, make_id, qty)
SELECT c.id, 1179, (SELECT id FROM makes WHERE name='schneider'), 490.000 FROM comparisons c WHERE c.doc_no='CMP/25-26/0005';

INSERT IGNORE INTO comparison_suppliers (comparison_id, supplier_id, discount_pct, freight, credit_days)
SELECT c.id, (SELECT id FROM suppliers WHERE code='SUP-0005'), 3.00, 1200.00, 45
FROM comparisons c WHERE c.doc_no='CMP/25-26/0005';

INSERT IGNORE INTO comparison_quotes (comparison_item_id, comparison_supplier_id, rate)
SELECT ci.id, cs.id, 1680.00 FROM comparison_items ci
JOIN comparisons c ON c.id=ci.comparison_id
JOIN comparison_suppliers cs ON cs.comparison_id=c.id
WHERE c.doc_no='CMP/25-26/0005' AND ci.item_id=1264;

INSERT IGNORE INTO comparison_quotes (comparison_item_id, comparison_supplier_id, rate)
SELECT ci.id, cs.id, 285.00 FROM comparison_items ci
JOIN comparisons c ON c.id=ci.comparison_id
JOIN comparison_suppliers cs ON cs.comparison_id=c.id
WHERE c.doc_no='CMP/25-26/0005' AND ci.item_id=1179;

-- CMP6: Sobha earthing (DRAFT — still getting quotes)
INSERT INTO comparisons (doc_no, branch_id, title, status, created_by)
SELECT 'CMP/25-26/0006', 1,
       'Earthing materials + 4C x 2.5 AR cable — IND/25-26/0008 (Sobha)',
       'DRAFT',
       (SELECT id FROM users WHERE emp_code='E001')
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM comparisons WHERE doc_no='CMP/25-26/0006');

INSERT IGNORE INTO comparison_indents (comparison_id, indent_id)
SELECT c.id, i.id FROM comparisons c, indents i
WHERE c.doc_no='CMP/25-26/0006' AND i.doc_no='IND/25-26/0008';

-- =====================================================================
-- BLOCK 11 — PURCHASE ORDERS (4 new, diverse statuses)
-- =====================================================================

-- PO4: Prestige switch/socket + wiring (APPROVED) — fully received
INSERT INTO purchase_orders (doc_no, branch_id, supplier_id, comparison_id,
                              deliver_to_id, po_date, expected_date, status,
                              submitted_at, decided_at, decided_by, notes, created_by)
SELECT 'PO/25-26/0004', 1,
       (SELECT id FROM suppliers WHERE code='SUP-0001'),
       (SELECT id FROM comparisons WHERE doc_no='CMP/25-26/0003'),
       (SELECT id FROM sites WHERE code='GD-0001'),
       '2025-07-08', '2025-07-22', 'APPROVED',
       '2025-07-08 10:00:00', '2025-07-09 09:00:00',
       (SELECT id FROM users WHERE emp_code='E005'),
       'Prestige Hi-Tech — switchgear + wiring',
       (SELECT id FROM users WHERE emp_code='E001')
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM purchase_orders WHERE doc_no='PO/25-26/0004');

INSERT IGNORE INTO purchase_order_indents (po_id, indent_id)
SELECT po.id, i.id FROM purchase_orders po, indents i
WHERE po.doc_no='PO/25-26/0004' AND i.doc_no='IND/25-26/0006';

INSERT IGNORE INTO purchase_order_lines (po_id, item_id, make_id, uom_id, qty, rate, gst_rate, remark)
SELECT po.id, 1487, NULL, (SELECT id FROM uoms WHERE code="No's"), 315.000, 185.00, 18.00, '1-2M metal box'
FROM purchase_orders po WHERE po.doc_no='PO/25-26/0004';
INSERT IGNORE INTO purchase_order_lines (po_id, item_id, make_id, uom_id, qty, rate, gst_rate, remark)
SELECT po.id, 1490, NULL, (SELECT id FROM uoms WHERE code="No's"), 315.000, 95.00, 18.00, '10A switch white'
FROM purchase_orders po WHERE po.doc_no='PO/25-26/0004';
INSERT IGNORE INTO purchase_order_lines (po_id, item_id, make_id, uom_id, qty, rate, gst_rate, remark)
SELECT po.id, 2578, (SELECT id FROM makes WHERE name='POLY CAB'), (SELECT id FROM uoms WHERE code='Mtrs'), 6300.000, 92.00, 18.00, '2.5mm wire black POLY CAB'
FROM purchase_orders po WHERE po.doc_no='PO/25-26/0004';

INSERT IGNORE INTO po_line_indents (po_line_id, indent_id, qty)
SELECT pol.id, i.id, 315.000 FROM purchase_order_lines pol
JOIN purchase_orders po ON po.id=pol.po_id JOIN indents i ON i.doc_no='IND/25-26/0006'
WHERE po.doc_no='PO/25-26/0004' AND pol.item_id=1487;
INSERT IGNORE INTO po_line_indents (po_line_id, indent_id, qty)
SELECT pol.id, i.id, 315.000 FROM purchase_order_lines pol
JOIN purchase_orders po ON po.id=pol.po_id JOIN indents i ON i.doc_no='IND/25-26/0006'
WHERE po.doc_no='PO/25-26/0004' AND pol.item_id=1490;
INSERT IGNORE INTO po_line_indents (po_line_id, indent_id, qty)
SELECT pol.id, i.id, 6300.000 FROM purchase_order_lines pol
JOIN purchase_orders po ON po.id=pol.po_id JOIN indents i ON i.doc_no='IND/25-26/0006'
WHERE po.doc_no='PO/25-26/0004' AND pol.item_id=2578;

INSERT IGNORE INTO po_events (po_id, action, user_id, note)
SELECT po.id, 'SUBMITTED', (SELECT id FROM users WHERE emp_code='E001'), NULL
FROM purchase_orders po WHERE po.doc_no='PO/25-26/0004';
INSERT IGNORE INTO po_events (po_id, action, user_id, note)
SELECT po.id, 'APPROVED', (SELECT id FROM users WHERE emp_code='E005'), 'Approved'
FROM purchase_orders po WHERE po.doc_no='PO/25-26/0004';

-- PO5: DLF cable trays + AR cable (APPROVED) — DC in transit
INSERT INTO purchase_orders (doc_no, branch_id, supplier_id, comparison_id,
                              deliver_to_id, po_date, expected_date, status,
                              submitted_at, decided_at, decided_by, notes, created_by)
SELECT 'PO/25-26/0005', 1,
       (SELECT id FROM suppliers WHERE code='SUP-0004'),
       (SELECT id FROM comparisons WHERE doc_no='CMP/25-26/0004'),
       (SELECT id FROM sites WHERE code='GD-0001'),
       '2025-07-25', '2025-08-08', 'APPROVED',
       '2025-07-25 11:00:00', '2025-07-26 14:00:00',
       (SELECT id FROM users WHERE emp_code='E005'),
       'DLF Cybercity — cable trays + AR cable',
       (SELECT id FROM users WHERE emp_code='E001')
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM purchase_orders WHERE doc_no='PO/25-26/0005');

INSERT IGNORE INTO purchase_order_indents (po_id, indent_id)
SELECT po.id, i.id FROM purchase_orders po, indents i
WHERE po.doc_no='PO/25-26/0005' AND i.doc_no='IND/25-26/0007';

INSERT IGNORE INTO purchase_order_lines (po_id, item_id, make_id, uom_id, qty, rate, gst_rate, remark)
SELECT po.id, 131, NULL, (SELECT id FROM uoms WHERE code='Mtrs'), 840.000, 340.00, 18.00, 'GI ladder tray 100x50'
FROM purchase_orders po WHERE po.doc_no='PO/25-26/0005';
INSERT IGNORE INTO purchase_order_lines (po_id, item_id, make_id, uom_id, qty, rate, gst_rate, remark)
SELECT po.id, 32, (SELECT id FROM makes WHERE name='KEI'), (SELECT id FROM uoms WHERE code='Mtrs'), 1240.000, 685.00, 18.00, '4C x 10 copper AR KEI'
FROM purchase_orders po WHERE po.doc_no='PO/25-26/0005';

INSERT IGNORE INTO po_line_indents (po_line_id, indent_id, qty)
SELECT pol.id, i.id, 840.000 FROM purchase_order_lines pol
JOIN purchase_orders po ON po.id=pol.po_id JOIN indents i ON i.doc_no='IND/25-26/0007'
WHERE po.doc_no='PO/25-26/0005' AND pol.item_id=131;
INSERT IGNORE INTO po_line_indents (po_line_id, indent_id, qty)
SELECT pol.id, i.id, 1240.000 FROM purchase_order_lines pol
JOIN purchase_orders po ON po.id=pol.po_id JOIN indents i ON i.doc_no='IND/25-26/0007'
WHERE po.doc_no='PO/25-26/0005' AND pol.item_id=32;

INSERT IGNORE INTO po_events (po_id, action, user_id, note)
SELECT po.id, 'SUBMITTED', (SELECT id FROM users WHERE emp_code='E001'), NULL
FROM purchase_orders po WHERE po.doc_no='PO/25-26/0005';
INSERT IGNORE INTO po_events (po_id, action, user_id, note)
SELECT po.id, 'APPROVED', (SELECT id FROM users WHERE emp_code='E005'), 'Approved — DLF priority'
FROM purchase_orders po WHERE po.doc_no='PO/25-26/0005';

-- PO6: Embassy BLR RCCBs + MCBs (APPROVED) — PO pending GRN
INSERT INTO purchase_orders (doc_no, branch_id, supplier_id, comparison_id,
                              deliver_to_id, po_date, expected_date, status,
                              submitted_at, decided_at, decided_by, notes, created_by)
SELECT 'PO/25-26/0006', 2,
       (SELECT id FROM suppliers WHERE code='SUP-0005'),
       (SELECT id FROM comparisons WHERE doc_no='CMP/25-26/0005'),
       (SELECT id FROM sites WHERE code='GD-0002'),
       '2025-07-24', '2025-08-05', 'APPROVED',
       '2025-07-24 09:00:00', '2025-07-25 10:30:00',
       (SELECT id FROM users WHERE emp_code='E005'),
       'Embassy Manyata — switchgear for tenant DBs',
       (SELECT id FROM users WHERE emp_code='E001')
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM purchase_orders WHERE doc_no='PO/25-26/0006');

INSERT IGNORE INTO purchase_order_indents (po_id, indent_id)
SELECT po.id, i.id FROM purchase_orders po, indents i
WHERE po.doc_no='PO/25-26/0006' AND i.doc_no='IND/25-26/0009';

INSERT IGNORE INTO purchase_order_lines (po_id, item_id, make_id, uom_id, qty, rate, gst_rate, remark)
SELECT po.id, 1264, (SELECT id FROM makes WHERE name='schneider'), (SELECT id FROM uoms WHERE code="No's"),
       168.000, 1680.00, 18.00, 'RCCB 25A DP 30mA Schneider'
FROM purchase_orders po WHERE po.doc_no='PO/25-26/0006';
INSERT IGNORE INTO purchase_order_lines (po_id, item_id, make_id, uom_id, qty, rate, gst_rate, remark)
SELECT po.id, 1179, (SELECT id FROM makes WHERE name='schneider'), (SELECT id FROM uoms WHERE code="No's"),
       490.000, 285.00, 18.00, '16A SP C MCB Schneider'
FROM purchase_orders po WHERE po.doc_no='PO/25-26/0006';

INSERT IGNORE INTO po_line_indents (po_line_id, indent_id, qty)
SELECT pol.id, i.id, 168.000 FROM purchase_order_lines pol
JOIN purchase_orders po ON po.id=pol.po_id JOIN indents i ON i.doc_no='IND/25-26/0009'
WHERE po.doc_no='PO/25-26/0006' AND pol.item_id=1264;
INSERT IGNORE INTO po_line_indents (po_line_id, indent_id, qty)
SELECT pol.id, i.id, 490.000 FROM purchase_order_lines pol
JOIN purchase_orders po ON po.id=pol.po_id JOIN indents i ON i.doc_no='IND/25-26/0009'
WHERE po.doc_no='PO/25-26/0006' AND pol.item_id=1179;

INSERT IGNORE INTO po_events (po_id, action, user_id, note)
SELECT po.id, 'SUBMITTED', (SELECT id FROM users WHERE emp_code='E001'), NULL
FROM purchase_orders po WHERE po.doc_no='PO/25-26/0006';
INSERT IGNORE INTO po_events (po_id, action, user_id, note)
SELECT po.id, 'APPROVED', (SELECT id FROM users WHERE emp_code='E005'), 'Approved'
FROM purchase_orders po WHERE po.doc_no='PO/25-26/0006';

-- PO7: Sobha HYD earthing — DRAFT (buyer building it)
INSERT INTO purchase_orders (doc_no, branch_id, supplier_id,
                              deliver_to_id, po_date, status, notes, created_by)
SELECT 'PO/25-26/0007', 1,
       (SELECT id FROM suppliers WHERE code='SUP-0001'),
       (SELECT id FROM sites WHERE code='GD-0001'),
       '2025-09-20', 'DRAFT',
       'Sobha earthing + AR cable — draft in progress',
       (SELECT id FROM users WHERE emp_code='E001')
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM purchase_orders WHERE doc_no='PO/25-26/0007');

-- PO8: Prestige LED downlights (SUBMITTED — awaiting GM signature)
INSERT INTO purchase_orders (doc_no, branch_id, supplier_id,
                              deliver_to_id, po_date, expected_date, status,
                              submitted_at, notes, created_by)
SELECT 'PO/25-26/0008', 1,
       (SELECT id FROM suppliers WHERE code='SUP-0001'),
       (SELECT id FROM sites WHERE code='GD-0001'),
       '2025-07-12', '2025-07-28', 'SUBMITTED',
       '2025-07-12 15:00:00',
       'LED downlights for Prestige Hi-Tech — pending GM',
       (SELECT id FROM users WHERE emp_code='E001')
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM purchase_orders WHERE doc_no='PO/25-26/0008');

INSERT IGNORE INTO purchase_order_indents (po_id, indent_id)
SELECT po.id, i.id FROM purchase_orders po, indents i
WHERE po.doc_no='PO/25-26/0008' AND i.doc_no='IND/25-26/0006';

INSERT IGNORE INTO purchase_order_lines (po_id, item_id, make_id, uom_id, qty, rate, gst_rate)
SELECT po.id, 1150, NULL, (SELECT id FROM uoms WHERE code="No's"), 185.000, 820.00, 18.00
FROM purchase_orders po WHERE po.doc_no='PO/25-26/0008';

INSERT IGNORE INTO po_events (po_id, action, user_id, note)
SELECT po.id, 'SUBMITTED', (SELECT id FROM users WHERE emp_code='E001'), 'Please sign — lead time 7 days'
FROM purchase_orders po WHERE po.doc_no='PO/25-26/0008';

-- =====================================================================
-- BLOCK 12 — GRNs + STOCK MOVEMENTS (receipts at stores)
-- =====================================================================

-- GRN3: Prestige switchgear + wiring received at HYD Store (CONFIRMED)
INSERT INTO goods_receipts (doc_no, po_id, received_at, receipt_date, supplier_dc, status, note, received_by)
SELECT 'GRN/25-26/0003',
       (SELECT id FROM purchase_orders WHERE doc_no='PO/25-26/0004'),
       (SELECT id FROM sites WHERE code='GD-0001'),
       '2025-07-20', 'UNIV/DC/2025/0247', 'CONFIRMED', 'Full quantity received', 3
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM goods_receipts WHERE doc_no='GRN/25-26/0003');

INSERT IGNORE INTO goods_receipt_lines (grn_id, po_line_id, qty)
SELECT g.id, pol.id, 315.000 FROM goods_receipts g
JOIN purchase_orders po ON po.id=g.po_id
JOIN purchase_order_lines pol ON pol.po_id=po.id
WHERE g.doc_no='GRN/25-26/0003' AND pol.item_id=1487;
INSERT IGNORE INTO goods_receipt_lines (grn_id, po_line_id, qty)
SELECT g.id, pol.id, 315.000 FROM goods_receipts g
JOIN purchase_orders po ON po.id=g.po_id
JOIN purchase_order_lines pol ON pol.po_id=po.id
WHERE g.doc_no='GRN/25-26/0003' AND pol.item_id=1490;
INSERT IGNORE INTO goods_receipt_lines (grn_id, po_line_id, qty)
SELECT g.id, pol.id, 6300.000 FROM goods_receipts g
JOIN purchase_orders po ON po.id=g.po_id
JOIN purchase_order_lines pol ON pol.po_id=po.id
WHERE g.doc_no='GRN/25-26/0003' AND pol.item_id=2578;

INSERT IGNORE INTO stock_movements (site_id, item_id, make_id, qty, rate, kind, ref_type, ref_id, ref_no, moved_on, created_by)
SELECT (SELECT id FROM sites WHERE code='GD-0001'), pol.item_id, pol.make_id, 315.000, 185.00,
       'GRN', 'GRN', g.id, 'GRN/25-26/0003', '2025-07-20', 3
FROM goods_receipts g JOIN purchase_orders po ON po.id=g.po_id
JOIN purchase_order_lines pol ON pol.po_id=po.id
WHERE g.doc_no='GRN/25-26/0003' AND pol.item_id=1487
  AND NOT EXISTS (SELECT 1 FROM stock_movements WHERE ref_no='GRN/25-26/0003' AND item_id=1487 AND qty>0);

INSERT IGNORE INTO stock_movements (site_id, item_id, make_id, qty, rate, kind, ref_type, ref_id, ref_no, moved_on, created_by)
SELECT (SELECT id FROM sites WHERE code='GD-0001'), pol.item_id, pol.make_id, 315.000, 95.00,
       'GRN', 'GRN', g.id, 'GRN/25-26/0003', '2025-07-20', 3
FROM goods_receipts g JOIN purchase_orders po ON po.id=g.po_id
JOIN purchase_order_lines pol ON pol.po_id=po.id
WHERE g.doc_no='GRN/25-26/0003' AND pol.item_id=1490
  AND NOT EXISTS (SELECT 1 FROM stock_movements WHERE ref_no='GRN/25-26/0003' AND item_id=1490 AND qty>0);

INSERT IGNORE INTO stock_movements (site_id, item_id, make_id, qty, rate, kind, ref_type, ref_id, ref_no, moved_on, created_by)
SELECT (SELECT id FROM sites WHERE code='GD-0001'), pol.item_id, pol.make_id, 6300.000, 92.00,
       'GRN', 'GRN', g.id, 'GRN/25-26/0003', '2025-07-20', 3
FROM goods_receipts g JOIN purchase_orders po ON po.id=g.po_id
JOIN purchase_order_lines pol ON pol.po_id=po.id
WHERE g.doc_no='GRN/25-26/0003' AND pol.item_id=2578
  AND NOT EXISTS (SELECT 1 FROM stock_movements WHERE ref_no='GRN/25-26/0003' AND item_id=2578 AND qty>0);

-- GRN4: DLF cable trays received at HYD Store (CONFIRMED — partial: only trays, cable pending)
INSERT INTO goods_receipts (doc_no, po_id, received_at, receipt_date, supplier_dc, status, note, received_by)
SELECT 'GRN/25-26/0004',
       (SELECT id FROM purchase_orders WHERE doc_no='PO/25-26/0005'),
       (SELECT id FROM sites WHERE code='GD-0001'),
       '2025-08-06', 'HCT/DC/2025/0082', 'CONFIRMED', 'Cable trays received; AR cable delivery pending', 3
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM goods_receipts WHERE doc_no='GRN/25-26/0004');

INSERT IGNORE INTO goods_receipt_lines (grn_id, po_line_id, qty)
SELECT g.id, pol.id, 840.000 FROM goods_receipts g
JOIN purchase_orders po ON po.id=g.po_id
JOIN purchase_order_lines pol ON pol.po_id=po.id
WHERE g.doc_no='GRN/25-26/0004' AND pol.item_id=131;

INSERT IGNORE INTO stock_movements (site_id, item_id, make_id, qty, rate, kind, ref_type, ref_id, ref_no, moved_on, created_by)
SELECT (SELECT id FROM sites WHERE code='GD-0001'), pol.item_id, pol.make_id, 840.000, 340.00,
       'GRN', 'GRN', g.id, 'GRN/25-26/0004', '2025-08-06', 3
FROM goods_receipts g JOIN purchase_orders po ON po.id=g.po_id
JOIN purchase_order_lines pol ON pol.po_id=po.id
WHERE g.doc_no='GRN/25-26/0004' AND pol.item_id=131
  AND NOT EXISTS (SELECT 1 FROM stock_movements WHERE ref_no='GRN/25-26/0004' AND item_id=131 AND qty>0);

-- GRN5: Embassy BLR partial RCCB receipt at BLR Store (CONFIRMED — 100 of 168 RCCBs)
INSERT INTO goods_receipts (doc_no, po_id, received_at, receipt_date, supplier_dc, status, note, received_by)
SELECT 'GRN/25-26/0005',
       (SELECT id FROM purchase_orders WHERE doc_no='PO/25-26/0006'),
       (SELECT id FROM sites WHERE code='GD-0002'),
       '2025-08-04', 'SIE/DC/2025/0154', 'CONFIRMED', '100 RCCBs received; balance 68 to follow; 490 MCBs received', 3
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM goods_receipts WHERE doc_no='GRN/25-26/0005');

INSERT IGNORE INTO goods_receipt_lines (grn_id, po_line_id, qty)
SELECT g.id, pol.id, 100.000 FROM goods_receipts g
JOIN purchase_orders po ON po.id=g.po_id
JOIN purchase_order_lines pol ON pol.po_id=po.id
WHERE g.doc_no='GRN/25-26/0005' AND pol.item_id=1264;

INSERT IGNORE INTO goods_receipt_lines (grn_id, po_line_id, qty)
SELECT g.id, pol.id, 490.000 FROM goods_receipts g
JOIN purchase_orders po ON po.id=g.po_id
JOIN purchase_order_lines pol ON pol.po_id=po.id
WHERE g.doc_no='GRN/25-26/0005' AND pol.item_id=1179;

INSERT IGNORE INTO stock_movements (site_id, item_id, make_id, qty, rate, kind, ref_type, ref_id, ref_no, moved_on, created_by)
SELECT (SELECT id FROM sites WHERE code='GD-0002'), pol.item_id, pol.make_id, 100.000, 1680.00,
       'GRN', 'GRN', g.id, 'GRN/25-26/0005', '2025-08-04', 3
FROM goods_receipts g JOIN purchase_orders po ON po.id=g.po_id
JOIN purchase_order_lines pol ON pol.po_id=po.id
WHERE g.doc_no='GRN/25-26/0005' AND pol.item_id=1264
  AND NOT EXISTS (SELECT 1 FROM stock_movements WHERE ref_no='GRN/25-26/0005' AND item_id=1264 AND qty>0);

INSERT IGNORE INTO stock_movements (site_id, item_id, make_id, qty, rate, kind, ref_type, ref_id, ref_no, moved_on, created_by)
SELECT (SELECT id FROM sites WHERE code='GD-0002'), pol.item_id, pol.make_id, 490.000, 285.00,
       'GRN', 'GRN', g.id, 'GRN/25-26/0005', '2025-08-04', 3
FROM goods_receipts g JOIN purchase_orders po ON po.id=g.po_id
JOIN purchase_order_lines pol ON pol.po_id=po.id
WHERE g.doc_no='GRN/25-26/0005' AND pol.item_id=1179
  AND NOT EXISTS (SELECT 1 FROM stock_movements WHERE ref_no='GRN/25-26/0005' AND item_id=1179 AND qty>0);

-- =====================================================================
-- BLOCK 13 — DELIVERY CHALLANS
-- =====================================================================

-- DC3: Prestige switchgear HYD Store → Prestige site (ACKNOWLEDGED)
INSERT INTO delivery_challans (doc_no, branch_id, from_site_id, to_site_id, dc_date, status,
                                vehicle_no, driver, dispatched_at, dispatched_by, created_by)
SELECT 'DC/25-26/0003', 1,
       (SELECT id FROM sites WHERE code='GD-0001'),
       (SELECT id FROM sites WHERE code='ST-0004'),
       '2025-07-22', 'ACKNOWLEDGED', 'TS09EB5678', 'Venkat Reddy',
       '2025-07-22 09:00:00',
       (SELECT id FROM users WHERE emp_code='E003'),
       (SELECT id FROM users WHERE emp_code='E003')
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM delivery_challans WHERE doc_no='DC/25-26/0003');

INSERT IGNORE INTO delivery_challan_lines (dc_id, item_id, make_id, uom_id, qty, rate)
SELECT dc.id, 1487, NULL, (SELECT id FROM uoms WHERE code="No's"), 315.000, 185.00
FROM delivery_challans dc WHERE dc.doc_no='DC/25-26/0003';
INSERT IGNORE INTO delivery_challan_lines (dc_id, item_id, make_id, uom_id, qty, rate)
SELECT dc.id, 1490, NULL, (SELECT id FROM uoms WHERE code="No's"), 315.000, 95.00
FROM delivery_challans dc WHERE dc.doc_no='DC/25-26/0003';
INSERT IGNORE INTO delivery_challan_lines (dc_id, item_id, make_id, uom_id, qty, rate)
SELECT dc.id, 2578, (SELECT id FROM makes WHERE name='POLY CAB'), (SELECT id FROM uoms WHERE code='Mtrs'), 4000.000, 92.00
FROM delivery_challans dc WHERE dc.doc_no='DC/25-26/0003';

INSERT IGNORE INTO dc_line_indents (dc_line_id, indent_id, qty)
SELECT dcl.id, i.id, 315.000 FROM delivery_challan_lines dcl
JOIN delivery_challans dc ON dc.id=dcl.dc_id JOIN indents i ON i.doc_no='IND/25-26/0006'
WHERE dc.doc_no='DC/25-26/0003' AND dcl.item_id=1487;
INSERT IGNORE INTO dc_line_indents (dc_line_id, indent_id, qty)
SELECT dcl.id, i.id, 315.000 FROM delivery_challan_lines dcl
JOIN delivery_challans dc ON dc.id=dcl.dc_id JOIN indents i ON i.doc_no='IND/25-26/0006'
WHERE dc.doc_no='DC/25-26/0003' AND dcl.item_id=1490;
INSERT IGNORE INTO dc_line_indents (dc_line_id, indent_id, qty)
SELECT dcl.id, i.id, 4000.000 FROM delivery_challan_lines dcl
JOIN delivery_challans dc ON dc.id=dcl.dc_id JOIN indents i ON i.doc_no='IND/25-26/0006'
WHERE dc.doc_no='DC/25-26/0003' AND dcl.item_id=2578;

INSERT INTO dc_acknowledgements (dc_id, ack_date, note, acked_by)
SELECT dc.id, '2025-07-22', 'Received all — in good condition',
       (SELECT id FROM users WHERE emp_code='E002')
FROM delivery_challans dc WHERE dc.doc_no='DC/25-26/0003'
  AND NOT EXISTS (SELECT 1 FROM dc_acknowledgements da WHERE da.dc_id=dc.id);
INSERT IGNORE INTO dc_acknowledgement_lines (ack_id, dc_line_id, qty)
SELECT a.id, dcl.id, dcl.qty FROM dc_acknowledgements a
JOIN delivery_challans dc ON dc.id=a.dc_id
JOIN delivery_challan_lines dcl ON dcl.dc_id=dc.id
WHERE dc.doc_no='DC/25-26/0003';

-- Stock: out of GD-0001, into ST-0004
INSERT IGNORE INTO stock_movements (site_id, item_id, make_id, qty, rate, kind, ref_type, ref_id, ref_no, moved_on, created_by)
SELECT (SELECT id FROM sites WHERE code='GD-0001'), dcl.item_id, dcl.make_id, -dcl.qty, dcl.rate,
       'ISSUE', 'DC', dc.id, 'DC/25-26/0003', '2025-07-22', 3
FROM delivery_challans dc JOIN delivery_challan_lines dcl ON dcl.dc_id=dc.id
WHERE dc.doc_no='DC/25-26/0003'
  AND NOT EXISTS (SELECT 1 FROM stock_movements WHERE ref_no='DC/25-26/0003'
                  AND site_id=(SELECT id FROM sites WHERE code='GD-0001') AND item_id=dcl.item_id AND qty<0);

INSERT IGNORE INTO stock_movements (site_id, item_id, make_id, qty, rate, kind, ref_type, ref_id, ref_no, moved_on, created_by)
SELECT (SELECT id FROM sites WHERE code='ST-0004'), dcl.item_id, dcl.make_id, dcl.qty, dcl.rate,
       'GRN', 'DC', dc.id, 'DC/25-26/0003', '2025-07-22', 2
FROM delivery_challans dc JOIN delivery_challan_lines dcl ON dcl.dc_id=dc.id
WHERE dc.doc_no='DC/25-26/0003'
  AND NOT EXISTS (SELECT 1 FROM stock_movements WHERE ref_no='DC/25-26/0003'
                  AND site_id=(SELECT id FROM sites WHERE code='ST-0004') AND item_id=dcl.item_id AND qty>0);

-- DC4: DLF cable trays HYD Store → DLF site (DISPATCHED — IN_TRANSIT, not yet acked)
INSERT INTO delivery_challans (doc_no, branch_id, from_site_id, to_site_id, dc_date, status,
                                vehicle_no, driver, dispatched_at, dispatched_by, created_by)
SELECT 'DC/25-26/0004', 1,
       (SELECT id FROM sites WHERE code='GD-0001'),
       (SELECT id FROM sites WHERE code='ST-0005'),
       '2025-08-09', 'DISPATCHED', 'TS09EC9012', 'Ramkumar',
       '2025-08-09 08:30:00',
       (SELECT id FROM users WHERE emp_code='E003'),
       (SELECT id FROM users WHERE emp_code='E003')
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM delivery_challans WHERE doc_no='DC/25-26/0004');

INSERT IGNORE INTO delivery_challan_lines (dc_id, item_id, make_id, uom_id, qty, rate)
SELECT dc.id, 131, NULL, (SELECT id FROM uoms WHERE code='Mtrs'), 840.000, 340.00
FROM delivery_challans dc WHERE dc.doc_no='DC/25-26/0004';

INSERT IGNORE INTO dc_line_indents (dc_line_id, indent_id, qty)
SELECT dcl.id, i.id, 840.000 FROM delivery_challan_lines dcl
JOIN delivery_challans dc ON dc.id=dcl.dc_id JOIN indents i ON i.doc_no='IND/25-26/0007'
WHERE dc.doc_no='DC/25-26/0004' AND dcl.item_id=131;

-- Stock out of store (dispatched), NOT yet in at site (still in transit)
INSERT IGNORE INTO stock_movements (site_id, item_id, make_id, qty, rate, kind, ref_type, ref_id, ref_no, moved_on, created_by)
SELECT (SELECT id FROM sites WHERE code='GD-0001'), dcl.item_id, dcl.make_id, -dcl.qty, dcl.rate,
       'ISSUE', 'DC', dc.id, 'DC/25-26/0004', '2025-08-09', 3
FROM delivery_challans dc JOIN delivery_challan_lines dcl ON dcl.dc_id=dc.id
WHERE dc.doc_no='DC/25-26/0004'
  AND NOT EXISTS (SELECT 1 FROM stock_movements WHERE ref_no='DC/25-26/0004'
                  AND site_id=(SELECT id FROM sites WHERE code='GD-0001') AND qty<0);

-- DC5: Embassy BLR — MCBs dispatched from BLR store, IN_TRANSIT
INSERT INTO delivery_challans (doc_no, branch_id, from_site_id, to_site_id, dc_date, status,
                                vehicle_no, driver, dispatched_at, dispatched_by, created_by)
SELECT 'DC/25-26/0005', 2,
       (SELECT id FROM sites WHERE code='GD-0002'),
       (SELECT id FROM sites WHERE code='ST-0007'),
       '2025-08-07', 'DISPATCHED', 'KA01MF3456', 'Suresh Driver',
       '2025-08-07 10:00:00',
       (SELECT id FROM users WHERE emp_code='E003'),
       (SELECT id FROM users WHERE emp_code='E003')
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM delivery_challans WHERE doc_no='DC/25-26/0005');

INSERT IGNORE INTO delivery_challan_lines (dc_id, item_id, make_id, uom_id, qty, rate)
SELECT dc.id, 1179, (SELECT id FROM makes WHERE name='schneider'), (SELECT id FROM uoms WHERE code="No's"), 490.000, 285.00
FROM delivery_challans dc WHERE dc.doc_no='DC/25-26/0005';

INSERT IGNORE INTO dc_line_indents (dc_line_id, indent_id, qty)
SELECT dcl.id, i.id, 490.000 FROM delivery_challan_lines dcl
JOIN delivery_challans dc ON dc.id=dcl.dc_id JOIN indents i ON i.doc_no='IND/25-26/0009'
WHERE dc.doc_no='DC/25-26/0005' AND dcl.item_id=1179;

INSERT IGNORE INTO stock_movements (site_id, item_id, make_id, qty, rate, kind, ref_type, ref_id, ref_no, moved_on, created_by)
SELECT (SELECT id FROM sites WHERE code='GD-0002'), dcl.item_id, dcl.make_id, -dcl.qty, dcl.rate,
       'ISSUE', 'DC', dc.id, 'DC/25-26/0005', '2025-08-07', 3
FROM delivery_challans dc JOIN delivery_challan_lines dcl ON dcl.dc_id=dc.id
WHERE dc.doc_no='DC/25-26/0005'
  AND NOT EXISTS (SELECT 1 FROM stock_movements WHERE ref_no='DC/25-26/0005'
                  AND site_id=(SELECT id FROM sites WHERE code='GD-0002') AND qty<0);

-- DC6: Prestige remaining 2.5mm wire — 2nd dispatch (ACKNOWLEDGED)
INSERT INTO delivery_challans (doc_no, branch_id, from_site_id, to_site_id, dc_date, status,
                                vehicle_no, driver, dispatched_at, dispatched_by, created_by)
SELECT 'DC/25-26/0006', 1,
       (SELECT id FROM sites WHERE code='GD-0001'),
       (SELECT id FROM sites WHERE code='ST-0004'),
       '2025-08-01', 'ACKNOWLEDGED', 'TS09EB5678', 'Venkat Reddy',
       '2025-08-01 08:00:00',
       (SELECT id FROM users WHERE emp_code='E003'),
       (SELECT id FROM users WHERE emp_code='E003')
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM delivery_challans WHERE doc_no='DC/25-26/0006');

INSERT IGNORE INTO delivery_challan_lines (dc_id, item_id, make_id, uom_id, qty, rate)
SELECT dc.id, 2578, (SELECT id FROM makes WHERE name='POLY CAB'), (SELECT id FROM uoms WHERE code='Mtrs'), 2300.000, 92.00
FROM delivery_challans dc WHERE dc.doc_no='DC/25-26/0006';

INSERT IGNORE INTO dc_line_indents (dc_line_id, indent_id, qty)
SELECT dcl.id, i.id, 2300.000 FROM delivery_challan_lines dcl
JOIN delivery_challans dc ON dc.id=dcl.dc_id JOIN indents i ON i.doc_no='IND/25-26/0006'
WHERE dc.doc_no='DC/25-26/0006' AND dcl.item_id=2578;

INSERT INTO dc_acknowledgements (dc_id, ack_date, note, acked_by)
SELECT dc.id, '2025-08-01', '2300m 2.5mm wire received', (SELECT id FROM users WHERE emp_code='E002')
FROM delivery_challans dc WHERE dc.doc_no='DC/25-26/0006'
  AND NOT EXISTS (SELECT 1 FROM dc_acknowledgements da WHERE da.dc_id=dc.id);
INSERT IGNORE INTO dc_acknowledgement_lines (ack_id, dc_line_id, qty)
SELECT a.id, dcl.id, dcl.qty FROM dc_acknowledgements a
JOIN delivery_challans dc ON dc.id=a.dc_id
JOIN delivery_challan_lines dcl ON dcl.dc_id=dc.id
WHERE dc.doc_no='DC/25-26/0006';

INSERT IGNORE INTO stock_movements (site_id, item_id, make_id, qty, rate, kind, ref_type, ref_id, ref_no, moved_on, created_by)
SELECT (SELECT id FROM sites WHERE code='GD-0001'), dcl.item_id, dcl.make_id, -dcl.qty, dcl.rate,
       'ISSUE', 'DC', dc.id, 'DC/25-26/0006', '2025-08-01', 3
FROM delivery_challans dc JOIN delivery_challan_lines dcl ON dcl.dc_id=dc.id
WHERE dc.doc_no='DC/25-26/0006'
  AND NOT EXISTS (SELECT 1 FROM stock_movements WHERE ref_no='DC/25-26/0006'
                  AND site_id=(SELECT id FROM sites WHERE code='GD-0001') AND qty<0);

INSERT IGNORE INTO stock_movements (site_id, item_id, make_id, qty, rate, kind, ref_type, ref_id, ref_no, moved_on, created_by)
SELECT (SELECT id FROM sites WHERE code='ST-0004'), dcl.item_id, dcl.make_id, dcl.qty, dcl.rate,
       'GRN', 'DC', dc.id, 'DC/25-26/0006', '2025-08-01', 2
FROM delivery_challans dc JOIN delivery_challan_lines dcl ON dcl.dc_id=dc.id
WHERE dc.doc_no='DC/25-26/0006'
  AND NOT EXISTS (SELECT 1 FROM stock_movements WHERE ref_no='DC/25-26/0006'
                  AND site_id=(SELECT id FROM sites WHERE code='ST-0004') AND qty>0);

-- DC7: Embassy RCCBs from BLR store → Manyata (ACKNOWLEDGED)
INSERT INTO delivery_challans (doc_no, branch_id, from_site_id, to_site_id, dc_date, status,
                                vehicle_no, driver, dispatched_at, dispatched_by, created_by)
SELECT 'DC/25-26/0007', 2,
       (SELECT id FROM sites WHERE code='GD-0002'),
       (SELECT id FROM sites WHERE code='ST-0007'),
       '2025-08-06', 'ACKNOWLEDGED', 'KA01MF3456', 'Suresh Driver',
       '2025-08-06 10:00:00',
       (SELECT id FROM users WHERE emp_code='E003'),
       (SELECT id FROM users WHERE emp_code='E003')
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM delivery_challans WHERE doc_no='DC/25-26/0007');

INSERT IGNORE INTO delivery_challan_lines (dc_id, item_id, make_id, uom_id, qty, rate)
SELECT dc.id, 1264, (SELECT id FROM makes WHERE name='schneider'), (SELECT id FROM uoms WHERE code="No's"), 100.000, 1680.00
FROM delivery_challans dc WHERE dc.doc_no='DC/25-26/0007';

INSERT IGNORE INTO dc_line_indents (dc_line_id, indent_id, qty)
SELECT dcl.id, i.id, 100.000 FROM delivery_challan_lines dcl
JOIN delivery_challans dc ON dc.id=dcl.dc_id JOIN indents i ON i.doc_no='IND/25-26/0009'
WHERE dc.doc_no='DC/25-26/0007' AND dcl.item_id=1264;

INSERT INTO dc_acknowledgements (dc_id, ack_date, note, acked_by)
SELECT dc.id, '2025-08-06', '100 RCCBs received OK', (SELECT id FROM users WHERE emp_code='E004')
FROM delivery_challans dc WHERE dc.doc_no='DC/25-26/0007'
  AND NOT EXISTS (SELECT 1 FROM dc_acknowledgements da WHERE da.dc_id=dc.id);
INSERT IGNORE INTO dc_acknowledgement_lines (ack_id, dc_line_id, qty)
SELECT a.id, dcl.id, dcl.qty FROM dc_acknowledgements a
JOIN delivery_challans dc ON dc.id=a.dc_id
JOIN delivery_challan_lines dcl ON dcl.dc_id=dc.id
WHERE dc.doc_no='DC/25-26/0007';

INSERT IGNORE INTO stock_movements (site_id, item_id, make_id, qty, rate, kind, ref_type, ref_id, ref_no, moved_on, created_by)
SELECT (SELECT id FROM sites WHERE code='GD-0002'), dcl.item_id, dcl.make_id, -dcl.qty, dcl.rate,
       'ISSUE', 'DC', dc.id, 'DC/25-26/0007', '2025-08-06', 3
FROM delivery_challans dc JOIN delivery_challan_lines dcl ON dcl.dc_id=dc.id
WHERE dc.doc_no='DC/25-26/0007'
  AND NOT EXISTS (SELECT 1 FROM stock_movements WHERE ref_no='DC/25-26/0007'
                  AND site_id=(SELECT id FROM sites WHERE code='GD-0002') AND qty<0);

INSERT IGNORE INTO stock_movements (site_id, item_id, make_id, qty, rate, kind, ref_type, ref_id, ref_no, moved_on, created_by)
SELECT (SELECT id FROM sites WHERE code='ST-0007'), dcl.item_id, dcl.make_id, dcl.qty, dcl.rate,
       'GRN', 'DC', dc.id, 'DC/25-26/0007', '2025-08-06', 2
FROM delivery_challans dc JOIN delivery_challan_lines dcl ON dcl.dc_id=dc.id
WHERE dc.doc_no='DC/25-26/0007'
  AND NOT EXISTS (SELECT 1 FROM stock_movements WHERE ref_no='DC/25-26/0007'
                  AND site_id=(SELECT id FROM sites WHERE code='ST-0007') AND qty>0);

-- =====================================================================
-- BLOCK 14 — ISSUES (CON) + RETURNS (RET)
-- =====================================================================

-- CON4: Prestige — switch/socket items issued
INSERT INTO consumptions (doc_no, site_id, branch_id, boq_id, used_on,
                           issued_to_name, purpose, status, recorded_by)
SELECT 'CON/25-26/0004',
       (SELECT id FROM sites WHERE code='ST-0004'), 1,
       (SELECT id FROM boqs WHERE doc_no='BOQ/25-26/0004'),
       '2025-07-25', 'Kiran — Switch Fitter',
       'Switch & socket fixing — levels 1 to 4',
       'CONFIRMED', (SELECT id FROM users WHERE emp_code='E003')
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM consumptions WHERE doc_no='CON/25-26/0004');

INSERT IGNORE INTO consumption_lines (consumption_id, boq_line_id, item_id, make_id, uom_id, qty, rate)
SELECT c.id, bl.id, bl.item_id, bl.make_id, (SELECT id FROM uoms WHERE code="No's"), 200.000, 185.00
FROM consumptions c, boq_lines bl JOIN boqs b ON b.id=bl.boq_id
WHERE c.doc_no='CON/25-26/0004' AND b.doc_no='BOQ/25-26/0004' AND bl.sno='1a';

INSERT IGNORE INTO consumption_lines (consumption_id, boq_line_id, item_id, make_id, uom_id, qty, rate)
SELECT c.id, bl.id, bl.item_id, bl.make_id, (SELECT id FROM uoms WHERE code="No's"), 200.000, 95.00
FROM consumptions c, boq_lines bl JOIN boqs b ON b.id=bl.boq_id
WHERE c.doc_no='CON/25-26/0004' AND b.doc_no='BOQ/25-26/0004' AND bl.sno='1b';

INSERT IGNORE INTO stock_movements (site_id, item_id, make_id, qty, rate, kind, ref_type, ref_id, ref_no, moved_on, created_by)
SELECT c.site_id, cl.item_id, cl.make_id, -cl.qty, cl.rate, 'ISSUE', 'CON', c.id, 'CON/25-26/0004', c.used_on, 3
FROM consumptions c JOIN consumption_lines cl ON cl.consumption_id=c.id
WHERE c.doc_no='CON/25-26/0004'
  AND NOT EXISTS (SELECT 1 FROM stock_movements WHERE ref_no='CON/25-26/0004' AND item_id=cl.item_id AND qty<0);

-- CON5: Prestige — 2.5mm wiring issued (floor 1-3)
INSERT INTO consumptions (doc_no, site_id, branch_id, boq_id, used_on,
                           issued_to_name, purpose, status, recorded_by)
SELECT 'CON/25-26/0005',
       (SELECT id FROM sites WHERE code='ST-0004'), 1,
       (SELECT id FROM boqs WHERE doc_no='BOQ/25-26/0004'),
       '2025-08-05', 'Ramesh — Gang Wiring',
       'FR-LSH 2.5mm wiring floors 1–3',
       'CONFIRMED', (SELECT id FROM users WHERE emp_code='E003')
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM consumptions WHERE doc_no='CON/25-26/0005');

INSERT IGNORE INTO consumption_lines (consumption_id, boq_line_id, item_id, make_id, uom_id, qty, rate)
SELECT c.id, bl.id, bl.item_id, bl.make_id, (SELECT id FROM uoms WHERE code='Mtrs'), 3800.000, 92.00
FROM consumptions c, boq_lines bl JOIN boqs b ON b.id=bl.boq_id
WHERE c.doc_no='CON/25-26/0005' AND b.doc_no='BOQ/25-26/0004' AND bl.sno='3a';

INSERT IGNORE INTO stock_movements (site_id, item_id, make_id, qty, rate, kind, ref_type, ref_id, ref_no, moved_on, created_by)
SELECT c.site_id, cl.item_id, cl.make_id, -cl.qty, cl.rate, 'ISSUE', 'CON', c.id, 'CON/25-26/0005', c.used_on, 3
FROM consumptions c JOIN consumption_lines cl ON cl.consumption_id=c.id
WHERE c.doc_no='CON/25-26/0005'
  AND NOT EXISTS (SELECT 1 FROM stock_movements WHERE ref_no='CON/25-26/0005' AND qty<0);

-- CON6: Embassy BLR — RCCBs installed
INSERT INTO consumptions (doc_no, site_id, branch_id, boq_id, used_on,
                           issued_to_name, purpose, status, recorded_by)
SELECT 'CON/25-26/0006',
       (SELECT id FROM sites WHERE code='ST-0007'), 2,
       (SELECT id FROM boqs WHERE doc_no='BOQ/25-26/0007'),
       '2025-08-08', 'Sathish — DB Fitter',
       'RCCB installation tenant DB boards B1-B5',
       'CONFIRMED', (SELECT id FROM users WHERE emp_code='E003')
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM consumptions WHERE doc_no='CON/25-26/0006');

INSERT IGNORE INTO consumption_lines (consumption_id, boq_line_id, item_id, make_id, uom_id, qty, rate)
SELECT c.id, bl.id, bl.item_id, bl.make_id, (SELECT id FROM uoms WHERE code="No's"), 80.000, 1680.00
FROM consumptions c, boq_lines bl JOIN boqs b ON b.id=bl.boq_id
WHERE c.doc_no='CON/25-26/0006' AND b.doc_no='BOQ/25-26/0007' AND bl.sno='1a';

INSERT IGNORE INTO stock_movements (site_id, item_id, make_id, qty, rate, kind, ref_type, ref_id, ref_no, moved_on, created_by)
SELECT c.site_id, cl.item_id, cl.make_id, -cl.qty, cl.rate, 'ISSUE', 'CON', c.id, 'CON/25-26/0006', c.used_on, 3
FROM consumptions c JOIN consumption_lines cl ON cl.consumption_id=c.id
WHERE c.doc_no='CON/25-26/0006'
  AND NOT EXISTS (SELECT 1 FROM stock_movements WHERE ref_no='CON/25-26/0006' AND qty<0);

-- CON7: Embassy — MCBs issued (DRAFT)
INSERT INTO consumptions (doc_no, site_id, branch_id, boq_id, used_on,
                           issued_to_name, purpose, status, recorded_by)
SELECT 'CON/25-26/0007',
       (SELECT id FROM sites WHERE code='ST-0007'), 2,
       (SELECT id FROM boqs WHERE doc_no='BOQ/25-26/0007'),
       '2025-08-10', 'Sathish — DB Fitter',
       '16A SP MCBs — draft pending confirmation',
       'DRAFT', (SELECT id FROM users WHERE emp_code='E003')
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM consumptions WHERE doc_no='CON/25-26/0007');

INSERT IGNORE INTO consumption_lines (consumption_id, boq_line_id, item_id, make_id, uom_id, qty, rate)
SELECT c.id, bl.id, bl.item_id, bl.make_id, (SELECT id FROM uoms WHERE code="No's"), 490.000, 285.00
FROM consumptions c, boq_lines bl JOIN boqs b ON b.id=bl.boq_id
WHERE c.doc_no='CON/25-26/0007' AND b.doc_no='BOQ/25-26/0007' AND bl.sno='2a';

-- CON8: Prestige front plates — CONFIRMED
INSERT INTO consumptions (doc_no, site_id, branch_id, boq_id, used_on,
                           issued_to_name, purpose, status, recorded_by)
SELECT 'CON/25-26/0008',
       (SELECT id FROM sites WHERE code='ST-0004'), 1,
       (SELECT id FROM boqs WHERE doc_no='BOQ/25-26/0004'),
       '2025-08-12', 'Kiran — Switch Fitter',
       'Front plates fitting floors 1-4',
       'CONFIRMED', (SELECT id FROM users WHERE emp_code='E003')
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM consumptions WHERE doc_no='CON/25-26/0008');

INSERT IGNORE INTO consumption_lines (consumption_id, boq_line_id, item_id, make_id, uom_id, qty, rate)
SELECT c.id, bl.id, bl.item_id, bl.make_id, (SELECT id FROM uoms WHERE code="No's"), 315.000, 40.00
FROM consumptions c, boq_lines bl JOIN boqs b ON b.id=bl.boq_id
WHERE c.doc_no='CON/25-26/0008' AND b.doc_no='BOQ/25-26/0004' AND bl.sno='1c';

INSERT IGNORE INTO stock_movements (site_id, item_id, make_id, qty, rate, kind, ref_type, ref_id, ref_no, moved_on, created_by)
SELECT c.site_id, cl.item_id, cl.make_id, -cl.qty, cl.rate, 'ISSUE', 'CON', c.id, 'CON/25-26/0008', c.used_on, 3
FROM consumptions c JOIN consumption_lines cl ON cl.consumption_id=c.id
WHERE c.doc_no='CON/25-26/0008'
  AND NOT EXISTS (SELECT 1 FROM stock_movements WHERE ref_no='CON/25-26/0008' AND qty<0);

-- Need to add SWS-0005 (front plate) stock at ST-0004 first
INSERT IGNORE INTO stock_movements (site_id, item_id, make_id, qty, rate, kind, ref_type, ref_id, ref_no, moved_on, created_by)
SELECT (SELECT id FROM sites WHERE code='ST-0004'), 1491, NULL, 315.000, 40.00,
       'GRN', 'DC', (SELECT id FROM delivery_challans WHERE doc_no='DC/25-26/0003'),
       'DC/25-26/0003', '2025-07-22', 2
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM stock_movements
  WHERE ref_no='DC/25-26/0003' AND site_id=(SELECT id FROM sites WHERE code='ST-0004') AND item_id=1491);

-- RET2: Prestige — excess switches returned
INSERT INTO stock_returns (doc_no, site_id, branch_id, returned_on,
                            returned_by_name, reason, status, recorded_by)
SELECT 'RET/25-26/0002',
       (SELECT id FROM sites WHERE code='ST-0004'), 1,
       '2025-08-15', 'Kiran — Switch Fitter',
       'Excess switches — 15 spare after floors 1-4 complete',
       'CONFIRMED', (SELECT id FROM users WHERE emp_code='E003')
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM stock_returns WHERE doc_no='RET/25-26/0002');

INSERT IGNORE INTO stock_return_lines (return_id, item_id, make_id, uom_id, qty, rate)
SELECT r.id, 1490, NULL, (SELECT id FROM uoms WHERE code="No's"), 15.000, 95.00
FROM stock_returns r WHERE r.doc_no='RET/25-26/0002';

INSERT IGNORE INTO stock_movements (site_id, item_id, make_id, qty, rate, kind, ref_type, ref_id, ref_no, moved_on, created_by)
SELECT r.site_id, rl.item_id, rl.make_id, rl.qty, rl.rate, 'RETURN', 'RET', r.id, 'RET/25-26/0002', r.returned_on, 3
FROM stock_returns r JOIN stock_return_lines rl ON rl.return_id=r.id
WHERE r.doc_no='RET/25-26/0002'
  AND NOT EXISTS (SELECT 1 FROM stock_movements WHERE ref_no='RET/25-26/0002');

-- RET3: Embassy — 5 damaged RCCBs returned
INSERT INTO stock_returns (doc_no, site_id, branch_id, returned_on,
                            returned_by_name, reason, status, recorded_by)
SELECT 'RET/25-26/0003',
       (SELECT id FROM sites WHERE code='ST-0007'), 2,
       '2025-08-10', 'Sathish — DB Fitter',
       '5 RCCBs damaged in transit — returning to store for replacement',
       'CONFIRMED', (SELECT id FROM users WHERE emp_code='E003')
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM stock_returns WHERE doc_no='RET/25-26/0003');

INSERT IGNORE INTO stock_return_lines (return_id, item_id, make_id, uom_id, qty, rate)
SELECT r.id, 1264, (SELECT id FROM makes WHERE name='schneider'), (SELECT id FROM uoms WHERE code="No's"), 5.000, 1680.00
FROM stock_returns r WHERE r.doc_no='RET/25-26/0003';

INSERT IGNORE INTO stock_movements (site_id, item_id, make_id, qty, rate, kind, ref_type, ref_id, ref_no, moved_on, created_by)
SELECT r.site_id, rl.item_id, rl.make_id, rl.qty, rl.rate, 'RETURN', 'RET', r.id, 'RET/25-26/0003', r.returned_on, 3
FROM stock_returns r JOIN stock_return_lines rl ON rl.return_id=r.id
WHERE r.doc_no='RET/25-26/0003'
  AND NOT EXISTS (SELECT 1 FROM stock_movements WHERE ref_no='RET/25-26/0003');

-- =====================================================================
-- BLOCK 15 — EXPENSES (12 more across all new sites)
-- =====================================================================

-- EXP7: Prestige — Transport (APPROVED)
INSERT INTO site_expenses (doc_no, site_id, branch_id, category_id, spent_on, description, paid_to,
                            claimed_amount, approved_amount, status, raised_by, submitted_at, decided_by, decided_at, decision_note)
SELECT 'EXP/25-26/0007', (SELECT id FROM sites WHERE code='ST-0004'), 1,
       (SELECT id FROM expense_categories WHERE name='Transport'),
       '2025-07-22', 'Lorry hire — switchgear delivery from HYD store to Prestige Hi-Tech',
       'Raju Transport', 5500.00, 5500.00, 'APPROVED',
       (SELECT id FROM users WHERE emp_code='E002'),
       '2025-07-23 09:00:00', (SELECT id FROM users WHERE emp_code='E005'),
       '2025-07-24 10:00:00', 'Approved in full'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM site_expenses WHERE doc_no='EXP/25-26/0007');

INSERT IGNORE INTO site_expense_events (expense_id, action, amount, user_id, note)
SELECT id, 'SUBMITTED', NULL, (SELECT id FROM users WHERE emp_code='E002'), NULL
FROM site_expenses WHERE doc_no='EXP/25-26/0007';
INSERT IGNORE INTO site_expense_events (expense_id, action, amount, user_id, note)
SELECT id, 'APPROVED', 5500.00, (SELECT id FROM users WHERE emp_code='E005'), NULL
FROM site_expenses WHERE doc_no='EXP/25-26/0007';

-- EXP8: Prestige — Labour July (APPROVED)
INSERT INTO site_expenses (doc_no, site_id, branch_id, category_id, spent_on, description, paid_to,
                            claimed_amount, approved_amount, status, raised_by, submitted_at, decided_by, decided_at, decision_note)
SELECT 'EXP/25-26/0008', (SELECT id FROM sites WHERE code='ST-0004'), 1,
       (SELECT id FROM expense_categories WHERE name='Labour'),
       '2025-07-31', 'Skilled labour — switch/socket and wiring work July 2025',
       'Kiran Electricals', 55000.00, 55000.00, 'APPROVED',
       (SELECT id FROM users WHERE emp_code='E002'),
       '2025-08-01 09:00:00', (SELECT id FROM users WHERE emp_code='E005'),
       '2025-08-02 11:00:00', 'Approved'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM site_expenses WHERE doc_no='EXP/25-26/0008');

INSERT IGNORE INTO site_expense_events (expense_id, action, amount, user_id, note)
SELECT id, 'SUBMITTED', NULL, (SELECT id FROM users WHERE emp_code='E002'), NULL
FROM site_expenses WHERE doc_no='EXP/25-26/0008';
INSERT IGNORE INTO site_expense_events (expense_id, action, amount, user_id, note)
SELECT id, 'APPROVED', 55000.00, (SELECT id FROM users WHERE emp_code='E005'), NULL
FROM site_expenses WHERE doc_no='EXP/25-26/0008';

-- EXP9: Prestige — Accommodation (APPROVED)
INSERT INTO site_expenses (doc_no, site_id, branch_id, category_id, spent_on, description, paid_to,
                            claimed_amount, approved_amount, status, raised_by, submitted_at, decided_by, decided_at, decision_note)
SELECT 'EXP/25-26/0009', (SELECT id FROM sites WHERE code='ST-0004'), 1,
       (SELECT id FROM expense_categories WHERE name='Accommodation'),
       '2025-07-31', 'Accommodation — 4 outstation workers, July 2025 (24 nights)',
       'Lucky Lodge Kukatpally', 9600.00, 8400.00, 'APPROVED',
       (SELECT id FROM users WHERE emp_code='E002'),
       '2025-08-01 09:30:00', (SELECT id FROM users WHERE emp_code='E005'),
       '2025-08-02 11:00:00', 'Approved ₹8400; 6 nights not supported by receipt'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM site_expenses WHERE doc_no='EXP/25-26/0009');

INSERT IGNORE INTO site_expense_events (expense_id, action, amount, user_id, note)
SELECT id, 'SUBMITTED', NULL, (SELECT id FROM users WHERE emp_code='E002'), NULL
FROM site_expenses WHERE doc_no='EXP/25-26/0009';
INSERT IGNORE INTO site_expense_events (expense_id, action, amount, user_id, note)
SELECT id, 'APPROVED', 8400.00, (SELECT id FROM users WHERE emp_code='E005'), 'Partial approval'
FROM site_expenses WHERE doc_no='EXP/25-26/0009';

-- EXP10: DLF Cybercity — Transport SUBMITTED
INSERT INTO site_expenses (doc_no, site_id, branch_id, category_id, spent_on, description, paid_to,
                            claimed_amount, approved_amount, status, raised_by, submitted_at)
SELECT 'EXP/25-26/0010', (SELECT id FROM sites WHERE code='ST-0005'), 1,
       (SELECT id FROM expense_categories WHERE name='Transport'),
       '2025-08-09', 'Lorry hire — cable tray transport to DLF Cybercity',
       'Raju Transport', 7800.00, NULL, 'SUBMITTED',
       (SELECT id FROM users WHERE emp_code='E004'), '2025-08-10 08:00:00'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM site_expenses WHERE doc_no='EXP/25-26/0010');

INSERT IGNORE INTO site_expense_events (expense_id, action, amount, user_id, note)
SELECT id, 'SUBMITTED', NULL, (SELECT id FROM users WHERE emp_code='E004'), NULL
FROM site_expenses WHERE doc_no='EXP/25-26/0010';

-- EXP11: DLF — Labour August (SUBMITTED)
INSERT INTO site_expenses (doc_no, site_id, branch_id, category_id, spent_on, description, paid_to,
                            claimed_amount, approved_amount, status, raised_by, submitted_at)
SELECT 'EXP/25-26/0011', (SELECT id FROM sites WHERE code='ST-0005'), 1,
       (SELECT id FROM expense_categories WHERE name='Labour'),
       '2025-08-31', 'Skilled labour — cable tray installation August 2025',
       'Kumar Construction', 48000.00, NULL, 'SUBMITTED',
       (SELECT id FROM users WHERE emp_code='E004'), '2025-09-01 09:00:00'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM site_expenses WHERE doc_no='EXP/25-26/0011');

INSERT IGNORE INTO site_expense_events (expense_id, action, amount, user_id, note)
SELECT id, 'SUBMITTED', NULL, (SELECT id FROM users WHERE emp_code='E004'), NULL
FROM site_expenses WHERE doc_no='EXP/25-26/0011';

-- EXP12: Embassy BLR — Transport (APPROVED)
INSERT INTO site_expenses (doc_no, site_id, branch_id, category_id, spent_on, description, paid_to,
                            claimed_amount, approved_amount, status, raised_by, submitted_at, decided_by, decided_at, decision_note)
SELECT 'EXP/25-26/0012', (SELECT id FROM sites WHERE code='ST-0007'), 2,
       (SELECT id FROM expense_categories WHERE name='Transport'),
       '2025-08-06', 'Lorry — switchgear delivery from BLR store to Embassy Manyata',
       'BLR Logistics', 6200.00, 6200.00, 'APPROVED',
       (SELECT id FROM users WHERE emp_code='E004'),
       '2025-08-07 09:00:00', (SELECT id FROM users WHERE emp_code='E005'),
       '2025-08-08 10:00:00', 'Approved'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM site_expenses WHERE doc_no='EXP/25-26/0012');

INSERT IGNORE INTO site_expense_events (expense_id, action, amount, user_id, note)
SELECT id, 'SUBMITTED', NULL, (SELECT id FROM users WHERE emp_code='E004'), NULL
FROM site_expenses WHERE doc_no='EXP/25-26/0012';
INSERT IGNORE INTO site_expense_events (expense_id, action, amount, user_id, note)
SELECT id, 'APPROVED', 6200.00, (SELECT id FROM users WHERE emp_code='E005'), NULL
FROM site_expenses WHERE doc_no='EXP/25-26/0012';

-- EXP13: Embassy — Labour (APPROVED)
INSERT INTO site_expenses (doc_no, site_id, branch_id, category_id, spent_on, description, paid_to,
                            claimed_amount, approved_amount, status, raised_by, submitted_at, decided_by, decided_at, decision_note)
SELECT 'EXP/25-26/0013', (SELECT id FROM sites WHERE code='ST-0007'), 2,
       (SELECT id FROM expense_categories WHERE name='Labour'),
       '2025-08-31', 'DB fitter labour — RCCB installation Aug 2025',
       'Sathish Electrical Works', 38000.00, 38000.00, 'APPROVED',
       (SELECT id FROM users WHERE emp_code='E004'),
       '2025-09-01 09:00:00', (SELECT id FROM users WHERE emp_code='E005'),
       '2025-09-02 10:00:00', 'Approved'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM site_expenses WHERE doc_no='EXP/25-26/0013');

INSERT IGNORE INTO site_expense_events (expense_id, action, amount, user_id, note)
SELECT id, 'SUBMITTED', NULL, (SELECT id FROM users WHERE emp_code='E004'), NULL
FROM site_expenses WHERE doc_no='EXP/25-26/0013';
INSERT IGNORE INTO site_expense_events (expense_id, action, amount, user_id, note)
SELECT id, 'APPROVED', 38000.00, (SELECT id FROM users WHERE emp_code='E005'), NULL
FROM site_expenses WHERE doc_no='EXP/25-26/0013';

-- EXP14: Sobha HYD — Tools (DRAFT)
INSERT INTO site_expenses (doc_no, site_id, branch_id, category_id, spent_on, description, paid_to,
                            claimed_amount, approved_amount, status, raised_by)
SELECT 'EXP/25-26/0014', (SELECT id FROM sites WHERE code='ST-0006'), 1,
       (SELECT id FROM expense_categories WHERE name='Tools and consumables'),
       '2025-09-14', 'Earth rammer rental + sundry tools for earthing work',
       'Tool Hire Hyderabad', 4200.00, NULL, 'DRAFT',
       (SELECT id FROM users WHERE emp_code='E002')
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM site_expenses WHERE doc_no='EXP/25-26/0014');

-- EXP15: GMR T2 — Sub-contract (APPROVED)
INSERT INTO site_expenses (doc_no, site_id, branch_id, category_id, spent_on, description, paid_to,
                            claimed_amount, approved_amount, status, raised_by, submitted_at, decided_by, decided_at, decision_note)
SELECT 'EXP/25-26/0015', (SELECT id FROM sites WHERE code='ST-0001'), 1,
       (SELECT id FROM expense_categories WHERE name='Sub-contract'),
       '2025-08-31', 'Sub-contract — floor 2 DB board assembly and testing',
       'Venu Electricals', 28000.00, 28000.00, 'APPROVED',
       (SELECT id FROM users WHERE emp_code='E002'),
       '2025-09-01 09:00:00', (SELECT id FROM users WHERE emp_code='E005'),
       '2025-09-02 10:00:00', 'Approved'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM site_expenses WHERE doc_no='EXP/25-26/0015');

INSERT IGNORE INTO site_expense_events (expense_id, action, amount, user_id, note)
SELECT id, 'SUBMITTED', NULL, (SELECT id FROM users WHERE emp_code='E002'), NULL
FROM site_expenses WHERE doc_no='EXP/25-26/0015';
INSERT IGNORE INTO site_expense_events (expense_id, action, amount, user_id, note)
SELECT id, 'APPROVED', 28000.00, (SELECT id FROM users WHERE emp_code='E005'), NULL
FROM site_expenses WHERE doc_no='EXP/25-26/0015';

-- EXP16: Brigade HYD — Hire charges (RETURNED for more info)
INSERT INTO site_expenses (doc_no, site_id, branch_id, category_id, spent_on, description, paid_to,
                            claimed_amount, approved_amount, status, raised_by, submitted_at, decided_by, decided_at, decision_note)
SELECT 'EXP/25-26/0016', (SELECT id FROM sites WHERE code='ST-0002'), 1,
       (SELECT id FROM expense_categories WHERE name='Hire charges'),
       '2025-09-10', 'Cable drum stands and pulling equipment hire',
       'Crane & Hoist Services', 12000.00, NULL, 'RETURNED',
       (SELECT id FROM users WHERE emp_code='E004'),
       '2025-09-11 09:00:00', (SELECT id FROM users WHERE emp_code='E005'),
       '2025-09-12 14:00:00', 'Return — need hire agreement and delivery note'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM site_expenses WHERE doc_no='EXP/25-26/0016');

INSERT IGNORE INTO site_expense_events (expense_id, action, amount, user_id, note)
SELECT id, 'SUBMITTED', NULL, (SELECT id FROM users WHERE emp_code='E004'), NULL
FROM site_expenses WHERE doc_no='EXP/25-26/0016';
INSERT IGNORE INTO site_expense_events (expense_id, action, amount, user_id, note)
SELECT id, 'RETURNED', NULL, (SELECT id FROM users WHERE emp_code='E005'), 'Need hire agreement'
FROM site_expenses WHERE doc_no='EXP/25-26/0016';

-- EXP17: Prestige — Fuel (APPROVED)
INSERT INTO site_expenses (doc_no, site_id, branch_id, category_id, spent_on, description, paid_to, bill_no,
                            claimed_amount, approved_amount, status, raised_by, submitted_at, decided_by, decided_at, decision_note)
SELECT 'EXP/25-26/0017', (SELECT id FROM sites WHERE code='ST-0004'), 1,
       (SELECT id FROM expense_categories WHERE name='Fuel'),
       '2025-08-31', 'Generator fuel — extended power outage Aug 2025',
       'HP Petrol Pump', 'HP/2025/312', 4100.00, 4100.00, 'APPROVED',
       (SELECT id FROM users WHERE emp_code='E002'),
       '2025-09-01 08:00:00', (SELECT id FROM users WHERE emp_code='E005'),
       '2025-09-01 18:00:00', 'Approved'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM site_expenses WHERE doc_no='EXP/25-26/0017');

INSERT IGNORE INTO site_expense_events (expense_id, action, amount, user_id, note)
SELECT id, 'SUBMITTED', NULL, (SELECT id FROM users WHERE emp_code='E002'), NULL
FROM site_expenses WHERE doc_no='EXP/25-26/0017';
INSERT IGNORE INTO site_expense_events (expense_id, action, amount, user_id, note)
SELECT id, 'APPROVED', 4100.00, (SELECT id FROM users WHERE emp_code='E005'), NULL
FROM site_expenses WHERE doc_no='EXP/25-26/0017';

-- EXP18: Embassy — Site office (APPROVED)
INSERT INTO site_expenses (doc_no, site_id, branch_id, category_id, spent_on, description, paid_to,
                            claimed_amount, approved_amount, status, raised_by, submitted_at, decided_by, decided_at, decision_note)
SELECT 'EXP/25-26/0018', (SELECT id FROM sites WHERE code='ST-0007'), 2,
       (SELECT id FROM expense_categories WHERE name='Site office'),
       '2025-08-31', 'Site office setup — furniture, stationery, printer Aug 2025',
       'Office Zone Bengaluru', 15500.00, 14000.00, 'APPROVED',
       (SELECT id FROM users WHERE emp_code='E004'),
       '2025-09-01 09:30:00', (SELECT id FROM users WHERE emp_code='E005'),
       '2025-09-02 11:00:00', 'Approved ₹14000; printer claim disallowed — not a site expense'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM site_expenses WHERE doc_no='EXP/25-26/0018');

INSERT IGNORE INTO site_expense_events (expense_id, action, amount, user_id, note)
SELECT id, 'SUBMITTED', NULL, (SELECT id FROM users WHERE emp_code='E004'), NULL
FROM site_expenses WHERE doc_no='EXP/25-26/0018';
INSERT IGNORE INTO site_expense_events (expense_id, action, amount, user_id, note)
SELECT id, 'APPROVED', 14000.00, (SELECT id FROM users WHERE emp_code='E005'), 'Partial — printer disallowed'
FROM site_expenses WHERE doc_no='EXP/25-26/0018';

-- =====================================================================
-- BLOCK 16 — BILLS (3 more: Prestige RA1+RA2, Embassy RA1)
-- =====================================================================

-- RA3: Prestige Hi-Tech RA-1 (RAISED)
INSERT INTO bills (doc_no, ra_no, site_id, branch_id, work_order_id, client_id,
                   bill_date, period_from, period_to, status, client_ref, note, raised_at, raised_by, created_by)
SELECT 'RA/25-26/0003', 1,
       (SELECT id FROM sites WHERE code='ST-0004'), 1,
       (SELECT id FROM work_orders WHERE doc_no='WO/25-26/0004'),
       (SELECT client_id FROM sites WHERE code='ST-0004'),
       '2025-08-15', '2025-06-20', '2025-08-15',
       'RAISED', 'PEPL/CERT/2025/029',
       'RA-1: Switch/socket points + wiring floors 1-4',
       '2025-08-15 17:00:00',
       (SELECT id FROM users WHERE emp_code='E005'),
       (SELECT id FROM users WHERE emp_code='E001')
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM bills WHERE doc_no='RA/25-26/0003');

INSERT IGNORE INTO bill_lines (bill_id, wo_line_id, qty, supply_rate, inst_rate, remark)
SELECT b.id, wol.id, 200.000, wol.supply_rate, wol.inst_rate, 'RA-1: 200 switch/socket points floors 1-4'
FROM bills b JOIN work_orders wo ON wo.id=b.work_order_id
JOIN work_order_lines wol ON wol.work_order_id=wo.id
WHERE b.doc_no='RA/25-26/0003' AND wol.sno=1;

INSERT IGNORE INTO bill_lines (bill_id, wo_line_id, qty, supply_rate, inst_rate, remark)
SELECT b.id, wol.id, 4000.000, wol.supply_rate, wol.inst_rate, 'RA-1: 4000m 2.5mm wiring floors 1-3'
FROM bills b JOIN work_orders wo ON wo.id=b.work_order_id
JOIN work_order_lines wol ON wol.work_order_id=wo.id
WHERE b.doc_no='RA/25-26/0003' AND wol.sno=3;

-- RA4: Prestige Hi-Tech RA-2 (DRAFT)
INSERT INTO bills (doc_no, ra_no, site_id, branch_id, work_order_id, client_id,
                   bill_date, period_from, period_to, status, note, created_by)
SELECT 'RA/25-26/0004', 2,
       (SELECT id FROM sites WHERE code='ST-0004'), 1,
       (SELECT id FROM work_orders WHERE doc_no='WO/25-26/0004'),
       (SELECT client_id FROM sites WHERE code='ST-0004'),
       '2025-09-15', '2025-08-16', '2025-09-15',
       'DRAFT', 'RA-2 draft — LED downlights floors 1-2',
       (SELECT id FROM users WHERE emp_code='E001')
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM bills WHERE doc_no='RA/25-26/0004');

INSERT IGNORE INTO bill_lines (bill_id, wo_line_id, qty, supply_rate, inst_rate, remark)
SELECT b.id, wol.id, 100.000, wol.supply_rate, wol.inst_rate, 'RA-2 DRAFT: 100 LED downlights floors 1-2'
FROM bills b JOIN work_orders wo ON wo.id=b.work_order_id
JOIN work_order_lines wol ON wol.work_order_id=wo.id
WHERE b.doc_no='RA/25-26/0004' AND wol.sno=2;

-- RA5: Embassy Manyata BLR RA-1 (RAISED)
INSERT INTO bills (doc_no, ra_no, site_id, branch_id, work_order_id, client_id,
                   bill_date, period_from, period_to, status, client_ref, note, raised_at, raised_by, created_by)
SELECT 'RA/25-26/0005', 1,
       (SELECT id FROM sites WHERE code='ST-0007'), 2,
       (SELECT id FROM work_orders WHERE doc_no='WO/25-26/0007'),
       (SELECT client_id FROM sites WHERE code='ST-0007'),
       '2025-08-31', '2025-07-05', '2025-08-31',
       'RAISED', 'EMREIT/CERT/2025/007',
       'RA-1: RCCB installation + MCB loading floors B1-B5',
       '2025-08-31 16:00:00',
       (SELECT id FROM users WHERE emp_code='E005'),
       (SELECT id FROM users WHERE emp_code='E001')
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM bills WHERE doc_no='RA/25-26/0005');

INSERT IGNORE INTO bill_lines (bill_id, wo_line_id, qty, supply_rate, inst_rate, remark)
SELECT b.id, wol.id, 80.000, wol.supply_rate, wol.inst_rate, 'RA-1: 80 RCCBs installed floors B1-B5'
FROM bills b JOIN work_orders wo ON wo.id=b.work_order_id
JOIN work_order_lines wol ON wol.work_order_id=wo.id
WHERE b.doc_no='RA/25-26/0005' AND wol.sno=1;

INSERT IGNORE INTO bill_lines (bill_id, wo_line_id, qty, supply_rate, inst_rate, remark)
SELECT b.id, wol.id, 490.000, wol.supply_rate, wol.inst_rate, 'RA-1: 490 MCBs installed floors B1-B5'
FROM bills b JOIN work_orders wo ON wo.id=b.work_order_id
JOIN work_order_lines wol ON wol.work_order_id=wo.id
WHERE b.doc_no='RA/25-26/0005' AND wol.sno=2;

-- RA6: Brigade HYD RA-1 (RAISED)
INSERT INTO bills (doc_no, ra_no, site_id, branch_id, work_order_id, client_id,
                   bill_date, period_from, period_to, status, client_ref, note, raised_at, raised_by, created_by)
SELECT 'RA/25-26/0006', 1,
       (SELECT id FROM sites WHERE code='ST-0002'), 1,
       (SELECT id FROM work_orders WHERE doc_no='WO/25-26/0002'),
       (SELECT client_id FROM sites WHERE code='ST-0002'),
       '2025-09-30', '2025-07-18', '2025-09-30',
       'RAISED', 'BEL/CERT/2025/014',
       'RA-1: Armoured cable pulled + JBs installed B2 to floor 5',
       '2025-09-30 17:00:00',
       (SELECT id FROM users WHERE emp_code='E005'),
       (SELECT id FROM users WHERE emp_code='E001')
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM bills WHERE doc_no='RA/25-26/0006');

INSERT IGNORE INTO bill_lines (bill_id, wo_line_id, qty, supply_rate, inst_rate, remark)
SELECT b.id, wol.id, 380.000, wol.supply_rate, wol.inst_rate, 'RA-1: 380m ARM cable pulled'
FROM bills b JOIN work_orders wo ON wo.id=b.work_order_id
JOIN work_order_lines wol ON wol.work_order_id=wo.id
WHERE b.doc_no='RA/25-26/0006' AND wol.sno=1;

INSERT IGNORE INTO bill_lines (bill_id, wo_line_id, qty, supply_rate, inst_rate, remark)
SELECT b.id, wol.id, 65.000, wol.supply_rate, wol.inst_rate, 'RA-1: 65 JBs installed'
FROM bills b JOIN work_orders wo ON wo.id=b.work_order_id
JOIN work_order_lines wol ON wol.work_order_id=wo.id
WHERE b.doc_no='RA/25-26/0006' AND wol.sno=2;

-- RA7: Salarpuria BLR RA-1 (DRAFT)
INSERT INTO bills (doc_no, ra_no, site_id, branch_id, work_order_id, client_id,
                   bill_date, period_from, period_to, status, note, created_by)
SELECT 'RA/25-26/0007', 1,
       (SELECT id FROM sites WHERE code='ST-0003'), 2,
       (SELECT id FROM work_orders WHERE doc_no='WO/25-26/0003'),
       (SELECT client_id FROM sites WHERE code='ST-0003'),
       '2025-09-30', '2025-08-05', '2025-09-30',
       'DRAFT', 'RA-1 draft — 4C x 16 cable partial pull',
       (SELECT id FROM users WHERE emp_code='E001')
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM bills WHERE doc_no='RA/25-26/0007');

INSERT IGNORE INTO bill_lines (bill_id, wo_line_id, qty, supply_rate, inst_rate, remark)
SELECT b.id, wol.id, 250.000, wol.supply_rate, wol.inst_rate, 'RA-1 DRAFT: 250m 4C x 16 cable'
FROM bills b JOIN work_orders wo ON wo.id=b.work_order_id
JOIN work_order_lines wol ON wol.work_order_id=wo.id
WHERE b.doc_no='RA/25-26/0007' AND wol.sno=1;

SET FOREIGN_KEY_CHECKS = 1;
