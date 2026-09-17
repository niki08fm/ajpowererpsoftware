-- Reference data. Safe to re-run.
INSERT INTO branches (code, name, gstin, address) VALUES
  ('HYD', 'Hyderabad', '36AAAAA0000A1Z5', 'Hyderabad, Telangana'),
  ('BLR', 'Bengaluru', '29AAAAA0000A1Z5', 'Bengaluru, Karnataka')
ON DUPLICATE KEY UPDATE name = VALUES(name);

-- People. 'department' is a label only — nothing checks it yet.
INSERT INTO users (emp_code, name, email, department) VALUES
  ('E001', 'Suresh Rao',     'suresh@ajpower.test',   'Planning'),
  ('E002', 'Ravi Kumar',     'ravi@ajpower.test',     'Site'),
  ('E003', 'Imran Sheikh',   'imran@ajpower.test',    'Store'),
  ('E004', 'Vikram Nair',    'vikram@ajpower.test',   'Site'),
  ('E005', 'Anil Menon',     'anil@ajpower.test',     'Management'),
  ('E006', 'Priya Sharma',   'priya@ajpower.test',    'Procurement'),
  ('E007', 'Rajesh Pillai',  'rajesh@ajpower.test',   'Billing')
ON DUPLICATE KEY UPDATE name = VALUES(name), department = VALUES(department);

INSERT INTO clients (branch_id, name, norm_key, sort_key, gstin, address) VALUES
  ((SELECT id FROM branches WHERE code='HYD'), 'GMR Infrastructure Ltd',
   'gmr infrastructure ltd', 'gmr infrastructure ltd', '36AABCG0000A1Z5', 'Shamshabad, Hyderabad'),
  ((SELECT id FROM branches WHERE code='HYD'), 'Brigade Enterprises Ltd',
   'brigade enterprises ltd', 'brigade enterprises ltd', '36AABCB0000A1Z5', 'Nanakramguda, Hyderabad'),
  ((SELECT id FROM branches WHERE code='BLR'), 'Salarpuria Sattva Group',
   'group salarpuria sattva', 'group salarpuria sattva', '29AABCS0000A1Z5', 'Bengaluru')
ON DUPLICATE KEY UPDATE name = VALUES(name);
