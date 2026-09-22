import { createContext, useContext, useCallback, useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, NavLink, Navigate, useLocation } from 'react-router-dom';
import { api, setUserId, getUserId } from './api';
import { ToastHost, Loading, ErrorNote, useApi } from './components/ui';
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
      { to: '/grns', label: 'Receive (GRN)' },
      { to: '/challans', label: 'Challans' },
      { to: '/stock', label: 'Stock' },
      { to: '/store/transfers', label: 'Transfer requests', more: true },
      { to: '/movements', label: 'Movement', more: true },
      { to: '/items', label: 'Item master', more: true },
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
];

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
const sectionFor = (pathname, from) =>
  (from && SECTIONS.find((s) => s.id === from
    && s.screens.some((x) => pathname.startsWith(x.to))))
  || SECTIONS.find((s) => s.screens.some((x) => pathname.startsWith(x.to)))
  || SECTIONS[0];

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
  const daily = section.screens.filter((x) => !x.more);
  const rest = section.screens.filter((x) => x.more);
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
        {section.screens.map((x) => item(x))}
      </div>
    </div>
  );
}

function Shell({ children }) {
  const outer = useApp();
  const {
    branches, branchSel, setBranch, allStores, storeId, setStore,
    allSites, siteId, setSite, users, me, desk, approvalsWaiting,
  } = outer;
  const { pathname, state } = useLocation();
  const section = sectionFor(pathname, state?.dept);
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
          {SECTIONS.map((s) => (
            <NavGroup key={s.id} section={s} mini={mini}
              active={s.id === section.id ? (screen || s.screens[0]) : null}
              open={openId === s.id}
              onToggle={() => setOpenId((cur) => (cur === s.id ? null : s.id))}
              counts={counts} />
          ))}

          {SOON.map((d) => (
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
          {/* No login yet — this only decides whose name goes on a document. */}
          <label className="who" htmlFor="who">Working as</label>
          <select id="who" value={me?.id || ''}
            onChange={(e) => { setUserId(Number(e.target.value)); window.location.reload(); }}>
            {users.map((u) => <option key={u.id} value={u.id}>{u.name} · {u.department}</option>)}
          </select>
        </header>

        <div className="page">
          <AppCtx.Provider value={inner}>
            {choosing
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

export default function App() {
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
    Promise.all([api.get('/masters/branches'), api.get('/users'), api.get('/whoami')])
      .then(([branches, users, me]) => {
        if (!getUserId() && me?.id) setUserId(me.id);
        setBoot({ loading: false, branches, users, me });
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
      setSiteId((cur) => (rows.some((r) => r.id === cur) ? cur : null));
    }).catch(() => setAllSites([]));
    api.get('/store/stores').then((rows) => {
      setAllStores(rows);
      setStoreId((cur) => (rows.some((r) => r.id === cur) ? cur : null));
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
    }}>
      <ToastHost>
        <BrowserRouter>
          <Shell>
            <Routes>
              <Route path="/" element={<Navigate to="/approvals" replace />} />
              {/* The department overview desks are parked, not deleted:
                  pages/Desk.jsx and the /desk API are still here, and
                  bringing them back is this route and one nav row each.
                  Approvals is the landing screen while they are away. */}
              {['plan', 'site', 'store', 'procure', 'billing', 'reports'].map((d) => (
                <Route key={d} path={`/desk/${d}`}
                  element={<Navigate to="/approvals" replace />} />
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
              <Route path="*" element={<div className="page-body"><p>No such page.</p></div>} />
            </Routes>
          </Shell>
        </BrowserRouter>
      </ToastHost>
    </AppCtx.Provider>
  );
}
