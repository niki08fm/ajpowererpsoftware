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
router.use('/consumption', require('../modules/consumption.routes'));
router.use('/progress',    require('../modules/progress.routes'));

module.exports = router;
