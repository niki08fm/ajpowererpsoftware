'use strict';
/**
 * The Planning -> Site round trip, against a real database.
 *
 * This suite DELETES every site, work order, BOQ, indent and
 * consumption before it runs. It therefore gets its own database and
 * refuses to touch any other — set below, before anything reads the
 * config, so no npm script or shell variable has to be remembered.
 *
 * Skipped when there is no database to talk to, so `npm test` still
 * works without one.
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
  // a suite that empties tables must never be pointed at a working
  // database. Belt and braces: the name is forced above, and checked
  // here in case something overrode it.
  if (!/_test$/.test(env.db.database)) {
    throw new Error(
      `Refusing to run: tests delete data and "${env.db.database}" is not a test database. ` +
      'The name must end in _test.'
    );
  }
  try { await setup({ quiet: true }); await pool.query('SELECT 1'); live = true; } catch { return; }
  server = app.listen(0);
  base = `http://127.0.0.1:${server.address().port}/api`;
  // start from clean transactional data, keep the masters
  await resetTransactional(pool);
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
      headUserId: 2, keeperUserId: 3, gmUserId: 5, location: 'Shamshabad',
      billingAddress: 'GMR Infra Ltd, RGIA', startDate: '2026-09-01',
      targetCompletion: '2027-03-31', team: [4, 5] } });
    assert.equal(r.status, 201);
    assert.match(r.body.code, /^ST-\d{4}$/);
    S.siteId = r.body.id;

    const dupe = await api('/sites', { method: 'POST', body: {
      name: 'gmr  aerocity - block c', branchId: 1, clientId: 1, headUserId: 2, keeperUserId: 3, gmUserId: 5 } });
    assert.equal(dupe.status, 409, 'the same name typed differently is refused');
  });

  test('completion before start is refused', async (t) => {
    if (!live) return t.skip('no database');
    const r = await api('/sites', { method: 'POST', body: {
      name: 'Backwards Dates Site', branchId: 1, clientId: 1, headUserId: 2, keeperUserId: 3, gmUserId: 5,
      startDate: '2027-01-01', targetCompletion: '2026-01-01' } });
    assert.equal(r.status, 400);
  });

  test('a site cannot be created without a general manager', async (t) => {
    if (!live) return t.skip('no database');
    const r = await api('/sites', { method: 'POST', body: {
      name: 'Site With No GM', branchId: 1, clientId: 1, headUserId: 2, keeperUserId: 3 } });
    assert.equal(r.status, 400);
  });

  test('the site reads back who runs it', async (t) => {
    if (!live) return t.skip('no database');
    const r = (await api(`/sites/${S.siteId}`)).body;
    assert.equal(r.head.id, 2);
    assert.equal(r.keeper.id, 3);
    assert.equal(r.gm.id, 5, 'the general manager is on the site');
    assert.ok(!r.team.some((t2) => t2.id === 5), 'and not repeated as a guest on it');
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
    S.bwl1 = after.woLines[0].boq_wo_line_id;
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

  test('the amend sheet is the preparation sheet, grouped by work order line', async (t) => {
    if (!live) return t.skip('no database');
    const sheet = (await api(`/boq/${S.boqId}/amend-sheet`)).body;
    assert.equal(sheet.woLines.length, 2);
    const w1 = sheet.woLines[0];
    assert.equal(Number(w1.contracted_qty), 10);
    assert.equal(Number(w1.effective_qty), 10, 'nothing amended yet');
    assert.equal(w1.items.length, 4, 'the items sit under their work order line');
  });

  test('a preview works out the new numbers without saving them', async (t) => {
    if (!live) return t.skip('no database');
    const r = await api(`/boq/${S.boqId}/amendments/preview`, { method: 'POST', body: {
      reason: 'checking before committing to it',
      lines: [{ boqWoLineId: S.bwl1, qty: 1 }] } });
    assert.equal(r.status, 200);
    const w = r.body.lines[0];
    assert.equal(Number(w.toQty), 11, '10 contracted + 1');
    assert.equal(Number(w.toEst), 13, '12 estimated + 1');
    assert.ok(w.items.every((i) => Number(i.newBoqQty) === 11), 'item qty 1 each, so 1 x 11');

    // and nothing moved
    const line = (await api(`/indents/boq/${S.boqId}/lines`)).body[0];
    assert.equal(Number(line.effective_est), 12);
  });

  test('one number on the work order line moves every item under it', async (t) => {
    if (!live) return t.skip('no database');
    const over = (await api(`/boq/${S.boqId}/over-lines`)).body;
    assert.equal(over.lines.length, 1);
    assert.equal(Number(over.lines[0].over_qty), 1);

    const r = await api(`/boq/${S.boqId}/amendments`, { method: 'POST', body: {
      reason: 'extra points on the east riser, approved by client',
      lines: [{ boqWoLineId: S.bwl1, qty: 1 }] } });
    assert.equal(r.body.state, 'LOCKED');
    assert.equal(r.body.overLines, 0);
    assert.equal(r.body.lines[0].items, 4, 'all four items recomputed off one number');

    // BOQ qty moved too, which the per-item amendment never did
    const sheet = (await api(`/boq/${S.boqId}`)).body;
    assert.equal(Number(sheet.woLines[0].contracted_qty), 10, 'the client document is untouched');
    assert.equal(Number(sheet.woLines[0].qty), 11, 'the line now stands at 11');
    assert.ok(sheet.woLines[0].items.every((i) => Number(i.boq_qty) === 11));

    const line = (await api(`/indents/boq/${S.boqId}/lines`)).body[0];
    assert.equal(Number(line.est_qty), 12, 'the original estimate is left alone');
    assert.equal(Number(line.var_qty), 1, 'the amendment sits beside it');
    assert.equal(Number(line.effective_est), 13, 'and together they cover what was raised');
    assert.equal(Number(line.balance), 0);
  });

  test('amending the same line twice accumulates instead of drifting', async (t) => {
    if (!live) return t.skip('no database');
    await api(`/boq/${S.boqId}/amendments`, { method: 'POST', body: {
      reason: 'a second variation on the same line',
      lines: [{ boqWoLineId: S.bwl1, qty: 2 }] } });
    const sheet = (await api(`/boq/${S.boqId}`)).body;
    assert.equal(Number(sheet.woLines[0].qty), 13, '10 + 1 + 2');
    assert.ok(sheet.woLines[0].items.every((i) => Number(i.boq_qty) === 13));
    assert.ok(sheet.woLines[0].items.every((i) => Number(i.effective_est) === 15), '12 + 3');
  });

  test('a cut is allowed, but not one that leaves nothing', async (t) => {
    if (!live) return t.skip('no database');
    const ok = await api(`/boq/${S.boqId}/amendments`, { method: 'POST', body: {
      reason: 'client trimmed the scope on this line',
      lines: [{ boqWoLineId: S.bwl1, qty: -2 }] } });
    assert.equal(ok.status, 201);
    const sheet = (await api(`/boq/${S.boqId}`)).body;
    assert.equal(Number(sheet.woLines[0].qty), 11, '13 less the 2 cut away');

    const tooFar = await api(`/boq/${S.boqId}/amendments`, { method: 'POST', body: {
      reason: 'cutting the line away entirely',
      lines: [{ boqWoLineId: S.bwl1, qty: -11 }] } });
    assert.equal(tooFar.status, 400);
    assert.match(tooFar.body.error.message, /would leave nothing/);
  });

  test('an amendment needs a reason', async (t) => {
    if (!live) return t.skip('no database');
    const r = await api(`/boq/${S.boqId}/amendments`, { method: 'POST', body: {
      reason: '', lines: [{ boqWoLineId: S.bwl1, qty: 1 }] } });
    assert.equal(r.status, 400);
  });

  test('the BOQ history gathers its trail, amendments and indents', async (t) => {
    if (!live) return t.skip('no database');
    const h = (await api(`/boq/${S.boqId}/history`)).body;
    assert.ok(h.events.length, 'the trail is there');
    assert.ok(h.events.some((e) => e.action === 'Amended'));
    assert.equal(h.indents.length, 1, 'the indent raised against this BOQ');
    assert.equal(h.indents[0].status, 'SUBMITTED');
    assert.ok(Number(h.indents[0].total_qty) > 0);
  });

  test('indents can be listed by the BOQ they were raised against', async (t) => {
    if (!live) return t.skip('no database');
    const mine = (await api(`/indents?boqId=${S.boqId}`)).body;
    assert.equal(mine.indents.length + mine.drafts.length, 1);
    const none = (await api('/indents?boqId=999999')).body;
    assert.equal(none.indents.length + none.drafts.length, 0);
  });

  test('the history reads back what each amendment moved', async (t) => {
    if (!live) return t.skip('no database');
    const h = (await api(`/boq/${S.boqId}/amendments`)).body;
    assert.equal(h.length, 3, 'newest first');
    assert.equal(h[0].lines[0].kind, 'WO_LINE');
    assert.equal(Number(h[0].lines[0].qty), -2);
    assert.ok(h[0].reason.length > 4);
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

  test('the indent sheet is the BOQ sheet, grouped by work order line', async (t) => {
    if (!live) return t.skip('no database');
    const s = (await api(`/indents/boq/${S.boqId}/sheet`)).body;
    assert.equal(s.woLines.length, 2);
    assert.equal(s.woLines[0].items.length, 4, 'items sit under their work order line');
    const first = s.woLines[0].items[0];
    assert.ok('item_indented_qty' in first, 'what has already been ordered for the item');
    assert.ok('effective_est' in first);
  });

  test('the same item on two work order lines shows one ordered figure', async (t) => {
    if (!live) return t.skip('no database');
    const sheet = (await api(`/indents/boq/${S.boqId}/sheet`)).body;
    const all = sheet.woLines.flatMap((w) => w.items);
    const dup = all.filter((i) => all.filter((x) => x.item_id === i.item_id).length > 1);
    assert.ok(dup.length >= 2, 'the fixture prepares the same item on both work order lines');
    const first = dup[0];
    assert.ok(dup.filter((d) => d.item_id === first.item_id)
      .every((d) => Number(d.item_indented_qty) === Number(first.item_indented_qty)),
    'what has been ordered is the item total, the same wherever that item appears');
  });

  test('an approved indent is one line per item, whatever it was raised against', async (t) => {
    if (!live) return t.skip('no database');
    const sheet = (await api(`/indents/boq/${S.boqId}/sheet`)).body;
    const all = sheet.woLines.flatMap((w) => w.items);
    const shared = all.filter((i) => all.filter((x) => x.item_id === i.item_id).length > 1);
    const pair = shared.filter((x) => x.item_id === shared[0].item_id).slice(0, 2);
    assert.equal(pair.length, 2);

    await api(`/indents/${S.indentId}`, { method: 'PUT', body: {
      lines: [{ boqLineId: pair[0].boq_line_id, qty: 6 },
        { boqLineId: pair[1].boq_line_id, qty: 4 }] } });
    await api(`/indents/${S.indentId}/submit`, { method: 'POST' });
    await api(`/indents/${S.indentId}/decide`, { method: 'POST', body: { action: 'APPROVED' } });

    const ind = (await api(`/indents/${S.indentId}`)).body;
    assert.equal(ind.status, 'APPROVED');
    assert.equal(ind.rolledUp, true);
    assert.equal(ind.lines.length, 2, 'the breakdown stays on the record');
    assert.equal(ind.rollup.length, 1, 'but it goes out as one item');
    assert.equal(Number(ind.rollup[0].qty), 10, '6 + 4');
    assert.equal(Number(ind.rollup[0].from_lines), 2);
    assert.ok(String(ind.rollup[0].boq_snos).includes(','), 'and names the lines it came off');
  });


  test('the site reads end to end: estimated, indented, left', async (t) => {
    if (!live) return t.skip('no database');
    const p = (await api(`/progress/site/${S.siteId}`)).body;
    assert.equal(p.boq.state, 'LOCKED');
    assert.equal(Number(p.totals.indented), 10);

    assert.equal(Number(p.lines.find((l) => l.sno === '1a').effective_est), 13,
      'the amendment is still carried on the line it moved');

    // whichever lines were indented against, the four numbers on every
    // row still come out of the documents behind them
    const ordered = p.lines.filter((l) => Number(l.approved_qty) > 0);
    assert.equal(ordered.reduce((t2, l) => t2 + Number(l.approved_qty), 0), 10);
    for (const l of p.lines) {
      assert.equal(
        Number(l.balance),
        Number(l.effective_est) - Number(l.committed_qty),
        `balance on ${l.sno} is derived, not stored`
      );
    }
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
