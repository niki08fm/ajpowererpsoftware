'use strict';
const router = require('express').Router();
const { currentUser, listUsers } = require('../middleware/currentUser');
const { wrap } = require('../middleware/validate');
const env = require('../config/env');
const access = require('../lib/access');
const { publicAuth, signedInAuth } = require('../modules/auth.routes');

// the one door that opens without a session
router.use('/auth', publicAuth);

// everything after this knows who is asking, and — with logins on —
// what their role lets them see and do (lib/access.js)
router.use(currentUser);
if (env.auth) router.use(access.enforce);

router.use('/auth', signedInAuth);
router.use('/admin', require('../modules/admin.routes'));

router.get('/whoami', (req, res) => res.json(req.user));
router.get('/users', wrap(async (_req, res) => res.json(await listUsers())));

router.use('/masters',     require('../modules/masters.routes'));
router.use('/items',       require('../modules/items.routes'));
router.use('/sites',       require('../modules/sites.routes'));
router.use('/work-orders', require('../modules/workorders.routes'));
router.use('/boq',         require('../modules/boq.routes'));
router.use('/indents',     require('../modules/indents.routes'));
router.use('/progress',    require('../modules/progress.routes'));
router.use('/suppliers',   require('../modules/suppliers.routes'));
router.use('/procurement', require('../modules/procurement.routes'));
router.use('/purchase-orders', require('../modules/purchaseorders.routes'));
router.use('/comparisons', require('../modules/comparisons.routes'));
router.use('/store',       require('../modules/store.routes'));
router.use('/challans',    require('../modules/challans.routes'));
router.use('/transfers',   require('../modules/transfers.routes'));
router.use('/approvals',   require('../modules/approvals.routes'));
router.use('/desk',        require('../modules/desk.routes'));
router.use('/grns',        require('../modules/grn.routes'));
router.use('/site-store',  require('../modules/sitestore.routes'));
router.use('/consumption', require('../modules/consumption.routes'));
router.use('/tracking',    require('../modules/tracking.routes'));
router.use('/expenses',    require('../modules/expenses.routes'));
router.use('/costs',       require('../modules/costs.routes'));
router.use('/bills',       require('../modules/bills.routes'));
router.use('/alerts',      require('../modules/alerts.routes'));

module.exports = router;
