import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useApp, PageHead } from '../App';
import { api, qty, dmy, today, addDays, withBranch } from '../api';
import { downloadCsv } from '../download';
import {
  useApi, Card, Tag, Empty, Loading, ErrorNote, Banner, Field, Stat, ItemPicker,
} from '../components/ui';
import { TrendChart, RankBars, shortNum } from '../components/charts';
import { IssueCard } from './Consumption';

/**
 * Three ways of looking at the same ledger.
 *
 *   Transactions   what moved — everything, filtered any way you like
 *   Audit          one item's whole history, or one person's
 *   Consumption    net consumed between two dates, by item
 *
 * The first two belong to the Site department: they are what a site
 * team reaches for when somebody asks where a coil of wire went or
 * what a man has drawn this month, and that is a question you ask
 * while working, not while reporting. Consumption is the report — one
 * number per item for a window, and the running total behind it.
 *
 * They are separate screens because they are separate questions people
 * arrive with, not because they are separate data. Every one of them
 * reads the same rows, which is the only way three screens can be
 * relied on to agree with each other.
 *
 * None of them shows money. A site did not buy any of this and has no
 * price to quote; what it has is quantities, and every rate these
 * documents carry is stamped and kept so that one report — the expense
 * report — can answer for the cost. Putting a value column on a site
 * screen invites an argument nobody on the site can settle.
 */

/* ------------------------------------------------------------ bits */

/** Filters live in the URL, so a filtered screen can be sent to someone. */
function useFilters(initial) {
  const [params, setParams] = useSearchParams();
  const get = (k) => params.get(k) ?? initial[k] ?? '';
  const set = (patch) => setParams((p) => {
    for (const [k, v] of Object.entries(patch)) {
      if (v === '' || v == null) p.delete(k); else p.set(k, String(v));
    }
    return p;
  }, { replace: true });
  const values = Object.fromEntries(Object.keys(initial).map((k) => [k, get(k)]));
  return [values, set];
}

/** Same three buttons on every screen, because the answer is usually one of them. */
function DateRange({ from, to, onChange }) {
  const preset = (days) => onChange({ from: addDays(today(), -days), to: today() });
  const fyStart = () => {
    const n = new Date();
    const y = n.getMonth() + 1 >= 4 ? n.getFullYear() : n.getFullYear() - 1;
    onChange({ from: `${y}-04-01`, to: today() });
  };
  return (
    <>
      <Field label="From">
        <input className="inp" type="date" style={{ width: 150 }} value={from}
          onChange={(e) => onChange({ from: e.target.value })} />
      </Field>
      <Field label="To">
        <input className="inp" type="date" style={{ width: 150 }} value={to}
          onChange={(e) => onChange({ to: e.target.value })} />
      </Field>
      <div style={{ display: 'flex', gap: 5, paddingBottom: 8 }}>
        <button className="btn sm"
          onClick={() => onChange({ from: today(), to: today() })}>Today</button>
        <button className="btn sm" onClick={() => preset(30)}>30 days</button>
        <button className="btn sm" onClick={() => preset(90)}>90 days</button>
        <button className="btn sm" onClick={fyStart}>This FY</button>
        <button className="btn sm" onClick={() => onChange({ from: '', to: '' })}>All</button>
      </div>
    </>
  );
}

/** Site or all sites — the one filter every screen here needs. */
function SitePicker({ value, onChange, label = 'Site', allLabel = 'Every site' }) {
  const { branchId, siteId } = useApp();
  const { data: sites } = useApi(withBranch('/sites', branchId), [branchId]);
  const { data: stores } = useApi(withBranch('/store/stores', branchId), [branchId]);
  return (
    <Field label={label}>
      <select className="inp" style={{ width: 230 }} value={value}
        onChange={(e) => onChange(e.target.value)}>
        <option value="">{allLabel}</option>
        {(sites || []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        {(stores || []).length > 0 && (
          <optgroup label="Stores">
            {stores.map((s) => (
              <option key={s.id} value={s.id}>{s.name}{s.is_central ? ' · central' : ''}</option>
            ))}
          </optgroup>
        )}
      </select>
    </Field>
  );
}

const KIND_TONE = {
  GRN: 'ok', DC_IN: 'ok', RETURN: 'ok',
  ISSUE: 'warn', DC_OUT: 'warn', ADJUST: 'brand',
};
const KIND_WORD = {
  GRN: 'Received', DC_IN: 'Signed for', DC_OUT: 'Sent out',
  ISSUE: 'Issued', RETURN: 'Returned', ADJUST: 'Adjusted',
};

const KindTag = ({ kind }) => (
  <Tag kind={KIND_TONE[kind] || ''}>{KIND_WORD[kind] || kind}</Tag>
);

/* ===================================================================
   1. TRANSACTIONS
   =================================================================== */
export function Transactions() {
  const { branchId, siteId } = useApp();
  const [f, set] = useFilters({
    site: String(siteId || ''), kind: '', direction: 'ALL', siteType: 'ALL',
    from: '', to: '', q: '', person: '', sort: 'recent',
  });
  const [peek, setPeek] = useState(null);

  const qs = new URLSearchParams({
    ...(branchId ? { branchId } : {}),
    ...(f.site ? { siteId: f.site } : {}),
    ...(f.kind ? { kind: f.kind } : {}),
    ...(f.direction !== 'ALL' ? { direction: f.direction } : {}),
    ...(f.siteType !== 'ALL' ? { siteType: f.siteType } : {}),
    ...(f.from ? { from: f.from } : {}),
    ...(f.to ? { to: f.to } : {}),
    ...(f.q ? { q: f.q } : {}),
    ...(f.person ? { person: f.person } : {}),
    sort: f.sort, limit: '500',
  }).toString();

  const { data, error, loading, reload } = useApi(
    `/tracking/transactions?${qs}`, [qs]);
  const kinds = useApi(
    withBranch('/tracking/transactions/kinds', branchId)
      + (f.site ? `${branchId ? '&' : '?'}siteId=${f.site}` : ''), [branchId, f.site]);

  const rows = data?.rows || [];
  const grab = () => downloadCsv('transactions', [
    ['Date', 'Where', 'Code', 'Item', 'Unit', 'Movement', 'In', 'Out',
      'Document', 'Person', 'By'],
    ...rows.map((r) => [
      dmy(r.moved_on), r.site_name, r.item_code, r.item_name, r.uom,
      KIND_WORD[r.kind] || r.kind,
      Number(r.qty) > 0 ? r.qty : '', Number(r.qty) < 0 ? Math.abs(r.qty) : '',
      r.ref_no || '', r.person || '', r.by_name || '',
    ]),
  ]);

  return (
    <>
      <PageHead title="Item transactions"
        sub="Every movement of every item, however you want to slice it"
        actions={<button className="btn" onClick={grab} disabled={!rows.length}>Download</button>} />

      <div className="page-body">
        {error && <ErrorNote error={error} onRetry={reload} />}

        <Card>
          <div className="pad" style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <SitePicker value={f.site} onChange={(v) => set({ site: v })}
              label="Where" allLabel="Everywhere in this branch" />
            <Field label="Movement">
              <select className="inp" style={{ width: 170 }} value={f.kind}
                onChange={(e) => set({ kind: e.target.value })}>
                <option value="">Every kind</option>
                {(kinds.data || []).map((k) => (
                  <option key={k.kind} value={k.kind}>
                    {KIND_WORD[k.kind] || k.kind} ({k.moves})
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Direction">
              <select className="inp" style={{ width: 120 }} value={f.direction}
                onChange={(e) => set({ direction: e.target.value })}>
                <option value="ALL">Both ways</option>
                <option value="IN">In only</option>
                <option value="OUT">Out only</option>
              </select>
            </Field>
            <DateRange from={f.from} to={f.to} onChange={set} />
          </div>
          <div className="pad" style={{
            paddingTop: 0, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end',
          }}>
            <Field label="Item">
              <input className="inp" style={{ width: 230 }} value={f.q}
                placeholder="By name, code or document"
                onChange={(e) => set({ q: e.target.value })} />
            </Field>
            <Field label="Person" hint="Narrows to issues and returns">
              <input className="inp" style={{ width: 190 }} value={f.person}
                placeholder="Who took it"
                onChange={(e) => set({ person: e.target.value })} />
            </Field>
            <Field label="Sort">
              <select className="inp" style={{ width: 150 }} value={f.sort}
                onChange={(e) => set({ sort: e.target.value })}>
                <option value="recent">Newest first</option>
                <option value="oldest">Oldest first</option>
                <option value="largest">Biggest quantity</option>
                <option value="item">By item</option>
              </select>
            </Field>
            <div style={{ paddingBottom: 8 }}>
              <button className="btn sm" onClick={() => set({
                site: String(siteId || ''), kind: '', direction: 'ALL', siteType: 'ALL',
                from: '', to: '', q: '', person: '', sort: 'recent',
              })}>Clear filters</button>
            </div>
          </div>
        </Card>

        {loading || !data ? <Loading /> : (
          <>
            <div className="stats">
              <Stat n={data.totals.moves} label="movements" />
              <Stat n={data.totals.items} label="items touched" />
              <Stat n={qty(data.totals.inQty)} label="units in" tone="ok" />
              <Stat n={qty(data.totals.outQty)} label="units out" tone="warn" />
              <Stat n={data.totals.sites} label="places" />
            </div>

            {data.truncated && (
              <Banner kind="warn" icon="!">
                {data.totals.moves} movements match — the newest {rows.length} are shown.
                Narrow the dates, or download the lot.
              </Banner>
            )}

            <Card title={`${rows.length} movement${rows.length === 1 ? '' : 's'}`}
              sub="Click a row for the document behind it">
              <div className="tw">
                <table>
                  <thead>
                    <tr>
                      <th>Date</th><th>Where</th><th>Code</th><th>Item</th>
                      <th style={{ width: 50 }}>Unit</th><th>Movement</th>
                      <th className="rt">In</th><th className="rt">Out</th>
                      <th>Document</th><th>Person</th><th>Recorded by</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.id}
                        style={{ cursor: r.ref_type === 'CON' ? 'pointer' : 'default' }}
                        onClick={() => r.ref_type === 'CON' && setPeek(r.ref_id)}>
                        <td>{dmy(r.moved_on)}</td>
                        <td>
                          {r.site_name}
                          {r.site_type === 'STORE' && (
                            <span style={{ color: 'var(--muted)', fontSize: 11 }}> · store</span>
                          )}
                        </td>
                        <td className="mono" style={{ color: 'var(--brand-ink)' }}>{r.item_code}</td>
                        <td>{r.item_name}</td>
                        <td>{r.uom}</td>
                        <td><KindTag kind={r.kind} /></td>
                        <td className="rt mono" style={{ color: 'var(--ok)' }}>
                          {Number(r.qty) > 0 ? qty(r.qty) : ''}
                        </td>
                        <td className="rt mono" style={{ color: 'var(--warn)' }}>
                          {Number(r.qty) < 0 ? qty(Math.abs(r.qty)) : ''}
                        </td>
                        <td className="mono" style={{ color: 'var(--muted)' }}>{r.ref_no || '—'}</td>
                        <td>{r.person || <span style={{ color: 'var(--muted)' }}>—</span>}</td>
                        <td style={{ color: 'var(--muted)' }}>{r.by_name || '—'}</td>
                      </tr>
                    ))}
                    {!rows.length && (
                      <tr><td colSpan={11}>
                        <Empty title="Nothing matches those filters">
                          Try clearing the dates, or the item.
                        </Empty>
                      </td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </Card>
          </>
        )}
      </div>

      {peek && <IssueCard id={peek} onClose={() => setPeek(null)} />}
    </>
  );
}

/* ===================================================================
   2. AUDIT — by item, or by person
   =================================================================== */
export function Audit() {
  const { siteId } = useApp();
  const [f, set] = useFilters({
    by: 'item', item: '', name: '', site: String(siteId || ''), from: '', to: '' });
  const by = f.by === 'person' ? 'person' : 'item';

  return (
    <>
      <PageHead title="Audit"
        sub="Pick an item to see everywhere it has been, or a person to see everything they have had" />

      <div className="page-body">
        <Card>
          <div className="pad" style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <Field label="Look up">
              <div style={{ display: 'flex', gap: 5 }}>
                <button className={`btn ${by === 'item' ? 'pri' : ''}`}
                  onClick={() => set({ by: 'item', name: '' })}>An item</button>
                <button className={`btn ${by === 'person' ? 'pri' : ''}`}
                  onClick={() => set({ by: 'person', item: '' })}>A person</button>
              </div>
            </Field>
            <SitePicker value={f.site} onChange={(v) => set({ site: v })}
              label="Where" allLabel="Everywhere in this branch" />
            <DateRange from={f.from} to={f.to} onChange={set} />
          </div>
        </Card>

        {by === 'item' ? <AuditByItem f={f} set={set} /> : <AuditByPerson f={f} set={set} />}
      </div>
    </>
  );
}

/* ------------------------------------------------------- by item */
function AuditByItem({ f, set }) {
  const { branchId, siteId } = useApp();
  const [picked, setPicked] = useState(null);

  // an item id in the URL should survive a reload, so fetch its name
  useEffect(() => {
    if (f.item && (!picked || String(picked.id) !== String(f.item))) {
      api.get(`/items/${f.item}`).then(setPicked).catch(() => setPicked(null));
    }
    if (!f.item && picked) setPicked(null);
  }, [f.item]); // eslint-disable-line react-hooks/exhaustive-deps

  const qs = new URLSearchParams({
    ...(f.site ? { siteId: f.site } : branchId ? { branchId } : {}),
    ...(f.from ? { from: f.from } : {}),
    ...(f.to ? { to: f.to } : {}),
  }).toString();

  const { data, error, loading, reload } = useApi(
    f.item ? `/tracking/audit/item/${f.item}?${qs}` : null, [f.item, qs]);

  const grab = () => downloadCsv(`audit-${data.item.code}`, [
    ['Date', 'Where', 'Movement', 'In', 'Out', 'Document', 'Person', 'By'],
    ...data.moves.map((m) => [
      dmy(m.moved_on), m.site_name, KIND_WORD[m.kind] || m.kind,
      Number(m.qty) > 0 ? m.qty : '', Number(m.qty) < 0 ? Math.abs(m.qty) : '',
      m.ref_no || '', m.person || '', m.by_name || '',
    ]),
  ]);

  return (
    <>
      <Card title="Which item">
        <div className="pad">
          <Field label="Search the item master"
            hint={picked ? `${picked.code} — everything below is this item` : undefined}>
            <ItemPicker value={picked} onPick={(it) => { setPicked(it); set({ item: it.id }); }} />
          </Field>
        </div>
      </Card>

      {!f.item && (
        <Empty title="Pick an item">
          Every receipt, challan, issue and return of it will be listed, wherever it happened.
        </Empty>
      )}
      {error && <ErrorNote error={error} onRetry={reload} />}
      {f.item && (loading || !data) && <Loading />}

      {data && (
        <>
          <div className="stats">
            <Stat n={qty(data.totals.onHand)} label={`${data.item.uom} on hand now`} />
            <Stat n={qty(data.totals.inQty)} label="units in" tone="ok" />
            <Stat n={qty(data.totals.outQty)} label="units out" tone="warn" />
            <Stat n={qty(data.totals.consumedQty)} label="consumed" />
            <Stat n={data.totals.moves} label="movements" />
          </div>

          <div className="grid2">
            <Card title="Where it is standing" sub="As at today, whatever window is set above">
              <div className="tw">
                <table>
                  <thead>
                    <tr><th>Place</th><th className="rt">Held</th>
                      <th>Last in</th><th>Last moved</th></tr>
                  </thead>
                  <tbody>
                    {data.balances.map((b) => (
                      <tr key={b.site_id}>
                        <td>
                          <b>{b.site_name}</b>
                          {b.site_type === 'STORE' && (
                            <Tag kind={b.is_central ? 'brand' : ''}>
                              {b.is_central ? 'central' : 'store'}
                            </Tag>
                          )}
                        </td>
                        <td className="rt mono"><b>{qty(b.qty)}</b></td>
                        <td>{b.last_in ? dmy(b.last_in) : '—'}</td>
                        <td>{dmy(b.last_moved)}</td>
                      </tr>
                    ))}
                    {!data.balances.length && (
                      <tr><td colSpan={4}>
                        <Empty title="Nowhere — nothing is holding any">
                          Every unit that came in has gone out again.
                        </Empty>
                      </td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </Card>

            <Card title="Who has used it"
              sub="Issued to them, less what came back — the rest is consumed">
              <div className="tw">
                <table>
                  <thead>
                    <tr><th>Person</th><th>Site</th><th className="rt">Issued</th>
                      <th className="rt">Returned</th><th className="rt">Consumed</th></tr>
                  </thead>
                  <tbody>
                    {data.people.map((p) => (
                      <tr key={`${p.person}-${p.site_id}`} style={{ cursor: 'pointer' }}
                        onClick={() => set({ by: 'person', name: p.person, item: '' })}>
                        <td><b>{p.person}</b></td>
                        <td style={{ color: 'var(--muted)' }}>{p.site_name}</td>
                        <td className="rt mono">{qty(p.issued_qty)}</td>
                        <td className="rt mono">{qty(p.returned_qty)}</td>
                        <td className="rt mono"><b>{qty(p.net_qty)}</b></td>
                      </tr>
                    ))}
                    {!data.people.length && (
                      <tr><td colSpan={5}>
                        <Empty title="Nobody has used this yet">
                          It has moved between store and site, but never into anyone&apos;s hands.
                        </Empty>
                      </td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </Card>
          </div>

          <Card title={`${data.moves.length} movement${data.moves.length === 1 ? '' : 's'}`}
            sub={`${data.item.code} — ${data.item.name}`}
            actions={<button className="btn sm" onClick={grab}>Download</button>}>
            <div className="tw">
              <table>
                <thead>
                  <tr>
                    <th>Date</th><th>Where</th><th>Movement</th>
                    <th className="rt">In</th><th className="rt">Out</th>
                    <th>Document</th><th>Person</th><th>Recorded by</th>
                  </tr>
                </thead>
                <tbody>
                  {data.moves.map((m) => (
                    <tr key={m.id}>
                      <td>{dmy(m.moved_on)}</td>
                      <td>{m.site_name}</td>
                      <td><KindTag kind={m.kind} /></td>
                      <td className="rt mono" style={{ color: 'var(--ok)' }}>
                        {Number(m.qty) > 0 ? qty(m.qty) : ''}
                      </td>
                      <td className="rt mono" style={{ color: 'var(--warn)' }}>
                        {Number(m.qty) < 0 ? qty(Math.abs(m.qty)) : ''}
                      </td>
                      <td className="mono" style={{ color: 'var(--muted)' }}>{m.ref_no || '—'}</td>
                      <td>{m.person || <span style={{ color: 'var(--muted)' }}>—</span>}</td>
                      <td style={{ color: 'var(--muted)' }}>{m.by_name || '—'}</td>
                    </tr>
                  ))}
                  {!data.moves.length && (
                    <tr><td colSpan={8}>
                      <Empty title="Nothing in this window">
                        This item has not moved between those dates.
                      </Empty>
                    </td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </>
  );
}

/* ----------------------------------------------------- by person */
function AuditByPerson({ f, set }) {
  const { branchId, siteId } = useApp();
  const [term, setTerm] = useState(f.name);
  useEffect(() => { setTerm(f.name); }, [f.name]);

  const scope = new URLSearchParams({
    ...(f.site ? { siteId: f.site } : branchId ? { branchId } : {}),
    ...(f.from ? { from: f.from } : {}),
    ...(f.to ? { to: f.to } : {}),
  }).toString();

  const list = useApi(`/tracking/audit/people?${scope}&sort=outstanding`, [scope]);
  const one = useApi(
    f.name ? `/tracking/audit/person?name=${encodeURIComponent(f.name)}&${scope}` : null,
    [f.name, scope]);

  const people = (list.data?.rows || []).filter((p) =>
    !term.trim() || p.person.toLowerCase().includes(term.trim().toLowerCase()));

  const grab = () => downloadCsv(`audit-${f.name}`, [
    ['Date', 'Document', 'Site', 'Code', 'Item', 'Unit', 'Issued or returned',
      'Quantity', 'What for', 'Recorded by'],
    ...one.data.lines.map((l) => [
      dmy(l.event_date), l.doc_no, l.site_name, l.item_code, l.item_name, l.uom,
      l.source === 'ISSUE' ? 'Issued' : 'Returned',
      l.qty, l.purpose || '', l.recorded_by_name || '',
    ]),
  ]);

  return (
    <>
      <Card title="Which person"
        sub="Names are typed on the issue, so a search matches any part of one">
        <div className="pad" style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <Field label="Search a name">
            <input className="inp" style={{ width: 260 }} value={term} placeholder="Part of a name"
              onChange={(e) => setTerm(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && set({ name: term.trim() })} />
          </Field>
          <div style={{ paddingBottom: 8, display: 'flex', gap: 6 }}>
            <button className="btn pri" onClick={() => set({ name: term.trim() })}
              disabled={!term.trim()}>Search</button>
            {f.name && <button className="btn" onClick={() => { set({ name: '' }); setTerm(''); }}>
              Clear
            </button>}
          </div>
        </div>

        {!f.name && (
          <div className="tw">
            <table>
              <thead>
                <tr><th>Person</th><th className="rt">Issues</th><th className="rt">Returns</th>
                  <th className="rt">Items</th><th className="rt">Issued</th>
                  <th className="rt">Returned</th><th className="rt">Consumed</th>
                  <th>Last seen</th></tr>
              </thead>
              <tbody>
                {people.map((p) => (
                  <tr key={p.person} style={{ cursor: 'pointer' }}
                    onClick={() => set({ name: p.person })}>
                    <td><b>{p.person}</b></td>
                    <td className="rt mono">{p.issues}</td>
                    <td className="rt mono">{p.returns || '—'}</td>
                    <td className="rt mono">{p.items}</td>
                    <td className="rt mono">{qty(p.issued_qty)}</td>
                    <td className="rt mono" style={{ color: 'var(--ok)' }}>
                      {Number(p.returned_qty) ? qty(p.returned_qty) : '—'}
                    </td>
                    <td className="rt mono"><b>{qty(p.net_qty)}</b></td>
                    <td>{dmy(p.last_on)}</td>
                  </tr>
                ))}
                {!people.length && (
                  <tr><td colSpan={8}>
                    <Empty title={list.loading ? 'Loading' : 'Nobody has drawn material here yet'}>
                      Names appear as soon as something is issued.
                    </Empty>
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {f.name && (one.loading || !one.data) && <Loading />}
      {one.error && <ErrorNote error={one.error} onRetry={one.reload} />}

      {one.data && (
        <>
          {one.data.spellings.length > 1 && (
            <Banner kind="warn" icon="!">
              &quot;{f.name}&quot; matches {one.data.spellings.length} spellings —{' '}
              {one.data.spellings.map((s) => `${s.person} (${s.line_count})`).join(', ')}.
              They are counted together below. If they are the same person, the names on the
              issues want tidying.
            </Banner>
          )}

          <div className="stats">
            <Stat n={one.data.totals.issues} label="issues" />
            <Stat n={one.data.totals.returns} label="returns" />
            <Stat n={one.data.totals.items} label="different items" />
            <Stat n={qty(one.data.totals.outstandingQty)} label="units consumed" />
            <Stat n={one.data.totals.lines} label="lines" />
          </div>

          <div className="grid2">
            <Card title="What they have used, by item"
              sub="Issued less returned — whatever did not come back was used">
              <div className="tw">
                <table>
                  <thead>
                    <tr><th>Code</th><th>Item</th><th className="rt">Issued</th>
                      <th className="rt">Returned</th><th className="rt">Consumed</th>
                      <th>Last taken</th></tr>
                  </thead>
                  <tbody>
                    {one.data.byItem.map((r) => (
                      <tr key={r.item_id} style={{ cursor: 'pointer' }}
                        onClick={() => set({ by: 'item', item: r.item_id, name: '' })}>
                        <td className="mono" style={{ color: 'var(--brand-ink)' }}>{r.item_code}</td>
                        <td>{r.item_name}</td>
                        <td className="rt mono">{qty(r.issued_qty)}</td>
                        <td className="rt mono">{qty(r.returned_qty)}</td>
                        <td className="rt mono"><b>{qty(r.net_qty)}</b></td>
                        <td>{dmy(r.last_on)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>

            <Card title="What they use most" sub="Their ten heaviest items, after returns">
              <div className="pad">
                <RankBars rows={one.data.byItem} labelKey="item_name"
                  valueKey="net_qty" format={qty} />
              </div>
            </Card>
          </div>

          <Card title={`${one.data.lines.length} line${one.data.lines.length === 1 ? '' : 's'}, with dates`}
            sub="Everything issued to them and everything handed back, newest first"
            actions={<button className="btn sm" onClick={grab}>Download</button>}>
            <div className="tw">
              <table>
                <thead>
                  <tr>
                    <th>Date</th><th>Document</th><th>Site</th><th>Code</th><th>Item</th>
                    <th style={{ width: 50 }}>Unit</th><th></th>
                    <th className="rt">Quantity</th><th>What for</th>
                  </tr>
                </thead>
                <tbody>
                  {one.data.lines.map((l) => (
                    <tr key={`${l.source}-${l.line_id}`}>
                      <td>{dmy(l.event_date)}</td>
                      <td className="mono" style={{ color: 'var(--brand-ink)' }}>{l.doc_no}</td>
                      <td style={{ color: 'var(--muted)' }}>{l.site_name}</td>
                      <td className="mono">{l.item_code}</td>
                      <td>{l.item_name}</td>
                      <td>{l.uom}</td>
                      <td>
                        <Tag kind={l.source === 'ISSUE' ? 'warn' : 'ok'}>
                          {l.source === 'ISSUE' ? 'Issued' : 'Returned'}
                        </Tag>
                      </td>
                      <td className="rt mono"><b>{qty(l.qty)}</b></td>
                      <td style={{ color: 'var(--muted)' }}>{l.purpose || l.remark || '—'}</td>
                    </tr>
                  ))}
                  {!one.data.lines.length && (
                    <tr><td colSpan={9}>
                      <Empty title={`Nothing for "${f.name}" in this window`}>
                        Check the spelling, or widen the dates.
                      </Empty>
                    </td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </>
  );
}

/* ===================================================================
   3. CUMULATIVE CONSUMPTION
   =================================================================== */
export function Consumed() {
  const { branchId, siteId } = useApp();
  const [f, set] = useFilters({
    site: String(siteId || ''), from: '', to: '', q: '', sort: 'qty', bucket: 'month',
  });

  const qs = new URLSearchParams({
    ...(branchId ? { branchId } : {}),
    ...(f.site ? { siteId: f.site } : {}),
    ...(f.from ? { from: f.from } : {}),
    ...(f.to ? { to: f.to } : {}),
    ...(f.q ? { q: f.q } : {}),
    sort: f.sort, bucket: f.bucket,
  }).toString();

  const { data, error, loading, reload } = useApi(
    `/tracking/consumed?${qs}`, [qs]);
  const rows = data?.rows || [];
  const oneDay = f.from && f.from === f.to;

  const grab = () => downloadCsv('consumption', [
    ['Code', 'Item', 'Unit', 'Consumed', 'People', 'First used', 'Last used'],
    ...rows.map((r) => [
      r.item_code, r.item_name, r.uom, r.consumed_qty,
      r.people, dmy(r.first_on), dmy(r.last_on),
    ]),
  ]);

  return (
    <>
      <PageHead title="Item consumption"
        sub="What this site has actually used — for a day, or any window"
        actions={<button className="btn" onClick={grab} disabled={!rows.length}>Download</button>} />

      <div className="page-body">
        {error && <ErrorNote error={error} onRetry={reload} />}

        <Card>
          <div className="pad" style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <SitePicker value={f.site} onChange={(v) => set({ site: v })} />
            <DateRange from={f.from} to={f.to} onChange={set} />
            <Field label="Item">
              <input className="inp" style={{ width: 200 }} value={f.q} placeholder="By name or code"
                onChange={(e) => set({ q: e.target.value })} />
            </Field>
            <Field label="Group by">
              <select className="inp" style={{ width: 120 }} value={f.bucket}
                onChange={(e) => set({ bucket: e.target.value })}>
                <option value="day">Day</option>
                <option value="week">Week</option>
                <option value="month">Month</option>
              </select>
            </Field>
            <Field label="Sort">
              <select className="inp" style={{ width: 150 }} value={f.sort}
                onChange={(e) => set({ sort: e.target.value })}>
                <option value="qty">Most used</option>
                <option value="item">By item</option>
                <option value="recent">Most recent</option>
              </select>
            </Field>
          </div>
        </Card>

        {loading || !data ? <Loading /> : (
          <>
            <div className="stats">
              <Stat n={data.totals.items} label="items used" />
              <Stat n={qty(data.totals.consumedQty)} label={oneDay
                ? `units used on ${dmy(f.from)}` : 'units consumed'} />
              <Stat n={data.totals.people} label="people" />
              <Stat n={data.totals.sites} label={data.totals.sites === 1 ? 'site' : 'sites'} />
            </div>

            <Banner kind="info" icon="Σ">
              Consumed is <b>issued less returned</b>. Anything issued and not brought back has
              been used — that is what issuing it means.{' '}
              {f.from
                ? <>This window starts at {dmy(f.from)}; the running line on the chart carries
                  the total to date.</>
                : <>With no start date, this is everything to date.</>}
            </Banner>

            <Card title="How it has run"
              sub={`By ${f.bucket} — columns are each period, the line is the running total`}>
              <div className="pad">
                <TrendChart series={data.series} bucket={f.bucket}
                  valueKey="consumed_qty" runningKey="running_qty"
                  label="units" format={qty} axis={shortNum} />
              </div>
            </Card>

            <div className="grid2">
              <Card title="What is used most" sub="Top ten items in this window">
                <div className="pad">
                  <RankBars rows={rows} labelKey="item_name" valueKey="consumed_qty"
                    format={qty} />
                </div>
              </Card>
              <Card title={data.sites.length > 1 ? 'Split by site' : 'Who used it'}
                sub={data.sites.length > 1
                  ? 'Where the consumption happened'
                  : 'The people material went to'}>
                <div className="pad">
                  {data.sites.length > 1
                    ? <RankBars rows={data.sites} labelKey="site_name"
                      valueKey="consumed_qty" format={qty} />
                    : <RankBars rows={data.people} labelKey="person"
                      valueKey="consumed_qty" format={qty} tone="warn" />}
                </div>
              </Card>
            </div>

            <Card title={`${rows.length} item${rows.length === 1 ? '' : 's'}`}
              sub={oneDay ? `Net consumed on ${dmy(f.from)}` : 'Net consumed in this window'}>
              <div className="tw">
                <table>
                  <thead>
                    <tr>
                      <th>Code</th><th>Item</th><th style={{ width: 50 }}>Unit</th>
                      <th className="rt">Consumed</th>
                      <th className="rt">People</th><th>First used</th><th>Last used</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.item_id}>
                        <td className="mono" style={{ color: 'var(--brand-ink)' }}>{r.item_code}</td>
                        <td><b>{r.item_name}</b></td>
                        <td>{r.uom}</td>
                        <td className="rt mono"><b>{qty(r.consumed_qty)}</b></td>
                        <td className="rt mono">{r.people}</td>
                        <td>{dmy(r.first_on)}</td>
                        <td>{dmy(r.last_on)}</td>
                      </tr>
                    ))}
                    {!rows.length && (
                      <tr><td colSpan={7}>
                        <Empty title={oneDay
                          ? `Nothing was consumed on ${dmy(f.from)}`
                          : 'Nothing consumed in this window'}>
                          Material is consumed when it is issued to somebody.
                        </Empty>
                      </td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </Card>
          </>
        )}
      </div>
    </>
  );
}
