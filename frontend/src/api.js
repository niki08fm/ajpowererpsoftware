/**
 * The one place that talks to the API.
 *
 * There is no login yet, so the "working as" user is a header. When
 * authentication arrives this file gains a token and nothing else
 * changes.
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

let userId = Number(localStorage.getItem('ajp.userId')) || null;
export const setUserId = (id) => {
  userId = id;
  localStorage.setItem('ajp.userId', String(id));
};
export const getUserId = () => userId;

async function request(path, { method = 'GET', body, raw } = {}) {
  const headers = {};
  if (userId) headers['X-User-Id'] = String(userId);
  if (body && !raw) headers['Content-Type'] = 'application/json';

  const res = await fetch(BASE + path, {
    method,
    headers,
    body: raw ? body : body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
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
const inr = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 });

/** Indian grouping, because that is how these numbers are read here. */
export const money = (n) => '₹' + inr.format(Math.round((Number(n) || 0) * 100) / 100);

/** Quantities drop trailing zeros: 10 not 10.000, but 12.5 stays 12.5. */
export const qty = (n) => {
  const v = Number(n) || 0;
  return inr.format(Math.round(v * 1000) / 1000);
};

export const dmy = (d) => {
  if (!d) return '—';
  const [y, m, day] = String(d).slice(0, 10).split('-');
  return `${day}/${m}/${y.slice(2)}`;
};

export const today = () => new Date().toISOString().slice(0, 10);
export const addDays = (d, n) => {
  const t = new Date(d);
  t.setDate(t.getDate() + n);
  return t.toISOString().slice(0, 10);
};
