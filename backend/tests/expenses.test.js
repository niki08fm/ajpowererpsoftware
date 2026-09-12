'use strict';
/**
 * Expenses, approval, and the report that adds them to material.
 *
 * The thing worth testing hardest is what is NOT counted: a claim
 * nobody has decided must never reach a cost figure, and a claim cut
 * from 4,000 to 3,200 must reach it as 3,200.
 */
process.env.DB_NAME = process.env.DB_NAME_TEST || 'ajp_erp_test';

const { test, before, after, describe } = require('node:test');
const assert = require('node:assert');
const app = require('../src/app');
const { pool, one: one0 } = require('../src/config/db');
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
  await pool.query('DELETE FROM site_expense_events');
  await pool.query('DELETE FROM site_expenses');
});
after(async () => { if (server) server.close(); await pool.end(); });

describe('expenses and the cost report', () => {
  const S = {};

  test('a site that has consumed some material', async (t) => {
    if (!live) return t.skip('no database');
    S.box = (await api('/items/search?q=metal%20box')).body[0].id;
    const site = await api('/sites', { method: 'POST', body: {
      name: 'Cost Report Site', branchId: 1, clientId: 1,
      headUserId: 2, keeperUserId: 3, gmUserId: 5 } });
    S.site = site.body.id;
    const store = await api('/sites/stores', { method: 'POST', body: {
      name: 'Central Store Hyderabad', branchId: 1, keeperUserId: 3 } });
    await pool.query(`UPDATE sites SET is_central = 1 WHERE id = ?`, [store.body.id]);

    await pool.query(
      `INSERT INTO stock_movements (site_id, item_id, qty, rate, kind, ref_no, moved_on)
       VALUES (?, ?, 500, 100, 'GRN', 'SEED', '2026-10-01')`, [store.body.id, S.box]);
    await pool.query(
      `INSERT INTO stock_movements (site_id, item_id, qty, rate, kind, ref_no, moved_on)
       VALUES (?, ?, 500, 0, 'DC_IN', 'SEED', '2026-10-01')`, [S.site, S.box]);

    const out = await api('/consumption/issues', { method: 'POST', body: {
      siteId: S.site, usedOn: '2026-10-05', issuedTo: 'Ramesh Kumar',
      lines: [{ itemId: S.box, qty: 30 }] } });
    assert.equal(Number(out.body.issuedValue), 3000, '30 at 100');

    S.cat = (await api('/expenses/categories')).body[0].id;
  });

  test('the report starts as material only', async (t) => {
    if (!live) return t.skip('no database');
    const r = (await api(`/costs/expense?siteId=${S.site}`)).body;
    assert.equal(Number(r.totals.material), 3000);
    assert.equal(Number(r.totals.expense), 0);
    assert.equal(Number(r.totals.total), 3000);
  });

  /* ------------------------------------------------------- claiming */
  test('a claim is raised and sent', async (t) => {
    if (!live) return t.skip('no database');
    const r = await api('/expenses', { method: 'POST', body: {
      siteId: S.site, categoryId: S.cat, spentOn: '2026-10-06',
      description: 'Lorry from the store, two trips', paidTo: 'Ravi Transport',
      amount: 4000, send: true } });
    assert.equal(r.status, 201);
    assert.match(r.body.docNo, /^EXP\/\d\d-\d\d\/0001$/);
    assert.equal(r.body.status, 'SUBMITTED');
    S.exp = r.body.id;
  });

  test('and it costs nothing at all until somebody decides', async (t) => {
    if (!live) return t.skip('no database');
    const r = (await api(`/costs/expense?siteId=${S.site}`)).body;
    assert.equal(Number(r.totals.expense), 0, 'a claim in a queue is not a cost');
    assert.equal(Number(r.totals.total), 3000);
    assert.equal(r.pending.claims, 1, 'but it is named, not hidden');
    assert.equal(Number(r.pending.amount), 4000);
  });

  /* ------------------------------------------------------- deciding */
  test('more than was claimed cannot be approved', async (t) => {
    if (!live) return t.skip('no database');
    const r = await api(`/expenses/${S.exp}/decide`, { method: 'POST', body: {
      action: 'APPROVED', amount: 5000 } });
    assert.equal(r.status, 400);
    assert.match(r.body.error.message, /cannot be approved/);
  });

  test('nor can a claim be cut without saying why', async (t) => {
    if (!live) return t.skip('no database');
    const r = await api(`/expenses/${S.exp}/decide`, { method: 'POST', body: {
      action: 'APPROVED', amount: 3200 } });
    assert.equal(r.status, 400);
    assert.match(r.body.error.message, /why it is cut down/);
  });

  test('nor refused without a reason', async (t) => {
    if (!live) return t.skip('no database');
    const r = await api(`/expenses/${S.exp}/decide`, { method: 'POST', body: {
      action: 'REJECTED' } });
    assert.equal(r.status, 400);
  });

  test('4,000 claimed, 3,200 allowed — one document, both numbers', async (t) => {
    if (!live) return t.skip('no database');
    const r = await api(`/expenses/${S.exp}/decide`, { method: 'POST', body: {
      action: 'APPROVED', amount: 3200, note: 'the lorry ran half a day' } });
    assert.equal(r.status, 200);
    assert.equal(r.body.outcome, 'PART_APPROVED');
    assert.equal(Number(r.body.claimed), 4000);
    assert.equal(Number(r.body.approved), 3200);
    assert.equal(Number(r.body.cost), 3200);
    assert.equal(Number(r.body.disallowed), 800);
  });

  test('and it is the allowed figure that reaches the report', async (t) => {
    if (!live) return t.skip('no database');
    const r = (await api(`/costs/expense?siteId=${S.site}`)).body;
    assert.equal(Number(r.totals.expense), 3200, 'not the 4,000 asked for');
    assert.equal(Number(r.totals.total), 6200, '3,000 material + 3,200 expense');
    assert.equal(r.pending.claims, 0, 'nothing waiting any more');
  });

  test('a decided claim cannot be decided again', async (t) => {
    if (!live) return t.skip('no database');
    const r = await api(`/expenses/${S.exp}/decide`, { method: 'POST', body: {
      action: 'APPROVED', note: 'again' } });
    assert.equal(r.status, 409);
  });

  test('the trail says who did what', async (t) => {
    if (!live) return t.skip('no database');
    const r = (await api(`/expenses/${S.exp}`)).body;
    assert.deepEqual(r.events.map((e) => e.action), ['SUBMITTED', 'APPROVED']);
    assert.equal(Number(r.events[1].amount), 3200);
    assert.match(r.events[1].note, /half a day/);
    assert.equal(r.canDecide, false);
  });

  /* --------------------------------------------- refused and sent back */
  test('a refused claim costs nothing and says so', async (t) => {
    if (!live) return t.skip('no database');
    const made = await api('/expenses', { method: 'POST', body: {
      siteId: S.site, categoryId: S.cat, spentOn: '2026-10-07',
      description: 'Dinner for the gang', amount: 1500, send: true } });
    const r = await api(`/expenses/${made.body.id}/decide`, { method: 'POST', body: {
      action: 'REJECTED', note: 'not an allowable expense' } });
    assert.equal(r.status, 200);
    assert.equal(Number(r.body.cost), 0);
    assert.equal(Number(r.body.disallowed), 1500);

    const rep = (await api(`/costs/expense?siteId=${S.site}`)).body;
    assert.equal(Number(rep.totals.expense), 3200, 'still only the approved one');
  });

  test('one sent back becomes editable and can go again', async (t) => {
    if (!live) return t.skip('no database');
    const made = await api('/expenses', { method: 'POST', body: {
      siteId: S.site, categoryId: S.cat, spentOn: '2026-10-08',
      description: 'Diesel', amount: 900, send: true } });
    await api(`/expenses/${made.body.id}/decide`, { method: 'POST', body: {
      action: 'RETURNED', note: 'attach the bill' } });

    let one = (await api(`/expenses/${made.body.id}`)).body;
    assert.equal(one.head.status, 'RETURNED');
    assert.equal(one.canEdit, true);

    await api(`/expenses/${made.body.id}`, { method: 'PUT', body: {
      billNo: 'HP-4471', amount: 950 } });
    await api(`/expenses/${made.body.id}/submit`, { method: 'POST' });
    await api(`/expenses/${made.body.id}/decide`, { method: 'POST', body: {
      action: 'APPROVED' } });

    one = (await api(`/expenses/${made.body.id}`)).body;
    assert.equal(one.head.outcome, 'APPROVED');
    assert.equal(Number(one.head.cost_amount), 950);

    const rep = (await api(`/costs/expense?siteId=${S.site}`)).body;
    assert.equal(Number(rep.totals.expense), 4150, '3,200 + 950');
  });

  test('a draft can be pulled back out of the queue', async (t) => {
    if (!live) return t.skip('no database');
    const made = await api('/expenses', { method: 'POST', body: {
      siteId: S.site, categoryId: S.cat, spentOn: '2026-10-09',
      description: 'Typed by mistake', amount: 100, send: true } });
    const r = await api(`/expenses/${made.body.id}/withdraw`, { method: 'POST' });
    assert.equal(r.body.status, 'DRAFT');
    const rep = (await api(`/costs/expense?siteId=${S.site}`)).body;
    assert.equal(rep.pending.claims, 0, 'and it is no longer waiting on anybody');
  });

  /* --------------------------------------------------------- report */
  test('a return takes its cost back off the report', async (t) => {
    if (!live) return t.skip('no database');
    const before = (await api(`/costs/expense?siteId=${S.site}`)).body;
    await api('/consumption/returns', { method: 'POST', body: {
      siteId: S.site, returnedOn: '2026-10-10', returnedBy: 'Ramesh Kumar',
      lines: [{ itemId: S.box, qty: 10 }] } });
    const after = (await api(`/costs/expense?siteId=${S.site}`)).body;
    assert.equal(
      Number(before.totals.material) - Number(after.totals.material), 1000,
      '10 back at 100');
  });

  test('the series splits material from expense and runs to the total', async (t) => {
    if (!live) return t.skip('no database');
    const r = (await api(`/costs/expense?siteId=${S.site}&bucket=day`)).body;
    assert.ok(r.series.length >= 3);
    const dates = r.series.map((s) => s.bucket);
    assert.deepEqual([...dates].sort(), dates, 'oldest first');
    assert.equal(
      Number(r.series[r.series.length - 1].running_value),
      Number(r.totals.total),
      'the running line lands on the total beside it');
    assert.equal(
      Math.round(r.series.reduce((t2, s) => t2 + Number(s.material), 0)),
      Math.round(Number(r.totals.material)));
  });

  test('a window knows what was spent before it', async (t) => {
    if (!live) return t.skip('no database');
    const all = (await api(`/costs/expense?siteId=${S.site}`)).body;
    const late = (await api(`/costs/expense?siteId=${S.site}&from=2026-10-08`)).body;
    assert.ok(Number(late.totals.total) < Number(all.totals.total));
    assert.equal(Number(late.totals.toDate), Number(all.totals.total));
    assert.equal(
      Math.round(Number(late.totals.beforeWindow) + Number(late.totals.total)),
      Math.round(Number(late.totals.toDate)));
  });

  test('material and expenses can be looked at on their own', async (t) => {
    if (!live) return t.skip('no database');
    const m = (await api(`/costs/expense?siteId=${S.site}&source=MATERIAL`)).body;
    assert.equal(Number(m.totals.expense), 0);
    const e = (await api(`/costs/expense?siteId=${S.site}&source=EXPENSE`)).body;
    assert.equal(Number(e.totals.material), 0);
    assert.equal(Number(e.totals.expense), 4150);

    const all = (await api(`/costs/expense?siteId=${S.site}`)).body;
    assert.equal(
      Math.round(Number(m.totals.material) + Number(e.totals.expense)),
      Math.round(Number(all.totals.total)),
      'the two halves add up to the whole');
  });

  test('every line behind the report can be listed', async (t) => {
    if (!live) return t.skip('no database');
    const r = (await api(`/costs/expense/lines?siteId=${S.site}`)).body;
    const kinds = new Set(r.rows.map((x) => x.source));
    assert.ok(kinds.has('MATERIAL') && kinds.has('EXPENSE'));
    const total = (await api(`/costs/expense?siteId=${S.site}`)).body.totals.total;
    assert.equal(Math.round(Number(r.totals.amount)), Math.round(Number(total)),
      'and they add up to the report');
  });

  /* ------------------------------------------------------------- P&L */
  test('an unbilled site has no profit and loss, and says why', async (t) => {
    if (!live) return t.skip('no database');
    const r = (await api(`/costs/pl?siteId=${S.site}`)).body;
    assert.equal(r.available, false, 'this site has never been billed');
    assert.equal(r.blockedBy, 'BILLING');
    assert.match(r.reason, /billed/i);
    // billing exists now, so the shape is always there — but with
    // nothing raised, revenue is nought and no profit is claimed
    assert.equal(Number(r.revenue.total), 0);
    assert.equal(r.revenue.bills, 0);

    const cost = (await api(`/costs/expense?siteId=${S.site}`)).body.totals.total;
    assert.equal(Number(r.cost.total), Number(cost),
      'and the cost side agrees with the expense report');
  });

  test('the cost side splits labour out from the rest', async (t) => {
    if (!live) return t.skip('no database');
    const r = (await api(`/costs/pl?siteId=${S.site}`)).body;
    const st = (await api(`/costs/expense/statement?siteId=${S.site}`)).body;
    assert.equal(Number(r.cost.material), Number(st.totals.material));
    assert.equal(Number(r.cost.labour), Number(st.totals.labour));
    assert.equal(Number(r.cost.other), Number(st.totals.other));
  });

  test('the desk counts claims nobody has decided', async (t) => {
    if (!live) return t.skip('no database');
    await api('/expenses', { method: 'POST', body: {
      siteId: S.site, categoryId: S.cat, spentOn: '2026-10-11',
      description: 'Crane hire', amount: 7000, send: true } });
    const d = (await api('/progress/desk?branchId=1')).body;
    assert.equal(d.expensesWaiting, 1);
    assert.equal(Number(d.expensesWaitingValue), 7000);
  });

  /* ==================================================================
     The statement: material item by item, then labour, then the rest,
     then one figure. The shape every cost statement in this trade has.
     ================================================================== */
  test('categories know which of them are labour', async (t) => {
    if (!live) return t.skip('no database');
    const cats = (await api('/expenses/categories')).body;
    const labour = cats.filter((c) => c.kind === 'LABOUR').map((c) => c.name);
    assert.ok(labour.includes('Labour'));
    assert.ok(labour.includes('Sub-contract'));
    assert.ok(cats.some((c) => c.name === 'Transport' && c.kind === 'OTHER'));
    S.labourCat = cats.find((c) => c.name === 'Labour').id;
  });

  test('a labour claim, approved with a comment on the cut', async (t) => {
    if (!live) return t.skip('no database');
    const made = await api('/expenses', { method: 'POST', body: {
      siteId: S.site, categoryId: S.labourCat, spentOn: '2026-10-12',
      description: '6 men, second floor conduiting', paidTo: 'Shankar gang',
      note: 'two of them left at noon', amount: 9000, send: true } });
    await api(`/expenses/${made.body.id}/decide`, { method: 'POST', body: {
      action: 'APPROVED', amount: 7500, note: 'paid for 5 men, not 6' } });
    S.labourExp = made.body.id;
  });

  test('the statement sections material, labour and the rest', async (t) => {
    if (!live) return t.skip('no database');
    const r = (await api(`/costs/expense/statement?siteId=${S.site}`)).body;

    assert.ok(r.material.rows.length >= 1, 'material is listed item by item');
    assert.ok(r.material.rows[0].item_code, 'with its code');
    assert.equal(Number(r.material.rows[0].qty), 20, '30 issued less 10 back');
    assert.equal(Number(r.material.rows[0].amount), 2000);
    assert.equal(Number(r.material.total), 2000);

    // no rate, on purpose. An item is priced at what the central store
    // held it at on the day it moved, so one that moved on several
    // days has several rates; amount / qty would be an average that
    // was never the price of anything.
    assert.ok(!('rate' in r.material.rows[0]),
      'the statement offers no single rate, because there is not one');

    assert.equal(r.labour.rows.length, 1);
    assert.equal(Number(r.labour.total), 7500, 'what was allowed, not the 9,000 asked');

    // transport 3,200 and diesel 950 are "other"
    assert.equal(Number(r.other.total), 4150);
    assert.ok(r.other.groups.length >= 1);
    assert.deepEqual(
      [...r.other.groups].sort((a, b) => b.total - a.total).map((g) => g.total),
      r.other.groups.map((g) => g.total),
      'dearest kind first');
  });

  test('every claim carries the comments that were written on it', async (t) => {
    if (!live) return t.skip('no database');
    const r = (await api(`/costs/expense/statement?siteId=${S.site}`)).body;
    const lab = r.labour.rows[0];
    assert.equal(lab.note, 'two of them left at noon', 'what the site wrote');
    assert.match(lab.decision_note, /5 men/, 'and what the approver wrote back');
    assert.equal(Number(lab.claimed_amount), 9000);
    assert.equal(Number(lab.cost_amount), 7500);
    assert.equal(lab.outcome, 'PART_APPROVED');
    assert.ok(lab.site_name && lab.doc_no && lab.spent_on, 'with the site and the document');
  });

  test('the three sections add up to the total, and to the report', async (t) => {
    if (!live) return t.skip('no database');
    const r = (await api(`/costs/expense/statement?siteId=${S.site}`)).body;
    assert.equal(
      Math.round(Number(r.totals.material) + Number(r.totals.labour) + Number(r.totals.other)),
      Math.round(Number(r.totals.total)));

    const report = (await api(`/costs/expense?siteId=${S.site}`)).body;
    assert.equal(Number(r.totals.total), Number(report.totals.total),
      'the statement and the charts are the same numbers');
    assert.equal(Number(r.totals.material), Number(report.totals.material));
    assert.equal(
      Math.round(Number(r.totals.labour) + Number(r.totals.other)),
      Math.round(Number(report.totals.expense)));
  });

  test('nothing unapproved reaches the statement', async (t) => {
    if (!live) return t.skip('no database');
    const before = (await api(`/costs/expense/statement?siteId=${S.site}`)).body;
    await api('/expenses', { method: 'POST', body: {
      siteId: S.site, categoryId: S.labourCat, spentOn: '2026-10-13',
      description: 'Night shift', amount: 5000, send: true } });
    const after = (await api(`/costs/expense/statement?siteId=${S.site}`)).body;
    assert.equal(Number(after.totals.total), Number(before.totals.total));
    assert.equal(after.labour.rows.length, before.labour.rows.length);
  });

  test('a window carries what was spent before it', async (t) => {
    if (!live) return t.skip('no database');
    const late = (await api(
      `/costs/expense/statement?siteId=${S.site}&from=2026-10-12`)).body;
    const all = (await api(`/costs/expense/statement?siteId=${S.site}`)).body;
    assert.ok(Number(late.totals.beforeWindow) > 0);
    assert.equal(Number(late.totals.toDate), Number(all.totals.total));
  });

  test('material only and expenses only each drop the other section', async (t) => {
    if (!live) return t.skip('no database');
    const m = (await api(`/costs/expense/statement?siteId=${S.site}&source=MATERIAL`)).body;
    assert.equal(m.labour.rows.length, 0);
    assert.equal(Number(m.totals.other), 0);
    assert.ok(m.material.rows.length > 0);

    const e = (await api(`/costs/expense/statement?siteId=${S.site}&source=EXPENSE`)).body;
    assert.equal(Number(e.totals.material), 0);
    assert.ok(Number(e.totals.labour) > 0);
  });

  test('across every site the statement names which site each claim is', async (t) => {
    if (!live) return t.skip('no database');
    const r = (await api('/costs/expense/statement?branchId=1')).body;
    assert.equal(r.site, null, 'no one site');
    assert.ok(r.labour.rows.every((x) => x.site_name));
    assert.ok(r.other.groups.every((g) => g.rows.every((x) => x.site_name)));
  });

  test('an item that moved at two prices has no single rate to show', async (t) => {
    if (!live) return t.skip('no database');
    // the store buys the same item dearer, and more goes out
    const store = await one0(`SELECT id FROM sites WHERE is_central = 1 LIMIT 1`);
    await pool.query(
      `INSERT INTO stock_movements (site_id, item_id, qty, rate, kind, ref_no, moved_on)
       VALUES (?, ?, 200, 130, 'GRN', 'SEED2', '2026-10-20')`, [store.id, S.box]);
    await api('/consumption/issues', { method: 'POST', body: {
      siteId: S.site, usedOn: '2026-10-21', issuedTo: 'Ramesh Kumar',
      lines: [{ itemId: S.box, qty: 10 }] } });

    const r = (await api(`/costs/expense/statement?siteId=${S.site}`)).body;
    const row = r.material.rows.find((x) => x.item_id === S.box);
    assert.equal(Number(row.qty), 30, '20 at 100 plus 10 at 130');
    assert.equal(Number(row.amount), 20 * 100 + 10 * 130, 'each day at its own price');
    assert.equal(Number(row.days), 3, 'and it says how many days it moved on');

    // the average the statement refuses to print would be 110 — a
    // price the store never charged on any day
    assert.notEqual(Number(row.amount) / Number(row.qty), 100);
    assert.notEqual(Number(row.amount) / Number(row.qty), 130);
  });
});
