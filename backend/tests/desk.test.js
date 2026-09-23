'use strict';
/**
 * My desk. The contract worth locking: every department answers in the
 * same shape, the trends are gap-free, and the site and store desks never
 * carry a rupee figure — a site keeps no rates, and the store sees value
 * only as a whole shelf.
 */
process.env.DB_NAME = process.env.DB_NAME_TEST || 'ajp_erp_test';
// these suites test the documents, not the door: act by X-User-Id
process.env.AUTH = 'off';

const { test, before, after, describe } = require('node:test');
const assert = require('node:assert');
const app = require('../src/app');
const { pool } = require('../src/config/db');
const { setup } = require('../src/db/setup');
const env = require('../src/config/env');
const { resetTransactional } = require('./reset');

let server; let base; let live = false;
const api = (p, o = {}) => fetch(base + p, { ...o,
  headers: { 'Content-Type': 'application/json' },
  body: o.body ? JSON.stringify(o.body) : undefined,
}).then(async (r) => ({ status: r.status, body: await r.json() }));

before(async () => {
  if (!/_test$/.test(env.db.database)) throw new Error('Refusing to run against a working database');
  try { await setup({ quiet: true }); await pool.query('SELECT 1'); live = true; } catch { return; }
  server = app.listen(0);
  base = `http://127.0.0.1:${server.address().port}/api`;
  await resetTransactional(pool);
});
after(async () => { if (server) server.close(); await pool.end(); });

describe('my desk', () => {
  const S = {};

  test('a site and a store to look at', async (t) => {
    if (!live) return t.skip('no database');
    S.site = (await api('/sites', { method: 'POST', body: {
      name: 'Desk Test Site', branchId: 1, clientId: 1, headUserId: 2, keeperUserId: 3, gmUserId: 5 } })).body.id;
    S.store = (await api('/sites/stores', { method: 'POST', body: {
      name: 'Desk Test Store', branchId: 1, keeperUserId: 3 } })).body.id;
  });

  for (const [dept, q, n] of [
    ['plan', '?branchId=1', 12], ['plan', '', 12], ['procure', '', 6],
    ['billing', '?branchId=1', 6], ['reports', '', 6]]) {
    test(`${dept}${q || ' (every branch)'} answers in the desk's shape`, async (t) => {
      if (!live) return t.skip('no database');
      const r = await api(`/desk/${dept}${q}`);
      assert.equal(r.status, 200);
      assert.ok(Array.isArray(r.body.tiles) && r.body.tiles.length > 0);
      assert.ok(Array.isArray(r.body.needs));
      assert.equal(r.body.trends[0].series.length, n, 'gap-free: every bucket present, empty ones as zero');
    });
  }

  test('the site desk needs a site, and carries no money', async (t) => {
    if (!live) return t.skip('no database');
    assert.equal((await api('/desk/site')).status, 400);
    const r = (await api(`/desk/site?siteId=${S.site}`)).body;
    assert.ok(r.tiles.every((x) => !x.money), 'no rupee tile on a site desk');
    assert.ok(r.needs.every((x) => x.amount === undefined), 'and no rupee on any line');
    assert.equal(r.trends[0].unit, 'count');
  });

  test('the store desk counts documents, not rupees', async (t) => {
    if (!live) return t.skip('no database');
    const r = (await api(`/desk/store?storeId=${S.store}`)).body;
    assert.ok(r.tiles.every((x) => !x.money));
    assert.equal(r.trends[0].unit, 'count');
  });

  test('an unknown department is refused', async (t) => {
    if (!live) return t.skip('no database');
    assert.equal((await api('/desk/nonsense')).status, 404);
  });
});
