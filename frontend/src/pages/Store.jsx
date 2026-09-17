import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useApp, PageHead } from '../App';
import { api, qty, money, dmy, today, addDays } from '../api';
import { downloadCsv } from '../download';
import {
  useApi, Card, Tag, Empty, Loading, ErrorNote, Banner, Field, Modal, Stat, Meter, useToast,
} from '../components/ui';
import { ReceiveGrn } from './Grns';

/**
 * The central store.
 *
 * One place: the branch's store. It takes material in against purchase
 * orders, holds it, and issues it out to sites against their PRNs. A
 * site's own store is not this — it is in the Site department, keeps no
 * rates, and holds only what the site has signed for.
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
            <Link className="btn pri" to="/grns">Acknowledge a delivery</Link>
          </div>
        } />
      <div className="page-body">
        <div className="stats">
          <Stat n={held.items} label="items on the shelf" />
          <Stat n={money(held.value)} label="at the last rate paid" tone="brand" />
          <Stat n={toReceive.length} label="orders coming in" />
          <Stat n={qty(inTransit.reduce((t, d) => t + Number(d.in_transit_qty), 0))}
            label="out, unsigned" tone={inTransit.length ? 'warn' : undefined} />
        </div>

        {stale.length > 0 && (
          <Banner kind="bad" icon="!"
            action={<Link className="btn sm" to="/challans?state=PENDING">Chase them</Link>}>
            <b>{stale.length} challan{stale.length === 1 ? '' : 's'} out more than three days</b>{' '}
            with nobody signing. That material is off this store&apos;s books and not yet on any
            site&apos;s.
          </Banner>
        )}

        <div className="grid2">
          <div>
            <Card title="Coming in" sub="Signed orders directed at this store">
              <div className="tw">
                <table>
                  <thead>
                    <tr><th>Order</th><th>Supplier</th><th>Expected</th>
                      <th className="rt">Still owed</th><th /></tr>
                  </thead>
                  <tbody>
                    {toReceive.map((p) => (
                      <tr key={p.po_id}>
                        <td><Link to={`/purchase-orders/${p.po_id}`}>
                          <b className="mono">{p.doc_no}</b></Link>
                          </td>
                        <td>{p.supplier_name}</td>
                        <td>{p.expected_date ? dmy(p.expected_date) : '—'}
                          {Number(p.overdue) > 0 && (
                            <small style={{ color: 'var(--bad)' }}>{p.overdue}d late</small>)}</td>
                        <td className="rt mono"><b>{qty(p.pending_qty)}</b>
                          {Number(p.received_qty) > 0 && (
                            <small>{qty(p.received_qty)} already in</small>)}</td>
                        <td className="rt">
                          <button className="btn sm pri" onClick={() => setReceiving(p)}>
                            Acknowledge
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

            <Card title="Out, and nobody has signed"
              sub="Dispatched from here, not yet acknowledged at the site"
              actions={<Link className="btn sm" to="/challans">All challans</Link>}>
              <div className="tw">
                <table>
                  <thead>
                    <tr><th>Challan</th><th>To</th><th>Answering</th>
                      <th className="rt">Unsigned</th><th className="rt">Days out</th></tr>
                  </thead>
                  <tbody>
                    {inTransit.map((d) => (
                      <tr key={d.dc_id}>
                        <td><Link to={`/challans/${d.dc_id}`}>
                          <b className="mono">{d.doc_no}</b></Link>
                          <small>{dmy(d.dc_date)}{d.vehicle_no ? ` · ${d.vehicle_no}` : ''}</small></td>
                        <td>{d.to_name}</td>
                        <td><small className="mono">{d.prns || '—'}</small></td>
                        <td className="rt mono" style={{ color: 'var(--bad)' }}>
                          <b>{qty(d.in_transit_qty)}</b></td>
                        <td className="rt mono">
                          {Number(d.days_out) > 3
                            ? <Tag kind="bad">{d.days_out}</Tag> : Number(d.days_out) || '—'}
                        </td>
                      </tr>
                    ))}
                    {!inTransit.length && (
                      <tr><td colSpan={5}>
                        <Empty title="Nothing on the road">
                          Everything this store has sent has been signed for.
                        </Empty>
                      </td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </Card>
          </div>

          <div>
            <Card title="Sites waiting" sub="PRNs still owed something"
              actions={<Link className="btn sm" to="/store/prns">Open the list</Link>}>
              <div className="tw">
                <table>
                  <thead>
                    <tr><th>Site</th><th className="rt">PRNs</th>
                      <th className="rt">Still owed</th><th /></tr>
                  </thead>
                  <tbody>
                    {sitesOwed.map((s) => (
                      <tr key={s.site_id}>
                        <td><b>{s.site_name}</b><small className="mono">{s.site_code}</small>
                          {s.soonest && <small>needed {dmy(s.soonest)}</small>}</td>
                        <td className="rt mono">{s.prn_count}</td>
                        <td className="rt mono"><b>{qty(s.to_deliver_qty)}</b>
                          {Number(s.in_transit_qty) > 0 && (
                            <small style={{ color: 'var(--warn)' }}>
                              {qty(s.in_transit_qty)} on the road</small>)}</td>
                        <td className="rt">
                          <Link className="btn sm" to={`/store/issue?site=${s.site_id}`}>Issue</Link>
                        </td>
                      </tr>
                    ))}
                    {!sitesOwed.length && (
                      <tr><td colSpan={4}>
                        <Empty title="Nobody is waiting">
                          Every approved PRN has been fulfilled.
                        </Empty>
                      </td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </Card>

            <Card title="The shelf">
              <div className="pad">
                <div className="stats">
                  <Stat n={held.items} label="items" />
                  <Stat n={qty(held.qty)} label="units" />
                </div>
                <Link className="btn sm" to="/stock">Open the stock</Link>{' '}
                <Link className="btn sm" to="/movements">Movement</Link>
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
  const { data: sites } = useApi(branchId ? `/sites?branchId=${branchId}` : null, [branchId]);
  const qs = new URLSearchParams({
    ...(branchId ? { branchId } : {}),
    ...(f.q ? { q: f.q } : {}),
    ...(f.siteId ? { siteId: f.siteId } : {}),
    ...(storeId ? { storeId } : {}),
    show: f.show, sort: f.sort,
  }).toString();
  // the shelf you are standing on follows through to the sheet
  const carry = storeId ? `&store=${storeId}` : '';
  const { data, error, loading, reload } = useApi(branchId ? `/store/prns?${qs}` : null,
    [branchId, qs]);
  const rows = data?.rows || [];

  useEffect(() => { setPicked([]); }, [qs]);

  const chosen = rows.filter((r) => picked.includes(r.indent_id));
  const sitesPicked = [...new Set(chosen.map((r) => r.site_id))];
  const mixed = sitesPicked.length > 1;

  const toggle = (id) => setPicked((p) =>
    (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  const issue = () => {
    if (!chosen.length) return toast('Pick the PRNs to issue against', 'bad');
    if (mixed) {
      return toast('Those PRNs are for different sites. One challan goes to one site.', 'bad');
    }
    nav(`/store/issue?prns=${picked.join(',')}${carry}`);
    return undefined;
  };

  const grab = () => downloadCsv('prns-to-fulfil', [
    ['PRN', 'Date', 'Needed by', 'Site', 'Items', 'Asked', 'Ordered', 'At store',
      'Sent', 'On the road', 'At site', 'Still owed', 'Can send now', 'Stage'],
    ...rows.map((r) => [r.doc_no, dmy(r.indent_date), r.needed_by ? dmy(r.needed_by) : '',
      r.site_name, r.item_count, r.indented_qty, r.ordered_qty, r.received_qty, r.issued_qty,
      r.in_transit_qty, r.at_site_qty, r.to_deliver_qty, r.can_send_qty, r.stage]),
  ]);

  return (
    <>
      <PageHead title="PRNs to fulfil"
        sub={data ? `${data.store.name} — a PRN stays here until it is fully fulfilled` : ''}
        actions={
          <div style={{ display: 'flex', gap: 9 }}>
            <button className="btn" onClick={grab} disabled={!rows.length}>Download</button>
            <button className="btn pri" onClick={issue} disabled={!chosen.length}>
              {chosen.length ? `Issue against ${chosen.length}` : 'Issue'}
            </button>
          </div>
        } />
      <div className="page-body">
        {error && <ErrorNote error={error} onRetry={reload} />}

        <Card>
          <div className="pad" style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <Field label="Search">
              <input className="inp" style={{ width: 210 }} placeholder="PRN or site"
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
                <option value="PENDING">Still owed something</option>
                <option value="ALL">Fulfilled ones too</option>
              </select>
            </Field>
            <Field label="Sort by">
              <select className="inp" style={{ width: 175 }} value={f.sort}
                onChange={(e) => setF((x) => ({ ...x, sort: e.target.value }))}>
                <option value="needed">Needed soonest</option>
                <option value="oldest">Oldest raised</option>
                <option value="site">Site</option>
                <option value="outstanding">Most outstanding</option>
              </select>
            </Field>
          </div>
        </Card>

        {data && (
          <div className="stats">
            <Stat n={data.totals.prns} label="PRNs open" />
            <Stat n={qty(data.totals.toDeliver)} label="still owed" />
            <Stat n={qty(data.totals.inTransit)} label="on the road"
              tone={data.totals.inTransit ? 'warn' : undefined} />
            <Stat n={qty(data.totals.canSend)}
              label={`${data.store.name} can answer now`} tone="brand" />
            <Stat n={data.totals.late} label="past their date"
              tone={data.totals.late ? 'bad' : undefined} />
          </div>
        )}

        {mixed && (
          <Banner kind="bad" icon="!">
            You have picked PRNs for <b>{sitesPicked.length} different sites</b>. A lorry goes to
            one place — pick PRNs of the same site, or several can ride on one challan.
          </Banner>
        )}
        {chosen.length > 0 && !mixed && (
          <Banner kind="ok" icon="✓"
            action={<button className="btn sm pri" onClick={issue}>Issue against these</button>}>
            <b>{chosen.length} PRN{chosen.length === 1 ? '' : 's'} for {chosen[0].site_name}</b>{' '}
            — {qty(chosen.reduce((t, r) => t + Number(r.to_deliver_qty), 0))} still owed between
            them. They can travel on one challan.
          </Banner>
        )}

        {loading ? <Loading /> : (
          <Card title={`${rows.length} PRN${rows.length === 1 ? '' : 's'}`}>
            <div className="tw">
              <table>
                <thead>
                  <tr>
                    <th style={{ width: 34 }} />
                    <th>PRN</th><th>Site</th><th>Needed</th>
                    <th className="rt">Asked</th>
                    <th style={{ width: 160 }}>Where it has got to</th>
                    <th className="rt">On the road</th><th className="rt">Still owed</th>
                    <th className="rt">Can send</th><th />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const on = picked.includes(r.indent_id);
                    const clash = on && mixed;
                    return (
                      <tr key={r.indent_id}
                        style={clash ? { background: 'var(--bad-soft, #fee)' }
                          : on ? { background: 'var(--brand-soft)' } : undefined}>
                        <td><input type="checkbox" checked={on}
                          onChange={() => toggle(r.indent_id)} /></td>
                        <td><Link to={`/indents/${r.indent_id}`}>
                          <b className="mono">{r.doc_no}</b></Link>
                          <small>{dmy(r.indent_date)} · {r.item_count} item{r.item_count === 1 ? '' : 's'}</small></td>
                        <td>{r.site_name}<small className="mono">{r.site_code}</small></td>
                        <td>
                          {r.needed_by ? dmy(r.needed_by) : '—'}
                          {Number(r.days_late) > 0 && (
                            <small style={{ color: 'var(--bad)' }}>{r.days_late}d late</small>)}
                        </td>
                        <td className="rt mono">{qty(r.indented_qty)}</td>
                        <td>
                          <Meter value={Number(r.at_site_qty)} max={Number(r.indented_qty)} />
                          <small className="mono">
                            {qty(r.at_site_qty)} at site · {qty(r.issued_qty)} sent
                          </small>
                        </td>
                        <td className="rt mono">
                          {Number(r.in_transit_qty)
                            ? <Tag kind="warn">{qty(r.in_transit_qty)}</Tag> : '—'}
                        </td>
                        <td className="rt mono"><b>{qty(r.to_deliver_qty)}</b></td>
                        <td className="rt mono"
                          style={{ color: Number(r.can_send_qty) > 0 ? 'var(--ok)' : 'var(--faint)' }}>
                          {Number(r.can_send_qty) ? qty(r.can_send_qty) : 'nothing held'}
                        </td>
                        <td className="rt" style={{ whiteSpace: 'nowrap' }}>
                          <Link className="btn sm" to={`/store/issue?prns=${r.indent_id}${carry}`}>Issue</Link>
                          {/* the store has not got it, but another site may have */}
                          {Number(r.to_deliver_qty) > 0 && (
                            <Link className="btn sm" style={{ marginLeft: 6 }}
                              to={`/store/source?prn=${r.indent_id}${carry}`}>From a site</Link>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                  {!rows.length && (
                    <tr><td colSpan={10}>
                      <Empty title="Nothing is waiting on this store">
                        Every approved PRN has been fulfilled.
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
   The issue sheet: several PRNs of one site onto one challan.
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

  if (loading) return <Loading />;
  if (error) {
    return (
      <div className="page-body">
        <ErrorNote error={error} />
        <Link className="btn" to="/store/prns">Back to the PRNs</Link>
      </div>
    );
  }
  if (!data) return <Loading />;

  const save = async (dispatch) => {
    if (!lines.length) return toast('Enter what is going on the lorry', 'bad');
    if (over.length) return toast('More is being sent than the shelf holds', 'bad');
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
        ? `${r.docNo} on the road — ${data.site.name} signs for it when it lands`
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
      <PageHead title={`Issue to ${data.site.name}`}
        sub={`From ${data.store.name} · against ${data.prns.length} PRN${data.prns.length === 1 ? '' : 's'}`}
        actions={<button className="btn" onClick={() => nav('/store/prns')}>Back</button>} />
      <div className="page-body">
        <Card title="Answering">
          <div className="pad" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {data.prns.map((p) => (
              <Link key={p.indent_id} className="chip" to={`/indents/${p.indent_id}`}>
                <b className="mono">{p.doc_no}</b>
                <small>{p.needed_by ? `needed ${dmy(p.needed_by)}` : 'no date'} · {qty(p.to_deliver_qty)} owed</small>
              </Link>
            ))}
          </div>
        </Card>

        <Banner kind="info" icon="⇄">
          Several PRNs may ask for the same item. Each keeps its own row here — what is being
          answered matters — but they draw on <b>one shelf</b>, shown once per item. What you
          dispatch leaves this store at once and becomes {data.site.name}&apos;s only when they
          sign for it.
        </Banner>

        {over.length > 0 && (
          <Banner kind="bad" icon="!">
            <b>More is being sent than the shelf holds:</b>{' '}
            {over.map(([, v]) => `${v.code} — sending ${qty(v.sending)} of ${qty(v.held)}`).join('; ')}.
          </Banner>
        )}

        <Card>
          <div className="pad">
            <div className="row2">
              <Field label="Issue from"
                hint={`${qty(shelfTotal)} units across ${shelfItems} of these items`}>
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
              <Field label="To">
                <input className="inp" disabled value={data.site.name} />
              </Field>
            </div>
            <div className="row2">
              <Field label="Date">
                <input className="inp" type="date" value={head.dcDate}
                  onChange={(e) => setHead((h) => ({ ...h, dcDate: e.target.value }))} />
              </Field>
              <Field label="Vehicle">
                <input className="inp" value={head.vehicleNo} placeholder="TS09 AB 1234"
                  onChange={(e) => setHead((h) => ({ ...h, vehicleNo: e.target.value }))} />
              </Field>
            </div>
            <div className="row2">
              <Field label="Driver">
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
          sub={`Each row is one PRN's requirement, drawn from ${data.store.name}`}
          actions={
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn sm" onClick={fillAll}>Fill from the shelf</button>
              <button className="btn sm" onClick={() => setSend({})}>Clear</button>
            </div>
          }>
          <div className="tw">
            <table className="sheet">
              <thead>
                <tr>
                  <th style={{ width: 100 }}>Code</th><th style={{ minWidth: 190 }}>Item</th>
                  <th style={{ width: 56 }}>Unit</th>
                  <th className="rt" style={{ width: 108 }}>In store</th>
                  <th style={{ width: 138 }}>Answering</th>
                  <th className="rt" style={{ width: 90 }}>Still owed</th>
                  <th className="rt" style={{ width: 88 }}>On the road</th>
                  <th className="rt" style={{ width: 94 }}>Sending</th>
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
                              <td rowSpan={g.rows.length} className="mono"
                                style={{ color: 'var(--brand-ink)', verticalAlign: 'top' }}>
                                {g.code}
                              </td>
                              <td rowSpan={g.rows.length} style={{ verticalAlign: 'top' }}>
                                <b>{l.itemName}</b>
                                {g.rows.length > 1 && (
                                  <small>{g.rows.length} PRNs want this — one shelf between them</small>
                                )}
                              </td>
                              <td rowSpan={g.rows.length} style={{ verticalAlign: 'top' }}>{g.uom}</td>
                              <td rowSpan={g.rows.length} className="rt mono"
                                style={{ verticalAlign: 'top' }}>
                                <b style={{ color: g.held > 0 ? undefined : 'var(--faint)' }}>
                                  {qty(g.held)}
                                </b>
                                {p.sending > 0 && (
                                  <small style={{ color: short ? 'var(--bad)' : 'var(--muted)' }}>
                                    {short
                                      ? `${qty(p.sending - g.held)} short`
                                      : `${qty(g.held - p.sending)} left after this`}
                                  </small>
                                )}
                              </td>
                            </>
                          )}
                          <td><Link to={`/indents/${l.indentId}`} className="mono">{l.prnNo}</Link>
                            {l.neededBy && <small>needed {dmy(l.neededBy)}</small>}</td>
                          <td className="rt mono"><b>{qty(l.toDeliverQty)}</b></td>
                          <td className="rt mono">
                            {l.inTransitQty ? <Tag kind="warn">{qty(l.inTransitQty)}</Tag> : '—'}
                          </td>
                          <td><input className="inp rt" type="number" min="0" step="any"
                            placeholder="—" value={send[key(l)] ?? ''}
                            onChange={(e) => setSend((x) => ({ ...x, [key(l)]: e.target.value }))} /></td>
                        </tr>
                      ))}
                    </>
                  );
                })}
                {!data.lines.length && (
                  <tr><td colSpan={8}>
                    <Empty title="Nothing outstanding on those PRNs">
                      Everything they asked for has reached the site.
                    </Empty>
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>

        <Card>
          <div className="pad" style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
            <Stat n={lines.length} label="rows" />
            <Stat n={qty(total)} label="units going" />
            <div style={{ flex: 1 }} />
            <button className="btn" disabled={busy || over.length > 0}
              onClick={() => save(false)}>Save draft</button>
            <button className="btn pri" disabled={busy || over.length > 0}
              onClick={() => save(true)}>Dispatch</button>
          </div>
        </Card>
      </div>
    </>
  );
}

/* ===================================================================
   The shelf.
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
  const { data, error, loading, reload } = useApi(branchId ? `/store/stock?${qs}` : null,
    [branchId, qs]);
  const rows = data?.rows || [];

  const grab = () => downloadCsv('store-stock', [
    ['Code', 'Item', 'Unit', 'On the shelf', 'Latest rate', 'Value', 'Out in transit',
      'Sites asking for', 'Last moved'],
    ...rows.map((r) => [r.item_code, r.item_name, r.uom, r.qty, r.latest_rate, r.value,
      r.out_in_transit, r.demand_qty, r.last_moved ? dmy(r.last_moved) : '']),
  ]);

  return (
    <>
      <PageHead title="Stock" sub={data ? `${data.store.name} — valued at the last rate paid` : ''}
        actions={<button className="btn" onClick={grab} disabled={!rows.length}>Download</button>} />
      <div className="page-body">
        {error && <ErrorNote error={error} onRetry={reload} />}

        <Card>
          <div className="pad" style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <Field label="Find an item" hint="By name or code">
              <input className="inp" style={{ width: 280 }} autoFocus value={f.q}
                placeholder="e.g. cable, switch, FLC-0187"
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
              Hide nil balances
            </label>
          </div>
        </Card>

        {data && (
          <div className="stats">
            <Stat n={data.totals.items} label="items held" />
            <Stat n={qty(data.totals.qty)} label="units" />
            <Stat n={money(data.totals.value)} label="at the last rate paid" tone="brand" />
            <Stat n={data.totals.short} label="short of what sites want"
              tone={data.totals.short ? 'bad' : undefined} />
          </div>
        )}

        {loading ? <Loading /> : (
          <Card title={`${rows.length} item${rows.length === 1 ? '' : 's'}`}>
            <div className="tw">
              <table>
                <thead>
                  <tr>
                    <th>Code</th><th>Item</th><th style={{ width: 56 }}>Unit</th>
                    <th className="rt">On the shelf</th><th className="rt">Out in transit</th>
                    <th className="rt">Sites want</th>
                    <th>Last moved</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const short = Number(r.demand_qty) > Number(r.qty);
                    return (
                      <tr key={r.item_id} style={{ cursor: 'pointer' }}
                        onClick={() => setOpen(r.item_id)}>
                        <td className="mono" style={{ color: 'var(--brand-ink)' }}>{r.item_code}</td>
                        <td><b>{r.item_name}</b></td>
                        <td>{r.uom}</td>
                        <td className="rt mono"><b>{qty(r.qty)}</b></td>
                        <td className="rt mono">
                          {Number(r.out_in_transit)
                            ? <Tag kind="warn">{qty(r.out_in_transit)}</Tag> : '—'}
                        </td>
                        <td className="rt mono" style={{ color: short ? 'var(--bad)' : undefined }}>
                          {Number(r.demand_qty) ? qty(r.demand_qty) : '—'}
                          {short && <small style={{ color: 'var(--bad)' }}>
                            short {qty(Number(r.demand_qty) - Number(r.qty))}</small>}
                        </td>
                        <td>{r.last_moved ? dmy(r.last_moved) : '—'}</td>
                      </tr>
                    );
                  })}
                  {!rows.length && (
                    <tr><td colSpan={7}>
                      <Empty title={f.q ? `Nothing on the shelf matches "${f.q}"` : 'The shelf is empty'}>
                        Stock arrives by acknowledging a purchase order.
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
  if (loading || !data) return <Modal title="Item" onClose={onClose}><Loading /></Modal>;
  if (peek) return <DocPeek doc={peek} onClose={() => setPeek(null)} />;

  return (
    <Modal wide title={data.item.name} sub={`${data.item.code} · at ${data.store.name}`}
      onClose={onClose}
      footer={<button className="btn" onClick={onClose}>Close</button>}>
      <div className="stats">
        <Stat n={qty(data.balance?.qty || 0)} label={`${data.item.uom} on the shelf`} />
      </div>
      <div className="tw" style={{ maxHeight: 420, overflowY: 'auto' }}>
        <table>
          <thead>
            <tr><th>Date</th><th>Document</th><th>Why</th>
              <th className="rt">In</th><th className="rt">Out</th></tr>
          </thead>
          <tbody>
            {data.moves.map((m) => (
              <tr key={m.id}>
                <td>{dmy(m.moved_on)}</td>
                <td><DocLink refType={m.ref_type} refId={m.ref_id} refNo={m.ref_no}
                  onPeek={setPeek} /></td>
                <td>{KIND[m.kind] || m.kind}</td>
                <td className="rt mono" style={{ color: 'var(--ok)' }}>
                  {Number(m.qty) > 0 ? `+${qty(m.qty)}` : ''}</td>
                <td className="rt mono" style={{ color: 'var(--bad)' }}>
                  {Number(m.qty) < 0 ? qty(Math.abs(m.qty)) : ''}</td>
              </tr>
            ))}
            {!data.moves.length && (
              <tr><td colSpan={5}><Empty title="Never moved" /></td></tr>
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
  GRN: 'Taken in on an order',
  DC_OUT: 'Sent to a site',
  DC_IN: 'Signed for at a site',
  ADJUST: 'Adjustment',
  RETURN: 'Returned',
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
  if (!to) return <span className="mono">{refNo}</span>;
  // where a screen can open the document in place, it does; otherwise
  // the number stays an ordinary link rather than a dead button
  return onPeek
    ? (
      <button type="button" className="linkish mono"
        onClick={(e) => { e.stopPropagation(); onPeek({ refType, refId }); }}>
        {refNo}
      </button>
    )
    : <Link to={to} className="mono">{refNo}</Link>;
};

const DOC_STATE = {
  ACKNOWLEDGED: { label: 'Received in full', kind: 'ok' },
  PART_ACK: { label: 'Part received', kind: 'warn' },
  IN_TRANSIT: { label: 'On the road', kind: 'warn' },
  DRAFT: { label: 'Draft', kind: '' },
  CANCELLED: { label: 'Cancelled', kind: '' },
  IN_STOCK: { label: 'In stock', kind: 'ok' },
};

/** What was in it, without leaving the screen that named it. */
export function DocPeek({ doc, onClose }) {
  const { data, loading, error } = useApi(
    `/store/document/${doc.refType}/${doc.refId}`, [doc.refType, doc.refId]);

  if (loading || !data) {
    return (
      <Modal wide title="Document" onClose={onClose}>
        {error ? <ErrorNote error={error} /> : <Loading />}
      </Modal>
    );
  }
  const st = DOC_STATE[data.state] || { label: data.state, kind: '' };
  const isDc = data.refType === 'DC';

  return (
    <Modal wide title={data.docNo} sub={`${data.kind} · ${dmy(data.date)}`}
      onClose={onClose}
      footer={<>
        <button className="btn" onClick={onClose}>Close</button>
        <Link className="btn pri" to={data.href}>Open it in full</Link>
      </>}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 12,
        flexWrap: 'wrap' }}>
        <Tag kind={st.kind}>{st.label}</Tag>
        <span style={{ color: 'var(--muted)', fontSize: 12.5 }}>
          {data.from} → {data.to}
          {data.vehicle ? ` · ${data.vehicle}` : ''}
          {data.supplierDc ? ` · their DC ${data.supplierDc}` : ''}
          {data.by ? ` · ${data.by}` : ''}
        </span>
      </div>

      {isDc && data.prns?.length > 0 && (
        <p style={{ color: 'var(--muted)', fontSize: 12.5, marginTop: 0 }}>
          Answering <b className="mono">{data.prns.join(', ')}</b>
        </p>
      )}
      {!isDc && data.po && (
        <p style={{ color: 'var(--muted)', fontSize: 12.5, marginTop: 0 }}>
          Against <Link className="mono" to={`/purchase-orders/${data.po.id}`}>{data.po.docNo}</Link>
        </p>
      )}

      <div className="stats">
        <Stat n={data.totals.lines} label="items" />
        <Stat n={qty(data.totals.qty)} label={isDc ? 'units sent' : 'units taken in'} />
        {isDc
          ? <Stat n={qty(data.totals.inTransit)} label="still unaccounted for"
              tone={Number(data.totals.inTransit) ? 'bad' : 'ok'} />
          : null}
      </div>

      <div className="tw" style={{ maxHeight: 400, overflowY: 'auto' }}>
        <table className="sheet">
          <thead>
            <tr>
              <th style={{ width: 100 }}>Code</th><th>Item</th><th style={{ width: 56 }}>Unit</th>
              <th className="rt">{isDc ? 'Sent' : 'Taken in'}</th>
              {isDc
                ? <><th className="rt">Signed for</th><th className="rt">In transit</th></>
                : <th className="rt">Ordered</th>}
            </tr>
          </thead>
          <tbody>
            {data.lines.map((l, i) => (
              <tr key={i}>
                <td className="mono" style={{ color: 'var(--brand-ink)' }}>{l.item_code}</td>
                <td>{l.item_name}{l.make_name && <small>{l.make_name}</small>}</td>
                <td>{l.uom}</td>
                <td className="rt mono"><b>{qty(l.qty)}</b></td>
                {isDc ? (
                  <>
                    <td className="rt mono">{Number(l.acked_qty) ? qty(l.acked_qty) : '—'}</td>
                    <td className="rt mono"
                      style={{ color: Number(l.in_transit_qty) > 0 ? 'var(--bad)' : 'var(--ok)' }}>
                      {Number(l.in_transit_qty) ? qty(l.in_transit_qty) : 'nil'}
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
  const { data, error, loading, reload } = useApi(branchId ? `/store/movements?${qs}` : null,
    [branchId, qs]);
  const rows = data?.rows || [];
  const docs = data?.docs || [];

  const range = (from, to) => setF((x) => ({ ...x, from, to }));
  const d = today();

  const grab = () => downloadCsv('stock-movement', [
    ['Date', 'Document', 'Why', 'Code', 'Item', 'Unit', 'In', 'Out', 'Rate', 'Value', 'By'],
    ...rows.map((r) => [dmy(r.moved_on), r.ref_no || '', KIND[r.kind] || r.kind,
      r.item_code, r.item_name, r.uom,
      Number(r.qty) > 0 ? r.qty : '', Number(r.qty) < 0 ? Math.abs(r.qty) : '',
      r.rate, r.value, r.by_name || '']),
  ]);

  return (
    <>
      <PageHead title="Stock movement"
        sub="Every GRN and challan that touched this store"
        actions={<button className="btn" onClick={grab} disabled={!rows.length}>Download</button>} />
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
            <Field label="Why">
              <select className="inp" style={{ width: 185 }} value={f.kind}
                onChange={(e) => setF((x) => ({ ...x, kind: e.target.value }))}>
                <option value="">Everything</option>
                <option value="GRN">Taken in on an order</option>
                <option value="DC_OUT">Sent to a site</option>
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
              <input className="inp" style={{ width: 190 }} placeholder="Item or document"
                value={f.q} onChange={(e) => setF((x) => ({ ...x, q: e.target.value }))} />
            </Field>
          </div>
        </Card>

        {data && (
          <div className="stats">
            <Stat n={data.totals.docs} label="documents" />
            <Stat n={data.totals.moves} label="lines" />
            <Stat n={qty(data.totals.inQty)} label="units in" tone="ok" />
            <Stat n={qty(data.totals.outQty)} label="units out" tone="bad" />
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
          <button className={`btn sm ${view === 'docs' ? 'pri' : ''}`} onClick={() => setView('docs')}>
            By document
          </button>
          <button className={`btn sm ${view === 'lines' ? 'pri' : ''}`} onClick={() => setView('lines')}>
            Every line
          </button>
        </div>

        {loading ? <Loading /> : view === 'docs' ? (
          <Card title={`${docs.length} document${docs.length === 1 ? '' : 's'}`}
            sub="Click one to see the items inside it">
            <div className="tw">
              <table>
                <thead>
                  <tr><th>Document</th><th>Date</th><th>Why</th><th className="rt">Items</th>
                    <th className="rt">Units</th><th>By</th></tr>
                </thead>
                <tbody>
                  {docs.map((x) => (
                    <tr key={`${x.refType}:${x.refId}`} style={{ cursor: 'pointer' }}
                      onClick={() => setPeek({ refType: x.refType, refId: x.refId })}>
                      <td><DocLink refType={x.refType} refId={x.refId} refNo={x.refNo}
                        onPeek={setPeek} /></td>
                      <td>{dmy(x.movedOn)}</td>
                      <td>
                        <Tag kind={x.direction === 'IN' ? 'ok' : 'warn'}>
                          {x.direction === 'IN' ? 'In' : 'Out'}
                        </Tag>{' '}
                        {KIND[x.kind] || x.kind}
                      </td>
                      <td className="rt mono">{x.lines}</td>
                      <td className="rt mono">{qty(x.qty)}</td>
                      <td>{x.byName || '—'}</td>
                    </tr>
                  ))}
                  {!docs.length && (
                    <tr><td colSpan={6}>
                      <Empty title="Nothing moved in that window">
                        Widen the dates, or clear the filters.
                      </Empty>
                    </td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        ) : (
          <Card title={`${rows.length} line${rows.length === 1 ? '' : 's'}`}>
            <div className="tw">
              <table>
                <thead>
                  <tr><th>Date</th><th>Document</th><th>Item</th><th>Why</th>
                    <th className="rt">In</th><th className="rt">Out</th><th>By</th></tr>
                </thead>
                <tbody>
                  {rows.map((m) => (
                    <tr key={m.id}>
                      <td>{dmy(m.moved_on)}</td>
                      <td><DocLink refType={m.ref_type} refId={m.ref_id} refNo={m.ref_no}
                        onPeek={setPeek} /></td>
                      <td>{m.item_name}<small className="mono">{m.item_code} · {m.uom}</small></td>
                      <td>{KIND[m.kind] || m.kind}</td>
                      <td className="rt mono" style={{ color: 'var(--ok)' }}>
                        {Number(m.qty) > 0 ? `+${qty(m.qty)}` : ''}</td>
                      <td className="rt mono" style={{ color: 'var(--bad)' }}>
                        {Number(m.qty) < 0 ? qty(Math.abs(m.qty)) : ''}</td>
                      <td>{m.by_name || '—'}</td>
                    </tr>
                  ))}
                  {!rows.length && (
                    <tr><td colSpan={7}><Empty title="Nothing moved in that window" /></td></tr>
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
