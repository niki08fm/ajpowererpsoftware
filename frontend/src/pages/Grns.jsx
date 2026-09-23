import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useApp, PageHead } from '../App';
import { api, qty, dmy, today, withBranch, canWrite } from '../api';
import { downloadCsv, printDoc } from '../download';
import {
  useApi, Card, Tag, Empty, Loading, ErrorNote, Banner, Field, Modal, Stat, Meter, useToast,
} from '../components/ui';

/**
 * Goods receipt notes.
 *
 * A GRN is not a form somebody fills in afterwards. It is what
 * acknowledging a delivery produces: you say what came off the lorry,
 * the stock goes on the shelf, and the note exists. So this screen is
 * two halves — the orders still owing something, and the notes already
 * raised — and the only action on it is acknowledging.
 */

/* ===================================================================
   Acknowledging an order. This is what writes the note.
   =================================================================== */
export function ReceiveGrn({ poId, at, atSiteId, onClose, onDone }) {
  const toast = useToast();
  const { data, loading } = useApi(`/purchase-orders/${poId}/pending`, [poId]);
  const [got, setGot] = useState({});
  const [head, setHead] = useState({ receiptDate: today(), supplierDc: '', note: '' });
  const [busy, setBusy] = useState(false);

  const lines = (data?.lines || []).filter((l) => Number(got[l.po_line_id]) > 0);
  const total = lines.reduce((t, l) => t + Number(got[l.po_line_id]), 0);

  const save = async () => {
    if (!lines.length) return toast('Enter what actually came off the lorry', 'bad');
    setBusy(true);
    try {
      const r = await api.post(`/purchase-orders/${poId}/receipts`, {
        receiptDate: head.receiptDate,
        atSiteId: atSiteId || undefined,
        supplierDc: head.supplierDc || undefined,
        note: head.note || undefined,
        lines: lines.map((l) => ({ poLineId: l.po_line_id, qty: Number(got[l.po_line_id]) })),
      });
      toast(r.poState === 'RECEIVED'
        ? `${r.docNo} raised — the order is complete`
        : `${r.docNo} raised — ${qty(r.pendingQty)} still to come`, 'ok');
      onDone(r);
    } catch (e) { toast(e.message, 'bad'); }
    setBusy(false);
    return undefined;
  };

  if (loading) return <Modal wide title="Acknowledge" onClose={onClose}><Loading /></Modal>;

  return (
    <Modal wide title={`Acknowledge ${data.docNo}`}
      sub={`${data.supplier} · into ${at || data.receivedAtName}`}
      onClose={onClose}
      footer={<>
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn" onClick={() => setGot(Object.fromEntries(
          data.lines.map((l) => [l.po_line_id, String(l.pending_qty)])))}>Everything arrived</button>
        <button className="btn pri" disabled={busy} onClick={save}>
          {total > 0 ? `Take in ${qty(total)}` : 'Take it in'}
        </button>
      </>}>
      <Banner kind="info" icon="↓">
        What you take in goes on the shelf at <b>{at || data.receivedAtName}</b> at the rate this
        order agreed, and a GRN note is raised for it. Anything short keeps the order in the
        delivery pipeline.
      </Banner>
      <div className="row2">
        <Field label="Received on">
          <input className="inp" type="date" value={head.receiptDate}
            onChange={(e) => setHead((h) => ({ ...h, receiptDate: e.target.value }))} />
        </Field>
        <Field label="Their challan / invoice no." hint="The supplier's own document number">
          <input className="inp" value={head.supplierDc}
            onChange={(e) => setHead((h) => ({ ...h, supplierDc: e.target.value }))} />
        </Field>
      </div>
      <div className="tw">
        <table className="sheet">
          <thead>
            <tr>
              <th style={{ width: 100 }}>Code</th><th>Item</th><th style={{ width: 60 }}>Unit</th>
              <th className="rt" style={{ width: 88 }}>Ordered</th>
              <th className="rt" style={{ width: 92 }}>Still owed</th>
              <th className="rt" style={{ width: 100 }}>Arrived</th>
            </tr>
          </thead>
          <tbody>
            {data.lines.map((l) => (
              <tr key={l.po_line_id}
                style={Number(got[l.po_line_id]) > 0 ? { background: 'var(--brand-soft)' } : undefined}>
                <td className="mono" style={{ color: 'var(--brand-ink)' }}>{l.item_code}</td>
                <td>{l.item_name}</td><td>{l.uom}</td>
                <td className="rt mono">{qty(l.ordered_qty)}</td>
                <td className="rt mono"><b>{qty(l.pending_qty)}</b></td>
                <td><input className="inp rt" type="number" min="0" step="any" placeholder="—"
                  value={got[l.po_line_id] ?? ''}
                  onChange={(e) => setGot((x) => ({ ...x, [l.po_line_id]: e.target.value }))} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{ marginTop: 14 }}>
        <Field label="Note">
          <input className="inp" value={head.note}
            onChange={(e) => setHead((h) => ({ ...h, note: e.target.value }))}
            placeholder="e.g. two drums damaged, sent back with the driver" />
        </Field>
      </div>
    </Modal>
  );
}

/* ===================================================================
   The desk: orders still owing, and the notes already raised.
   =================================================================== */
export function Grns() {
  const { branchId, storeId } = useApp();
  const [tab, setTab] = useState('pending');
  const [receiving, setReceiving] = useState(null);
  const { data, error, loading, reload } = useApi(
    branchId && storeId ? `/grns/desk?branchId=${branchId}&storeId=${storeId}` : null,
    [branchId, storeId]);

  if (error) {
    return <div className="page-body"><ErrorNote error={error} onRetry={reload} /></div>;
  }
  if (loading || !data) return <Loading />;

  const { place, pending, history, totals } = data;

  return (
    <>
      <PageHead title="GRN" sub={`Taking material in at ${place.name}`} />
      <div className="page-body">
        <div className="stats">
          <Stat n={totals.orders} label="orders still owing" />
          <Stat n={qty(totals.pendingQty)} label="units to come" />
          <Stat n={totals.overdue} label="past their date"
            tone={totals.overdue ? 'bad' : undefined} />
          <Stat n={totals.notes} label="notes raised" tone="brand" />
        </div>

        <Banner kind="info" icon="↓">
          A GRN is not written separately — it is what acknowledging a delivery produces. Take in
          what arrived and the note appears in the history below, with the stock it created.
          Only orders sent to <b>{place.name}</b> appear here: a delivery is signed for where it
          was sent, and nowhere else.
        </Banner>

        <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
          <button className={`btn sm ${tab === 'pending' ? 'pri' : ''}`}
            onClick={() => setTab('pending')}>
            Waiting to be received{pending.length > 0 ? ` (${pending.length})` : ''}
          </button>
          <button className={`btn sm ${tab === 'history' ? 'pri' : ''}`}
            onClick={() => setTab('history')}>
            Notes raised{history.length > 0 ? ` (${history.length})` : ''}
          </button>
        </div>

        {tab === 'pending' ? (
          <Card title="Orders this store is still owed"
            sub="An order sent straight to a site is that site's to sign for, not this one's">
            <div className="tw">
              <table>
                <thead>
                  <tr>
                    <th>Order</th><th>Supplier</th><th>Answering</th><th>Expected</th>
                    <th className="rt">Ordered</th><th style={{ width: 130 }}>Received</th>
                    <th className="rt">Still owed</th><th style={{ width: 120 }} />
                  </tr>
                </thead>
                <tbody>
                  {pending.map((p) => (
                    <tr key={p.po_id}>
                      <td><Link to={`/purchase-orders/${p.po_id}`}>
                        <b className="mono">{p.doc_no}</b></Link>
                        <small>{dmy(p.po_date)}</small></td>
                      <td>{p.supplier_name}</td>
                      <td><small className="mono">{p.prns || '—'}</small></td>
                      <td>
                        {p.expected_date ? dmy(p.expected_date) : '—'}
                        {Number(p.overdue) > 0 && <small style={{ color: 'var(--bad)' }}>
                          {p.overdue} day{p.overdue === 1 ? '' : 's'} late</small>}
                      </td>
                      <td className="rt mono">{qty(p.ordered_qty)}</td>
                      <td>
                        <Meter value={Number(p.received_qty)} max={Number(p.ordered_qty)} />
                        <small className="mono">
                          {qty(p.received_qty)} of {qty(p.ordered_qty)}
                          {Number(p.grn_count) > 0 && ` · ${p.grn_count} note${p.grn_count === 1 ? '' : 's'}`}
                        </small>
                      </td>
                      <td className="rt mono"><b>{qty(p.pending_qty)}</b></td>
                      <td className="rt">
                        <button className="btn sm pri" onClick={() => setReceiving(p)}>
                          Acknowledge
                        </button>
                      </td>
                    </tr>
                  ))}
                  {!pending.length && (
                    <tr><td colSpan={8}>
                      <Empty title="Nothing is on its way here">
                        Every signed order directed at this store has been received in full.
                      </Empty>
                    </td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        ) : (
          <Card title="Notes raised here"
            sub="The last 50"
            actions={<Link className="btn sm" to="/grns/register">Full register</Link>}>
            <div className="tw">
              <table>
                <thead>
                  <tr>
                    <th>Note</th><th>Order</th><th>Supplier</th><th>Their DC</th>
                    <th className="rt">Units</th>
                    <th>Taken in by</th><th />
                  </tr>
                </thead>
                <tbody>
                  {history.map((g) => (
                    <tr key={g.grn_id}>
                      <td><Link to={`/grns/${g.grn_id}`}><b className="mono">{g.doc_no}</b></Link>
                        <small>{dmy(g.receipt_date)}</small></td>
                      <td><Link to={`/purchase-orders/${g.po_id}`} className="mono">{g.po_no}</Link></td>
                      <td>{g.supplier_name}</td>
                      <td className="mono">{g.supplier_dc || '—'}</td>
                      <td className="rt mono">{qty(g.grn_qty)}</td>
                      <td>{g.received_by_name || '—'}</td>
                      <td>
                        {g.status === 'DRAFT' ? <Tag kind="warn">Not in stock</Tag> : null}
                        {Number(g.days_late) > 0 && <Tag kind="bad">{g.days_late}d late</Tag>}
                      </td>
                    </tr>
                  ))}
                  {!history.length && (
                    <tr><td colSpan={8}>
                      <Empty title="Nothing has been taken in yet">
                        Acknowledge a delivery and its note appears here.
                      </Empty>
                    </td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        )}
      </div>

      {receiving && (
        <ReceiveGrn poId={receiving.po_id} at={place.name} atSiteId={place.id}
          onClose={() => setReceiving(null)}
          onDone={() => { setReceiving(null); setTab('history'); reload(); }} />
      )}
    </>
  );
}

/* ===================================================================
   The full register, searchable.
   =================================================================== */
export function GrnRegister() {
  const { branchId } = useApp();
  const [f, setF] = useState({ q: '', status: 'ALL', from: '', to: '', sort: 'date', siteId: '' });
  const { data: sites } = useApi(withBranch('/sites', branchId), [branchId]);
  const { data: stores } = useApi(withBranch('/sites/stores/list', branchId),
    [branchId]);
  const qs = new URLSearchParams({
    ...(branchId ? { branchId } : {}),
    ...(f.q ? { q: f.q } : {}),
    ...(f.siteId ? { siteId: f.siteId } : {}),
    ...(f.from ? { from: f.from } : {}),
    ...(f.to ? { to: f.to } : {}),
    status: f.status, sort: f.sort,
  }).toString();
  const { data, error, loading, reload } = useApi(`/grns?${qs}`, [branchId, qs]);
  const rows = data?.rows || [];

  const grab = () => downloadCsv('grn-register', [
    ['Note', 'Date', 'Order', 'Supplier', 'Their DC', 'Taken in at', 'Lines', 'Units',
      'Days late', 'Status'],
    ...rows.map((r) => [r.doc_no, dmy(r.receipt_date), r.po_no, r.supplier_name,
      r.supplier_dc || '', r.site_name, r.line_count, r.grn_qty, r.days_late, r.status]),
  ]);

  return (
    <>
      <PageHead title="GRN register" sub="Every note, wherever it was taken in"
        actions={
          <div style={{ display: 'flex', gap: 9 }}>
            <Link className="btn" to="/grns">Back to the desk</Link>
            <button className="btn" onClick={grab} disabled={!rows.length}>Download</button>
          </div>
        } />
      <div className="page-body">
        {error && <ErrorNote error={error} onRetry={reload} />}

        <Card>
          <div className="pad" style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <Field label="Search" hint="Note, order, their DC, supplier">
              <input className="inp" style={{ width: 230 }} value={f.q}
                onChange={(e) => setF((x) => ({ ...x, q: e.target.value }))} />
            </Field>
            <Field label="Taken in at">
              <select className="inp" style={{ width: 190 }} value={f.siteId}
                onChange={(e) => setF((x) => ({ ...x, siteId: e.target.value }))}>
                <option value="">Anywhere</option>
                {[...(stores || []), ...(sites || [])].map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </Field>
            <Field label="From">
              <input className="inp" type="date" style={{ width: 148 }} value={f.from}
                onChange={(e) => setF((x) => ({ ...x, from: e.target.value }))} />
            </Field>
            <Field label="To">
              <input className="inp" type="date" style={{ width: 148 }} value={f.to}
                onChange={(e) => setF((x) => ({ ...x, to: e.target.value }))} />
            </Field>
            <Field label="Status">
              <select className="inp" style={{ width: 150 }} value={f.status}
                onChange={(e) => setF((x) => ({ ...x, status: e.target.value }))}>
                <option value="ALL">Everything</option>
                <option value="CONFIRMED">In stock</option>
                <option value="DRAFT">Not in stock</option>
              </select>
            </Field>
            <Field label="Sort by">
              <select className="inp" style={{ width: 160 }} value={f.sort}
                onChange={(e) => setF((x) => ({ ...x, sort: e.target.value }))}>
                <option value="date">Newest</option>
                <option value="oldest">Oldest</option>
                <option value="value">Largest value</option>
                <option value="late">Latest against its date</option>
                <option value="supplier">Supplier</option>
              </select>
            </Field>
          </div>
        </Card>

        {data && (
          <div className="stats">
            <Stat n={data.totals.notes} label="notes" />
            <Stat n={qty(data.totals.qty)} label="units taken in" />
            <Stat n={data.totals.late} label="arrived late"
              tone={data.totals.late ? 'bad' : undefined} />
          </div>
        )}

        {loading ? <Loading /> : (
          <Card title={`${rows.length} note${rows.length === 1 ? '' : 's'}`}>
            <div className="tw">
              <table>
                <thead>
                  <tr>
                    <th>Note</th><th>Order</th><th>Supplier</th><th>Their DC</th>
                    <th>Taken in at</th><th className="rt">Lines</th><th className="rt">Units</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.grn_id}>
                      <td><Link to={`/grns/${r.grn_id}`}><b className="mono">{r.doc_no}</b></Link>
                        <small>{dmy(r.receipt_date)}</small></td>
                      <td><Link to={`/purchase-orders/${r.po_id}`} className="mono">{r.po_no}</Link></td>
                      <td>{r.supplier_name}</td>
                      <td className="mono">{r.supplier_dc || '—'}</td>
                      <td>{r.site_name}<small>{r.site_type === 'STORE' ? 'store' : 'site'}</small></td>
                      <td className="rt mono">{r.line_count}</td>
                      <td className="rt mono">{qty(r.grn_qty)}</td>
                      <td>
                        {r.status === 'DRAFT' && <Tag kind="warn">Not in stock</Tag>}
                        {Number(r.days_late) > 0 && <Tag kind="bad">{r.days_late}d late</Tag>}
                      </td>
                    </tr>
                  ))}
                  {!rows.length && (
                    <tr><td colSpan={9}><Empty title="No notes match" /></td></tr>
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
   One note, read end to end.
   =================================================================== */
export function GrnDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const toast = useToast();
  const { data, error, loading, reload } = useApi(`/grns/${id}`, [id]);

  if (loading) return <Loading />;
  if (error) return <div className="page-body"><ErrorNote error={error} onRetry={reload} /></div>;

  const confirm = async () => {
    try {
      const r = await api.post(`/grns/${id}/confirm`);
      toast(`${qty(r.qty)} on the shelf`, 'ok');
      reload();
    } catch (e) { toast(e.message, 'bad'); }
  };

  // The note is a record of what arrived. Ordered, still owed and the
  // rest belong to the order; putting them on the note invites somebody
  // to read a number off it that the note is not making a claim about.
  const slip = () => printDoc({
    title: 'Goods Receipt Note',
    docNo: data.doc_no,
    sub: `Taken in at ${data.site_name}`,
    meta: [
      ['Date', dmy(data.receipt_date)],
      ['Supplier', data.supplier_name],
      ['Their challan / invoice', data.supplier_dc || '—'],
      ['Against order', data.po_no],
      ['Taken in by', data.received_by_name || '—'],
      data.note ? ['Remark', data.note] : null,
    ],
    columns: [
      { label: 'Code' }, { label: 'Item' }, { label: 'Unit' },
      { label: 'Received', rt: true },
    ],
    rows: data.lines.map((l) => [l.item_code, l.item_name, l.uom, qty(l.qty)]),
    totals: ['', '', 'Total', qty(data.grn_qty)],
    footer: data.status === 'CONFIRMED'
      ? 'This material is on the shelf.'
      : 'DRAFT — this material is not on the shelf yet.',
  });

  const grab = () => downloadCsv(`grn-${data.doc_no}`, [
    ['Goods receipt note', data.doc_no],
    ['Date', dmy(data.receipt_date)],
    ['Against order', data.po_no], ['Supplier', data.supplier_name],
    ['Their challan', data.supplier_dc || ''],
    ['Taken in at', data.site_name], ['Taken in by', data.received_by_name || ''],
    ['Status', data.status], [],
    ['Code', 'Item', 'Unit', 'Ordered', 'This note', 'Received in all', 'Still owed', 'Answering'],
    ...data.lines.map((l) => [l.item_code, l.item_name, l.uom, l.ordered_qty, l.qty,
      l.received_qty, l.pending_qty, l.against || '']),
    [], ['', '', '', '', data.grn_qty],
  ]);

  return (
    <>
      <PageHead title={data.doc_no}
        sub={`Against ${data.po_no} · ${data.supplier_name} · into ${data.site_name}`}
        actions={
          <div style={{ display: 'flex', gap: 9, flexWrap: 'wrap' }}>
            <button className="btn" onClick={() => nav(-1)}>Back</button>
            <button className="btn" onClick={grab}>Download</button>
            <button className="btn" onClick={slip}>Print the note</button>
            {data.canConfirm && canWrite('/grns') && <button className="btn pri" onClick={confirm}>Put it on the shelf</button>}
          </div>
        } />
      <div className="page-body">
        {data.status === 'DRAFT' && (
          <Banner kind="warn" icon="!">
            This note is drafted. Nothing is on the shelf and the order does not count it received
            until it is confirmed.
          </Banner>
        )}
        {Number(data.days_late) > 0 && (
          <Banner kind="warn" icon="◷">
            Arrived <b>{data.days_late} day{data.days_late === 1 ? '' : 's'}</b> after the date the
            order asked for ({dmy(data.expected_date)}).
          </Banner>
        )}

        <div className="grid2">
          <div>
            <Card title="What came in"
              sub="Each line against what the order asked for, and what it is still owed">
              <div className="tw">
                <table className="sheet">
                  <thead>
                    <tr>
                      <th style={{ width: 98 }}>Code</th><th>Item</th><th style={{ width: 56 }}>Unit</th>
                      <th className="rt">Ordered</th><th className="rt">This note</th>
                      <th className="rt">Still owed</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.lines.map((l) => (
                      <tr key={l.grn_line_id}>
                        <td className="mono" style={{ color: 'var(--brand-ink)' }}>{l.item_code}</td>
                        <td>{l.item_name}
                          {l.against && <small>answering {l.against}</small>}</td>
                        <td>{l.uom}</td>
                        <td className="rt mono">{qty(l.ordered_qty)}</td>
                        <td className="rt mono"><b>{qty(l.qty)}</b></td>
                        <td className="rt mono"
                          style={{ color: Number(l.pending_qty) > 0 ? 'var(--bad)' : 'var(--ok)' }}>
                          {Number(l.pending_qty) > 0 ? qty(l.pending_qty) : 'nil'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <th colSpan={4} className="rt">Total</th>
                      <th className="rt mono">{qty(data.grn_qty)}</th>
                      <th />
                    </tr>
                  </tfoot>
                </table>
              </div>
            </Card>

            <Card title="The stock this note created"
              sub="Read back from the ledger, not assumed">
              {data.moves.length ? (
                <div className="tw">
                  <table>
                    <thead>
                      <tr><th>Date</th><th>Item</th><th className="rt">In</th>
                        <th>Where</th></tr>
                    </thead>
                    <tbody>
                      {data.moves.map((m) => (
                        <tr key={m.id}>
                          <td>{dmy(m.moved_on)}</td>
                          <td>{m.item_name}<small className="mono">{m.item_code}</small></td>
                          <td className="rt mono" style={{ color: 'var(--ok)' }}>+{qty(m.qty)}</td>
                          <td>{m.site_name}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <Empty title="Nothing on the shelf yet">
                  This note is drafted — confirm it to take the material in.
                </Empty>
              )}
            </Card>
          </div>

          <div>
            <Card title="The note">
              <div className="pad">
                <div style={{ marginBottom: 12 }}>
                  {data.status === 'CONFIRMED'
                    ? <Tag kind="ok">In stock</Tag> : <Tag kind="warn">Drafted</Tag>}
                </div>
                <table>
                  <tbody>
                    <tr><td style={{ color: 'var(--muted)', width: 130 }}>Date</td>
                      <td><b>{dmy(data.receipt_date)}</b></td></tr>
                    <tr><td style={{ color: 'var(--muted)' }}>Their challan</td>
                      <td className="mono">{data.supplier_dc || '—'}</td></tr>
                    <tr><td style={{ color: 'var(--muted)' }}>Taken in at</td>
                      <td>{data.site_name}</td></tr>
                    <tr><td style={{ color: 'var(--muted)' }}>Taken in by</td>
                      <td>{data.received_by_name || '—'}</td></tr>
                    <tr><td style={{ color: 'var(--muted)' }}>Lines</td>
                      <td>{data.line_count}</td></tr>
                  </tbody>
                </table>
                {data.note && (
                  <p style={{ marginTop: 12, color: 'var(--muted)', fontSize: 12.5 }}>{data.note}</p>
                )}
              </div>
            </Card>

            {data.po && (
              <Card title="Where the order stands">
                <div className="pad">
                  <Link to={`/purchase-orders/${data.po.poId}`}>
                    <b className="mono">{data.po.docNo}</b></Link>
                  <div style={{ margin: '10px 0' }}>
                    <Meter value={Number(data.po.receivedQty)} max={Number(data.po.orderedQty)} />
                    <small style={{ color: 'var(--muted)' }}>
                      {qty(data.po.receivedQty)} of {qty(data.po.orderedQty)} received
                    </small>
                  </div>
                  {Number(data.po.pendingQty) > 0 ? (
                    <p style={{ color: 'var(--bad)', fontSize: 12.5, margin: 0 }}>
                      <b>{qty(data.po.pendingQty)} still owed.</b> The order stays in the delivery
                      pipeline until it is all here.
                    </p>
                  ) : (
                    <p style={{ color: 'var(--ok)', fontSize: 12.5, margin: 0 }}>
                      Fully received.
                    </p>
                  )}
                </div>
              </Card>
            )}

            <Card title="History" sub="Appended, never edited">
              <div className="tw">
                <table>
                  <tbody>
                    {data.events.map((e, n) => (
                      <tr key={n}>
                        <td><Tag kind={/confirm|receiv/i.test(e.action) ? 'ok' : ''}>
                          {e.action}</Tag></td>
                        <td>{e.user_name || '—'}<small>{dmy(e.created_at)}</small></td>
                      </tr>
                    ))}
                    {!data.events.length && (
                      <tr><td colSpan={2} style={{ color: 'var(--faint)' }}>Nothing yet.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </Card>

            {data.siblings.length > 1 && (
              <Card title="Other notes on this order">
                <div className="tw">
                  <table>
                    <tbody>
                      {data.siblings.map((s) => (
                        <tr key={s.grn_id}
                          style={s.grn_id === data.grn_id ? { background: 'var(--brand-soft)' } : undefined}>
                          <td>{s.grn_id === data.grn_id
                            ? <b className="mono">{s.doc_no}</b>
                            : <Link to={`/grns/${s.grn_id}`} className="mono">{s.doc_no}</Link>}
                            <small>{dmy(s.receipt_date)}</small></td>
                          <td className="rt mono">{qty(s.grn_qty)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
