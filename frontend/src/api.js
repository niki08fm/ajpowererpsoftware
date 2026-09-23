/**
 * The one place that talks to the API.
 *
 * Every request carries the session token handed out at sign-in. A 401
 * means the session is over — expired, signed out elsewhere, or the
 * login was switched off — and the app goes back to the sign-in screen.
 */
const BASE = '/api';

export class ApiError extends Error {
  constructor(status, body) {
    super(body?.error?.message || 'Something went wrong');
    this.status = status;
    this.code = body?.error?.code;
    this.detail = body?.error?.detail;
  }
}

const read = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const write = (k, v) => {
  try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* private window */ }
};

let token = read('ajp.token');
export const setToken = (t) => { token = t || null; write('ajp.token', token); };
export const getToken = () => token;

// App sets this, so a dead session anywhere lands on the sign-in screen
let onSignedOut = () => {};
export const whenSignedOut = (fn) => { onSignedOut = fn; };

// what this login may write: the server's rules in its order, each with
// this login's verdict (lib/access.js). The first rule that matches
// decides, here as on the server.
let writes = [];
export const setWrites = (list) => { writes = (list || []).map(([s, ok]) => [new RegExp(s), ok]); };
/** Would the server let this login make this write? */
export const canWrite = (path) => {
  const rule = writes.find(([re]) => re.test(path.split('?')[0]));
  return rule ? rule[1] : false;
};

async function request(path, { method = 'GET', body, raw } = {}) {
  // a view-only login is told here, before the round trip, rather than
  // by a refusal after it
  if (method !== 'GET' && !path.startsWith('/auth/') && !canWrite(path)) {
    throw new ApiError(403, { error: { code: 'FORBIDDEN',
      message: 'Your login can only view this — the department that owns it does this step' } });
  }
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body && !raw) headers['Content-Type'] = 'application/json';

  const res = await fetch(BASE + path, {
    method,
    headers,
    body: raw ? body : body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (res.status === 401 && !path.startsWith('/auth/login')) {
    setToken(null);
    onSignedOut();
  }
  if (!res.ok) throw new ApiError(res.status, data);
  return data;
}

export const api = {
  get: (p) => request(p),
  post: (p, body) => request(p, { method: 'POST', body }),
  put: (p, body) => request(p, { method: 'PUT', body }),
  patch: (p, body) => request(p, { method: 'PATCH', body }),
  del: (p) => request(p, { method: 'DELETE' }),
  upload: (p, file) => {
    const fd = new FormData();
    fd.append('file', file);
    return request(p, { method: 'POST', body: fd, raw: true });
  },
};

/* ------------------------------------------------------- formatting */
const inr = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 3 });
const inr2 = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * Money: Indian grouping and always two decimals — ₹3,398.40, never
 * ₹3,398.4, which reads like a different amount at a glance.
 */
export const money = (n) => '₹' + inr2.format(Math.round((Number(n) || 0) * 100) / 100);

/** Quantities drop trailing zeros: 10 not 10.000, but 12.5 stays 12.5. */
export const qty = (n) => {
  const v = Number(n) || 0;
  return inr.format(Math.round(v * 1000) / 1000);
};

/** A quantity with its noun: 1 unit, 60 units. */
export const units = (n) => `${qty(n)} ${Number(n) === 1 ? 'unit' : 'units'}`;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/**
 * A date as 22 Sep 2026. The month is a word and the year has four
 * digits, so 04/05/26 — April or May, 2026 or the 26th — cannot happen.
 */
export const dmy = (d) => {
  if (!d) return '—';
  const [y, m, day] = String(d).slice(0, 10).split('-');
  if (!y || !m || !day) return String(d);
  return `${Number(day)} ${MONTHS[Number(m) - 1]} ${y}`;
};

/** The same with the weekday — for the line under a date input. */
export const longDate = (d) => {
  if (!d) return '';
  const [y, m, day] = String(d).slice(0, 10).split('-').map(Number);
  if (!y || !m || !day) return '';
  const t = new Date(Date.UTC(y, m - 1, day));
  return `${DAYS[t.getUTCDay()]}, ${day} ${MONTHS[m - 1]} ${y}`;
};

/** Whole days from today to a date: negative is in the past. */
export const daysFrom = (d) => {
  if (!d) return null;
  const [y, m, day] = String(d).slice(0, 10).split('-').map(Number);
  const now = new Date();
  const a = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((Date.UTC(y, m - 1, day) - a) / 86400000);
};

/** "in 3 days", "today", "2 days ago" — for dates people plan by. */
export const relDays = (d) => {
  const n = daysFrom(d);
  if (n === null || Number.isNaN(n)) return '';
  if (n === 0) return 'today';
  if (n === 1) return 'tomorrow';
  if (n === -1) return 'yesterday';
  return n > 0 ? `in ${n} days` : `${-n} days ago`;
};

/** A count with its noun, pluralised: 1 line, 3 lines. */
export const plural = (n, one, many = `${one}s`) => `${n} ${Number(n) === 1 ? one : many}`;

export const today = () => new Date().toISOString().slice(0, 10);
export const addDays = (d, n) => {
  const t = new Date(d);
  t.setDate(t.getDate() + n);
  return t.toISOString().slice(0, 10);
};

/**
 * A path scoped to one branch, or to every branch when there is none.
 * `null` is how the app says "all branches", and it must leave the
 * parameter out entirely — `branchId=null` is not "all", it is a 400.
 */
export const withBranch = (path, branchId) => (branchId
  ? `${path}${path.includes('?') ? '&' : '?'}branchId=${branchId}`
  : path);
