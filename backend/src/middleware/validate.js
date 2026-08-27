'use strict';
const { badRequest } = require('../lib/errors');

/** Validate req[where] against a zod schema and replace it with the parsed value. */
const validate = (schema, where = 'body') => (req, _res, next) => {
  const r = schema.safeParse(req[where]);
  if (!r.success) {
    const first = r.error.issues[0];
    return next(badRequest(
      `${first.path.join('.') || where}: ${first.message}`,
      r.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message }))
    ));
  }
  req[where] = r.data;
  next();
};

/** Wrap an async handler so a rejected promise reaches the error handler. */
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

module.exports = { validate, wrap };
