import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useApp, PageHead } from '../App';
import { api, qty, money, dmy, today } from '../api';
import { downloadCsv } from '../download';
import {
  useApi, Card, Tag, Empty, Loading, ErrorNote, Banner, Field, Modal, Stat, Meter, useToast,
} from '../components/ui';

/**
 * Purchase orders: the signature, then the delivery.
 *
 * One column says where an order is, whether that is a signature or a
 * delivery — which is what makes a single filter useful. A part
 * delivered order stays in the pipeline until it is fully received;
 * there is no closing one short.
 */
const STAGE = {
  DRAFT: { label: 'Draft', kind: '' },
  AWAITING_GM: { label: 'With the GM', kind: 'warn' },
  RETURNED: { label: 'Sent back', kind: 'bad' },
  AWAITING: { label: 'Awaiting delivery', kind: 'warn' },
  PARTIAL: { label: 'Part received', kind: 'warn' },
  RECEIVED: { label: 'Received in full', kind: 'ok' },
  CANCELLED: { label: 'Cancelled', kind: '' },
};
export const PoTag = ({ stage }) => {
  const s = STAGE[stage] || { label: stage, kind: '' };
  return <Tag kind={s.kind}>{s.label}</Tag>;
};

/* =================================================================== */
export function PurchaseOrders() {
  const { branchId } = useApp();
  const nav = useNavigate();
  const [f, setF] = useState({ q: '', stage: 'ALL', supplierId: '', sort: 'date', overdue: false });
  const qs = new URLSearchParams({
    ...(branchId ? { branchId } : {}),
    ...(f.q ? { q: f.q } : {}),
    ...(f.supplierId ? { supplierId: f.supplierId } : {}),
    ...(f.overdue ? { overdue: 'true' } : {}),
    stage: f.stage, sort: f.sort,
  }).toString();

  const { data, error, loading, reload } = useApi(branchId ? `/purchase-orders?${qs}` : null,
    [branchId, qs]);
  const { data: suppliers } = useApi('/suppliers');
  const rows = data || [];

  const grab = () => downloadCsv('purchase-orders', [
    ['PO', 'Date', 'Supplier', 'Deliver to', 'Expected', 'Stage', 'Lines',
      'Ordered', 'Received', 'Pending', 'Value', 'Against'],
    ...rows.map((r) => [r.doc_no, dmy(r.po_date), r.supplier_name, r.deliver_to_name,
      r.expected_date ? dmy(r.expected_date) : '', (STAGE[r.stage] || {}).label || r.stage,
      r.line_count, r.ordered_qty, r.received_qty, r.pending_qty, r.po_value, r.indent_nos]),
  ]);

  const counts = rows.reduce((a, r) => ({ ...a, [r.stage]: (a[r.stage] || 0) + 1 }), {});

  return (
    <>
      <PageHead title="Purchase orders" sub="Signed by the GM, then followed until everything is in"
        actions={
          <div style={{ display: 'flex', gap: 9 }}>
            <button className="btn" onClick={grab} disabled={!rows.length}>Download</button>
            <Link className="btn pri" to="/procurement">To buy</Link>
          </div>
        } />
      <div className="page-body">
        {error && <ErrorNote error={error} onRetry={reload} />}

        <Card>
          <div className="pad" style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <Field label="Search">
              <input className="inp" style={{ width: 220 }} placeholder="PO number, supplier, destination"
                value={f.q} onChange={(e) => setF((x) => ({ ...x, q: e.target.value }))} />
            </Field>
            <Field label="Where it is">
              <select className="inp" style={{ width: 200 }} value={f.stage}
                onChange={(e) => setF((x) => ({ ...x, stage: e.target.value }))}>
                <option value="ALL">Everything</option>
                <option value="MINE">With the buyer</option>
                <option value="PIPELINE">In the delivery pipeline</option>
                <option value="DRAFT">Draft</option>
                <option value="AWAITING_GM">With the GM</option>
                <option value="RETURNED">Sent back</option>
                <option value="AWAITING">Awaiting delivery</option>
                <option value="PARTIAL">Part received</option>
                <option value="RECEIVED">Received in full</option>
                <option value="CANCELLED">Cancelled</option>
              </select>
            </Field>
            <Field label="Supplier">
              <select className="inp" style={{ width: 190 }} value={f.supplierId}
                onChange={(e) => setF((x) => ({ ...x, supplierId: e.target.value }))}>
                <option value="">Every supplier</option>
                {(suppliers || []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </Field>
            <Field label="Sort by">
              <select className="inp" style={{ width: 160 }} value={f.sort}
                onChange={(e) => setF((x) => ({ ...x, sort: e.target.value }))}>
                <option value="date">Newest</option>
                <option value="expected">Expected soonest</option>
                <option value="supplier">Supplier</option>
                <option value="value">Value</option>
                <option value="pending">Most outstanding</option>
              </select>
            </Field>
            <label className="btn" style={{ marginBottom: 8, cursor: 'pointer' }}>
              <input type="checkbox" checked={f.overdue}
                onChange={(e) => setF((x) => ({ ...x, overdue: e.target.checked }))} />
              {' '}Overdue only
            </label>
          </div>
        </Card>

        {(counts.AWAITING_GM || counts.RETURNED) ? (
          <Banner kind="warn" icon="✎">
            {counts.AWAITING_GM ? <><b>{counts.AWAITING_GM}</b> waiting on the GM. </> : null}
            {counts.RETURNED ? <><b>{counts.RETURNED}</b> sent back for the buyer to fix. </> : null}
            Nothing reaches a supplier unsigned.
          </Banner>
        ) : null}

        {loading ? <Loading /> : (
          <Card title={`${rows.length} order${rows.length === 1 ? '' : 's'}`}>
            <div className="tw">
              <table>
                <thead>
                  <tr>
                    <th>PO</th><th>Supplier</th><th>Deliver to</th><th>Expected</th>
                    <th className="rt">Value</th><th style={{ width: 150 }}>Delivery</th>
                    <th>Where it is</th><th>Against</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.po_id} className="click"
                      onClick={() => nav(`/purchase-orders/${r.po_id}`)}>
                      <td><Link to={`/purchase-orders/${r.po_id}`} onClick={(e) => e.stopPropagation()}>
                        <b className="mono">{r.doc_no}</b></Link><small>{dmy(r.po_date)}</small></td>
                      <td>{r.supplier_name}</td>
                      <td>{r.deliver_to_name}
                        <small>{r.deliver_to_type === 'STORE' ? 'store' : 'site'}</small></td>
                      <td>
                        {r.expected_date ? dmy(r.expected_date) : '—'}
                        {Number(r.overdue) === 1 && <Tag kind="bad">overdue</Tag>}
                      </td>
                      <td className="rt mono">{money(r.po_value)}</td>
                      <td>
                        {r.status === 'APPROVED' ? (
                          <>
                            <Meter value={Number(r.received_qty)} max={Number(r.ordered_qty)} />
                            <small className="mono">
                              {qty(r.received_qty)} of {qty(r.ordered_qty)}
                            </small>
                          </>
                        ) : <span style={{ color: 'var(--faint)' }}>not sent yet</span>}
                      </td>
                      <td><PoTag stage={r.stage} /></td>
                      <td><small className="mono">{r.indent_nos || '—'}</small></td>
                    </tr>
                  ))}
                  {!rows.length && (
                    <tr><td colSpan={8}>
                      <Empty title="No orders match">
                        Clear the filters, or raise one from <Link to="/procurement">To buy</Link>.
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
   One order, end to end: what it covers, what has arrived, who signed.
   =================================================================== */
export function PurchaseOrderDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const toast = useToast();
  const { data, error, loading, reload } = useApi(`/purchase-orders/${id}`, [id]);
  const [sign, setSign] = useState(null);       // 'APPROVED' | 'RETURNED' | 'CANCELLED'
  const [note, setNote] = useState('');
  const [receiving, setReceiving] = useState(false);
  const [busy, setBusy] = useState(false);

  if (loading) return <Loading />;
  if (error) return <div className="page-body"><ErrorNote error={error} onRetry={reload} /></div>;

  const decide = async () => {
    setBusy(true);
    try {
      if (sign === 'CANCELLED') await api.post(`/purchase-orders/${id}/cancel`, { note });
      else await api.post(`/purchase-orders/${id}/decide`, { action: sign, note: note || undefined });
      toast(sign === 'APPROVED' ? 'Signed — it can go to the supplier'
        : sign === 'RETURNED' ? 'Sent back to the buyer' : 'Cancelled', 'ok');
      setSign(null); setNote(''); reload();
    } catch (e) { toast(e.message, 'bad'); }
    setBusy(false);
  };

  const submit = async () => {
    try {
      await api.post(`/purchase-orders/${id}/submit`);
      toast('Sent to the GM', 'ok');
      reload();
    } catch (e) { toast(e.message, 'bad'); }
  };

  const grab = () => downloadCsv(`po-${data.doc_no}`, [
    ['Purchase order', data.doc_no],
    ['Supplier', data.supplier_name], ['GSTIN', data.supplier_gstin || ''],
    ['Deliver to', data.deliver_to_name],
    ['Order date', dmy(data.po_date)], ['Expected', data.expected_date ? dmy(data.expected_date) : ''],
    ['Against', data.indents.map((i) => i.doc_no).join(', ')],
    ['Where it is', (STAGE[data.stage] || {}).label || data.stage],
    [],
    ['Item code', 'Item', 'Unit', 'Ordered', 'Received', 'Pending', 'Rate', 'GST %', 'Amount', 'Against'],
    ...data.lines.map((l) => [l.item_code, l.item_name, l.uom, l.ordered_qty, l.received_qty,
      l.pending_qty, l.rate, l.gst_rate, l.total, l.against || '']),
    [], ['', '', '', '', '', '', '', 'Total', data.po_value],
  ]);

  return (
    <>
      <PageHead title={data.doc_no}
        sub={`${data.supplier_name} · to ${data.deliver_to_name} · ${dmy(data.po_date)}`}
        actions={
          <div style={{ display: 'flex', gap: 9, flexWrap: 'wrap' }}>
            <button className="btn" onClick={() => nav('/purchase-orders')}>Back</button>
            <button className="btn" onClick={grab}>Download</button>
            {data.canEdit && <button className="btn pri" onClick={submit}>Send to the GM</button>}
            {data.canSign && (
              <>
                <button className="btn bad" onClick={() => setSign('RETURNED')}>Send back</button>
                <button className="btn pri" onClick={() => setSign('APPROVED')}>Sign it</button>
              </>
            )}
            {data.status === 'APPROVED' && Number(data.pending_qty) > 0 && (
              <button className="btn pri" onClick={() => setReceiving(true)}>Receive</button>
            )}
            {['DRAFT', 'RETURNED', 'SUBMITTED', 'APPROVED'].includes(data.status)
              && Number(data.received_qty) === 0 && (
              <button className="btn bad" onClick={() => setSign('CANCELLED')}>Cancel</button>
            )}
          </div>
        } />

      <div className="page-body">
        {data.status === 'RETURNED' && (
          <Banner kind="bad" icon="↩">
            <b>Sent back by the GM.</b>{' '}
            {(data.events.filter((e) => e.action === 'RETURNED').slice(-1)[0] || {}).note}
            {' '}Fix it and send it again, or cancel it.
          </Banner>
        )}
        {data.status === 'SUBMITTED' && (
          <Banner kind="warn" icon="✎">
            <b>Waiting for the GM.</b> It holds the quantity so the same requirement cannot be
            ordered twice, but nothing goes to the supplier and nothing can be received until it is signed.
          </Banner>
        )}
        {Number(data.overdue) === 1 && (
          <Banner kind="bad" icon="!">
            <b>Past the expected date</b> with {qty(data.pending_qty)} still to come.
          </Banner>
        )}

        <div className="grid2">
          <div>
            <Card title="Lines" sub="Ordered, what has arrived, and what is still owed">
              <div className="tw">
                <table className="sheet">
                  <thead>
                    <tr>
                      <th style={{ width: 100 }}>Code</th><th>Item</th><th style={{ width: 62 }}>Unit</th>
                      <th className="rt">Ordered</th><th className="rt">Received</th>
                      <th className="rt">Pending</th><th className="rt">Rate</th>
                      <th className="rt">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.lines.map((l) => (
                      <tr key={l.po_line_id}>
                        <td className="mono" style={{ color: 'var(--brand-ink)' }}>{l.item_code}</td>
                        <td>{l.item_name}
                          {l.against && <small>for {l.against}</small>}</td>
                        <td>{l.uom}</td>
                        <td className="rt mono">{qty(l.ordered_qty)}</td>
                        <td className="rt mono">{Number(l.received_qty) ? qty(l.received_qty) : '—'}</td>
                        <td className="rt mono"
                          style={{ color: Number(l.pending_qty) > 0 ? 'var(--bad)' : 'var(--ok)' }}>
                          <b>{Number(l.pending_qty) ? qty(l.pending_qty) : 'nil'}</b>
                        </td>
                        <td className="rt mono">{money(l.rate)}<small>{l.gst_rate}% GST</small></td>
                        <td className="rt mono">{money(l.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <th colSpan={7} className="rt">Order value incl. GST</th>
                      <th className="rt mono">{money(data.po_value)}</th>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </Card>

            <Card title="Deliveries" sub={`${data.receipts.length} so far`}>
              {data.receipts.length ? (
                <div className="tw">
                  <table>
                    <thead>
                      <tr><th>Receipt</th><th>Date</th><th>Their DC</th><th>At</th>
                        <th className="rt">Qty</th><th>By</th></tr>
                    </thead>
                    <tbody>
                      {data.receipts.map((g) => (
                        <tr key={g.id}>
                          <td><b className="mono">{g.doc_no}</b>
                            {g.status === 'DRAFT' && <Tag kind="warn">draft</Tag>}</td>
                          <td>{dmy(g.receipt_date)}</td>
                          <td className="mono">{g.supplier_dc || '—'}</td>
                          <td>{g.received_at_name}</td>
                          <td className="rt mono">{qty(g.qty)}</td>
                          <td>{g.received_by_name || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <Empty title="Nothing has arrived yet">
                  {data.status === 'APPROVED'
                    ? 'It is with the supplier.'
                    : 'It has not been sent to the supplier yet.'}
                </Empty>
              )}
            </Card>
          </div>

          <div>
            <Card title="Where it is">
              <div className="pad">
                <div style={{ marginBottom: 12 }}><PoTag stage={data.stage} /></div>
                {data.status === 'APPROVED' && (
                  <>
                    <Meter value={Number(data.received_qty)} max={Number(data.ordered_qty)} />
                    <small style={{ color: 'var(--muted)' }}>
                      {qty(data.received_qty)} of {qty(data.ordered_qty)} received
                    </small>
                  </>
                )}
                <table style={{ marginTop: 12 }}>
                  <tbody>
                    <tr><td style={{ color: 'var(--muted)' }}>Supplier</td>
                      <td><b>{data.supplier_name}</b>
                        {data.supplier_gstin && <small className="mono">{data.supplier_gstin}</small>}</td></tr>
                    <tr><td style={{ color: 'var(--muted)' }}>Terms</td>
                      <td>{data.terms_days} days</td></tr>
                    <tr><td style={{ color: 'var(--muted)' }}>Deliver to</td>
                      <td>{data.deliver_to_name}</td></tr>
                    <tr><td style={{ color: 'var(--muted)' }}>Expected</td>
                      <td>{data.expected_date ? dmy(data.expected_date) : '—'}</td></tr>
                    {data.decided_by_name && (
                      <tr><td style={{ color: 'var(--muted)' }}>Signed by</td>
                        <td>{data.decided_by_name}<small>{dmy(data.decided_at)}</small></td></tr>
                    )}
                    <tr><td style={{ color: 'var(--muted)' }}>Raised by</td>
                      <td>{data.created_by_name || '—'}</td></tr>
                  </tbody>
                </table>
                {data.notes && (
                  <p style={{ marginTop: 12, color: 'var(--muted)', fontSize: 12.5 }}>{data.notes}</p>
                )}
              </div>
            </Card>

            <Card title="What it is filling">
              <div className="tw">
                <table>
                  <tbody>
                    {data.indents.map((i) => (
                      <tr key={i.id}>
                        <td><Link to={`/indents/${i.id}`}><b className="mono">{i.doc_no}</b></Link></td>
                        <td>{i.site_name}</td>
                        <td className="rt">{i.needed_by ? dmy(i.needed_by) : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>

            <Card title="History">
              <div className="tw">
                <table>
                  <tbody>
                    {data.events.map((e, n) => (
                      <tr key={n}>
                        <td><Tag kind={e.action === 'APPROVED' ? 'ok'
                          : e.action === 'RETURNED' || e.action === 'CANCELLED' ? 'bad' : ''}>
                          {e.action}</Tag></td>
                        <td>{e.user_name || '—'}<small>{dmy(e.created_at)}</small></td>
                        <td>{e.note || ''}</td>
                      </tr>
                    ))}
                    {!data.events.length && (
                      <tr><td colSpan={3} style={{ color: 'var(--faint)' }}>Nothing yet.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </Card>
          </div>
        </div>
      </div>

      {sign && (
        <Modal title={sign === 'APPROVED' ? `Sign ${data.doc_no}`
          : sign === 'RETURNED' ? `Send ${data.doc_no} back` : `Cancel ${data.doc_no}`}
          sub={sign === 'APPROVED' ? 'It goes to the supplier once signed' : undefined}
          onClose={() => { setSign(null); setNote(''); }}
          footer={<>
            <button className="btn" onClick={() => { setSign(null); setNote(''); }}>Cancel</button>
            <button className={`btn ${sign === 'APPROVED' ? 'pri' : 'bad'}`} disabled={busy}
              onClick={decide}>
              {sign === 'APPROVED' ? 'Sign it' : sign === 'RETURNED' ? 'Send it back' : 'Cancel the order'}
            </button>
          </>}>
          {sign === 'APPROVED' && (
            <Banner kind="info" icon="₹">
              {money(data.po_value)} to {data.supplier_name}, delivered to {data.deliver_to_name}.
            </Banner>
          )}
          <Field label={sign === 'APPROVED' ? 'Note (optional)' : 'Why'}
            hint={sign === 'APPROVED' ? undefined : 'The buyer sees this. Be specific enough to act on.'}>
            <textarea className="inp" rows={3} value={note} onChange={(e) => setNote(e.target.value)}
              placeholder={sign === 'RETURNED'
                ? 'e.g. rate is above the last comparison, renegotiate before sending'
                : ''} />
          </Field>
        </Modal>
      )}

      {receiving && (
        <ReceiveModal poId={id} onClose={() => setReceiving(false)}
          onDone={() => { setReceiving(false); reload(); }} />
      )}
    </>
  );
}

/* =================================================================== */
function ReceiveModal({ poId, onClose, onDone }) {
  const toast = useToast();
  const { data, loading } = useApi(`/purchase-orders/${poId}/pending`, [poId]);
  const [got, setGot] = useState({});
  const [head, setHead] = useState({ receiptDate: today(), supplierDc: '', note: '' });
  const [busy, setBusy] = useState(false);

  const lines = (data?.lines || []).filter((l) => Number(got[l.po_line_id]) > 0);

  const save = async () => {
    if (!lines.length) return toast('Enter what actually arrived', 'bad');
    setBusy(true);
    try {
      const r = await api.post(`/purchase-orders/${poId}/receipts`, {
        receiptDate: head.receiptDate,
        supplierDc: head.supplierDc || undefined,
        note: head.note || undefined,
        lines: lines.map((l) => ({ poLineId: l.po_line_id, qty: Number(got[l.po_line_id]) })),
      });
      toast(r.poState === 'RECEIVED'
        ? `${r.docNo} — the order is now complete`
        : `${r.docNo} — ${qty(r.pendingQty)} still to come`, 'ok');
      onDone();
    } catch (e) { toast(e.message, 'bad'); }
    setBusy(false);
    return undefined;
  };

  if (loading) return <Modal wide title="Receive" onClose={onClose}><Loading /></Modal>;

  return (
    <Modal wide title={`Receive against ${data.docNo}`}
      sub={`${data.supplier} · at ${data.receivedAtName}`}
      onClose={onClose}
      footer={<>
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn" onClick={() => setGot(Object.fromEntries(
          data.lines.map((l) => [l.po_line_id, String(l.pending_qty)])))}>Everything arrived</button>
        <button className="btn pri" disabled={busy} onClick={save}>Confirm receipt</button>
      </>}>
      <Banner kind="info" icon="↓">
        Enter what actually came off the lorry. Anything short stays on the order and it remains in
        the delivery pipeline until it is complete.
      </Banner>
      <div className="row2">
        <Field label="Received on">
          <input className="inp" type="date" value={head.receiptDate}
            onChange={(e) => setHead((h) => ({ ...h, receiptDate: e.target.value }))} />
        </Field>
        <Field label="Their challan / invoice no.">
          <input className="inp" value={head.supplierDc}
            onChange={(e) => setHead((h) => ({ ...h, supplierDc: e.target.value }))} />
        </Field>
      </div>
      <div className="tw">
        <table className="sheet">
          <thead>
            <tr>
              <th style={{ width: 100 }}>Code</th><th>Item</th><th style={{ width: 62 }}>Unit</th>
              <th className="rt" style={{ width: 90 }}>Ordered</th>
              <th className="rt" style={{ width: 90 }}>Still owed</th>
              <th className="rt" style={{ width: 100 }}>Arrived</th>
            </tr>
          </thead>
          <tbody>
            {data.lines.map((l) => (
              <tr key={l.po_line_id}
                style={Number(got[l.po_line_id]) > 0 ? { background: 'var(--brand-soft)' } : undefined}>
                <td className="mono" style={{ color: 'var(--brand-ink)' }}>{l.item_code}</td>
                <td>{l.item_name}</td>
                <td>{l.uom}</td>
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
