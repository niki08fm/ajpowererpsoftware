'use strict';
/**
 * Putting both signatures on a document.
 *
 * Five documents run the two-level chain — BOQ, PRN, rate comparison,
 * purchase order, bill — so a test that wants one approved has to sign
 * it twice, as two different people. Doing that by hand at every call
 * site is how a suite ends up quietly testing one signature.
 *
 * Every test site is created with user 5 as its GM, so 5 signs first
 * and 6 signs second. Where the first level is Management rather than
 * a site GM (the rate comparison), 5 is Management too, so the same
 * pair works and the chain's "not the same person twice" rule is what
 * makes it two real signatures.
 */
const GM = 5;          // Anil Menon — the GM on every test site
const MANAGEMENT = 6;  // Deepak Shetty — the second signature

const as = (api, userId) => (path, opts = {}) =>
  api(path, { ...opts, headers: { ...(opts.headers || {}), 'X-User-Id': String(userId) } });

/**
 * Sign a document all the way through, and hand back the last reply —
 * the one that carries the final status.
 *
 * `gm` is the first signature. It defaults to user 5 because that is
 * the GM on almost every test site, but a suite that puts somebody
 * else on a site has to say so — level one is that site's GM and
 * nobody else's.
 */
async function signOff(api, path, body = {}, gm = GM) {
  const first = await as(api, gm)(path, {
    method: 'POST', body: { action: 'APPROVED', ...body },
  });
  if (first.status >= 400) return first;
  if (first.body && first.body.done) return first;
  // whoever signed first cannot sign again, so the second is always
  // the other Management user
  return as(api, gm === MANAGEMENT ? GM : MANAGEMENT)(path, {
    method: 'POST', body: { action: 'APPROVED', ...body },
  });
}

/** Just the first signature, for a test about the middle of the chain. */
const signOnce = (api, path, body = {}) => as(api, GM)(path, {
  method: 'POST', body: { action: 'APPROVED', ...body },
});

module.exports = { GM, MANAGEMENT, as, signOff, signOnce };
