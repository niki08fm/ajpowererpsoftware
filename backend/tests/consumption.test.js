'use strict';
/**
 * The last hop, end to end.
 *
 * Material is bought, received at the central store, sent to a site
 * and signed for. Only then can it be issued to a person, and only
 * what was issued can come back. What it cost is fixed at the moment
 * it leaves the shelf, and the store changing its buying price
 * afterwards must not move a number that has already been reported.
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

const qtyAt = async (siteId, itemId) => {
  const [[r]] = await pool.query(
    `SELECT COALESCE(SUM(qty), 0) AS qty FROM stock_movements
      WHERE site_id = ? AND item_id = ?`, [siteId, itemId]);
  return Number(r.qty);
};

describe('issue and return', () => {
  const S = {};
  const R = {};

  /* ------------------------------------------------ get material there */
  test('a site with 100 boxes on its shelf, bought at 112', async (t) => {
    if (!live) return t.skip('no database');
    S.box = (await api('/items/search?q=metal%20box')).body[0].id;
    S.plate = (await api('/items/search?q=front%20plate')).body[0].id;

    const site = await api('/sites', { method: 'POST', body: {
      name: 'Gachibowli Tower 4', branchId: 1, clientId: 1,
      headUserId: 2, keeperUserId: 3, gmUserId: 5 } });
    S.site = site.body.id;

    const store = await api('/sites/stores', { method: 'POST', body: {
      name: 'Central Store Hyderabad', branchId: 1, keeperUserId: 3 } });
    S.store = store.body.id;
    await pool.query(`UPDATE sites SET is_central = 1 WHERE id = ?`, [S.store]);

    const wo = await api('/work-orders', { method: 'POST', body: {
      siteId: S.site, woDate: '2026-09-01',
      lines: [{ description: 'Socket point with back box', uom: "No's", qty: 100,
        supplyRate: 900 }] } });
    const prep = await api('/boq/prepare', { method: 'POST', body: {
      workOrderId: wo.body.id } });
    S.boq = prep.body.boqId;
    const sheet = (await api(`/boq/${S.boq}`)).body;
    await api(`/boq/${S.boq}/wo-line/${sheet.woLines[0].wo_line_id}`, { method: 'PUT', body: {
      estQty: 100, items: [{ itemId: S.box, itemQty: 1 }, { itemId: S.plate, itemQty: 1 }] } });
    await api(`/boq/${S.boq}/submit`, { method: 'POST', body: { overAllow: false } });

    const lines = (await api(`/indents/boq/${S.boq}/lines`)).body;
    const box = lines.find((l) => l.item_id === S.box);
    const ind = await api('/indents', { method: 'POST', body: {
      siteId: S.site, indentDate: '2026-09-05',
      lines: [{ boqLineId: box.boq_line_id, qty: 100 }], send: true } });
    await api(`/indents/${ind.body.id}/decide`, { method: 'POST', body: { action: 'APPROVED' } });

    const sup = await api('/suppliers', { method: 'POST', body: { name: 'Polycab Distributors' } });
    const po = await api('/purchase-orders', { method: 'POST', body: {
      supplierId: sup.body.id, indentIds: [ind.body.id], deliverToId: S.store,
      poDate: '2026-09-08', submit: true,
      lines: [{ itemId: S.box, qty: 100, rate: 112, gstRate: 18 }] } });
    S.po = po.body.id;
    await api(`/purchase-orders/${S.po}/decide`, { method: 'POST', body: { action: 'APPROVED' } });

    const pend = (await api(`/purchase-orders/${S.po}/pending`)).body;
    await api(`/purchase-orders/${S.po}/receipts`, { method: 'POST', body: {
      receiptDate: '2026-09-16', lines: [{ poLineId: pend.lines[0].po_line_id, qty: 100 }] } });

    const dc = await api('/challans', { method: 'POST', body: {
      fromSiteId: S.store, toSiteId: S.site, dcDate: '2026-09-20', dispatch: true,
      lines: [{ itemId: S.box, qty: 100 }] } });
    const open = (await api(`/challans/${dc.body.id}/pending`)).body;
    await api(`/challans/${dc.body.id}/acknowledge`, { method: 'POST', body: {
      ackDate: '2026-09-21', lines: [{ dcLineId: open.lines[0].dc_line_id, qty: 100 }] } });

    assert.equal(await qtyAt(S.site, S.box), 100);
  });

  /* ------------------------------------------------------------ issue */
  test('the shelf offers what it holds, priced from the central store', async (t) => {
    if (!live) return t.skip('no database');
    const r = (await api(`/consumption/issuable/${S.site}`)).body;
    const box = r.rows.find((x) => x.item_id === S.box);
    assert.equal(Number(box.on_hand), 100);
    assert.equal(Number(box.rate), 112, 'what the store paid, not what the site guessed');
  });

  test('a site cannot issue what it does not hold', async (t) => {
    if (!live) return t.skip('no database');
    const r = await api('/consumption/issues', { method: 'POST', body: {
      siteId: S.site, usedOn: '2026-09-22', issuedTo: 'Ramesh Kumar',
      lines: [{ itemId: S.box, qty: 140 }] } });
    assert.equal(r.status, 409);
    assert.match(r.body.error.message, /holds 100/);
  });

  test('nor issue an item it has never had', async (t) => {
    if (!live) return t.skip('no database');
    const r = await api('/consumption/issues', { method: 'POST', body: {
      siteId: S.site, usedOn: '2026-09-22', issuedTo: 'Ramesh Kumar',
      lines: [{ itemId: S.plate, qty: 1 }] } });
    assert.equal(r.status, 409);
    assert.match(r.body.error.message, /holds 0/);
  });

  test('nor issue to nobody', async (t) => {
    if (!live) return t.skip('no database');
    const r = await api('/consumption/issues', { method: 'POST', body: {
      siteId: S.site, usedOn: '2026-09-22', issuedTo: '  ',
      lines: [{ itemId: S.box, qty: 10 }] } });
    assert.equal(r.status, 400);
  });

  test('60 go out to Ramesh, and leave the shelf at once', async (t) => {
    if (!live) return t.skip('no database');
    const r = await api('/consumption/issues', { method: 'POST', body: {
      siteId: S.site, usedOn: '2026-09-22', issuedTo: 'Ramesh Kumar',
      purpose: 'Block A first floor', lines: [{ itemId: S.box, qty: 60 }] } });
    assert.equal(r.status, 201);
    S.con = r.body.id;
    assert.match(r.body.docNo, /^CON\/\d\d-\d\d\/0001$/);
    assert.equal(Number(r.body.issuedValue), 60 * 112);
    assert.equal(await qtyAt(S.site, S.box), 40, 'gone from the shelf the moment it was issued');
  });

  test('the same item twice on one slip is a typing mistake', async (t) => {
    if (!live) return t.skip('no database');
    const r = await api('/consumption/issues', { method: 'POST', body: {
      siteId: S.site, usedOn: '2026-09-22', issuedTo: 'Suresh',
      lines: [{ itemId: S.box, qty: 5 }, { itemId: S.box, qty: 5 }] } });
    assert.equal(r.status, 400);
    assert.match(r.body.error.message, /twice/);
  });

  test('a second person takes 25', async (t) => {
    if (!live) return t.skip('no database');
    const r = await api('/consumption/issues', { method: 'POST', body: {
      siteId: S.site, usedOn: '2026-09-24', issuedTo: 'Suresh Babu',
      lines: [{ itemId: S.box, qty: 25 }] } });
    assert.equal(r.status, 201);
    S.con2 = r.body.id;
    assert.equal(await qtyAt(S.site, S.box), 15);
  });

  /* ----------------------------------------------------------- ledger */
  test('the register knows who took what, and what it cost', async (t) => {
    if (!live) return t.skip('no database');
    const r = (await api(`/consumption/issues?siteId=${S.site}`)).body;
    assert.equal(r.rows.length, 2);
    assert.equal(r.totals.people, 2);
    assert.equal(Number(r.totals.qty), 85);
    assert.equal(Number(r.totals.value), 85 * 112);
    assert.equal(r.rows[0].issued_to, 'Suresh Babu', 'newest first');
  });

  test('and can be asked about one person', async (t) => {
    if (!live) return t.skip('no database');
    const r = (await api(`/consumption/issues?siteId=${S.site}&person=ramesh`)).body;
    assert.equal(r.rows.length, 1);
    assert.equal(Number(r.rows[0].issued_qty), 60);
  });

  test('names already used at this site are offered back', async (t) => {
    if (!live) return t.skip('no database');
    const r = (await api(`/consumption/people/${S.site}`)).body;
    assert.deepEqual(r.rows.map((x) => x.name).sort(), ['Ramesh Kumar', 'Suresh Babu']);
  });

  /* ----------------------------------------------------------- return */
  test('what one person has out is what they may hand back', async (t) => {
    if (!live) return t.skip('no database');
    const r = (await api(
      `/consumption/returnable/${S.site}?person=${encodeURIComponent('Ramesh Kumar')}`)).body;
    assert.equal(r.rows.length, 1);
    assert.equal(Number(r.rows[0].open_qty), 60, 'his 60, not Suresh\'s 25');

    const all = (await api(`/consumption/returnable/${S.site}?anyone=true`)).body;
    assert.equal(Number(all.rows[0].open_qty), 85, 'both of them together');
  });

  test('a name nobody has issued to has nothing to give back', async (t) => {
    if (!live) return t.skip('no database');
    const r = (await api(`/consumption/returnable/${S.site}?person=Nobody`)).body;
    assert.equal(r.rows.length, 0);
  });

  test('a person cannot hand back more than they took', async (t) => {
    if (!live) return t.skip('no database');
    const r = await api('/consumption/returns', { method: 'POST', body: {
      siteId: S.site, returnedOn: '2026-09-26', returnedBy: 'Ramesh Kumar',
      lines: [{ itemId: S.box, qty: 70 }] } });
    assert.equal(r.status, 409);
    assert.match(r.body.error.message, /60 was issued to Ramesh Kumar/);
  });

  test('nor material issued to somebody else', async (t) => {
    if (!live) return t.skip('no database');
    const r = await api('/consumption/returns', { method: 'POST', body: {
      siteId: S.site, returnedOn: '2026-09-26', returnedBy: 'Ramesh Kumar',
      lines: [{ itemId: S.box, qty: 80 }] } });
    assert.equal(r.status, 409);
    assert.match(r.body.error.message, /was issued to Ramesh Kumar/);
  });

  test('the return screen is offered only people holding something', async (t) => {
    if (!live) return t.skip('no database');
    const all = (await api(`/consumption/people/${S.site}`)).body;
    assert.deepEqual(all.rows.map((x) => x.name).sort(), ['Ramesh Kumar', 'Suresh Babu'],
      'issuing is offered everyone this site has used before');

    const holding = (await api(
      `/consumption/people/${S.site}?outstanding=true`)).body;
    assert.deepEqual(holding.rows.map((x) => x.name).sort(),
      ['Ramesh Kumar', 'Suresh Babu'], 'both are still holding something');
    assert.ok(holding.rows.every((x) => Number(x.open_qty) > 0));
    assert.ok(holding.rows.every((x) => x.returnable_items >= 1));

    // once somebody has given everything back they drop off that list
    const suresh = holding.rows.find((x) => x.name === 'Suresh Babu');
    await api('/consumption/returns', { method: 'POST', body: {
      siteId: S.site, returnedOn: '2026-09-26', returnedBy: 'Suresh Babu',
      lines: [{ itemId: S.box, qty: suresh.open_qty }] } });

    const after = (await api(
      `/consumption/people/${S.site}?outstanding=true`)).body;
    assert.deepEqual(after.rows.map((x) => x.name), ['Ramesh Kumar'],
      'Suresh has nothing left to return, so he is not offered');
    assert.equal((await api(`/consumption/people/${S.site}`)).body.rows.length, 2,
      'but issuing still knows his name');
  });

  test('Ramesh hands 10 back and the shelf grows again', async (t) => {
    if (!live) return t.skip('no database');
    const before = await qtyAt(S.site, S.box);
    const r = await api('/consumption/returns', { method: 'POST', body: {
      siteId: S.site, returnedOn: '2026-09-26', returnedBy: 'Ramesh Kumar',
      reason: 'over-drawn, not needed', lines: [{ itemId: S.box, qty: 10 }] } });
    assert.equal(r.status, 201);
    assert.match(r.body.docNo, /^RET\/\d\d-\d\d\/000\d$/);
    assert.equal(Number(r.body.returnedValue), 10 * 112,
      'credited at the central store rate on the day it came back');
    assert.equal(await qtyAt(S.site, S.box), before + 10);
  });

  test('and what he may yet return drops by exactly that', async (t) => {
    if (!live) return t.skip('no database');
    const r = (await api(
      `/consumption/returnable/${S.site}?person=${encodeURIComponent('Ramesh Kumar')}`)).body;
    assert.equal(Number(r.rows[0].open_qty), 50, '60 issued, less the 10 he brought back');
  });

  test('the issue slip shows what that person has consumed', async (t) => {
    if (!live) return t.skip('no database');
    const r = (await api(`/consumption/issues/${S.con}`)).body;
    assert.equal(Number(r.head.issued_qty), 60);
    assert.equal(Number(r.withThem[0].open_qty), 50, 'across every slip, not just this one');
  });

  /* ------------------------------------------------------------ money */
  test('consumption is issued less returned, in quantity and in money', async (t) => {
    if (!live) return t.skip('no database');
    const [[r]] = await pool.query(
      `SELECT * FROM v_site_consumption WHERE site_id = ? AND item_id = ?`, [S.site, S.box]);
    assert.equal(Number(r.issued_qty), 85, '60 to Ramesh, 25 to Suresh');
    assert.equal(Number(r.returned_qty), 35, 'Suresh all 25, Ramesh 10');
    assert.equal(Number(r.consumed_qty), 50);
    assert.equal(Number(r.consumed_value), 50 * 112);
  });

  test('a later purchase at a new price does not move what is already spent', async (t) => {
    if (!live) return t.skip('no database');
    // the store buys the same box again, dearer
    await pool.query(
      `INSERT INTO stock_movements (site_id, item_id, qty, rate, kind, moved_on)
       VALUES (?, ?, 50, 128, 'ADJUST', '2026-09-28')`, [S.store, S.box]);

    const [[r]] = await pool.query(
      `SELECT consumed_value FROM v_site_consumption WHERE site_id = ? AND item_id = ?`,
      [S.site, S.box]);
    assert.equal(Number(r.consumed_value), 50 * 112, 'the past is the price it was');

    const offer = (await api(`/consumption/issuable/${S.site}`)).body;
    assert.equal(Number(offer.rows.find((x) => x.item_id === S.box).rate), 128,
      'but the next issue goes out at the new one');
  });

  test('and the new price is what the next issue is stamped with', async (t) => {
    if (!live) return t.skip('no database');
    const r = await api('/consumption/issues', { method: 'POST', body: {
      siteId: S.site, usedOn: '2026-09-29', issuedTo: 'Ramesh Kumar',
      lines: [{ itemId: S.box, qty: 5 }] } });
    assert.equal(Number(r.body.issuedValue), 5 * 128);

    const [[c]] = await pool.query(
      `SELECT consumed_value FROM v_site_consumption WHERE site_id = ? AND item_id = ?`,
      [S.site, S.box]);
    assert.equal(Number(c.consumed_value), 50 * 112 + 5 * 128);
  });

  test('every movement is on the site ledger, both directions', async (t) => {
    if (!live) return t.skip('no database');
    const r = (await api(`/site-store/${S.site}/movements`)).body;
    const kinds = r.rows.map((x) => x.kind);
    assert.ok(kinds.includes('ISSUE'));
    assert.ok(kinds.includes('RETURN'));
    assert.ok(kinds.includes('DC_IN'));
    assert.equal(Number(r.totals.outQty), 90, '60 + 25 + 5 issued');
  });

  /* ============================================================
     The costing rule, worked through end to end.

       a day's cost for an item  =  that day's net quantity
                                    x the central store's rate that day
       cost to date              =  those days added up

     Two switches out and one back on a ten-rupee day is ten rupees.
     Ten out and four back on an eleven-rupee day is sixty-six. The
     rate that matters is the one in force when the material moved,
     which is why both sides of a day are struck at the same price
     and why a rate is read as at the document's date, never as at
     now.
     ============================================================ */
  test('day one: 2 out, 1 back, at 10 — costs 10', async (t) => {
    if (!live) return t.skip('no database');
    const site = await api('/sites', { method: 'POST', body: {
      name: 'Rate Rule Site', branchId: 1, clientId: 1,
      headUserId: 2, keeperUserId: 3, gmUserId: 5 } });
    R.site = site.body.id;
    R.switch = (await api('/items/search?q=metal%20box')).body[0].id;
    R.cable = (await api('/items/search?q=front%20plate')).body[0].id;

    // the central store buys switches at 10 on day one, 11 on day two
    for (const [on, rate] of [['2026-10-01', 10], ['2026-10-02', 11]]) {
      await pool.query(
        `INSERT INTO stock_movements (site_id, item_id, qty, rate, kind, ref_no, moved_on)
         VALUES (?, ?, 500, ?, 'GRN', 'RATE', ?)`, [S.store, R.switch, rate, on]);
    }
    // and cable at 7 on day two
    await pool.query(
      `INSERT INTO stock_movements (site_id, item_id, qty, rate, kind, ref_no, moved_on)
       VALUES (?, ?, 500, 7, 'GRN', 'RATE', '2026-10-02')`, [S.store, R.cable]);
    // the site is given plenty of both
    for (const item of [R.switch, R.cable]) {
      await pool.query(
        `INSERT INTO stock_movements (site_id, item_id, qty, rate, kind, ref_no, moved_on)
         VALUES (?, ?, 500, 0, 'DC_IN', 'RATE', '2026-10-01')`, [R.site, item]);
    }

    const out = await api('/consumption/issues', { method: 'POST', body: {
      siteId: R.site, usedOn: '2026-10-01', issuedTo: 'Day One',
      lines: [{ itemId: R.switch, qty: 2 }] } });
    assert.equal(Number(out.body.issuedValue), 20, '2 at 10');

    const back = await api('/consumption/returns', { method: 'POST', body: {
      siteId: R.site, returnedOn: '2026-10-01', returnedBy: 'Day One',
      lines: [{ itemId: R.switch, qty: 1 }] } });
    assert.equal(Number(back.body.returnedValue), 10, 'credited at the same day\'s 10');

    const day = (await api(
      `/tracking/consumed?siteId=${R.site}&from=2026-10-01&to=2026-10-01`)).body;
    assert.equal(Number(day.totals.consumedQty), 1);
    assert.equal(Number(day.totals.consumedValue), 10, '(2 - 1) x 10');
  });

  test('day two: 10 out, 4 back at 11, plus 5 cable — costs 66 + 35', async (t) => {
    if (!live) return t.skip('no database');
    const out = await api('/consumption/issues', { method: 'POST', body: {
      siteId: R.site, usedOn: '2026-10-02', issuedTo: 'Day Two',
      lines: [{ itemId: R.switch, qty: 10 }, { itemId: R.cable, qty: 5 }] } });
    assert.equal(Number(out.body.issuedValue), 10 * 11 + 5 * 7,
      'each item at its own rate that day');

    const back = await api('/consumption/returns', { method: 'POST', body: {
      siteId: R.site, returnedOn: '2026-10-02', returnedBy: 'Day Two',
      lines: [{ itemId: R.switch, qty: 4 }] } });
    assert.equal(Number(back.body.returnedValue), 4 * 11,
      'the price that day, not the price it went out at yesterday');

    const day = (await api(
      `/tracking/consumed?siteId=${R.site}&from=2026-10-02&to=2026-10-02`)).body;
    assert.equal(Number(day.totals.consumedValue), 6 * 11 + 5 * 7, '6 x 11 + 5 x 7');
  });

  test('and the total to date is those days added up', async (t) => {
    if (!live) return t.skip('no database');
    const all = (await api(`/tracking/consumed?siteId=${R.site}`)).body;
    assert.equal(Number(all.totals.consumedValue), 10 + 6 * 11 + 5 * 7);

    // the same number arrived at from the other end: the window from
    // day two onward, plus everything before it
    const two = (await api(`/tracking/consumed?siteId=${R.site}&from=2026-10-02`)).body;
    assert.equal(Number(two.totals.beforeWindowValue), 10);
    assert.equal(Number(two.totals.consumedValue), 6 * 11 + 5 * 7);
    assert.equal(Number(two.totals.toDateValue), 10 + 6 * 11 + 5 * 7);

    // and the running total on the chart ends on it
    const series = (await api(`/tracking/consumed?siteId=${R.site}&bucket=day`)).body.series;
    assert.equal(
      Number(series[series.length - 1].running_value), 10 + 6 * 11 + 5 * 7);
  });

  test('a rate is read as at the document, so yesterday stays yesterday', async (t) => {
    if (!live) return t.skip('no database');
    // the store buys dearer today
    await pool.query(
      `INSERT INTO stock_movements (site_id, item_id, qty, rate, kind, ref_no, moved_on)
       VALUES (?, ?, 100, 19, 'GRN', 'RATE', '2026-10-09')`, [S.store, R.switch]);

    // a slip written up late, dated day two, still prices at 11
    const late = await api('/consumption/issues', { method: 'POST', body: {
      siteId: R.site, usedOn: '2026-10-02', issuedTo: 'Late Entry',
      lines: [{ itemId: R.switch, qty: 3 }] } });
    assert.equal(Number(late.body.issuedValue), 3 * 11, 'not 3 x 19');

    // and what the screen offers quotes the same number it will stamp
    const offer = (await api(
      `/consumption/issuable/${R.site}?asOf=2026-10-02`)).body;
    assert.equal(Number(offer.rows.find((x) => x.item_id === R.switch).rate), 11);
    const now = (await api(`/consumption/issuable/${R.site}`)).body;
    assert.equal(Number(now.rows.find((x) => x.item_id === R.switch).rate), 19);
  });
});
