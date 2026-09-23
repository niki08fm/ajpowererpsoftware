'use strict';
/**
 * Sourcing a PRN from another site, and reordering what was lent.
 *
 * Two things matter more than the happy path, and both are about not
 * counting material twice:
 *
 *   the lending site's replacement PRN must not move its BOQ or its
 *   billing ceiling, and
 *
 *   the transfer must never appear in the central store's ledger,
 *   because the material never went near the store.
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

const today = () => new Date().toISOString().slice(0, 10);

/** A site with a work order, a locked BOQ and one item on it. */
async function siteWithBoq(name, itemId, woQty, estQty) {
  const site = (await api('/sites', { method: 'POST', body: {
    name, branchId: 1, clientId: 1, headUserId: 2, keeperUserId: 3, gmUserId: 5 } })).body;
  const wo = (await api('/work-orders', { method: 'POST', body: {
    siteId: site.id, woDate: today(),
    lines: [{ description: `${name} scope`, uom: "No's", qty: woQty, supplyRate: 1000 }] } })).body;
  const prep = (await api('/boq/prepare', { method: 'POST', body: { workOrderId: wo.id } })).body;
  const sheet = (await api(`/boq/${prep.boqId}`)).body;
  await api(`/boq/${prep.boqId}/wo-line/${sheet.woLines[0].wo_line_id}`, { method: 'PUT', body: {
    estQty, items: [{ itemId, itemQty: 1 }] } });
  await api(`/boq/${prep.boqId}/submit`, { method: 'POST', body: { overAllow: true, overPct: 100 } });
  await signOff(api, `/boq/${prep.boqId}/decide`);
  const lines = (await api(`/indents/boq/${prep.boqId}/lines`)).body;
  return { id: site.id, name, boqId: prep.boqId, boqLineId: lines[0].boq_line_id, woId: wo.id };
}

describe('sourcing a PRN from another site', () => {
  const S = {};

  test('a store, a site holding stock, and a site that needs some', async (t) => {
    if (!live) return t.skip('no database');
    S.box = (await api('/items/search?q=metal%20box')).body[0].id;

    const store = await api('/sites/stores', { method: 'POST', body: {
      name: 'Central Store Hyd', branchId: 1, keeperUserId: 3 } });
    S.store = store.body.id;
    await pool.query('UPDATE sites SET is_central = 1 WHERE id = ?', [S.store]);

    S.a = await siteWithBoq('Lending Site A', S.box, 100, 100);
    S.b = await siteWithBoq('Needing Site B', S.box, 50, 50);

    // A indented 60 for its own work and it arrived; that is why it has
    // stock to lend, and why a replacement must not count twice
    const ind = await api('/indents', { method: 'POST', body: {
      siteId: S.a.id, indentDate: today(),
      lines: [{ boqLineId: S.a.boqLineId, qty: 60 }], send: true } });
    await signOff(api, `/indents/${ind.body.id}/decide`);
    await pool.query(
      `INSERT INTO stock_movements (site_id, item_id, qty, rate, kind, ref_no, moved_on)
       VALUES (?, ?, 60, 112, 'GRN', 'SEED', ?)`, [S.a.id, S.box, today()]);

    const boq = (await api(`/boq/${S.a.boqId}`)).body;
    S.aIndentedBefore = Number(boq.woLines[0].items[0].committed_qty);
    assert.equal(S.aIndentedBefore, 60, 'A has indented 60 against its own BOQ');
  });

  test('B raises an ordinary PRN', async (t) => {
    if (!live) return t.skip('no database');
    const ind = await api('/indents', { method: 'POST', body: {
      siteId: S.b.id, indentDate: today(), neededBy: today(),
      lines: [{ boqLineId: S.b.boqLineId, qty: 20 }], send: true } });
    await signOff(api, `/indents/${ind.body.id}/decide`);
    S.prn = ind.body.id;
    S.prnNo = ind.body.docNo;
  });

  /* ------------------------------------------- the store asks A to send */

  test('only the central store may raise a transfer request', async (t) => {
    if (!live) return t.skip('no database');
    const r = await api('/transfers', { method: 'POST', body: {
      storeId: S.a.id, fromSiteId: S.a.id, indentId: S.prn, requestDate: today(),
      lines: [{ itemId: S.box, qty: 20 }] } });
    assert.equal(r.status, 400, 'a site is not a store');
  });

  test('it cannot ask for more than the sending site holds', async (t) => {
    if (!live) return t.skip('no database');
    const r = await api('/transfers', { method: 'POST', body: {
      storeId: S.store, fromSiteId: S.a.id, indentId: S.prn, requestDate: today(),
      lines: [{ itemId: S.box, qty: 500 }] } });
    assert.equal(r.status, 409);
    assert.match(r.body.error.message, /holds 60/);
  });

  test('the store asks A to send against B’s PRN', async (t) => {
    if (!live) return t.skip('no database');
    const r = await api('/transfers', { method: 'POST', body: {
      storeId: S.store, fromSiteId: S.a.id, indentId: S.prn, requestDate: today(),
      neededBy: today(), note: 'A has it on the shelf',
      lines: [{ itemId: S.box, qty: 20 }] } });
    assert.equal(r.status, 201);
    assert.match(r.body.docNo, /^TR\//);
    assert.equal(r.body.state, 'AWAITING');
    assert.equal(r.body.from.id, S.a.id);
    assert.equal(r.body.to.id, S.b.id, 'the receiver is whoever owns the PRN');
    assert.equal(r.body.indent.docNo, S.prnNo);
    S.tr = r.body.id;
  });

  test('it shows on the sending site’s list, with what that site holds', async (t) => {
    if (!live) return t.skip('no database');
    const list = (await api(`/transfers?fromSiteId=${S.a.id}`)).body;
    assert.equal(list.rows.length, 1);
    assert.equal(list.totals.awaiting, 1);

    const d = (await api(`/transfers/${S.tr}`)).body;
    assert.equal(d.lines[0].heldQty, 60);
    assert.equal(d.lines[0].shortBy, 0);
  });

  test('nothing may be sent before A accepts, and a refusal must say why', async (t) => {
    if (!live) return t.skip('no database');
    const early = await api('/challans', { method: 'POST', body: {
      fromSiteId: S.a.id, toSiteId: S.b.id, dcDate: today(),
      lines: [{ itemId: S.box, qty: 20, trId: S.tr }] } });
    assert.equal(early.status, 409);
    assert.match(early.body.error.message, /has not been accepted/);

    const bare = await api(`/transfers/${S.tr}/decide`, { method: 'POST', body: { action: 'REJECTED' } });
    assert.equal(bare.status, 400);
  });

  test('A accepts and sends it on an ordinary challan', async (t) => {
    if (!live) return t.skip('no database');
    const ok = await api(`/transfers/${S.tr}/decide`, { method: 'POST', body: { action: 'ACCEPTED' } });
    assert.equal(ok.body.state, 'TO_SEND');

    const over = await api('/challans', { method: 'POST', body: {
      fromSiteId: S.a.id, toSiteId: S.b.id, dcDate: today(),
      lines: [{ itemId: S.box, qty: 30, trId: S.tr }] } });
    assert.equal(over.status, 409, 'more than the request asked for');

    const dc = await api('/challans', { method: 'POST', body: {
      fromSiteId: S.a.id, toSiteId: S.b.id, dcDate: today(), dispatch: true,
      lines: [{ itemId: S.box, qty: 20, trId: S.tr }] } });
    assert.equal(dc.status, 201);
    S.dc = dc.body.id;

    const stock = (await api(`/site-store/${S.a.id}/stock`)).body;
    assert.equal(Number(stock.rows.find((r) => r.item_id === S.box).qty), 40, '60 less 20');
  });

  test('a challan nobody signs for within a day is an alert, and so is a short delivery', async (t) => {
    if (!live) return t.skip('no database');
    const mgmt = as(api, MANAGEMENT);
    const mine = async () => (await mgmt('/alerts')).body.rows.find((r) => r.key === `dc-${S.dc}`);

    assert.equal(await mine(), undefined, 'dispatched just now: not late yet');
    await pool.query(
      'UPDATE delivery_challans SET dispatched_at = NOW() - INTERVAL 2 DAY WHERE id = ?', [S.dc]);
    assert.equal((await mine())?.kind, 'NOT_SIGNED', 'a day on and nothing entered by the site');
    assert.equal((await api('/alerts')).body.count, 0, 'a Planning login gets no alerts');

    const pending = (await api(`/challans/${S.dc}/pending`)).body;
    const part = await api(`/challans/${S.dc}/acknowledge`, { method: 'POST', body: {
      ackDate: today(), lines: [{ dcLineId: pending.lines[0].dc_line_id, qty: 5 }] } });
    assert.equal(part.status, 201);
    const short = await mine();
    assert.equal(short?.kind, 'SHORT_DELIVERY', 'signed for less than was sent');
    assert.match(short.detail, /5 of 20 signed for/);
  });

  test('to B it is simply its own PRN arriving', async (t) => {
    if (!live) return t.skip('no database');
    const inbox = (await api(`/site-store/${S.b.id}/inbox`)).body;
    const mine = inbox.challans.find((c) => c.dc_id === S.dc);
    assert.ok(mine, 'an ordinary challan in the ordinary inbox');
    assert.match(String(mine.prns), new RegExp(S.prnNo.replace(/\//g, '\\/')),
      'and it names the PRN it answers');

    const pending = (await api(`/challans/${S.dc}/pending`)).body;
    const ack = await api(`/challans/${S.dc}/acknowledge`, { method: 'POST', body: {
      ackDate: today(),
      lines: pending.lines.map((l) => ({ dcLineId: l.dc_line_id, qty: Number(l.in_transit_qty) })) } });
    assert.equal(ack.status, 201);
    assert.ok(!(await as(api, MANAGEMENT)('/alerts')).body.rows.some((r) => r.key === `dc-${S.dc}`),
      'received in full: the alert is gone by itself');

    // B's PRN is satisfied, exactly as if the store had sent it
    const flow = (await api(`/indents/${S.prn}`)).body;
    assert.ok(flow, 'the PRN reads back');
    const [[owed]] = await pool.query(
      'SELECT COALESCE(SUM(to_deliver_qty), 0) q FROM v_indent_item_flow WHERE indent_id = ?', [S.prn]);
    assert.equal(Number(owed.q), 0, 'nothing is still owed on it');
  });

  test('the transfer never touches the central store’s ledger', async (t) => {
    if (!live) return t.skip('no database');
    const [[n]] = await pool.query(
      'SELECT COUNT(*) n FROM stock_movements WHERE site_id = ?', [S.store]);
    assert.equal(Number(n.n), 0, 'the material never went near the store');

    const moves = (await api(`/store/movements?storeId=${S.store}`)).body;
    assert.equal(moves.rows.length, 0, 'so the store ledger shows none of it');
  });

  /* ------------------------------------------------- the history screen */

  test('A gets its transfer history, document by document', async (t) => {
    if (!live) return t.skip('no database');
    const h = (await api(`/transfers/site/${S.a.id}/history`)).body;
    assert.equal(h.docs.length, 1);
    const d = h.docs[0];
    assert.equal(d.to.id, S.b.id);
    assert.equal(d.sentQty, 20);
    assert.equal(d.ackedQty, 20, 'and what the far end actually signed for');
    assert.match(d.prns, new RegExp(S.prnNo.replace(/\//g, '\\/')));
    assert.equal(d.items.length, 1, 'with the items inside that document');
    assert.equal(d.items[0].sentQty, 20);
  });

  /* ------------------------------------------------ reordering the stock */

  test('the reorder sheet shows what was lent and what is left to ask for', async (t) => {
    if (!live) return t.skip('no database');
    const r = (await api(`/transfers/site/${S.a.id}/lent-out`)).body;
    assert.equal(r.rows.length, 1);
    assert.equal(r.rows[0].lentQty, 20);
    assert.equal(r.rows[0].reorderedQty, 0);
    assert.equal(r.rows[0].toReorderQty, 20);
  });

  test('a site cannot reorder more than it lent', async (t) => {
    if (!live) return t.skip('no database');
    const r = await api(`/transfers/site/${S.a.id}/reorder`, { method: 'POST', body: {
      indentDate: today(), lines: [{ itemId: S.box, qty: 25 }] } });
    assert.equal(r.status, 409);
    assert.match(r.body.error.message, /20 is left to reorder/);
  });

  test('the reorder is an ordinary PRN to the store', async (t) => {
    if (!live) return t.skip('no database');
    const r = await api(`/transfers/site/${S.a.id}/reorder`, { method: 'POST', body: {
      indentDate: today(), neededBy: today(), lines: [{ itemId: S.box, qty: 20 }] } });
    assert.equal(r.status, 201);
    assert.equal(r.body.kind, 'REPLACEMENT');
    S.reorder = r.body.id;

    await signOff(api, `/indents/${S.reorder}/decide`);
    const prns = (await api(`/store/prns?storeId=${S.store}&show=ALL`)).body;
    assert.ok(prns.rows.some((x) => x.indent_id === S.reorder),
      'the store has to fulfil it like any other PRN');
  });

  /* ========== the rule the whole feature rests on ========== */

  test('the reorder does NOT count again against the BOQ', async (t) => {
    if (!live) return t.skip('no database');
    const boq = (await api(`/boq/${S.a.boqId}`)).body;
    const line = boq.woLines[0].items[0];
    assert.equal(Number(line.committed_qty), S.aIndentedBefore,
      'still 60 — A indented that material once, and lending it out did not make it twice');
    assert.equal(boq.state !== 'AMENDMENT_DUE', true, 'and no spurious amendment');
  });

  test('nor against what A may invoice', async (t) => {
    if (!live) return t.skip('no database');
    const [[w]] = await pool.query(
      'SELECT indented_qty q FROM v_wo_line_indented WHERE boq_id = ?', [S.a.boqId]);
    assert.equal(Number(w.q), 60, 'the billing ceiling did not move');
  });

  test('and the reorder sheet now shows it as asked for', async (t) => {
    if (!live) return t.skip('no database');
    const r = (await api(`/transfers/site/${S.a.id}/lent-out?show=ALL`)).body;
    assert.equal(r.rows[0].reorderedQty, 20);
    assert.equal(r.rows[0].toReorderQty, 0, 'nothing left to ask for');
  });

  test('B’s own PRN did count, because that was a real requirement', async (t) => {
    if (!live) return t.skip('no database');
    const boq = (await api(`/boq/${S.b.boqId}`)).body;
    assert.equal(Number(boq.woLines[0].items[0].committed_qty), 20,
      'B asked for 20 for its own scope and that is a claim on its work order');
  });
});
