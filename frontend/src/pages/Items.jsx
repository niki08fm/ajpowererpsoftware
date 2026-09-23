import { useState } from 'react';
import { PageHead } from '../App';
import { api, qty, canWrite } from '../api';
import {
  useApi, Card, Field, Tag, Empty, Loading, ErrorNote, Banner, Modal, useToast, Code,
} from '../components/ui';
import { Icon } from '../components/icons';

/**
 * 2,600 items. Everything here is searched and paged on the server —
 * the client never holds the whole list, and neither does a dropdown.
 *
 * Adding to the master is the store's job and nobody else's, which is
 * why this screen sits under Store as well as Planning: the storekeeper
 * is the one person who knows whether a thing arriving on a lorry is
 * genuinely new or the same item under a different spelling. Everybody
 * else picks from the list.
 *
 * There is no rate on this screen, and that is deliberate. What an item
 * costs is Procurement's business and nobody else's, so it is shown
 * where it is used — against the order being placed, next to what the
 * central store is already holding it at. An item has no single price
 * anyway: every movement stamps what it stood at on the day, which is
 * why a "standard rate" in a master list would be a number that was
 * never true of anything.
 */
const PAGE = 60;

export default function Items() {
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('');
  const [type, setType] = useState('');
  const [page, setPage] = useState(1);
  const [adding, setAdding] = useState(false);

  const { data: cats, reload: reloadCats } = useApi('/masters/categories');
  const path = `/items?page=${page}&pageSize=${PAGE}`
    + (q.trim() ? `&q=${encodeURIComponent(q.trim())}` : '')
    + (cat ? `&categoryId=${cat}` : '')
    + (type ? `&type=${type}` : '');
  const { data, error, loading, reload } = useApi(path);

  const pages = data ? Math.ceil(data.total / PAGE) : 1;
  const reset = (fn) => (e) => { fn(e.target.value); setPage(1); };

  return (
    <>
      <PageHead title="Item master" sub="Codes are the company's own — nobody types them"
        actions={canWrite('/items') && <button className="btn pri" onClick={() => setAdding(true)}>Add an item</button>} />
      <div className="page-body">
        {error && <ErrorNote error={error} onRetry={reload} />}
        <Banner kind="info" icon="◆">
          <b>Items are picked, never typed.</b> Every other screen selects from this list, so the same
          thing cannot enter twice under two spellings. Adding to it is the store's job.
        </Banner>

        <div className="searchbar">
          <input className="inp" style={{ minWidth: 260 }} placeholder="Search code, name or make"
            value={q} onChange={reset(setQ)} />
          <select className="inp" value={cat} onChange={reset(setCat)}>
            <option value="">All categories</option>
            {(cats || []).map((c) => <option key={c.id} value={c.id}>{c.name} ({c.item_count})</option>)}
          </select>
          <select className="inp" value={type} onChange={reset(setType)}>
            <option value="">Billable and consumable</option>
            <option value="BILLABLE">Billable only</option>
            <option value="CONSUMABLE">Consumable only</option>
          </select>
          {data && (
            <span style={{ color: 'var(--muted)' }}>
              {data.total.toLocaleString('en-IN')} item{data.total === 1 ? '' : 's'}
            </span>
          )}
        </div>

        <Card>
          {loading ? <Loading /> : (
            <div className="tw">
              <table>
                <thead>
                  <tr>
                    <th style={{ width: 108 }}>Code</th><th>Item</th><th style={{ width: 80 }}>Unit</th>
                    <th style={{ width: 110 }}>Type</th>
                    <th className="rt" style={{ width: 110 }}>Opening</th>
                  </tr>
                </thead>
                <tbody>
                  {(data?.items || []).map((i) => (
                    <tr key={i.id}>
                      <td><Code as="b">{i.code}</Code></td>
                      <td>
                        <b>{i.name}</b>
                        <small>
                          {i.category.name}
                          {i.makes.length ? ` · ${i.makes.slice(0, 5).join(', ')}${i.makes.length > 5 ? ` +${i.makes.length - 5}` : ''}` : ' · make not specified'}
                        </small>
                      </td>
                      <td>{i.uom}</td>
                      <td>
                        <span className="tag kind">{i.type === 'CONSUMABLE' ? 'Consumable' : 'Billable'}</span>
                      </td>
                      <td className="rt mono">{Number(i.openingQty) ? qty(i.openingQty) : '—'}</td>
                    </tr>
                  ))}
                  {!(data?.items || []).length && (
                    <tr><td colSpan={5}><Empty title="Nothing matches">Try fewer words, or part of the code.</Empty></td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
          {pages > 1 && (
            <div className="pad" style={{ display: 'flex', gap: 10, alignItems: 'center', borderTop: '1px solid var(--line-2)' }}>
              <button className="btn sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</button>
              <span style={{ color: 'var(--muted)' }}>Page {page} of {pages}</span>
              <button className="btn sm" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>Next</button>
            </div>
          )}
        </Card>
      </div>

      {adding && (
        <NewItem
          categories={cats || []}
          onClose={() => setAdding(false)}
          onSaved={(saved) => {
            setAdding(false);
            // land on the thing just added rather than wherever the
            // list happened to be
            setQ(saved.code); setCat(''); setType(''); setPage(1);
            reload(); reloadCats();
          }} />
      )}
    </>
  );
}

/**
 * Adding to the master.
 *
 * The code is not on this form. It is the company's own, allocated
 * from the category, and letting anybody type one is how two items end
 * up sharing a number.
 *
 * Two guards sit behind Save and they are deliberately different. The
 * same name, however spelled, is refused outright — that is a hard
 * duplicate. The same words in a different order is only a warning:
 * "1.5 SQMM WIRE RED" and "RED WIRE 1.5 SQMM" usually are the same
 * thing but occasionally are not, and refusing the ones that are not
 * would mean a storekeeper standing at a lorry with nothing to book
 * material against.
 */
function NewItem({ categories, onClose, onSaved }) {
  const toast = useToast();
  const { data: uoms } = useApi('/masters/uoms');
  const { data: allMakes } = useApi('/masters/makes');

  const [f, setF] = useState({
    name: '', categoryId: '', uomId: '', type: 'BILLABLE',
    gstRate: '18', hsn: '',
  });
  const [makes, setMakes] = useState([]);
  const [makeText, setMakeText] = useState('');
  const [saving, setSaving] = useState(false);
  const [similar, setSimilar] = useState(null);

  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));

  const addMake = (name) => {
    const m = name.trim();
    if (!m) return;
    setMakes((ms) => (ms.some((x) => x.toLowerCase() === m.toLowerCase()) ? ms : [...ms, m]));
    setMakeText('');
  };

  const ready = f.name.trim().length >= 3 && f.categoryId && f.uomId && !saving;

  const save = async () => {
    setSaving(true);
    try {
      const r = await api.post('/items', {
        name: f.name.trim(),
        categoryId: Number(f.categoryId),
        uomId: Number(f.uomId),
        type: f.type,
        gstRate: Number(f.gstRate || 18),
        hsn: f.hsn.trim() || undefined,
        makes,
      });
      // saved either way; the soft guard only asks somebody to look
      if (r.warning) {
        toast(`${r.code} added — but check the look-alikes`, 'warn');
        setSimilar({ ...r });
        setSaving(false);
        return;
      }
      toast(`${r.code} · ${r.name} added to the master`, 'ok');
      onSaved(r);
    } catch (e) {
      // already there: say which one, and do not lose what was typed
      toast(e.message, 'bad');
      setSaving(false);
    }
  };

  if (similar) {
    return (
      <Modal title={`${similar.code} added`} onClose={() => onSaved(similar)}
        sub="It is in the master. These look like the same thing written differently."
        footer={<button className="btn pri" onClick={() => onSaved(similar)}>Understood</button>}>
        <Banner kind="warn" icon="◆">
          <b>{similar.name}</b> was saved. If one of these is really the same item, use that one from
          now on and tell the store which to retire — nothing here deletes an item that documents
          may already point at.
        </Banner>
        <div className="tw">
          <table>
            <thead><tr><th style={{ width: 110 }}>Item code</th><th>Item</th></tr></thead>
            <tbody>
              {similar.similar.map((s) => (
                <tr key={s.id}><td><Code>{s.code}</Code></td><td>{s.name}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </Modal>
    );
  }

  return (
    <Modal title="Add an item to the master" wide onClose={onClose}
      sub="The code is allocated from the category — nobody types one"
      footer={
        <>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn pri" disabled={!ready} onClick={save}>
            {saving ? 'Adding…' : 'Add to the master'}
          </button>
        </>
      }>
      <Field label="Item name"
        hint="How the store and the site both say it. The same thing under two spellings is the one thing this list exists to prevent.">
        <input className="inp" value={f.name} autoFocus
          placeholder="1.5 SQMM FR PVC WIRE RED"
          onChange={(e) => setF((x) => ({ ...x, name: e.target.value.toUpperCase() }))}
          onKeyDown={(e) => { if (e.key === 'Enter' && ready) save(); }} />
      </Field>

      <div className="row2">
        <Field label="Category" hint="Decides the code it is given">
          <select className="inp" value={f.categoryId} onChange={set('categoryId')}>
            <option value="">Choose one</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>
        <Field label="Unit" hint="What it is counted in, and cannot change afterwards">
          <select className="inp" value={f.uomId} onChange={set('uomId')}>
            <option value="">Choose one</option>
            {(uoms || []).map((u) => <option key={u.id} value={u.id}>{u.code} — {u.name}</option>)}
          </select>
        </Field>
      </div>

      <div className="row2">
        <Field label="Type"
          hint="Billable goes on a client bill. Consumable is spent getting the work done and never does.">
          <select className="inp" value={f.type} onChange={set('type')}>
            <option value="BILLABLE">Billable</option>
            <option value="CONSUMABLE">Consumable</option>
          </select>
        </Field>
        <Field label="GST %">
          <select className="inp" value={f.gstRate} onChange={set('gstRate')}>
            {[0, 5, 12, 18, 28].map((g) => <option key={g} value={g}>{g}%</option>)}
          </select>
        </Field>
      </div>

      <Field label="HSN" hint="Optional — the purchase order carries it">
        <input className="inp mono" value={f.hsn} maxLength={12} placeholder="85446090"
          onChange={set('hsn')} />
      </Field>

      <Field label="Makes"
        hint="Optional. Naming them here is what lets a PRN ask for a make and a purchase order be checked against it.">
        <input className="inp" value={makeText} list="known-makes"
          placeholder="Polycab — type and press Enter"
          onChange={(e) => setMakeText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); addMake(makeText); }
          }} />
        <datalist id="known-makes">
          {(allMakes || []).map((m) => <option key={m.id} value={m.name} />)}
        </datalist>
        <div className="chips">
          {makes.map((m) => (
            <span key={m} className="chip">
              {m}
              <button type="button" aria-label={`Remove ${m}`}
                onClick={() => setMakes((ms) => ms.filter((x) => x !== m))}><Icon name="x" size={14} /></button>
            </span>
          ))}
        </div>
      </Field>
    </Modal>
  );
}
