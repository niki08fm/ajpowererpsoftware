'use strict';
/**
 * The approvals inbox.
 *
 * Its whole job is routing: each person is shown only what is theirs to
 * decide, oldest on their desk first, and a decision taken anywhere —
 * here or on the document's own screen — takes it off the list and puts
 * it in the decider's history.
 */
process.env.DB_NAME = process.env.DB_NAME_TEST || 'ajp_erp_test';

const { test, before, after, describe } = require('node:test');
const assert = require('node:assert');
const app = require('../src/app');
const { pool } = require('../src/config/db');
const { setup } = require('../src/db/setup');
const env = require('../src/config/env');
const { resetTransactional } = require('./reset');
const { signOff, signOnce } = require('./sign');

let server; let base; let live = false;
// every call names who is asking, because that is what decides the inbox
const as = (userId) => (path, opts = {}) =>
  fetch(base + path, {
    ...opts,
    // a caller may still name somebody else for one call — signing a
    // document twice needs two different people
    headers: { 'Content-Type': 'application/json', 'X-User-Id': String(userId),
      ...(opts.headers || {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  }).then(async (r) => ({ status: r.status, body: await r.json() }));

// seeded people: 2 Ravi (Site), 3 Imran (Store), 5 Anil (Management)
const RAVI = 2; const IMRAN = 3; const ANIL = 5;
const today = () => new Date().toISOString().slice(0, 10);

before(async () => {
  if (!/_test$/.test(env.db.database)) {
    throw new Error(`Refusing to run against "${env.db.database}" — it is not a test database.`);
  }
  try { await setup({ quiet: true }); await pool.query('SELECT 1'); live = true; } catch { return; }
  server = app.listen(0);
  base = `http://127.0.0.1:${server.address().port}/api`;
  await resetTransactional(pool);
});
after(async () => { if (server) server.close(); await pool.end(); });

async function siteWithBoq(api, name, gmUserId, itemId) {
  const s = (await api('/sites', { method: 'POST', body: {
    name, branchId: 1, clientId: 1, headUserId: RAVI, keeperUserId: IMRAN, gmUserId } })).body;
  const wo = (await api('/work-orders', { method: 'POST', body: { siteId: s.id, woDate: today(),
    lines: [{ description: `${name} scope`, uom: "No's", qty: 50, supplyRate: 100 }] } })).body;
  const prep = (await api('/boq/prepare', { method: 'POST', body: { workOrderId: wo.id } })).body;
  const sheet = (await api(`/boq/${prep.boqId}`)).body;
  await api(`/boq/${prep.boqId}/wo-line/${sheet.woLines[0].wo_line_id}`, { method: 'PUT', body: {
    estQty: 50, items: [{ itemId, itemQty: 1 }] } });
  await api(`/boq/${prep.boqId}/submit`, { method: 'POST', body: {} });
  // the site's own GM signs first, then Management
  await signOff(api, `/boq/${prep.boqId}/decide`, {}, gmUserId);
  const line = (await api(`/indents/boq/${prep.boqId}/lines`)).body[0];
  return { id: s.id, boqLineId: line.boq_line_id };
}

describe('approvals inbox', () => {
  const S = {};

  test('two sites with different GMs, each with a PRN waiting', async (t) => {
    if (!live) return t.skip('no database');
    const api = as(ANIL);
    const box = (await api('/items/search?q=metal%20box')).body[0].id;
    S.a = await siteWithBoq(api, 'Anil GM Site', ANIL, box);
    S.b = await siteWithBoq(api, 'Imran GM Site', IMRAN, box);
    for (const [key, site] of [['prnA', S.a], ['prnB', S.b]]) {
      const r = await api('/indents', { method: 'POST', body: {
        siteId: site.id, indentDate: today(), lines: [{ boqLineId: site.boqLineId, qty: 5 }], send: true } });
      assert.equal(r.status, 201);
      S[key] = r.body.id;
    }
    S.cat = (await api('/expenses/categories')).body[0].id;
    const e = await api('/expenses', { method: 'POST', body: {
      siteId: S.a.id, categoryId: S.cat, spentOn: today(), description: 'Diesel for the generator',
      amount: 1500, send: true } });
    assert.equal(e.status, 201);
    S.exp = e.body.id;
  });

  test('each GM sees only their own site', async (t) => {
    if (!live) return t.skip('no database');
    const anil = (await as(ANIL)('/approvals')).body;
    const imran = (await as(IMRAN)('/approvals')).body;
    const anilPrns = anil.rows.filter((r) => r.type === 'PRN').map((r) => r.id);
    const imranPrns = imran.rows.filter((r) => r.type === 'PRN').map((r) => r.id);
    assert.deepEqual(anilPrns, [S.prnA], "Anil is GM of site A, so only A's PRN");
    assert.deepEqual(imranPrns, [S.prnB], "Imran is GM of site B, so only B's PRN");
    assert.ok(anil.rows.some((r) => r.type === 'EXPENSE' && r.id === S.exp), 'the claim goes to its GM');
    assert.ok(!imran.rows.some((r) => r.type === 'EXPENSE'), 'and to nobody else');
  });

  test('someone with nothing routed to them sees nothing', async (t) => {
    if (!live) return t.skip('no database');
    const ravi = (await as(RAVI)('/approvals')).body;
    assert.equal(ravi.rows.length, 0, 'raising a PRN does not make you its approver');
    assert.equal((await as(RAVI)('/approvals/count')).body.waiting, 0);
  });

  test('oldest on the desk first, measured from when it arrived', async (t) => {
    if (!live) return t.skip('no database');
    // the claim has been sitting with Anil for four days
    await pool.query(
      'UPDATE site_expenses SET submitted_at = NOW() - INTERVAL 4 DAY WHERE id = ?', [S.exp]);
    const anil = (await as(ANIL)('/approvals')).body;
    assert.equal(anil.rows[0].type, 'EXPENSE', 'the four-day-old one leads');
    assert.equal(anil.rows[0].daysWaiting, 4);
    assert.equal(anil.totals.overTwoDays, 1);
    assert.equal(anil.totals.oldestDays, 4);
  });

  test('a decision takes it off the list and into the decider’s history', async (t) => {
    if (!live) return t.skip('no database');
    const r = await as(ANIL)(`/indents/${S.prnA}/decide`, { method: 'POST',
      body: { action: 'APPROVED' } });
    assert.equal(r.status, 200);

    const anil = (await as(ANIL)('/approvals')).body;
    assert.ok(!anil.rows.some((x) => x.type === 'PRN' && x.id === S.prnA), 'gone from waiting');

    const decided = (await as(ANIL)('/approvals/decided')).body.rows;
    const mine = decided.find((x) => x.type === 'PRN' && x.id === S.prnA);
    assert.ok(mine, 'and in what Anil has decided');
    assert.equal(mine.action, 'APPROVED');

    const imranDecided = (await as(IMRAN)('/approvals/decided')).body.rows;
    assert.ok(!imranDecided.some((x) => x.id === S.prnA), 'not in anyone else’s history');
  });

  test('a part-approved claim shows what was allowed', async (t) => {
    if (!live) return t.skip('no database');
    const r = await as(ANIL)(`/expenses/${S.exp}/decide`, { method: 'POST',
      body: { action: 'APPROVED', amount: 1000, note: 'Only one can was for this site' } });
    assert.equal(r.status, 200);
    const row = (await as(ANIL)('/approvals/decided')).body.rows.find((x) => x.type === 'EXPENSE');
    assert.equal(row.amount, 1000);
  });

  test('the count is the badge on the rail', async (t) => {
    if (!live) return t.skip('no database');
    assert.equal((await as(IMRAN)('/approvals/count')).body.waiting, 1, "B's PRN is still with Imran");
    assert.equal((await as(ANIL)('/approvals/count')).body.waiting, 0, 'Anil has cleared his desk');
  });
});
