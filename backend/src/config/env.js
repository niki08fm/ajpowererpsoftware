'use strict';
require('dotenv').config();

/**
 * Everything has a working default, so the backend runs with no .env
 * at all. Create one only when your MySQL differs from the defaults.
 */
const get = (k, fallback) => process.env[k] ?? fallback;

module.exports = {
  nodeEnv: get('NODE_ENV', 'development'),
  port: Number(get('PORT', 4000)),
  // Logins are on. The test suites turn them off (AUTH=off) and go back
  // to naming the acting user in an X-User-Id header, because they are
  // testing the documents, not the door. Never set it off anywhere real.
  auth: get('AUTH', 'on') !== 'off',
  // Everyone who has no password yet gets this one on startup, so the
  // trial can be signed into at all. Management changes them from Users.
  trialPassword: get('TRIAL_PASSWORD', 'ajpower@123'),
  sessionDays: Number(get('SESSION_DAYS', 7)),
  db: {
    host: get('DB_HOST', '127.0.0.1'),
    port: Number(get('DB_PORT', 3306)),
    user: get('DB_USER', 'root'),
    password: get('DB_PASSWORD', ''),
    database: get('DB_NAME', 'ajp_erp'),
    connectionLimit: Number(get('DB_CONNECTION_LIMIT', 10)),
    ...(process.env.DB_SOCKET ? { socketPath: process.env.DB_SOCKET } : {}),
  },
};
