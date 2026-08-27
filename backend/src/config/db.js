'use strict';
const mysql = require('mysql2/promise');
const env = require('./env');

const pool = mysql.createPool({
  ...env.db,
  waitForConnections: true,
  queueLimit: 0,
  // quantities and money come back as strings otherwise, and then
  // someone does string + string and ships a bug to a client bill
  decimalNumbers: true,
  // The database is utf8mb4_unicode_ci. Without matching the connection
  // to it, comparing a column derived in a view against a literal in a
  // WHERE clause raises ER_CANT_AGGREGATE_2COLLATIONS.
  charset: 'UTF8MB4_UNICODE_CI',
  dateStrings: ['DATE'],
  timezone: 'Z',
  namedPlaceholders: false,
});

// A default parameter only applies to `undefined`, and callers that run
// both inside and outside a transaction pass `null` for "no transaction".
// Coalescing here means neither has to remember.
const on = (conn) => conn || pool;

// belt and braces: the driver's charset option does not always reach
// MariaDB, so say it out loud on every new connection
pool.on('connection', (conn) => {
  conn.query('SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci');
});

/** One row, or null. */
async function one(sql, params = [], conn) {
  const [rows] = await on(conn).query(sql, params);
  return rows[0] || null;
}

/** Every row. */
async function many(sql, params = [], conn) {
  const [rows] = await on(conn).query(sql, params);
  return rows;
}

/** Insert/update/delete; returns the driver result. */
async function run(sql, params = [], conn) {
  const [res] = await on(conn).query(sql, params);
  return res;
}

/**
 * Run a unit of work in a transaction.
 *
 * Every write in this API goes through here. A GRN that half-writes is
 * the single worst thing an ERP can do, and the legacy system did it
 * regularly because it had no transactions at all.
 */
async function tx(fn) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const out = await fn(conn);
    await conn.commit();
    return out;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

module.exports = { pool, one, many, run, tx };
