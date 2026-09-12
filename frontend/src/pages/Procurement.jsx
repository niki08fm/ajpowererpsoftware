import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useApp, PageHead } from '../App';
import { api, qty, money, dmy, today, addDays } from '../api';
import { downloadCsv } from '../download';
import {
  useApi, Card, Tag, Empty, Loading, ErrorNote, Banner, Field, Modal, Stat, useToast,
} from '../components/ui';

/**
 * The buyer's desk.
 *
 * Every approved indent and how far it has got. It stays here until
 * every item on it has been ordered — a half-ordered indent is not
 * finished business. Tick the ones being bought together and the
 * demand comes out as one line per item, because the same cable wanted
 * by three sites is one negotiation.
 */

const STAGES = {
  AWAITING_PO: { label: 'Waiting for an order', kind: 'bad' },
  PO_WITH_GM: { label: 'With the GM', kind: 'warn' },
  PART_ORDERED: { label: 'Part ordered', kind: 'warn' },
  ORDERED: { label: 'Ordered', kind: 'ok' },
  PART_RECEIVED: { label: 'Part received', kind: 'warn' },
  RECEIVED: { label: 'Received', kind: 'ok' },
};
export const StageTag = ({ stage, extra }) => {
  const s = STAGES[stage] || { label: stage, kind: '' };
  return <Tag kind={s.kind}>{s.label}{extra ? ` · ${extra}` : ''}</Tag>;
};

export default function Procurement() {
  const { branchId } = useApp();
  const toast = useToast();
  const [f, setF] = useState({ q: '', siteId: '', stage: 'OPEN', sort: 'needed' });
  const qs = new URLSearchParams({
    ...(branchId ? { branchId } : {}),
    ...(f.q ? { q: f.q } : {}),
    ...(f.siteId ? { siteId: f.siteId } : {}),
    stage: f.stage, sort: f.sort,
  }).toString();

  const { data, error, loading, reload } = useApi(branchId ? `/procurement/queue?${qs}` : null,
    [branchId, qs]);
  const { data: sites } = useApi(branchId ? `/sites?branchId=${branchId}` : null, [branchId]);
  const [picked, setPicked] = useState([]);
  const [buying, setBuying] = useState(false);
  const [comparing, setComparing] = useState(false);
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();

  // "Raise the order" on a decided comparison lands here: pick up its
  // indents and its rates rather than making the buyer retype either
  const fromComparison = params.get('comparison');
  const { data: cmp } = useApi(fromComparison ? `/comparisons/${fromComparison}` : null,
    [fromComparison]);
  useEffect(() => {
    if (!cmp || cmp.status !== 'DECIDED') return;
    setPicked(cmp.indents.map((i) => i.id));
    setBuying(true);
  }, [cmp]);

  /**
   * Compare before buying. The sheet is seeded with exactly what these
   * indents still need, so nobody retypes a requirement that is
   * already worked out.
   */
  const compare = async () => {
    setComparing(true);
    try {
      const r = await api.post('/comparisons', {
        branchId,
        indentIds: picked,
        title: chosen.length === 1
          ? `${chosen[0].doc_no} · ${chosen[0].site_name}`
          : `${chosen.length} indents · ${sitesOf.size} site(s)`,
      });
      nav(`/comparisons/${r.id}`);
    } catch (e) { toast(e.message, 'bad'); }
    setComparing(false);
  };

  const rows = data || [];
  const chosen = rows.filter((r) => picked.includes(r.id));
  const sitesOf = new Set(chosen.map((r) => r.site_id));

  const toggle = (id) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  const grab = () => downloadCsv('indents-to-order', [
    ['Indent', 'Site', 'Raised', 'Needed by', 'Stage', 'Items', 'Indented', 'Ordered', 'Received', 'To order'],
    ...rows.map((r) => [r.doc_no, r.site_name, dmy(r.indent_date), r.needed_by ? dmy(r.needed_by) : '',
      (STAGES[r.stage] || {}).label || r.stage, r.item_count,
      r.indented_qty, r.ordered_qty, r.received_qty, r.to_order_qty]),
  ]);

  return (
    <>
      <PageHead title="To buy" sub="Approved indents, and how far each one has got"
        actions={
          <div style={{ display: 'flex', gap: 9 }}>
            <button className="btn" onClick={grab} disabled={!rows.length}>Download</button>
            <button className="btn" disabled={!picked.length || comparing}
              onClick={compare}>
              Compare rates{picked.length ? ` (${picked.length})` : ''}
            </button>
            <button className="btn pri" disabled={!picked.length} onClick={() => setBuying(true)}>
              Raise an order{picked.length ? ` (${picked.length})` : ''}
            </button>
          </div>
        } />
      <div className="page-body">
        {error && <ErrorNote error={error} onRetry={reload} />}

        <Card>
          <div className="pad" style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <Field label="Search">
              <input className="inp" style={{ width: 230 }} placeholder="Indent number or site"
                value={f.q} onChange={(e) => setF((x) => ({ ...x, q: e.target.value }))} />
            </Field>
            <Field label="Site">
              <select className="inp" style={{ width: 190 }} value={f.siteId}
                onChange={(e) => setF((x) => ({ ...x, siteId: e.target.value }))}>
                <option value="">Every site</option>
                {(sites || []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </Field>
            <Field label="Stage">
              <select className="inp" style={{ width: 190 }} value={f.stage}
                onChange={(e) => setF((x) => ({ ...x, stage: e.target.value }))}>
                <option value="OPEN">Still to order</option>
                <option value="AWAITING_PO">Waiting for an order</option>
                <option value="PART_ORDERED">Part ordered</option>
                <option value="ORDERED">Ordered</option>
                <option value="PART_RECEIVED">Part received</option>
                <option value="RECEIVED">Received</option>
                <option value="ALL">Everything</option>
              </select>
            </Field>
            <Field label="Sort by">
              <select className="inp" style={{ width: 160 }} value={f.sort}
                onChange={(e) => setF((x) => ({ ...x, sort: e.target.value }))}>
                <option value="needed">Needed soonest</option>
                <option value="raised">Recently raised</option>
                <option value="site">Site</option>
                <option value="value">Most outstanding</option>
              </select>
            </Field>
            <div style={{ flex: 1 }} />
            <div style={{ color: 'var(--muted)', paddingBottom: 8 }}>
              {rows.length} indent{rows.length === 1 ? '' : 's'}
            </div>
          </div>
        </Card>

        {picked.length > 1 && sitesOf.size > 1 && (
          <Banner kind="warn" icon="!">
            These indents are for <b>{sitesOf.size} different sites</b>, so the order has to be
            delivered to a store and issued on from there.
          </Banner>
        )}

        {loading ? <Loading /> : (
          <Card title="Approved indents">
            <div className="tw">
              <table>
                <thead>
                  <tr>
                    <th style={{ width: 40 }} />
                    <th>Indent</th><th>Site</th><th>Needed by</th>
                    <th className="rt">Items</th>
                    <th className="rt">Indented</th><th className="rt">Ordered</th>
                    <th className="rt">Received</th><th className="rt">To order</th>
                    <th>Stage</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id} className="click" onClick={() => toggle(r.id)}
                      style={picked.includes(r.id) ? { background: 'var(--brand-soft)' } : undefined}>
                      <td style={{ textAlign: 'center' }}>
                        <input type="checkbox" readOnly checked={picked.includes(r.id)} />
                      </td>
                      <td><b className="mono">{r.doc_no}</b><small>{r.raised_by_name}</small></td>
                      <td>{r.site_name}<small className="mono">{r.site_code}</small></td>
                      <td>
                        {r.needed_by ? dmy(r.needed_by) : '—'}
                        {Number(r.late) === 1 && <Tag kind="bad">late</Tag>}
                      </td>
                      <td className="rt mono">{r.item_count}</td>
                      <td className="rt mono">{qty(r.indented_qty)}</td>
                      <td className="rt mono">{Number(r.ordered_qty) ? qty(r.ordered_qty) : '—'}</td>
                      <td className="rt mono">{Number(r.received_qty) ? qty(r.received_qty) : '—'}</td>
                      <td className="rt mono">
                        <b style={{ color: Number(r.to_order_qty) > 0 ? 'var(--bad)' : undefined }}>
                          {Number(r.to_order_qty) ? qty(r.to_order_qty) : 'nil'}
                        </b>
                      </td>
                      <td><StageTag stage={r.stage} extra={r.po_count ? `${r.po_count} PO` : ''} /></td>
                    </tr>
                  ))}
                  {!rows.length && (
                    <tr><td colSpan={10}>
                      <Empty title="Nothing waiting to be bought">
                        Every approved indent in this branch has been ordered.
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
        <NewOrder indentIds={picked} comparison={cmp && cmp.status === 'DECIDED' ? cmp : null}
          onClose={() => { setBuying(false); setParams({}); }}
          onDone={() => {
            setBuying(false); setPicked([]); setParams({}); reload(); toast('Order raised', 'ok');
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
    if (!lines.length) return toast('Order at least one item', 'bad');
    const noRate = lines.find((l) => !(Number(order[l.itemId].rate) > 0));
    if (noRate) return toast(`${noRate.itemCode} has no rate`, 'bad');
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
      toast(submit ? `${r.docNo} sent to the GM` : `${r.docNo} saved as a draft`, 'ok');
      onDone();
      nav(`/purchase-orders/${r.id}`);
    } catch (e) { toast(e.message, 'bad'); }
    setBusy(false);
    return undefined;
  };

  if (err) {
    return <Modal full title="Raise an order" onClose={onClose}><ErrorNote error={err} /></Modal>;
  }
  if (!demand) return <Modal full title="Raise an order" onClose={onClose}><Loading /></Modal>;

  return (
    <Modal full title="Raise a purchase order"
      sub={`${demand.indents.length} indent(s) · ${demand.lines.length} item(s)`}
      onClose={onClose}
      footer={<>
        <div style={{ marginRight: 'auto', display: 'flex', gap: 16, alignItems: 'center' }}>
          <Stat n={lines.length} label="lines" />
          <Stat n={money(value)} label="incl. GST" tone="brand" />
        </div>
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn" disabled={busy} onClick={() => save(false)}>Save draft</button>
        <button className="btn pri" disabled={busy} onClick={() => save(true)}>Send to the GM</button>
      </>}>

      {comparison && (
        <Banner kind="ok" icon="✓">
          Rates from <b>{comparison.doc_no}</b> — {comparison.chosen_supplier_name} was chosen
          {comparison.decided_note ? `: ${comparison.decided_note}` : ''}.
        </Banner>
      )}
      <Banner kind={demand.singleSite ? 'info' : 'warn'} icon={demand.singleSite ? '▤' : '!'}>
        {demand.singleSite
          ? <>One site&apos;s indents, so this can go straight there or to the store.</>
          : <>These indents are for <b>more than one site</b>, so the order lands at the store and is
            issued on from there.</>}
        {' '}Covering: {demand.indents.map((i) => i.docNo).join(', ')}.
      </Banner>

      <Card>
        <div className="pad">
          <div className="row2">
            <Field label="Supplier"
              hint={comparison ? `Chosen on ${comparison.doc_no}` : undefined}>
              <select className="inp" value={head.supplierId}
                onChange={(e) => setHead((h) => ({ ...h, supplierId: e.target.value }))}>
                <option value="">— choose —</option>
                {(suppliers || []).map((s) => (
                  <option key={s.id} value={s.id}>{s.name}{s.gstin ? ` · ${s.gstin}` : ''}</option>
                ))}
              </select>
            </Field>
            <Field label="Deliver to">
              <select className="inp" value={head.deliverToId}
                onChange={(e) => setHead((h) => ({ ...h, deliverToId: e.target.value }))}>
                {demand.deliverOptions.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name} · {o.type === 'STORE' ? 'store' : 'site'}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <div className="row2">
            <Field label="Order date">
              <input className="inp" type="date" value={head.poDate}
                onChange={(e) => setHead((h) => ({ ...h, poDate: e.target.value }))} />
            </Field>
            <Field label="Expected by" hint="What the delivery pipeline measures late against.">
              <input className="inp" type="date" value={head.expectedDate}
                onChange={(e) => setHead((h) => ({ ...h, expectedDate: e.target.value }))} />
            </Field>
          </div>
        </div>
      </Card>

      <Card title="What to order"
        sub="One line per item across every indent chosen. What the store already holds is beside it.">
        <div className="tw">
          <table className="sheet">
            <thead>
              <tr>
                <th style={{ width: 104 }}>Item Code</th>
                <th style={{ minWidth: 230 }}>Description</th>
                <th style={{ width: 66 }}>Unit</th>
                <th className="rt" style={{ width: 86 }}>Indented</th>
                <th className="rt" style={{ width: 88 }}>To order</th>
                <th className="rt" style={{ width: 92 }}>In store</th>
                <th className="rt" style={{ width: 96 }}>Store rate</th>
                <th className="rt" style={{ width: 96 }}>Last paid</th>
                <th className="rt" style={{ width: 92 }}>Order qty</th>
                <th className="rt" style={{ width: 96 }}>Rate</th>
                <th className="rt" style={{ width: 70 }}>GST</th>
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
                    <td className="mono" style={{ color: 'var(--brand-ink)' }}>{l.itemCode}</td>
                    <td>{l.itemName}{l.makeName && <small>{l.makeName}</small>}</td>
                    <td>{l.uom}</td>
                    <td className="rt mono">{qty(l.indentedQty)}</td>
                    <td className="rt mono"><b>{qty(l.toOrderQty)}</b></td>
                    <td className="rt mono" style={{ color: covered ? 'var(--ok)' : undefined }}>
                      {l.storeQty ? qty(l.storeQty) : '—'}
                      {covered && <small style={{ color: 'var(--ok)' }}>covers it</small>}
                    </td>
                    <td className="rt mono">{l.storeRate ? money(l.storeRate) : '—'}</td>
                    <td className="rt mono">
                      {l.lastPaidRate ? money(l.lastPaidRate) : '—'}
                      {l.lastPaidOn && <small>{dmy(l.lastPaidOn)}</small>}
                    </td>
                    <td><input className="inp rt" type="number" min="0" step="any" placeholder="—"
                      value={o.qty ?? ''} onChange={(e) => set(l.itemId, 'qty', e.target.value)} /></td>
                    <td><input className="inp rt" type="number" min="0" step="any"
                      value={o.rate ?? ''} onChange={(e) => set(l.itemId, 'rate', e.target.value)} /></td>
                    <td><input className="inp rt" type="number" min="0" step="any"
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
