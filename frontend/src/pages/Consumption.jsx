import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { PageHead } from '../App';
import { api, qty, dmy, today } from '../api';
import {
  useApi, useToast, Card, Empty, Loading, ErrorNote, Banner, Field, Modal, Stat,
} from '../components/ui';
import { useSite } from './SiteStore';

/**
 * Issuing material, and taking it back.
 *
 * Everything before this screen moves material between places that
 * are answerable for it. This moves it into a person's hands, which
 * is the point at which it stops being stock and becomes cost.
 *
 * Neither screen shows a rate or a value. The cost is real and it is
 * recorded — every line is stamped with what the central store was
 * holding the item at that day, and one report answers for the lot —
 * but it is not shown here. A storekeeper handing over a coil of wire
 * and a man signing for it have no opinion about its price and no
 * business forming one; what they are asked is the only thing they
 * know, which is what moved and how much of it.
 *
 * And a return answers to a person, not to a document. Nobody
 * remembers which slip material left on days later — but the system
 * recorded exactly who every item went to, so on the way back nothing
 * is typed at all. The name is chosen from the people actually
 * holding something, and the items from what that person took and has
 * not brought back. A name that is not on the list has nothing to
 * return, and no amount of typing should conjure one.
 *
 * Nothing here calls that a balance outstanding. Material issued and
 * not returned has been used — that is what issuing it means. The
 * quantity is still needed, because it caps what may come back, but
 * it is a cap on a return and not a debt somebody is carrying, and
 * every screen says "consumed" rather than "still out".
 *
 * The person is typed, not picked. There is no site login yet and the
 * people drawing material are often not system users at all. The only
 * defence against the same man becoming three people in the audit is
 * to show whoever is typing the names this site has already used, so
 * the second issue to Ramesh is a click rather than a fresh spelling.
 */

const num = (v) => (v === '' || v === null ? 0 : Number(v) || 0);

/* ===================================================================
   Who it went to. A text box that remembers.
   =================================================================== */
function PersonInput({ siteId, value, onChange, label, autoFocus }) {
  const [open, setOpen] = useState(false);
  const box = useRef(null);
  const { data } = useApi(siteId ? `/consumption/people/${siteId}` : null, [siteId]);
  const known = data?.rows || [];
  const hits = value.trim()
    ? known.filter((p) => p.name.toLowerCase().includes(value.trim().toLowerCase()))
    : known;

  useEffect(() => {
    const away = (e) => { if (box.current && !box.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, []);

  const exact = known.some((p) => p.name.toLowerCase() === value.trim().toLowerCase());

  return (
    <Field label={label}
      hint={value.trim() && !exact && known.length
        ? 'A new name for this site — check the spelling against the list'
        : undefined}>
      <div className="pick" ref={box}>
        <input className="inp" style={{ width: 260 }} value={value} autoFocus={autoFocus}
          placeholder="Type a name"
          onChange={(e) => { onChange(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => e.key === 'Escape' && setOpen(false)} />
        {open && hits.length > 0 && (
          <div className="res">
            {hits.slice(0, 8).map((p) => (
              <button key={p.name} type="button"
                onClick={() => { onChange(p.name); setOpen(false); }}>
                <b>{p.name}</b>
                <small>
                  {p.issues} issue{p.issues === 1 ? '' : 's'} · last {dmy(p.last_on)}
                </small>
              </button>
            ))}
          </div>
        )}
      </div>
    </Field>
  );
}

/* ===================================================================
   Who is giving it back. Chosen, never typed.

   The system recorded who every item went to, so asking somebody to
   type that name again is asking them to get it wrong. This lists the
   people who are actually holding something at this site — if a name
   is not here, that person has nothing to return, and no amount of
   typing should make one appear.
   =================================================================== */
function PersonPicker({ siteId, value, onChange, label }) {
  const { data, loading } = useApi(
    siteId ? `/consumption/people/${siteId}?outstanding=true` : null, [siteId]);
  const people = data?.rows || [];
  const gone = value && !people.some((p) => p.name === value);

  return (
    <Field label={label}
      hint={gone ? 'That person has nothing left to return' : undefined}>
      <select className="inp" style={{ width: 300 }} value={value}
        disabled={!siteId || loading || !people.length}
        onChange={(e) => onChange(e.target.value)}>
        <option value="">
          {loading ? 'Loading…'
            : people.length ? 'Who is returning it'
              : 'Nobody at this site is holding anything'}
        </option>
        {gone && <option value={value}>{value}</option>}
        {people.map((p) => (
          <option key={p.name} value={p.name}>
            {p.name} — {qty(p.open_qty)} units across {p.returnable_items} item
            {p.returnable_items === 1 ? '' : 's'}
          </option>
        ))}
      </select>
    </Field>
  );
}

/* ===================================================================
   Picking off a shelf, rather than out of the item master.
   =================================================================== */
function ShelfPicker({ path, deps, exclude, onPick, placeholder, empty }) {
  const [q, setQ] = useState('');
  const [hits, setHits] = useState([]);
  const [open, setOpen] = useState(false);
  const [cur, setCur] = useState(0);
  const box = useRef(null);

  useEffect(() => {
    if (!path) { setHits([]); return undefined; }
    const t = setTimeout(() => {
      api.get(`${path}${path.includes('?') ? '&' : '?'}q=${encodeURIComponent(q.trim())}`)
        .then((r) => { setHits(r.rows || []); setCur(0); })
        .catch(() => setHits([]));
    }, 160);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, path, ...(deps || [])]);

  useEffect(() => {
    const away = (e) => { if (box.current && !box.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, []);

  const free = hits.filter((h) => !exclude.includes(h.item_id));
  const take = (it) => { onPick(it); setQ(''); setOpen(false); };

  return (
    <div className="pick" ref={box}>
      <input className="inp" value={q} placeholder={placeholder}
        onChange={(e) => { setQ(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (!open || !free.length) return;
          if (e.key === 'ArrowDown') { e.preventDefault(); setCur((c) => Math.min(c + 1, free.length - 1)); }
          if (e.key === 'ArrowUp') { e.preventDefault(); setCur((c) => Math.max(c - 1, 0)); }
          if (e.key === 'Enter') { e.preventDefault(); take(free[cur]); }
          if (e.key === 'Escape') setOpen(false);
        }} />
      {open && (
        <div className="res">
          {free.length ? free.slice(0, 40).map((it, i) => (
            <button key={it.item_id} type="button" className={i === cur ? 'cur' : ''}
              onMouseEnter={() => setCur(i)} onClick={() => take(it)}>
              <b>{it.item_code}</b>{it.item_name}
              <small>{qty(it.on_hand ?? it.open_qty)} {it.uom} available</small>
            </button>
          )) : (
            <button type="button" disabled style={{ color: 'var(--muted)' }}>
              <b>{q.trim() ? 'Nothing here matches that' : (empty?.title || 'Nothing available')}</b>
              <small>
                {q.trim() ? 'Try part of the code, or fewer words'
                  : (empty?.hint || 'Only what this site actually holds can be issued')}
              </small>
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/* ===================================================================
   The basket, shared by both documents.
   =================================================================== */
function Basket({ rows, setRows, capKey, capLabel }) {
  const set = (id, patch) =>
    setRows((xs) => xs.map((r) => (r.item_id === id ? { ...r, ...patch } : r)));
  const drop = (id) => setRows((xs) => xs.filter((r) => r.item_id !== id));

  return (
    <div className="tw">
      <table>
        <thead>
          <tr>
            <th>Code</th><th>Item</th><th style={{ width: 52 }}>Unit</th>
            <th className="rt" style={{ width: 110 }}>{capLabel}</th>
            <th className="rt" style={{ width: 130 }}>Quantity</th>
            <th>Remark</th>
            <th style={{ width: 40 }} />
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const cap = Number(r[capKey]);
            const over = num(r.qty) > cap + 0.0005;
            return (
              <tr key={r.item_id}>
                <td className="mono" style={{ color: 'var(--brand-ink)' }}>{r.item_code}</td>
                <td><b>{r.item_name}</b></td>
                <td>{r.uom}</td>
                <td className="rt mono">{qty(cap)}</td>
                <td>
                  <input className="inp rt mono" type="number" min="0" step="0.001"
                    value={r.qty}
                    style={over ? { borderColor: 'var(--bad)', color: 'var(--bad)' } : undefined}
                    onChange={(e) => set(r.item_id, { qty: e.target.value })} />
                </td>
                <td>
                  <input className="inp" value={r.remark || ''} placeholder="Optional"
                    onChange={(e) => set(r.item_id, { remark: e.target.value })} />
                </td>
                <td>
                  <button className="btn sm" onClick={() => drop(r.item_id)}
                    aria-label={`Remove ${r.item_name}`}>✕</button>
                </td>
              </tr>
            );
          })}
          {!rows.length && (
            <tr><td colSpan={7}>
              <Empty title="Nothing on this document yet">
                Search above and pick the items.
              </Empty>
            </td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

/** Everything the user typed wrong, said once, before they press the button. */
function problems(rows, capKey, capWord) {
  const out = [];
  if (!rows.length) out.push('Add at least one item.');
  for (const r of rows) {
    const q = num(r.qty);
    const cap = Number(r[capKey]);
    if (q <= 0) out.push(`${r.item_code} — put a quantity against it.`);
    else if (q > cap + 0.0005) {
      out.push(`${r.item_code} — only ${qty(cap)} ${r.uom} ${capWord}.`);
    }
  }
  return out;
}

/* ===================================================================
   ISSUE
   =================================================================== */
export function IssueStock() {
  const { siteId } = useSite();
  const toast = useToast();
  const [head, setHead] = useState({ usedOn: today(), issuedTo: '', purpose: '', note: '' });
  const [rows, setRows] = useState([]);
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(null);
  const [tick, setTick] = useState(0);

  const recent = useApi(
    siteId ? `/consumption/issues?siteId=${siteId}&limit=25` : null, [siteId, tick]);
  // what this site is actually holding, and what is on its way — an
  // empty shelf is the commonest reason this screen looks broken, and
  // the reason is always somewhere else
  const shelf = useApi(siteId ? `/consumption/issuable/${siteId}` : null, [siteId, tick]);
  const inbox = useApi(siteId ? `/site-store/${siteId}/inbox` : null, [siteId, tick]);
  const empty = !shelf.loading && (shelf.data?.rows || []).length === 0;
  const toSign = (inbox.data?.challans || []).length + (inbox.data?.orders || []).length;

  useEffect(() => { setRows([]); setDone(null); }, [siteId]);

  const bad = problems(rows, 'on_hand', 'on this site');
  const units = rows.reduce((t, r) => t + num(r.qty), 0);
  const ready = siteId && head.issuedTo.trim() && rows.length && !bad.length && !saving;

  const submit = async () => {
    setSaving(true);
    try {
      const r = await api.post('/consumption/issues', {
        siteId: Number(siteId),
        usedOn: head.usedOn,
        issuedTo: head.issuedTo.trim(),
        purpose: head.purpose.trim() || undefined,
        note: head.note.trim() || undefined,
        lines: rows.map((x) => ({
          itemId: x.item_id, qty: num(x.qty), remark: x.remark?.trim() || undefined,
        })),
      });
      toast(`${r.docNo} — ${qty(r.issuedQty)} units issued to ${head.issuedTo.trim()}`, 'ok');
      setDone(r);
      setRows([]);
      setHead((h) => ({ ...h, issuedTo: '', purpose: '', note: '' }));
      setTick((t) => t + 1);
    } catch (e) {
      toast(e.message, 'bad');
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <PageHead title="Issue for consumption"
        sub="Material leaving the site store in someone's hands"
        actions={<div style={{ display: 'flex', gap: 9 }}>
          <Link className="btn" to={`/site/returns?site=${siteId}`}>Record a return</Link>
          <Link className="btn" to={`/site/stock?site=${siteId}`}>Site store</Link>
        </div>} />

      <div className="page-body">
        <Card>
          <div className="pad" style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <Field label="Issued on">
              <input className="inp" type="date" style={{ width: 160 }} value={head.usedOn}
                max={today()}
                onChange={(e) => setHead((h) => ({ ...h, usedOn: e.target.value }))} />
            </Field>
            <PersonInput siteId={siteId} label="Issued to" value={head.issuedTo}
              onChange={(v) => setHead((h) => ({ ...h, issuedTo: v }))} />
            <Field label="What for">
              <input className="inp" style={{ width: 280 }} value={head.purpose}
                placeholder="Block A first floor, optional"
                onChange={(e) => setHead((h) => ({ ...h, purpose: e.target.value }))} />
            </Field>
          </div>
        </Card>

        {done && (
          <Banner kind="ok" icon="✓"
            action={<Link className="btn sm" to={`/site/transactions?site=${siteId}`}>
              See it on the ledger
            </Link>}>
            <b>{done.docNo}</b> issued — {qty(done.issuedQty)} units.
            They are off the shelf and counted as consumed.
          </Banner>
        )}

        {empty && (
          <Banner kind="warn" icon="◍"
            action={toSign > 0
              ? <Link className="btn sm pri" to={`/site/inbox?site=${siteId}`}>Sign for them</Link>
              : <Link className="btn sm" to="/indents">See where it is</Link>}>
            <b>This site is holding nothing yet.</b>{' '}
            {toSign > 0
              ? `${toSign} delivery${toSign === 1 ? '' : 'ies'} ${toSign === 1 ? 'is' : 'are'} `
                + 'waiting to be signed for — material only reaches the shelf once the site '
                + 'has acknowledged it.'
              : 'Material reaches this shelf when the site signs for a delivery. Anything '
                + 'the store has received against your PRN still has to be sent out on a '
                + 'challan and signed for here.'}
          </Banner>
        )}

        <Card title="What is going out"
          sub="Only what this site is actually holding can be issued">
          <div className="pad" style={{ paddingBottom: 0 }}>
            <Field label="Add an item">
              <ShelfPicker
                path={siteId ? `/consumption/issuable/${siteId}` : null}
                deps={[siteId]}
                exclude={rows.map((r) => r.item_id)}
                placeholder="Search this site's shelf by name or code"
                onPick={(it) => setRows((xs) => [...xs, { ...it, qty: '', remark: '' }])} />
            </Field>
          </div>
          <Basket rows={rows} setRows={setRows} capKey="on_hand" capLabel="On site" />
        </Card>

        {bad.length > 0 && rows.length > 0 && (
          <Banner kind="bad" icon="!">
            {bad.slice(0, 4).map((m) => <div key={m}>{m}</div>)}
            {bad.length > 4 && <div>…and {bad.length - 4} more.</div>}
          </Banner>
        )}

        <Card>
          <div className="pad" style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <div>
              <div style={{ fontSize: 22, fontWeight: 700 }}>
                {qty(units)} <span style={{ fontSize: 14, fontWeight: 500 }}>units</span>
              </div>
              <div style={{ color: 'var(--muted)', fontSize: 12 }}>
                across {rows.length} line{rows.length === 1 ? '' : 's'} · off the shelf the
                moment you issue, and counted as consumed from {dmy(head.usedOn)}
              </div>
            </div>
            <div className="sp" />
            <button className="btn pri" disabled={!ready} onClick={submit}>
              {saving ? 'Issuing…' : 'Issue'}
            </button>
          </div>
        </Card>

        <RecentIssues state={recent} siteId={siteId} />
      </div>
    </>
  );
}

function RecentIssues({ state, siteId }) {
  const [open, setOpen] = useState(null);
  const { data, error, loading, reload } = state;
  if (error) return <ErrorNote error={error} onRetry={reload} />;
  if (loading || !data) return <Loading />;
  const rows = data.rows;

  return (
    <>
      <Card title="Issued lately" sub="The last 25 from this site"
        actions={<Link className="btn sm" to={`/site/transactions?site=${siteId}`}>
          All transactions
        </Link>}>
        <div className="tw">
          <table>
            <thead>
              <tr>
                <th>Document</th><th>Date</th><th>Issued to</th><th>What for</th>
                <th className="rt">Lines</th><th className="rt">Quantity</th>
                <th>Recorded by</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.consumption_id} style={{ cursor: 'pointer' }}
                  onClick={() => setOpen(r.consumption_id)}>
                  <td className="mono" style={{ color: 'var(--brand-ink)' }}>{r.doc_no}</td>
                  <td>{dmy(r.used_on)}</td>
                  <td><b>{r.issued_to}</b></td>
                  <td style={{ color: 'var(--muted)' }}>{r.purpose || '—'}</td>
                  <td className="rt mono">{r.line_count}</td>
                  <td className="rt mono"><b>{qty(r.issued_qty)}</b></td>
                  <td style={{ color: 'var(--muted)' }}>{r.recorded_by_name || '—'}</td>
                </tr>
              ))}
              {!rows.length && (
                <tr><td colSpan={7}>
                  <Empty title="Nothing issued from this site yet">
                    Material sits on the shelf until somebody takes it.
                  </Empty>
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
      {open && <IssueCard id={open} onClose={() => setOpen(null)} />}
    </>
  );
}

export function IssueCard({ id, onClose }) {
  const { data, loading } = useApi(`/consumption/issues/${id}`, [id]);
  if (loading || !data) return <Modal title="Issue" onClose={onClose}><Loading /></Modal>;
  const { head, lines, withThem } = data;

  return (
    <Modal wide title={head.doc_no}
      sub={`${head.site_name} · issued to ${head.issued_to} on ${dmy(head.used_on)}`}
      onClose={onClose}>
      <div className="stats">
        <Stat n={qty(head.issued_qty)} label="units issued" />
        <Stat n={head.line_count} label="items" />
        <Stat n={dmy(head.used_on)} label="issued on" />
      </div>
      {head.purpose && <Banner kind="info" icon="▸">{head.purpose}</Banner>}
      <div className="tw">
        <table>
          <thead>
            <tr>
              <th>Code</th><th>Item</th><th style={{ width: 52 }}>Unit</th>
              <th className="rt">Quantity</th><th>Remark</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.line_id}>
                <td className="mono" style={{ color: 'var(--brand-ink)' }}>{l.item_code}</td>
                <td><b>{l.item_name}</b></td>
                <td>{l.uom}</td>
                <td className="rt mono"><b>{qty(l.qty)}</b></td>
                <td style={{ color: 'var(--muted)' }}>{l.remark || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {withThem.length > 0 && (
        <Card title={`Consumed by ${head.issued_to}`}
          sub="Across every issue to them at this site, not just this one — issued less returned">
          <div className="tw">
            <table>
              <thead>
                <tr><th>Code</th><th>Item</th><th style={{ width: 52 }}>Unit</th>
                  <th className="rt">Consumed</th></tr>
              </thead>
              <tbody>
                {withThem.map((r) => (
                  <tr key={r.item_code}>
                    <td className="mono" style={{ color: 'var(--brand-ink)' }}>{r.item_code}</td>
                    <td>{r.item_name}</td>
                    <td>{r.uom}</td>
                    <td className="rt mono"><b>{qty(r.open_qty)}</b></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
      <p style={{ color: 'var(--muted)', fontSize: 12 }}>
        Recorded by {head.recorded_by_name || 'unknown'}. What this cost was fixed when it
        was issued, at what the central store was holding these items at on{' '}
        {dmy(head.used_on)}; it is on the expense report, not here.
      </p>
    </Modal>
  );
}

/* ===================================================================
   RETURN
   =================================================================== */
export function ReturnStock() {
  const { siteId } = useSite();
  const toast = useToast();
  const [head, setHead] = useState({ returnedOn: today(), returnedBy: '', reason: '' });
  const [rows, setRows] = useState([]);
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(null);
  const [tick, setTick] = useState(0);

  const recent = useApi(
    siteId ? `/consumption/returns?siteId=${siteId}&limit=25` : null, [siteId, tick]);

  const person = head.returnedBy.trim();
  useEffect(() => { setRows([]); setDone(null); }, [siteId]);
  // whose material this is decides what may come back, so changing it
  // empties a basket that was built against somebody else
  useEffect(() => { setRows([]); }, [person]);

  // nothing to offer until we know whose it is
  const listPath = siteId && person
    ? `/consumption/returnable/${siteId}?person=${encodeURIComponent(person)}`
    : null;

  const bad = problems(rows, 'open_qty', `can come back from ${person}`);
  const units = rows.reduce((t, r) => t + num(r.qty), 0);
  const ready = siteId && person && !bad.length && rows.length && !saving;

  const submit = async () => {
    setSaving(true);
    try {
      const r = await api.post('/consumption/returns', {
        siteId: Number(siteId),
        returnedOn: head.returnedOn,
        returnedBy: person,
        reason: head.reason.trim() || undefined,
        lines: rows.map((x) => ({
          itemId: x.item_id, qty: num(x.qty), remark: x.remark?.trim() || undefined,
        })),
      });
      toast(`${r.docNo} — ${qty(r.returnedQty)} units back on the shelf`, 'ok');
      setDone(r);
      setRows([]);
      setHead((h) => ({ ...h, returnedBy: '', reason: '' }));
      setTick((t) => t + 1);
    } catch (e) {
      toast(e.message, 'bad');
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <PageHead title="Return to the site store"
        sub="Material coming back unused"
        actions={<div style={{ display: 'flex', gap: 9 }}>
          <Link className="btn" to={`/site/issue?site=${siteId}`}>Issue material</Link>
          <Link className="btn" to={`/site/stock?site=${siteId}`}>Site store</Link>
        </div>} />

      <div className="page-body">
        <Card>
          <div className="pad" style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <Field label="Returned on">
              <input className="inp" type="date" style={{ width: 160 }} value={head.returnedOn}
                max={today()}
                onChange={(e) => setHead((h) => ({ ...h, returnedOn: e.target.value }))} />
            </Field>
            <PersonPicker siteId={siteId} label="Returned by" value={head.returnedBy}
              onChange={(v) => setHead((h) => ({ ...h, returnedBy: v }))} />
            <Field label="Why it came back">
              <input className="inp" style={{ width: 260 }} value={head.reason}
                placeholder="Over-drawn, optional"
                onChange={(e) => setHead((h) => ({ ...h, reason: e.target.value }))} />
            </Field>
          </div>
        </Card>

        {done && (
          <Banner kind="ok" icon="✓">
            <b>{done.docNo}</b> — {qty(done.returnedQty)} units are back on the shelf,
            and off this site&apos;s consumption.
          </Banner>
        )}

        <Card title="What is coming back"
          sub={person
            ? `What ${person} has taken and not returned`
            : 'Choose who is returning it first'}>
          <div className="pad" style={{ paddingBottom: 0 }}>
            <Field label="Add an item"
              hint={!listPath
                ? 'The list is whatever that person took and has not brought back'
                : undefined}>
              <ShelfPicker
                path={listPath}
                deps={[siteId, person]}
                exclude={rows.map((r) => r.item_id)}
                placeholder={listPath
                  ? 'Search by name or code'
                  : 'Choose who is returning it above'}
                empty={{
                  title: `${person} has nothing to return`,
                  hint: 'Everything issued to them has already come back.',
                }}
                onPick={(it) => setRows((xs) => [...xs, { ...it, qty: '', remark: '' }])} />
            </Field>
          </div>
          <Basket rows={rows} setRows={setRows} capKey="open_qty" capLabel="They have" />
        </Card>

        {bad.length > 0 && rows.length > 0 && (
          <Banner kind="bad" icon="!">
            {bad.slice(0, 4).map((m) => <div key={m}>{m}</div>)}
            {bad.length > 4 && <div>…and {bad.length - 4} more.</div>}
          </Banner>
        )}

        <Card>
          <div className="pad" style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <div>
              <div style={{ fontSize: 22, fontWeight: 700 }}>
                {qty(units)} <span style={{ fontSize: 14, fontWeight: 500 }}>units</span>
              </div>
              <div style={{ color: 'var(--muted)', fontSize: 12 }}>
                across {rows.length} item{rows.length === 1 ? '' : 's'} · back on the shelf,
                and off this site&apos;s consumption from {dmy(head.returnedOn)}
              </div>
            </div>
            <div className="sp" />
            <button className="btn pri" disabled={!ready} onClick={submit}>
              {saving ? 'Recording…' : 'Record the return'}
            </button>
          </div>
        </Card>

        <RecentReturns state={recent} />
      </div>
    </>
  );
}

function RecentReturns({ state }) {
  const [open, setOpen] = useState(null);
  const { data, error, loading, reload } = state;
  if (error) return <ErrorNote error={error} onRetry={reload} />;
  if (loading || !data) return <Loading />;
  const rows = data.rows;

  return (
    <>
      <Card title="Returned lately" sub="The last 25 to this site">
        <div className="tw">
          <table>
            <thead>
              <tr>
                <th>Document</th><th>Date</th><th>Returned by</th><th>Why</th>
                <th className="rt">Lines</th><th className="rt">Quantity</th>
                <th>Recorded by</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.return_id} style={{ cursor: 'pointer' }}
                  onClick={() => setOpen(r.return_id)}>
                  <td className="mono" style={{ color: 'var(--brand-ink)' }}>{r.doc_no}</td>
                  <td>{dmy(r.returned_on)}</td>
                  <td><b>{r.returned_by}</b></td>
                  <td style={{ color: 'var(--muted)' }}>{r.reason || '—'}</td>
                  <td className="rt mono">{r.line_count}</td>
                  <td className="rt mono"><b>{qty(r.returned_qty)}</b></td>
                  <td style={{ color: 'var(--muted)' }}>{r.recorded_by_name || '—'}</td>
                </tr>
              ))}
              {!rows.length && (
                <tr><td colSpan={7}>
                  <Empty title="Nothing has come back to this site">
                    A return puts material back on the shelf and takes its cost off the site.
                  </Empty>
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
      {open && <ReturnCard id={open} onClose={() => setOpen(null)} />}
    </>
  );
}

function ReturnCard({ id, onClose }) {
  const { data, loading } = useApi(`/consumption/returns/${id}`, [id]);
  if (loading || !data) return <Modal title="Return" onClose={onClose}><Loading /></Modal>;
  const { head, lines } = data;

  return (
    <Modal wide title={head.doc_no}
      sub={`${head.site_name} · returned by ${head.returned_by} on ${dmy(head.returned_on)}`}
      onClose={onClose}>
      <div className="stats">
        <Stat n={qty(head.returned_qty)} label="units back" />
        <Stat n={head.line_count} label="items" />
        <Stat n={dmy(head.returned_on)} label="returned on" />
      </div>
      {head.reason && <Banner kind="info" icon="▸">{head.reason}</Banner>}
      <div className="tw">
        <table>
          <thead>
            <tr>
              <th>Code</th><th>Item</th><th style={{ width: 52 }}>Unit</th>
              <th className="rt">Quantity</th><th>Remark</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.line_id}>
                <td className="mono" style={{ color: 'var(--brand-ink)' }}>{l.item_code}</td>
                <td><b>{l.item_name}</b></td>
                <td>{l.uom}</td>
                <td className="rt mono"><b>{qty(l.qty)}</b></td>
                <td style={{ color: 'var(--muted)' }}>{l.remark || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p style={{ color: 'var(--muted)', fontSize: 12 }}>
        Recorded by {head.recorded_by_name || 'unknown'}. The cost taken back off this site
        was fixed at the central store&apos;s rate for {dmy(head.returned_on)}; it shows on
        the expense report, not here.
      </p>
    </Modal>
  );
}
