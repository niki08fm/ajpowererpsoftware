'use strict';
class AppError extends Error {
  constructor(status, code, message, extra) {
    super(message);
    this.status = status;
    this.code = code;
    if (extra) this.extra = extra;
  }
}
const badRequest = (m, extra) => new AppError(400, 'BAD_REQUEST', m, extra);
const unauthorized = (m = 'Sign in first') => new AppError(401, 'UNAUTHORIZED', m);
const forbidden = (m = 'You do not have access to this') => new AppError(403, 'FORBIDDEN', m);
const notFound = (m = 'Not found') => new AppError(404, 'NOT_FOUND', m);
const conflict = (m, extra) => new AppError(409, 'CONFLICT', m, extra);
module.exports = { AppError, badRequest, unauthorized, forbidden, notFound, conflict };
