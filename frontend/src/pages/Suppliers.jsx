import { useState } from 'react';
import { PageHead } from '../App';
import { api, money } from '../api';
import { downloadCsv } from '../download';
import {
  useApi, Card, Tag, Empty, Loading, ErrorNote, Banner, Field, Modal, useToast,
} from '../components/ui';

/**
 * Suppliers. The same duplicate guard as the item master, for the same
 * reason: one company with two ledgers is how you stop knowing what you
 * owe whom.
 */
export default function Suppliers() {
  const toast = useToast();
  const [q, setQ] = useState('');
  const { data, error, loading, reload } = useApi(`/suppliers?q=${encodeURIComponent(q)}`, [q]);
  const { data: makes } = useApi('/masters/makes');
  const [open, setOpen] = useState(null);       // null | 'new' | supplier id
  const rows = data || [];

  const grab = () => downloadCsv('suppliers', [
    ['Code', 'Name', 'GSTIN', 'Terms (days)', 'Contact', 'Phone', 'Makes', 'Orders'],
    ...rows.map((r) => [r.code, r.name, r.gstin || '', r.terms_days,
      r.contact_name || '', r.contact_phone || '', r.makes || '', r.po_count]),
  ]);

  return (
    <>
      <PageHead title="Suppliers" sub="Who we buy from, and what they carry"
        actions={
          <div style={{ display: 'flex', gap: 9 }}>
            <button className="btn" onClick={grab} disabled={!rows.length}>Download</button>
            <button className="btn pri" onClick={() => setOpen('new')}>Add a supplier</button>
          </div>
        } />
      <div className="page-body">
        {error && <ErrorNote error={error} onRetry={reload} />}
        <Card>
          <div className="pad">
            <input className="inp" style={{ maxWidth: 320 }} value={q}
              placeholder="Search name, code or GSTIN"
              onChange={(e) => setQ(e.target.value)} />
          </div>
        </Card>

        {loading ? <Loading /> : (
          <Card title={`${rows.length} supplier${rows.length === 1 ? '' : 's'}`}>
            <div className="tw">
              <table>
                <thead>
                  <tr>
                    <th style={{ width: 100 }}>Code</th><th>Name</th><th>GSTIN</th>
                    <th>Contact</th><th className="rt">Terms</th>
                    <th>Makes they carry</th><th className="rt">Orders</th><th />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id}>
                      <td className="mono" style={{ color: 'var(--brand-ink)' }}>{r.code}</td>
                      <td><b>{r.name}</b></td>
                      <td className="mono">{r.gstin || <span style={{ color: 'var(--faint)' }}>—</span>}</td>
                      <td>{r.contact_name || '—'}
                        {r.contact_phone && <small className="mono">{r.contact_phone}</small>}</td>
                      <td className="rt mono">{r.terms_days} days</td>
                      <td>{r.makes
                        ? <small>{r.makes}</small>
                        : <span style={{ color: 'var(--faint)' }}>not recorded</span>}</td>
                      <td className="rt mono">{r.po_count || '—'}</td>
                      <td className="rt">
                        <button className="btn sm" onClick={() => setOpen(r.id)}>Edit</button>
                      </td>
                    </tr>
                  ))}
                  {!rows.length && (
                    <tr><td colSpan={8}>
                      <Empty title={q ? 'Nothing matches' : 'No suppliers yet'}>
                        {q ? 'Try a different word.' : 'Add the first one to start raising orders.'}
                      </Empty>
                    </td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        )}
      </div>

      {open && (
        <SupplierForm id={open === 'new' ? null : open} makes={makes || []}
          onClose={() => setOpen(null)}
          onDone={() => { setOpen(null); reload(); toast('Saved', 'ok'); }} />
      )}
    </>
  );
}

function SupplierForm({ id, makes, onClose, onDone }) {
  const toast = useToast();
  const { data, loading } = useApi(id ? `/suppliers/${id}` : null, [id]);
  const [f, setF] = useState(null);
  const [busy, setBusy] = useState(false);

  const form = f || (data ? {
    name: data.name, gstin: data.gstin || '', address: data.address || '',
    contactName: data.contact_name || '', contactPhone: data.contact_phone || '',
    email: data.email || '', termsDays: String(data.terms_days),
    makes: (data.makeList || []).map((m) => m.id),
  } : {
    name: '', gstin: '', address: '', contactName: '', contactPhone: '',
    email: '', termsDays: '30', makes: [],
  });

  const set = (k) => (e) => setF({ ...form, [k]: e.target.value });

  const save = async () => {
    if (form.name.trim().length < 2) return toast('Give the supplier a name', 'bad');
    if (form.gstin && form.gstin.length !== 15) return toast('A GSTIN is 15 characters', 'bad');
    setBusy(true);
    try {
      const body = {
        name: form.name.trim(),
        gstin: form.gstin || undefined,
        address: form.address || undefined,
        contactName: form.contactName || undefined,
        contactPhone: form.contactPhone || undefined,
        email: form.email || undefined,
        termsDays: Number(form.termsDays) || 30,
        makes: form.makes,
      };
      if (id) await api.patch(`/suppliers/${id}`, body);
      else await api.post('/suppliers', body);
      onDone();
    } catch (e) { toast(e.message, 'bad'); }
    setBusy(false);
    return undefined;
  };

  if (id && loading) return <Modal title="Supplier" onClose={onClose}><Loading /></Modal>;

  return (
    <Modal wide title={id ? `Edit ${data.code}` : 'Add a supplier'}
      onClose={onClose}
      footer={<>
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn pri" disabled={busy} onClick={save}>
          {id ? 'Save' : 'Add'}
        </button>
      </>}>
      {!id && (
        <Banner kind="info" icon="◆">
          Checked against every supplier already on the list, ignoring case and punctuation — so the
          same company cannot end up with two ledgers.
        </Banner>
      )}
      <Field label="Name">
        <input className="inp" value={form.name} onChange={set('name')}
          placeholder="e.g. Polycab Distributors" />
      </Field>
      <div className="row2">
        <Field label="GSTIN"><input className="inp mono" value={form.gstin} onChange={set('gstin')}
          maxLength={15} placeholder="15 characters" /></Field>
        <Field label="Payment terms" hint="Days. Shown on the order.">
          <input className="inp" type="number" min="0" value={form.termsDays}
            onChange={set('termsDays')} /></Field>
      </div>
      <div className="row2">
        <Field label="Contact"><input className="inp" value={form.contactName}
          onChange={set('contactName')} /></Field>
        <Field label="Phone"><input className="inp" value={form.contactPhone}
          onChange={set('contactPhone')} /></Field>
      </div>
      <Field label="Email"><input className="inp" value={form.email} onChange={set('email')} /></Field>
      <Field label="Address">
        <textarea className="inp" rows={2} value={form.address} onChange={set('address')} />
      </Field>
      <Field label="Makes they carry"
        hint="So a comparison offers the right people rather than the whole list.">
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {makes.map((m) => {
            const on = form.makes.includes(m.id);
            return (
              <button key={m.id} type="button" className={`btn sm ${on ? 'pri' : ''}`}
                onClick={() => setF({
                  ...form,
                  makes: on ? form.makes.filter((x) => x !== m.id) : [...form.makes, m.id],
                })}>
                {m.name}
              </button>
            );
          })}
        </div>
      </Field>
    </Modal>
  );
}
