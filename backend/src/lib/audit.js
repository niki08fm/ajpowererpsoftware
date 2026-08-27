'use strict';
const { run } = require('../config/db');

/** Append-only. Never updated, never deleted. */
async function log(conn, { entity, entityId = null, docNo = null, action, detail = null, user }) {
  await run(
    `INSERT INTO audit_log (entity, entity_id, doc_no, action, detail, user_id)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [entity, entityId, docNo, action, detail ? String(detail).slice(0, 600) : null, user?.id ?? null],
    conn
  );
}
module.exports = { log };
