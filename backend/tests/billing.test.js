'use strict';
/**
 * Billing, and the profit and loss it unlocks.
 *
 * The hard part is the running total: RA 2 must know what RA 1 billed,
 * nothing may be billed twice, and a draft must never be revenue.
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
const { signOff, signOnce, as, GM, MANAGEMENT } = require('./sign');

const round3 = (n) => Math.round(Number(n) * 1000) / 1000;

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
    await signOff(api, `/boq/${S.boq}/decide`);
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
    assert.equal(Number(r.totals.contractValue), 100 * 900 + 50 * 500);
    assert.equal(r.nextRaNo, 1);
  });

  test('nothing can be billed before material is indented for it', async (t) => {
    if (!live) return t.skip('no database');
    const r = (await api(`/bills/sheet/${S.site}`)).body;
    assert.equal(Number(r.lines[0].indented_qty), 0);
    assert.equal(Number(r.lines[0].to_bill_qty), 0, 'agreed, but nothing provisioned');
    assert.equal(Number(r.totals.toBillValue), 0);
    assert.equal(Number(r.totals.unprovisionedValue), 100 * 900 + 50 * 500,
      'the whole order is waiting on material');

    const bill = await api('/bills', { method: 'POST', body: {
      siteId: S.site, billDate: '2026-09-30',
      lines: [{ woLineId: S.wl1, qty: 10 }] } });
    assert.equal(bill.status, 409);
    assert.match(bill.body.error.message, /no material has been indented for/);
    assert.equal(bill.body.error.detail.limitedBy, 'INDENTED');
  });

  test('indenting provisions a line, in the client\'s units', async (t) => {
    if (!live) return t.skip('no database');
    const lines = (await api(`/indents/boq/${S.boq}/lines`)).body;
    const at = (item, wl) => lines.find((l) => l.item_id === item && l.wo_line_id === wl)
      .boq_line_id;

    // 80 boxes and 120 plates against line 1: enough boxes for 80
    // points, but plates for only 60, so 60 points are provisioned.
    // 40 boxes against line 2 provisions 40 light points.
    const ind = await api('/indents', { method: 'POST', body: {
      siteId: S.site, indentDate: '2026-09-05', send: true,
      lines: [
        { boqLineId: at(S.box, S.wl1), qty: 80 },
        { boqLineId: at(S.plate, S.wl1), qty: 120 },
        { boqLineId: at(S.box, S.wl2), qty: 40 },
      ] } });
    await signOff(api, `/indents/${ind.body.id}/decide`);

    const r = (await api(`/bills/sheet/${S.site}`)).body;
    assert.equal(Number(r.lines[0].indented_qty), 60,
      'the least-provisioned item is what the line can be built to');
    assert.equal(Number(r.lines[0].to_bill_qty), 60);
    assert.equal(Number(r.lines[1].indented_qty), 40);
    assert.equal(Number(r.totals.toBillValue), 60 * 900 + 40 * 500);
  });

  test('nor more than has been indented for', async (t) => {
    if (!live) return t.skip('no database');
    const r = await api('/bills', { method: 'POST', body: {
      siteId: S.site, billDate: '2026-09-30',
      lines: [{ woLineId: S.wl1, qty: 80 }] } });
    assert.equal(r.status, 409);
    assert.match(r.body.error.message, /60 .* has been indented for/);
    assert.equal(r.body.error.detail.limitedBy, 'INDENTED');
  });

  /* ---------------------------------------------------------- RA 1 */
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
    // a bill asks a client for money, so it is signed twice before it
    // leaves the building
    const signed = await signOff(api, `/bills/${S.ra1}/decide`);
    assert.equal(signed.status, 200);
    assert.equal(signed.body.status, 'RAISED');
  });

  test('the sheet now knows what is left', async (t) => {
    if (!live) return t.skip('no database');
    const r = (await api(`/bills/sheet/${S.site}`)).body;
    assert.equal(Number(r.lines[0].billed_qty), 60);
    assert.equal(Number(r.lines[0].to_bill_qty), 0,
      'everything indented for has been billed — the rest needs an indent');
    assert.equal(Number(r.lines[0].unprovisioned_qty), 40);
    assert.equal(Number(r.lines[0].billed_pct), 60, 'of the agreed quantity');
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
  test('more material is indented, and the line opens up again', async (t) => {
    if (!live) return t.skip('no database');
    const lines = (await api(`/indents/boq/${S.boq}/lines`)).body;
    const at = (item, wl) => lines.find((l) => l.item_id === item && l.wo_line_id === wl)
      .boq_line_id;
    const ind = await api('/indents', { method: 'POST', body: {
      siteId: S.site, indentDate: '2026-10-05', send: true,
      lines: [
        { boqLineId: at(S.box, S.wl1), qty: 20 },
        { boqLineId: at(S.plate, S.wl1), qty: 80 },
        { boqLineId: at(S.box, S.wl2), qty: 10 },
      ] } });
    await signOff(api, `/indents/${ind.body.id}/decide`);

    const r = (await api(`/bills/sheet/${S.site}`)).body;
    assert.equal(Number(r.lines[0].indented_qty), 100, '100 boxes, 200 plates');
    assert.equal(Number(r.lines[0].to_bill_qty), 40);
    assert.equal(Number(r.lines[0].unprovisioned_qty), 0);
    assert.equal(Number(r.lines[1].indented_qty), 50);
    assert.equal(Number(r.lines[1].to_bill_qty), 30);
  });

  test('the indent is the only ceiling — even at the agreed quantity', async (t) => {
    if (!live) return t.skip('no database');
    const r = await api('/bills', { method: 'POST', body: {
      siteId: S.site, billDate: '2026-10-31',
      lines: [{ woLineId: S.wl1, qty: 50 }] } });
    assert.equal(r.status, 409);
    assert.match(r.body.error.message, /100 .* has been indented for/);
    assert.equal(r.body.error.detail.limitedBy, 'INDENTED');
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

  test('raising RA 2 closes both lines out completely', async (t) => {
    if (!live) return t.skip('no database');
    const sent = await api(`/bills/${S.ra2}/raise`, { method: 'POST' });
    assert.equal(sent.status, 200);
    assert.equal(sent.body.status, 'SUBMITTED', 'raising sends it to be signed');

    // one signature is not enough to send a bill to a client
    const once = await signOnce(api, `/bills/${S.ra2}/decide`);
    assert.equal(once.body.done, false);
    assert.equal(once.body.status, 'SUBMITTED');
    const half = (await api(`/bills/sheet/${S.site}`)).body;
    assert.equal(Number(half.lines[0].billed_qty), 60, 'still only RA 1 is billed');

    const r = await as(api, MANAGEMENT)(`/bills/${S.ra2}/decide`,
      { method: 'POST', body: { action: 'APPROVED' } });
    assert.equal(r.status, 200);
    assert.equal(r.body.status, 'RAISED');
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

  /* ==================================================================
     An amended line is where the arithmetic breaks if you are careless.
     The contract value has to be struck on the same quantity as
     everything beside it — the amended one — or contracted, billed and
     left-to-bill become three numbers that cannot be added up.
     ================================================================== */
  test('an amendment moves the contract value with the quantity', async (t) => {
    if (!live) return t.skip('no database');
    const sheet0 = (await api(`/bills/sheet/${S.site}`)).body;
    const before = sheet0.lines.find((l) => l.wo_line_id === S.wl2);
    assert.equal(Number(before.boq_qty), 50);
    assert.equal(Number(before.contract_value), 50 * 500);

    // Planning amends line 2 up from 50 to 70
    const boqWoLineId = (await api(`/boq/${S.boq}/amend-sheet`)).body
      .woLines.find((x) => x.wo_line_id === S.wl2).boq_wo_line_id;
    const am = await api(`/boq/${S.boq}/amendments`, { method: 'POST', body: {
      reason: 'client added twenty more light points',
      lines: [{ boqWoLineId, qty: 20 }] } });
    assert.equal(am.status, 201);

    const sheet = (await api(`/bills/sheet/${S.site}`)).body;
    const l = sheet.lines.find((x) => x.wo_line_id === S.wl2);
    assert.equal(Number(l.contracted_qty), 50, 'what the client signed is untouched');
    assert.equal(Number(l.var_qty), 20);
    assert.equal(Number(l.boq_qty), 70, 'and the line is now worth billing to 70');
    assert.equal(Number(l.original_value), 50 * 500, 'the signed value stays readable');
    assert.equal(Number(l.contract_value), 70 * 500, 'but the line is worth the amended one');
  });

  test('every line adds up, whichever way the three numbers fall', async (t) => {
    if (!live) return t.skip('no database');
    //   agreed + past the order = billed + can be billed + waiting
    //
    // The fourth term is there because the indent may run past what
    // the client signed, and when it does that work is billable but
    // is not part of the contract value.
    const sheet = (await api(`/bills/sheet/${S.site}`)).body;
    for (const l of sheet.lines) {
      assert.equal(
        Math.round((Number(l.contract_value) + Number(l.over_contract_value)) * 100),
        Math.round((Number(l.billed_value) + Number(l.to_bill_value)
                    + Number(l.unprovisioned_value)) * 100),
        `line ${l.sno} does not add up`);
    }
    assert.equal(
      Math.round((Number(sheet.totals.contractValue)
                  + Number(sheet.totals.overContractValue)) * 100),
      Math.round((Number(sheet.totals.billedValue) + Number(sheet.totals.toBillValue)
                  + Number(sheet.totals.unprovisionedValue)) * 100),
      'and neither do the totals');
  });

  test('an amendment adds to what is agreed, not to what can be billed', async (t) => {
    if (!live) return t.skip('no database');
    const sheet = (await api(`/bills/sheet/${S.site}`)).body;
    const l = sheet.lines.find((x) => x.wo_line_id === S.wl2);

    assert.equal(Number(l.boq_qty), 70, 'the client asked for twenty more');
    assert.equal(Number(l.indented_qty), 50, 'but no material has been asked for');
    assert.equal(Number(l.billable_qty), 50, 'the ceiling is the indent');
    assert.equal(Number(l.billed_qty), 20, 'RA 1 billed 20; RA 2 was cancelled');
    assert.equal(Number(l.to_bill_qty), 30, '50 provisioned less 20 billed');
    assert.equal(Number(l.unprovisioned_qty), 20, 'and the extra twenty waits on an indent');

    const tooMuch = await api('/bills', { method: 'POST', body: {
      siteId: S.site, billDate: '2026-11-30',
      lines: [{ woLineId: S.wl2, qty: 40 }] } });
    assert.equal(tooMuch.status, 409);
    assert.match(tooMuch.body.error.message, /50 .* has been indented for/);
    assert.equal(tooMuch.body.error.detail.limitedBy, 'INDENTED');
  });

  test('the order book is the amended contract, so nothing comes out negative', async (t) => {
    if (!live) return t.skip('no database');
    const pl = (await api(`/costs/pl?siteId=${S.site}`)).body;
    const sheet = (await api(`/bills/sheet/${S.site}`)).body;
    assert.equal(Number(pl.orderValue), Number(sheet.totals.contractValue),
      'the profit and loss and the billing sheet agree on what was agreed');
    assert.ok(Number(pl.unbilledOrderValue) >= 0);
    assert.ok(Number(pl.unbilledOrderValue) <= Number(sheet.totals.contractValue));
  });

  test('indenting past the work order lets it be billed, and says so', async (t) => {
    if (!live) return t.skip('no database');
    // a BOQ that permits over-indenting is a decision that more work
    // is being done than was written down, so the billing follows the
    // material rather than the paperwork
    await api(`/boq/${S.boq}/submit`, { method: 'POST', body: {
      overAllow: true, overPct: 0 } }).catch(() => {});
    await pool.query(`UPDATE boqs SET over_allow = 1, over_pct = 0 WHERE id = ?`, [S.boq]);

    const lines = (await api(`/indents/boq/${S.boq}/lines`)).body;
    const at = (item, wl) => lines.find((l) => l.item_id === item && l.wo_line_id === wl)
      .boq_line_id;
    const ind = await api('/indents', { method: 'POST', body: {
      siteId: S.site, indentDate: '2026-12-01', send: true,
      lines: [
        { boqLineId: at(S.box, S.wl1), qty: 15 },
        { boqLineId: at(S.plate, S.wl1), qty: 30 },
      ] } });
    assert.equal(ind.status, 201, 'the BOQ allows indenting past the estimate');
    await signOff(api, `/indents/${ind.body.id}/decide`);

    const sheet = (await api(`/bills/sheet/${S.site}`)).body;
    const l = sheet.lines.find((x) => x.wo_line_id === S.wl1);
    assert.equal(Number(l.boq_qty), 100, 'the client still agreed to 100');
    assert.equal(Number(l.indented_qty), 115, 'but 115 has been indented for');
    assert.equal(Number(l.billable_qty), 115, 'and 115 may be billed');
    assert.equal(Number(l.over_contract_qty), 15, 'with fifteen of it past the order');
    assert.equal(Number(l.to_bill_qty), round3(115 - Number(l.billed_qty)));
    assert.ok(Number(sheet.totals.overContractValue) > 0, 'and the sheet totals say so');
  });

  test('and that extra can actually be put on a bill', async (t) => {
    if (!live) return t.skip('no database');
    const sheet = (await api(`/bills/sheet/${S.site}`)).body;
    const l = sheet.lines.find((x) => x.wo_line_id === S.wl1);
    const all = Number(l.to_bill_qty);

    const tooMuch = await api('/bills', { method: 'POST', body: {
      siteId: S.site, billDate: '2026-12-05',
      lines: [{ woLineId: S.wl1, qty: all + 5 }] } });
    assert.equal(tooMuch.status, 409, 'past the indent is still refused');

    const ok = await api('/bills', { method: 'POST', body: {
      siteId: S.site, billDate: '2026-12-05', raise: true,
      lines: [{ woLineId: S.wl1, qty: all }] } });
    assert.equal(ok.status, 201, 'up to the indent goes through, past the order or not');
    await signOff(api, `/bills/${ok.body.id}/decide`);

    const after = (await api(`/bills/sheet/${S.site}`)).body;
    const a = after.lines.find((x) => x.wo_line_id === S.wl1);
    assert.equal(Number(a.billed_qty), 115);
    assert.equal(Number(a.to_bill_qty), 0);
    assert.ok(Number(a.billed_pct) > 100, 'billed past the work order, and it shows');
  });

  /* ------------------------------------------------------ by client */
  test('a client can be added without leaving the screen', async (t) => {
    if (!live) return t.skip('no database');
    // clients are master data and are deliberately not wiped between
    // runs, so the second run of this suite takes the 409 path — which
    // is the same path the picker takes, and worth exercising either way
    const r = await api('/masters/clients', { method: 'POST', body: {
      name: 'Prestige Estates Projects', branchId: 1, gstin: '29AACCP1234N1Z9' } });
    assert.ok([201, 409].includes(r.status));
    S.client = r.status === 201 ? r.body.id : r.body.error.detail.clientId;
    assert.ok(S.client);

    // the same name typed differently is the same client, and the
    // refusal names the one that exists rather than leaving somebody
    // to go and find it
    const again = await api('/masters/clients', { method: 'POST', body: {
      name: 'prestige  estates projects.', branchId: 1 } });
    assert.equal(again.status, 409);
    assert.match(again.body.error.message, /Already on the list as/);
    assert.equal(again.body.error.detail.clientId, S.client);
  });

  test('bills can be found by typing the client name', async (t) => {
    if (!live) return t.skip('no database');
    const all = (await api('/bills?branchId=1')).body;
    assert.ok(all.rows.length > 0);
    const client = all.rows[0].client_name;
    assert.ok(client, 'a bill knows its client');

    const found = (await api(
      `/bills?branchId=1&q=${encodeURIComponent(client.slice(0, 6))}`)).body;
    assert.ok(found.rows.length > 0, 'part of the client name finds them');
    assert.ok(found.rows.every((b) => b.client_name === client));

    const none = (await api('/bills?branchId=1&q=Nobody%20Ltd')).body;
    assert.equal(none.rows.length, 0);
  });

  test('and narrowed to one client exactly', async (t) => {
    if (!live) return t.skip('no database');
    const all = (await api('/bills?branchId=1')).body;
    const clientId = all.rows[0].client_id;
    const mine = (await api(`/bills?branchId=1&clientId=${clientId}`)).body;
    assert.ok(mine.rows.length > 0);
    assert.ok(mine.rows.every((b) => b.client_id === clientId));

    const other = (await api(`/bills?branchId=1&clientId=${S.client}`)).body;
    assert.equal(other.rows.length, 0, 'a client with no bills has none');
  });

  test('sites to bill are found by client too', async (t) => {
    if (!live) return t.skip('no database');
    const all = (await api('/bills/sites?branchId=1')).body;
    const name = all.rows[0].client_name;
    const byName = (await api(
      `/bills/sites?branchId=1&q=${encodeURIComponent(name.slice(0, 6))}`)).body;
    assert.ok(byName.rows.length > 0, 'typing the client finds their sites');
    assert.ok(byName.rows.every((r) => r.client_name === name));
  });
});
