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
