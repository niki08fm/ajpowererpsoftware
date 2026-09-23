'use strict';
const { many, one, run } = require('../config/db');
const { conflict, badRequest } = require('./errors');

/**
 * The approval chain: GM first, then Management.
 *
 * Five documents pass through it — the BOQ, the PRN, the rate
 * comparison, the purchase order and the bill — and they all pass
 * through it the same way, which is why it is written once here rather
 * than five times in five modules.
 *
 * The rules, all of them:
 *
 * 1. A document is submitted, and the chain opens at level 1.
 * 2. Level 1 is the GM of the document's site. A comparison belongs to
 *    a branch rather than a site, so its first level is Management too.
 * 3. Level 2 is Management.
 * 4. The same person may not sign both levels. A GM is management —
 *    that is why the rule is about the person and not the department,
 *    and without it a site whose GM is also the management signatory
 *    would have one signature wearing two hats.
 * 5. Either level may send it back. That ends the chain; the document
 *    returns to whoever raised it, and submitting again opens a fresh
 *    chain at level 1. A second signature is not kept in reserve.
 *
 * The chain never writes the document's status. It answers "is this
 * finished", and the module that owns the document decides what that
 * means for it — locked, approved, raised. That keeps the meaning of
 * every status where the rest of the code already looks for it.
 */

const TYPES = {
  BOQ:        { label: 'BOQ',             firstLevel: 'GM' },
  PRN:        { label: 'PRN',             firstLevel: 'GM' },
  PO:         { label: 'Purchase order',  firstLevel: 'GM' },
  BILL:       { label: 'Bill',            firstLevel: 'GM' },
  // no single site behind it: procurement compares rates for whatever
  // is on the buy list, which may span several
  COMPARISON: { label: 'Rate comparison', firstLevel: 'MANAGEMENT' },
};

const LEVELS = 2;

/** Everyone who may sign as Management. */
const management = () =>
  many(`SELECT id, name FROM users WHERE department = 'Management' ORDER BY id`);

/**
 * Who may sign this level, as a list of user ids.
 *
 * Level 1 of a site document is exactly one person — the site's GM —
 * so it is routed, not offered around. Management levels are open to
 * any Management user except whoever has already signed this document.
 */
async function approvers(chain) {
  const type = TYPES[chain.doc_type];
  const already = [chain.level1_by, chain.level2_by].filter(Boolean).map(Number);

  if (chain.level === 1 && type.firstLevel === 'GM') {
    const site = chain.site_id
      ? await one(`SELECT gm_user_id FROM sites WHERE id = ?`, [chain.site_id])
      : null;
    if (site?.gm_user_id) return [Number(site.gm_user_id)];
    // No GM behind it — a central store has none, and a site may be
    // between GMs. Falling through to Management is not ideal, but a
    // chain nobody on earth can sign is worse: the document would sit
    // there for ever with no way to move it.
  }
  return (await management()).map((u) => Number(u.id))
    .filter((id) => !already.includes(id));
}

/** Can this person sign it right now? */
async function canSign(chain, userId) {
  if (!chain || chain.status !== 'PENDING' || !userId) return false;
  return (await approvers(chain)).includes(Number(userId));
}

const chainOf = (docType, docId) =>
  one(`SELECT * FROM approval_chains WHERE doc_type = ? AND doc_id = ?`, [docType, docId]);

/**
 * Open a chain, or reopen one that was sent back.
 *
 * Reopening resets it to level 1 and clears both signatures: a
 * document that has been changed since somebody signed it has not been
 * signed. It is the same row so that "this document's chain" stays one
 * thing, and the event log keeps every attempt.
 */
async function open(conn, { docType, docId, docNo, branchId, siteId, userId, note }) {
  if (!TYPES[docType]) throw badRequest(`${docType} does not go through approval`);
  const existing = await chainOf(docType, docId);

  if (existing) {
    if (existing.status === 'PENDING') {
      throw conflict(`${docNo || existing.doc_no} is already waiting for approval`);
    }
    if (existing.status === 'APPROVED') {
      throw conflict(`${docNo || existing.doc_no} has already been approved`);
    }
    await run(
      `UPDATE approval_chains
          SET level = 1, status = 'PENDING', level1_by = NULL, level1_at = NULL,
              level2_by = NULL, level2_at = NULL, waiting_since = NOW(), raised_by = ?
        WHERE id = ?`, [userId || null, existing.id], conn);
    await run(
      `INSERT INTO approval_chain_events (chain_id, level, action, user_id, note)
       VALUES (?, 1, 'SUBMITTED', ?, ?)`, [existing.id, userId || null, note || null], conn);
    return { ...existing, level: 1, status: 'PENDING' };
  }

  const r = await run(
    `INSERT INTO approval_chains
       (doc_type, doc_id, doc_no, branch_id, site_id, levels, level, raised_by)
     VALUES (?, ?, ?, ?, ?, ?, 1, ?)`,
    [docType, docId, docNo, branchId, siteId || null, LEVELS, userId || null], conn);
  await run(
    `INSERT INTO approval_chain_events (chain_id, level, action, user_id, note)
     VALUES (?, 1, 'SUBMITTED', ?, ?)`, [r.insertId, userId || null, note || null], conn);
  return chainOf(docType, docId);
}

/**
 * Sign, or send back.
 *
 * Returns what the caller needs to know and nothing more: whether the
 * document is now finished with approval, and which level was just
 * signed — so the module can say "signed by the GM, now with
 * Management" rather than making the reader guess.
 */
async function decide(conn, { docType, docId, action, userId, note, enforce = true }) {
  const chain = await chainOf(docType, docId);
  if (!chain) throw conflict('This document was never submitted for approval');
  if (chain.status !== 'PENDING') {
    throw conflict(`This document is ${chain.status.toLowerCase()}, not waiting`);
  }
  // With no login, "who you are" is a dropdown, so this is a routing
  // rule rather than a security one — but signing twice yourself is
  // the one thing it will not let through even so.
  if (enforce && !userId) {
    throw conflict('An approval needs to know who is approving — sign in first');
  }
  if (enforce && !(await canSign(chain, userId))) {
    const same = [chain.level1_by, chain.level2_by].filter(Boolean).map(Number)
      .includes(Number(userId));
    throw conflict(same
      ? 'You approved this at level 1; level 2 has to be somebody else'
      : 'This is not yours to approve at this level');
  }

  const level = Number(chain.level);

  if (action === 'RETURNED') {
    await run(`UPDATE approval_chains SET status = 'RETURNED', waiting_since = NOW() WHERE id = ?`,
      [chain.id], conn);
    await run(
      `INSERT INTO approval_chain_events (chain_id, level, action, user_id, note)
       VALUES (?, ?, 'RETURNED', ?, ?)`, [chain.id, level, userId || null, note || null], conn);
    return { done: false, returned: true, level, levels: LEVELS };
  }

  const last = level >= LEVELS;
  await run(
    `UPDATE approval_chains
        SET ${level === 1 ? 'level1_by = ?, level1_at = NOW()' : 'level2_by = ?, level2_at = NOW()'},
            level = ?, status = ?, waiting_since = NOW()
      WHERE id = ?`,
    [userId || null, last ? level : level + 1, last ? 'APPROVED' : 'PENDING', chain.id], conn);
  await run(
    `INSERT INTO approval_chain_events (chain_id, level, action, user_id, note)
     VALUES (?, ?, 'APPROVED', ?, ?)`, [chain.id, level, userId || null, note || null], conn);

  return { done: last, returned: false, level, levels: LEVELS };
}

/**
 * The trail, for a document's own screen.
 *
 * `waitingOn` says which desk it is on — 'GM' or 'MANAGEMENT' — and
 * `waitingOnNames` who is sitting at it, worked out the same way the
 * chain routes it (a site with no GM goes to Management), so a screen
 * can say "with Kavya Reddy" instead of leaving people to guess.
 * `canApprove` says whether the person looking (`userId`) is one of
 * them — a screen offers Approve to them and to nobody else.
 */
async function trail(docType, docId, userId) {
  const chain = await chainOf(docType, docId);
  if (!chain) return null;
  const events = await many(
    `SELECT e.level, e.action, e.note, e.created_at, u.name AS by_name
       FROM approval_chain_events e LEFT JOIN users u ON u.id = e.user_id
      WHERE e.chain_id = ? ORDER BY e.created_at, e.id`, [chain.id]);

  const pending = chain.status === 'PENDING';
  let waitingOn = null;
  let waitingOnNames = [];
  let canApprove = false;
  if (pending) {
    const who = await approvers(chain);
    canApprove = Boolean(userId) && who.includes(Number(userId));
    const site = chain.site_id
      ? await one(`SELECT gm_user_id FROM sites WHERE id = ?`, [chain.site_id]) : null;
    waitingOn = Number(chain.level) === 1 && TYPES[chain.doc_type].firstLevel === 'GM'
      && site?.gm_user_id ? 'GM' : 'MANAGEMENT';
    waitingOnNames = who.length
      ? (await many(`SELECT name FROM users WHERE id IN (?) ORDER BY name`, [who])).map((u) => u.name)
      : [];
  }
  // every level, signed or not, with the person or people it belongs to,
  // so a reader sees at once how many are done, how many are left, and
  // whose they are
  const names = async (ids) => (ids.length
    ? (await many(`SELECT name FROM users WHERE id IN (?) ORDER BY name`, [ids])).map((u) => u.name)
    : []);
  const signer = async (id) => (id ? (await one(`SELECT name FROM users WHERE id = ?`, [id]))?.name : null);
  const firstIsGm = TYPES[chain.doc_type].firstLevel === 'GM';
  const gmRow = firstIsGm && chain.site_id
    ? await one(`SELECT u.id, u.name FROM sites s JOIN users u ON u.id = s.gm_user_id WHERE s.id = ?`,
      [chain.site_id]) : null;
  const mgmt = (await management()).map((u) => Number(u.id));
  const steps = [];
  for (let lv = 1; lv <= Number(chain.levels); lv += 1) {
    const by = chain[`level${lv}_by`];
    const at = chain[`level${lv}_at`];
    const role = lv === 1 && gmRow ? 'General Manager' : 'Management';
    const who = lv === 1 && gmRow ? [gmRow.name]
      : await names(mgmt.filter((id) => id !== Number(chain.level1_by || 0)));
    steps.push({
      level: lv, role, who,
      state: by ? 'APPROVED'
        : chain.status === 'RETURNED' && Number(chain.level) === lv ? 'RETURNED'
          : pending && Number(chain.level) === lv ? 'WAITING' : 'LATER',
      by: await signer(by), at,
    });
  }

  return {
    status: chain.status,
    level: Number(chain.level),
    levels: Number(chain.levels),
    steps,
    approvedCount: steps.filter((st) => st.state === 'APPROVED').length,
    waitingSince: chain.waiting_since,
    waitingOn,
    waitingOnNames,
    canApprove,
    events: events.map((e) => ({
      level: Number(e.level), action: e.action, note: e.note,
      by: e.by_name, at: e.created_at,
    })),
  };
}

/** Has this document cleared both levels? */
const isApproved = async (docType, docId) =>
  (await chainOf(docType, docId))?.status === 'APPROVED';

module.exports = { TYPES, LEVELS, open, decide, chainOf, canSign, approvers, trail, isApproved };
