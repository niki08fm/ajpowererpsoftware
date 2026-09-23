import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
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

        {loading && !data ? <Loading what="PRNs to buy" /> : (
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
                      <td><Code as="b">{r.doc_no}</Code><small>by {r.raised_by_name}</small></td>
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
        )}
      </div>

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
function NewOrder({ indentIds, comparison, onClose, onDone }) {
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
          .filter((l) => l.toOrderQty > 0)
          .map((l) => [l.itemId, {
            qty: String(l.toOrderQty),
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
      sub={`${plural(demand.indents.length, 'PRN')} · ${plural(demand.lines.length, 'item')}`}
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
              {demand.lines.map((l) => {
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
