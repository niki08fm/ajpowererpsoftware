'use strict';
const { one, many } = require('../config/db');
const env = require('../config/env');
const { digest } = require('../lib/password');
const { unauthorized } = require('../lib/errors');

const COLS = `u.id, u.name, u.email, u.department`;

/**
 * Who is acting.
 *
 * With logins on (the default), the browser sends the token it was
 * given at sign-in as `Authorization: Bearer <token>`, and that is the
 * only way to be anybody. No token, an expired one, or a deactivated
 * person is a 401.
 *
 * With AUTH=off — the test suites, and nothing else — it is the old
 * arrangement: `X-User-Id` names the person, or the first user is
 * assumed.
 */
async function currentUser(req, _res, next) {
  try {
    if (!env.auth) {
      const asked = Number(req.headers['x-user-id'] || 0);
      const user = asked
        ? await one(`SELECT ${COLS} FROM users u WHERE u.id = ? AND u.is_active = 1`, [asked])
        : null;
      req.user = user || (await one(
        `SELECT ${COLS} FROM users u WHERE u.is_active = 1 ORDER BY u.id LIMIT 1`));
      return next();
    }

    const m = /^Bearer\s+([a-f0-9]{64})$/i.exec(req.headers.authorization || '');
    if (!m) throw unauthorized();
    const user = await one(
      `SELECT ${COLS} FROM user_sessions s JOIN users u ON u.id = s.user_id
        WHERE s.token_hash = ? AND s.expires_at > NOW() AND u.is_active = 1`, [digest(m[1])]);
    if (!user) throw unauthorized('Your session has ended — sign in again');
    req.user = user;
    req.sessionToken = m[1];
    next();
  } catch (err) { next(err); }
}

/** The people list, for pickers: who is the GM, who keeps the store. */
async function listUsers() {
  return many(`SELECT id, emp_code, name, email, department FROM users WHERE is_active = 1 ORDER BY name`);
}

module.exports = { currentUser, listUsers };
