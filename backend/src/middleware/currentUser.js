'use strict';
const { one, many } = require('../config/db');

/**
 * Who is acting, for the sake of the record.
 *
 * There is deliberately no login and no permission check yet. Who may
 * see and do what is a decision we have not taken, and guessing at it
 * now would mean building screens around rules that change. All this
 * does is answer "whose name goes on the document".
 *
 * Send `X-User-Id`. Without it, the first user is assumed.
 * When auth arrives this file is the only thing that changes.
 */
async function currentUser(req, _res, next) {
  try {
    const asked = Number(req.headers['x-user-id'] || 0);
    const user = asked
      ? await one(`SELECT id, name, email, department FROM users WHERE id = ? AND is_active = 1`, [asked])
      : null;
    req.user = user || (await one(
      `SELECT id, name, email, department FROM users WHERE is_active = 1 ORDER BY id LIMIT 1`
    ));
    next();
  } catch (err) { next(err); }
}

/** The people list, so a client can offer a "working as" switcher. */
async function listUsers() {
  return many(`SELECT id, emp_code, name, email, department FROM users WHERE is_active = 1 ORDER BY name`);
}

module.exports = { currentUser, listUsers };
