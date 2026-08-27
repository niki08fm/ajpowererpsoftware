import { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';
import { api } from '../api';

/* --------------------------------------------------------- toasts */
const ToastCtx = createContext(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastHost({ children }) {
  const [items, setItems] = useState([]);
  const push = useCallback((text, kind = '') => {
    const id = Math.random().toString(36).slice(2);
    setItems((x) => [...x, { id, text, kind }]);
    setTimeout(() => setItems((x) => x.filter((i) => i.id !== id)), 4200);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {items.map((t) => <div key={t.id} className={`toast ${t.kind}`}>{t.text}</div>)}
      </div>
    </ToastCtx.Provider>
  );
}

/* ------------------------------------------------------- data load */
/** Fetch on mount, and again when the path or deps change. */
export function useApi(path, deps = []) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!path) { setLoading(false); return; }
    let live = true;
    setLoading(true);
    api.get(path)
      .then((d) => { if (live) { setData(d); setError(null); } })
      .catch((e) => { if (live) setError(e); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, tick, ...deps]);

  return { data, error, loading, reload: () => setTick((t) => t + 1) };
}

/* ---------------------------------------------------------- pieces */
export const Card = ({ title, sub, actions, children, className = '' }) => (
  <div className={`card ${className}`}>
    {(title || actions) && (
      <header>
        {title && <div><h3>{title}</h3>{sub && <p>{sub}</p>}</div>}
        <div className="sp" />
        {actions}
      </header>
    )}
    {children}
  </div>
);

export const Field = ({ label, hint, children }) => (
  <div className="field">
    {label && <label>{label}</label>}
    {children}
    {hint && <div className="hint">{hint}</div>}
  </div>
);

export const Tag = ({ kind = '', children }) => <span className={`tag ${kind}`}>{children}</span>;

export const Banner = ({ kind = 'info', icon, children, action }) => (
  <div className={`banner ${kind}`}>
    {icon && <span className="ico">{icon}</span>}
    <div style={{ flex: 1 }}>{children}</div>
    {action}
  </div>
);

export const Empty = ({ title, children }) => (
  <div className="empty"><b>{title}</b>{children}</div>
);

export const Meter = ({ value, max, over }) => (
  <div className={`meter ${over ? 'over' : ''}`}>
    <i style={{ width: `${max > 0 ? Math.min(100, (value / max) * 100) : 0}%` }} />
  </div>
);

export const Stat = ({ n, label, tone }) => (
  <div className="stat">
    <div className="n" style={tone ? { color: `var(--${tone})` } : undefined}>{n}</div>
    <div className="l">{label}</div>
  </div>
);

export const Loading = () => (
  <div className="empty"><span className="spinner" /><div style={{ marginTop: 10 }}>Loading</div></div>
);

export const ErrorNote = ({ error, onRetry }) => (
  <Banner kind="bad" icon="!"
    action={onRetry && <button className="btn sm" onClick={onRetry}>Try again</button>}>
    {error?.message || 'Something went wrong'}
  </Banner>
);

/* ---------------------------------------------------------- modal */
export function Modal({ title, sub, wide, full, onClose, footer, actions, children }) {
  useEffect(() => {
    const esc = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose]);
  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? 'wide' : ''} ${full ? 'full' : ''}`}
        role="dialog" aria-modal="true" aria-label={title}>
        <header>
          <div><h3>{title}</h3>{sub && <p>{sub}</p>}</div>
          <div className="sp" />
          {actions}
          <button className="btn sm" onClick={onClose} aria-label="Close">✕</button>
        </header>
        <div className="body">{children}</div>
        {footer && <footer>{footer}</footer>}
      </div>
    </div>
  );
}

/* ----------------------------------------------------- item picker
   2,600 items will not fit in a dropdown, so this searches the server
   as you type. Words match in any order, so "wire red 1.5" finds
   1.5 SQMM WIRE RED (FR). */
export function ItemPicker({ value, onPick, placeholder = 'Search the item master', autoFocus }) {
  const [q, setQ] = useState(value?.name || '');
  const [hits, setHits] = useState([]);
  const [open, setOpen] = useState(false);
  const [cur, setCur] = useState(0);
  const box = useRef(null);

  useEffect(() => { setQ(value?.name || ''); }, [value?.id, value?.name]);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2 || term === value?.name) { setHits([]); return undefined; }
    const t = setTimeout(() => {
      api.get(`/items/search?q=${encodeURIComponent(term)}`)
        .then((r) => { setHits(r); setCur(0); setOpen(true); })
        .catch(() => setHits([]));
    }, 180);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  useEffect(() => {
    const away = (e) => { if (box.current && !box.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, []);

  const choose = (it) => { onPick(it); setQ(it.name); setOpen(false); };

  return (
    <div className="pick" ref={box}>
      <input
        className="inp" value={q} placeholder={placeholder} autoFocus={autoFocus}
        onChange={(e) => setQ(e.target.value)}
        onFocus={() => { if (hits.length) setOpen(true); }}
        onKeyDown={(e) => {
          if (!open || !hits.length) return;
          if (e.key === 'ArrowDown') { e.preventDefault(); setCur((c) => Math.min(c + 1, hits.length - 1)); }
          if (e.key === 'ArrowUp') { e.preventDefault(); setCur((c) => Math.max(c - 1, 0)); }
          if (e.key === 'Enter') { e.preventDefault(); choose(hits[cur]); }
          if (e.key === 'Escape') setOpen(false);
        }}
      />
      {open && (
        <div className="res">
          {hits.length ? hits.map((it, i) => (
            <button key={it.id} type="button" className={i === cur ? 'cur' : ''}
              onMouseEnter={() => setCur(i)} onClick={() => choose(it)}>
              <b>{it.code}</b>{it.name}
              <small>
                {it.category.name} · {it.uom}
                {it.makes.length ? ` · ${it.makes.slice(0, 3).join(', ')}` : ''}
              </small>
            </button>
          )) : (
            <button type="button" disabled style={{ color: 'var(--muted)' }}>
              <b>No match</b><small>Try fewer words, or part of the code</small>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
