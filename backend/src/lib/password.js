'use strict';
const crypto = require('crypto');

/**
 * Passwords, hashed with scrypt from Node's own crypto — no dependency.
 *
 * Stored as `scrypt$<salt hex>$<hash hex>`. The prefix is there so the
 * scheme can change later without guessing what an old row holds.
 */
const KEYLEN = 64;

const hash = (password) => new Promise((resolve, reject) => {
  const salt = crypto.randomBytes(16);
  crypto.scrypt(String(password), salt, KEYLEN, (err, key) => {
    if (err) reject(err);
    else resolve(`scrypt$${salt.toString('hex')}$${key.toString('hex')}`);
  });
});

const verify = (password, stored) => new Promise((resolve) => {
  const [scheme, saltHex, keyHex] = String(stored || '').split('$');
  if (scheme !== 'scrypt' || !saltHex || !keyHex) return resolve(false);
  crypto.scrypt(String(password), Buffer.from(saltHex, 'hex'), KEYLEN, (err, key) => {
    if (err) return resolve(false);
    const want = Buffer.from(keyHex, 'hex');
    resolve(want.length === key.length && crypto.timingSafeEqual(want, key));
  });
});

/** A session token for the browser, and the digest we keep of it. */
const newToken = () => crypto.randomBytes(32).toString('hex');
const digest = (token) => crypto.createHash('sha256').update(String(token)).digest('hex');

module.exports = { hash, verify, newToken, digest };
