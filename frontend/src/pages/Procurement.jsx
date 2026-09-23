import { Fragment, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useApp, PageHead } from '../App';
import { api, qty, money, dmy, today, addDays, withBranch, canWrite, plural } from '../api';
import { downloadCsv } from '../download';
import {
  useApi, Card, Empty, Loading, ErrorNote, Banner, Field, Modal, Stat, useToast, Code, Status,
  DateField,
} from '../components/ui';
import { Icon } from '../components/icons';
import { prnStage, PRN_STAGE } from '../vocab';

/**
 * The buyer's desk.
 *
 * Every approved PRN the store cannot send from stock, and how far it
 * has got. It stays here until every item on it has been ordered — a
 * half-ordered PRN is not finished business. Tick the ones being bought together and the
 * demand comes out as one line per item, because the same cable wanted
 * by three sites is one negotiation.
 */

// the stages come from the one vocabulary, so a PRN reads the same here
// as on its own page and in the store
export const StageTag = ({ stage, extra }) => {
  const st = prnStage(stage);
  return <Status is={{ ...st, label: extra ? `${st.label} · ${extra}` : st.label }} />;
};

export default function Procurement() {
  const { branchId, branchName, setBranch } = useApp();
  const toast = useToast();
  const [f, setF] = useState({ q: '', siteId: '', stage: 'OPEN', sort: 'needed' });
  const qs = new URLSearchParams({
    ...(branchId ? { branchId } : {}),
    ...(f.q ? { q: f.q } : {}),
    ...(f.siteId ? { siteId: f.siteId } : {}),
    stage: f.stage, sort: f.sort,
  }).toString();

  const { data, error, loading, reload } = useApi(`/procurement/queue?${qs}`,
    [branchId, qs]);
  const { data: sites } = useApi(withBranch('/sites', branchId), [branchId]);
  const [picked, setPicked] = useState([]);
  // the same demand two ways: PRN by PRN, or added up per item
  const [view, setView] = useState('prn');
  // an order raised from "By item": the PRNs behind the chosen items, and
  // how much of each item to put on it
  const [itemOrder, setItemOrder] = useState(null);
  const [buying, setBuying] = useState(false);
  const [comparing, setComparing] = useState(false);
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();

  // "Raise purchase order" on a decided comparison lands here: pick up
  // its PRNs and its rates rather than making the buyer retype either
  const fromComparison = params.get('comparison');
  const { data: cmp } = useApi(fromComparison ? `/comparisons/${fromComparison}` : null,
    [fromComparison]);
  useEffect(() => {
    // only an approved comparison can carry an order; one merely
    // decided is still waiting for its approvals
    if (!cmp || cmp.status !== 'APPROVED') return;
    setPicked(cmp.indents.map((i) => i.id));
    setBuying(true);
  }, [cmp]);

  /**
   * Compare before buying. The sheet is seeded with exactly what these
   * PRNs still need, so nobody retypes a requirement that is already
   * worked out.
   */
  const compare = async () => {
    setComparing(true);
    try {
      const r = await api.post('/comparisons', {
        // on every branch there is no single one to send; the server
        // takes it from the PRNs and refuses a mix of branches
        ...(branchId ? { branchId } : {}),
        indentIds: picked,
        title: chosen.length === 1
          ? `${chosen[0].doc_no} · ${chosen[0].site_name}`
          : `${plural(chosen.length, 'PRN')} · ${plural(sitesOf.size, 'site')}`,
      });
      nav(`/comparisons/${r.id}`);
    } catch (e) { toast(e.message, 'bad'); }
    setComparing(false);
  };

  const rows = data || [];
  const chosen = rows.filter((r) => picked.includes(r.id));
  const sitesOf = new Set(chosen.map((r) => r.site_id));

  const toggle = (id) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  const grab = () => downloadCsv('prns-to-buy', [
    ['PRN', 'Site', 'Raised', 'Needed by', 'Material', 'Items', 'Asked for', 'Ordered', 'Received', 'To order'],
    ...rows.map((r) => [r.doc_no, r.site_name, dmy(r.indent_date), r.needed_by ? dmy(r.needed_by) : '',
      prnStage(r.stage).label, r.item_count,
      r.indented_qty, r.ordered_qty, r.received_qty, r.to_order_qty]),
  ]);

  return (
    <>
      <PageHead title="To buy"
        sub="Approved PRNs the central store cannot send from its own stock. Tick the ones to buy together."
        actions={
          <>
            <button className="btn" onClick={grab} disabled={!rows.length}><Icon name="download" size={14} />Download</button>
            {canWrite('/comparisons') && !picked.length && (
              <span className="why-not"><Icon name="info" size={14} />Tick PRNs to compare rates or order</span>
            )}
            {canWrite('/comparisons') && (
              <>
                <button className="btn" disabled={!picked.length || comparing}
                  onClick={compare}>
                  Compare rates{picked.length ? ` for ${plural(picked.length, 'PRN')}` : ''}
                </button>
                <button className="btn pri" disabled={!picked.length} onClick={() => setBuying(true)}>
                  <Icon name="cart" />Raise purchase order
                </button>
              </>
            )}
          </>
        } />
      <div className="page-body">
        {error && <ErrorNote error={error} onRetry={reload} />}

        <Card>
          <div className="pad" style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <Field label="Search">
              <input className="inp" type="search" style={{ width: 230 }} placeholder="PRN number or site…"
                value={f.q} onChange={(e) => setF((x) => ({ ...x, q: e.target.value }))} />
            </Field>
            <Field label="Site">
              <select className="inp" style={{ width: 190 }} value={f.siteId}
                onChange={(e) => setF((x) => ({ ...x, siteId: e.target.value }))}>
                <option value="">Every site</option>
                {(sites || []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </Field>
            <Field label="Material">
              <select className="inp" style={{ width: 190 }} value={f.stage}
                onChange={(e) => setF((x) => ({ ...x, stage: e.target.value }))}>
                <option value="OPEN">Still to order</option>
                <option value="AWAITING_PO">{PRN_STAGE.AWAITING_PO.label}</option>
                <option value="PART_ORDERED">{PRN_STAGE.PART_ORDERED.label}</option>
                <option value="ORDERED">{PRN_STAGE.ORDERED.label}</option>
                <option value="PART_RECEIVED">{PRN_STAGE.PART_RECEIVED.label}</option>
                <option value="AT_STORE">{PRN_STAGE.AT_STORE.label}</option>
                <option value="IN_TRANSIT">{PRN_STAGE.IN_TRANSIT.label}</option>
                <option value="AT_SITE">{PRN_STAGE.AT_SITE.label}</option>
                <option value="RECEIVED">Received at central store</option>
                <option value="ALL">Everything</option>
              </select>
            </Field>
            <Field label="Sort by">
              <select className="inp" style={{ width: 160 }} value={f.sort}
                onChange={(e) => setF((x) => ({ ...x, sort: e.target.value }))}>
                <option value="needed">Needed soonest</option>
                <option value="raised">Recently raised</option>
                <option value="site">Site</option>
                <option value="value">Most still to order</option>
              </select>
            </Field>
            <div style={{ flex: 1 }} />
            <div style={{ color: 'var(--muted)', paddingBottom: 8 }}>
              {plural(rows.length, 'PRN')}
            </div>
          </div>
        </Card>

        {picked.length > 1 && sitesOf.size > 1 && (
          <Banner kind="info">
            These PRNs are for <b>{sitesOf.size} different sites</b>, so the order is delivered to
            the central store and dispatched to each site from there.
          </Banner>
        )}

        <div style={{ margin: '0 0 12px' }}>
          <div className="seg" role="group" aria-label="How to show what is to buy">
            <button type="button" aria-pressed={view === 'prn'} onClick={() => setView('prn')}>By PRN</button>
            <button type="button" aria-pressed={view === 'item'} onClick={() => setView('item')}>By item — all PRNs added up</button>
          </div>
        </div>

        {view === 'item' && (
          <ItemsToBuy branchId={branchId} siteId={f.siteId} q={f.q}
            onOrder={(indentIds, only) => setItemOrder({ indentIds, only })} />
        )}

        {view === 'prn' && (loading && !data ? <Loading what="PRNs to buy" /> : (
          <Card title="Approved PRNs">
            <div className="tw">
              <table>
                <thead>
                  <tr>
                    <th style={{ width: 40 }}><span className="vh">Tick to buy</span></th>
                    <th>PRN</th><th>Site</th><th>Needed by</th>
                    <th className="rt">Items</th>
                    <th className="rt">Asked for</th><th className="rt">Ordered</th>
                    <th className="rt">Received</th><th className="rt">To order</th>
                    <th>Material</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id} className="click" onClick={() => toggle(r.id)} tabIndex={0}
                      onKeyDown={(e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); toggle(r.id); } }}
                      aria-selected={picked.includes(r.id)}
                      style={picked.includes(r.id) ? { background: 'var(--brand-soft)' } : undefined}>
                      <td style={{ textAlign: 'center' }}>
                        <input type="checkbox" readOnly tabIndex={-1} checked={picked.includes(r.id)} aria-label={`Tick ${r.doc_no}`} />
                      </td>
                      <td>
                        <Code as="b">{r.doc_no}</Code><small>by {r.raised_by_name}</small>
                        <ViewPrn id={r.id} />
                      </td>
                      <td>{r.site_name}<small><Code>{r.site_code}</Code></small></td>
                      <td className="mono">
                        {r.needed_by ? dmy(r.needed_by) : '—'}
                        {Number(r.late) === 1 && <small style={{ color: 'var(--st-stop)', fontWeight: 600 }}>Late</small>}
                      </td>
                      <td className="rt mono">{r.item_count}</td>
                      <td className="rt mono">{qty(r.indented_qty)}</td>
                      <td className="rt mono">{Number(r.ordered_qty) ? qty(r.ordered_qty) : '—'}</td>
                      <td className="rt mono">{Number(r.received_qty) ? qty(r.received_qty) : '—'}</td>
                      <td className="rt mono">
                        {Number(r.to_order_qty) ? <b>{qty(r.to_order_qty)}</b> : '—'}
                      </td>
                      <td><StageTag stage={r.stage} extra={r.po_count ? `${r.po_count} PO` : ''} /></td>
                    </tr>
                  ))}
                  {!rows.length && (
                    <tr><td colSpan={10}>
                      <Empty icon="check"
                        title={branchId ? `Nothing to buy in ${branchName}` : 'Nothing to buy'}
                        action={branchId && <button className="btn" onClick={() => setBranch('ALL')}>Show all branches</button>}>
                        {branchId
                          ? `Every approved PRN in ${branchName} is already on a purchase order. Other branches are not shown — the branch picker in the top bar decides.`
                          : 'Every approved PRN is already on a purchase order. Orders awaiting approval are under Purchase orders.'}
                      </Empty>
                    </td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        ))}
      </div>

      {itemOrder && (
        <NewOrder indentIds={itemOrder.indentIds} only={itemOrder.only}
          onClose={() => setItemOrder(null)}
          onDone={() => { setItemOrder(null); reload(); toast('Purchase order raised', 'ok'); }} />
      )}

      {buying && (
        <NewOrder indentIds={picked} comparison={cmp && cmp.status === 'APPROVED' ? cmp : null}
          onClose={() => { setBuying(false); setParams({}); }}
          onDone={() => {
            setBuying(false); setPicked([]); setParams({}); reload(); toast('Purchase order raised', 'ok');
          }} />
      )}
    </>
  );
}

/* ===================================================================
   Raising the order. The demand arrives already rolled up by item,
   with what the store holds beside it — because the cheapest way to
   fill a requirement is often not to buy it.
   =================================================================== */
function NewOrder({ indentIds, comparison, only, onClose, onDone }) {
  const nav = useNavigate();
  const toast = useToast();
  const [demand, setDemand] = useState(null);
  const [err, setErr] = useState(null);
  const { data: suppliers } = useApi('/suppliers');
  const [head, setHead] = useState({
    supplierId: '', deliverToId: '', poDate: today(), expectedDate: addDays(today(), 10), notes: '',
  });
  const [order, setOrder] = useState({});     // itemId -> { qty, rate, gstRate }
  const [busy, setBusy] = useState(false);

  useMemo(() => {
    api.post('/procurement/demand', { indentIds })
      .then((d) => {
        setDemand(d);
        // the chosen supplier's rate on this sheet, item by item
        const quoted = {};
        if (comparison) {
          const cs = comparison.suppliers
            .find((x) => x.supplier_id === comparison.chosen_supplier_id);
          if (cs) {
            for (const it of comparison.items) {
              const q = comparison.quotes.find((x) =>
                x.comparison_item_id === it.id
                && x.comparison_supplier_id === cs.comparison_supplier_id);
              if (q) quoted[it.item_id] = Number(q.rate);
            }
          }
        }
        setHead((h) => ({
          ...h,
          deliverToId: String(d.deliverOptions[0]?.id || ''),
          supplierId: comparison ? String(comparison.chosen_supplier_id) : h.supplierId,
        }));
        setOrder(Object.fromEntries(d.lines
          .filter((l) => l.toOrderQty > 0 && (!only || only[l.itemId] != null))
          .map((l) => [l.itemId, {
            // raised from "By item": the quantity the buyer chose there
            qty: String(only ? Math.min(Number(only[l.itemId]), l.toOrderQty) : l.toOrderQty),
            rate: String(quoted[l.itemId] ?? l.suggestedRate ?? ''),
            gstRate: String(l.gstRate),
          }])));
      })
      .catch(setErr);
  }, [indentIds.join(',')]);

  const lines = (demand?.lines || []).filter((l) => Number(order[l.itemId]?.qty) > 0);
  const value = lines.reduce((t, l) => {
    const o = order[l.itemId];
    const basic = Number(o.qty) * Number(o.rate || 0);
    return t + basic + (basic * Number(o.gstRate || 0)) / 100;
  }, 0);

  const set = (itemId, k, v) =>
    setOrder((x) => ({ ...x, [itemId]: { ...x[itemId], [k]: v } }));

  const save = async (submit) => {
    if (!head.supplierId) return toast('Choose the supplier', 'bad');
    if (!head.deliverToId) return toast('Choose where it is delivered', 'bad');
    if (!lines.length) return toast('Type an order quantity for at least one item', 'bad');
    const noRate = lines.find((l) => !(Number(order[l.itemId].rate) > 0));
    if (noRate) return toast(`${noRate.itemCode} needs a rate`, 'bad');
    setBusy(true);
    try {
      const r = await api.post('/purchase-orders', {
        supplierId: Number(head.supplierId),
        indentIds,
        deliverToId: Number(head.deliverToId),
        poDate: head.poDate,
        expectedDate: head.expectedDate || undefined,
        comparisonId: comparison ? comparison.comparison_id : undefined,
        notes: head.notes || undefined,
        submit,
        lines: lines.map((l) => ({
          itemId: l.itemId, makeId: l.makeId || undefined,
          qty: Number(order[l.itemId].qty),
          rate: Number(order[l.itemId].rate),
          gstRate: Number(order[l.itemId].gstRate),
        })),
      });
      toast(submit ? `${r.docNo} sent for approval` : `${r.docNo} saved as a draft`, 'ok');
      onDone();
      nav(`/purchase-orders/${r.id}`);
    } catch (e) { toast(e.message, 'bad'); }
    setBusy(false);
    return undefined;
  };

  if (err) {
    return <Modal full title="Raise purchase order" onClose={onClose}><ErrorNote error={err} /></Modal>;
  }
  if (!demand) return <Modal full title="Raise purchase order" onClose={onClose}><Loading what="what these PRNs need" /></Modal>;

  return (
    <Modal full title="Raise purchase order"
      sub={only
        ? `${plural(Object.keys(only).length, 'item')} chosen by item · from ${plural(demand.indents.length, 'PRN')}`
        : `${plural(demand.indents.length, 'PRN')} · ${plural(demand.lines.length, 'item')}`}
      onClose={onClose}
      footer={<>
        <div style={{ marginRight: 'auto', display: 'flex', gap: 16, alignItems: 'center' }}>
          <Stat n={lines.length} label="lines" />
          <Stat n={money(value)} label="order value incl. GST" />
        </div>
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn" disabled={busy} onClick={() => save(false)}>Save as draft</button>
        <button className="btn pri" disabled={busy} onClick={() => save(true)}><Icon name="send" />Send for approval</button>
      </>}>

      {comparison && (
        <Banner kind="ok">
          Rates from rate comparison <Code as="b">{comparison.doc_no}</Code> — {comparison.chosen_supplier_name} was chosen
          {comparison.decided_note ? `: ${comparison.decided_note}` : ''}.
        </Banner>
      )}
      <Banner kind="info">
        {demand.singleSite
          ? <>These PRNs are all for one site, so the supplier can deliver straight to the site or to the central store.</>
          : <>These PRNs are for <b>more than one site</b>, so the order is delivered to the central store and
            dispatched to each site from there.</>}
        {' '}For: <Code>{demand.indents.map((i) => i.docNo).join(', ')}</Code>.
      </Banner>

      <Card>
        <div className="pad">
          <div className="row2">
            <Field label="Supplier"
              hint={comparison ? `Chosen on ${comparison.doc_no}` : undefined}>
              <select className="inp" value={head.supplierId}
                onChange={(e) => setHead((h) => ({ ...h, supplierId: e.target.value }))}>
                <option value="">Choose the supplier…</option>
                {(suppliers || []).map((s) => (
                  <option key={s.id} value={s.id}>{s.name}{s.gstin ? ` · ${s.gstin}` : ''}</option>
                ))}
              </select>
            </Field>
            <Field label="Supplier delivers to">
              <select className="inp" value={head.deliverToId}
                onChange={(e) => setHead((h) => ({ ...h, deliverToId: e.target.value }))}>
                {demand.deliverOptions.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name} ({o.type === 'STORE' ? 'central store' : 'straight to site'})
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <div className="row2">
            <DateField label="Order date" value={head.poDate}
              onChange={(e) => setHead((h) => ({ ...h, poDate: e.target.value }))} />
            <DateField label="Expected delivery" value={head.expectedDate} min={head.poDate}
              hint="Deliveries after this date show as late"
              onChange={(e) => setHead((h) => ({ ...h, expectedDate: e.target.value }))} />
          </div>
        </div>
      </Card>

      <Card title="What to order"
        sub="One line per item across every PRN ticked. What the central store already holds is beside it — sometimes the cheapest way to fill a PRN is not to buy.">
        <div className="tw">
          <table className="sheet">
            <thead>
              <tr>
                <th style={{ width: 110 }}>Item code</th>
                <th style={{ minWidth: 230 }}>Description</th>
                <th style={{ width: 66 }}>Unit</th>
                <th className="rt" style={{ width: 86 }}>Asked for</th>
                <th className="rt" style={{ width: 88 }}>To order</th>
                <th className="rt" style={{ width: 92 }}>In stock</th>
                <th className="rt" style={{ width: 96 }}>Store rate</th>
                <th className="rt" style={{ width: 96 }}>Last paid</th>
                <th className="rt" style={{ width: 92 }}>Order qty</th>
                <th className="rt" style={{ width: 96 }}>Rate</th>
                <th className="rt" style={{ width: 70 }}>GST %</th>
                <th className="rt" style={{ width: 106 }}>Amount</th>
              </tr>
            </thead>
            <tbody>
              {demand.lines.filter((l) => !only || only[l.itemId] != null).map((l) => {
                const o = order[l.itemId] || {};
                const basic = Number(o.qty || 0) * Number(o.rate || 0);
                const amt = basic + (basic * Number(o.gstRate || 0)) / 100;
                const covered = l.storeQty >= l.toOrderQty && l.toOrderQty > 0;
                return (
                  <tr key={`${l.itemId}-${l.makeId || ''}`}
                    style={Number(o.qty) > 0 ? { background: 'var(--brand-soft)' } : undefined}>
                    <td><Code>{l.itemCode}</Code></td>
                    <td>{l.itemName}{l.makeName && <small>{l.makeName}</small>}</td>
                    <td>{l.uom}</td>
                    <td className="rt mono">{qty(l.indentedQty)}</td>
                    <td className="rt mono"><b>{qty(l.toOrderQty)}</b></td>
                    <td className="rt mono">
                      {l.storeQty ? qty(l.storeQty) : '—'}
                      {covered && <small style={{ color: 'var(--st-done)', fontWeight: 600 }}>Enough in stock</small>}
                    </td>
                    <td className="rt mono">{l.storeRate ? money(l.storeRate) : '—'}</td>
                    <td className="rt mono">
                      {l.lastPaidRate ? money(l.lastPaidRate) : '—'}
                      {l.lastPaidOn && <small>{dmy(l.lastPaidOn)}</small>}
                    </td>
                    <td><input className="inp rt" type="number" min="0" step="any" placeholder="0" inputMode="decimal"
                      aria-label={`Order quantity for ${l.itemName}`}
                      value={o.qty ?? ''} onChange={(e) => set(l.itemId, 'qty', e.target.value)} /></td>
                    <td><input className="inp rt" type="number" min="0" step="any" inputMode="decimal"
                      aria-label={`Rate for ${l.itemName}, in rupees`}
                      value={o.rate ?? ''} onChange={(e) => set(l.itemId, 'rate', e.target.value)} /></td>
                    <td><input className="inp rt" type="number" min="0" step="any" inputMode="decimal"
                      aria-label={`GST % for ${l.itemName}`}
                      value={o.gstRate ?? ''} onChange={(e) => set(l.itemId, 'gstRate', e.target.value)} /></td>
                    <td className="rt mono">{amt ? money(amt) : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <Card>
        <div className="pad">
          <Field label="Note to the supplier">
            <textarea className="inp" rows={2} value={head.notes}
              onChange={(e) => setHead((h) => ({ ...h, notes: e.target.value }))} />
          </Field>
        </div>
      </Card>
    </Modal>
  );
}

/* ===================================================================
   What to buy, per item: every approved PRN that still has some of an
   item to order, added up. Open an item to see which PRNs want it and
   on which BOQ lines of each (1a-5, 2b-10).
   =================================================================== */
function ItemsToBuy({ branchId, siteId, q, onOrder }) {
  const [sort, setSort] = useState('item');
  const [open, setOpen] = useState(null);
  const [pick, setPick] = useState({});   // row key -> quantity to order now
  const canOrder = canWrite('/purchase-orders');
  const qs = new URLSearchParams({
    ...(branchId ? { branchId } : {}), ...(siteId ? { siteId } : {}), ...(q ? { q } : {}), sort,
  }).toString();
  const { data, error, loading, reload } = useApi(`/procurement/items?${qs}`, [qs]);
  const rows = data?.rows || [];
  const key = (r) => `${r.item_id}-${r.make_id || ''}`;
  const chosen = rows.filter((r) => pick[key(r)] != null);
  const bad = chosen.find((r) => !(Number(pick[key(r)]) > 0) || Number(pick[key(r)]) > Number(r.to_order_qty));
  const togglePick = (r) => setPick((x) => {
    const k = key(r);
    const next = { ...x };
    // start at what the central store cannot cover; all of it if it covers everything
    if (next[k] != null) delete next[k];
    else next[k] = String(Number(r.short_qty) > 0 ? Number(r.short_qty) : Number(r.to_order_qty));
    return next;
  });
  const raise = () => {
    const ids = new Set();
    const only = {};
    for (const r of chosen) {
      String(r.indent_ids || '').split(',').filter(Boolean).forEach((id) => ids.add(Number(id)));
      only[r.item_id] = Number(pick[key(r)]);
    }
    onOrder([...ids], only);
  };

  const grab = () => downloadCsv('items-to-buy', [
    ['Item code', 'Item', 'Make', 'Unit', 'PRNs', 'Sites', 'Asked for', 'Ordered', 'Awaiting approval', 'To order',
      'At central store', 'Short', 'First needed'],
    ...rows.map((r) => [r.item_code, r.item_name, r.make_name || '', r.uom, r.prns, r.site_names,
      r.indented_qty, r.ordered_qty, r.pending_gm_qty, r.to_order_qty, r.store_qty, r.short_qty,
      r.first_needed ? dmy(r.first_needed) : '']),
  ]);

  if (error) return <ErrorNote error={error} onRetry={reload} />;
  return (
    <Card title="Items to buy"
      sub={`${plural(rows.length, 'item')} still to order across approved PRNs — open one to see its PRNs and BOQ lines`}
      actions={
        <>
          {canOrder && (
            <button className="btn pri" disabled={!chosen.length || !!bad} onClick={raise}
              title={bad ? `${bad.item_name}: order between 1 and ${qty(bad.to_order_qty)}` : undefined}>
              <Icon name="cart" />{chosen.length ? `Raise purchase order for ${plural(chosen.length, 'item')}` : 'Tick items to order'}
            </button>
          )}
          <select className="inp" style={{ width: 190 }} value={sort} onChange={(e) => setSort(e.target.value)}
            aria-label="Sort items">
            <option value="item">Item name</option>
            <option value="qty">Most to order</option>
            <option value="prns">On most PRNs</option>
            <option value="needed">Needed soonest</option>
          </select>
          <button className="btn sm" onClick={grab} disabled={!rows.length}><Icon name="download" size={14} />Download</button>
        </>
      }>
      {loading && !data ? <Loading what="items to buy" /> : (
        <div className="tw">
          <table>
            <thead>
              <tr>
                {canOrder && <th style={{ width: 36 }}><span className="vh">Tick to order</span></th>}
                <th style={{ width: 28 }} />
                <th style={{ width: 110 }}>Item code</th><th>Item</th><th style={{ width: 62 }}>Unit</th>
                <th className="rt">PRNs</th><th>Sites</th><th>First needed</th>
                <th className="rt">Asked for</th><th className="rt">Ordered</th><th className="rt">To order</th>
                <th className="rt" title="On the shelf at the central store now">At central store</th>
                <th className="rt" title="To order, less what the central store holds">Short</th>
                {canOrder && <th className="rt" style={{ width: 110 }}>Order now</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const k = key(r);
                const isOpen = open === k;
                return (
                  <Fragment key={k}>
                    <tr className="click" tabIndex={0} aria-expanded={isOpen}
                      onClick={() => setOpen(isOpen ? null : k)}
                      onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); setOpen(isOpen ? null : k); } }}
                      style={pick[k] != null ? { background: 'var(--brand-soft)' } : undefined}>
                      {canOrder && (
                        <td style={{ textAlign: 'center' }} onClick={(e) => { e.stopPropagation(); togglePick(r); }}>
                          <input type="checkbox" readOnly checked={pick[k] != null} aria-label={`Order ${r.item_name}`} />
                        </td>
                      )}
                      <td><Icon name={isOpen ? 'chevronDown' : 'chevronRight'} size={14} /></td>
                      <td style={{ whiteSpace: 'nowrap' }}><Code>{r.item_code}</Code></td>
                      <td><b>{r.item_name}</b>{r.make_name && <small>{r.make_name}</small>}</td>
                      <td>{r.uom}</td>
                      <td className="rt mono">{r.prns}</td>
                      <td>{r.site_names}</td>
                      <td className="mono">{r.first_needed ? dmy(r.first_needed) : '—'}</td>
                      <td className="rt mono">{qty(r.indented_qty)}</td>
                      <td className="rt mono">
                        {Number(r.ordered_qty) ? qty(r.ordered_qty) : '—'}
                        {Number(r.pending_gm_qty) > 0 && <small>{qty(r.pending_gm_qty)} awaiting approval</small>}
                      </td>
                      <td className="rt mono"><b>{qty(r.to_order_qty)}</b></td>
                      <td className="rt mono">
                        {Number(r.store_qty) ? qty(r.store_qty) : '—'}
                        {r.store_names && Number(r.store_qty) > 0 && <small>{r.store_names}</small>}
                      </td>
                      <td className="rt mono">
                        {Number(r.short_qty) > 0
                          ? <b style={{ color: 'var(--st-stop)' }}>{qty(r.short_qty)}</b>
                          : <Status tone="done" label="In stock" />}
                      </td>
                      {canOrder && (
                        <td onClick={(e) => e.stopPropagation()}>
                          {pick[k] != null && (
                            <input className="inp rt" type="number" min="0" step="any" inputMode="decimal"
                              style={{ width: 96 }} aria-label={`Quantity of ${r.item_name} to order now`}
                              value={pick[k]} max={Number(r.to_order_qty)}
                              onChange={(e) => setPick((x) => ({ ...x, [k]: e.target.value }))} />
                          )}
                        </td>
                      )}
                    </tr>
                    {isOpen && (
                      <tr>
                        <td colSpan={canOrder ? 2 : 1} />
                        <td colSpan={canOrder ? 12 : 11} style={{ background: 'var(--line-2)' }}>
                          <ItemSplit item={r} branchId={branchId} siteId={siteId} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
              {!rows.length && (
                <tr><td colSpan={canOrder ? 14 : 12}>
                  <Empty icon="check" title="Nothing to buy">
                    Every item on the approved PRNs here is already on a purchase order.
                  </Empty>
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

/** One item: the PRNs that want it, and the BOQ lines of each. */
function ItemSplit({ item, branchId, siteId }) {
  const qs = new URLSearchParams({
    ...(branchId ? { branchId } : {}), ...(siteId ? { siteId } : {}),
    ...(item.make_id ? { makeId: item.make_id } : {}),
  }).toString();
  const { data, loading, error } = useApi(`/procurement/items/${item.item_id}?${qs}`, [qs, item.item_id]);
  if (loading && !data) return <Loading what="the PRNs" />;
  if (error) return <ErrorNote error={error} />;
  return (
    <table>
      <thead>
        <tr>
          <th>PRN</th><th>Site</th><th>Needed by</th><th>BOQ lines</th>
          <th className="rt">Asked for</th><th className="rt">Ordered</th><th className="rt">To order</th>
        </tr>
      </thead>
      <tbody>
        {data.prns.map((p) => (
          <tr key={p.id}>
            <td>
              <Code as="b">{p.doc_no}</Code><small>{dmy(p.indent_date)}</small>
              <ViewPrn id={p.id} />
            </td>
            <td>{p.site_name}<small>{p.branch_name}</small></td>
            <td className="mono">{p.needed_by ? dmy(p.needed_by) : '—'}</td>
            <td className="mono">{p.lines.map((l) => `${l.sno}-${qty(l.qty)}`).join(', ')}</td>
            <td className="rt mono">{qty(p.indented_qty)}</td>
            <td className="rt mono">{Number(p.ordered_qty) ? qty(p.ordered_qty) : '—'}</td>
            <td className="rt mono"><b>{qty(p.to_order_qty)}</b></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/* ===================================================================
   The PRN as the site raised it, in a small window: its BOQ lines, what
   was asked on each, and the site's remarks — without leaving the list.
   =================================================================== */
function ViewPrn({ id }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="btn sm" style={{ marginTop: 4 }}
        onClick={(e) => { e.stopPropagation(); setOpen(true); }}>
        <Icon name="eye" size={14} />View PRN
      </button>
      {open && <PrnPeek id={id} onClose={() => setOpen(false)} />}
    </>
  );
}

function PrnPeek({ id, onClose }) {
  const { data, error, loading } = useApi(`/indents/${id}`, [id]);
  const [view, setView] = useState('items');
  // the whole BOQ, only when asked for
  const boq = useApi(view === 'boq' && data?.boqId ? `/indents/boq/${data.boqId}/lines` : null,
    [view, data?.boqId]);

  // one row per item, with the BOQ lines it was asked on (1a-15, 2a-5)
  const items = useMemo(() => {
    const by = new Map();
    for (const l of data?.lines || []) {
      const k = `${l.item_id}-${l.make_id || ''}`;
      const it = by.get(k) || { key: k, code: l.item_code, name: l.item_name, make: l.make_name, uom: l.uom, qty: 0, on: [] };
      it.qty += Number(l.qty) || 0;
      it.on.push(`${l.sno}-${qty(l.qty)}`);
      by.set(k, it);
    }
    return [...by.values()].sort((x, y) => x.name.localeCompare(y.name));
  }, [data]);

  // the full BOQ as work-order headings with their lines under them
  const asked = useMemo(() => Object.fromEntries((data?.lines || []).map((l) => [l.boq_line_id, Number(l.qty)])), [data]);
  const groups = useMemo(() => {
    const rows = Array.isArray(boq.data) ? boq.data : (boq.data?.lines || []);
    const by = new Map();
    for (const l of rows) {
      const g = by.get(l.wo_sno) || { sno: l.wo_sno, description: l.wo_description, lines: [] };
      g.lines.push(l);
      by.set(l.wo_sno, g);
    }
    return [...by.values()].sort((a, b) => Number(a.sno) - Number(b.sno));
  }, [boq.data]);

  const ap = data?.approval;
  const total = (data?.lines || []).reduce((t, l) => t + Number(l.qty || 0), 0);
  return (
    <div onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
      <Modal wide title={data ? `${data.docNo} — as raised by the site` : 'PRN'}
        sub="For reference — what the site asked for, and where it sits in the BOQ"
        onClose={onClose}
        actions={data && (
          <div className="seg" role="group" aria-label="How to show the PRN">
            <button type="button" aria-pressed={view === 'items'} onClick={() => setView('items')}>Items</button>
            <button type="button" aria-pressed={view === 'boq'} onClick={() => setView('boq')}>Full BOQ</button>
          </div>
        )}
        footer={<button className="btn pri" onClick={onClose}>Close</button>}>
        {error && <ErrorNote error={error} />}
        {loading && !data ? <Loading what="the PRN" /> : data && (
          <>
            <div className="stats" style={{ marginBottom: 16 }}>
              <Stat n={data.site.name} label="site" />
              <Stat n={data.boqDocNo} label="BOQ" />
              <Stat n={data.raisedBy || '—'} label={`raised on ${dmy(data.indentDate)}`} />
              <Stat n={data.neededBy ? dmy(data.neededBy) : '—'} label="needed by" />
              {ap && <Stat n={`${ap.approvedCount} of ${ap.steps.length}`}
                label={ap.status === 'APPROVED' ? 'approved' : 'approvals so far'} />}
            </div>

            {view === 'items' ? (
              <div className="tw">
                <table>
                  <thead>
                    <tr>
                      <th style={{ width: 110 }}>Item code</th><th>Item</th><th style={{ width: 62 }}>Unit</th>
                      <th className="rt" style={{ width: 90 }}>Asked</th>
                      <th title="BOQ line - quantity asked on it">BOQ lines</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((it) => (
                      <tr key={it.key}>
                        <td style={{ whiteSpace: 'nowrap' }}><Code>{it.code}</Code></td>
                        <td>{it.name}{it.make && <small>{it.make}</small>}</td>
                        <td>{it.uom}</td>
                        <td className="rt mono"><b>{qty(it.qty)}</b></td>
                        <td className="mono" style={{ color: 'var(--muted)' }}>{it.on.join(', ')}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <th colSpan={3} style={{ textAlign: 'left' }}>{plural(items.length, 'item')}</th>
                      <th className="rt mono">{qty(total)}</th>
                      <th />
                    </tr>
                  </tfoot>
                </table>
              </div>
            ) : boq.loading && !boq.data ? <Loading what="the BOQ" /> : boq.error ? <ErrorNote error={boq.error} /> : (
              <div className="tw">
                <table className="sheet">
                  <thead>
                    <tr>
                      <th style={{ width: 64 }}>Sl no</th><th>Description</th><th style={{ width: 62 }}>Unit</th>
                      <th className="rt" style={{ width: 86 }}>BOQ qty</th>
                      <th className="rt" style={{ width: 104 }} title="On every PRN sent so far, this one included">Indented till date</th>
                      <th className="rt" style={{ width: 90 }}>Asked now</th>
                    </tr>
                  </thead>
                  <tbody>
                    {groups.map((g) => (
                      <Fragment key={g.sno}>
                        <tr className="wo-row">
                          <td className="sn">{g.sno}</td>
                          <td colSpan={5}><b>{g.description}</b></td>
                        </tr>
                        {g.lines.map((l) => {
                          const now = asked[l.boq_line_id];
                          return (
                            <tr key={l.boq_line_id} className="kid"
                              style={now ? { background: 'var(--brand-soft)' } : undefined}>
                              <td>{l.sno}</td>
                              <td>{l.item_name}<small><Code>{l.item_code}</Code>{l.make_name ? ` · ${l.make_name}` : ''}</small></td>
                              <td>{l.uom}</td>
                              <td className="rt mono">{qty(l.effective_est)}</td>
                              <td className="rt mono">{Number(l.committed_qty) ? qty(l.committed_qty) : '—'}</td>
                              <td className="rt mono">{now ? <b>{qty(now)}</b> : <span style={{ color: 'var(--faint)' }}>—</span>}</td>
                            </tr>
                          );
                        })}
                      </Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </Modal>
    </div>
  );
}
