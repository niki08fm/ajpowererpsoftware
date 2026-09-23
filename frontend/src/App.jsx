import { createContext, useContext, useCallback, useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, NavLink, Navigate, useLocation } from 'react-router-dom';
import { api, setToken, getToken, whenSignedOut, setWrites } from './api';
import {
  ToastHost, DialogHost, Loading, ErrorNote, Field, Modal, useToast, Status,
} from './components/ui';
import { Icon } from './components/icons';
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
import { HowWorkMoves, Glossary } from './pages/Help';

const AppCtx = createContext(null);
export const useApp = () => useContext(AppCtx);

/**
 * Navigation: one sidebar, every screen in it, nothing hidden.
 *
 * Trial 1 folded the monthly screens behind "+ N more", and people
 * could not find what they could not see. Here every screen is listed;
 * the ones used daily come first and the rest sit under a small caption
 * in the same department, so the list stays readable without hiding
 * anything.
 *
 * A screen's label here is also its page title — you arrive where you
 * clicked, under the same name. The words come from vocab.js: PRN for
 * the site's request, Receive for taking a delivery, Dispatch for the
 * store sending, Issue for handing material to a worker.
 */
export const SECTIONS = [
  {
    id: 'approvals',
    label: 'Approvals',
    icon: 'inbox',
    scope: 'person',
    screens: [
      { to: '/approvals', label: 'Waiting on me', badge: 'approvals', badgeSays: 'waiting for your decision', end: true },
      { to: '/approvals/decided', label: 'Decided by me' },
    ],
  },
  {
    id: 'plan',
    label: 'Planning',
    icon: 'clipboard',
    caption: 'Setup',
    screens: [
      { to: '/sites', label: 'Sites' },
      { to: '/boq', label: 'BOQ', badge: 'amendmentDue', badgeSays: 'waiting for an amendment' },
      { to: '/clients', label: 'Clients' },
      { to: '/stores', label: 'Stores', more: true },
      { to: '/items', label: 'Item master', more: true },
    ],
  },
  {
    id: 'site',
    label: 'Site',
    icon: 'helmet',
    caption: 'Transfers & records',
    screens: [
      { to: '/indents', label: 'PRNs', badge: 'indentsSentBack', badgeSays: 'sent back to the site' },
      { to: '/site/inbox', label: 'Receive deliveries' },
      { to: '/site/stock', label: 'Site stock' },
      { to: '/site/issue', label: 'Issue to worker' },
      { to: '/site/returns', label: 'Take back from worker' },
      { to: '/site/expenses', label: 'Expenses', badge: 'expensesSentBack', badgeSays: 'sent back to the site' },
      { to: '/site/transfers', label: 'Send to another site', more: true },
      { to: '/site/sent', label: 'Sent to other sites', more: true },
      { to: '/site/transactions', label: 'Transactions', more: true },
      { to: '/site/consumption', label: 'Consumption', more: true },
      { to: '/site/audit', label: 'Audit trail', more: true },
    ],
  },
  {
    id: 'store',
    label: 'Store',
    icon: 'store',
    caption: 'Records & setup',
    screens: [
      { to: '/store/prns', label: 'PRNs to fulfil' },
      { to: '/grns', label: 'Receive from supplier', end: true },
      { to: '/challans', label: 'Delivery challans' },
      { to: '/stock', label: 'Stock' },
      { to: '/grns/register', label: 'GRN register', more: true },
      { to: '/store/transfers', label: 'Site-to-site requests', more: true },
      { to: '/movements', label: 'Stock movement', more: true },
      { to: '/items', label: 'Item master', more: true },
      // reached from a PRN, never from the menu
      { to: '/store/issue', label: 'Dispatch sheet', hidden: true },
      { to: '/store/source', label: 'Ask another site', hidden: true },
    ],
  },
  {
    id: 'procure',
    label: 'Procurement',
    icon: 'cart',
    caption: 'Setup',
    screens: [
      { to: '/procurement', label: 'To buy' },
      { to: '/comparisons', label: 'Rate comparisons' },
      { to: '/purchase-orders', label: 'Purchase orders' },
      { to: '/suppliers', label: 'Suppliers', more: true },
    ],
  },
  {
    id: 'billing',
    label: 'Billing',
    icon: 'receipt',
    screens: [
      { to: '/billing', label: 'Bill a site', end: true },
      { to: '/billing/bills', label: 'RA bills' },
    ],
  },
  {
    id: 'reports',
    label: 'Reports',
    icon: 'chart',
    screens: [
      { to: '/reports/expense', label: 'Expense report' },
      { to: '/reports/pl', label: 'Profit & loss' },
    ],
  },
  {
    id: 'admin',
    label: 'Logins',
    icon: 'users',
    scope: 'none',
    screens: [
      { to: '/admin/users', label: 'Users & access' },
    ],
  },
  {
    id: 'help',
    label: 'Help',
    icon: 'help',
    scope: 'none',
    screens: [
      { to: '/help', label: 'How work moves', end: true },
      { to: '/help/glossary', label: 'Glossary' },
    ],
  },
];

/** The label a screen has in the menu — pages use it as their title. */
export const titleOf = (to) => {
  for (const s of SECTIONS) {
    const x = s.screens.find((y) => y.to === to);
    if (x) return x.label;
  }
  return '';
};

/**
 * What each login is shown.
 *
 * A department sees its own department, all of it. Management and the
 * General Manager oversee: every department, but the screens that show
 * the work rather than the ones that do it — nobody overseeing raises
 * a PRN or issues material. The server holds the same line
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
  help: 'all',
};
const MENU = {
  Management: { ...OVERSEE, admin: 'all' },
  'General Manager': OVERSEE,
  Planning: { plan: 'all', help: 'all' },
  // the site answers transfer requests from its Approvals
  Site: { approvals: 'all', site: 'all', help: 'all' },
  Store: { store: 'all', help: 'all' },
  Procurement: { procure: 'all', help: 'all' },
  Billing: { billing: 'all', help: 'all' },
};
// open to an overseer by path, but they are forms for doing the work
const DOING = [/^\/indents\/new/, /\/edit$/, /^\/sites\/new/, /^\/site\/(issue|returns|transfers)/,
  /^\/store\/(issue|source)/, /^\/grns$/];

export function menuFor(access) {
  const pick = MENU[access?.role] || {};
  return SECTIONS.filter((sec) => pick[sec.id]).map((sec) => {
    const want = pick[sec.id];
    let screens = want === 'all' ? sec.screens : sec.screens.filter((x) => want.includes(x.to));
    // chosen for an overseer: nothing under a caption, and a form for
    // doing the work stays off the menu
    if (want !== 'all') {
      screens = screens.map((x) => ({ ...x, more: false,
        hidden: x.hidden || DOING.some((re) => re.test(x.to)) }));
    }
    // issuing is the store keeper's, so only a keeper is offered it
    // (taking material back is any site person's, as the server allows)
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
  { id: 'accounts', label: 'Accounts', icon: 'wallet' },
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
  || sections.find((s) => s.screens.some((x) => (x.end ? pathname === x.to || pathname.startsWith(`${x.to}/`) : pathname.startsWith(x.to))))
  || sections[0];

const screenFor = (section, pathname) =>
  [...section.screens].sort((a, b) => b.to.length - a.to.length)
    .find((x) => pathname === x.to || pathname.startsWith(`${x.to}/`) || (!x.end && pathname.startsWith(x.to)));

/* ------------------------------------------------------------ theme */
const useTheme = () => {
  const [dark, setDark] = useState(() => {
    try { return localStorage.getItem('ajp.theme') === 'dark'; } catch { return false; }
  });
  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
    try { localStorage.setItem('ajp.theme', dark ? 'dark' : 'light'); } catch { /* private window */ }
  }, [dark]);
  return [dark, setDark];
};

/** One department in the sidebar: the heading, its daily screens, then the rest under a caption. */
function NavGroup({ section, active, open, onToggle, counts, mini }) {
  const listed = section.screens.filter((x) => !x.hidden);
  const daily = listed.filter((x) => !x.more);
  const rest = listed.filter((x) => x.more);
  const total = section.screens.reduce((a, x) => a + (x.badge ? counts[x.badge] || 0 : 0), 0);

  const item = (x) => (
    <NavLink key={x.to} to={x.to} end={x.end} state={{ dept: section.id }}
      className={({ isActive }) => (isActive || active?.to === x.to ? 'on' : '')}
      aria-current={active?.to === x.to ? 'page' : undefined}>
      <span>{x.label}</span>
      <span className="sp" />
      {x.badge && counts[x.badge] > 0 && (
        <span className="count" title={`${counts[x.badge]} ${x.badgeSays || 'waiting'}`}
          aria-label={`${counts[x.badge]} ${x.badgeSays || 'waiting'}`}>{counts[x.badge]}</span>
      )}
    </NavLink>
  );

  return (
    <div className="nav-group">
      <button type="button" className={`nav-sec ${open ? 'open' : ''} ${active ? 'on' : ''}`}
        onClick={onToggle} aria-expanded={open} title={mini ? section.label : undefined}>
        <Icon name={section.icon} size={18} />
        <span className="label">{section.label}</span>
        {total > 0 && <span className="count" aria-label={`${total} waiting`}>{total}</span>}
        <span className="chev"><Icon name="chevronRight" size={14} /></span>
      </button>

      {open && !mini && (
        <div className="nav-items">
          {daily.map(item)}
          {rest.length > 0 && (
            <>
              <div className="nav-cap">{section.caption || 'More'}</div>
              {rest.map(item)}
            </>
          )}
        </div>
      )}

      {/* collapsed: everything, on hover or focus, without widening the sidebar */}
      <div className="flyout">
        <h4>{section.label}</h4>
        {listed.map(item)}
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

  const [mini, setMini] = useState(() => {
    try { return localStorage.getItem('ajp.nav') === 'mini'; } catch { return false; }
  });
  const toggleMini = () => setMini((v) => {
    try { localStorage.setItem('ajp.nav', v ? 'wide' : 'mini'); } catch { /* private window */ }
    return !v;
  });

  // the department you are in is open; opening another closes it, so
  // the sidebar stays one screen tall however many departments exist
  const [openId, setOpenId] = useState(section.id);
  useEffect(() => { setOpenId(section.id); }, [section.id]);

  const site = section.id === 'site' ? allSites.find((x) => x.id === siteId) : null;
  const store = section.id === 'store' ? allStores.find((x) => x.id === storeId) : null;
  // A document opened from somewhere else (a PRN from Approvals, a GRN
  // from the register) is shown, not replaced by the site chooser — the
  // document already says which site it belongs to.
  const onDocument = /\/\d+(\/|$)/.test(pathname);
  const choosing = !onDocument && ((section.id === 'site' && !site) || (section.id === 'store' && !store));

  const branchId =
    section.id === 'site' ? (site?.branch.id ?? null)
      : section.id === 'store' ? (store?.branch_id ?? null)
        : (branchSel === 'ALL' ? null : branchSel);
  const branchName = branchSel === 'ALL' ? 'All branches'
    : branches.find((b) => b.id === branchSel)?.name || 'All branches';

  const inner = {
    ...outer,
    branchId,
    branchName,
    // true only where the picker really is on every branch; the Site and
    // Store departments are never "all", they are one site or one store
    allBranches: !['site', 'store'].includes(section.id) && branchSel === 'ALL',
    siteId: site ? site.id : outer.siteId,
    site,
    store,
    stores: branchId ? allStores.filter((x) => x.branch_id === branchId) : allStores,
  };
  // A number in the menu means "this needs you", nothing else. Waiting
  // on an approver is counted once, under Approvals, for the approver;
  // a site's menu counts only what came back to the site to be changed,
  // for the site in the top bar (or every site this login can see).
  const mySites = new Set((site ? [site] : allSites).map((x) => x.id));
  const onMySites = (rows) => (rows || []).filter((r) => mySites.has(r.site_id)).length;
  const counts = {
    amendmentDue: access.role === 'Planning' ? desk?.amendmentDue?.length || 0 : 0,
    indentsSentBack: access.role === 'Site' ? onMySites(desk?.indentsSentBack) : 0,
    expensesSentBack: access.role === 'Site' ? onMySites(desk?.expensesSentBack) : 0,
    approvals: approvalsWaiting || 0,
  };
  const viewOnly = access.overseer && !['approvals', 'admin', 'help'].includes(section.id);

  return (
    <div className={`shell ${mini ? 'mini' : ''}`}>
      <a className="skip" href="#main">Skip to the page</a>
      <nav className="nav" aria-label="Departments and screens">
        <div className="nav-head">
          <div className="mark" aria-hidden="true">AJ</div>
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
            aria-label={mini ? 'Widen the menu' : 'Narrow the menu to icons'}
            title={mini ? 'Widen the menu' : 'Narrow the menu to icons'}>
            <Icon name="panel" size={17} />
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
              <div className="nav-sec soon" title={`${d.label} is not built yet`}>
                <Icon name={d.icon} size={18} />
                <span className="label">{d.label}</span>
                <span className="soon-note">Not built yet</span>
              </div>
            </div>
          ))}
        </div>

        <div className="nav-foot">
          <button type="button" className="nav-sec" onClick={() => setDark((v) => !v)}>
            <Icon name={dark ? 'sun' : 'moon'} size={18} />
            <span className="label">{dark ? 'Use light theme' : 'Use dark theme'}</span>
          </button>
        </div>
      </nav>

      <div className="main">
        <header className="top">
          <div className="crumb">
            <b>{section.label}</b>
            {screen && !screen.hidden && <><Icon name="chevronRight" size={13} /><span>{screen.label}</span></>}
            {viewOnly && (
              <Status tone="neutral" icon="eye" label="View only"
                hint={`You oversee ${section.label}; its own team does the work here`} />
            )}
          </div>
          <span className="sp" />
          <Scope section={section} site={site} store={store} branches={branches}
            allSites={allSites} allStores={allStores} setSite={setSite} setStore={setStore}
            branchSel={branchSel} setBranch={setBranch} />
          <div className="me" title={user.email}>
            <b>{user.name}</b>
            <span>{user.department}</span>
          </div>
          <button type="button" className="top-btn" onClick={() => setPwOpen(true)}>
            <Icon name="key" size={14} />Password
          </button>
          <button type="button" className="top-btn" onClick={signOut}>
            <Icon name="logout" size={14} />Sign out
          </button>
        </header>
        {pwOpen && <PasswordForm onClose={() => setPwOpen(false)} />}

        <main className="page" id="main" tabIndex={-1}>
          <AppCtx.Provider value={inner}>
            {!reachable(sections, access, pathname)
              ? <NotYours home={sections[0]?.screens[0]?.to || '/'} />
              : choosing
                ? <Chooser kind={section.id} sites={allSites} stores={allStores} branches={branches}
                    onPick={(id) => (section.id === 'site' ? setSite(id) : setStore(id))} />
                : children}
          </AppCtx.Provider>
        </main>
      </div>
    </div>
  );
}

/**
 * What the page is showing, said in the top bar.
 *
 * Three kinds of page, and the bar never pretends one is another:
 * a site's or store's own pages (one place, switchable), pages that
 * follow the branch picker, and pages the picker does not touch —
 * Approvals is routed to the person, so it says so rather than showing
 * a branch picker that changes nothing.
 */
function Scope({ section, site, store, branches, allSites, allStores, setSite, setStore, branchSel, setBranch }) {
  if (section.scope === 'none') return null;
  if (section.scope === 'person') {
    return (
      <div className="scope" title="Approvals are routed to you by name, from every branch">
        <span className="scope-l">Showing</span>
        <span className="scope-fixed">Everything routed to you · all branches</span>
      </div>
    );
  }
  if (section.id === 'site') {
    if (!site) return null;
    return (
      <div className="scope">
        <label className="scope-l" htmlFor="scope-site">Site</label>
        <select id="scope-site" value={site.id} onChange={(e) => setSite(Number(e.target.value))}>
          {branches.map((b) => {
            const here = allSites.filter((x) => x.branch.id === b.id);
            return here.length ? (
              <optgroup key={b.id} label={b.name}>
                {here.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
              </optgroup>
            ) : null;
          })}
        </select>
        <button type="button" className="btn sm ghost" onClick={() => setSite(null)}>All sites</button>
      </div>
    );
  }
  if (section.id === 'store') {
    if (!store) return null;
    return (
      <div className="scope">
        <label className="scope-l" htmlFor="scope-store">Store</label>
        <select id="scope-store" value={store.id} onChange={(e) => setStore(Number(e.target.value))}>
          {branches.map((b) => {
            const here = allStores.filter((x) => x.branch_id === b.id);
            return here.length ? (
              <optgroup key={b.id} label={b.name}>
                {here.map((x) => (
                  <option key={x.id} value={x.id}>{x.name}{x.is_central ? ' (central)' : ''}</option>
                ))}
              </optgroup>
            ) : null;
          })}
        </select>
        <button type="button" className="btn sm ghost" onClick={() => setStore(null)}>All stores</button>
      </div>
    );
  }
  return (
    <div className="scope">
      <label className="scope-l" htmlFor="scope-branch">Branch</label>
      <select id="scope-branch" value={branchSel ?? 'ALL'}
        onChange={(e) => setBranch(e.target.value === 'ALL' ? 'ALL' : Number(e.target.value))}>
        <option value="ALL">All branches</option>
        {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
      </select>
    </div>
  );
}

/**
 * A page's title row. `title` defaults to the screen's menu label, so a
 * screen is called the same thing in the menu and on the page.
 */
export const PageHead = ({ title, sub, actions }) => (
  <div className="page-head">
    <div><h1>{title}</h1>{sub && <p>{sub}</p>}</div>
    <div className="sp" />
    {actions && <div className="acts">{actions}</div>}
  </div>
);

/** Somewhere this login does not go. */
function NotYours({ home }) {
  return (
    <div className="page-body">
      <div className="empty" style={{ marginTop: 40 }}>
        <Icon name="lock" size={22} />
        <b>This screen is not part of your login</b>
        <p>It belongs to another department. Management can change what your login can open.</p>
        <div className="acts"><NavLink className="btn" to={home}>Go to your first screen</NavLink></div>
      </div>
    </div>
  );
}

/** Change your own password. */
function PasswordForm({ onClose }) {
  const toast = useToast();
  const [f, setF] = useState({ current: '', next: '', again: '' });
  const [busy, setBusy] = useState(false);
  const short = f.next.length > 0 && f.next.length < 8;
  const differ = f.again.length > 0 && f.next !== f.again;
  const save = async () => {
    if (f.next.length < 8) return toast('The new password needs at least 8 characters', 'bad');
    if (f.next !== f.again) return toast('The two new passwords do not match', 'bad');
    setBusy(true);
    try {
      await api.post('/auth/password', { current: f.current, next: f.next });
      toast('Password changed. Your other sessions are signed out.', 'ok');
      onClose();
    } catch (e) { toast(e.message, 'bad'); } finally { setBusy(false); }
    return undefined;
  };
  const inp = (k, label, auto) => (
    <input className="inp" type="password" autoComplete={auto} value={f[k]} aria-label={label}
      onChange={(e) => setF({ ...f, [k]: e.target.value })} />
  );
  return (
    <Modal title="Change your password" onClose={onClose}
      footer={<>
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn pri" onClick={save}
          disabled={busy || !f.current || !f.next || short || differ}>
          {busy ? 'Changing…' : 'Change password'}
        </button>
      </>}>
      <Field label="Current password">{inp('current', 'Current password', 'current-password')}</Field>
      <Field label="New password" hint={short ? 'At least 8 characters' : 'At least 8 characters'} bad={short}>
        {inp('next', 'New password', 'new-password')}
      </Field>
      <Field label="New password again" hint={differ ? 'Does not match the new password' : undefined} bad={differ}>
        {inp('again', 'New password again', 'new-password')}
      </Field>
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

  if (auth.checking) return <Loading what="your login" />;
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

const remembered = (key) => { try { return localStorage.getItem(key); } catch { return null; } };

function Workspace({ user, access, signOut }) {
  const sections = menuFor(access);
  const home = sections[0]?.screens[0]?.to || '/approvals';
  const [boot, setBoot] = useState({ loading: true });
  // The branch picker: a branch id, or 'ALL'. Remembered. It starts on
  // All branches — trial 1 started on whichever branch sorted first
  // (Bengaluru), and every Hyderabad document was invisible until
  // somebody noticed the picker.
  const [branchSel, setBranchSel] = useState(() => {
    const v = remembered('ajp.branchId');
    return v === 'ALL' || !v ? 'ALL' : (Number(v) || 'ALL');
  });
  const [storeId, setStoreId] = useState(Number(remembered('ajp.storeId')) || null);
  const [siteId, setSiteId] = useState(Number(remembered('ajp.siteId')) || null);
  const [allStores, setAllStores] = useState([]);
  const [allSites, setAllSites] = useState([]);
  const [desk, setDesk] = useState(null);
  // what is waiting on the signed-in person: the badge on Approvals
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
        // a remembered branch that no longer exists falls back to all
        setBranchSel((b) => (b === 'ALL' || branches.some((x) => x.id === b) ? b : 'ALL'));
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

  // counts for the menu badges: an amendment that is due should be
  // visible from wherever you happen to be standing. On every branch
  // they are counted across every branch.
  const refreshDesk = useCallback(() => {
    if (!branchSel) return;
    api.get(`/progress/desk${branchSel === 'ALL' ? '' : `?branchId=${branchSel}`}`)
      .then(setDesk).catch(() => setDesk(null));
  }, [branchSel]);
  useEffect(refreshDesk, [refreshDesk]);

  if (boot.loading) return <Loading what="the workspace" />;
  if (boot.error) {
    return (
      <div style={{ maxWidth: 560, margin: '80px auto', padding: '0 16px' }}>
        <ErrorNote
          error={{ message: `Cannot reach the AJ Power server. Check that the API is running, then try again. (${boot.error.message})` }}
          onRetry={() => window.location.reload()} />
      </div>
    );
  }

  const remember = (key, v) => {
    try { if (v == null) localStorage.removeItem(key); else localStorage.setItem(key, String(v)); } catch { /* private window */ }
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
        <DialogHost>
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
                <Route path="/help" element={<HowWorkMoves />} />
                <Route path="/help/glossary" element={<Glossary />} />
                <Route path="*" element={(
                  <div className="page-body">
                    <div className="empty" style={{ marginTop: 40 }}>
                      <b>There is no page at this address</b>
                      <p>The link may be old. Use the menu on the left to find the screen.</p>
                    </div>
                  </div>
                )} />
              </Routes>
            </Shell>
          </BrowserRouter>
        </DialogHost>
      </ToastHost>
    </AppCtx.Provider>
  );
}
