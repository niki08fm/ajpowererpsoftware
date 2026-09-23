'use strict';
const { many, one } = require('../config/db');
const { forbidden } = require('./errors');

/**
 * Who may do what, all of it in one file.
 *
 * A person's role is their department. There are two kinds:
 *
 *   OVERSEERS   Management and the General Manager. They see every
 *               department's work and change none of it — they do not
 *               raise an indent or issue material. What they write is a
 *               signature. Management also makes the logins.
 *               The GM sees only the projects they are GM of.
 *
 *   DEPARTMENTS Planning, Site, Store, Procurement, Billing. Each one
 *               writes its own documents and nobody else's. A Site
 *               person sees only the sites they are on, and only a
 *               site's store keeper issues its material.
 *
 * Three things are enforced here, on every request:
 *
 *   1. writes — a POST/PUT/PATCH/DELETE must match a rule for the role
 *   2. sites  — a site named in the path, query or body must be one the
 *               person can see
 *   3. rows   — a list sent back to a GM or Site person drops the rows
 *               of sites they cannot see
 *
 * Reads are otherwise open to anyone signed in: the store reads indents,
 * procurement reads the store's stock, and cutting those threads would
 * break screens without protecting anything. What each login is SHOWN
 * is the sidebar's job (frontend/src/access.js), and it follows the
 * same roles.
 */

const ROLES = {
  MANAGEMENT: 'Management',
  GM: 'General Manager',
  PLANNING: 'Planning',
  SITE: 'Site',
  STORE: 'Store',
  PROCUREMENT: 'Procurement',
  BILLING: 'Billing',
};
const ALL_ROLES = Object.values(ROLES);
const OVERSEERS = [ROLES.MANAGEMENT, ROLES.GM];

/**
 * Writes. First match wins, so the narrow rules sit above the broad
 * ones — /boq/:id/decide is a signature, the rest of /boq is Planning.
 * A write that matches nothing is refused.
 */
const WRITES = [
  // your own session and password
  [/^\/auth\//, ALL_ROLES],
  // signatures
  [/^\/(boq|indents|purchase-orders|bills|expenses)\/\d+\/decide$/, OVERSEERS],
  [/^\/comparisons\/\d+\/decide-approval$/, OVERSEERS],
  // logins
  [/^\/admin\//, [ROLES.MANAGEMENT]],

  // planning
  [/^\/(sites|work-orders|boq)(\/|$)/, [ROLES.PLANNING]],
  [/^\/masters\/clients/, [ROLES.PLANNING]],

  // site — a site answers a transfer request, and signs for what arrives
  [/^\/transfers\/\d+\/decide$/, [ROLES.SITE]],
  [/^\/transfers\/site\/\d+\/reorder$/, [ROLES.SITE]],
  [/^\/challans\/\d+\/acknowledge$/, [ROLES.SITE]],
  [/^\/(indents|consumption|expenses)(\/|$)/, [ROLES.SITE]],

  // store — and the sending site writes the challan for a transfer
  [/^\/challans(\/|$)/, [ROLES.STORE, ROLES.SITE]],
  [/^\/transfers(\/|$)/, [ROLES.STORE]],
  [/^\/purchase-orders\/\d+\/receipts$/, [ROLES.STORE]],
  [/^\/(grns|store|items)(\/|$)/, [ROLES.STORE]],

  // procurement
  [/^\/(procurement|comparisons|purchase-orders|suppliers)(\/|$)/, [ROLES.PROCUREMENT]],

  // billing
  [/^\/bills(\/|$)/, [ROLES.BILLING]],
];

/** Reads closed to everyone but the roles named. */
const READS = [
  [/^\/admin\//, [ROLES.MANAGEMENT]],
];

const allowed = (rules, path, role) => {
  const rule = rules.find(([re]) => re.test(path));
  return rule ? rule[1].includes(role) : null;
};

/** Is this write one the role may make? (Also sent to the browser.) */
const canWrite = (role, path) => allowed(WRITES, path, role) === true;

/**
 * The sites a person can see, as ids — or null for "every one".
 *
 * Stores are sites too (site_type STORE), and everybody sees every
 * store: a site's material comes from one, and the GM oversees store
 * stock and movement as much as the site's.
 */
async function scopeOf(user) {
  const role = user.department;
  const keeperOf = (await many(
    `SELECT id FROM sites WHERE keeper_user_id = ? AND site_type = 'SITE'`, [user.id]))
    .map((r) => Number(r.id));

  if (role !== ROLES.GM && role !== ROLES.SITE) return { siteIds: null, keeperOf };

  const own = role === ROLES.GM
    ? await many(`SELECT id FROM sites WHERE gm_user_id = ? AND site_type = 'SITE'`, [user.id])
    : await many(
      `SELECT id FROM sites
        WHERE site_type = 'SITE'
          AND (head_user_id = ? OR keeper_user_id = ?
               OR id IN (SELECT site_id FROM site_team WHERE user_id = ?))`,
      [user.id, user.id, user.id]);
  const stores = await many(`SELECT id FROM sites WHERE site_type = 'STORE'`);
  return { siteIds: new Set([...own, ...stores].map((r) => Number(r.id))), keeperOf };
}

/** Site ids a request names in its path. */
const PATH_SITES = [
  /^\/sites\/(\d+)$/,
  /^\/site-store\/(\d+)\//,
  /^\/progress\/site\/(\d+)$/,
  /^\/consumption\/(?:issuable|returnable|people)\/(\d+)$/,
  /^\/transfers\/site\/(\d+)\//,
  /^\/work-orders\/site\/(\d+)$/,
  /^\/bills\/sheet\/(\d+)$/,
];

function namedSites(req) {
  const ids = [];
  for (const re of PATH_SITES) {
    const m = re.exec(req.path);
    if (m) ids.push(Number(m[1]));
  }
  for (const src of [req.query, req.body]) {
    if (src && typeof src === 'object' && src.siteId != null && src.siteId !== '') {
      ids.push(Number(src.siteId));
    }
  }
  return ids.filter((n) => Number.isFinite(n) && n > 0);
}

/** Which site a row belongs to, if it says. */
const siteOfRow = (row, isSiteList) => {
  if (!row || typeof row !== 'object') return undefined;
  if (isSiteList) return row.id;
  return row.site_id ?? row.siteId ?? row.site?.id;
};

/**
 * Trim what goes back to someone who sees only some sites: a list loses
 * the rows of other sites, and a single document of another site is
 * refused outright.
 */
function filterBody(body, siteIds, path) {
  const isSiteList = path === '/sites' || path === '/sites/';
  const keep = (row) => {
    const id = siteOfRow(row, isSiteList);
    return id == null || siteIds.has(Number(id));
  };
  if (Array.isArray(body)) return body.filter(keep);
  if (body && typeof body === 'object') {
    if (Array.isArray(body.rows)) return { ...body, rows: body.rows.filter(keep) };
    const id = siteOfRow(body, false);
    if (id != null && !siteIds.has(Number(id))) return undefined;
  }
  return body;
}

/**
 * The middleware. Runs after authentication, so req.user is the person
 * who signed in.
 */
async function enforce(req, res, next) {
  try {
    const user = req.user;
    const role = user.department;
    const scope = await scopeOf(user);
    req.access = { role, ...scope };

    const write = req.method !== 'GET' && req.method !== 'HEAD';
    const verdict = allowed(write ? WRITES : READS, req.path, role);
    if (write && verdict !== true) {
      throw forbidden(OVERSEERS.includes(role)
        ? `${role} oversees this work; the department does it`
        : `A ${role} login cannot do this`);
    }
    if (!write && verdict === false) throw forbidden();

    // a site you are not on is not there
    if (scope.siteIds) {
      const outside = namedSites(req).filter((id) => !scope.siteIds.has(id));
      if (outside.length) throw forbidden('That site is not one of yours');
    }

    // only the site's store keeper hands out its material
    if (write && req.path === '/consumption/issues') {
      const site = await one(`SELECT keeper_user_id, name FROM sites WHERE id = ?`, [req.body?.siteId]);
      if (site && Number(site.keeper_user_id) !== Number(user.id)) {
        throw forbidden(`Only the store keeper of ${site.name} can issue its material`);
      }
    }

    if (scope.siteIds && !write) {
      // read now: inside the module's own router req.path is rewritten
      const path = req.path;
      const send = res.json.bind(res);
      res.json = (body) => {
        if (res.statusCode >= 400) return send(body);
        const out = filterBody(body, scope.siteIds, path);
        if (out === undefined) {
          res.status(403);
          return send({ error: { code: 'FORBIDDEN', message: 'That belongs to a site that is not one of yours' } });
        }
        return send(out);
      };
    }
    next();
  } catch (err) { next(err); }
}

/** What the browser needs to draw the right screens. */
const describe = (user, scope) => ({
  role: user.department,
  overseer: OVERSEERS.includes(user.department),
  siteIds: scope.siteIds ? [...scope.siteIds] : null,
  keeperOf: scope.keeperOf,
  // every write rule, in the server's order, with this login's verdict,
  // so a button asks the same question the server will. Only the
  // allowed patterns would not do: first match wins, and /indents/:id/decide
  // is caught by the approvals rule before the site's /indents rule.
  writes: WRITES.slice(1).map(([re, roles]) => [re.source, roles.includes(user.department)]),
});

module.exports = { ROLES, ALL_ROLES, OVERSEERS, WRITES, canWrite, scopeOf, enforce, describe };
