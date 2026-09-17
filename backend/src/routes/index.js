'use strict';
const router = require('express').Router();
const { currentUser, listUsers } = require('../middleware/currentUser');
const { wrap } = require('../middleware/validate');

// no login yet — this only decides whose name goes on a document
router.use(currentUser);

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
router.use('/grns',        require('../modules/grn.routes'));
router.use('/site-store',  require('../modules/sitestore.routes'));
router.use('/consumption', require('../modules/consumption.routes'));
router.use('/tracking',    require('../modules/tracking.routes'));
router.use('/expenses',    require('../modules/expenses.routes'));
router.use('/costs',       require('../modules/costs.routes'));
router.use('/bills',       require('../modules/bills.routes'));

module.exports = router;
