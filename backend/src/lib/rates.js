'use strict';
const { one } = require('../config/db');

/**
 * What an item is worth on a given day.
 *
 * A site never bought anything, so it has no price of its own to
 * quote. The number the business uses is what the central store was
 * holding that item at — and 013 already settled which number that is:
 * the latest purchase rate, not a weighted average. A store that
 * bought cable at 112 last week and 128 this week will be asked what
 * today's cable is worth, and the answer people act on is 128.
 *
 * The one thing to be careful about is the word "latest". Latest as at
 * WHEN. A document dated last Tuesday must be priced at what the store
 * was holding the item at last Tuesday, not at what it is holding it
 * at now — otherwise backdating a slip silently reprices it, and a
 * cost that moves is not a cost. So every lookup here is bounded by
 * the date of the document that is asking.
 *
 * Four places to look, in the order a storekeeper would look:
 *
 *   1. the central store for this branch
 *   2. any store in this branch, if the central one has never held it
 *   3. what this site was last charged for it on the way in
 *   4. the item master's standard rate
 *
 * The caller stamps whatever comes back onto the line. It is read
 * once, at the moment the material moves, and never looked up again.
 */

/** The last price paid at one place, on or before a date. */
const paidAt = (sql, params) => `
  SELECT m.rate FROM stock_movements m
    JOIN sites s ON s.id = m.site_id
   WHERE m.item_id = ? AND m.qty > 0 AND m.rate > 0
     AND (? IS NULL OR m.moved_on <= ?)
     AND ${sql}
   ORDER BY m.moved_on DESC, m.id DESC LIMIT 1`;

async function centralRate(conn, { branchId, siteId, itemId, asOf = null }) {
  const on = [itemId, asOf, asOf];

  const central = await one(
    paidAt(`s.branch_id = ? AND s.is_central = 1`), [...on, branchId], conn);
  if (central && Number(central.rate) > 0) {
    return { rate: Number(central.rate), source: 'CENTRAL_STORE' };
  }

  const anyStore = await one(
    paidAt(`s.branch_id = ? AND s.site_type = 'STORE'`), [...on, branchId], conn);
  if (anyStore && Number(anyStore.rate) > 0) {
    return { rate: Number(anyStore.rate), source: 'BRANCH_STORE' };
  }

  if (siteId) {
    const inbound = await one(paidAt(`s.id = ?`), [...on, siteId], conn);
    if (inbound && Number(inbound.rate) > 0) {
      return { rate: Number(inbound.rate), source: 'RECEIVED_AT_SITE' };
    }
  }

  const std = await one(`SELECT std_rate FROM items WHERE id = ?`, [itemId], conn);
  const rate = Number(std?.std_rate || 0);
  return { rate, source: rate > 0 ? 'ITEM_MASTER' : 'NONE' };
}

/** Rates for a basket on one day, keyed by item id. */
async function centralRates(conn, { branchId, siteId, itemIds, asOf = null }) {
  const out = {};
  for (const id of [...new Set(itemIds)]) {
    out[id] = await centralRate(conn, { branchId, siteId, itemId: id, asOf });
  }
  return out;
}

module.exports = { centralRate, centralRates };
