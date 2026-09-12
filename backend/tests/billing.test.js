'use strict';
/**
 * Billing, and the profit and loss it unlocks.
 *
 * The hard part is the running total: RA 2 must know what RA 1 billed,
 * nothing may be billed twice, and a draft must never be revenue.
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

describe('billing', () => {
  const S = {};

  test('a site with a work order and a BOQ', async (t) => {
    if (!live) return t.skip('no database');
    S.box = (await api('/items/search?q=metal%20box')).body[0].id;
    S.plate = (await api('/items/search?q=front%20plate')).body[0].id;

    const site = await api('/sites', { method: 'POST', body: {
      name: 'Billing Tower', branchId: 1, clientId: 1,
      headUserId: 2, keeperUserId: 3, gmUserId: 5 } });
    S.site = site.body.id;

    const wo = await api('/work-orders', { method: 'POST', body: {
      siteId: S.site, woDate: '2026-09-01', clientWoNo: 'GMR/WO/221',
      lines: [
        { description: 'Socket point with back box', uom: "No's", qty: 100,
          supplyRate: 700, instRate: 200 },
        { description: 'Light point wiring', uom: "No's", qty: 50,
          supplyRate: 400, instRate: 100 },
      ] } });
    S.wo = wo.body.id;

    const prep = await api('/boq/prepare', { method: 'POST', body: { workOrderId: S.wo } });
    S.boq = prep.body.boqId;
    const sheet = (await api(`/boq/${S.boq}`)).body;
    S.wl1 = sheet.woLines[0].wo_line_id;
    S.wl2 = sheet.woLines[1].wo_line_id;

    await api(`/boq/${S.boq}/wo-line/${S.wl1}`, { method: 'PUT', body: {
      estQty: 100, items: [{ itemId: S.box, itemQty: 1 }, { itemId: S.plate, itemQty: 2 }] } });
    await api(`/boq/${S.boq}/wo-line/${S.wl2}`, { method: 'PUT', body: {
      estQty: 50, items: [{ itemId: S.box, itemQty: 1 }] } });
    await api(`/boq/${S.boq}/submit`, { method: 'POST', body: { overAllow: false } });
  });

  /* ------------------------------------------------------- the sheet */
  test('the sheet is one row per work order line, in the client\'s units', async (t) => {
    if (!live) return t.skip('no database');
    const r = (await api(`/bills/sheet/${S.site}`)).body;
    assert.equal(r.lines.length, 2);
    const l1 = r.lines[0];
    assert.equal(l1.description, 'Socket point with back box');
    assert.equal(Number(l1.boq_qty), 100);
    assert.equal(Number(l1.rate), 900, 'supply 700 plus installation 200');
    assert.equal(Number(l1.billed_qty), 0);
    assert.equal(Number(l1.to_bill_qty), 100);
    assert.equal(Number(r.totals.contractValue), 100 * 900 + 50 * 500);
    assert.equal(r.nextRaNo, 1);
  });

  test('indented is shown in the client\'s units, not the store\'s', async (t) => {
    if (!live) return t.skip('no database');
    const lines = (await api(`/indents/boq/${S.boq}/lines`)).body;
    const box1 = lines.find((l) => l.item_id === S.box && l.wo_line_id === S.wl1);
    const plate1 = lines.find((l) => l.item_id === S.plate && l.wo_line_id === S.wl1);

    // 80 boxes and 120 plates: enough boxes for 80 points, but plates
    // for only 60, so 60 points are provisioned — not 80, not 100
    const ind = await api('/indents', { method: 'POST', body: {
      siteId: S.site, indentDate: '2026-09-05', send: true,
      lines: [
        { boqLineId: box1.boq_line_id, qty: 80 },
        { boqLineId: plate1.boq_line_id, qty: 120 },
      ] } });
    await api(`/indents/${ind.body.id}/decide`, { method: 'POST', body: { action: 'APPROVED' } });

    const r = (await api(`/bills/sheet/${S.site}`)).body;
    assert.equal(Number(r.lines[0].indented_qty), 60,
      'the least-provisioned item is what the line can be built to');
  });

  /* ---------------------------------------------------------- RA 1 */
  test('more than was agreed cannot be billed', async (t) => {
    if (!live) return t.skip('no database');
    const r = await api('/bills', { method: 'POST', body: {
      siteId: S.site, billDate: '2026-09-30',
      lines: [{ woLineId: S.wl1, qty: 140 }] } });
    assert.equal(r.status, 409);
    assert.match(r.body.error.message, /100 is the agreed quantity/);
  });

  test('RA 1 is raised for 60 points and 20 light points', async (t) => {
    if (!live) return t.skip('no database');
    const r = await api('/bills', { method: 'POST', body: {
      siteId: S.site, billDate: '2026-09-30', clientRef: 'GMR/CERT/09',
      periodFrom: '2026-09-01', periodTo: '2026-09-30', raise: true,
      lines: [{ woLineId: S.wl1, qty: 60 }, { woLineId: S.wl2, qty: 20 }] } });
    assert.equal(r.status, 201);
    assert.equal(r.body.raNo, 1);
    assert.match(r.body.docNo, /^RA\/\d\d-\d\d\/0001$/);
    assert.equal(Number(r.body.value), 60 * 900 + 20 * 500);
    S.ra1 = r.body.id;
  });

  test('the sheet now knows what is left', async (t) => {
    if (!live) return t.skip('no database');
    const r = (await api(`/bills/sheet/${S.site}`)).body;
    assert.equal(Number(r.lines[0].billed_qty), 60);
    assert.equal(Number(r.lines[0].to_bill_qty), 40);
    assert.equal(Number(r.lines[0].billed_pct), 60);
    assert.equal(Number(r.totals.billedValue), 60 * 900 + 20 * 500);
    assert.equal(r.nextRaNo, 2);
  });

  test('and the rate is the one the client agreed, stamped on the bill', async (t) => {
    if (!live) return t.skip('no database');
    const r = (await api(`/bills/${S.ra1}`)).body;
    assert.equal(Number(r.lines[0].supply_rate), 700);
    assert.equal(Number(r.lines[0].inst_rate), 200);
    assert.equal(Number(r.head.supply_value), 60 * 700 + 20 * 400);
    assert.equal(Number(r.head.inst_value), 60 * 200 + 20 * 100);
  });

  /* ---------------------------------------------------------- RA 2 */
  test('RA 2 cannot bill more than RA 1 left behind', async (t) => {
    if (!live) return t.skip('no database');
    const r = await api('/bills', { method: 'POST', body: {
      siteId: S.site, billDate: '2026-10-31',
      lines: [{ woLineId: S.wl1, qty: 50 }] } });
    assert.equal(r.status, 409);
    assert.match(r.body.error.message, /60 is already billed, so only 40 is left/);
  });

  test('a draft holds nothing until it is raised', async (t) => {
    if (!live) return t.skip('no database');
    const r = await api('/bills', { method: 'POST', body: {
      siteId: S.site, billDate: '2026-10-31',
      lines: [{ woLineId: S.wl1, qty: 40 }] } });
    assert.equal(r.status, 201);
    S.ra2 = r.body.id;

    const sheet = (await api(`/bills/sheet/${S.site}`)).body;
    assert.equal(Number(sheet.lines[0].billed_qty), 60, 'the draft is not billed');
    assert.equal(Number(sheet.lines[0].draft_qty), 40, 'but the sheet shows it is held');
  });

  test('two drafts at once would be a muddle, so they are refused', async (t) => {
    if (!live) return t.skip('no database');
    const r = await api('/bills', { method: 'POST', body: {
      siteId: S.site, billDate: '2026-10-31',
      lines: [{ woLineId: S.wl2, qty: 5 }] } });
    assert.equal(r.status, 409);
    assert.match(r.body.error.message, /already has RA/);
  });

  test('a draft can be edited to the same numbers without tripping itself', async (t) => {
    if (!live) return t.skip('no database');
    const r = await api(`/bills/${S.ra2}`, { method: 'PUT', body: {
      lines: [{ woLineId: S.wl1, qty: 40 }, { woLineId: S.wl2, qty: 30 }] } });
    assert.equal(r.status, 200);
    assert.equal(Number(r.body.value), 40 * 900 + 30 * 500);
  });

  test('raising RA 2 closes line 1 out completely', async (t) => {
    if (!live) return t.skip('no database');
    const r = await api(`/bills/${S.ra2}/raise`, { method: 'POST' });
    assert.equal(r.status, 200);
    const sheet = (await api(`/bills/sheet/${S.site}`)).body;
    assert.equal(Number(sheet.lines[0].billed_qty), 100);
    assert.equal(Number(sheet.lines[0].to_bill_qty), 0);
    assert.equal(Number(sheet.lines[0].billed_pct), 100);
    assert.equal(Number(sheet.totals.toBillValue), 0);
  });

  test('an RA bill reads: before, this bill, to date', async (t) => {
    if (!live) return t.skip('no database');
    const r = (await api(`/bills/${S.ra2}`)).body;
    const l1 = r.lines.find((l) => l.wo_line_id === S.wl1);
    assert.equal(Number(l1.previous_qty), 60);
    assert.equal(Number(l1.qty), 40);
    assert.equal(Number(l1.to_date_qty), 100);
    assert.equal(Number(l1.boq_qty), 100);
  });

  test('a raised bill cannot be edited or deleted', async (t) => {
    if (!live) return t.skip('no database');
    const edit = await api(`/bills/${S.ra2}`, { method: 'PUT', body: { note: 'x' } });
    assert.equal(edit.status, 409);
    const del = await api(`/bills/${S.ra2}`, { method: 'DELETE' });
    assert.equal(del.status, 409);
  });

  test('and bills come off in the order they went on', async (t) => {
    if (!live) return t.skip('no database');
    const r = await api(`/bills/${S.ra1}/cancel`, { method: 'POST', body: {
      note: 'client disputed the measurement' } });
    assert.equal(r.status, 409);
    assert.match(r.body.error.message, /was raised after this one/);
  });

  /* ----------------------------------------------------- the money */
  test('revenue is raised bills, and nothing else', async (t) => {
    if (!live) return t.skip('no database');
    const pl = (await api(`/costs/pl?siteId=${S.site}`)).body;
    assert.equal(pl.available, true, 'there is a profit and loss now');
    assert.equal(pl.revenue.bills, 2);
    assert.equal(Number(pl.revenue.total), 100 * 900 + 50 * 500);
    assert.equal(Number(pl.revenue.supply), 100 * 700 + 50 * 400);
    assert.equal(Number(pl.revenue.installation), 100 * 200 + 50 * 100);
  });

  test('profit is revenue less what the site actually cost', async (t) => {
    if (!live) return t.skip('no database');
    const pl = (await api(`/costs/pl?siteId=${S.site}`)).body;
    assert.equal(
      Number(pl.profit.gross),
      Math.round((Number(pl.revenue.total) - Number(pl.cost.total)) * 100) / 100);
    const cost = (await api(`/costs/expense?siteId=${S.site}`)).body;
    assert.equal(Number(pl.cost.total), Number(cost.totals.total),
      'and the cost side is the expense report, unchanged');
  });

  test('a site nobody has billed still has no profit and loss', async (t) => {
    if (!live) return t.skip('no database');
    const other = await api('/sites', { method: 'POST', body: {
      name: 'Unbilled Site', branchId: 1, clientId: 1,
      headUserId: 2, keeperUserId: 3, gmUserId: 5 } });
    S.unbilled = other.body.id;
    await api('/work-orders', { method: 'POST', body: {
      siteId: S.unbilled, woDate: '2026-09-02',
      lines: [{ description: 'Cable tray', uom: 'Mtrs', qty: 200, supplyRate: 300 }] } });
    const pl = (await api(`/costs/pl?siteId=${other.body.id}`)).body;
    assert.equal(pl.available, false);
    assert.equal(pl.blockedBy, 'BILLING');
    assert.equal(Number(pl.revenue.total), 0);
  });

  test('cancelling a bill takes its revenue back and frees the quantity', async (t) => {
    if (!live) return t.skip('no database');
    const before = (await api(`/costs/pl?siteId=${S.site}`)).body;
    const r = await api(`/bills/${S.ra2}/cancel`, { method: 'POST', body: {
      note: 'measurement disputed, to be re-raised' } });
    assert.equal(r.status, 200);

    const after = (await api(`/costs/pl?siteId=${S.site}`)).body;
    assert.equal(
      Number(before.revenue.total) - Number(after.revenue.total),
      40 * 900 + 30 * 500);

    const sheet = (await api(`/bills/sheet/${S.site}`)).body;
    assert.equal(Number(sheet.lines[0].billed_qty), 60, 'back to what RA 1 billed');
    assert.equal(Number(sheet.lines[0].to_bill_qty), 40, 'and free to bill again');
  });

  test('the register ranks sites by what is left to bill', async (t) => {
    if (!live) return t.skip('no database');
    const r = (await api('/bills/sites?branchId=1')).body;
    const mine = r.rows.find((x) => x.site_id === S.site);
    assert.equal(Number(mine.contract_value), 100 * 900 + 50 * 500);
    assert.equal(Number(mine.billed_value), 60 * 900 + 20 * 500);
    assert.equal(Number(mine.bills), 1, 'the cancelled one does not count');
    // a site with a work order and no bill is the whole point of this
    // list — it is where the money is sitting uninvoiced
    const fresh = r.rows.find((x) => x.site_id === S.unbilled);
    assert.equal(Number(fresh.bills), 0);
    assert.equal(Number(fresh.contract_value), 200 * 300);
    assert.equal(Number(fresh.to_bill_value), 200 * 300);
    assert.equal(Number(fresh.billed_pct), 0);
  });
});
