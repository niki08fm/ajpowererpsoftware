'use strict';
const app = require('./app');
const env = require('./config/env');
const { pool } = require('./config/db');

const server = app.listen(env.port, () => {
  console.log(`AJ Power ERP API on :${env.port} (${env.nodeEnv})`);
});

// finish what is in flight, then let go of the pool
for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, () => {
    console.log(`${sig} — shutting down`);
    server.close(async () => { await pool.end(); process.exit(0); });
    setTimeout(() => process.exit(1), 10000).unref();
  });
}
