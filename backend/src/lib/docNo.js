'use strict';
const { one, run } = require('../config/db');

/** Indian financial year label for a date: 2026-08-25 -> '26-27'. */
function fyOf(date = new Date()) {
  const d = typeof date === 'string' ? new Date(date) : date;
  const y = d.getFullYear();
  const startYear = d.getMonth() + 1 >= 4 ? y : y - 1;
  return `${String(startYear % 100).padStart(2, '0')}-${String((startYear + 1) % 100).padStart(2, '0')}`;
}

/**
 * Next document number, taken under a row lock.
 *
 * MUST be called inside a transaction, with that transaction's
 * connection. Two people pressing Submit in the same second is not a
 * hypothetical in a business with three branches, and the legacy
 * system's answer — read the max and add one — handed them the same
 * number often enough that people stopped trusting the numbering.
 */
async function nextDocNo(conn, docType, date = new Date()) {
  if (!conn) throw new Error('nextDocNo needs the transaction connection');
  const fy = fyOf(date);
  await run(
    `INSERT INTO doc_counters (doc_type, fy, last_no) VALUES (?, ?, 0)
     ON DUPLICATE KEY UPDATE last_no = last_no`,
    [docType, fy], conn
  );
  const row = await one(
    `SELECT last_no FROM doc_counters WHERE doc_type = ? AND fy = ? FOR UPDATE`,
    [docType, fy], conn
  );
  const next = Number(row.last_no) + 1;
  await run(
    `UPDATE doc_counters SET last_no = ? WHERE doc_type = ? AND fy = ?`,
    [next, docType, fy], conn
  );
  return `${docType}/${fy}/${String(next).padStart(4, '0')}`;
}

/** Next item code in a category: EAR-0039. Same locking story. */
async function nextItemCode(conn, categoryCode) {
  if (!conn) throw new Error('nextItemCode needs the transaction connection');
  await run(
    `INSERT INTO item_code_counters (category_code, last_no) VALUES (?, 0)
     ON DUPLICATE KEY UPDATE last_no = last_no`,
    [categoryCode], conn
  );
  const row = await one(
    `SELECT last_no FROM item_code_counters WHERE category_code = ? FOR UPDATE`,
    [categoryCode], conn
  );
  const next = Number(row.last_no) + 1;
  await run(`UPDATE item_code_counters SET last_no = ? WHERE category_code = ?`, [next, categoryCode], conn);
  return `${categoryCode}-${String(next).padStart(4, '0')}`;
}

/** Site and store codes: ST-0007 / GD-0002. */
async function nextSiteCode(conn, siteType) {
  const prefix = siteType === 'STORE' ? 'GD' : 'ST';
  return nextItemCode(conn, prefix);
}

module.exports = { fyOf, nextDocNo, nextItemCode, nextSiteCode };
