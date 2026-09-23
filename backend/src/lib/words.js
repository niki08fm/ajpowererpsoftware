'use strict';

/** A count with its noun: "1 line", "3 lines" — never "line(s)". */
const plural = (n, one, many = `${one}s`) => `${n} ${Number(n) === 1 ? one : many}`;

module.exports = { plural };
