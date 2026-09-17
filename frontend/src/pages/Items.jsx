import { useState } from 'react';
import { PageHead } from '../App';
import { api, qty } from '../api';
import { useApi, Card, Tag, Empty, Loading, ErrorNote, Banner, Field, Modal, useToast } from '../components/ui';

/**
 * 2,600 items. Everything here is searched and paged on the server —
 * the client never holds the whole list, and neither does a dropdown.
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
        actions={
          <button className="btn pri" onClick={() => setAdding(true)}>Add an item</button>
        } />
      <div className="page-body">
        {error && <ErrorNote error={error} onRetry={reload} />}
        <Banner kind="info" icon="◆">
          <b>Items are picked, never typed.</b> Every other screen selects from this list, so the same
          thing cannot enter twice under two spellings.
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
                      <td><Tag kind="brand">{i.code}</Tag></td>
                      <td>
                        <b>{i.name}</b>
                        <small>
                          {i.category.name}
                          {i.makes.length ? ` · ${i.makes.slice(0, 5).join(', ')}${i.makes.length > 5 ? ` +${i.makes.length - 5}` : ''}` : ' · make not specified'}
                        </small>
                      </td>
                      <td>{i.uom}</td>
                      <td>
                        <Tag kind={i.type === 'CONSUMABLE' ? 'warn' : 'ok'}>
                          {i.type === 'CONSUMABLE' ? 'Consumable' : 'Billable'}
                        </Tag>
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
        <NewItem cats={cats || []}
          onClose={() => setAdding(false)}
          onSaved={() => { reload(); reloadCats(); setAdding(false); }} />
      )}
    </>
  );
}

function NewItem({ cats, onClose, onSaved }) {
  const toast = useToast();
  const { data: uoms } = useApi('/masters/uoms');
  const [f, setF] = useState({
    name: '',
    categoryId: '',
    uomId: '',
    type: 'BILLABLE',
    gstRate: '18',
    hsn: '',
    makes: '',
  });
  const [saving, setSaving] = useState(false);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));

  const ready = f.name.trim().length >= 3 && f.categoryId && f.uomId && !saving;

  const save = async () => {
    setSaving(true);
    try {
      const makesArr = f.makes
        .split(',')
        .map((m) => m.trim())
        .filter(Boolean);
      const r = await api.post('/items', {
        name: f.name.trim(),
        categoryId: Number(f.categoryId),
        uomId: Number(f.uomId),
        type: f.type,
        gstRate: Number(f.gstRate) || 18,
        hsn: f.hsn.trim() || undefined,
        makes: makesArr,
      });
      if (r.warning) {
        toast(r.warning, '');
      } else {
        toast(`${r.code} — ${r.name} added`, 'ok');
      }
      onSaved(r);
    } catch (e) {
      if (e.status === 409 && e.detail?.itemId) {
        toast(e.message, '');
        onSaved({ id: e.detail.itemId });
        return;
      }
      toast(e.message, 'bad');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title="Add an item"
      sub="The code is assigned automatically — only the name, category and unit are needed"
      onClose={onClose}
      footer={
        <button className="btn pri" disabled={!ready} onClick={save}>
          {saving ? 'Adding…' : 'Add item'}
        </button>
      }>
      <Field label="Item name" hint="At least 3 characters">
        <input className="inp" value={f.name} autoFocus
          placeholder="e.g. PVC Conduit 20mm"
          onChange={set('name')}
          onKeyDown={(e) => { if (e.key === 'Enter' && ready) save(); }} />
      </Field>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <Field label="Category">
          <select className="inp" style={{ width: 200 }} value={f.categoryId} onChange={set('categoryId')}>
            <option value="">— choose —</option>
            {cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>
        <Field label="Unit">
          <select className="inp" style={{ width: 130 }} value={f.uomId} onChange={set('uomId')}>
            <option value="">— choose —</option>
            {(uoms || []).map((u) => <option key={u.id} value={u.id}>{u.code} — {u.name}</option>)}
          </select>
        </Field>
      </div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <Field label="Type">
          <select className="inp" style={{ width: 150 }} value={f.type} onChange={set('type')}>
            <option value="BILLABLE">Billable</option>
            <option value="CONSUMABLE">Consumable</option>
          </select>
        </Field>
        <Field label="GST rate %" hint="Default 18%">
          <select className="inp" style={{ width: 110 }} value={f.gstRate} onChange={set('gstRate')}>
            <option value="0">0%</option>
            <option value="5">5%</option>
            <option value="12">12%</option>
            <option value="18">18%</option>
            <option value="28">28%</option>
          </select>
        </Field>
        <Field label="HSN code" hint="Optional">
          <input className="inp mono" style={{ width: 130 }} value={f.hsn}
            placeholder="e.g. 85366990" onChange={set('hsn')} />
        </Field>
      </div>
      <Field label="Makes / brands" hint="Optional — comma-separated, e.g. Havells, Anchor, Legrand">
        <input className="inp" value={f.makes}
          placeholder="Havells, Anchor"
          onChange={set('makes')} />
      </Field>
    </Modal>
  );
}
