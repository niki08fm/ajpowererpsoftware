'use strict';
const router = require('express').Router();
const { z } = require('zod');
const { one, run } = require('../config/db');
const env = require('../config/env');
const { validate, wrap } = require('../middleware/validate');
const { unauthorized, badRequest } = require('../lib/errors');
const password = require('../lib/password');
const access = require('../lib/access');

/**
 * Signing in and out.
 *
 * /login is the only endpoint anyone can reach without a session. It
 * answers the same "wrong email or password" whichever of the two was
 * wrong, so it cannot be used to find out who has an account.
 */
router.post('/login',
  validate(z.object({
    email: z.string().trim().toLowerCase().min(3).max(160),
    password: z.string().min(1).max(200),
  })),
  wrap(async (req, res) => {
    const u = await one(
      `SELECT id, name, email, department, password_hash FROM users
        WHERE LOWER(email) = ? AND is_active = 1`, [req.body.email]);
    const ok = u && await password.verify(req.body.password, u.password_hash);
    if (!ok) throw unauthorized('Wrong email or password');

    const token = password.newToken();
    await run(
      `INSERT INTO user_sessions (token_hash, user_id, expires_at)
       VALUES (?, ?, DATE_ADD(NOW(), INTERVAL ? DAY))`,
      [password.digest(token), u.id, env.sessionDays]);
    await run(`UPDATE users SET last_login_at = NOW() WHERE id = ?`, [u.id]);
    // tidy up while we are here; nobody needs a dead session row
    await run(`DELETE FROM user_sessions WHERE expires_at < NOW()`);

    const user = { id: u.id, name: u.name, email: u.email, department: u.department };
    res.json({ token, user, access: access.describe(user, await access.scopeOf(user)) });
  })
);

/** Everything below needs a session; the router mounts it after auth. */
const signedIn = require('express').Router();

signedIn.post('/logout', wrap(async (req, res) => {
  if (req.sessionToken) {
    await run(`DELETE FROM user_sessions WHERE token_hash = ?`, [password.digest(req.sessionToken)]);
  }
  res.json({ ok: true });
}));

signedIn.get('/me', wrap(async (req, res) => {
  res.json({ user: req.user, access: access.describe(req.user, await access.scopeOf(req.user)) });
}));

/** Change your own password. Signs out every other session of yours. */
signedIn.post('/password',
  validate(z.object({
    current: z.string().min(1).max(200),
    next: z.string().min(8, 'At least 8 characters').max(200),
  })),
  wrap(async (req, res) => {
    const u = await one(`SELECT password_hash FROM users WHERE id = ?`, [req.user.id]);
    if (!(await password.verify(req.body.current, u?.password_hash))) {
      throw badRequest('Your current password is not right');
    }
    await run(`UPDATE users SET password_hash = ? WHERE id = ?`,
      [await password.hash(req.body.next), req.user.id]);
    await run(`DELETE FROM user_sessions WHERE user_id = ? AND token_hash <> ?`,
      [req.user.id, password.digest(req.sessionToken || '')]);
    res.json({ ok: true });
  })
);

module.exports = { publicAuth: router, signedInAuth: signedIn };
