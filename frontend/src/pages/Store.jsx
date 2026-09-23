import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useApp, PageHead } from '../App';
import { api, qty, units, money, dmy, today, addDays, withBranch, canWrite, plural } from '../api';
import { downloadCsv } from '../download';
import {
  useApi, Card, Empty, Loading, ErrorNote, Banner, Field, Modal, Stat, Meter, useToast, Code, Status, DateField,
} from '../components/ui';
import { PrnLink } from '../components/StorePrn';
import { Icon } from '../components/icons';
import { dcState } from '../vocab';
import { ReceiveGrn } from './Grns';

/**
 * The central store.
 *
 * One place: the branch's store. It takes material in against purchase
 * orders, holds it, and dispatches it to sites against their PRNs. A
 * site's own stock is not this — it is in the Site department, keeps no
 * rates, and holds only what the site has received.
 */

/* ===================================================================
   The desk.
   =================================================================== */
export function StoreDesk() {
  const { branchId, storeId } = useApp();
  const [receiving, setReceiving] = useState(null);
  const { data, error, loading, reload } = useApi(
    branchId && storeId ? `/store/desk?branchId=${branchId}&storeId=${storeId}` : null,
    [branchId, storeId]);

  if (error) {
    return <div className="page-body"><ErrorNote error={error} onRetry={reload} /></div>;
  }
  if (loading || !data) return <Loading />;

  const { store, toReceive, inTransit, sitesOwed, held } = data;
  const stale = inTransit.filter((d) => Number(d.days_out) > 3);

  return (
    <>
      <PageHead title="Store desk" sub={store.name}
        actions={
          <div style={{ display: 'flex', gap: 9 }}>
            <Link className="btn" to="/store/prns">PRNs to fulfil</Link>
            {canWrite('/grns') && <Link className="btn pri" to="/grns">Receive from supplier</Link>}
          </div>
        } />
      <div className="page-body">
        <div className="stats">
          <Stat n={held.items} label="items in stock" one="item in stock" />
          <Stat n={money(held.value)} label="at the last rate paid" tone="brand" />
          <Stat n={toReceive.length} label="orders coming in" one="order coming in" />
          <Stat n={qty(inTransit.reduce((t, d) => t + Number(d.in_transit_qty), 0))}
            label="units on the road to sites" one="unit on the road to sites" />
        </div>

        {stale.length > 0 && (
          <Banner kind="bad" icon="!"
            action={<Link className="btn sm" to="/challans?state=PENDING">Chase them</Link>}>
            <b>{plural(stale.length, 'challan')} on the road more than three days</b>{' '}
            and not yet received. That material has left this store's stock and is not yet in any
            site's.
          </Banner>
        )}

        <div className="grid2">
          <div>
            <Card title="Coming in" sub="Approved purchase orders being delivered to this store">
              <div className="tw">
                <table>
                  <thead>
                    <tr><th>PO</th><th>Supplier</th><th>Expected</th>
                      <th className="rt">Still to receive</th><th /></tr>
                  </thead>
                  <tbody>
                    {toReceive.map((p) => (
                      <tr key={p.po_id}>
                        <td><Link to={`/purchase-orders/${p.po_id}`}>
                          <Code as="b">{p.doc_no}</Code></Link>
                          </td>
                        <td>{p.supplier_name}</td>
                        <td>{p.expected_date ? dmy(p.expected_date) : '—'}
                          {Number(p.overdue) > 0 && (
                            <small style={{ color: 'var(--st-stop)', fontWeight: 600 }}>{plural(p.overdue, 'day')} late</small>)}</td>
                        <td className="rt mono"><b>{qty(p.pending_qty)}</b>
                          {Number(p.received_qty) > 0 && (
                            <small>{qty(p.received_qty)} already in</small>)}</td>
                        <td className="rt">
                          <button className="btn sm pri" onClick={() => setReceiving(p)}>
                            Receive
                          </button>
                        </td>
                      </tr>
                    ))}
                    {!toReceive.length && (
                      <tr><td colSpan={5}>
                        <Empty title="Nothing on its way here" />
                      </td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </Card>

            <Card title="On the road"
              sub="Dispatched from here and not yet received at the site"
              actions={<Link className="btn sm" to="/challans">All delivery challans</Link>}>
              <div className="tw">
                <table>
                  <thead>
                    <tr><th>Challan</th><th>To</th><th>For PRN</th>
                      <th className="rt">Not yet received</th><th className="rt">Days out</th></tr>
                  </thead>
                  <tbody>
                    {inTransit.map((d) => (
                      <tr key={d.dc_id}>
                        <td><Link to={`/challans/${d.dc_id}`}>
                          <Code as="b">{d.doc_no}</Code></Link>
                          <small>{dmy(d.dc_date)}{d.vehicle_no ? ` · ${d.vehicle_no}` : ''}</small></td>
                        <td>{d.to_name}</td>
                        <td><small className="mono">{d.prns || '—'}</small></td>
                        <td className="rt mono"><b>{qty(d.in_transit_qty)}</b></td>
                        <td className="rt mono">
                          {Number(d.days_out) > 3
                            ? <Status tone="attention" icon="clock" label={plural(d.days_out, 'day')} /> : Number(d.days_out) || '—'}
                        </td>
                      </tr>
                    ))}
                    {!inTransit.length && (
                      <tr><td colSpan={5}>
                        <Empty title="Nothing is on the road">
                          Everything this store dispatched has been received.
                        </Empty>
                      </td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </Card>
          </div>

          <div>
            <Card title="Sites waiting" sub="PRNs not yet delivered in full"
              actions={<Link className="btn sm" to="/store/prns">Open the list</Link>}>
              <div className="tw">
                <table>
                  <thead>
                    <tr><th>Site</th><th className="rt">PRNs</th>
                      <th className="rt">Still to deliver</th><th /></tr>
                  </thead>
                  <tbody>
                    {sitesOwed.map((s) => (
                      <tr key={s.site_id}>
                        <td><b>{s.site_name}</b><small className="mono">{s.site_code}</small>
                          {s.soonest && <small>needed {dmy(s.soonest)}</small>}</td>
                        <td className="rt mono">{s.prn_count}</td>
                        <td className="rt mono"><b>{qty(s.to_deliver_qty)}</b>
                          {Number(s.in_transit_qty) > 0 && (
                            <small>{qty(s.in_transit_qty)} on the road</small>)}</td>
                        <td className="rt">
                          <Link className="btn sm" to={`/store/issue?site=${s.site_id}`}>Dispatch</Link>
                        </td>
                      </tr>
                    ))}
                    {!sitesOwed.length && (
                      <tr><td colSpan={4}>
                        <Empty title="No site is waiting">
                          Every approved PRN has been delivered in full.
                        </Empty>
                      </td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </Card>

            <Card title="Stock">
              <div className="pad">
                <div className="stats">
                  <Stat n={held.items} label="items" one="item" />
                  <Stat n={qty(held.qty)} label="units" one="unit" />
                </div>
                <Link className="btn sm" to="/stock">Open stock</Link>{' '}
                <Link className="btn sm" to="/movements">Stock movement</Link>
              </div>
            </Card>
          </div>
        </div>
      </div>

      {receiving && (
        <ReceiveGrn poId={receiving.po_id} at={store.name} atSiteId={store.id}
          onClose={() => setReceiving(null)}
          onDone={() => { setReceiving(null); reload(); }} />
      )}
    </>
  );
}

/* ===================================================================
   PRNs. They stay here until they are fulfilled.
   =================================================================== */
export function Prns() {
  const { branchId, storeId } = useApp();
  const nav = useNavigate();
  const toast = useToast();
  const [f, setF] = useState({ q: '', siteId: '', show: 'PENDING', sort: 'needed' });
  const [picked, setPicked] = useState([]);
  const { data: sites } = useApi(withBranch('/sites', branchId), [branchId]);
  const qs = new URLSearchParams({
    ...(branchId ? { branchId } : {}),
    ...(f.q ? { q: f.q } : {}),
    ...(f.siteId ? { siteId: f.siteId } : {}),
    ...(storeId ? { storeId } : {}),
    show: f.show, sort: f.sort,
  }).toString();
  // the shelf you are standing on follows through to the sheet
  const carry = storeId ? `&store=${storeId}` : '';
  const { data, error, loading, reload } = useApi(`/store/prns?${qs}`,
    [branchId, qs]);
  const rows = data?.rows || [];

  useEffect(() => { setPicked([]); }, [qs]);

  const chosen = rows.filter((r) => picked.includes(r.indent_id));
  const sitesPicked = [...new Set(chosen.map((r) => r.site_id))];
  const mixed = sitesPicked.length > 1;

  const toggle = (id) => setPicked((p) =>
    (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  const issue = () => {
    if (!chosen.length) return toast('Tick the PRNs to dispatch against', 'bad');
    if (mixed) {
      return toast('Those PRNs are for different sites. One delivery challan goes to one site.', 'bad');
    }
    nav(`/store/issue?prns=${picked.join(',')}${carry}`);
    return undefined;
  };

  const grab = () => downloadCsv('prns-to-fulfil', [
    ['PRN', 'Raised', 'Needed by', 'Site', 'Items', 'Asked for', 'Ordered', 'Received at store',
      'Dispatched', 'On the road', 'Received at site', 'Still to deliver', 'Can send now', 'Stage'],
    ...rows.map((r) => [r.doc_no, dmy(r.indent_date), r.needed_by ? dmy(r.needed_by) : '',
      r.site_name, r.item_count, r.indented_qty, r.ordered_qty, r.received_qty, r.issued_qty,
      r.in_transit_qty, r.at_site_qty, r.to_deliver_qty, r.can_send_qty, r.stage]),
  ]);

  return (
    <>
      <PageHead title="PRNs to fulfil"
        sub={data ? `Approved PRNs ${data.store.name} still has to deliver. A PRN stays here until everything on it is received at site.` : ''}
        actions={
          <>
            <button className="btn" onClick={grab} disabled={!rows.length}><Icon name="download" size={14} />Download</button>
            {canWrite('/challans') && !chosen.length && (
              <span className="why-not"><Icon name="info" size={14} />Tick PRNs of one site to dispatch</span>
            )}
            {canWrite('/challans') && (
              <button className="btn pri" onClick={issue} disabled={!chosen.length || mixed}>
                <Icon name="truck" />{chosen.length ? `Dispatch ${plural(chosen.length, 'PRN')}` : 'Dispatch'}
              </button>
            )}
          </>
        } />
      <div className="page-body">
        {error && <ErrorNote error={error} onRetry={reload} />}

        <Card>
          <div className="pad" style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <Field label="Search">
              <input className="inp" type="search" style={{ width: 210 }} placeholder="PRN number or site…"
                value={f.q} onChange={(e) => setF((x) => ({ ...x, q: e.target.value }))} />
            </Field>
            <Field label="Site">
              <select className="inp" style={{ width: 200 }} value={f.siteId}
                onChange={(e) => setF((x) => ({ ...x, siteId: e.target.value }))}>
                <option value="">Every site</option>
                {(sites || []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </Field>
            <Field label="Show">
              <select className="inp" style={{ width: 180 }} value={f.show}
                onChange={(e) => setF((x) => ({ ...x, show: e.target.value }))}>
                <option value="PENDING">Not delivered in full</option>
                <option value="ALL">Include delivered in full</option>
              </select>
            </Field>
            <Field label="Sort by">
              <select className="inp" style={{ width: 175 }} value={f.sort}
                onChange={(e) => setF((x) => ({ ...x, sort: e.target.value }))}>
                <option value="needed">Needed soonest</option>
                <option value="oldest">Oldest raised</option>
                <option value="site">Site</option>
                <option value="outstanding">Most still to deliver</option>
              </select>
            </Field>
          </div>
        </Card>

        {data && (
          <div className="stats" style={{ margin: '16px 0' }}>
            <Stat n={data.totals.prns} label="PRNs not delivered in full" one="PRN not delivered in full" />
            <Stat n={qty(data.totals.toDeliver)} label="units still to deliver" one="unit still to deliver" />
            <Stat n={qty(data.totals.inTransit)} label="units on the road" one="unit on the road" />
            <Stat n={qty(data.totals.canSend)}
              label={`units ${data.store.name} can send now`} one={`unit ${data.store.name} can send now`} />
            <Stat n={data.totals.late} label="PRNs past their needed-by date" one="PRN past its needed-by date"
              tone={data.totals.late ? 'bad' : undefined} />
          </div>
        )}

        {mixed && (
          <Banner kind="bad">
            You ticked PRNs for <b>{sitesPicked.length} different sites</b>. A delivery challan goes to
            one site — tick PRNs of one site; several of them can go on one challan.
          </Banner>
        )}
        {chosen.length > 0 && !mixed && (
          <Banner kind="ok"
            action={<button className="btn sm pri" onClick={issue}>Dispatch these</button>}>
            <b>{plural(chosen.length, 'PRN')} for {chosen[0].site_name}</b>{' '}
            — {qty(chosen.reduce((t, r) => t + Number(r.to_deliver_qty), 0))} units still to deliver between
            them. They can go on one delivery challan.
          </Banner>
        )}

        {loading && !data ? <Loading what="PRNs" /> : (
          <Card title={plural(rows.length, 'PRN')}>
            <div className="tw">
              <table>
                <thead>
                  <tr>
                    <th style={{ width: 34 }}><span className="vh">Tick to dispatch</span></th>
                    <th>PRN</th><th>Site</th><th>Needed by</th>
                    <th className="rt">Asked for</th>
                    <th style={{ width: 170 }}>Received at site</th>
                    <th className="rt">On the road</th><th className="rt">Still to deliver</th>
                    <th className="rt">In stock to send</th><th />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const on = picked.includes(r.indent_id);
                    const clash = on && mixed;
                    return (
                      <tr key={r.indent_id}
                        style={clash ? { background: 'var(--st-stop-bg)' }
                          : on ? { background: 'var(--brand-soft)' } : undefined}>
                        <td><input type="checkbox" checked={on} aria-label={`Tick ${r.doc_no} to dispatch`}
                          onChange={() => toggle(r.indent_id)} /></td>
                        <td><PrnLink id={r.indent_id}>
                          <Code as="b">{r.doc_no}</Code></PrnLink>
                          <small>{dmy(r.indent_date)} · {plural(r.item_count, 'item')}</small></td>
                        <td>{r.site_name}<small><Code>{r.site_code}</Code></small></td>
                        <td className="mono">
                          {r.needed_by ? dmy(r.needed_by) : '—'}
                          {Number(r.days_late) > 0 && (
                            <small style={{ color: 'var(--st-stop)', fontWeight: 600 }}>{plural(r.days_late, 'day')} late</small>)}
                        </td>
                        <td className="rt mono">{qty(r.indented_qty)}</td>
                        <td>
                          <Meter value={Number(r.at_site_qty)} max={Number(r.indented_qty)} label="Received at site" />
                          <small className="mono">
                            {qty(r.at_site_qty)} of {qty(r.indented_qty)} · {qty(r.issued_qty)} dispatched
                          </small>
                        </td>
                        <td className="rt mono">
                          {Number(r.in_transit_qty) ? qty(r.in_transit_qty) : '—'}
                        </td>
                        <td className="rt mono"><b>{qty(r.to_deliver_qty)}</b></td>
                        <td className="rt mono"
                          style={{ color: Number(r.can_send_qty) > 0 ? undefined : 'var(--faint)' }}>
                          {Number(r.can_send_qty) ? <b>{qty(r.can_send_qty)}</b> : 'None in stock'}
                        </td>
                        <td className="rt" style={{ whiteSpace: 'nowrap' }}>
                          <Link className="btn sm" to={`/store/issue?prns=${r.indent_id}${carry}`}>Dispatch</Link>
                          {/* the store has not got it, but another site may have */}
                          {Number(r.to_deliver_qty) > 0 && (
                            <Link className="btn sm" style={{ marginLeft: 6 }}
                              to={`/store/source?prn=${r.indent_id}${carry}`}
                              title="The store is short: ask a site that holds it to send it across">Ask another site</Link>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                  {!rows.length && (
                    <tr><td colSpan={10}>
                      <Empty icon="check" title="No PRN is waiting for this store">
                        Every approved PRN has been delivered in full.
                      </Empty>
                    </td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        )}
      </div>
    </>
  );
}

/* ===================================================================
   The dispatch sheet: several PRNs of one site onto one challan.
   =================================================================== */
export function IssueSheet() {
  const { branchId, storeId: standing, stores } = useApp();
  const nav = useNavigate();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const prns = params.get('prns');
  const site = params.get('site');
  // the sheet may name a shelf outright; otherwise it is where you stand
  const from = params.get('store') || standing || '';

  const path = branchId
    ? `/store/issue?branchId=${branchId}`
      + `&${prns ? `indentIds=${prns}` : `siteId=${site}`}`
      + (from ? `&storeId=${from}` : '')
    : null;
  const { data, error, loading } = useApi(path, [path]);

  const [send, setSend] = useState({});
  const [head, setHead] = useState({ dcDate: today(), vehicleNo: '', driver: '', note: '' });
  const [busy, setBusy] = useState(false);

  // changing the shelf changes what can be sent, so start the sheet over
  const pickStore = (id) => {
    setSend({});
    setParams((p) => { if (id) p.set('store', id); else p.delete('store'); return p; });
  };

  const key = (l) => `${l.indentId}:${l.itemId}`;

  // several PRN rows may name the same item, and they draw on one shelf
  const perItem = useMemo(() => {
    const m = {};
    for (const l of data?.lines || []) {
      const v = Number(send[key(l)]) || 0;
      if (!m[l.itemId]) m[l.itemId] = { sending: 0, held: l.storeQty, name: l.itemName,
        code: l.itemCode, uom: l.uom };
      m[l.itemId].sending += v;
    }
    return m;
  }, [data, send]);

  const over = Object.entries(perItem).filter(([, v]) => v.sending > v.held + 0.0005);
  const shelf = Object.values(perItem);
  const shelfTotal = shelf.reduce((t, v) => t + v.held, 0);
  const shelfItems = shelf.filter((v) => v.held > 0).length;
  const lines = (data?.lines || []).filter((l) => Number(send[key(l)]) > 0);
  const total = lines.reduce((t, l) => t + Number(send[key(l)]), 0);
  const value = lines.reduce((t, l) => t + Number(send[key(l)]) * l.rate, 0);

  if (loading) return <Loading what="the dispatch sheet" />;
  if (error) {
    return (
      <div className="page-body" style={{ paddingTop: 24 }}>
        <ErrorNote error={error} />
        <Link className="btn" to="/store/prns">Back to PRNs to fulfil</Link>
      </div>
    );
  }
  if (!data) return <Loading />;

  const save = async (dispatch) => {
    if (!lines.length) return toast('Type what goes on the lorry', 'bad');
    if (over.length) return toast('More than the store holds is being sent', 'bad');
    setBusy(true);
    try {
      const r = await api.post('/challans', {
        fromSiteId: data.store.id, toSiteId: data.site.id,
        dcDate: head.dcDate,
        vehicleNo: head.vehicleNo || undefined,
        driver: head.driver || undefined,
        note: head.note || undefined,
        dispatch,
        lines: lines.map((l) => ({
          indentId: l.indentId, itemId: l.itemId, qty: Number(send[key(l)]),
        })),
      });
      toast(dispatch
        ? `${r.docNo} dispatched — ${data.site.name} confirms receipt when it arrives`
        : `${r.docNo} saved as a draft`, 'ok');
      nav(`/challans/${r.id}`);
    } catch (e) { toast(e.message, 'bad'); }
    setBusy(false);
    return undefined;
  };

  const fillAll = () => {
    // soonest-needed PRN first, capped by what the shelf holds
    const left = {};
    const next = {};
    for (const l of data.lines) {
      if (left[l.itemId] === undefined) left[l.itemId] = l.storeQty;
      const take = Math.min(l.toDeliverQty, left[l.itemId]);
      if (take > 0) { next[key(l)] = String(Math.round(take * 1000) / 1000); }
      left[l.itemId] = Math.round((left[l.itemId] - Math.max(take, 0)) * 1000) / 1000;
    }
    setSend(next);
  };

  // group the sheet by item, so two PRNs asking for the same thing sit together
  const groups = [];
  for (const l of data.lines) {
    let g = groups.find((x) => x.itemId === l.itemId);
    if (!g) { g = { itemId: l.itemId, code: l.itemCode, name: l.itemName, uom: l.uom,
      held: l.storeQty, rate: l.rate, rows: [] }; groups.push(g); }
    g.rows.push(l);
  }

  return (
    <>
      <PageHead title={`Dispatch to ${data.site.name}`}
        sub={`A delivery challan from ${data.store.name} for ${plural(data.prns.length, 'PRN')}`}
        actions={<button className="btn" onClick={() => nav('/store/prns')}><Icon name="arrowLeft" size={14} />PRNs to fulfil</button>} />
      <div className="page-body">
        <Card title="PRNs on this challan">
          <div className="pad" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {data.prns.map((p) => (
              <PrnLink key={p.indent_id} id={p.indent_id} className="chip">
                <Code as="b">{p.doc_no}</Code>
                <small>{p.needed_by ? `needed by ${dmy(p.needed_by)}` : 'no needed-by date'} · {qty(p.to_deliver_qty)} still to deliver</small>
              </PrnLink>
            ))}
          </div>
        </Card>

        <Banner kind="info">
          Several PRNs may ask for the same item. Each keeps its own row — which PRN is being
          answered matters — but they draw on <b>one stock</b>, shown once per item. What you
          dispatch leaves this store at once, and becomes {data.site.name}&apos;s stock only when they
          confirm receipt.
        </Banner>

        {over.length > 0 && (
          <Banner kind="bad">
            <b>More than the store holds is being sent:</b>{' '}
            {over.map(([, v]) => `${v.code} — sending ${qty(v.sending)} of ${qty(v.held)}`).join('; ')}.
          </Banner>
        )}

        <Card>
          <div className="pad">
            <div className="row2">
              <Field label="Dispatch from"
                hint={`${units(shelfTotal)} in stock across ${shelfItems} of these items`}>
                <select className="inp" value={String(data.store.id)}
                  onChange={(e) => pickStore(e.target.value)}>
                  {(stores || []).map((st) => (
                    <option key={st.id} value={st.id}>{st.name}</option>
                  ))}
                  {!(stores || []).some((st) => st.id === data.store.id) && (
                    <option value={data.store.id}>{data.store.name}</option>
                  )}
                </select>
              </Field>
              <Field label="To site">
                <input className="inp" disabled value={data.site.name} />
              </Field>
            </div>
            <div className="row2">
              <DateField label="Dispatch date" value={head.dcDate}
                onChange={(e) => setHead((h) => ({ ...h, dcDate: e.target.value }))} />
              <Field label="Vehicle number">
                <input className="inp code" value={head.vehicleNo} placeholder="e.g. TS09 AB 1234" spellCheck={false} autoComplete="off"
                  onChange={(e) => setHead((h) => ({ ...h, vehicleNo: e.target.value }))} />
              </Field>
            </div>
            <div className="row2">
              <Field label="Driver's name">
                <input className="inp" value={head.driver}
                  onChange={(e) => setHead((h) => ({ ...h, driver: e.target.value }))} />
              </Field>
              <Field label="Note">
                <input className="inp" value={head.note}
                  onChange={(e) => setHead((h) => ({ ...h, note: e.target.value }))} />
              </Field>
            </div>
          </div>
        </Card>

        <Card title="What to send"
          sub={`Each row is one PRN's requirement, sent from ${data.store.name}'s stock`}
          actions={
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn sm" onClick={fillAll}
                title="Fill every row from stock, soonest-needed PRN first">Fill from stock</button>
              <button className="btn sm" onClick={() => setSend({})}>Clear</button>
            </div>
          }>
          <div className="tw">
            <table className="sheet">
              <thead>
                <tr>
                  <th style={{ width: 110 }}>Item code</th><th style={{ minWidth: 190 }}>Item</th>
                  <th style={{ width: 56 }}>Unit</th>
                  <th className="rt" style={{ width: 108 }}>In stock</th>
                  <th style={{ width: 150 }}>For PRN</th>
                  <th className="rt" style={{ width: 100 }}>Still to deliver</th>
                  <th className="rt" style={{ width: 92 }}>On the road</th>
                  <th className="rt" style={{ width: 100 }}>Send now</th>
                </tr>
              </thead>
              <tbody>
                {groups.map((g) => {
                  const p = perItem[g.itemId] || { sending: 0 };
                  const short = p.sending > g.held + 0.0005;
                  return (
                    <>
                      {g.rows.map((l, i) => (
                        <tr key={key(l)}
                          style={Number(send[key(l)]) > 0 ? { background: 'var(--brand-soft)' } : undefined}>
                          {i === 0 && (
                            <>
                              <td rowSpan={g.rows.length} style={{ verticalAlign: 'top' }}>
                                <Code>{g.code}</Code>
                              </td>
                              <td rowSpan={g.rows.length} style={{ verticalAlign: 'top' }}>
                                <b>{l.itemName}</b>
                                {g.rows.length > 1 && (
                                  <small>{g.rows.length} PRNs want this — one stock between them</small>
                                )}
                              </td>
                              <td rowSpan={g.rows.length} style={{ verticalAlign: 'top' }}>{g.uom}</td>
                              <td rowSpan={g.rows.length} className="rt mono"
                                style={{ verticalAlign: 'top' }}>
                                <b style={{ color: g.held > 0 ? undefined : 'var(--faint)' }}>
                                  {qty(g.held)}
                                </b>
                                {p.sending > 0 && (
                                  <small style={{ color: short ? 'var(--st-stop)' : 'var(--muted)', fontWeight: short ? 600 : 400 }}>
                                    {short
                                      ? `${qty(p.sending - g.held)} short`
                                      : `${qty(g.held - p.sending)} left after this`}
                                  </small>
                                )}
                              </td>
                            </>
                          )}
                          <td><PrnLink id={l.indentId}><Code>{l.prnNo}</Code></PrnLink>
                            {l.neededBy && <small>needed by {dmy(l.neededBy)}</small>}</td>
                          <td className="rt mono"><b>{qty(l.toDeliverQty)}</b></td>
                          <td className="rt mono">
                            {l.inTransitQty ? qty(l.inTransitQty) : '—'}
                          </td>
                          <td><input className="inp rt" type="number" min="0" step="any" inputMode="decimal"
                            placeholder="0" value={send[key(l)] ?? ''} aria-label={`Quantity to send for ${l.prnNo}`}
                            onChange={(e) => setSend((x) => ({ ...x, [key(l)]: e.target.value }))} /></td>
                        </tr>
                      ))}
                    </>
                  );
                })}
                {!data.lines.length && (
                  <tr><td colSpan={8}>
                    <Empty title="Nothing is still to deliver on those PRNs">
                      Everything they asked for has been received at the site.
                    </Empty>
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>

        <Card>
          <div className="pad" style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
            <Stat n={lines.length} label="rows" one="row" />
            <Stat n={qty(total)} label="units going on the lorry" one="unit going on the lorry" />
            <div style={{ flex: 1 }} />
            {!lines.length && <span className="why-not"><Icon name="info" size={14} />Type a quantity to send, or use Fill from stock</span>}
            <button className="btn" disabled={busy || over.length > 0 || !lines.length}
              onClick={() => save(false)}>Save as draft</button>
            <button className="btn pri" disabled={busy || over.length > 0 || !lines.length}
              onClick={() => save(true)}><Icon name="truck" />Dispatch challan</button>
          </div>
        </Card>
      </div>
    </>
  );
}

/* ===================================================================
   The central store's stock.
   =================================================================== */
export function Stock() {
  const { branchId, storeId } = useApp();
  const [f, setF] = useState({ q: '', sort: 'item', hideEmpty: true });
  const [open, setOpen] = useState(null);
  const qs = new URLSearchParams({
    ...(branchId ? { branchId } : {}),
    ...(storeId ? { storeId } : {}),
    ...(f.q ? { q: f.q } : {}),
    sort: f.sort, hideEmpty: String(f.hideEmpty),
  }).toString();
  const { data, error, loading, reload } = useApi(`/store/stock?${qs}`,
    [branchId, qs]);
  const rows = data?.rows || [];

  const grab = () => downloadCsv('store-stock', [
    ['Item code', 'Item', 'Unit', 'In stock', 'Latest rate', 'Value', 'On the road to sites',
      'Sites still need', 'Last moved'],
    ...rows.map((r) => [r.item_code, r.item_name, r.uom, r.qty, r.latest_rate, r.value,
      r.out_in_transit, r.demand_qty, r.last_moved ? dmy(r.last_moved) : '']),
  ]);

  return (
    <>
      <PageHead title="Stock" sub={data ? `What ${data.store.name} holds now, valued at the last rate paid` : ''}
        actions={<button className="btn" onClick={grab} disabled={!rows.length}><Icon name="download" size={14} />Download</button>} />
      <div className="page-body">
        {error && <ErrorNote error={error} onRetry={reload} />}

        <Card>
          <div className="pad" style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <Field label="Find an item" hint="By name or code">
              <input className="inp" type="search" style={{ width: 280 }} value={f.q} spellCheck={false}
                placeholder="e.g. cable, switch, FLC-0187…"
                onChange={(e) => setF((x) => ({ ...x, q: e.target.value }))} />
            </Field>
            <Field label="Sort by">
              <select className="inp" style={{ width: 170 }} value={f.sort}
                onChange={(e) => setF((x) => ({ ...x, sort: e.target.value }))}>
                <option value="item">Item name</option>
                <option value="qty">Most held</option>
                <option value="value">Largest value</option>
                <option value="moved">Recently moved</option>
              </select>
            </Field>
            <label style={{ display: 'flex', gap: 6, alignItems: 'center', paddingBottom: 8 }}>
              <input type="checkbox" checked={f.hideEmpty}
                onChange={(e) => setF((x) => ({ ...x, hideEmpty: e.target.checked }))} />
              Hide items with nothing left
            </label>
          </div>
        </Card>

        {data && (
          <div className="stats" style={{ margin: '16px 0' }}>
            <Stat n={data.totals.items} label="items in stock" one="item in stock" />
            <Stat n={qty(data.totals.qty)} label="units" one="unit" />
            <Stat n={money(data.totals.value)} label="value at the last rate paid" />
            <Stat n={data.totals.short} label="items short of what sites need" one="item short of what sites need"
              tone={data.totals.short ? 'bad' : undefined} />
          </div>
        )}

        {loading && !data ? <Loading what="stock" /> : (
          <Card title={plural(rows.length, 'item')} sub="Select an item to see every movement">
            <div className="tw">
              <table>
                <thead>
                  <tr>
                    <th style={{ width: 110 }}>Item code</th><th>Item</th><th style={{ width: 56 }}>Unit</th>
                    <th className="rt">In stock</th><th className="rt">On the road to sites</th>
                    <th className="rt">Sites still need</th>
                    <th>Last moved</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const short = Number(r.demand_qty) > Number(r.qty);
                    return (
                      <tr key={r.item_id} className="click" tabIndex={0}
                        onClick={() => setOpen(r.item_id)}
                        onKeyDown={(e) => { if (e.key === 'Enter') setOpen(r.item_id); }}>
                        <td><Code>{r.item_code}</Code></td>
                        <td><b>{r.item_name}</b></td>
                        <td>{r.uom}</td>
                        <td className="rt mono"><b>{qty(r.qty)}</b></td>
                        <td className="rt mono">
                          {Number(r.out_in_transit) ? qty(r.out_in_transit) : '—'}
                        </td>
                        <td className="rt mono">
                          {Number(r.demand_qty) ? qty(r.demand_qty) : '—'}
                          {short && <small style={{ color: 'var(--st-stop)', fontWeight: 600 }}>
                            short by {qty(Number(r.demand_qty) - Number(r.qty))}</small>}
                        </td>
                        <td className="mono">{r.last_moved ? dmy(r.last_moved) : '—'}</td>
                      </tr>
                    );
                  })}
                  {!rows.length && (
                    <tr><td colSpan={7}>
                      <Empty title={f.q ? `No item in stock matches “${f.q}”` : 'This store holds nothing yet'}>
                        {f.q ? 'Try fewer words, or part of the code.' : 'Stock arrives when a supplier\'s delivery is received (GRN).'}
                      </Empty>
                    </td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        )}
      </div>

      {open && <ItemCard itemId={open} onClose={() => setOpen(null)} />}
    </>
  );
}

/** One item's whole story on this shelf. */
function ItemCard({ itemId, onClose }) {
  const { branchId, storeId } = useApp();
  const [peek, setPeek] = useState(null);
  const { data, loading } = useApi(
    `/store/stock/${itemId}?branchId=${branchId}${storeId ? `&storeId=${storeId}` : ''}`,
    [itemId, branchId, storeId]);
  if (loading || !data) return <Modal title="Item" onClose={onClose}><Loading what="the item" /></Modal>;
  if (peek) return <DocPeek doc={peek} onClose={() => setPeek(null)} />;

  return (
    <Modal wide title={data.item.name} sub={`${data.item.code} · at ${data.store.name}`}
      onClose={onClose}
      footer={<button className="btn" onClick={onClose}>Close</button>}>
      <div className="stats">
        <Stat n={`${qty(data.balance?.qty || 0)} ${data.item.uom}`} label="in stock now" />
      </div>
      <div className="tw" style={{ maxHeight: 420, overflowY: 'auto' }}>
        <table>
          <thead>
            <tr><th>Date</th><th>Document</th><th>What happened</th>
              <th className="rt">In</th><th className="rt">Out</th></tr>
          </thead>
          <tbody>
            {data.moves.map((m) => (
              <tr key={m.id}>
                <td className="mono">{dmy(m.moved_on)}</td>
                <td><DocLink refType={m.ref_type} refId={m.ref_id} refNo={m.ref_no}
                  onPeek={setPeek} /></td>
                <td>{KIND[m.kind] || m.kind}</td>
                <td className="rt mono">{Number(m.qty) > 0 ? `+${qty(m.qty)}` : ''}</td>
                <td className="rt mono">{Number(m.qty) < 0 ? `−${qty(Math.abs(m.qty))}` : ''}</td>
              </tr>
            ))}
            {!data.moves.length && (
              <tr><td colSpan={5}><Empty title="This item has never moved here" /></td></tr>
            )}
          </tbody>
        </table>
      </div>
    </Modal>
  );
}

/* ===================================================================
   Movement, read as documents.
   =================================================================== */
const KIND = {
  GRN: 'Received from supplier (GRN)',
  DC_OUT: 'Dispatched on a delivery challan',
  DC_IN: 'Received off a delivery challan',
  ADJUST: 'Stock adjustment',
  RETURN: 'Taken back from a worker',
  ISSUE: 'Issued to a worker',
};

/**
 * A document in the ledger.
 *
 * A movement line says a quantity moved; it does not say what the lorry
 * had on it. Clicking opens the document where you are standing, rather
 * than navigating away and losing the window you were reading.
 */
export const DocLink = ({ refType, refId, refNo, onPeek }) => {
  if (!refNo) return <span style={{ color: 'var(--faint)' }}>—</span>;
  const to = refType === 'DC' ? `/challans/${refId}`
    : refType === 'GRN' ? `/grns/${refId}` : null;
  if (!to) return <Code>{refNo}</Code>;
  // where a screen can open the document in place, it does; otherwise
  // the number stays an ordinary link rather than a dead button
  return onPeek
    ? (
      <button type="button" className="linkish"
        onClick={(e) => { e.stopPropagation(); onPeek({ refType, refId }); }}>
        <Code>{refNo}</Code>
      </button>
    )
    : <Link to={to} className="linkish"><Code>{refNo}</Code></Link>;
};


/** What was in it, without leaving the screen that named it. */
export function DocPeek({ doc, onClose }) {
  const { data, loading, error } = useApi(
    `/store/document/${doc.refType}/${doc.refId}`, [doc.refType, doc.refId]);

  if (loading || !data) {
    return (
      <Modal wide title="Document" onClose={onClose}>
        {error ? <ErrorNote error={error} /> : <Loading what="the document" />}
      </Modal>
    );
  }
  const st = dcState(data.state);
  const isDc = data.refType === 'DC';

  return (
    <Modal wide title={data.docNo} sub={`${data.kind} · ${dmy(data.date)}`}
      onClose={onClose}
      footer={<>
        <button className="btn" onClick={onClose}>Close</button>
        <Link className="btn pri" to={data.href}>Open the full document</Link>
      </>}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 12,
        flexWrap: 'wrap' }}>
        <Status is={st} />
        <span style={{ color: 'var(--muted)', fontSize: 12.5 }}>
          {data.from} → {data.to}
          {data.vehicle ? ` · ${data.vehicle}` : ''}
          {data.supplierDc ? ` · supplier's DC ${data.supplierDc}` : ''}
          {data.by ? ` · ${data.by}` : ''}
        </span>
      </div>

      {isDc && data.prns?.length > 0 && (
        <p style={{ color: 'var(--muted)', fontSize: 12.5, marginTop: 0 }}>
          For <Code as="b">{data.prns.join(', ')}</Code>
        </p>
      )}
      {!isDc && data.po && (
        <p style={{ color: 'var(--muted)', fontSize: 12.5, marginTop: 0 }}>
          Against <Link className="linkish" to={`/purchase-orders/${data.po.id}`}><Code>{data.po.docNo}</Code></Link>
        </p>
      )}

      <div className="stats">
        <Stat n={data.totals.lines} label="items" one="item" />
        <Stat n={qty(data.totals.qty)} label={isDc ? 'units dispatched' : 'units received'} one={isDc ? 'unit dispatched' : 'unit received'} />
        {isDc
          ? <Stat n={qty(data.totals.inTransit)} label="units not yet received at site" one="unit not yet received at site" />
          : null}
      </div>

      <div className="tw" style={{ maxHeight: 400, overflowY: 'auto' }}>
        <table className="sheet">
          <thead>
            <tr>
              <th style={{ width: 110 }}>Item code</th><th>Item</th><th style={{ width: 56 }}>Unit</th>
              <th className="rt">{isDc ? 'Dispatched' : 'Received'}</th>
              {isDc
                ? <><th className="rt">Received at site</th><th className="rt">On the road</th></>
                : <th className="rt">Ordered</th>}
            </tr>
          </thead>
          <tbody>
            {data.lines.map((l, i) => (
              <tr key={i}>
                <td><Code>{l.item_code}</Code></td>
                <td>{l.item_name}{l.make_name && <small>{l.make_name}</small>}</td>
                <td>{l.uom}</td>
                <td className="rt mono"><b>{qty(l.qty)}</b></td>
                {isDc ? (
                  <>
                    <td className="rt mono">{Number(l.acked_qty) ? qty(l.acked_qty) : '—'}</td>
                    <td className="rt mono">
                      {Number(l.in_transit_qty) ? qty(l.in_transit_qty) : '—'}
                    </td>
                  </>
                ) : (
                  <td className="rt mono">{qty(l.ordered_qty)}</td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Modal>
  );
}

export function Movements() {
  const { branchId, storeId } = useApp();
  const [view, setView] = useState('docs');
  const [peek, setPeek] = useState(null);
  const [f, setF] = useState({ from: '', to: '', kind: '', direction: 'ALL', q: '' });
  const qs = new URLSearchParams({
    ...(branchId ? { branchId } : {}),
    ...(storeId ? { storeId } : {}),
    ...(f.q ? { q: f.q } : {}),
    ...(f.kind ? { kind: f.kind } : {}),
    ...(f.from ? { from: f.from } : {}),
    ...(f.to ? { to: f.to } : {}),
    direction: f.direction,
  }).toString();
  const { data, error, loading, reload } = useApi(`/store/movements?${qs}`,
    [branchId, qs]);
  const rows = data?.rows || [];
  const docs = data?.docs || [];

  const range = (from, to) => setF((x) => ({ ...x, from, to }));
  const d = today();

  const grab = () => downloadCsv('stock-movement', [
    ['Date', 'Document', 'What happened', 'Item code', 'Item', 'Unit', 'In', 'Out', 'Rate', 'Value', 'By'],
    ...rows.map((r) => [dmy(r.moved_on), r.ref_no || '', KIND[r.kind] || r.kind,
      r.item_code, r.item_name, r.uom,
      Number(r.qty) > 0 ? r.qty : '', Number(r.qty) < 0 ? Math.abs(r.qty) : '',
      r.rate, r.value, r.by_name || '']),
  ]);

  return (
    <>
      <PageHead title="Stock movement"
        sub="Every GRN and delivery challan that moved stock in or out of this store"
        actions={<button className="btn" onClick={grab} disabled={!rows.length}><Icon name="download" size={14} />Download</button>} />
      <div className="page-body">
        {error && <ErrorNote error={error} onRetry={reload} />}

        <Card>
          <div className="pad" style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <Field label="From">
              <input className="inp" type="date" style={{ width: 148 }} value={f.from}
                onChange={(e) => setF((x) => ({ ...x, from: e.target.value }))} />
            </Field>
            <Field label="To">
              <input className="inp" type="date" style={{ width: 148 }} value={f.to}
                onChange={(e) => setF((x) => ({ ...x, to: e.target.value }))} />
            </Field>
            <div style={{ display: 'flex', gap: 6, paddingBottom: 8 }}>
              <button className="btn sm" onClick={() => range(d, d)}>Today</button>
              <button className="btn sm" onClick={() => range(addDays(d, -1), addDays(d, -1))}>
                Yesterday
              </button>
              <button className="btn sm" onClick={() => range(addDays(d, -6), d)}>Last 7 days</button>
              <button className="btn sm" onClick={() => range('', '')}>All time</button>
            </div>
            <Field label="What happened">
              <select className="inp" style={{ width: 240 }} value={f.kind}
                onChange={(e) => setF((x) => ({ ...x, kind: e.target.value }))}>
                <option value="">Everything</option>
                <option value="GRN">Received from supplier (GRN)</option>
                <option value="DC_OUT">Dispatched on a delivery challan</option>
              </select>
            </Field>
            <Field label="Direction">
              <select className="inp" style={{ width: 130 }} value={f.direction}
                onChange={(e) => setF((x) => ({ ...x, direction: e.target.value }))}>
                <option value="ALL">Both ways</option>
                <option value="IN">In</option>
                <option value="OUT">Out</option>
              </select>
            </Field>
            <Field label="Search">
              <input className="inp" type="search" style={{ width: 190 }} placeholder="Item or document…"
                value={f.q} onChange={(e) => setF((x) => ({ ...x, q: e.target.value }))} />
            </Field>
          </div>
        </Card>

        {data && (
          <div className="stats" style={{ margin: '16px 0' }}>
            <Stat n={data.totals.docs} label="documents" one="document" />
            <Stat n={data.totals.moves} label="lines" one="line" />
            <Stat n={qty(data.totals.inQty)} label="units in" one="unit in" />
            <Stat n={qty(data.totals.outQty)} label="units out" one="unit out" />
          </div>
        )}

        <div className="seg" role="group" aria-label="Show movement" style={{ marginBottom: 14 }}>
          <button type="button" aria-pressed={view === 'docs'} className={view === 'docs' ? 'on' : ''} onClick={() => setView('docs')}>
            By document
          </button>
          <button type="button" aria-pressed={view === 'lines'} className={view === 'lines' ? 'on' : ''} onClick={() => setView('lines')}>
            Every line
          </button>
        </div>

        {loading && !data ? <Loading what="stock movement" /> : view === 'docs' ? (
          <Card title={plural(docs.length, 'document')}
            sub="Select one to see the items on it">
            <div className="tw">
              <table>
                <thead>
                  <tr><th>Document</th><th>Date</th><th>What happened</th><th className="rt">Items</th>
                    <th className="rt">Units</th><th>By</th></tr>
                </thead>
                <tbody>
                  {docs.map((x) => (
                    <tr key={`${x.refType}:${x.refId}`} className="click" tabIndex={0}
                      onClick={() => setPeek({ refType: x.refType, refId: x.refId })}
                      onKeyDown={(e) => { if (e.key === 'Enter') setPeek({ refType: x.refType, refId: x.refId }); }}>
                      <td><DocLink refType={x.refType} refId={x.refId} refNo={x.refNo}
                        onPeek={setPeek} /></td>
                      <td className="mono">{dmy(x.movedOn)}</td>
                      <td>
                        <Status tone="neutral" icon={x.direction === 'IN' ? 'arrowLeft' : 'arrowRight'}
                          label={x.direction === 'IN' ? 'In' : 'Out'} />{' '}
                        {KIND[x.kind] || x.kind}
                      </td>
                      <td className="rt mono">{x.lines}</td>
                      <td className="rt mono">{qty(x.qty)}</td>
                      <td>{x.byName || '—'}</td>
                    </tr>
                  ))}
                  {!docs.length && (
                    <tr><td colSpan={6}>
                      <Empty title="Nothing moved in this period">
                        Widen the dates, or clear the filters.
                      </Empty>
                    </td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        ) : (
          <Card title={plural(rows.length, 'line')}>
            <div className="tw">
              <table>
                <thead>
                  <tr><th>Date</th><th>Document</th><th>Item</th><th>What happened</th>
                    <th className="rt">In</th><th className="rt">Out</th><th>By</th></tr>
                </thead>
                <tbody>
                  {rows.map((m) => (
                    <tr key={m.id}>
                      <td className="mono">{dmy(m.moved_on)}</td>
                      <td><DocLink refType={m.ref_type} refId={m.ref_id} refNo={m.ref_no}
                        onPeek={setPeek} /></td>
                      <td>{m.item_name}<small><Code>{m.item_code}</Code> · {m.uom}</small></td>
                      <td>{KIND[m.kind] || m.kind}</td>
                      <td className="rt mono">{Number(m.qty) > 0 ? `+${qty(m.qty)}` : ''}</td>
                      <td className="rt mono">{Number(m.qty) < 0 ? `−${qty(Math.abs(m.qty))}` : ''}</td>
                      <td>{m.by_name || '—'}</td>
                    </tr>
                  ))}
                  {!rows.length && (
                    <tr><td colSpan={7}><Empty title="Nothing moved in this period" /></td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        )}
      </div>

      {peek && <DocPeek doc={peek} onClose={() => setPeek(null)} />}
    </>
  );
}
