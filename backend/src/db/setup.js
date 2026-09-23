'use strict';
/**
 * Run before the server starts.
 *
 * Applies any migration that has not been applied, and loads the seed
 * data the first time only. Safe to run on every start — that is the
 * point, so `npm run dev` is the only command anyone has to remember.
 */
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const env = require('./../config/env');
const password = require('../lib/password');
const { plural } = require('../lib/words');

const files = (dir) =>
  fs.readdirSync(path.join(__dirname, dir)).filter((f) => f.endsWith('.sql')).sort();

async function setup({ fresh = false, quiet = false } = {}) {
  const say = (m) => !quiet && console.log(m);
  let conn;
  try {
    conn = await mysql.createConnection({
      host: env.db.host, port: env.db.port, user: env.db.user, password: env.db.password,
      ...(env.db.socketPath ? { socketPath: env.db.socketPath } : {}),
      multipleStatements: true,
    });
  } catch (e) {
    console.error(`\n  Cannot reach MySQL at ${env.db.host}:${env.db.port} as "${env.db.user}".`);
    console.error('  Start MySQL, or put the right details in backend/.env\n');
    console.error(`  (${e.message})\n`);
    process.exit(1);
  }

  if (fresh) {
    say(`  dropping ${env.db.database}`);
    await conn.query(`DROP DATABASE IF EXISTS \`${env.db.database}\``);
  }
  await conn.query(
    `CREATE DATABASE IF NOT EXISTS \`${env.db.database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
  );
  await conn.changeUser({ database: env.db.database });
  await conn.query('SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci');

  await conn.query(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
       filename VARCHAR(120) NOT NULL PRIMARY KEY,
       applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP)`
  );
  const [done] = await conn.query('SELECT filename FROM schema_migrations');
  const applied = new Set(done.map((r) => r.filename));

  let ran = 0;
  for (const f of files('migrations')) {
    if (applied.has(f)) continue;
    process.stdout.write(`  applying ${f} `);
    await conn.query(fs.readFileSync(path.join(__dirname, 'migrations', f), 'utf8'));
    await conn.query('INSERT INTO schema_migrations (filename) VALUES (?)', [f]);
    console.log('ok');
    ran += 1;
  }

  // seeds run once: if the item master is there, they have been loaded
  const [[{ n }]] = await conn.query('SELECT COUNT(*) AS n FROM items');
  if (n === 0) {
    for (const f of files('seeds')) {
      process.stdout.write(`  loading ${f} `);
      await conn.query(fs.readFileSync(path.join(__dirname, 'seeds', f), 'utf8'));
      console.log('ok');
    }
    const [[c]] = await conn.query('SELECT COUNT(*) AS n FROM items');
    console.log(`  item master ready: ${c.n} items`);
  } else if (ran || !quiet) {
    say(`  database ready: ${n} items in the master`);
  }

  // Anyone without a password gets the trial one, so every login in the
  // trial works on day one. Management replaces them from the Users screen.
  const [nopass] = await conn.query(
    'SELECT id FROM users WHERE password_hash IS NULL AND is_active = 1');
  if (nopass.length) {
    for (const u of nopass) {
      await conn.query('UPDATE users SET password_hash = ? WHERE id = ?',
        [await password.hash(env.trialPassword), u.id]);
    }
    say(`  ${plural(nopass.length, 'login')} given the trial password "${env.trialPassword}"`);
  }

  await conn.end();
}

if (require.main === module) {
  setup({ fresh: process.argv.includes('--fresh') })
    .then(() => process.exit(0))
    .catch((e) => { console.error(e.message); process.exit(1); });
}

module.exports = { setup };
