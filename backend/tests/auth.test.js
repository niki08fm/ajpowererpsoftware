'use strict';
/**
 * Logins: the door, and what each role finds behind it.
 *
 * Every other suite runs with AUTH=off and names its user in a header.
 * This one leaves logins on and goes through the front door, so it is
 * the suite that says a GM cannot see another GM's project, a store
 * login cannot create a site, and only a site's store keeper issues
 * its material.
 */
process.env.DB_NAME = process.env.DB_NAME_TEST || 'ajp_erp_test';
process.env.AUTH = 'on';

const { test, before, after, describe } = require('node:test');
const assert = require('node:assert');
const app = require('../src/app');
const { pool } = require('../src/config/db');
const { setup } = require('../src/db/setup');
const env = require('../src/config/env');
const { resetTransactional } = require('./reset');

let server; let base; let live = false;
const call = (path, { token, ...opts } = {}) =>
  fetch(base + path, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  }).then(async (r) => ({ status: r.status, body: await r.json() }));

const PW = env.trialPassword;
const login = async (email, password = PW) => {
  const r = await call('/auth/login', { method: 'POST', body: { email, password } });
  assert.equal(r.status, 200, `${email} signs in`);
  return r.body;
};

before(async () => {
  if (!/_test$/.test(env.db.database)) {
    throw new Error(`Refusing to run: "${env.db.database}" is not a test database.`);
  }
  try { await setup({ quiet: true }); await pool.query('SELECT 1'); live = true; } catch { return; }
  server = app.listen(0);
  base = `http://127.0.0.1:${server.address().port}/api`;
  await resetTransactional(pool);
});
after(async () => { if (server) server.close(); await pool.end(); });

describe('logins', () => {
  const T = {}; const U = {}; const S = {};

  test('nobody gets in without signing in', async (t) => {
    if (!live) return t.skip('no database');
    assert.equal((await call('/sites')).status, 401);
    const bad = await call('/auth/login', { method: 'POST',
      body: { email: 'suresh@ajpower.test', password: 'not-it' } });
    assert.equal(bad.status, 401);
    assert.equal(bad.body.error.message, 'Wrong email or password');
  });

  test('every role signs in with the trial password', async (t) => {
    if (!live) return t.skip('no database');
    for (const [k, email] of Object.entries({
      planning: 'suresh@ajpower.test', ravi: 'ravi@ajpower.test', store: 'imran@ajpower.test',
      vikram: 'vikram@ajpower.test', anil: 'anil@ajpower.test', gm: 'kavya@ajpower.test',
      procure: 'prakash@ajpower.test', billing: 'lakshmi@ajpower.test',
    })) {
      const r = await login(email);
      T[k] = r.token; U[k] = r.user;
    }
    assert.equal(U.gm.department, 'General Manager');
  });

  test('planning creates the sites; nobody else can', async (t) => {
    if (!live) return t.skip('no database');
    const site = (name, gm, keeper) => ({ name, branchId: 1, clientId: 1,
      headUserId: keeper, keeperUserId: keeper, gmUserId: gm });

    const refused = await call('/sites', { token: T.store, method: 'POST',
      body: site('Store Tried This', U.gm.id, U.ravi.id) });
    assert.equal(refused.status, 403);
    const gmTried = await call('/sites', { token: T.gm, method: 'POST',
      body: site('GM Tried This', U.gm.id, U.ravi.id) });
    assert.equal(gmTried.status, 403, 'a GM oversees; it does not create');

    const a = await call('/sites', { token: T.planning, method: 'POST',
      body: site('Auth Site Alpha', U.gm.id, U.ravi.id) });
    const b = await call('/sites', { token: T.planning, method: 'POST',
      body: site('Auth Site Beta', U.anil.id, U.vikram.id) });
    assert.equal(a.status, 201);
    assert.equal(b.status, 201);
    S.a = a.body.id; S.b = b.body.id;
  });

  test('a GM sees only the projects they are GM of', async (t) => {
    if (!live) return t.skip('no database');
    const mine = (await call('/sites', { token: T.gm })).body.map((s) => s.id);
    assert.deepEqual(mine, [S.a]);
    assert.equal((await call(`/sites/${S.b}`, { token: T.gm })).status, 403);
    assert.equal((await call(`/site-store/${S.b}/stock`, { token: T.gm })).status, 403);

    const all = (await call('/sites', { token: T.anil })).body.map((s) => s.id);
    assert.ok(all.includes(S.a) && all.includes(S.b), 'Management sees every project');

    const me = (await call('/auth/me', { token: T.gm })).body.access;
    assert.equal(me.overseer, true);
    assert.ok(me.writes.filter(([, ok]) => ok).every(([w]) => /decide/.test(w)), 'a GM writes only approvals');
  });

  test('a site login sees its own sites and raises nothing elsewhere', async (t) => {
    if (!live) return t.skip('no database');
    const seen = (await call('/sites', { token: T.vikram })).body.map((s) => s.id);
    assert.deepEqual(seen, [S.b]);
    const r = await call('/indents', { token: T.vikram, method: 'POST',
      body: { siteId: S.a, indentDate: '2026-09-23', lines: [] } });
    assert.equal(r.status, 403);
  });

  test('the browser gets the write rules in order, so a site is never offered an approval', async (t) => {
    if (!live) return t.skip('no database');
    const me = (await call('/auth/me', { token: T.vikram })).body.access;
    // what api.js canWrite does: the first rule that matches decides
    const may = (path) => {
      const rule = me.writes.find(([re]) => new RegExp(re).test(path));
      return rule ? rule[1] : false;
    };
    assert.equal(may('/indents/5'), true, 'the site edits its own PRN');
    assert.equal(may('/indents/5/decide'), false, 'approving it is for the GM and Management');
    assert.equal(may('/expenses/5/decide'), false);
    // and the server agrees
    const r = await call('/indents/1/decide', { token: T.vikram, method: 'POST', body: { action: 'APPROVED' } });
    assert.equal(r.status, 403);
  });

  test('only the site store keeper issues material', async (t) => {
    if (!live) return t.skip('no database');
    // Vikram joins Alpha's team, but Ravi keeps its store
    const put = await call(`/admin/users/${U.vikram.id}/sites`, { token: T.anil, method: 'PUT',
      body: { sites: [{ siteId: S.a, as: 'TEAM' }, { siteId: S.b, as: 'KEEPER' }] } });
    assert.equal(put.status, 200);

    const issue = { siteId: S.a, usedOn: '2026-09-23', issuedTo: 'Crew A',
      lines: [{ itemId: 1, qty: 1 }] };
    const vikram = await call('/consumption/issues', { token: T.vikram, method: 'POST', body: issue });
    assert.equal(vikram.status, 403);
    assert.match(vikram.body.error.message, /store keeper/);

    const ravi = await call('/consumption/issues', { token: T.ravi, method: 'POST', body: issue });
    assert.notEqual(ravi.status, 403, 'the keeper gets past the door (the stock check is another matter)');

    const gm = await call('/consumption/issues', { token: T.gm, method: 'POST', body: issue });
    assert.equal(gm.status, 403, 'the GM does not issue material');
  });

  test('only Management manages logins', async (t) => {
    if (!live) return t.skip('no database');
    assert.equal((await call('/admin/users', { token: T.gm })).status, 403);
    assert.equal((await call('/admin/users', { token: T.planning })).status, 403);

    const email = `new.${Date.now()}@ajpower.test`;
    const made = await call('/admin/users', { token: T.anil, method: 'POST',
      body: { name: 'New Buyer', email, department: 'Procurement', password: 'first-pass-1' } });
    assert.equal(made.status, 201);
    const first = await login(email, 'first-pass-1');
    assert.equal(first.user.department, 'Procurement');

    // switching the login off ends its session
    await call(`/admin/users/${made.body.id}`, { token: T.anil, method: 'PATCH', body: { isActive: false } });
    assert.equal((await call('/auth/me', { token: first.token })).status, 401);

    const self = await call(`/admin/users/${U.anil.id}`, { token: T.anil, method: 'PATCH',
      body: { isActive: false } });
    assert.equal(self.status, 400, 'nobody locks themselves out');
  });

  test('a project is taken off a GM only by giving it to another', async (t) => {
    if (!live) return t.skip('no database');
    const r = await call(`/admin/users/${U.gm.id}/sites`, { token: T.anil, method: 'PUT',
      body: { sites: [] } });
    assert.equal(r.status, 400);
    assert.match(r.body.error.message, /would have no GM/);
  });

  test('signing out ends the session', async (t) => {
    if (!live) return t.skip('no database');
    const s = await login('lakshmi@ajpower.test');
    assert.equal((await call('/auth/logout', { token: s.token, method: 'POST' })).status, 200);
    assert.equal((await call('/sites', { token: s.token })).status, 401);
  });
});
