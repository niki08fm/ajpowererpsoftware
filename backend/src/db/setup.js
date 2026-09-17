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

  // 001 + 002 are the item master — loaded once, gated on the items table being empty.
  // 003 + 004 are demo/ERP data — loaded once, gated on the sites table being empty.
  // Keeping the two gates separate means a reset that preserves the item master
  // (unlikely, but possible) still gets the demo rows.
  const DEMO_SEEDS = new Set(['003_demo_data.sql', '004_expanded_data.sql']);

  const [[{ n }]] = await conn.query('SELECT COUNT(*) AS n FROM items');
  if (n === 0) {
    for (const f of files('seeds').filter((f) => !DEMO_SEEDS.has(f))) {
      process.stdout.write(`  loading ${f} `);
      await conn.query(fs.readFileSync(path.join(__dirname, 'seeds', f), 'utf8'));
      console.log('ok');
    }
    const [[c]] = await conn.query('SELECT COUNT(*) AS n FROM items');
    console.log(`  item master ready: ${c.n} items`);
  } else if (ran || !quiet) {
    say(`  database ready: ${n} items in the master`);
  }

  // Demo data: inject if no sites exist yet (fresh DB or explicit reset)
  const [[{ s }]] = await conn.query('SELECT COUNT(*) AS s FROM sites');
  if (s === 0) {
    for (const f of [...DEMO_SEEDS]) {
      process.stdout.write(`  loading ${f} `);
      await conn.query(fs.readFileSync(path.join(__dirname, 'seeds', f), 'utf8'));
      console.log('ok');
    }
    const [[d]] = await conn.query('SELECT COUNT(*) AS d FROM work_orders');
    console.log(`  demo data ready: ${d.d} work orders`);
  }

  await conn.end();
}

if (require.main === module) {
  setup({ fresh: process.argv.includes('--fresh') })
    .then(() => process.exit(0))
    .catch((e) => { console.error(e.message); process.exit(1); });
}

module.exports = { setup };
