'use strict';
/**
 * The three tracking screens read one ledger. These tests are mostly
 * about that: the same movements, sliced three ways, must agree.
 */
process.env.DB_NAME = process.env.DB_NAME_TEST || 'ajp_erp_test';

const { test, before, after, describe } = require('node:test');
const assert = require('node:assert');
const app = require('../src/app');
const { pool } = require('../src/config/db');
const { setup } = require('../src/db/setup');
const env = require('../src/config/env');
const { resetTransactional } = require('./reset');

let server; let base; let live = false;
const api = (path, opts = {}) =>
  fetch(base + path, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  }).then(async (r) => ({ status: r.status, body: await r.json() }));

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

describe('tracking', () => {
  const S = {};

  test('a site with material on it, issued to two people', async (t) => {
    if (!live) return t.skip('no database');
    S.box = (await api('/items/search?q=metal%20box')).body[0].id;
    S.plate = (await api('/items/search?q=front%20plate')).body[0].id;

    const site = await api('/sites', { method: 'POST', body: {
      name: 'Kondapur Phase 1', branchId: 1, clientId: 1,
      headUserId: 2, keeperUserId: 3, gmUserId: 5 } });
    S.site = site.body.id;
    const store = await api('/sites/stores', { method: 'POST', body: {
      name: 'Central Store Hyderabad', branchId: 1, keeperUserId: 3 } });
    S.store = store.body.id;
    await pool.query(`UPDATE sites SET is_central = 1 WHERE id = ?`, [S.store]);

    // put stock straight on both shelves; the long way round is
    // covered by the procurement suite and is not what this tests
    for (const [siteId, itemId, q, rate, on] of [
      [S.store, S.box, 200, 112, '2026-07-05'],
      [S.site, S.box, 100, 112, '2026-07-10'],
      [S.site, S.plate, 60, 40, '2026-08-12'],
    ]) {
      await pool.query(
        `INSERT INTO stock_movements (site_id, item_id, qty, rate, kind, ref_no, moved_on)
         VALUES (?, ?, ?, ?, 'GRN', 'SEED', ?)`, [siteId, itemId, q, rate, on]);
    }

    for (const [who, itemId, q, on] of [
      ['Ramesh Kumar', S.box, 40, '2026-07-20'],
      ['Ramesh Kumar', S.plate, 25, '2026-08-15'],
      ['Suresh Babu', S.box, 30, '2026-08-18'],
      ['Suresh Babu', S.plate, 10, '2026-09-02'],
    ]) {
      const r = await api('/consumption/issues', { method: 'POST', body: {
        siteId: S.site, usedOn: on, issuedTo: who, lines: [{ itemId, qty: q }] } });
      assert.equal(r.status, 201);
    }
    const back = await api('/consumption/returns', { method: 'POST', body: {
      siteId: S.site, returnedOn: '2026-09-05', returnedBy: 'Ramesh Kumar',
      lines: [{ itemId: S.box, qty: 10 }] } });
    assert.equal(back.status, 201);
  });

  /* --------------------------------------------------- transactions */
  test('transactions show every kind of movement', async (t) => {
    if (!live) return t.skip('no database');
    const r = (await api('/tracking/transactions?branchId=1')).body;
    const kinds = new Set(r.rows.map((x) => x.kind));
    assert.ok(kinds.has('ISSUE') && kinds.has('RETURN') && kinds.has('GRN'));
    assert.equal(r.totals.moves, 8, '3 seeded in, 4 issues out, 1 return in');
    assert.equal(Number(r.totals.outQty), 105, '40 + 25 + 30 + 10');
    assert.equal(Number(r.totals.inQty), 370, '200 + 100 + 60 seeded, plus 10 back');
  });

  test('and can be narrowed to one kind, one site, one window', async (t) => {
    if (!live) return t.skip('no database');
    const issues = (await api('/tracking/transactions?branchId=1&kind=ISSUE')).body;
    assert.equal(issues.totals.moves, 4);

    const store = (await api(`/tracking/transactions?siteId=${S.store}`)).body;
    assert.equal(store.totals.moves, 1, 'the store was only ever seeded');

    const august = (await api(
      '/tracking/transactions?branchId=1&from=2026-08-01&to=2026-08-31')).body;
    assert.equal(august.totals.moves, 3, 'one seed and two issues fall in August');
  });

  test('asking for a person narrows to what they touched', async (t) => {
    if (!live) return t.skip('no database');
    const r = (await api('/tracking/transactions?branchId=1&person=ramesh')).body;
    assert.equal(r.totals.moves, 3, 'two issues and one return');
    assert.ok(r.rows.every((x) => ['ISSUE', 'RETURN'].includes(x.kind)));
    assert.ok(r.rows.every((x) => /Ramesh/.test(x.person)));
  });

  test('the kinds list offers only what is actually there', async (t) => {
    if (!live) return t.skip('no database');
    const r = (await api('/tracking/transactions/kinds?branchId=1')).body;
    assert.deepEqual(r.map((x) => x.kind).sort(), ['GRN', 'ISSUE', 'RETURN']);
  });

  /* --------------------------------------------------- audit: item */
  test('an item tells you everywhere it has been', async (t) => {
    if (!live) return t.skip('no database');
    const r = (await api(`/tracking/audit/item/${S.box}?branchId=1`)).body;
    assert.equal(r.item.code.slice(0, 3).length, 3);
    assert.equal(r.balances.length, 2, 'the store and the site both hold some');
    assert.equal(Number(r.totals.onHand), 200 + 40, 'store 200, site 100 - 70 + 10');
    assert.equal(Number(r.totals.consumedQty), 60, '40 + 30 issued, 10 back');
    assert.equal(Number(r.totals.consumedValue), 60 * 112);
  });

  test('and who has had it, and how much they still have', async (t) => {
    if (!live) return t.skip('no database');
    const r = (await api(`/tracking/audit/item/${S.box}?branchId=1`)).body;
    const ramesh = r.people.find((p) => p.person === 'Ramesh Kumar');
    assert.equal(Number(ramesh.issued_qty), 40);
    assert.equal(Number(ramesh.returned_qty), 10);
    assert.equal(Number(ramesh.net_qty), 30);
    assert.equal(Number(r.people.find((p) => p.person === 'Suresh Babu').net_qty), 30);
  });

  test('a balance is as at today, whatever window is asked for', async (t) => {
    if (!live) return t.skip('no database');
    const r = (await api(
      `/tracking/audit/item/${S.box}?branchId=1&from=2026-09-01&to=2026-09-30`)).body;
    assert.equal(r.moves.length, 1, 'only the return falls in September');
    assert.equal(Number(r.totals.onHand), 240, 'but what is held is still what is held');
  });

  /* ------------------------------------------------- audit: person */
  test('the people list ranks who has cost the most', async (t) => {
    if (!live) return t.skip('no database');
    const r = (await api('/tracking/audit/people?branchId=1')).body;
    assert.equal(r.rows.length, 2);
    assert.equal(r.rows[0].person, 'Ramesh Kumar', '40 boxes and 25 plates is the dearest');
    assert.equal(Number(r.rows[0].issued_value), 40 * 112 + 25 * 40);
    assert.equal(Number(r.rows[0].returned_value), 10 * 112);
    assert.equal(Number(r.rows[0].net_value), 30 * 112 + 25 * 40);
  });

  test('a person lists every line with its date', async (t) => {
    if (!live) return t.skip('no database');
    const r = (await api('/tracking/audit/person?name=Ramesh&branchId=1')).body;
    assert.equal(r.totals.issues, 2);
    assert.equal(r.totals.returns, 1);
    assert.equal(r.lines.length, 3);
    assert.equal(r.lines[0].event_date, '2026-09-05', 'newest first');
    assert.equal(r.lines[0].source, 'RETURN');
    assert.ok(r.lines.every((l) => l.doc_no && l.event_date && l.item_code));
  });

  test('a partial name finds them', async (t) => {
    if (!live) return t.skip('no database');
    const r = (await api('/tracking/audit/person?name=ram&branchId=1')).body;
    assert.equal(r.spellings.length, 1);
    assert.equal(r.spellings[0].person, 'Ramesh Kumar');
  });

  test('typing his name in lower case is still him', async (t) => {
    if (!live) return t.skip('no database');
    // the database collates case-insensitively, so "ramesh kumar" and
    // "Ramesh Kumar" are one person everywhere — which is what anyone
    // would expect, and worth a test so a future collation change
    // cannot quietly split somebody in two
    await api('/consumption/issues', { method: 'POST', body: {
      siteId: S.site, usedOn: '2026-09-06', issuedTo: 'ramesh kumar',
      lines: [{ itemId: S.plate, qty: 2 }] } });
    const r = (await api(
      '/tracking/audit/person?name=Ramesh%20Kumar&branchId=1&exact=true')).body;
    assert.equal(r.spellings.length, 1, 'one person, not two');
    assert.equal(r.totals.lines, 4, 'and the lower-case issue counts as his');
  });

  test('a genuinely different spelling is shown rather than merged', async (t) => {
    if (!live) return t.skip('no database');
    await api('/consumption/issues', { method: 'POST', body: {
      siteId: S.site, usedOn: '2026-09-07', issuedTo: 'R Kumar',
      lines: [{ itemId: S.plate, qty: 1 }] } });
    const r = (await api('/tracking/audit/person?name=Kumar&branchId=1')).body;
    assert.equal(r.spellings.length, 2, 'the audit says which names it swept up');
    assert.ok(r.spellings.some((x) => x.person === 'R Kumar'));
    assert.ok(r.spellings.some((x) => x.person === 'Ramesh Kumar'));

    const exact = (await api(
      '/tracking/audit/person?name=Ramesh%20Kumar&branchId=1&exact=true')).body;
    assert.equal(exact.spellings.length, 1, 'and exact keeps them apart');
  });

  test('what one person has consumed is broken down per item', async (t) => {
    if (!live) return t.skip('no database');
    const r = (await api(
      '/tracking/audit/person?name=Ramesh%20Kumar&branchId=1&exact=true')).body;
    const box = r.byItem.find((x) => x.item_id === S.box);
    assert.equal(Number(box.issued_qty), 40);
    assert.equal(Number(box.returned_qty), 10);
    assert.equal(Number(box.net_qty), 30);
  });

  /* -------------------------------------------------- consumption */
  test('consumption is issued less returned, over a window', async (t) => {
    if (!live) return t.skip('no database');
    const r = (await api(`/tracking/consumed?siteId=${S.site}`)).body;
    const box = r.rows.find((x) => x.item_id === S.box);
    assert.equal(Number(box.issued_qty), 70);
    assert.equal(Number(box.returned_qty), 10);
    assert.equal(Number(box.consumed_qty), 60);
    assert.equal(Number(box.consumed_value), 60 * 112);
    assert.equal(Number(box.people), 2);
  });

  test('a window shows only its own, and still knows the total to date', async (t) => {
    if (!live) return t.skip('no database');
    const all = (await api(`/tracking/consumed?siteId=${S.site}`)).body;
    const sept = (await api(
      `/tracking/consumed?siteId=${S.site}&from=2026-09-01&to=2026-09-30`)).body;

    assert.ok(Number(sept.totals.consumedValue) < Number(all.totals.consumedValue));
    assert.equal(
      Number(sept.totals.toDateValue),
      Number(all.totals.consumedValue),
      'the window plus everything before it is everything'
    );
    assert.equal(
      Math.round(Number(sept.totals.beforeWindowValue) + Number(sept.totals.consumedValue)),
      Math.round(Number(sept.totals.toDateValue))
    );
  });

  test('the series runs in order and its running total lands on the answer', async (t) => {
    if (!live) return t.skip('no database');
    const r = (await api(`/tracking/consumed?siteId=${S.site}&bucket=month`)).body;
    assert.ok(r.series.length >= 3, 'July, August, September');
    const dates = r.series.map((s) => s.bucket);
    assert.deepEqual([...dates].sort(), dates, 'oldest first, so a line can be drawn');
    assert.equal(
      Number(r.series[r.series.length - 1].running_value),
      Number(r.totals.consumedValue),
      'the last point of the running total is the total'
    );
  });

  test('a return shows up as a credit in its own month', async (t) => {
    if (!live) return t.skip('no database');
    const r = (await api(`/tracking/consumed?siteId=${S.site}&bucket=month`)).body;
    const sept = r.series.find((s) => s.bucket.startsWith('2026-09'));
    assert.equal(Number(sept.returned_value), 10 * 112);
  });

  test('all three screens agree with each other', async (t) => {
    if (!live) return t.skip('no database');
    const consumed = (await api(`/tracking/consumed?siteId=${S.site}`)).body;
    const people = (await api(`/tracking/audit/people?siteId=${S.site}`)).body;
    const item = (await api(`/tracking/audit/item/${S.box}?siteId=${S.site}`)).body;

    assert.equal(
      Math.round(Number(consumed.totals.consumedValue)),
      Math.round(Number(people.totals.netValue)),
      'what the site consumed is what its people net took'
    );
    const box = consumed.rows.find((x) => x.item_id === S.box);
    assert.equal(
      Number(box.consumed_value), Number(item.totals.consumedValue),
      'and one item reads the same from either direction'
    );
  });
});
