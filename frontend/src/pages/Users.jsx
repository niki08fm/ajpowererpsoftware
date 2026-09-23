import { useState } from 'react';
import { PageHead, useApp } from '../App';
import { api, dmy } from '../api';
import {
  useApi, Card, Tag, Empty, Loading, ErrorNote, Banner, Field, Modal, useToast,
} from '../components/ui';

/**
 * Logins, and what each one reaches. Management only.
 *
 * The role decides the screens. For two roles the sites matter too:
 * a General Manager sees only the projects they are GM of, and a Site
 * login sees only the sites they are on — and issues material only
 * where they are the store keeper. Those are set here, and they are the
 * site's own record, so the site screens show the same people.
 */
const ROLE_NOTE = {
  Management: 'Sees every department and every project, view only. Signs the second level. Makes the logins.',
  'General Manager': 'Sees every department, view only — for the projects they are GM of. Signs the first level.',
  Planning: 'Sites, work orders, BOQs and clients.',
  Site: 'Indents, acknowledgements, site store, expenses — on their own sites. Issues material only as store keeper.',
  Store: 'PRNs, GRNs, challans, stock and movement.',
  Procurement: 'The buy list, rate comparisons, purchase orders and suppliers.',
  Billing: 'Bills for each site.',
};
const HAS_SITES = ['General Manager', 'Site'];
const AS_LABEL = { GM: 'GM', HEAD: 'Head', KEEPER: 'Store keeper', TEAM: 'Team' };

export default function Users() {
  const toast = useToast();
  const { user: me } = useApp();
  const { data, error, loading, reload } = useApi('/admin/users');
  const [edit, setEdit] = useState(null);     // null | 'new' | user
  const [sites, setSites] = useState(null);   // user whose sites are open
  const [q, setQ] = useState('');
  const [role, setRole] = useState('');

  const users = (data?.users || []).filter((u) => (!role || u.department === role)
    && (!q || `${u.name} ${u.email} ${u.empCode}`.toLowerCase().includes(q.toLowerCase())));
  const roles = data?.roles || [];

  return (
    <>
      <PageHead title="Users & access"
        sub="Who can sign in, what their role shows them, and which sites they reach"
        actions={<button className="btn pri" onClick={() => setEdit('new')}>New login</button>} />
      <div className="page-body">
        {error && <ErrorNote error={error} onRetry={reload} />}
        <Card>
          <div className="pad" style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <input className="inp" style={{ maxWidth: 280 }} value={q}
              placeholder="Search name, email or code" onChange={(e) => setQ(e.target.value)} />
            <select className="inp" style={{ maxWidth: 220 }} value={role}
              onChange={(e) => setRole(e.target.value)}>
              <option value="">Every role</option>
              {roles.map((r) => <option key={r}>{r}</option>)}
            </select>
          </div>
        </Card>

        {loading ? <Loading /> : (
          <Card title={`${users.length} login${users.length === 1 ? '' : 's'}`}>
            <div className="tw">
              <table>
                <thead>
                  <tr>
                    <th>Person</th><th>Role</th><th>Sites they reach</th>
                    <th>Last signed in</th><th />
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => (
                    <tr key={u.id} style={u.isActive ? undefined : { opacity: 0.55 }}>
                      <td>
                        <b>{u.name}</b>
                        <small className="mono">{u.empCode} · {u.email}</small>
                      </td>
                      <td>
                        <Tag kind={['Management', 'General Manager'].includes(u.department) ? 'brand' : ''}>
                          {u.department}
                        </Tag>
                        {!u.isActive && <> <Tag kind="bad">Switched off</Tag></>}
                      </td>
                      <td>
                        {HAS_SITES.includes(u.department) ? (
                          u.sites.length
                            ? <div className="chips">{u.sites.map((s) => (
                                <span className="chip" key={`${s.siteId}${s.as}`}>
                                  {s.name}<small>{AS_LABEL[s.as]}</small>
                                </span>))}</div>
                            : <span style={{ color: 'var(--bad)' }}>None yet — they will see nothing</span>
                        ) : <span style={{ color: 'var(--muted)' }}>Every site</span>}
                      </td>
                      <td>{u.lastLoginAt ? dmy(u.lastLoginAt) : <span style={{ color: 'var(--faint)' }}>never</span>}</td>
                      <td className="rt" style={{ whiteSpace: 'nowrap' }}>
                        {HAS_SITES.includes(u.department) && (
                          <button className="btn sm" onClick={() => setSites(u)}>Sites</button>
                        )}{' '}
                        <button className="btn sm" onClick={() => setEdit(u)}>Edit</button>
                      </td>
                    </tr>
                  ))}
                  {!users.length && (
                    <tr><td colSpan={5}><Empty title="Nobody matches">Try a different word or role.</Empty></td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        )}
      </div>

      {edit && (
        <UserForm user={edit === 'new' ? null : edit} roles={roles} self={edit !== 'new' && edit.id === me?.id}
          onClose={() => setEdit(null)}
          onDone={(msg) => { setEdit(null); reload(); toast(msg, 'ok'); }} />
      )}
      {sites && (
        <SitesForm user={sites} onClose={() => setSites(null)}
          onDone={() => { setSites(null); reload(); toast('Sites saved', 'ok'); }} />
      )}
    </>
  );
}

function UserForm({ user, roles, self, onClose, onDone }) {
  const toast = useToast();
  const [f, setF] = useState({
    name: user?.name || '', email: user?.email || '', phone: user?.phone || '',
    department: user?.department || 'Site', password: '', isActive: user ? user.isActive : true,
  });
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  const save = async () => {
    if (!user && f.password.length < 8) return toast('Give them a password of at least 8 characters', 'bad');
    if (user && f.password && f.password.length < 8) return toast('A password needs at least 8 characters', 'bad');
    setBusy(true);
    try {
      const body = {
        name: f.name.trim(), email: f.email.trim(), department: f.department,
        ...(f.phone.trim() ? { phone: f.phone.trim() } : {}),
        ...(f.password ? { password: f.password } : {}),
      };
      if (user) {
        await api.patch(`/admin/users/${user.id}`, { ...body, isActive: f.isActive });
        onDone(f.password ? `${f.name} saved — they sign in with the new password` : `${f.name} saved`);
      } else {
        await api.post('/admin/users', body);
        onDone(`${f.name} can sign in now as ${f.email.trim()}`);
      }
    } catch (e) {
      toast(e.message, 'bad');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={user ? `Edit ${user.name}` : 'New login'} onClose={onClose}
      footer={<>
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn pri" onClick={save} disabled={busy || !f.name.trim() || !f.email.trim()}>
          {busy ? 'Saving…' : user ? 'Save' : 'Create login'}
        </button>
      </>}>
      <div className="grid2">
        <Field label="Name"><input className="inp" value={f.name} onChange={set('name')} autoFocus /></Field>
        <Field label="Phone"><input className="inp" value={f.phone} onChange={set('phone')} /></Field>
      </div>
      <Field label="Email" hint="What they sign in with">
        <input className="inp" type="email" value={f.email} onChange={set('email')} />
      </Field>
      <Field label="Role" hint={ROLE_NOTE[f.department]}>
        <select className="inp" value={f.department} onChange={set('department')} disabled={self}>
          {roles.map((r) => <option key={r}>{r}</option>)}
        </select>
      </Field>
      <Field label={user ? 'New password' : 'Password'}
        hint={user ? 'Leave empty to keep their password. Setting one signs them out everywhere.'
          : 'Tell them this; they can change it once signed in.'}>
        <input className="inp" type="text" autoComplete="new-password" value={f.password} onChange={set('password')} />
      </Field>
      {user && !self && (
        <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input type="checkbox" checked={f.isActive}
            onChange={(e) => setF({ ...f, isActive: e.target.checked })} />
          Can sign in {f.isActive ? '' : '— switched off, and signed out now'}
        </label>
      )}
      {user && HAS_SITES.includes(f.department) && f.department !== user.department && (
        <Banner kind="info" icon="i">After saving, set which sites they reach from “Sites”.</Banner>
      )}
    </Modal>
  );
}

function SitesForm({ user, onClose, onDone }) {
  const toast = useToast();
  const { data: all, loading } = useApi('/sites');
  const gm = user.department === 'General Manager';
  const start = {};
  for (const s of user.sites) {
    if (gm && s.as === 'GM') start[s.siteId] = 'GM';
    if (!gm && (s.as === 'KEEPER' || s.as === 'TEAM')) {
      start[s.siteId] = start[s.siteId] === 'KEEPER' ? 'KEEPER' : s.as;
    }
  }
  const [pick, setPick] = useState(start);
  const [busy, setBusy] = useState(false);
  // head of a site sees it too, but that is set on the site itself
  const heads = new Set(user.sites.filter((s) => s.as === 'HEAD').map((s) => s.siteId));

  const save = async () => {
    setBusy(true);
    try {
      await api.put(`/admin/users/${user.id}/sites`, {
        sites: Object.entries(pick).filter(([, v]) => v).map(([id, as]) => ({ siteId: Number(id), as })),
      });
      onDone();
    } catch (e) {
      toast(e.message, 'bad');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal wide title={`Sites for ${user.name}`}
      sub={gm ? 'The projects they are General Manager of. Ticking one makes them its GM in place of whoever is now.'
        : 'The sites they work on. The store keeper is the one person who issues that site’s material.'}
      onClose={onClose}
      footer={<>
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn pri" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
      </>}>
      {loading ? <Loading /> : (
        <div className="tw">
          <table>
            <thead>
              <tr><th>Site</th><th>{gm ? 'GM now' : 'Store keeper now'}</th><th>{gm ? 'Their GM' : 'Their access'}</th></tr>
            </thead>
            <tbody>
              {(all || []).map((s) => (
                <tr key={s.id}>
                  <td><b>{s.name}</b><small className="mono">{s.code} · {s.branch.name}</small></td>
                  <td>{(gm ? s.gm : s.keeper)?.name || <span style={{ color: 'var(--faint)' }}>nobody</span>}</td>
                  <td>
                    {gm ? (
                      <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                        <input type="checkbox" checked={pick[s.id] === 'GM'}
                          // a project always has a GM: it moves to someone, it is not dropped
                          disabled={start[s.id] === 'GM'}
                          onChange={(e) => setPick({ ...pick, [s.id]: e.target.checked ? 'GM' : undefined })} />
                        {start[s.id] === 'GM' ? 'GM — give it to another GM to move it' : 'Make them GM'}
                      </label>
                    ) : (
                      <select className="inp" style={{ maxWidth: 200 }} value={pick[s.id] || ''}
                        onChange={(e) => setPick({ ...pick, [s.id]: e.target.value || undefined })}>
                        <option value="">{heads.has(s.id) ? 'Head of site' : 'No access'}</option>
                        <option value="TEAM">On the team</option>
                        <option value="KEEPER">Store keeper</option>
                      </select>
                    )}
                  </td>
                </tr>
              ))}
              {!(all || []).length && (
                <tr><td colSpan={3}><Empty title="No sites yet">Planning creates them.</Empty></td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  );
}
