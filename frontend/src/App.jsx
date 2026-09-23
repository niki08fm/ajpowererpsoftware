import { createContext, useContext, useCallback, useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, NavLink, Navigate, useLocation } from 'react-router-dom';
import { api, setToken, getToken, whenSignedOut, setWrites } from './api';
import { ToastHost, Loading, ErrorNote, Field, Modal, useToast } from './components/ui';
import { Chooser } from './pages/Choose';
import { Approvals, Decided } from './pages/Approvals';

import Sites from './pages/Sites';
import NewSite from './pages/NewSite';
import SiteDetail from './pages/SiteDetail';
import Stores from './pages/Stores';
import Items from './pages/Items';
import Clients from './pages/Clients';
import Procurement from './pages/Procurement';
import Suppliers from './pages/Suppliers';
import { PurchaseOrders, PurchaseOrderDetail } from './pages/PurchaseOrders';
import { Comparisons, ComparisonDetail } from './pages/Comparisons';
import { Prns, IssueSheet, Stock, Movements } from './pages/Store';
import { Grns, GrnRegister, GrnDetail } from './pages/Grns';
import { SiteInbox, SiteStock } from './pages/SiteStore';
import { IssueStock, ReturnStock } from './pages/Consumption';
import { Transactions, Audit, Consumed } from './pages/Tracking';
import Expenses from './pages/Expenses';
import { ExpenseReport, ProfitLoss } from './pages/Reports';
import { Billing, BillingSheet, Bills } from './pages/Billing';
import { Challans, ChallanDetail } from './pages/Challans';
import BoqList from './pages/BoqList';
import Indents from './pages/Indents';
import { SiteTransfers, SentAndReorder, SourceFromSitePage, StoreTransfers } from './pages/Transfers';
import IndentCart from './pages/IndentCart';
import IndentDetail from './pages/IndentDetail';
import Login from './pages/Login';
import Users from './pages/Users';

const AppCtx = createContext(null);
export const useApp = () => useContext(AppCtx);

/**
 * Navigation: one sidebar, and nothing else.
 *
 * The old shell split the job in two — a rail of departments and a row
 * of tabs underneath — which meant the options for a department were
 * only visible once you were already inside it, and the screen you
 * wanted was two clicks and a guess away. Everything now lives in the
 * sidebar: the department, and every option under it, in one list you
 * can see at once.
 *
 * Each department carries a handful of options people use daily and,
 * behind "More", the ones they use monthly. That is where the clutter
 * went — nothing was deleted and every route still answers, but a
 * department opens showing five rows rather than twelve.
 *
 * The chevron by the logo halves the sidebar to icons. Collapsed, a
 * department's options arrive as a flyout on hover, so the shortest
 * width is still fully navigable.
 *
 * Accounts is named and greyed rather than hidden, so the shape of the
 * whole system is legible from day one.
 */
export const SECTIONS = [
  {
    id: 'approvals',
    label: 'Approvals',
    icon: '✓',
    screens: [
      { to: '/approvals', label: 'Waiting on me', badge: 'approvals', end: true },
      { to: '/approvals/decided', label: 'Decided by me' },
    ],
  },
  {
    id: 'plan',
    label: 'Planning',
    icon: '▤',
    screens: [
      { to: '/sites', label: 'Sites' },
      { to: '/boq', label: 'BOQ', badge: 'amendmentDue' },
      { to: '/clients', label: 'Clients' },
      { to: '/stores', label: 'Stores', more: true },
      { to: '/items', label: 'Item master', more: true },
    ],
  },
  {
    id: 'site',
    label: 'Site',
    icon: '◍',
    screens: [
      { to: '/indents', label: 'Indents', badge: 'indentsWaiting' },
      { to: '/site/inbox', label: 'Acknowledgements' },
      { to: '/site/stock', label: 'Site store' },
      { to: '/site/issue', label: 'Issue material' },
      { to: '/site/expenses', label: 'Expenses', badge: 'expensesWaiting' },
      { to: '/site/transfers', label: 'Transfers out', more: true },
      { to: '/site/sent', label: 'Sent & reorder', more: true },
      { to: '/site/returns', label: 'Returns', more: true },
      { to: '/site/transactions', label: 'Transactions', more: true },
      { to: '/site/consumption', label: 'Consumption', more: true },
      { to: '/site/audit', label: 'Audit', more: true },
    ],
  },
  {
    id: 'store',
    label: 'Store',
    icon: '▥',
    screens: [
      { to: '/store/prns', label: 'PRNs to fulfil' },
      { to: '/grns', label: 'Receive (GRN)', end: true },
      { to: '/grns/register', label: 'GRN register', more: true },
      { to: '/challans', label: 'Challans' },
      { to: '/stock', label: 'Stock' },
      { to: '/store/transfers', label: 'Transfer requests', more: true },
      { to: '/movements', label: 'Movement', more: true },
      { to: '/items', label: 'Item master', more: true },
      // reached from a PRN, never from the menu
      { to: '/store/issue', label: 'Issue sheet', hidden: true },
      { to: '/store/source', label: 'Source from a site', hidden: true },
    ],
  },
  {
    id: 'procure',
    label: 'Procure',
    icon: '◆',
    screens: [
      { to: '/procurement', label: 'To buy' },
      { to: '/comparisons', label: 'Rate comparison' },
      { to: '/purchase-orders', label: 'Orders' },
      { to: '/suppliers', label: 'Suppliers', more: true },
    ],
  },
  {
    id: 'billing',
    label: 'Billing',
    icon: '₹',
    screens: [
      { to: '/billing', label: 'Bill a site', end: true },
      { to: '/billing/bills', label: 'Bills' },
    ],
  },
  {
    id: 'reports',
    label: 'Reports',
    icon: '☷',
    screens: [
      { to: '/reports/expense', label: 'Expense report' },
      { to: '/reports/pl', label: 'Profit and loss' },
    ],
  },
  {
    id: 'admin',
    label: 'Logins',
    icon: '⚿',
    screens: [
      { to: '/admin/users', label: 'Users & access' },
    ],
  },
];

/**
 * What each login is shown.
 *
 * A department sees its own department, all of it. Management and the
 * General Manager oversee: every department, but the screens that show
 * the work rather than the ones that do it — nobody overseeing raises
 * an indent or issues material. The server holds the same line
 * (backend/src/lib/access.js); this only decides what is drawn.
 *
 * `all` is every screen of the section; a list names the ones shown.
 */
const OVERSEE = {
  approvals: 'all',
  plan: ['/sites', '/boq', '/clients'],
  site: ['/indents', '/site/inbox', '/site/stock', '/site/expenses', '/site/transactions',
    '/site/consumption', '/site/audit', '/site/sent'],
  // '/grns' itself is the receiving form; it is here so a GRN opened
  // from the register still has somewhere to belong
  store: ['/store/prns', '/grns', '/grns/register', '/challans', '/stock', '/movements',
    '/store/transfers'],
  procure: 'all',
  billing: 'all',
  reports: 'all',
};
const MENU = {
  Management: { ...OVERSEE, admin: 'all' },
  'General Manager': OVERSEE,
  Planning: { plan: 'all' },
  // the site answers transfer requests from its Approvals
  Site: { approvals: 'all', site: 'all' },
  Store: { store: 'all' },
  Procurement: { procure: 'all' },
  Billing: { billing: 'all' },
};
// open to an overseer by path, but they are forms for doing the work
const DOING = [/^\/indents\/new/, /\/edit$/, /^\/sites\/new/, /^\/site\/(issue|returns|transfers)/,
  /^\/store\/(issue|source)/, /^\/grns$/];

export function menuFor(access) {
  const pick = MENU[access?.role] || {};
  return SECTIONS.filter((sec) => pick[sec.id]).map((sec) => {
    const want = pick[sec.id];
    let screens = want === 'all' ? sec.screens : sec.screens.filter((x) => want.includes(x.to));
    // chosen for an overseer: nothing hides behind More, and a form for
    // doing the work stays off the menu
    if (want !== 'all') {
      screens = screens.map((x) => ({ ...x, more: false,
        hidden: x.hidden || DOING.some((re) => re.test(x.to)) }));
    }
    // issuing is the store keeper's, so only a keeper is offered it
    if (sec.id === 'site' && !(access.keeperOf || []).length) {
      screens = screens.filter((x) => x.to !== '/site/issue');
    }
    return { ...sec, screens };
  });
}

/** May this login open this path at all? */
const reachable = (sections, access, pathname) => {
  // these only redirect to the login's first screen
  if (pathname === '/' || pathname.startsWith('/desk/')) return true;
  if (access?.overseer && DOING.some((re) => re.test(pathname))) return false;
  return sections.some((sec) => sec.screens.some((x) => pathname === x.to
    || pathname.startsWith(`${x.to}/`) || (!x.end && pathname.startsWith(x.to))));
};

export const SOON = [
  { id: 'accounts', label: 'Accounts', icon: '◎' },
];

/**
 * Which department's options to open.
 *
 * Normally the path decides. The item master is the exception: it
 * belongs to Planning, which reads it, and to Store, which is the only
 * department allowed to add to it — one screen under two headings. So
 * a link can say which department it was clicked from, and that wins
 * over the path when it is a department the screen really lives in.
 */
const sectionFor = (sections, pathname, from) =>
  (from && sections.find((s) => s.id === from
    && s.screens.some((x) => pathname.startsWith(x.to))))
  || sections.find((s) => s.screens.some((x) => pathname.startsWith(x.to)))
  || sections[0];

const screenFor = (section, pathname) =>
  [...section.screens].sort((a, b) => b.to.length - a.to.length)
    .find((x) => pathname.startsWith(x.to));

/* ------------------------------------------------------------ theme
   Light or dark, remembered, and applied to <html> so the sheet's
   .dark block takes over. Nothing else in the app has to know. */
const useTheme = () => {
  const [dark, setDark] = useState(() => localStorage.getItem('ajp.theme') === 'dark');
  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
    localStorage.setItem('ajp.theme', dark ? 'dark' : 'light');
  }, [dark]);
  return [dark, setDark];
};

/** One department in the sidebar: the heading, its options, and More. */
function NavGroup({ section, active, open, onToggle, counts, mini }) {
  const [showMore, setShowMore] = useState(false);
  const listed = section.screens.filter((x) => !x.hidden);
  const daily = listed.filter((x) => !x.more);
  const rest = listed.filter((x) => x.more);
  const total = section.screens.reduce((a, x) => a + (x.badge ? counts[x.badge] || 0 : 0), 0);
  // an option behind More that is the one you are on must still show
  const shown = [...daily, ...(showMore ? rest : rest.filter((x) => active && x.to === active.to))];

  const item = (x, onClick) => (
    <NavLink key={x.to} to={x.to} end={x.end} state={{ dept: section.id }} onClick={onClick}
      className={({ isActive }) => (isActive ? 'on' : '')}>
      <span>{x.label}</span>
      <span className="sp" />
      {x.badge && counts[x.badge] > 0 && <span className="count">{counts[x.badge]}</span>}
    </NavLink>
  );

  return (
    <div className="nav-group">
      <button type="button" className={`nav-sec ${open ? 'open' : ''} ${active ? 'on' : ''}`}
        onClick={onToggle} aria-expanded={open} title={section.label}>
        <i aria-hidden="true">{section.icon}</i>
        <span className="label">{section.label}</span>
        {total > 0 && <span className="count">{total}</span>}
        <span className="chev" aria-hidden="true">{'▶'}</span>
      </button>

      {open && !mini && (
        <div className="nav-items">
          {shown.map((x) => item(x))}
          {rest.length > 0 && (
            <button type="button" className="nav-more" onClick={() => setShowMore((v) => !v)}>
              {showMore ? '− Less' : `+ ${rest.length} more`}
            </button>
          )}
        </div>
      )}

      {/* collapsed: everything, on hover, without expanding the sidebar */}
      <div className="flyout">
        <h4>{section.label}</h4>
        {listed.map((x) => item(x))}
      </div>
    </div>
  );
}

function Shell({ children }) {
  const outer = useApp();
  const {
    branches, branchSel, setBranch, allStores, storeId, setStore,
    allSites, siteId, setSite, user, access, sections, signOut, desk, approvalsWaiting,
  } = outer;
  const { pathname, state } = useLocation();
  const section = sectionFor(sections, pathname, state?.dept);
  const [pwOpen, setPwOpen] = useState(false);
  const screen = screenFor(section, pathname);
  const [dark, setDark] = useTheme();

  const [mini, setMini] = useState(() => localStorage.getItem('ajp.nav') === 'mini');
  const toggleMini = () => setMini((v) => {
    localStorage.setItem('ajp.nav', v ? 'wide' : 'mini');
    return !v;
  });

  // the department you are in is open; opening another closes it, so
  // the sidebar stays one screen tall however many departments exist
  const [openId, setOpenId] = useState(section.id);
  useEffect(() => { setOpenId(section.id); }, [section.id]);

  const site = section.id === 'site' ? allSites.find((x) => x.id === siteId) : null;
  const store = section.id === 'store' ? allStores.find((x) => x.id === storeId) : null;
  const choosing = (section.id === 'site' && !site) || (section.id === 'store' && !store);

  const branchId =
    section.id === 'site' ? (site?.branch.id ?? null)
      : section.id === 'store' ? (store?.branch_id ?? null)
        : (branchSel === 'ALL' ? null : branchSel);

  const inner = {
    ...outer,
    branchId,
    // true only where the picker really is on every branch; the Site and
    // Store departments are never "all", they are one site or one store
    allBranches: !['site', 'store'].includes(section.id) && branchSel === 'ALL',
    siteId: site ? site.id : outer.siteId,
    site,
    store,
    stores: branchId ? allStores.filter((x) => x.branch_id === branchId) : allStores,
  };
  const counts = {
    amendmentDue: desk?.amendmentDue?.length || 0,
    indentsWaiting: desk?.indentsWaiting?.length || 0,
    expensesWaiting: desk?.expensesWaiting || 0,
    approvals: approvalsWaiting || 0,
  };

  return (
    <div className={`shell ${mini ? 'mini' : ''}`}>
      <nav className="nav" aria-label="Everything in the system">
        <div className="nav-head">
          <div className="mark">AJ</div>
          {!mini && (
            <>
              <div className="who-we">
                <b>AJ Power</b>
                <span>Solutions ERP</span>
              </div>
              <div className="sp" />
            </>
          )}
          <button type="button" className="nav-toggle" onClick={toggleMini}
            title={mini ? 'Widen the menu' : 'Shrink the menu'}
            aria-label={mini ? 'Widen the menu' : 'Shrink the menu'}>
            {mini ? '»' : '«'}
          </button>
        </div>

        <div className="nav-scroll">
          {sections.map((s) => (
            <NavGroup key={s.id} section={s} mini={mini}
              active={s.id === section.id ? (screen || s.screens[0]) : null}
              open={openId === s.id}
              onToggle={() => setOpenId((cur) => (cur === s.id ? null : s.id))}
              counts={counts} />
          ))}

          {access.overseer && SOON.map((d) => (
            <div key={d.id} className="nav-group">
              <div className="nav-sec soon" title={`${d.label} — not built yet`}>
                <i aria-hidden="true">{d.icon}</i>
                <span className="label">{d.label}</span>
                <span className="chev" style={{ opacity: .4 }}>soon</span>
              </div>
            </div>
          ))}
        </div>

        <div className="nav-foot">
          <button type="button" className="nav-sec" onClick={() => setDark((v) => !v)}
            title={dark ? 'Light theme' : 'Dark theme'}>
            <i aria-hidden="true">{dark ? '◑' : '◐'}</i>
            <span className="label">{dark ? 'Light theme' : 'Dark theme'}</span>
          </button>
        </div>
      </nav>

      <div className="main">
        <header className="top">
          <div className="crumb">
            <b>{section.label}</b>
            {screen && <span>{'›'} {screen.label}</span>}
            {access.overseer && !['approvals', 'admin'].includes(section.id) && (
              <span className="tag brand" title="You oversee this department; its own team does the work">View only</span>
            )}
          </div>
          <span className="sp" />
          {section.id === 'site' && site && (
            <>
              <label className="who" htmlFor="site">Site</label>
              <select id="site" value={site.id}
                onChange={(e) => setSite(Number(e.target.value))}>
                {branches.map((b) => {
                  const here = allSites.filter((x) => x.branch.id === b.id);
                  return here.length ? (
                    <optgroup key={b.id} label={b.name}>
                      {here.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                    </optgroup>
                  ) : null;
                })}
              </select>
              <button type="button" className="top-btn" onClick={() => setSite(null)}
                title="See every site as cards">All sites</button>
            </>
          )}
          {section.id === 'store' && store && (
            <>
              <label className="who" htmlFor="store">Store</label>
              <select id="store" value={store.id}
                onChange={(e) => setStore(Number(e.target.value))}>
                {branches.map((b) => {
                  const here = allStores.filter((x) => x.branch_id === b.id);
                  return here.length ? (
                    <optgroup key={b.id} label={b.name}>
                      {here.map((x) => (
                        <option key={x.id} value={x.id}>
                          {x.name}{x.is_central ? ' · central' : ''}
                        </option>
                      ))}
                    </optgroup>
                  ) : null;
                })}
              </select>
              <button type="button" className="top-btn" onClick={() => setStore(null)}
                title="See every store as cards">All stores</button>
            </>
          )}
          {!['site', 'store'].includes(section.id) && (
            <>
              <label className="who" htmlFor="branch">Branch</label>
              <select id="branch" value={branchSel ?? ''}
                onChange={(e) => setBranch(e.target.value === 'ALL' ? 'ALL' : Number(e.target.value))}>
                <option value="ALL">All branches</option>
                {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </>
          )}
          <div className="me" title={user.email}>
            <b>{user.name}</b>
            <span>{user.department}</span>
          </div>
          <button type="button" className="top-btn" onClick={() => setPwOpen(true)}>Password</button>
          <button type="button" className="top-btn" onClick={signOut}>Sign out</button>
        </header>
        {pwOpen && <PasswordForm onClose={() => setPwOpen(false)} />}

        <div className="page">
          <AppCtx.Provider value={inner}>
            {!reachable(sections, access, pathname)
              ? <NotYours home={sections[0]?.screens[0]?.to || '/'} />
              : choosing
              ? <Chooser kind={section.id} sites={allSites} stores={allStores} branches={branches}
                  onPick={(id) => (section.id === 'site' ? setSite(id) : setStore(id))} />
              : children}
          </AppCtx.Provider>
        </div>
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

/** Somewhere this login does not go. */
function NotYours({ home }) {
  return (
    <div className="page-body">
      <div className="empty">
        <b>Not part of your login</b>
        This screen belongs to another department.{' '}
        <NavLinkHome to={home} />
      </div>
    </div>
  );
}
const NavLinkHome = ({ to }) => <NavLink to={to}>Go to your first screen</NavLink>;

/** Change your own password. */
function PasswordForm({ onClose }) {
  const toast = useToast();
  const [f, setF] = useState({ current: '', next: '', again: '' });
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (f.next.length < 8) return toast('At least 8 characters', 'bad');
    if (f.next !== f.again) return toast('The two new passwords are not the same', 'bad');
    setBusy(true);
    try {
      await api.post('/auth/password', { current: f.current, next: f.next });
      toast('Password changed — other sessions are signed out', 'ok');
      onClose();
    } catch (e) { toast(e.message, 'bad'); } finally { setBusy(false); }
  };
  const inp = (k, label) => (
    <Field label={label}>
      <input className="inp" type="password" value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} />
    </Field>
  );
  return (
    <Modal title="Change your password" onClose={onClose}
      footer={<>
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn pri" onClick={save} disabled={busy || !f.current || !f.next}>Change it</button>
      </>}>
      {inp('current', 'Current password')}
      {inp('next', 'New password')}
      {inp('again', 'New password again')}
    </Modal>
  );
}

/**
 * Signed in, or not. Everything else waits on this: until the server
 * has said who this is and what they may do, there is nothing to draw.
 */
export default function App() {
  const [auth, setAuth] = useState(() => (getToken() ? { checking: true } : { out: true }));

  const signedIn = useCallback(({ user, access }) => {
    setWrites(access.writes);
    setAuth({ user, access });
  }, []);

  useEffect(() => {
    whenSignedOut(() => setAuth({ out: true, ended: true }));
    if (!getToken()) return;
    api.get('/auth/me').then(signedIn)
      .catch((e) => setAuth(e.status === 401 ? { out: true, ended: true } : { out: true, error: e }));
  }, [signedIn]);

  const signOut = useCallback(() => {
    api.post('/auth/logout').catch(() => {}).finally(() => {
      setToken(null);
      setWrites([]);
      setAuth({ out: true });
    });
  }, []);

  if (auth.checking) return <Loading />;
  if (auth.out) {
    return (
      <ToastHost>
        <Login ended={auth.ended} onSignedIn={signedIn} />
      </ToastHost>
    );
  }
  // a fresh App per person, so nothing of the last login's state survives
  return <Workspace key={auth.user.id} user={auth.user} access={auth.access} signOut={signOut} />;
}

function Workspace({ user, access, signOut }) {
  const sections = menuFor(access);
  const home = sections[0]?.screens[0]?.to || '/approvals';
  const [boot, setBoot] = useState({ loading: true });
  // the branch picker: a branch id, or 'ALL'. Remembered.
  const [branchSel, setBranchSel] = useState(() => {
    const v = localStorage.getItem('ajp.branchId');
    return v === 'ALL' ? 'ALL' : (Number(v) || null);
  });
  const [storeId, setStoreId] = useState(Number(localStorage.getItem('ajp.storeId')) || null);
  const [siteId, setSiteId] = useState(Number(localStorage.getItem('ajp.siteId')) || null);
  const [allStores, setAllStores] = useState([]);
  const [allSites, setAllSites] = useState([]);
  const [desk, setDesk] = useState(null);
  // what is waiting on the Working-as person: the badge on Approvals
  const [approvalsWaiting, setApprovalsWaiting] = useState(0);
  const refreshApprovals = useCallback(() => {
    api.get('/approvals/count').then((r) => setApprovalsWaiting(r.waiting))
      .catch(() => setApprovalsWaiting(0));
  }, []);
  useEffect(refreshApprovals, [refreshApprovals]);

  useEffect(() => {
    Promise.all([api.get('/masters/branches'), api.get('/users')])
      .then(([branches, users]) => {
        setBoot({ loading: false, branches, users, me: user });
        setBranchSel((b) => b || branches[0]?.id || null);
      })
      .catch((error) => setBoot({ loading: false, error }));
  }, []);

  // Every site and every store, across every branch. The Site and Store
  // departments open on a chooser of these, and the branch follows from
  // the one picked. A remembered choice that has since closed is dropped
  // rather than trusted, so the chooser shows instead of a dead page.
  const loadPlaces = useCallback(() => {
    api.get('/sites').then((rows) => {
      setAllSites(rows);
      // somebody on exactly one site has nothing to choose
      setSiteId((cur) => (rows.some((r) => r.id === cur) ? cur
        : rows.length === 1 ? rows[0].id : null));
    }).catch(() => setAllSites([]));
    api.get('/store/stores').then((rows) => {
      setAllStores(rows);
      setStoreId((cur) => (rows.some((r) => r.id === cur) ? cur
        : rows.length === 1 ? rows[0].id : null));
    }).catch(() => setAllStores([]));
  }, []);
  useEffect(loadPlaces, [loadPlaces]);

  // counts for the tab badges: an amendment that is due should be
  // visible from wherever you happen to be standing. On every branch
  // they are counted across every branch.
  const refreshDesk = useCallback(() => {
    if (!branchSel) return;
    api.get(`/progress/desk${branchSel === 'ALL' ? '' : `?branchId=${branchSel}`}`)
      .then(setDesk).catch(() => setDesk(null));
  }, [branchSel]);
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

  const remember = (key, v) => {
    if (v == null) localStorage.removeItem(key); else localStorage.setItem(key, String(v));
  };
  const setBranch = (v) => { setBranchSel(v); remember('ajp.branchId', v); };
  const setStore = (id) => { setStoreId(id); remember('ajp.storeId', id); };
  const setSite = (id) => { setSiteId(id); remember('ajp.siteId', id); };

  return (
    <AppCtx.Provider value={{
      ...boot,
      // outside the Shell there is no department yet, so the branch is
      // simply what the picker says; Shell re-provides the effective one
      branchSel, setBranch, branchId: branchSel === 'ALL' ? null : branchSel,
      storeId, setStore, siteId, setSite,
      allStores, allSites, stores: allStores, loadPlaces,
      desk, refreshDesk, approvalsWaiting, refreshApprovals,
      user, access, sections, signOut,
    }}>
      <ToastHost>
        <BrowserRouter>
          <Shell>
            <Routes>
              <Route path="/" element={<Navigate to={home} replace />} />
              {/* The department overview desks are parked, not deleted:
                  pages/Desk.jsx and the /desk API are still here, and
                  bringing them back is this route and one nav row each.
                  Approvals is the landing screen while they are away. */}
              {['plan', 'site', 'store', 'procure', 'billing', 'reports'].map((d) => (
                <Route key={d} path={`/desk/${d}`}
                  element={<Navigate to={home} replace />} />
              ))}
              <Route path="/approvals" element={<Approvals />} />
              <Route path="/approvals/decided" element={<Decided />} />
              <Route path="/sites" element={<Sites />} />
              <Route path="/sites/new" element={<NewSite />} />
              <Route path="/sites/:id" element={<SiteDetail />} />
              <Route path="/stores" element={<Stores />} />
              <Route path="/boq" element={<BoqList />} />
              <Route path="/items" element={<Items />} />
              <Route path="/clients" element={<Clients />} />
              <Route path="/store" element={<Navigate to="/store/prns" replace />} />
              <Route path="/store/prns" element={<Prns />} />
              <Route path="/store/source" element={<SourceFromSitePage />} />
              <Route path="/store/transfers" element={<StoreTransfers />} />
              <Route path="/store/issue" element={<IssueSheet />} />
              <Route path="/grns" element={<Grns />} />
              <Route path="/grns/register" element={<GrnRegister />} />
              <Route path="/grns/:id" element={<GrnDetail />} />
              <Route path="/stock" element={<Stock />} />
              <Route path="/movements" element={<Movements />} />
              <Route path="/challans" element={<Challans />} />
              <Route path="/challans/new" element={<Navigate to="/store/prns" replace />} />
              <Route path="/challans/:id" element={<ChallanDetail />} />
              <Route path="/site/inbox" element={<SiteInbox />} />
              <Route path="/site/stock" element={<SiteStock />} />
              <Route path="/site/transfers" element={<SiteTransfers />} />
              <Route path="/site/sent" element={<SentAndReorder />} />
              <Route path="/site/issue" element={<IssueStock />} />
              <Route path="/site/returns" element={<ReturnStock />} />
              <Route path="/site/transactions" element={<Transactions />} />
              <Route path="/site/audit" element={<Audit />} />
              <Route path="/site/consumption" element={<Consumed />} />
              <Route path="/site/expenses" element={<Expenses />} />
              <Route path="/billing" element={<Billing />} />
              <Route path="/billing/bills" element={<Bills />} />
              <Route path="/billing/site/:siteId" element={<BillingSheet />} />
              <Route path="/reports/expense" element={<ExpenseReport />} />
              <Route path="/reports/pl" element={<ProfitLoss />} />
              {/* these lived under Reports for a day; keep the links working */}
              <Route path="/reports" element={<Navigate to="/reports/expense" replace />} />
              <Route path="/reports/consumption"
                element={<Navigate to="/site/consumption" replace />} />
              <Route path="/reports/transactions"
                element={<Navigate to="/site/transactions" replace />} />
              <Route path="/reports/audit" element={<Navigate to="/site/audit" replace />} />
              <Route path="/procurement" element={<Procurement />} />
              <Route path="/comparisons" element={<Comparisons />} />
              <Route path="/comparisons/:id" element={<ComparisonDetail />} />
              <Route path="/purchase-orders" element={<PurchaseOrders />} />
              <Route path="/purchase-orders/:id" element={<PurchaseOrderDetail />} />
              <Route path="/suppliers" element={<Suppliers />} />
              <Route path="/indents" element={<Indents />} />
              <Route path="/indents/new" element={<IndentCart />} />
              <Route path="/indents/:id" element={<IndentDetail />} />
              <Route path="/indents/:id/edit" element={<IndentCart />} />
              <Route path="/admin/users" element={<Users />} />
              <Route path="*" element={<div className="page-body"><p>No such page.</p></div>} />
            </Routes>
          </Shell>
        </BrowserRouter>
      </ToastHost>
    </AppCtx.Provider>
  );
}
