import { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { api, longDate, relDays } from '../api';
import { Icon } from './icons';
import { iconForTone } from '../vocab';

/* --------------------------------------------------------- toasts */
const ToastCtx = createContext(() => {});
export const useToast = () => useContext(ToastCtx);

const TOAST_ICON = { ok: 'check', bad: 'alert', '': 'info' };

export function ToastHost({ children }) {
  const [items, setItems] = useState([]);
  const push = useCallback((text, kind = '') => {
    const id = Math.random().toString(36).slice(2);
    setItems((x) => [...x, { id, text, kind }]);
    setTimeout(() => setItems((x) => x.filter((i) => i.id !== id)), 5200);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`}>
            <Icon name={TOAST_ICON[t.kind] || 'info'} />
            <span>{t.text}</span>
          </div>
        ))}
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
  <section className={`card ${className}`}>
    {(title || actions) && (
      <header>
        {title && <div><h3>{title}</h3>{sub && <p>{sub}</p>}</div>}
        <div className="sp" />
        {actions}
      </header>
    )}
    {children}
  </section>
);

export const Field = ({ label, hint, children, bad }) => (
  <div className="field">
    {label && <label>{label}</label>}
    {children}
    {hint && <div className={`hint ${bad ? 'bad' : ''}`}>{hint}</div>}
  </div>
);

/**
 * A date input that also says the date in words.
 *
 * The browser draws a date input in its own locale — 07/10/2026 is
 * July on one machine and October on the next — so the line under it
 * spells out the day, month and year, and how far away it is.
 */
export function DateField({ label, value, onChange, hint, min, max, disabled, id }) {
  return (
    <div className="field">
      {label && <label htmlFor={id}>{label}</label>}
      <input id={id} className="inp" type="date" value={value || ''} min={min} max={max}
        disabled={disabled} onChange={onChange} />
      {value
        ? <div className="date-said"><Icon name="calendar" size={13} />{longDate(value)} · {relDays(value)}</div>
        : hint && <div className="hint">{hint}</div>}
    </div>
  );
}

/** A small label on a row. New screens use <Status>; this keeps the old ones working. */
export const Tag = ({ kind = '', children, title }) => (
  <span className={`tag ${kind}`} title={title}>{children}</span>
);

/**
 * A status badge: tone, icon and word, never colour alone.
 * Pass a status from vocab.js (`is={prnStage(r.stage)}`), or tone and
 * label directly. The hint becomes the tooltip and the accessible name.
 */
export function Status({ is, tone, label, icon, hint, lg, sub }) {
  const t = is?.tone || tone || 'neutral';
  const word = is?.label || label;
  const why = is?.hint || hint;
  return (
    <span className={`status ${t} ${lg ? 'lg' : ''}`} title={why || undefined}>
      <Icon name={is?.icon || icon || iconForTone(t)} />
      <span>{word}</span>
      {sub && <span className="vh">{sub}</span>}
    </span>
  );
}

/** A document number or item code: monospaced, never wrapped. */
export const Code = ({ children, as: As = 'span', ...rest }) => <As className="code" {...rest}>{children}</As>;

const BANNER_ICON = { info: 'info', ok: 'check', warn: 'alert', bad: 'alert' };
/**
 * A message across the page. `icon` may name an icon; the old
 * single-character glyphs are ignored in favour of the kind's icon.
 */
export const Banner = ({ kind = 'info', icon, children, action }) => {
  const name = typeof icon === 'string' && icon.length > 2 ? icon : BANNER_ICON[kind] || 'info';
  return (
    <div className={`banner ${kind}`} role={kind === 'bad' ? 'alert' : undefined}>
      <Icon name={name} />
      <div style={{ flex: 1 }}>{children}</div>
      {action}
    </div>
  );
};

/**
 * Who has it now, and what happens next — the first thing on a
 * document's page, so nobody has to read a history table to find out.
 */
export function NextStep({ tone = 'neutral', icon, now, then, quote, actions }) {
  return (
    <div className={`next ${tone}`} role="status">
      <Icon name={icon || iconForTone(tone)} size={18} />
      <div className="body">
        <div className="now">{now}</div>
        {quote && <div className="quote">“{quote}”</div>}
        {then && <div className="then">{then}</div>}
      </div>
      {actions && <div className="acts">{actions}</div>}
    </div>
  );
}

/** The top of a document's page: what kind, its number, its status. */
export function DocHead({ kind, docNo, status, meta = [], actions, back }) {
  return (
    <div className="doc-head">
      <div>
        <div className="kind">
          {back}
          {kind}
        </div>
        <h1>{docNo}{status}</h1>
        {meta.length > 0 && (
          <div className="meta">
            {meta.filter(Boolean).map((m, i) => <span key={i}>{m}</span>)}
          </div>
        )}
      </div>
      <div className="sp" />
      {actions && <div className="acts">{actions}</div>}
    </div>
  );
}

/**
 * An empty list that says why it is empty and what to do: first use,
 * a filter, or a scope that leaves things out.
 */
export const Empty = ({ title, children, icon, action }) => (
  <div className="empty">
    {icon && <Icon name={icon} size={22} />}
    <b>{title}</b>
    {children && <p>{children}</p>}
    {action && <div className="acts">{action}</div>}
  </div>
);

export const Meter = ({ value, max, over, label }) => (
  <div className={`meter ${over ? 'over' : ''}`} role="meter" aria-valuemin={0}
    aria-valuemax={max || 0} aria-valuenow={value || 0} aria-label={label}>
    <i style={{ width: `${max > 0 ? Math.min(100, (value / max) * 100) : 0}%` }} />
  </div>
);

/** A figure and what it is. Tone colours the figure only when it means something. */
/** A headline number. `one` is the label when the number is exactly 1 ("1 delivery", not "1 deliveries"). */
export const Stat = ({ n, label, one, tone }) => (
  <div className="stat">
    <div className="n" style={tone ? { color: `var(--${tone === 'brand' ? 'brand-ink' : tone})` } : undefined}>{n}</div>
    <div className="l">{one && Number(n) === 1 ? one : label}</div>
  </div>
);

export const Loading = ({ what }) => (
  <div className="empty" aria-busy="true">
    <span className="spinner" />
    <div style={{ marginTop: 10 }}>{what ? `Loading ${what}…` : 'Loading…'}</div>
  </div>
);

export const ErrorNote = ({ error, onRetry }) => (
  <Banner kind="bad"
    action={onRetry && <button className="btn sm" onClick={onRetry}>Try again</button>}>
    {error?.message || 'Something went wrong, and the server did not say what.'}
  </Banner>
);

/* ---------------------------------------------------------- modal */
export function Modal({ title, sub, wide, full, onClose, footer, actions, children }) {
  const box = useRef(null);
  useEffect(() => {
    const esc = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', esc);
    // focus moves into the dialog and comes back where it was
    const before = document.activeElement;
    const first = box.current?.querySelector('input, select, textarea, button:not([aria-label="Close"])');
    first?.focus();
    return () => { window.removeEventListener('keydown', esc); before?.focus?.(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={box} className={`modal ${wide ? 'wide' : ''} ${full ? 'full' : ''}`}
        role="dialog" aria-modal="true" aria-label={title}>
        <header>
          <div><h3>{title}</h3>{sub && <p>{sub}</p>}</div>
          <div className="sp" />
          {actions}
          <button className="btn sm ghost" onClick={onClose} aria-label="Close"><Icon name="x" /></button>
        </header>
        <div className="body">{children}</div>
        {footer && <footer>{footer}</footer>}
      </div>
    </div>
  );
}

/**
 * Asking before a decision, the same way everywhere.
 *
 * Replaces window.confirm and window.prompt, which looked like the
 * browser talking rather than the app and could not say what would
 * happen. `ask()` resolves to the note typed (or '' when none was
 * asked for), or null when the person backs out.
 */
const DialogCtx = createContext(null);
export const useDialog = () => useContext(DialogCtx);

export function DialogHost({ children }) {
  const [open, setOpen] = useState(null);
  const ask = useCallback((opts) => new Promise((resolve) => setOpen({ ...opts, resolve })), []);
  const close = (v) => { open?.resolve(v); setOpen(null); };
  return (
    <DialogCtx.Provider value={ask}>
      {children}
      {open && <AskDialog {...open} onDone={close} />}
    </DialogCtx.Provider>
  );
}

function AskDialog({ title, consequence, confirm = 'Confirm', cancel = 'Go back', tone,
  note, noteLabel = 'Reason', noteHint, noteRequired, onDone }) {
  const [text, setText] = useState('');
  const ready = !note || !noteRequired || text.trim();
  return (
    <Modal title={title} onClose={() => onDone(null)}
      footer={(
        <>
          <button className="btn" onClick={() => onDone(null)}>{cancel}</button>
          <button className={`btn ${tone === 'bad' ? 'bad' : 'pri'}`} disabled={!ready}
            onClick={() => onDone(note ? text.trim() : '')}>{confirm}</button>
        </>
      )}>
      {consequence && <p className="consequence">{consequence}</p>}
      {note && (
        <Field label={noteLabel} hint={noteHint || (noteRequired ? 'Required' : 'Optional')}>
          <textarea className="inp" rows={3} value={text} onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && ready) onDone(text.trim()); }} />
        </Field>
      )}
    </Modal>
  );
}

/* ----------------------------------------------------- item picker
   2,600 items will not fit in a dropdown, so this searches the server
   as you type. Words match in any order, so "wire red 1.5" finds
   1.5 SQMM WIRE RED (FR). */
export function ItemPicker({ value, onPick, placeholder = 'Search items by name or code…', autoFocus }) {
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
        role="combobox" aria-expanded={open} aria-autocomplete="list" autoComplete="off" spellCheck={false}
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
        <div className="res" role="listbox">
          {hits.length ? hits.map((it, i) => (
            <button key={it.id} type="button" role="option" aria-selected={i === cur} className={i === cur ? 'cur' : ''}
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

/* ------------------------------------------------------ client picker
   A client has to exist before a site can belong to one, and the only
   moment anybody discovers a client is missing is the moment they are
   halfway through creating the site. Sending them off to a master
   screen to add it loses everything they have typed, so the list adds
   to itself: choose "Add a client", fill in three fields, and it is
   chosen when the dialog closes.

   The duplicate guard is the API's — "Already on the list as X" comes
   back with the existing client's id, and rather than make the user
   read an error and go looking, that client is simply selected. */
export function ClientPicker({
  value, onChange, branchId, width = 260, autoFocus,
}) {
  const [adding, setAdding] = useState(false);
  const { data, reload } = useApi(branchId ? `/masters/clients?branchId=${branchId}` : null,
    [branchId]);
  // the whole list too, only to explain an empty dropdown. A client
  // filed under the other branch is the commonest reason one cannot be
  // found, and saying so beats leaving somebody hunting.
  const { data: all } = useApi('/masters/clients');
  const clients = data || [];
  const elsewhere = (all || []).length - clients.length;

  return (
    <>
      <div style={{ display: 'flex', gap: 6 }}>
        <select className="inp" style={{ width }} value={value || ''} autoFocus={autoFocus}
          onChange={(e) => {
            if (e.target.value === '__new') { setAdding(true); return; }
            onChange(e.target.value);
          }}>
          <option value="">Choose the client…</option>
          {clients.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}{c.gstin ? ` · ${c.gstin}` : ''}
            </option>
          ))}
          <option disabled>──────────</option>
          <option value="__new">+ Add a client</option>
        </select>
        <button type="button" className="btn" aria-label="Add a client"
          onClick={() => setAdding(true)}><Icon name="plus" /></button>
      </div>
      {elsewhere > 0 && (
        <div className="hint" style={{ marginTop: 5 }}>
          {elsewhere} more client{elsewhere === 1 ? '' : 's'} in other branches — a site can only
          be given a client of its own branch.{' '}
          <Link to="/clients" style={{ color: 'var(--brand-ink)', textDecoration: 'underline' }}>See all clients</Link>
        </div>
      )}
      {adding && (
        <NewClient branchId={branchId}
          onClose={() => setAdding(false)}
          onSaved={(id) => { reload(); onChange(String(id)); setAdding(false); }} />
      )}
    </>
  );
}

/**
 * Adding a client without leaving the site form.
 *
 * There is no branch on this dialog on purpose. It is opened halfway
 * through creating a site in a particular branch, and a client saved
 * against any other branch would vanish from the dropdown the instant
 * it was created — the list is filtered to this branch, because a site
 * may only be given a client of its own. The branch can still be
 * changed later, on the Clients screen, while the client has no sites.
 */
function NewClient({ branchId, onClose, onSaved }) {
  const toast = useToast();
  const [f, setF] = useState({
    name: '', gstin: '', address: '', contactName: '', contactPhone: '',
  });
  const [saving, setSaving] = useState(false);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));

  // 15 characters, and nothing else is worth checking here — the
  // client's own paperwork is the authority on their GSTIN
  const gstinBad = f.gstin.trim().length > 0 && f.gstin.trim().length !== 15;
  const ready = f.name.trim().length >= 2 && branchId && !gstinBad && !saving;

  const save = async () => {
    setSaving(true);
    try {
      const r = await api.post('/masters/clients', {
        name: f.name.trim(),
        branchId: Number(branchId),
        gstin: f.gstin.trim() || undefined,
        address: f.address.trim() || undefined,
        contactName: f.contactName.trim() || undefined,
        contactPhone: f.contactPhone.trim() || undefined,
      });
      toast(`${r.name} added`, 'ok');
      onSaved(r.id);
    } catch (e) {
      // already on the list: pick that one rather than make them read
      // an error and go hunting for it
      if (e.status === 409 && e.detail?.clientId) {
        toast(e.message, '');
        onSaved(e.detail.clientId);
        return;
      }
      toast(e.message, 'bad');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title="Add a client"
      sub="Only the name is needed now — the rest can follow"
      onClose={onClose}
      footer={
        <button className="btn pri" disabled={!ready} onClick={save}>
          {saving ? 'Adding…' : 'Add and choose'}
        </button>
      }>
      <Field label="Client name">
        <input className="inp" value={f.name} autoFocus placeholder="e.g. GMR Hyderabad Airport"
          onChange={set('name')}
          onKeyDown={(e) => { if (e.key === 'Enter' && ready) save(); }} />
      </Field>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <Field label="GSTIN" hint={gstinBad ? 'A GSTIN is 15 characters' : 'Optional'} bad={gstinBad}>
          <input className="inp code" style={{ width: 220 }} value={f.gstin} spellCheck={false}
            placeholder="36AABCP1234M1Z5" maxLength={15}
            onChange={(e) => setF((x) => ({ ...x, gstin: e.target.value.toUpperCase() }))} />
        </Field>
      </div>
      <Field label="Address" hint="Optional">
        <input className="inp" value={f.address} onChange={set('address')} />
      </Field>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <Field label="Contact person" hint="Optional">
          <input className="inp" style={{ width: 220 }} value={f.contactName}
            onChange={set('contactName')} />
        </Field>
        <Field label="Contact phone" hint="Optional">
          <input className="inp" type="tel" inputMode="tel" style={{ width: 180 }} value={f.contactPhone}
            onChange={set('contactPhone')} />
        </Field>
      </div>
    </Modal>
  );
}
