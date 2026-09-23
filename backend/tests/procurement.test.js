'use strict';
/**
 * Procurement, end to end: an approved indent becomes demand, demand
 * becomes a purchase order, the order is received, and the indent that
 * started it reports how far it has got — without anything storing a
 * running total.
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

describe('procurement', () => {
  const S = {};

  /* ---------------------------------------------------------- setup */
  test('two sites, each with a work order and a locked BOQ', async (t) => {
    if (!live) return t.skip('no database');
    const find = async (q) => (await api(`/items/search?q=${encodeURIComponent(q)}`)).body[0].id;
    S.box = await find('metal box');
    S.plate = await find('front plate');

    for (const [key, name] of [['a', 'Aerocity Block C'], ['b', 'Tech Park Phase 2']]) {
      const site = await api('/sites', { method: 'POST', body: {
        name, branchId: 1, clientId: 1, headUserId: 2, keeperUserId: 3, gmUserId: 5 } });
      S[`site${key}`] = site.body.id;

      const wo = await api('/work-orders', { method: 'POST', body: {
        siteId: site.body.id, woDate: '2026-09-01',
        lines: [{ description: 'Socket point with back box', uom: "No's", qty: 100, supplyRate: 900 }] } });

      const prep = await api('/boq/prepare', { method: 'POST', body: { workOrderId: wo.body.id } });
      S[`boq${key}`] = prep.body.boqId;
      const sheet = (await api(`/boq/${prep.body.boqId}`)).body;
      await api(`/boq/${prep.body.boqId}/wo-line/${sheet.woLines[0].wo_line_id}`, {
        method: 'PUT',
        body: { estQty: 100, items: [{ itemId: S.box, itemQty: 1 }, { itemId: S.plate, itemQty: 2 }] },
      });
      await api(`/boq/${prep.body.boqId}/submit`, { method: 'POST', body: { overAllow: false } });
      await signOff(api, `/boq/${prep.body.boqId}/decide`);
    }
    assert.ok(S.sitea && S.siteb);
  });

  test('a central store for the branch', async (t) => {
    if (!live) return t.skip('no database');
    const r = await api('/sites/stores', { method: 'POST', body: {
      name: 'Central Store Hyderabad', branchId: 1, keeperUserId: 3 } });
    assert.equal(r.status, 201);
    S.store = r.body.id;
    await pool.query(`UPDATE sites SET is_central = 1 WHERE id = ?`, [S.store]);
  });

  test('both sites indent, and both are approved', async (t) => {
    if (!live) return t.skip('no database');
    for (const key of ['a', 'b']) {
      const lines = (await api(`/indents/boq/${S[`boq${key}`]}/lines`)).body;
      const box = lines.find((l) => l.item_id === S.box);
      const r = await api('/indents', { method: 'POST', body: {
        siteId: S[`site${key}`], indentDate: '2026-09-05',
        neededBy: key === 'a' ? '2026-09-20' : '2026-09-30',
        lines: [{ boqLineId: box.boq_line_id, qty: key === 'a' ? 60 : 40 }],
        send: true } });
      S[`ind${key}`] = r.body.id;
      await signOff(api, `/indents/${r.body.id}/decide`);
    }
    assert.ok(S.inda && S.indb);
  });

  /* ---------------------------------------------------------- queue */
  test('both land on the buyer queue, waiting for an order', async (t) => {
    if (!live) return t.skip('no database');
    const q = (await api('/procurement/queue?branchId=1')).body;
    assert.equal(q.length, 2);
    assert.ok(q.every((r) => r.stage === 'AWAITING_PO'));
    assert.equal(q[0].needed_by.slice(0, 10), '2026-09-20', 'soonest needed first');
  });

  test('an approved PRN not at site by its needed-by date is an alert', async (t) => {
    if (!live) return t.skip('no database');
    const [was] = await pool.query('SELECT id, needed_by FROM indents WHERE id IN (?, ?)', [S.inda, S.indb]);
    await pool.query('UPDATE indents SET needed_by = CURDATE() - INTERVAL 4 DAY WHERE id = ?', [S.inda]);
    await pool.query('UPDATE indents SET needed_by = CURDATE() + INTERVAL 5 DAY WHERE id = ?', [S.indb]);
    try {
      const rows = (await as(api, MANAGEMENT)('/alerts')).body.rows;
      const late = rows.find((r) => r.key === `prn-${S.inda}`);
      assert.equal(late?.kind, 'PRN_LATE');
      assert.match(late.title, /4 day\(s\) past its needed-by date/);
      assert.match(late.detail, /0 of 60 at site · 60 still to reach the site/);
      assert.ok(!rows.some((r) => r.key === `prn-${S.indb}`), 'not due yet: no alert');
      assert.ok(!(await api('/alerts')).body.rows.some((r) => r.kind === 'PRN_LATE'), 'not for Planning');

      // the buyer hears about the one past its date that nobody has ordered
      const [[buyer]] = await pool.query(`SELECT id FROM users WHERE department = 'Procurement' ORDER BY id LIMIT 1`);
      const mine = (await as(api, buyer.id)('/alerts')).body.rows;
      const unordered = mine.find((r) => r.key === `prnorder-${S.inda}`);
      assert.equal(unordered?.kind, 'PRN_NOT_ORDERED');
      assert.match(unordered.detail, /60 of 60 on no purchase order yet/);
      assert.ok(!mine.some((r) => r.key === `prnorder-${S.indb}`), 'the one not yet due is not');
      assert.ok(!mine.some((r) => r.kind === 'PRN_LATE'), 'delivery lateness is the store\'s alert, not the buyer\'s');
    } finally {
      for (const w of was) await pool.query('UPDATE indents SET needed_by = ? WHERE id = ?', [w.needed_by, w.id]);
    }
  });

  test('the queue can be filtered to one site', async (t) => {
    if (!live) return t.skip('no database');
    const q = (await api(`/procurement/queue?branchId=1&siteId=${S.sitea}`)).body;
    assert.equal(q.length, 1);
  });

  test('by item, both PRNs add up to one line to buy', async (t) => {
    if (!live) return t.skip('no database');
    const { rows } = (await api('/procurement/items?branchId=1')).body;
    const box = rows.find((r) => r.item_id === S.box);
    assert.ok(box, 'the item is on the list');
    assert.equal(Number(box.to_order_qty), 100, '60 + 40');
    assert.equal(Number(box.prns), 2);
    assert.equal(Number(box.sites), 2);

    const one = (await api(`/procurement/items?branchId=1&siteId=${S.sitea}`)).body.rows
      .find((r) => r.item_id === S.box);
    assert.equal(Number(one.to_order_qty), 60, 'filtered to one site');
  });

  test('opening an item shows each PRN and the BOQ lines it was asked on', async (t) => {
    if (!live) return t.skip('no database');
    const { prns } = (await api(`/procurement/items/${S.box}?branchId=1`)).body;
    assert.deepEqual(prns.map((p) => p.id), [S.inda, S.indb], 'soonest needed first');
    assert.equal(prns[0].lines.length, 1);
    assert.equal(Number(prns[0].lines[0].qty), 60);
    assert.ok(prns[0].lines[0].sno, 'with its BOQ line number');
  });

  test('a comparison can be started for chosen items, capped at what the PRNs need', async (t) => {
    if (!live) return t.skip('no database');
    const r = await api('/comparisons', { method: 'POST', body: {
      indentIds: [S.inda, S.indb], items: [{ itemId: S.box, qty: 500 }] } });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    const c = (await api(`/comparisons/${r.body.id}`)).body;
    assert.equal(c.items.length, 1, 'only the item chosen');
    assert.equal(Number(c.items[0].qty), 100, 'no more than the 60 + 40 the PRNs need');
    assert.equal(Number(c.items[0].need_qty), 100);
    assert.equal(c.indents.length, 2, 'still tied to both PRNs');
    await api(`/comparisons/${r.body.id}`, { method: 'DELETE' });
  });

  /* --------------------------------------------------------- demand */
  test('two indents for the same item come out as one line to buy', async (t) => {
    if (!live) return t.skip('no database');
    const d = (await api('/procurement/demand', { method: 'POST', body: {
      indentIds: [S.inda, S.indb] } })).body;
    assert.equal(d.lines.length, 1, 'one item, whatever it was asked for against');
    assert.equal(Number(d.lines[0].indentedQty), 100, '60 + 40');
    assert.equal(Number(d.lines[0].toOrderQty), 100);
    assert.equal(Number(d.lines[0].storeQty), 0, 'the store holds none of it yet');
    assert.equal(d.singleSite, false);
    assert.deepEqual(d.deliverOptions.map((o) => o.type), ['STORE'],
      'two sites, so it has to land at a store');
  });

  test('one site on its own may take delivery directly', async (t) => {
    if (!live) return t.skip('no database');
    const d = (await api('/procurement/demand', { method: 'POST', body: {
      indentIds: [S.inda] } })).body;
    assert.equal(d.singleSite, true);
    assert.ok(d.deliverOptions.some((o) => o.type === 'SITE'));
    assert.ok(d.deliverOptions.some((o) => o.type === 'STORE'));
  });

  /* ------------------------------------------------------- supplier */
  test('a supplier is added once, and only once', async (t) => {
    if (!live) return t.skip('no database');
    const r = await api('/suppliers', { method: 'POST', body: {
      name: 'Polycab Distributors', gstin: '36AABCP1234M1Z5', termsDays: 45 } });
    assert.equal(r.status, 201);
    S.supplier = r.body.id;

    const again = await api('/suppliers', { method: 'POST', body: { name: 'polycab  distributors.' } });
    assert.equal(again.status, 409);
    assert.match(again.body.error.message, /Already on the list as SUP-0001/);
  });

  /* ------------------------------------------------------------- PO */
  test('an order cannot go to a site when it covers two of them', async (t) => {
    if (!live) return t.skip('no database');
    const r = await api('/purchase-orders', { method: 'POST', body: {
      supplierId: S.supplier, indentIds: [S.inda, S.indb], deliverToId: S.sitea,
      poDate: '2026-09-08', lines: [{ itemId: S.box, qty: 100, rate: 120 }] } });
    assert.equal(r.status, 400);
    assert.match(r.body.error.message, /delivered to a store/);
  });

  test('and cannot order more than the indents are owed', async (t) => {
    if (!live) return t.skip('no database');
    const r = await api('/purchase-orders', { method: 'POST', body: {
      supplierId: S.supplier, indentIds: [S.inda, S.indb], deliverToId: S.store,
      poDate: '2026-09-08', lines: [{ itemId: S.box, qty: 140, rate: 120 }] } });
    assert.equal(r.status, 409);
    assert.match(r.body.error.message, /100 is still outstanding/);
  });

  test('one order covers both indents, split by which is needed first', async (t) => {
    if (!live) return t.skip('no database');
    const r = await api('/purchase-orders', { method: 'POST', body: {
      supplierId: S.supplier, indentIds: [S.inda, S.indb], deliverToId: S.store,
      poDate: '2026-09-08', expectedDate: '2026-09-18', submit: true,
      lines: [{ itemId: S.box, qty: 100, rate: 120, gstRate: 18 }] } });
    assert.equal(r.status, 201);
    S.po = r.body.id;
    assert.equal(Number(r.body.value), 100 * 120 * 1.18);

    const po = (await api(`/purchase-orders/${S.po}`)).body;
    assert.equal(po.status, 'SUBMITTED');
    assert.equal(po.stage, 'AWAITING_GM', 'nothing goes to a supplier unsigned');
    assert.equal(po.receipt_state, 'NOT_SENT');
    assert.equal(po.indents.length, 2);
    assert.match(po.lines[0].against, /PRN/);
    // offered to the person it waits on, and to nobody else
    assert.equal(po.canApprove, false, 'Planning is looking, and Planning does not approve orders');
    const theirs = (await as(api, GM)(`/purchase-orders/${S.po}`)).body;
    assert.equal(theirs.canApprove, true);
  });

  test('an unsigned order holds the quantity but is not ordered', async (t) => {
    if (!live) return t.skip('no database');
    const a = (await api(`/indents/${S.inda}`)).body;
    assert.equal(a.pipeline.stage, 'PO_WITH_GM');
    assert.equal(Number(a.flow[0].committed_qty), 60, 'spoken for, so it cannot be ordered twice');
    assert.equal(Number(a.flow[0].ordered_qty), 0, 'but not ordered until it is signed');
    assert.equal(Number(a.flow[0].to_order_qty), 0);
  });

  test('nothing can be received against an unsigned order', async (t) => {
    if (!live) return t.skip('no database');
    const pend = (await api(`/purchase-orders/${S.po}/pending`)).body;
    const r = await api(`/purchase-orders/${S.po}/receipts`, { method: 'POST', body: {
      receiptDate: '2026-09-16', lines: [{ poLineId: pend.lines[0].po_line_id, qty: 10 }] } });
    assert.equal(r.status, 409);
    assert.match(r.body.error.message, /not been approved/);
  });

  test('the GM sends it back, and has to say why', async (t) => {
    if (!live) return t.skip('no database');
    const silent = await as(api, GM)(`/purchase-orders/${S.po}/decide`, { method: 'POST', body: {
      action: 'RETURNED' } });
    assert.equal(silent.status, 400);

    const r = await as(api, GM)(`/purchase-orders/${S.po}/decide`, { method: 'POST', body: {
      action: 'RETURNED', note: 'rate is above the last comparison, renegotiate' } });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const po = (await api(`/purchase-orders/${S.po}`)).body;
    assert.equal(po.stage, 'RETURNED');
    assert.equal(po.canEdit, true);
    assert.ok(po.events.some((e) => e.action === 'RETURNED' && /renegotiate/.test(e.note)));
  });

  test('a returned order stops holding the quantity', async (t) => {
    if (!live) return t.skip('no database');
    const a = (await api(`/indents/${S.inda}`)).body;
    assert.equal(a.pipeline.stage, 'AWAITING_PO', 'back on the buyer queue');
    assert.equal(Number(a.flow[0].to_order_qty), 60);
    assert.equal((await api('/procurement/queue?branchId=1')).body.length, 2);
  });

  test('the buyer fixes the rate and sends it again', async (t) => {
    if (!live) return t.skip('no database');
    const po = (await api(`/purchase-orders/${S.po}`)).body;
    const r = await api(`/purchase-orders/${S.po}`, { method: 'PUT', body: {
      lines: [{ itemId: S.box, qty: 100, rate: 112, gstRate: 18 }] } });
    assert.equal(r.status, 200, 'its own quantity is not counted against it when editing');

    const sent = await api(`/purchase-orders/${S.po}/submit`, { method: 'POST' });
    assert.equal(sent.body.status, 'SUBMITTED');
    const after = (await api(`/purchase-orders/${S.po}`)).body;
    assert.equal(Number(after.lines[0].rate), 112);
    assert.ok(Number(after.po_value) < Number(po.po_value));
  });

  test('one signature is not enough to send an order to a supplier', async (t) => {
    if (!live) return t.skip('no database');
    const first = await signOnce(api, `/purchase-orders/${S.po}/decide`,
      { note: 'ok at the revised rate' });
    assert.equal(first.status, 200);
    assert.equal(first.body.done, false);

    const po = (await api(`/purchase-orders/${S.po}`)).body;
    assert.equal(po.stage, 'AWAITING_GM', 'still waiting, now on the second desk');
  });

  test('Management signs it, and only then is it ordered', async (t) => {
    if (!live) return t.skip('no database');
    const r = await as(api, MANAGEMENT)(`/purchase-orders/${S.po}/decide`, { method: 'POST', body: {
      action: 'APPROVED', note: 'approved' } });
    assert.equal(r.status, 200);
    assert.match(r.body.message, /approved/);

    const po = (await api(`/purchase-orders/${S.po}`)).body;
    assert.equal(po.stage, 'AWAITING', 'now in the delivery pipeline');
    assert.equal(po.canApprove, false);
    assert.ok(po.decided_by_name);
  });

  test('each indent now knows how much of it was ordered', async (t) => {
    if (!live) return t.skip('no database');
    const a = (await api(`/indents/${S.inda}`)).body;
    assert.equal(a.pipeline.stage, 'ORDERED');
    assert.equal(Number(a.flow[0].ordered_qty), 60, 'its own share, not the whole order');
    assert.equal(Number(a.flow[0].to_order_qty), 0);
    assert.equal(a.orders.length, 1);

    const b = (await api(`/indents/${S.indb}`)).body;
    assert.equal(Number(b.flow[0].ordered_qty), 40);
  });

  test('an ordered indent drops off the buyer queue', async (t) => {
    if (!live) return t.skip('no database');
    assert.equal((await api('/procurement/queue?branchId=1')).body.length, 0);
    assert.equal((await api('/procurement/queue?branchId=1&stage=ALL')).body.length, 2);
    assert.equal((await api('/procurement/items?branchId=1')).body.rows.length, 0,
      'and nothing is left to buy by item either');
  });

  /* -------------------------------------------------------- receipt */
  test('a part-delivered order stays in the pipeline until it is full', async (t) => {
    if (!live) return t.skip('no database');
    const open = (await api('/purchase-orders?branchId=1&stage=PIPELINE')).body;
    assert.equal(open.length, 1);
    assert.equal(open[0].stage, 'AWAITING');
    const mine = (await api('/purchase-orders?branchId=1&stage=MINE')).body;
    assert.equal(mine.length, 0, 'nothing left with the buyer');
  });

  test('a short delivery leaves the order partly received', async (t) => {
    if (!live) return t.skip('no database');
    const pend = (await api(`/purchase-orders/${S.po}/pending`)).body;
    assert.equal(Number(pend.lines[0].pending_qty), 100);

    const r = await api(`/purchase-orders/${S.po}/receipts`, { method: 'POST', body: {
      receiptDate: '2026-09-16', supplierDc: 'DC-8811',
      lines: [{ poLineId: pend.lines[0].po_line_id, qty: 70 }] } });
    assert.equal(r.status, 201);
    assert.equal(r.body.poState, 'PARTIAL');
    assert.equal(Number(r.body.pendingQty), 30);
  });

  test('a PO past its expected date and not fully received is an alert for Management and Procurement', async (t) => {
    if (!live) return t.skip('no database');
    const [[was]] = await pool.query('SELECT expected_date FROM purchase_orders WHERE id = ?', [S.po]);
    await pool.query('UPDATE purchase_orders SET expected_date = CURDATE() - INTERVAL 3 DAY WHERE id = ?', [S.po]);
    const rows = (await as(api, MANAGEMENT)('/alerts')).body.rows;
    const late = rows.find((r) => r.key === `po-${S.po}`);
    assert.equal(late?.kind, 'PO_LATE');
    assert.match(late.title, /3 day\(s\) late/);
    assert.match(late.detail, /70 of 100 received/);
    const [[buyer]] = await pool.query(`SELECT id FROM users WHERE department = 'Procurement' ORDER BY id LIMIT 1`);
    assert.ok((await as(api, buyer.id)('/alerts')).body.rows.some((r) => r.key === `po-${S.po}`),
      'the buyer who chases the supplier hears too');
    assert.ok(!(await api('/alerts')).body.rows.some((r) => r.kind === 'PO_LATE'), 'but not Planning');
    await pool.query('UPDATE purchase_orders SET expected_date = ? WHERE id = ?', [was.expected_date, S.po]);
  });

  test('what arrived is on the shelf at the store it was sent to', async (t) => {
    if (!live) return t.skip('no database');
    const [[st]] = await pool.query(
      `SELECT qty, avg_rate FROM v_stock_balance WHERE site_id = ? AND item_id = ?`,
      [S.store, S.box]);
    assert.equal(Number(st.qty), 70);
    assert.equal(Number(st.avg_rate), 112, 'at the rate the GM actually signed');
  });

  test('and both indents show their share of it received', async (t) => {
    if (!live) return t.skip('no database');
    const a = (await api(`/indents/${S.inda}`)).body;
    assert.equal(a.pipeline.stage, 'PART_RECEIVED');
    assert.equal(Math.round(Number(a.flow[0].received_qty)), 42, '70 of 100, of which 60 was A');
    const b = (await api(`/indents/${S.indb}`)).body;
    assert.equal(Math.round(Number(b.flow[0].received_qty)), 28);
  });

  test('cannot receive more than is still owed', async (t) => {
    if (!live) return t.skip('no database');
    const pend = (await api(`/purchase-orders/${S.po}/pending`)).body;
    const r = await api(`/purchase-orders/${S.po}/receipts`, { method: 'POST', body: {
      receiptDate: '2026-09-20',
      lines: [{ poLineId: pend.lines[0].po_line_id, qty: 50 }] } });
    assert.equal(r.status, 409);
    assert.match(r.body.error.message, /30 is still owed/);
  });

  test('the rest arrives and the order reads received', async (t) => {
    if (!live) return t.skip('no database');
    const pend = (await api(`/purchase-orders/${S.po}/pending`)).body;
    const r = await api(`/purchase-orders/${S.po}/receipts`, { method: 'POST', body: {
      receiptDate: '2026-09-20', lines: [{ poLineId: pend.lines[0].po_line_id, qty: 30 }] } });
    assert.equal(r.body.poState, 'RECEIVED');

    const a = (await api(`/indents/${S.inda}`)).body;
    // it landed at the store, which is not the same as reaching the site
    assert.equal(a.pipeline.stage, 'AT_STORE');
    assert.equal(Number(a.flow[0].to_receive_qty), 0);
    assert.equal(Number(a.flow[0].at_site_qty), 0, 'nothing has reached the site yet');
    assert.ok(Number(a.flow[0].to_deliver_qty) > 0);

    const [[st]] = await pool.query(
      `SELECT qty FROM v_stock_balance WHERE site_id = ? AND item_id = ?`, [S.store, S.box]);
    assert.equal(Number(st.qty), 100);
  });

  test('the next order sees what the store now holds', async (t) => {
    if (!live) return t.skip('no database');
    const lines = (await api(`/indents/boq/${S.boqa}/lines`)).body;
    const plate = lines.find((l) => l.item_id === S.plate);
    const ind = await api('/indents', { method: 'POST', body: {
      siteId: S.sitea, indentDate: '2026-09-22',
      lines: [{ boqLineId: plate.boq_line_id, qty: 10 }], send: true } });
    await signOff(api, `/indents/${ind.body.id}/decide`);

    const d = (await api('/procurement/demand', { method: 'POST', body: {
      indentIds: [ind.body.id] } })).body;
    assert.equal(Number(d.lines[0].storeQty), 0, 'a different item — none held');

    const box = (await api('/procurement/demand', { method: 'POST', body: {
      indentIds: [S.inda] } })).body.lines[0];
    assert.equal(Number(box.storeQty), 100, 'the boxes received are on the shelf');
    assert.equal(Number(box.storeRate), 112);
    assert.equal(Number(box.lastPaidRate), 112, 'and the buyer is not typing into a vacuum');
  });

  /* ------------------------------------------------ rate comparison */

  test('a comparison is seeded with what the indents still need', async (t) => {
    if (!live) return t.skip('no database');
    const lines = (await api(`/indents/boq/${S.boqb}/lines`)).body;
    const plate = lines.find((l) => l.item_id === S.plate);
    const ind = await api('/indents', { method: 'POST', body: {
      siteId: S.siteb, indentDate: '2026-09-23',
      lines: [{ boqLineId: plate.boq_line_id, qty: 200 }], send: true } });
    await signOff(api, `/indents/${ind.body.id}/decide`);
    S.cmpIndent = ind.body.id;

    const r = await api('/comparisons', { method: 'POST', body: {
      branchId: 1, indentIds: [ind.body.id], title: 'Front plates' } });
    assert.equal(r.status, 201);
    S.cmp = r.body.id;

    const c = (await api(`/comparisons/${S.cmp}`)).body;
    assert.equal(c.items.length, 1, 'nobody retypes a requirement already worked out');
    assert.equal(Number(c.items[0].qty), 200);
    assert.equal(c.indents.length, 1);
  });

  test('three suppliers quote', async (t) => {
    if (!live) return t.skip('no database');
    for (const name of ['Havells Agencies', 'Sri Venkat Electricals']) {
      const r = await api('/suppliers', { method: 'POST', body: { name } });
      S[name] = r.body.id;
    }
    for (const sid of [S.supplier, S['Havells Agencies'], S['Sri Venkat Electricals']]) {
      const r = await api(`/comparisons/${S.cmp}/suppliers`, { method: 'POST', body: { supplierId: sid } });
      assert.equal(r.status, 201);
    }
    const c = (await api(`/comparisons/${S.cmp}`)).body;
    assert.equal(c.suppliers.length, 3);

    const again = await api(`/comparisons/${S.cmp}/suppliers`, { method: 'POST', body: {
      supplierId: S.supplier } });
    assert.equal(again.status, 409, 'the same supplier cannot quote twice');
  });

  test('the cheapest quote is not always the cheapest buy', async (t) => {
    if (!live) return t.skip('no database');
    const c = (await api(`/comparisons/${S.cmp}`)).body;
    const item = c.items[0];
    const byName = Object.fromEntries(c.suppliers.map((x) => [x.supplier_name, x]));

    // Polycab quotes lowest per unit, and charges for it in freight
    await api(`/comparisons/${S.cmp}/quotes`, { method: 'PUT', body: { quotes: [
      { comparisonItemId: item.id, comparisonSupplierId: byName['Polycab Distributors'].comparison_supplier_id, rate: 40 },
      { comparisonItemId: item.id, comparisonSupplierId: byName['Havells Agencies'].comparison_supplier_id, rate: 42 },
      { comparisonItemId: item.id, comparisonSupplierId: byName['Sri Venkat Electricals'].comparison_supplier_id, rate: 45 },
    ] } });
    await api(`/comparisons/${S.cmp}/suppliers/${byName['Polycab Distributors'].comparison_supplier_id}`,
      { method: 'PATCH', body: { freight: 3000, creditDays: 15 } });
    await api(`/comparisons/${S.cmp}/suppliers/${byName['Havells Agencies'].comparison_supplier_id}`,
      { method: 'PATCH', body: { discountPct: 5, freight: 0, creditDays: 45 } });

    const after = (await api(`/comparisons/${S.cmp}`)).body;
    const q = Object.fromEntries(after.suppliers.map((x) => [x.supplier_name, x]));

    assert.equal(Number(q['Polycab Distributors'].basic), 8000, '200 x 40');
    assert.equal(Number(q['Polycab Distributors'].landed), 11000, 'plus 3000 freight');
    assert.equal(Number(q['Havells Agencies'].basic), 8400, '200 x 42');
    assert.equal(Number(q['Havells Agencies'].landed), 7980, 'less 5%, no freight');

    assert.equal(after.best_quoted_supplier_name, 'Polycab Distributors');
    assert.equal(after.best_landed_supplier_name, 'Havells Agencies');
    assert.equal(after.cheapestIsNotLowest, true, 'and the sheet says so');
  });

  test('choosing a dearer quote is allowed, but not silently', async (t) => {
    if (!live) return t.skip('no database');
    const c = (await api(`/comparisons/${S.cmp}`)).body;
    const polycab = c.suppliers.find((x) => x.supplier_name === 'Polycab Distributors');

    const silent = await api(`/comparisons/${S.cmp}/decide`, { method: 'POST', body: {
      supplierId: polycab.supplier_id } });
    assert.equal(silent.status, 400);
    assert.match(silent.body.error.message, /not the cheapest landed/);

    const r = await api(`/comparisons/${S.cmp}/decide`, { method: 'POST', body: {
      supplierId: polycab.supplier_id, note: 'delivers to site, Havells does not' } });
    assert.equal(r.status, 200);
    assert.equal(r.body.wasCheapest, false);

    const after = (await api(`/comparisons/${S.cmp}`)).body;
    assert.equal(after.status, 'DECIDED');
    assert.equal(after.chosen_supplier_name, 'Polycab Distributors');
    assert.match(after.decided_note, /delivers to site/);
    assert.equal(after.canEdit, false, 'a decided sheet is not edited underneath the decision');
  });

  test('a decided sheet stops taking rates', async (t) => {
    if (!live) return t.skip('no database');
    const c = (await api(`/comparisons/${S.cmp}`)).body;
    const r = await api(`/comparisons/${S.cmp}/quotes`, { method: 'PUT', body: { quotes: [
      { comparisonItemId: c.items[0].id,
        comparisonSupplierId: c.suppliers[0].comparison_supplier_id, rate: 1 }] } });
    assert.equal(r.status, 409);
  });

  test('an order cannot be raised off a comparison nobody has signed', async (t) => {
    if (!live) return t.skip('no database');
    const c = (await api(`/comparisons/${S.cmp}`)).body;
    const early = await api('/purchase-orders', { method: 'POST', body: {
      supplierId: c.chosen_supplier_id, indentIds: [S.cmpIndent], deliverToId: S.siteb,
      poDate: '2026-09-24', comparisonId: c.comparison_id,
      lines: [{ itemId: S.plate, qty: 200, rate: 40, gstRate: 18 }] } });
    assert.equal(early.status, 409);
    assert.match(early.body.error.message, /waiting for approval/);
  });

  test('the order carries the comparison it came from', async (t) => {
    if (!live) return t.skip('no database');
    // both signatures on the chosen rate first
    const signed = await signOff(api, `/comparisons/${S.cmp}/decide-approval`);
    assert.equal(signed.status, 200);
    assert.equal(signed.body.status, 'APPROVED');

    const c = (await api(`/comparisons/${S.cmp}`)).body;
    const r = await api('/purchase-orders', { method: 'POST', body: {
      supplierId: c.chosen_supplier_id, indentIds: [S.cmpIndent], deliverToId: S.siteb,
      poDate: '2026-09-24', comparisonId: c.comparison_id,
      lines: [{ itemId: S.plate, qty: 200, rate: 40, gstRate: 18 }] } });
    assert.equal(r.status, 201);
    const po = (await api(`/purchase-orders/${r.body.id}`)).body;
    assert.equal(po.comparison_id, c.comparison_id);

    // and it cannot be unpicked once an order leans on it
    const reopen = await api(`/comparisons/${S.cmp}/reopen`, { method: 'POST' });
    assert.equal(reopen.status, 409);
  });

  test('choosing the cheapest needs no excuse', async (t) => {
    if (!live) return t.skip('no database');
    const made = await api('/comparisons', { method: 'POST', body: {
      branchId: 1, items: [{ itemId: S.box, qty: 50 }] } });
    const id = made.body.id;
    for (const sid of [S.supplier, S['Havells Agencies']]) {
      await api(`/comparisons/${id}/suppliers`, { method: 'POST', body: { supplierId: sid } });
    }
    const c = (await api(`/comparisons/${id}`)).body;
    await api(`/comparisons/${id}/quotes`, { method: 'PUT', body: { quotes: [
      { comparisonItemId: c.items[0].id, comparisonSupplierId: c.suppliers[0].comparison_supplier_id, rate: 100 },
      { comparisonItemId: c.items[0].id, comparisonSupplierId: c.suppliers[1].comparison_supplier_id, rate: 130 },
    ] } });
    const best = (await api(`/comparisons/${id}`)).body.best_landed_supplier_id;
    const r = await api(`/comparisons/${id}/decide`, { method: 'POST', body: { supplierId: best } });
    assert.equal(r.status, 200);
    assert.equal(r.body.wasCheapest, true);
  });

  /* --------------------------------------------------------- the store */

  test('every PRN stays on the store\'s list until it is fulfilled', async (t) => {
    if (!live) return t.skip('no database');
    const desk = (await api('/store/desk?branchId=1')).body;
    assert.equal(desk.store.id, S.store, 'the department is one place: the central store');
    assert.ok(desk.sitesOwed.length >= 1);
    assert.equal(desk.inTransit.length, 0, 'nothing on the road yet');

    const prns = (await api('/store/prns?branchId=1')).body;
    const a = prns.rows.find((r) => r.indent_id === S.inda);
    assert.ok(a, 'site A\'s PRN, still owed');
    assert.equal(Number(a.to_deliver_qty), 60);
    assert.equal(Number(a.can_send_qty), 60, 'and the store holds enough to answer it');

    const sheet = (await api(`/store/issue?branchId=1&indentIds=${S.inda}`)).body;
    assert.equal(sheet.site.id, S.sitea);
    assert.equal(sheet.lines.length, 1);
    assert.equal(Number(sheet.lines[0].toDeliverQty), 60, 'what this PRN is still owed');
    assert.equal(Number(sheet.lines[0].storeQty), 100, 'and what the shelf holds against it');
  });

  test('one challan goes to one site, whatever the PRNs say', async (t) => {
    if (!live) return t.skip('no database');
    const r = await api(`/store/issue?branchId=1&indentIds=${S.inda},${S.indb}`);
    assert.equal(r.status, 400);
    assert.match(r.body.error.message, /different sites/);
  });

  test('a challan leaves the store the moment it is dispatched', async (t) => {
    if (!live) return t.skip('no database');
    const r = await api('/challans', { method: 'POST', body: {
      fromSiteId: S.store, toSiteId: S.sitea, dcDate: '2026-09-25',
      vehicleNo: 'TS09 AB 1234', dispatch: true,
      lines: [{ itemId: S.box, qty: 60 }] } });
    assert.equal(r.status, 201);
    assert.equal(r.body.state, 'IN_TRANSIT');
    S.dc = r.body.id;

    const [[store]] = await pool.query(
      `SELECT qty FROM v_stock_balance WHERE site_id = ? AND item_id = ?`, [S.store, S.box]);
    assert.equal(Number(store.qty), 40, '100 less the 60 that left');

    const [[site]] = await pool.query(
      `SELECT COUNT(*) AS n FROM v_stock_balance WHERE site_id = ? AND item_id = ?`,
      [S.sitea, S.box]);
    assert.equal(Number(site.n), 0, 'and it is not the site\'s until they sign');
  });

  test('in transit belongs to nobody, and both screens say so', async (t) => {
    if (!live) return t.skip('no database');
    const ind = (await api(`/indents/${S.inda}`)).body;
    assert.equal(ind.pipeline.stage, 'IN_TRANSIT');
    assert.equal(Number(ind.pipeline.in_transit_qty), 60);
    assert.equal(Number(ind.pipeline.at_site_qty), 0);

    const pending = (await api('/challans?branchId=1&state=PENDING')).body;
    assert.equal(pending.length, 1);
    assert.equal(Number(pending[0].in_transit_qty), 60);
  });

  test('the site signs for part of it, and the rest stays outstanding', async (t) => {
    if (!live) return t.skip('no database');
    const pend = (await api(`/challans/${S.dc}/pending`)).body;
    const r = await api(`/challans/${S.dc}/acknowledge`, { method: 'POST', body: {
      ackDate: '2026-09-26', note: 'two bundles short on the lorry',
      lines: [{ dcLineId: pend.lines[0].dc_line_id, qty: 45 }] } });
    assert.equal(r.status, 201);
    assert.equal(r.body.state, 'PART_ACK');
    assert.equal(Number(r.body.inTransitQty), 15);

    const [[site]] = await pool.query(
      `SELECT qty FROM v_stock_balance WHERE site_id = ? AND item_id = ?`, [S.sitea, S.box]);
    assert.equal(Number(site.qty), 45, 'only what was signed for is theirs');

    const ind = (await api(`/indents/${S.inda}`)).body;
    assert.equal(ind.pipeline.stage, 'PART_AT_SITE');
    assert.equal(Number(ind.pipeline.at_site_qty), 45);
    assert.equal(Number(ind.pipeline.in_transit_qty), 15);
  });

  test('a site cannot sign for more than was sent', async (t) => {
    if (!live) return t.skip('no database');
    const pend = (await api(`/challans/${S.dc}/pending`)).body;
    const r = await api(`/challans/${S.dc}/acknowledge`, { method: 'POST', body: {
      ackDate: '2026-09-27',
      lines: [{ dcLineId: pend.lines[0].dc_line_id, qty: 40 }] } });
    assert.equal(r.status, 409);
    assert.match(r.body.error.message, /15 is still unaccounted for/);
  });

  test('the last of it arrives and the challan closes', async (t) => {
    if (!live) return t.skip('no database');
    const pend = (await api(`/challans/${S.dc}/pending`)).body;
    const r = await api(`/challans/${S.dc}/acknowledge`, { method: 'POST', body: {
      ackDate: '2026-09-28', lines: [{ dcLineId: pend.lines[0].dc_line_id, qty: 15 }] } });
    assert.equal(r.body.state, 'ACKNOWLEDGED');
    assert.equal(Number(r.body.inTransitQty), 0);

    const ind = (await api(`/indents/${S.inda}`)).body;
    assert.equal(ind.pipeline.stage, 'AT_SITE');
    assert.equal(Number(ind.pipeline.at_site_qty), 60, 'the whole requirement, at the site');
    assert.equal(Number(ind.pipeline.to_deliver_qty), 0);

    const dc = (await api(`/challans/${S.dc}`)).body;
    assert.equal(dc.acks.length, 2, 'both signatures on the record');
  });

  test('a store cannot send what it does not hold', async (t) => {
    if (!live) return t.skip('no database');
    const r = await api('/challans', { method: 'POST', body: {
      fromSiteId: S.store, toSiteId: S.siteb, dcDate: '2026-09-28',
      lines: [{ itemId: S.box, qty: 999 }] } });
    assert.equal(r.status, 409);
    assert.match(r.body.error.message, /the store holds 40/);
  });

  test('each ledger belongs to the place the movement happened', async (t) => {
    if (!live) return t.skip('no database');
    const store = (await api('/store/movements?branchId=1')).body;
    assert.ok(store.rows.every((m) => Number(m.site_id) === S.store),
      'the store department is the store, and nowhere else');
    assert.ok(store.rows.some((m) => m.kind === 'GRN' && m.direction === 'IN'));
    assert.ok(store.rows.some((m) => m.kind === 'DC_OUT' && m.direction === 'OUT'));
    assert.ok(!store.rows.some((m) => m.kind === 'DC_IN'),
      'what a site signed for is the site\'s ledger, not the store\'s');

    const site = (await api(`/site-store/${S.sitea}/movements`)).body;
    assert.ok(site.rows.some((m) => m.kind === 'DC_IN' && m.direction === 'IN'));

    const oneDay = (await api('/store/movements?branchId=1&from=2026-09-25&to=2026-09-25')).body;
    assert.equal(oneDay.rows.length, 1, 'just what moved that day');
    assert.equal(Number(oneDay.rows[0].qty), -60, 'the lorry that left');
  });

  test('movements gather back into the documents that caused them', async (t) => {
    if (!live) return t.skip('no database');
    const m = (await api('/store/movements?branchId=1')).body;
    assert.ok(m.docs.length >= 2, 'GRN notes and a challan');
    assert.ok(m.docs.some((d) => d.refType === 'GRN'));
    const dc = m.docs.find((d) => d.refType === 'DC');
    assert.ok(dc && dc.refNo.startsWith('DC/'), 'and each names the document you can open');
  });

  test('a document in the ledger opens to show what was in it', async (t) => {
    if (!live) return t.skip('no database');
    const m = (await api('/store/movements?branchId=1')).body;

    const d = m.docs.find((x) => x.refType === 'DC');
    const dc = (await api(`/store/document/DC/${d.refId}`)).body;
    assert.equal(dc.docNo, d.refNo);
    assert.ok(dc.lines.length >= 1, 'the items that were on the lorry');
    assert.ok(dc.prns.length >= 1, 'and which PRNs it was answering');
    assert.equal(dc.href, `/challans/${d.refId}`, 'with a way through to the whole thing');

    const g = m.docs.find((x) => x.refType === 'GRN');
    const note = (await api(`/store/document/GRN/${g.refId}`)).body;
    assert.ok(note.po.docNo.startsWith('PO/'), 'the order it answered');
    assert.ok(note.lines.every((l) => Number(l.ordered_qty) >= Number(l.qty)),
      'nothing was taken in beyond what was ordered');

    const bad = await api('/store/document/PO/1');
    assert.equal(bad.status, 400, 'and it only opens the two it knows');
  });

  test('a challan carries its own history, the way an order does', async (t) => {
    if (!live) return t.skip('no database');
    const dc = (await api(`/challans/${S.dc}`)).body;
    const actions = dc.events.map((e) => e.action);
    assert.ok(actions.includes('Dispatched'));
    assert.ok(actions.some((a) => /part received/i.test(a)));
    assert.ok(actions.some((a) => /received in full/i.test(a)));
    assert.ok(dc.events.every((e) => e.user_name), 'every step says who');
    assert.equal(dc.state, 'ACKNOWLEDGED', 'and it reads completed once nothing is outstanding');
    assert.equal(Number(dc.in_transit_qty), 0);
  });

  test('the store is valued at what it last paid', async (t) => {
    if (!live) return t.skip('no database');
    const st = (await api(`/store/stock?storeId=${S.store}`)).body;
    const box = st.rows.find((r) => Number(r.item_id) === S.box);
    assert.equal(Number(box.qty), 40);
    assert.equal(Number(box.latest_rate), 112, 'the rate the GM signed');
    assert.equal(Number(box.value), 40 * 112);

    const q = (await api(`/store/stock?storeId=${S.store}&q=metal`)).body;
    assert.ok(q.rows.length >= 1, 'and the shelf can be searched by item');
  });

  /* ----------------------------------- several PRNs on one lorry */

  test('several PRNs of one site become one line on one challan', async (t) => {
    if (!live) return t.skip('no database');
    const lines = (await api(`/indents/boq/${S.boqa}/lines`)).body;
    const box = lines.find((l) => l.item_id === S.box);
    S.pair = [];
    for (const q of [15, 20]) {
      const r = await api('/indents', { method: 'POST', body: {
        siteId: S.sitea, indentDate: '2026-09-29', neededBy: '2026-10-05',
        lines: [{ boqLineId: box.boq_line_id, qty: q }], send: true } });
      await signOff(api, `/indents/${r.body.id}/decide`);
      S.pair.push(r.body.id);
    }

    const sheet = (await api(`/store/issue?branchId=1&indentIds=${S.pair.join(',')}`)).body;
    assert.equal(sheet.lines.length, 2, 'a row each, because what is answered matters');
    assert.ok(sheet.lines.every((l) => Number(l.storeQty) === 40),
      'and one shelf between them, shown once');

    const over = await api('/challans', { method: 'POST', body: {
      fromSiteId: S.store, toSiteId: S.sitea, dcDate: '2026-09-30',
      lines: [{ indentId: S.pair[0], itemId: S.box, qty: 30 }] } });
    assert.equal(over.status, 409);
    assert.match(over.body.error.message, /still owed 15/);

    const r = await api('/challans', { method: 'POST', body: {
      fromSiteId: S.store, toSiteId: S.sitea, dcDate: '2026-09-30',
      vehicleNo: 'TS09 CD 5678', dispatch: true,
      lines: [
        { indentId: S.pair[0], itemId: S.box, qty: 15 },
        { indentId: S.pair[1], itemId: S.box, qty: 20 },
      ] } });
    assert.equal(r.status, 201);
    assert.equal(Number(r.body.sentQty), 35);
    S.dc2 = r.body.id;

    const dc = (await api(`/challans/${S.dc2}`)).body;
    assert.equal(dc.lines.length, 1, 'two PRNs asking for one item is one line on the lorry');
    assert.equal(Number(dc.lines[0].sent_qty), 35);
    assert.equal(dc.prns.length, 2, 'and the challan says which two it is answering');
    assert.deepEqual(dc.prns.map((p) => Number(p.on_this_dc)).sort((a, b) => a - b), [15, 20]);
  });

  test('a PRN shows how much of itself has been sent', async (t) => {
    if (!live) return t.skip('no database');
    const prns = (await api('/store/prns?branchId=1')).body;
    const first = prns.rows.find((r) => r.indent_id === S.pair[0]);
    assert.equal(Number(first.issued_qty), 15, 'sent');
    assert.equal(Number(first.in_transit_qty), 15, 'and still on the road');
    assert.equal(Number(first.at_site_qty), 0, 'nobody has signed for it');
    assert.equal(first.stage, 'IN_TRANSIT');

    assert.ok(!prns.rows.some((r) => r.indent_id === S.inda),
      'a PRN that has been fulfilled falls off the list');
  });

  test('the storekeeper chooses which shelf to issue from', async (t) => {
    if (!live) return t.skip('no database');
    const r = await api('/sites/stores', { method: 'POST', body: {
      name: 'Yard Store Medchal', branchId: 1, keeperUserId: 3 } });
    assert.equal(r.status, 201);
    S.store2 = r.body.id;

    const ids = S.pair.join(',');
    const central = (await api(`/store/issue?branchId=1&indentIds=${ids}&storeId=${S.store}`)).body;
    const yard = (await api(`/store/issue?branchId=1&indentIds=${ids}&storeId=${S.store2}`)).body;
    assert.equal(central.store.id, S.store);
    assert.equal(yard.store.id, S.store2, 'the sheet answers for the shelf you picked');

    assert.ok(central.lines.every((l) => Number(l.storeQty) === 5),
      'what the central store has left after the last lorry');
    assert.ok(yard.lines.every((l) => Number(l.storeQty) === 0), 'the yard holds none of it');
    assert.deepEqual(
      central.lines.map((l) => Number(l.toDeliverQty)),
      yard.lines.map((l) => Number(l.toDeliverQty)),
      'the requirement belongs to the site, not to whichever shelf answers it');

    const bad = await api('/challans', { method: 'POST', body: {
      fromSiteId: S.store2, toSiteId: S.sitea, dcDate: '2026-10-01',
      lines: [{ indentId: S.pair[0], itemId: S.box, qty: 5 }] } });
    assert.equal(bad.status, 409);
    assert.match(bad.body.error.message, /the store holds 0/);

    const nope = await api(`/store/issue?branchId=1&indentIds=${ids}&storeId=${S.sitea}`);
    assert.equal(nope.status, 404, 'a site is not a shelf you can issue from');
  });

  test('a PRN is everyone\'s to fulfil, but the shelf is not', async (t) => {
    if (!live) return t.skip('no database');
    const a = (await api(`/store/prns?branchId=1&storeId=${S.store}`)).body;
    const b = (await api(`/store/prns?branchId=1&storeId=${S.store2}`)).body;
    assert.deepEqual(a.rows.map((r) => r.indent_id), b.rows.map((r) => r.indent_id),
      'every store sees every PRN');
    assert.ok(a.totals.canSend > 0);
    assert.equal(b.totals.canSend, 0, 'but only one of them can answer it today');
  });

  test('an order is signed for where it was sent, and nowhere else', async (t) => {
    if (!live) return t.skip('no database');
    const pend = (await api(`/purchase-orders/${S.po}/pending`)).body;
    const line = pend.lines[0] || { po_line_id: 1 };

    const wrong = await api(`/purchase-orders/${S.po}/receipts`, { method: 'POST', body: {
      receiptDate: '2026-10-02', atSiteId: S.store2,
      lines: [{ poLineId: line.po_line_id, qty: 1 }] } });
    assert.equal(wrong.status, 409);
    assert.match(wrong.body.error.message, /cannot receive it/);
    assert.match(wrong.body.error.message, /Central Store Hyderabad/);
  });

  test('each store answers for its own shelf and its own orders', async (t) => {
    if (!live) return t.skip('no database');
    const stores = (await api('/store/stores?branchId=1')).body;
    assert.equal(stores.length, 2);
    assert.equal(stores[0].id, S.store, 'the central one leads');
    assert.ok(Number(stores[0].items) > 0);
    assert.equal(Number(stores[1].items), 0, 'the yard holds nothing yet');

    const yard = (await api(`/grns/desk?branchId=1&storeId=${S.store2}`)).body;
    assert.equal(yard.place.id, S.store2);
    assert.equal(yard.pending.length, 0, 'no order was ever sent to the yard');
    assert.equal(yard.history.length, 0, 'so it has no notes');

    const central = (await api(`/grns/desk?branchId=1&storeId=${S.store}`)).body;
    assert.ok(central.history.length >= 2, 'while the central store has taken deliveries in');

    const yardStock = (await api(`/store/stock?branchId=1&storeId=${S.store2}`)).body;
    assert.equal(yardStock.rows.length, 0);
    const yardMoves = (await api(`/store/movements?branchId=1&storeId=${S.store2}`)).body;
    assert.equal(yardMoves.rows.length, 0, 'and nothing has ever moved through it');
  });

  test('a signature records what was counted, not just how much', async (t) => {
    if (!live) return t.skip('no database');
    const dc = (await api(`/challans/${S.dc}`)).body;
    assert.equal(dc.acks.length, 2);
    assert.ok(dc.acks.every((a) => a.lines.length >= 1),
      'a slip has to say what came off the lorry');
    assert.equal(Number(dc.acks[0].lines[0].sent_qty), 60, 'against what was on it');
    assert.equal(Number(dc.acks[0].qty), 45);
    assert.equal(Number(dc.acks[1].qty), 15);
  });

  /* ------------------------------------- the site signs, not the store */

  test('what is directed at a site waits in that site\'s own inbox', async (t) => {
    if (!live) return t.skip('no database');
    const inbox = (await api(`/site-store/${S.sitea}/inbox`)).body;
    assert.equal(inbox.challans.length, 1, 'one lorry waiting for a signature');
    assert.equal(Number(inbox.challans[0].in_transit_qty), 35);
    assert.ok(inbox.challans[0].prns.includes('PRN/'), 'and it says which PRNs it answers');
    assert.ok(inbox.signed.length >= 1, 'beside what this site has already signed');

    const other = (await api(`/site-store/${S.siteb}/inbox`)).body;
    assert.equal(other.challans.length, 0, 'and it is nobody else\'s to sign');
  });

  test('the site shelf carries quantities, never rates', async (t) => {
    if (!live) return t.skip('no database');
    const st = (await api(`/site-store/${S.sitea}/stock`)).body;
    const box = st.rows.find((r) => Number(r.item_id) === S.box);
    assert.equal(Number(box.qty), 60, 'only what the site has signed for');
    assert.equal(Number(box.incoming_qty), 35, 'and what is still on the road to it');
    assert.ok(!('latest_rate' in box) && !('value' in box),
      'the site never bought this and has no business pricing it');
  });

  /* ------------------------------------------------ the GRN register */

  test('acknowledging a delivery is what produces the note', async (t) => {
    if (!live) return t.skip('no database');
    const desk = (await api('/grns/desk?branchId=1')).body;
    assert.equal(desk.place.id, S.store, 'the store signs for what was sent to the store');
    assert.ok(desk.history.length >= 2, 'a note for every delivery it has taken in');
    assert.ok(desk.history.every((g) => g.status === 'CONFIRMED'));

    const g = (await api(`/grns/${desk.history[0].grn_id}`)).body;
    assert.ok(g.lines.length >= 1);
    assert.ok(g.lines[0].against.includes('PRN/'), 'the note says which PRN it is answering');
    assert.equal(g.moves.length, g.lines.length, 'and the stock each line put on the shelf');
    assert.ok(g.po, 'read without leaving it: where the order now stands');

    const reg = (await api('/grns?branchId=1')).body;
    assert.ok(reg.rows.length >= 2);
    assert.ok(reg.rows.every((r) => r.po_no.startsWith('PO/')));

    const byItem = (await api(`/grns?branchId=1&itemId=${S.box}`)).body;
    assert.ok(byItem.rows.length >= 1, 'and the register can be asked about one item');
  });
});
