'use strict';
/**
 * The Planning -> Site round trip, against a real database.
 *
 * Needs MySQL up and `npm run db:reset` already run. Skipped when
 * there is no database to talk to, so `npm test` still works without one.
 */
const { test, before, after, describe } = require('node:test');
const assert = require('node:assert');
const app = require('../src/app');
const { pool } = require('../src/config/db');

let server; let base; let live = false;
const api = (path, opts = {}) =>
  fetch(base + path, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  }).then(async (r) => ({ status: r.status, body: await r.json() }));

before(async () => {
  try { await pool.query('SELECT 1'); live = true; } catch { return; }
  server = app.listen(0);
  base = `http://127.0.0.1:${server.address().port}/api`;
  // start from clean transactional data, keep the masters
  for (const t of ['consumption_lines', 'consumptions',
    'indent_events', 'indent_lines', 'indents', 'boq_amendment_lines',
    'boq_amendments', 'boq_lines', 'boq_wo_lines', 'boqs',
    'work_order_lines', 'work_orders', 'site_team', 'sites']) {
    await pool.query(`DELETE FROM ${t}`);
  }
  await pool.query(`DELETE FROM doc_counters`);
  await pool.query(`DELETE FROM item_code_counters WHERE category_code IN ('ST','GD')`);
});
after(async () => { if (server) server.close(); await pool.end(); });

// the skip is decided per test, because a describe-level skip is
// evaluated before before() has had a chance to probe the database
describe('planning and site', () => {
  const S = {};

  test('a site is created and named uniquely', async (t) => {
    if (!live) return t.skip('no database');
    const r = await api('/sites', { method: 'POST', body: {
      name: 'GMR Aerocity - Block C', branchId: 1, clientId: 1,
      headUserId: 2, keeperUserId: 3, location: 'Shamshabad',
      billingAddress: 'GMR Infra Ltd, RGIA', startDate: '2026-09-01',
      targetCompletion: '2027-03-31', team: [4, 5] } });
    assert.equal(r.status, 201);
    assert.match(r.body.code, /^ST-\d{4}$/);
    S.siteId = r.body.id;

    const dupe = await api('/sites', { method: 'POST', body: {
      name: 'gmr  aerocity - block c', branchId: 1, clientId: 1, headUserId: 2, keeperUserId: 3 } });
    assert.equal(dupe.status, 409, 'the same name typed differently is refused');
  });

  test('completion before start is refused', async (t) => {
    if (!live) return t.skip('no database');
    const r = await api('/sites', { method: 'POST', body: {
      name: 'Backwards Dates Site', branchId: 1, clientId: 1, headUserId: 2, keeperUserId: 3,
      startDate: '2027-01-01', targetCompletion: '2026-01-01' } });
    assert.equal(r.status, 400);
  });

  test('the work order loads and values itself', async (t) => {
    if (!live) return t.skip('no database');
    const r = await api('/work-orders', { method: 'POST', body: {
      siteId: S.siteId, clientWoNo: 'GMR/EL/2026/114', woDate: '2026-09-01',
      lines: [
        { description: '1No 6/16A Socket with Back Box', uom: "No's", qty: 10, supplyRate: 900, instRate: 100 },
        { description: '2No 10A Socket without Back Box', uom: "No's", qty: 20, supplyRate: 800, instRate: 100 },
      ] } });
    assert.equal(r.status, 201);
    assert.equal(Number(r.body.value), 10 * 1000 + 20 * 900);
    S.woId = r.body.id;
  });

  test('one work order per site', async (t) => {
    if (!live) return t.skip('no database');
    const r = await api('/work-orders', { method: 'POST', body: {
      siteId: S.siteId, woDate: '2026-09-01',
      lines: [{ description: 'A second work order', uom: "No's", qty: 1, supplyRate: 1 }] } });
    assert.equal(r.status, 409);
  });

  test('BOQ qty is item qty x work order qty, est follows the line estimate', async (t) => {
    if (!live) return t.skip('no database');
    const prep = await api('/boq/prepare', { method: 'POST', body: { workOrderId: S.woId } });
    S.boqId = prep.body.boqId;
    const sheet = (await api(`/boq/${S.boqId}`)).body;
    const [w1, w2] = sheet.woLines;

    const find = async (q) => (await api(`/items/search?q=${encodeURIComponent(q)}`)).body[0].id;
    const box = await find('metal box'), plate = await find('front plate');
    const sw = await find('16a switch'), sock = await find('6/16a socket');

    await api(`/boq/${S.boqId}/wo-line/${w1.wo_line_id}`, { method: 'PUT', body: {
      estQty: 12,
      items: [box, plate, sw, sock].map((itemId) => ({ itemId, itemQty: 1 })) } });
    await api(`/boq/${S.boqId}/wo-line/${w2.wo_line_id}`, { method: 'PUT', body: {
      estQty: 25,
      items: [{ itemId: plate, itemQty: 1 }, { itemId: sw, itemQty: 1 }, { itemId: sock, itemQty: 2 }] } });

    const after = (await api(`/boq/${S.boqId}`)).body;
    assert.equal(after.remaining, 0);
    const l1 = after.woLines[0].items, l2 = after.woLines[1].items;
    assert.deepEqual(l1.map((i) => i.sno), ['1a', '1b', '1c', '1d']);
    assert.ok(l1.every((i) => Number(i.boq_qty) === 10 && Number(i.est_qty) === 12));
    const twice = l2.find((i) => Number(i.item_qty) === 2);
    assert.equal(Number(twice.boq_qty), 40, '2 per unit x 20 = 40');
    assert.equal(Number(twice.est_qty), 50, 'and the estimate doubles with it');
    S.line1a = l1[0].boq_line_id;
  });

  test('the same item twice on one work order line is refused', async (t) => {
    if (!live) return t.skip('no database');
    const sheet = (await api(`/boq/${S.boqId}`)).body;
    const item = sheet.woLines[0].items[0].item_id;
    const r = await api(`/boq/${S.boqId}/wo-line/${sheet.woLines[0].wo_line_id}`, {
      method: 'PUT', body: { estQty: 12, items: [{ itemId: item, itemQty: 1 }, { itemId: item, itemQty: 2 }] } });
    assert.equal(r.status, 400);
    // and the line survived the rejection intact
    const back = (await api(`/boq/${S.boqId}`)).body;
    assert.equal(back.woLines[0].items.length, 4);
  });

  test('submitting stores the overspill policy', async (t) => {
    if (!live) return t.skip('no database');
    const r = await api(`/boq/${S.boqId}/submit`, { method: 'POST', body: { overAllow: true, overPct: 10 } });
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.policy, { overAllow: true, overPct: 10 });
  });

  test('a draft indent holds no quantity', async (t) => {
    if (!live) return t.skip('no database');
    const before = (await api(`/indents/boq/${S.boqId}/lines`)).body[0];
    assert.equal(Number(before.balance), 12);

    const d = await api('/indents', { method: 'POST', body: {
      siteId: S.siteId, indentDate: '2026-09-05',
      lines: [{ boqLineId: S.line1a, qty: 10 }], send: false } });
    assert.equal(d.body.status, 'DRAFT');
    S.indentId = d.body.id;

    const after = (await api(`/indents/boq/${S.boqId}/lines`)).body[0];
    assert.equal(Number(after.committed_qty), 0, 'a cart is not a commitment');
    assert.equal(Number(after.balance), 12);
  });

  test('over the estimate but inside the ceiling is amber', async (t) => {
    if (!live) return t.skip('no database');
    const r = await api('/indents/evaluate', { method: 'POST', body: {
      boqId: S.boqId, lines: [{ boqLineId: S.line1a, qty: 13 }] } });
    assert.equal(r.body.severity, 'warn');
    assert.equal(r.body.over, 1);
  });

  test('past the ceiling is refused, and says how much room is left', async (t) => {
    if (!live) return t.skip('no database');
    const r = await api('/indents/evaluate', { method: 'POST', body: {
      boqId: S.boqId, lines: [{ boqLineId: S.line1a, qty: 20 }] } });
    assert.equal(r.status, 409);
    assert.match(r.body.error.message, /13\.2 is the most/);
  });

  test('editing the cart then submitting commits the quantity', async (t) => {
    if (!live) return t.skip('no database');
    await api(`/indents/${S.indentId}`, { method: 'PUT', body: {
      indentDate: '2026-09-05', lines: [{ boqLineId: S.line1a, qty: 13 }] } });
    const sent = await api(`/indents/${S.indentId}/submit`, { method: 'POST' });
    assert.equal(sent.body.status, 'SUBMITTED');

    const line = (await api(`/indents/boq/${S.boqId}/lines`)).body[0];
    assert.equal(Number(line.committed_qty), 13);
    assert.equal(Number(line.balance), -1, 'a negative balance is the signal');
    assert.equal(Number(line.over_qty), 1);
  });

  test('the BOQ turns to AMENDMENT_DUE and the indent carries the flag', async (t) => {
    if (!live) return t.skip('no database');
    const boq = (await api(`/boq/${S.boqId}`)).body;
    assert.equal(boq.state, 'AMENDMENT_DUE');
    assert.equal(boq.overLines, 1);

    const ind = (await api(`/indents/${S.indentId}`)).body;
    assert.equal(ind.severity, 'warn');
    assert.equal(ind.overLines, 1);
  });

  test('a submitted indent cannot be edited', async (t) => {
    if (!live) return t.skip('no database');
    const r = await api(`/indents/${S.indentId}`, { method: 'PUT', body: {
      lines: [{ boqLineId: S.line1a, qty: 5 }] } });
    assert.equal(r.status, 409);
  });

  test('the amendment adds the variation and clears the flag', async (t) => {
    if (!live) return t.skip('no database');
    const over = (await api(`/boq/${S.boqId}/over-lines`)).body;
    assert.equal(over.lines.length, 1);
    assert.equal(Number(over.lines[0].over_qty), 1);

    const r = await api(`/boq/${S.boqId}/amendments`, { method: 'POST', body: {
      reason: 'extra points on the east riser, approved by client',
      lines: [{ boqLineId: S.line1a, qty: 1 }] } });
    assert.equal(r.body.state, 'LOCKED');
    assert.equal(r.body.overLines, 0);

    const line = (await api(`/indents/boq/${S.boqId}/lines`)).body[0];
    assert.equal(Number(line.est_qty), 12);
    assert.equal(Number(line.var_qty), 1);
    assert.equal(Number(line.effective_est), 13, 'the estimate now covers what was raised');
    assert.equal(Number(line.balance), 0);
  });

  test('an amendment needs a reason', async (t) => {
    if (!live) return t.skip('no database');
    const r = await api(`/boq/${S.boqId}/amendments`, { method: 'POST', body: {
      reason: '', lines: [{ boqLineId: S.line1a, qty: 1 }] } });
    assert.equal(r.status, 400);
  });

  test('returning an indent makes it editable again', async (t) => {
    if (!live) return t.skip('no database');
    const r = await api(`/indents/${S.indentId}/decide`, { method: 'POST', body: {
      action: 'RETURNED', note: 'split it across two weeks' } });
    assert.equal(r.body.status, 'RETURNED');
    const ind = (await api(`/indents/${S.indentId}`)).body;
    assert.equal(ind.canEdit, true);
    assert.ok(ind.events.some((e) => e.action === 'RETURNED'));
  });

  test('a returned indent stops holding quantity', async (t) => {
    if (!live) return t.skip('no database');
    const line = (await api(`/indents/boq/${S.boqId}/lines`)).body[0];
    assert.equal(Number(line.committed_qty), 0);
  });

  test('document numbers are per financial year and sequential', async (t) => {
    if (!live) return t.skip('no database');
    const [rows] = await pool.query(`SELECT doc_type, fy, last_no FROM doc_counters ORDER BY doc_type`);
    const byType = Object.fromEntries(rows.map((r) => [r.doc_type, r]));
    assert.equal(byType.WO.fy, '26-27');
    assert.ok(Number(byType.IND.last_no) >= 1);
  });


  /* ------------------------------------------------ the whole spine */

  test('nothing can be consumed before it is indented', async (t) => {
    if (!live) return t.skip('no database');
    const r = await api('/consumption/evaluate', { method: 'POST', body: {
      boqId: S.boqId, lines: [{ boqLineId: S.line1a, qty: 1 }] } });
    assert.equal(r.status, 409);
    assert.match(r.body.error.message, /nothing has been indented/);
  });

  test('an approved indent puts material at site', async (t) => {
    if (!live) return t.skip('no database');
    // the earlier indent was returned, so raise and approve a fresh one
    const d = await api('/indents', { method: 'POST', body: {
      siteId: S.siteId, indentDate: '2026-09-08',
      lines: [{ boqLineId: S.line1a, qty: 10 }], send: true } });
    S.approvedIndent = d.body.id;
    await api(`/indents/${S.approvedIndent}/decide`, { method: 'POST', body: { action: 'APPROVED' } });

    const avail = (await api(`/consumption/boq/${S.boqId}/available`)).body;
    const line = avail.find((l) => l.boq_line_id === S.line1a);
    assert.equal(Number(line.approved_qty), 10);
    assert.equal(Number(line.available_qty), 10, 'indented and not yet used');
  });

  test('a consumption draft does not count as used', async (t) => {
    if (!live) return t.skip('no database');
    const c = await api('/consumption', { method: 'POST', body: {
      siteId: S.siteId, usedOn: '2026-09-10',
      lines: [{ boqLineId: S.line1a, qty: 4 }], confirm: false } });
    assert.equal(c.body.status, 'DRAFT');
    S.conId = c.body.id;

    const line = (await api(`/indents/boq/${S.boqId}/lines`)).body.find((l) => l.boq_line_id === S.line1a);
    assert.equal(Number(line.consumed_qty), 0, 'a draft is a working note, not a fact');
    assert.equal(Number(line.available_qty), 10);
  });

  test('confirming it books the quantity against the BOQ line', async (t) => {
    if (!live) return t.skip('no database');
    const r = await api(`/consumption/${S.conId}/confirm`, { method: 'POST' });
    assert.equal(r.body.status, 'CONFIRMED');

    const line = (await api(`/indents/boq/${S.boqId}/lines`)).body.find((l) => l.boq_line_id === S.line1a);
    assert.equal(Number(line.consumed_qty), 4);
    assert.equal(Number(line.available_qty), 6, '10 indented less 4 used');
  });

  test('a confirmed entry cannot be edited', async (t) => {
    if (!live) return t.skip('no database');
    const r = await api(`/consumption/${S.conId}`, { method: 'PUT', body: {
      lines: [{ boqLineId: S.line1a, qty: 1 }] } });
    assert.equal(r.status, 409);
  });

  test('you cannot use more than is at site, and it says how much there is', async (t) => {
    if (!live) return t.skip('no database');
    const r = await api('/consumption', { method: 'POST', body: {
      siteId: S.siteId, usedOn: '2026-09-11',
      lines: [{ boqLineId: S.line1a, qty: 9 }], confirm: true } });
    assert.equal(r.status, 409);
    assert.match(r.body.error.message, /only 6 is at site/i);
    assert.match(r.body.error.message, /10 indented, 4 already used/);
  });

  test('the rest can be used', async (t) => {
    if (!live) return t.skip('no database');
    const r = await api('/consumption', { method: 'POST', body: {
      siteId: S.siteId, usedOn: '2026-09-11',
      lines: [{ boqLineId: S.line1a, qty: 6 }], confirm: true } });
    assert.equal(r.status, 201);
    const line = (await api(`/indents/boq/${S.boqId}/lines`)).body.find((l) => l.boq_line_id === S.line1a);
    assert.equal(Number(line.consumed_qty), 10);
    assert.equal(Number(line.available_qty), 0);
  });

  test('the site reads end to end: estimated, indented, used, left', async (t) => {
    if (!live) return t.skip('no database');
    const p = (await api(`/progress/site/${S.siteId}`)).body;
    assert.equal(p.boq.state, 'LOCKED');
    assert.equal(Number(p.totals.indented), 10);
    assert.equal(Number(p.totals.consumed), 10);
    assert.equal(Number(p.totals.atSite), 0);

    const line = p.lines.find((l) => l.sno === '1a');
    assert.equal(Number(line.effective_est), 13);
    assert.equal(Number(line.approved_qty), 10);
    assert.equal(Number(line.consumed_qty), 10);
    assert.equal(Number(line.balance), 3, 'estimate less what is committed');
  });

  test('the desk gathers what needs attention', async (t) => {
    if (!live) return t.skip('no database');
    const d = (await api('/progress/desk?branchId=1')).body;
    assert.ok(Array.isArray(d.amendmentDue));
    assert.ok(Array.isArray(d.awaitingBoq));
    assert.ok(Array.isArray(d.indentsWaiting));
  });

  test('a store has no client and no work order', async (t) => {
    if (!live) return t.skip('no database');
    const r = await api('/sites/stores', { method: 'POST', body: {
      name: 'Central Store - Hyderabad', branchId: 1, keeperUserId: 3 } });
    assert.equal(r.status, 201);
    assert.match(r.body.code, /^GD-\d{4}$/);
    const stores = (await api('/sites/stores/list?branchId=1')).body;
    assert.ok(stores.every((s) => s.type === 'STORE' && !s.client));
    const sites = (await api('/sites?branchId=1')).body;
    assert.ok(sites.every((s) => s.type === 'SITE'), 'stores do not appear among sites');
  });
});
