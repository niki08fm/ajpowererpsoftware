import { createContext, useContext, useCallback, useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, NavLink, Navigate, useLocation } from 'react-router-dom';
import { api, setUserId, getUserId } from './api';
import { ToastHost, Loading, ErrorNote, useApi } from './components/ui';

import Sites from './pages/Sites';
import NewSite from './pages/NewSite';
import SiteDetail from './pages/SiteDetail';
import Stores from './pages/Stores';
import Items from './pages/Items';
import BoqList from './pages/BoqList';
import Amendments from './pages/Amendments';
import Indents from './pages/Indents';
import IndentCart from './pages/IndentCart';
import IndentDetail from './pages/IndentDetail';
import Consumption from './pages/Consumption';

const AppCtx = createContext(null);
export const useApp = () => useContext(AppCtx);

/**
 * The rail picks a department, the tab bar picks the screen within it —
 * the same two-level structure the prototype settled on.
 *
 * Only Planning and Site exist so far. Store, Procure, Billing and
 * Accounts come later; they are not stubbed here, because an empty
 * screen is worse than no screen.
 */
export const SECTIONS = [
  {
    id: 'plan',
    label: 'Planning',
    icon: '\u25A4',
    screens: [
      { to: '/sites', label: 'Sites' },
      { to: '/stores', label: 'Stores' },
      { to: '/boq', label: 'BOQ' },
      { to: '/amendments', label: 'Amendments', badge: 'amendmentDue' },
      { to: '/items', label: 'Item master' },
    ],
  },
  {
    id: 'site',
    label: 'Site',
    icon: '\u25CD',
    screens: [
      { to: '/indents', label: 'Indents', badge: 'indentsWaiting' },
      { to: '/consumption', label: 'Consumption' },
    ],
  },
];

/**
 * The departments still to come. Named and greyed rather than hidden,
 * so the shape of the whole system is legible from day one and nobody
 * wonders where Billing went — but they are plainly not built yet.
 */
export const SOON = [
  { id: 'store',    label: 'Store',    icon: '\u25A5' },
  { id: 'procure',  label: 'Procure',  icon: '\u25C6' },
  { id: 'billing',  label: 'Billing',  icon: '\u20B9' },
  { id: 'accounts', label: 'Accounts', icon: '\u25CE' },
  { id: 'reports',  label: 'Reports',  icon: '\u2637' },
];

const sectionFor = (pathname) =>
  SECTIONS.find((s) => s.screens.some((x) => pathname.startsWith(x.to))) || SECTIONS[0];

function Shell({ children }) {
  const { branches, branchId, setBranch, users, me, desk } = useApp();
  const { pathname } = useLocation();
  const section = sectionFor(pathname);
  const [flyout, setFlyout] = useState(null);
  const counts = {
    amendmentDue: desk?.amendmentDue?.length || 0,
    indentsWaiting: desk?.indentsWaiting?.length || 0,
  };

  return (
    <div className="shell">
      {/* the rail names its departments, and hovering one shows every
          option inside it without leaving where you are */}
      <nav className="rail" aria-label="Departments" onMouseLeave={() => setFlyout(null)}>
        <div className="mark">AJ</div>
        {SECTIONS.map((s) => {
          const on = s.id === section.id;
          const total = s.screens.reduce((a, x) => a + (x.badge ? counts[x.badge] || 0 : 0), 0);
          return (
            <div key={s.id} onMouseEnter={() => setFlyout(s.id)}>
              <NavLink to={s.screens[0].to} className={`dept ${on ? 'on' : ''}`}
                aria-current={on ? 'page' : undefined}>
                <i aria-hidden="true">{s.icon}</i>
                <span>{s.label}</span>
                {total > 0 && !on && <span className="count">{total}</span>}
              </NavLink>
            </div>
          );
        })}

        <div className="rail-sep" />
        {SOON.map((d) => (
          <div key={d.id} className="dept soon" title={`${d.label} — not built yet`}>
            <i aria-hidden="true">{d.icon}</i>
            <span>{d.label}</span>
          </div>
        ))}

        {flyout && (
          <div className="flyout" style={{ top: 64 + SECTIONS.findIndex((x) => x.id === flyout) * 62 }}
            onMouseLeave={() => setFlyout(null)}>
            <h4>{SECTIONS.find((x) => x.id === flyout).label}</h4>
            {SECTIONS.find((x) => x.id === flyout).screens.map((x) => (
              <NavLink key={x.to} to={x.to} onClick={() => setFlyout(null)}
                className={({ isActive }) => (isActive ? 'on' : '')}>
                {x.label}
                {x.badge && counts[x.badge] > 0 && <span className="count">{counts[x.badge]}</span>}
              </NavLink>
            ))}
          </div>
        )}
      </nav>

      <div className="main">
        <header className="top">
          <span className="brand">AJ Power Solutions</span>
          <span className="sp" />
          <label className="who" htmlFor="branch">Branch</label>
          <select id="branch" value={branchId || ''} onChange={(e) => setBranch(Number(e.target.value))}>
            {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
          {/* No login yet — this only decides whose name goes on a document. */}
          <label className="who" htmlFor="who">Working as</label>
          <select id="who" value={me?.id || ''}
            onChange={(e) => { setUserId(Number(e.target.value)); window.location.reload(); }}>
            {users.map((u) => <option key={u.id} value={u.id}>{u.name} · {u.department}</option>)}
          </select>
        </header>

        <nav className="tabs" aria-label={`${section.label} options`}>
          <span className="dept">{section.label}</span>
          {section.screens.map((x) => (
            <NavLink key={x.to} to={x.to} className={({ isActive }) => (isActive ? 'on' : '')}>
              {x.label}
              {x.badge && counts[x.badge] > 0 && <span className="count">{counts[x.badge]}</span>}
            </NavLink>
          ))}
        </nav>

        <div className="page">{children}</div>
      </div>
    </div>
  );
}

export const PageHead = ({ title, sub, actions }) => (
  <div className="page-head">
    <div><h1>{title}</h1>{sub && <p>{sub}</p>}</div>
    <div className="sp" />
    {actions}
  </div>
);

export default function App() {
  const [boot, setBoot] = useState({ loading: true });
  const [branchId, setBranchId] = useState(Number(localStorage.getItem('ajp.branchId')) || null);
  const [desk, setDesk] = useState(null);

  useEffect(() => {
    Promise.all([api.get('/masters/branches'), api.get('/users'), api.get('/whoami')])
      .then(([branches, users, me]) => {
        if (!getUserId() && me?.id) setUserId(me.id);
        setBoot({ loading: false, branches, users, me });
        setBranchId((b) => b || branches[0]?.id || null);
      })
      .catch((error) => setBoot({ loading: false, error }));
  }, []);

  // counts for the tab badges: an amendment that is due should be
  // visible from wherever you happen to be standing
  const refreshDesk = useCallback(() => {
    if (!branchId) return;
    api.get(`/progress/desk?branchId=${branchId}`).then(setDesk).catch(() => setDesk(null));
  }, [branchId]);
  useEffect(refreshDesk, [refreshDesk]);

  if (boot.loading) return <Loading />;
  if (boot.error) {
    return (
      <div style={{ maxWidth: 560, margin: '80px auto' }}>
        <ErrorNote
          error={{ message: `Can't reach the API. Is it running on :4000? (${boot.error.message})` }}
          onRetry={() => window.location.reload()} />
      </div>
    );
  }

  const setBranch = (id) => { setBranchId(id); localStorage.setItem('ajp.branchId', String(id)); };

  return (
    <AppCtx.Provider value={{ ...boot, branchId, setBranch, desk, refreshDesk }}>
      <ToastHost>
        <BrowserRouter>
          <Shell>
            <Routes>
              <Route path="/" element={<Navigate to="/sites" replace />} />
              <Route path="/sites" element={<Sites />} />
              <Route path="/sites/new" element={<NewSite />} />
              <Route path="/sites/:id" element={<SiteDetail />} />
              <Route path="/stores" element={<Stores />} />
              <Route path="/boq" element={<BoqList />} />
              <Route path="/amendments" element={<Amendments />} />
              <Route path="/items" element={<Items />} />
              <Route path="/indents" element={<Indents />} />
              <Route path="/indents/new" element={<IndentCart />} />
              <Route path="/indents/:id" element={<IndentDetail />} />
              <Route path="/indents/:id/edit" element={<IndentCart />} />
              <Route path="/consumption" element={<Consumption />} />
              <Route path="*" element={<div className="page-body"><p>No such page.</p></div>} />
            </Routes>
          </Shell>
        </BrowserRouter>
      </ToastHost>
    </AppCtx.Provider>
  );
}
