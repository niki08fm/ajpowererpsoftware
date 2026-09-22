import { useState } from 'react';
import { useApp, PageHead } from '../App';
import { api, withBranch } from '../api';
import {
  useApi, Card, Empty, Loading, ErrorNote, Modal, Field, Banner, useToast,
} from '../components/ui';

/**
 * A store belongs to a branch, not to a project. No client, no work
 * order, no BOQ — which is exactly why it is not on the sites screen.
 */
export default function Stores() {
  const { branchId, branches, users, loadPlaces } = useApp();
  const toast = useToast();
  const { data, error, loading, reload } = useApi(
    withBranch('/sites/stores/list', branchId), [branchId]);
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ name: '', keeperUserId: '', location: '', branchId: '' });
  // on every branch a new store still belongs to exactly one
  const target = branchId || (f.branchId ? Number(f.branchId) : null);

  const save = async () => {
    try {
      if (!target) { toast('Pick the branch this store belongs to', 'bad'); return; }
      await api.post('/sites/stores', {
        name: f.name.trim(), branchId: target,
        keeperUserId: f.keeperUserId ? Number(f.keeperUserId) : undefined,
        location: f.location || undefined,
      });
      toast('Store created', 'ok');
      loadPlaces?.();
      setOpen(false); setF({ name: '', keeperUserId: '', location: '', branchId: '' }); reload();
    } catch (e) { toast(e.message, 'bad'); }
  };

  return (
    <>
      <PageHead title="Stores" sub="Branch warehouses — material lands here and moves out on a challan"
        actions={<button className="btn pri" onClick={() => setOpen(true)}>New store</button>} />
      <div className="page-body">
        {error && <ErrorNote error={error} onRetry={reload} />}
        <Banner kind="info" icon="▥">
          A store belongs to a branch, not to a project. Material is received into it against a purchase
          order and moves to site on a challan — which is what will give you the in-transit view once the
          store side is built.
        </Banner>
        {loading ? <Loading /> : (
          <Card>
            <div className="tw">
              <table>
                <thead><tr><th>Store</th><th>Branch</th><th>Storekeeper</th><th>Location</th></tr></thead>
                <tbody>
                  {(data || []).map((s) => (
                    <tr key={s.id}>
                      <td><b>{s.name}</b><small>{s.code}</small></td>
                      <td>{s.branch.name}</td>
                      <td>{s.keeper?.name || '—'}</td>
                      <td>{s.location || <span style={{ color: 'var(--faint)' }}>not recorded</span>}</td>
                    </tr>
                  ))}
                  {!(data || []).length && (
                    <tr><td colSpan={4}>
                      <Empty title="No stores in this branch yet">
                        Most branches need one. A site can also receive directly if you prefer.
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
        <Modal title="New store" sub="A branch warehouse — no client, no work order" onClose={() => setOpen(false)}
          footer={<>
            <button className="btn" onClick={() => setOpen(false)}>Cancel</button>
            <button className="btn pri" onClick={save}>Create store</button>
          </>}>
          {!branchId && (
            <Field label="Branch" hint="You are viewing every branch, so say which one this store is in.">
              <select className="inp" value={f.branchId}
                onChange={(e) => setF((x) => ({ ...x, branchId: e.target.value }))}>
                <option value="">— choose the branch —</option>
                {(branches || []).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </Field>
          )}
          <Field label="Store name">
            <input className="inp" autoFocus value={f.name} placeholder="e.g. Central Store — Hyderabad"
              onChange={(e) => setF({ ...f, name: e.target.value })} />
          </Field>
          <Field label="Storekeeper">
            <select className="inp" value={f.keeperUserId} onChange={(e) => setF({ ...f, keeperUserId: e.target.value })}>
              <option value="">— not assigned —</option>
              {users.map((u) => <option key={u.id} value={u.id}>{u.name} — {u.department}</option>)}
            </select>
          </Field>
          <Field label="Location" hint="Appears on challans.">
            <input className="inp" value={f.location} onChange={(e) => setF({ ...f, location: e.target.value })} />
          </Field>
        </Modal>
      )}
    </>
  );
}
