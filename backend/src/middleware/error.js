'use strict';
const { AppError } = require('../lib/errors');

function notFound(_req, _res, next) {
  next(new AppError(404, 'NOT_FOUND', 'No such endpoint'));
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, _next) {
  // turn the database's own guarantees into something a person can read
  if (err && err.code === 'ER_DUP_ENTRY') {
    const m = /uq_item_key/.test(err.message) ? 'An item with this name already exists in the master'
      : /uq_site_key/.test(err.message) ? 'A site with this name already exists'
      : /uq_boql_item/.test(err.message) ? 'That item is already on this work order line'
      : /uq_indl/.test(err.message)      ? 'That BOQ line is already on this indent'
      : /uq_.*_doc/.test(err.message)    ? 'That document number was taken — try again'
      : 'That record already exists';
    err = new AppError(409, 'CONFLICT', m);
  }
  if (err && err.code === 'ER_CHECK_CONSTRAINT_VIOLATED') {
    err = new AppError(400, 'BAD_REQUEST', 'A quantity or rate is outside what the schema allows');
  }

  const status = err.status || 500;
  if (status >= 500) {
    console.error(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl}`, err);
  }
  res.status(status).json({
    error: {
      code: err.code || 'INTERNAL',
      message: status >= 500 ? 'Something went wrong on our side' : err.message,
      ...(err.extra ? { detail: err.extra } : {}),
    },
  });
}

module.exports = { notFound, errorHandler };
