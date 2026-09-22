import { useState } from 'react';
import { Link } from 'react-router-dom';
import { PageHead } from '../App';
import { Empty, Tag } from '../components/ui';

/**
 * The first thing a site team or a store team sees.
 *
 * Everything in the Site department is answered for one site, and
 * everything in the Store department for one store, so that choice comes
 * first — before any screen — rather than as a dropdown each screen has
 * to carry. Every site or store in every branch is laid out here; the
 * branch is not asked for, because it follows from the one picked.
 *
 * Grouped by branch, with the branch's own heading, so a team working in
 * Pune never has to read past Hyderabad's sites to find its own.
 */
export function Chooser({ kind, sites, stores, branches, onPick }) {
  const [q, setQ] = useState('');
  const isSite = kind === 'site';
  const all = isSite ? sites : stores;
  const branchOf = (x) => (isSite ? x.branch.id : x.branch_id);

  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const match = (x) => {
    const hay = [x.name, x.code, isSite ? x.client?.name : '', isSite ? x.location : x.location]
      .filter(Boolean).join(' ').toLowerCase();
    return words.every((w) => hay.includes(w));
  };
  const shown = all.filter(match);

  return (
    <>
      <PageHead
        title={isSite ? 'Which site are you working on?' : 'Which store are you working in?'}
        sub={isSite
          ? 'Everything under Site is answered for one site. Pick it once — you can switch from the top bar any time.'
          : 'Everything under Store is answered for one store. Pick it once — you can switch from the top bar any time.'} />
      <div className="page-body">
        {all.length > 6 && (
          <div className="searchbar">
            <input className="inp" style={{ minWidth: 300 }} autoFocus value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={isSite ? 'Search site, code, client or location' : 'Search store or code'} />
            <span style={{ color: 'var(--muted)' }}>{shown.length} of {all.length}</span>
          </div>
        )}

        {!all.length && (
          <Empty title={isSite ? 'There is no open site yet' : 'There is no store yet'}>
            {isSite
              ? <>A site is created under <Link to="/sites/new" state={{ dept: 'plan' }}>Planning → Sites</Link>.</>
              : <>A store is created under <Link to="/stores" state={{ dept: 'plan' }}>Planning → Stores</Link>.</>}
          </Empty>
        )}

        {branches.map((b) => {
          const here = shown.filter((x) => branchOf(x) === b.id);
          if (!here.length) return null;
          return (
            <section key={b.id} className="choose-branch">
              <h2>{b.name} <small>{here.length} {isSite ? 'site' : 'store'}{here.length === 1 ? '' : 's'}</small></h2>
              <div className="choose-grid">
                {here.map((x) => (isSite
                  ? <SiteCard key={x.id} site={x} onPick={onPick} />
                  : <StoreCard key={x.id} store={x} onPick={onPick} />))}
              </div>
            </section>
          );
        })}

        {all.length > 0 && !shown.length && (
          <Empty title="Nothing matches">Try fewer words, or part of the code.</Empty>
        )}
      </div>
    </>
  );
}

function SiteCard({ site, onPick }) {
  const boq = site.boq;
  return (
    <button type="button" className="choose-card" onClick={() => onPick(site.id)}>
      <span className="code">{site.code}</span>
      <b>{site.name}</b>
      <span className="who">{site.client?.name || 'No client'}</span>
      {site.location && <span className="where">{site.location}</span>}
      <span className="foot">
        {site.head && <span>Head · {site.head.name}</span>}
        {boq
          ? <Tag kind={boq.state === 'AMENDMENT_DUE' ? 'warn' : boq.state === 'LOCKED' ? 'ok' : ''}>
              {boq.state === 'LOCKED' ? 'BOQ locked'
                : boq.state === 'AMENDMENT_DUE' ? 'Amendment due' : 'BOQ in draft'}
            </Tag>
          : <Tag>{site.workOrder ? 'No BOQ yet' : 'No work order yet'}</Tag>}
      </span>
    </button>
  );
}

function StoreCard({ store, onPick }) {
  return (
    <button type="button" className="choose-card" onClick={() => onPick(store.id)}>
      <span className="code">{store.code}{store.is_central ? ' · central' : ''}</span>
      <b>{store.name}</b>
      {store.location && <span className="where">{store.location}</span>}
      <span className="foot">
        <span>{Number(store.items) || 0} item{Number(store.items) === 1 ? '' : 's'} on the shelf</span>
        {Number(store.awaiting_grn) > 0 && <Tag kind="warn">{store.awaiting_grn} to receive</Tag>}
        {Number(store.out_unsigned) > 0 && <Tag kind="warn">{store.out_unsigned} out unsigned</Tag>}
      </span>
    </button>
  );
}
