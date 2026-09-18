import { createContext, useContext, useCallback, useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, NavLink, Navigate, Outlet, useNavigate, useParams } from 'react-router-dom';
import { api, setUserId, getUserId, setDept } from './api';
import { ToastHost, Loading, ErrorNote, useApi } from './components/ui';

import Login from './pages/Login';
import Sites from './pages/Sites';
import NewSite from './pages/NewSite';
import SiteDetail from './pages/SiteDetail';
import Stores from './pages/Stores';
import Items from './pages/Items';
import Clients from './pages/Clients';
import { SiteTransfers, SentAndReorder, SourceFromSitePage, StoreTransfers } from './pages/Transfers';
import Procurement from './pages/Procurement';
import Suppliers from './pages/Suppliers';
import { PurchaseOrders, PurchaseOrderDetail } from './pages/PurchaseOrders';
import { Comparisons, ComparisonDetail } from './pages/Comparisons';
import { StoreDesk, Prns, IssueSheet, Stock, Movements } from './pages/Store';
import { Grns, GrnRegister, GrnDetail } from './pages/Grns';
import { SiteInbox, SiteStock } from './pages/SiteStore';
import { IssueStock, ReturnStock } from './pages/Consumption';
import { Transactions, Audit, Consumed } from './pages/Tracking';
import Expenses from './pages/Expenses';
import { ExpenseReport, ProfitLoss } from './pages/Reports';
import { Billing, BillingSheet, Bills } from './pages/Billing';
import { Challans, ChallanDetail } from './pages/Challans';
import BoqList from './pages/BoqList';
import { Indents, IndentCart, IndentDetail } from './pages/Indents';

const AppCtx = createContext(null);
export const useApp = () => useContext(AppCtx);

export const PageHead = ({ title, sub, actions }) => (
  <div className="page-head">
    <div><h1>{title}</h1>{sub && <p>{sub}</p>}</div>
    <div className="sp" />
    {actions}
  </div>
);

/* =================================================================
   PrivateRoute — redirects to /login if no user is selected
   ================================================================= */
function PrivateRoute({ children }) {
  const id = getUserId();
  if (!id) return <Navigate to="/login" replace />;
  return children;
}

/* =================================================================
   Shared top bar used by both dept shells
   ================================================================= */
function DeptTopBar({ branchId, branches, setBranch, me, showStore, stores, storeId, setStore, showSite, sites, siteId, setSite }) {
  const nav = useNavigate();
  const handleChangeUser = () => {
    setUserId(null);
    setDept(null);
    localStorage.removeItem('ajp.userId');
    localStorage.removeItem('ajp.dept');
    nav('/login');
  };

  return (
    <header className="top">
      <span className="brand">AJ Power Solutions</span>
      <span className="sp" />
      <label className="who" htmlFor="dept-branch">Branch</label>
      <select id="dept-branch" value={branchId || ''} onChange={(e) => setBranch(Number(e.target.value))}>
        {(branches || []).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
      </select>
      {showSite && sites?.length > 0 && (
        <>
          <label className="who" htmlFor="dept-site">Site</label>
          <select id="dept-site" value={siteId || ''} onChange={(e) => setSite(Number(e.target.value))}>
            {sites.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </>
      )}
      {showStore && stores?.length > 0 && (
        <>
          <label className="who" htmlFor="dept-store">Store</label>
          <select id="dept-store" value={storeId || ''} onChange={(e) => setStore(Number(e.target.value))}>
            {stores.map((st) => (
              <option key={st.id} value={st.id}>
                {st.name}{st.is_central ? ' · central' : ''}
              </option>
            ))}
          </select>
        </>
      )}
      {me && (
        <span style={{ color: '#C0D6E4', fontSize: 13, display: 'flex', alignItems: 'center', gap: 10 }}>
          {me.name}
          <button className="btn sm" onClick={handleChangeUser}>Change user</button>
        </span>
      )}
    </header>
  );
}

/* =================================================================
   Planning shell
   ================================================================= */
const PLANNING_SCREENS = [
  { to: '/planning/sites',   label: 'Sites' },
  { to: '/planning/clients', label: 'Clients' },
  { to: '/planning/stores',  label: 'Stores' },
  { to: '/planning/boq',     label: 'BOQ',        badge: 'amendmentDue' },
  { to: '/planning/items',   label: 'Item master' },
  { to: '/planning/indents', label: 'Indents',     badge: 'indentsWaiting' },
];

function PlanningShell() {
  const { branches, branchId, setBranch, me, desk } = useApp();
  const counts = {
    amendmentDue: desk?.amendmentDue?.length || 0,
    indentsWaiting: desk?.indentsWaiting?.length || 0,
  };

  return (
    <div className="shell dept-shell">
      <div className="main">
        <DeptTopBar branchId={branchId} branches={branches} setBranch={setBranch} me={me} />
        <nav className="tabs" aria-label="Planning">
          <span className="dept">Planning</span>
          {PLANNING_SCREENS.map((x) => (
            <NavLink key={x.to} to={x.to} className={({ isActive }) => (isActive ? 'on' : '')}>
              {x.label}
              {x.badge && counts[x.badge] > 0 && <span className="count">{counts[x.badge]}</span>}
            </NavLink>
          ))}
        </nav>
        <div className="page"><Outlet /></div>
      </div>
    </div>
  );
}

/* =================================================================
   Site shell
   ================================================================= */
const SITE_SCREENS = [
  { to: '/site/indents',      label: 'Indents',          badge: 'indentsWaiting' },
  { to: '/site/inbox',        label: 'Acknowledgements' },
  { to: '/site/stock',        label: 'Site store' },
  { to: '/site/transfers',    label: 'Transfers out' },
  { to: '/site/sent',         label: 'Sent & reorder' },
  { to: '/site/issue',        label: 'Issue material' },
  { to: '/site/returns',      label: 'Returns' },
  { to: '/site/transactions', label: 'Transactions' },
  { to: '/site/audit',        label: 'Audit' },
  { to: '/site/consumption',  label: 'Consumption' },
  { to: '/site/expenses',     label: 'Expenses',         badge: 'expensesWaiting' },
];

function SiteShell() {
  const { branches, branchId, setBranch, me, desk, sites, siteId, setSite } = useApp();
  const counts = {
    indentsWaiting: desk?.indentsWaiting?.length || 0,
    expensesWaiting: desk?.expensesWaiting || 0,
  };

  return (
    <div className="shell dept-shell">
      <div className="main">
        <DeptTopBar branchId={branchId} branches={branches} setBranch={setBranch} me={me}
          showSite sites={sites} siteId={siteId} setSite={setSite} />
        <nav className="tabs" aria-label="Site">
          <span className="dept">Site</span>
          {SITE_SCREENS.map((x) => (
            <NavLink key={x.to} to={x.to} className={({ isActive }) => (isActive ? 'on' : '')}>
              {x.label}
              {x.badge && counts[x.badge] > 0 && <span className="count">{counts[x.badge]}</span>}
            </NavLink>
          ))}
        </nav>
        <div className="page"><Outlet /></div>
      </div>
    </div>
  );
}

/* =================================================================
   Store shell
   ================================================================= */
const STORE_SCREENS = [
  { to: '/store',              label: 'Store desk',       end: true },
  { to: '/store/prns',         label: 'PRNs to fulfil' },
  { to: '/store/transfers',    label: 'Transfer requests' },
  { to: '/store/grns',         label: 'GRN' },
  { to: '/store/challans',     label: 'Challans' },
  { to: '/store/stock',        label: 'Stock' },
  { to: '/store/movements',    label: 'Movements' },
  { to: '/store/items',        label: 'Item master' },
];

function StoreShell() {
  const { branches, branchId, setBranch, stores, storeId, setStore, me } = useApp();
  return (
    <div className="shell dept-shell">
      <div className="main">
        <DeptTopBar branchId={branchId} branches={branches} setBranch={setBranch} me={me}
          showStore stores={stores} storeId={storeId} setStore={setStore} />
        <nav className="tabs" aria-label="Store">
          <span className="dept">Store</span>
          {STORE_SCREENS.map((x) => (
            <NavLink key={x.to} to={x.to} end={x.end} className={({ isActive }) => (isActive ? 'on' : '')}>
              {x.label}
            </NavLink>
          ))}
        </nav>
        <div className="page"><Outlet /></div>
      </div>
    </div>
  );
}

/* =================================================================
   Procure shell
   ================================================================= */
const PROCURE_SCREENS = [
  { to: '/procure/demand',       label: 'To buy' },
  { to: '/procure/comparisons',  label: 'Comparisons' },
  { to: '/procure/orders',       label: 'Purchase orders' },
  { to: '/procure/suppliers',    label: 'Suppliers' },
];

function ProcureShell() {
  const { branches, branchId, setBranch, me } = useApp();
  return (
    <div className="shell dept-shell">
      <div className="main">
        <DeptTopBar branchId={branchId} branches={branches} setBranch={setBranch} me={me} />
        <nav className="tabs" aria-label="Procure">
          <span className="dept">Procure</span>
          {PROCURE_SCREENS.map((x) => (
            <NavLink key={x.to} to={x.to} className={({ isActive }) => (isActive ? 'on' : '')}>
              {x.label}
            </NavLink>
          ))}
        </nav>
        <div className="page"><Outlet /></div>
      </div>
    </div>
  );
}

/* =================================================================
   Billing shell
   ================================================================= */
const BILLING_SCREENS = [
  { to: '/billing',       label: 'Bill a site', end: true },
  { to: '/billing/bills', label: 'Bills' },
];

function BillingShell() {
  const { branches, branchId, setBranch, me } = useApp();
  return (
    <div className="shell dept-shell">
      <div className="main">
        <DeptTopBar branchId={branchId} branches={branches} setBranch={setBranch} me={me} />
        <nav className="tabs" aria-label="Billing">
          <span className="dept">Billing</span>
          {BILLING_SCREENS.map((x) => (
            <NavLink key={x.to} to={x.to} end={x.end} className={({ isActive }) => (isActive ? 'on' : '')}>
              {x.label}
            </NavLink>
          ))}
        </nav>
        <div className="page"><Outlet /></div>
      </div>
    </div>
  );
}

/* =================================================================
   Reports shell
   ================================================================= */
const REPORTS_SCREENS = [
  { to: '/reports/expense', label: 'Expense report' },
  { to: '/reports/pl',      label: 'Profit and loss' },
];

function ReportsShell() {
  const { branches, branchId, setBranch, me } = useApp();
  return (
    <div className="shell dept-shell">
      <div className="main">
        <DeptTopBar branchId={branchId} branches={branches} setBranch={setBranch} me={me} />
        <nav className="tabs" aria-label="Reports">
          <span className="dept">Reports</span>
          {REPORTS_SCREENS.map((x) => (
            <NavLink key={x.to} to={x.to} className={({ isActive }) => (isActive ? 'on' : '')}>
              {x.label}
            </NavLink>
          ))}
        </nav>
        <div className="page"><Outlet /></div>
      </div>
    </div>
  );
}

/* =================================================================
   App root — boots global data then mounts the router
   ================================================================= */
export default function App() {
  const [boot, setBoot] = useState({ loading: true });
  const [branchId, setBranchId] = useState(Number(localStorage.getItem('ajp.branchId')) || null);
  const [storeId, setStoreId] = useState(Number(localStorage.getItem('ajp.storeId')) || null);
  const [siteId, setSiteId] = useState(Number(localStorage.getItem('ajp.siteId')) || null);
  const [stores, setStores] = useState([]);
  const [storesLoading, setStoresLoading] = useState(true);
  const [sites, setSites] = useState([]);
  const [sitesLoading, setSitesLoading] = useState(true);
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

  useEffect(() => {
    if (!branchId) return;
    setStoresLoading(true);
    api.get(`/store/stores?branchId=${branchId}`)
      .then((rows) => {
        setStores(rows);
        setStoreId((cur) => (rows.some((r) => r.id === cur) ? cur : rows[0]?.id || null));
      })
      .catch(() => { setStores([]); setStoreId(null); })
      .finally(() => setStoresLoading(false));
  }, [branchId]);

  // Load project sites for the branch — used by the Site shell toggle
  useEffect(() => {
    if (!branchId) return;
    setSitesLoading(true);
    api.get(`/sites?branchId=${branchId}`)
      .then((rows) => {
        setSites(rows);
        setSiteId((cur) => (rows.some((r) => r.id === cur) ? cur : rows[0]?.id || null));
      })
      .catch(() => { setSites([]); setSiteId(null); })
      .finally(() => setSitesLoading(false));
  }, [branchId]);

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
  const setStore = (id) => { setStoreId(id); localStorage.setItem('ajp.storeId', String(id)); };
  const setSite = (id) => { setSiteId(id); localStorage.setItem('ajp.siteId', String(id)); };

  return (
    <AppCtx.Provider value={{
      ...boot, branchId, setBranch,
      storeId, setStore, stores, storesLoading,
      siteId, setSite, sites, sitesLoading,
      desk, refreshDesk,
    }}>
      <ToastHost>
        <BrowserRouter>
          <Routes>
            {/* ── Login ─────────────────────────────────────────── */}
            <Route path="/login" element={<Login />} />

            {/* ── Planning department ───────────────────────────── */}
            <Route element={<PrivateRoute><PlanningShell /></PrivateRoute>}>
              <Route path="/planning" element={<Navigate to="/planning/sites" replace />} />
              <Route path="/planning/sites" element={<Sites />} />
              <Route path="/planning/sites/new" element={<NewSite />} />
              <Route path="/planning/sites/:id" element={<SiteDetail />} />
              <Route path="/planning/stores" element={<Stores />} />
              <Route path="/planning/boq" element={<BoqList />} />
              <Route path="/planning/items" element={<Items />} />
              <Route path="/planning/indents" element={<Indents basePath="/planning/indents" />} />
              <Route path="/planning/indents/:id" element={<IndentDetail />} />
              <Route path="/planning/clients" element={<Clients />} />
            </Route>

            {/* ── Site department ───────────────────────────────── */}
            <Route element={<PrivateRoute><SiteShell /></PrivateRoute>}>
              <Route path="/site" element={<Navigate to="/site/indents" replace />} />
              <Route path="/site/indents" element={<Indents />} />
              <Route path="/site/indents/new" element={<IndentCart />} />
              <Route path="/site/indents/:id" element={<IndentDetail />} />
              <Route path="/site/indents/:id/edit" element={<IndentCart />} />
              <Route path="/site/inbox" element={<SiteInbox />} />
              <Route path="/site/stock" element={<SiteStock />} />
              <Route path="/site/issue" element={<IssueStock />} />
              <Route path="/site/returns" element={<ReturnStock />} />
              <Route path="/site/transactions" element={<Transactions />} />
              <Route path="/site/audit" element={<Audit />} />
              <Route path="/site/consumption" element={<Consumed />} />
              <Route path="/site/expenses" element={<Expenses />} />
              <Route path="/site/transfers" element={<SiteTransfers />} />
              <Route path="/site/sent" element={<SentAndReorder />} />
            </Route>

            {/* ── Store department ──────────────────────────────── */}
            <Route element={<PrivateRoute><StoreShell /></PrivateRoute>}>
              <Route path="/store" element={<StoreDesk />} />
              <Route path="/store/prns" element={<Prns />} />
              <Route path="/store/issue" element={<IssueSheet />} />
              <Route path="/store/grns" element={<Grns />} />
              <Route path="/store/grns/register" element={<GrnRegister />} />
              <Route path="/store/grns/:id" element={<GrnDetail />} />
              <Route path="/store/challans" element={<Challans />} />
              <Route path="/store/challans/:id" element={<ChallanDetail />} />
              <Route path="/store/stock" element={<Stock />} />
              <Route path="/store/movements" element={<Movements />} />
              <Route path="/store/transfers" element={<StoreTransfers />} />
              <Route path="/store/source" element={<SourceFromSitePage />} />
              <Route path="/store/items" element={<Items />} />
            </Route>

            {/* ── Procure department ───────────────────────────── */}
            <Route element={<PrivateRoute><ProcureShell /></PrivateRoute>}>
              <Route path="/procure" element={<Navigate to="/procure/demand" replace />} />
              <Route path="/procure/demand" element={<Procurement />} />
              <Route path="/procure/comparisons" element={<Comparisons />} />
              <Route path="/procure/comparisons/:id" element={<ComparisonDetail />} />
              <Route path="/procure/orders" element={<PurchaseOrders />} />
              <Route path="/procure/orders/:id" element={<PurchaseOrderDetail />} />
              <Route path="/procure/suppliers" element={<Suppliers />} />
            </Route>

            {/* ── Billing department ───────────────────────────── */}
            <Route element={<PrivateRoute><BillingShell /></PrivateRoute>}>
              <Route path="/billing" element={<Billing />} />
              <Route path="/billing/bills" element={<Bills />} />
              <Route path="/billing/site/:siteId" element={<BillingSheet />} />
            </Route>

            {/* ── Reports department ───────────────────────────── */}
            <Route element={<PrivateRoute><ReportsShell /></PrivateRoute>}>
              <Route path="/reports/expense" element={<ExpenseReport />} />
              <Route path="/reports/pl" element={<ProfitLoss />} />
              <Route path="/reports" element={<Navigate to="/reports/expense" replace />} />
              <Route path="/reports/consumption" element={<Navigate to="/site/consumption" replace />} />
              <Route path="/reports/transactions" element={<Navigate to="/site/transactions" replace />} />
              <Route path="/reports/audit" element={<Navigate to="/site/audit" replace />} />
            </Route>

            {/* ── Backward-compat redirects ─────────────────────── */}
            <Route path="/sites" element={<Navigate to="/planning/sites" replace />} />
            <Route path="/sites/new" element={<Navigate to="/planning/sites/new" replace />} />
            <Route path="/sites/:id" element={<NavigateSiteId />} />
            <Route path="/boq" element={<Navigate to="/planning/boq" replace />} />
            <Route path="/stores" element={<Navigate to="/planning/stores" replace />} />
            <Route path="/items" element={<Navigate to="/planning/items" replace />} />
            <Route path="/indents" element={<Navigate to="/site/indents" replace />} />
            <Route path="/indents/new" element={<Navigate to="/site/indents/new" replace />} />
            <Route path="/indents/:id" element={<NavigateIndentId />} />
            <Route path="/indents/:id/edit" element={<NavigateIndentIdEdit />} />
            <Route path="/grns" element={<Navigate to="/store/grns" replace />} />
            <Route path="/grns/register" element={<Navigate to="/store/grns/register" replace />} />
            <Route path="/grns/:id" element={<NavigateGrnId />} />
            <Route path="/challans" element={<Navigate to="/store/challans" replace />} />
            <Route path="/challans/new" element={<Navigate to="/store/prns" replace />} />
            <Route path="/challans/:id" element={<NavigateChallanId />} />
            <Route path="/stock" element={<Navigate to="/store/stock" replace />} />
            <Route path="/movements" element={<Navigate to="/store/movements" replace />} />
            <Route path="/procurement" element={<Navigate to="/procure/demand" replace />} />
            <Route path="/comparisons" element={<Navigate to="/procure/comparisons" replace />} />
            <Route path="/comparisons/:id" element={<NavigateComparisonId />} />
            <Route path="/purchase-orders" element={<Navigate to="/procure/orders" replace />} />
            <Route path="/purchase-orders/:id" element={<NavigatePoId />} />
            <Route path="/suppliers" element={<Navigate to="/procure/suppliers" replace />} />

            {/* ── Root + 404 ────────────────────────────────────── */}
            <Route path="/" element={<Navigate to="/login" replace />} />
            <Route path="*" element={<div className="page-body"><p>No such page.</p></div>} />
          </Routes>
        </BrowserRouter>
      </ToastHost>
    </AppCtx.Provider>
  );
}

/* Param-carrying redirect helpers for backward-compat */
function NavigateSiteId() {
  const { id } = useParams();
  return <Navigate to={`/planning/sites/${id}`} replace />;
}
function NavigateIndentId() {
  const { id } = useParams();
  return <Navigate to={`/site/indents/${id}`} replace />;
}
function NavigateIndentIdEdit() {
  const { id } = useParams();
  return <Navigate to={`/site/indents/${id}/edit`} replace />;
}
function NavigateGrnId() {
  const { id } = useParams();
  return <Navigate to={`/store/grns/${id}`} replace />;
}
function NavigateChallanId() {
  const { id } = useParams();
  return <Navigate to={`/store/challans/${id}`} replace />;
}
function NavigateComparisonId() {
  const { id } = useParams();
  return <Navigate to={`/procure/comparisons/${id}`} replace />;
}
function NavigatePoId() {
  const { id } = useParams();
  return <Navigate to={`/procure/orders/${id}`} replace />;
}
