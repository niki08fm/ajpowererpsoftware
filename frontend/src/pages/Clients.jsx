import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useApp, PageHead } from '../App';
import { api, canWrite } from '../api';
import { downloadCsv } from '../download';
import {
  useApi, Card, Field, Tag, Empty, Loading, ErrorNote, Banner, Modal, Stat, useToast,
} from '../components/ui';

/**
 * Every client, across every branch.
 *
 * Deliberately not filtered by the branch in the top bar, and this is
 * the only screen that isn't. A client belongs to exactly one branch —
 * the name is unique across the whole system and a site may only be
 * given a client of its own branch — so a client filed under the wrong
 * branch vanishes from the picker on the site form and cannot be
 * reached from anywhere else. This screen is where it is found, and
 * where its branch is put right.
 *
 * The branch can be moved only while the client has no sites. After
 * that the two are tied: a site carries its own branch and the pair has
 * to agree.
 */
export default function Clients() {
  const { branches } = useApp();
  const [q, setQ] = useState('');
  const [branch, setBranch] = useState('');
  const [editing, setEditing] = useState(null);   // a client, or {} for new

  const { data, error, loading, reload } = useApi('/masters/clients');

  const rows = (data || []).filter((c) => {
    if (branch && String(c.branch_id) !== branch) return false;
    if (!q.trim()) return true;
    const hay = `${c.name} ${c.gstin || ''} ${c.contact_name || ''}`.toLowerCase();
    return q.trim().toLowerCase().split(/\s+/).every((w) => hay.includes(w));
  });

  const grab = () => downloadCsv('clients', [
    ['Client', 'Branch', 'GSTIN', 'Address', 'Contact', 'Phone', 'Sites'],
    ...rows.map((c) => [c.name, c.branch_name, c.gstin || '', c.address || '',
      c.contact_name || '', c.contact_phone || '', c.site_count]),
  ]);

  return (
    <>
      <PageHead title="Clients" sub="Who the work is for. One client belongs to one branch."
        actions={
          <>
            {rows.length ? <button className="btn" onClick={grab}>Download</button> : null}
            {canWrite('/masters/clients') && <button className="btn pri" onClick={() => setEditing({})}>Add a client</button>}
          </>
        } />
      <div className="page-body">
        {error && <ErrorNote error={error} onRetry={reload} />}

        <Banner kind="info" icon="◆">
          <b>A site may only be given a client of its own branch.</b> If a client does not appear
          when you are creating a site, it is almost always filed under the other branch — find it
          here and change it. The branch can be moved right up until the client has its first site.
        </Banner>

        {data && (
          <Card className="pad">
            <div className="stats">
              <Stat n={data.length} label="clients" />
              {(branches || []).map((b) => (
                <Stat key={b.id} n={data.filter((c) => c.branch_id === b.id).length} label={b.name} />
              ))}
              <Stat n={data.filter((c) => Number(c.site_count) === 0).length} label="with no site yet" />
            </div>
          </Card>
        )}

        <div className="searchbar">
          <input className="inp" style={{ minWidth: 260 }} placeholder="Search name, GSTIN or contact"
            value={q} onChange={(e) => setQ(e.target.value)} />
          <select className="inp" value={branch} onChange={(e) => setBranch(e.target.value)}>
            <option value="">Every branch</option>
            {(branches || []).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
          <span style={{ color: 'var(--muted)' }}>
            {rows.length} of {data?.length || 0}
          </span>
        </div>

        {loading ? <Loading /> : (
          <Card>
            <div className="tw">
              <table>
                <thead>
                  <tr>
                    <th>Client</th>
                    <th style={{ width: 130 }}>Branch</th>
                    <th style={{ width: 170 }}>GSTIN</th>
                    <th>Who to speak to</th>
                    <th className="rt" style={{ width: 80 }}>Sites</th>
                    <th style={{ width: 90 }} />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((c) => (
                    <tr key={c.id}>
                      <td>
                        <b>{c.name}</b>
                        {c.address && <small>{c.address}</small>}
                      </td>
                      <td><Tag kind="brand">{c.branch_name}</Tag></td>
                      <td className="mono">{c.gstin || <span style={{ color: 'var(--faint)' }}>—</span>}</td>
                      <td>
                        {c.contact_name || <span style={{ color: 'var(--faint)' }}>—</span>}
                        {c.contact_phone && <small className="mono">{c.contact_phone}</small>}
                      </td>
                      <td className="rt mono">
                        {Number(c.site_count) ? (
                          <Link className="linkish" to={`/sites?client=${c.id}`}>{c.site_count}</Link>
                        ) : <span style={{ color: 'var(--faint)' }}>none</span>}
                      </td>
                      <td>
                        <button className="btn sm" onClick={() => setEditing(c)}>Edit</button>
                      </td>
                    </tr>
                  ))}
                  {!rows.length && (
                    <tr><td colSpan={6}>
                      <Empty title={q || branch ? 'Nothing matches' : 'No clients yet'}>
                        {q || branch
                          ? 'Clear the search, or look in the other branch.'
                          : 'A site needs a client, so add the first one here.'}
                      </Empty>
                    </td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        )}
      </div>

      {editing && (
        <EditClient client={editing.id ? editing : null} branches={branches || []}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); reload(); }} />
      )}
    </>
  );
}

function EditClient({ client, branches, onClose, onSaved }) {
  const toast = useToast();
  const { branchId } = useApp();
  const isNew = !client;
  const [f, setF] = useState({
    name: client?.name || '',
    branchId: String(client?.branch_id || branchId || branches[0]?.id || ''),
    gstin: client?.gstin || '',
    address: client?.address || '',
    contactName: client?.contact_name || '',
    contactPhone: client?.contact_phone || '',
  });
  const [saving, setSaving] = useState(false);

  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const gstinBad = f.gstin.trim().length > 0 && f.gstin.trim().length !== 15;
  const ready = f.name.trim().length >= 2 && f.branchId && !gstinBad && !saving;
  const hasSites = !isNew && Number(client.site_count) > 0;

  const save = async () => {
    setSaving(true);
    const body = {
      name: f.name.trim(),
      branchId: Number(f.branchId),
      gstin: f.gstin.trim(),
      address: f.address.trim(),
      contactName: f.contactName.trim(),
      contactPhone: f.contactPhone.trim(),
    };
    try {
      if (isNew) {
        const r = await api.post('/masters/clients', {
          ...body,
          gstin: body.gstin || undefined,
          address: body.address || undefined,
          contactName: body.contactName || undefined,
          contactPhone: body.contactPhone || undefined,
        });
        toast(`${r.name} added`, 'ok');
      } else {
        await api.patch(`/masters/clients/${client.id}`, body);
        toast(`${body.name} saved`, 'ok');
      }
      onSaved();
    } catch (e) {
      toast(e.message, 'bad');
    } finally { setSaving(false); }
  };

  return (
    <Modal title={isNew ? 'Add a client' : client.name}
      sub={isNew
        ? 'The branch decides which sites may be given this client'
        : `${client.branch_name}${hasSites ? ` · ${client.site_count} site(s)` : ' · no sites yet'}`}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn pri" disabled={!ready} onClick={save}>
            {saving ? 'Saving…' : isNew ? 'Add the client' : 'Save'}
          </button>
        </>
      }>
      <Field label="Client name">
        <input className="inp" value={f.name} autoFocus placeholder="GMR Hyderabad Airport"
          onChange={set('name')}
          onKeyDown={(e) => { if (e.key === 'Enter' && ready) save(); }} />
      </Field>

      <div className="row2">
        <Field label="Branch"
          hint={hasSites
            ? 'Fixed — this client already has sites, and a site and its client share a branch'
            : 'Only sites in this branch may be given this client'}>
          <select className="inp" value={f.branchId} disabled={hasSites} onChange={set('branchId')}>
            {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </Field>
        <Field label="GSTIN" hint={gstinBad ? 'A GSTIN is 15 characters' : 'Optional'}>
          <input className="inp mono" value={f.gstin} placeholder="36AABCP1234M1Z5" maxLength={15}
            onChange={(e) => setF((x) => ({ ...x, gstin: e.target.value.toUpperCase() }))} />
        </Field>
      </div>

      <Field label="Address" hint="Optional">
        <input className="inp" value={f.address} onChange={set('address')} />
      </Field>

      <div className="row2">
        <Field label="Who to speak to" hint="Optional">
          <input className="inp" value={f.contactName} onChange={set('contactName')} />
        </Field>
        <Field label="Their number" hint="Optional">
          <input className="inp mono" value={f.contactPhone} onChange={set('contactPhone')} />
        </Field>
      </div>
    </Modal>
  );
}
