import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useApp, PageHead } from '../App';
import { api, qty, money, dmy, canWrite, plural } from '../api';
import { downloadCsv } from '../download';
import {
  useApi, Card, Empty, Loading, ErrorNote, Banner, Field, Modal, Meter, useToast, Code,
  Status, DocHead, NextStep,
} from '../components/ui';
import { Icon } from '../components/icons';
import { poStage, eventWord, eventTone, withWhom } from '../vocab';
import { ReceiveGrn } from './Grns';

/**
 * Purchase orders: two approvals, then the delivery.
 *
 * One column says where an order is, whether that is its approvals or
 * its delivery — which is what makes a single filter useful. A partly
 * delivered order stays open until it is fully received; there is no
 * closing one short.
 */
export const PoTag = ({ stage }) => <Status is={poStage(stage)} />;

/* =================================================================== */
export function PurchaseOrders() {
  const { branchId, branchName, setBranch } = useApp();
  const nav = useNavigate();
  const [f, setF] = useState({ q: '', stage: 'ALL', supplierId: '', sort: 'date', overdue: false });
  const qs = new URLSearchParams({
    ...(branchId ? { branchId } : {}),
    ...(f.q ? { q: f.q } : {}),
    ...(f.supplierId ? { supplierId: f.supplierId } : {}),
    ...(f.overdue ? { overdue: 'true' } : {}),
    stage: f.stage, sort: f.sort,
  }).toString();

  const { data, error, loading, reload } = useApi(`/purchase-orders?${qs}`,
    [branchId, qs]);
  const { data: suppliers } = useApi('/suppliers');
  const rows = data || [];

  const grab = () => downloadCsv('purchase-orders', [
    ['PO', 'Order date', 'Supplier', 'Delivered to', 'Expected', 'Status', 'Lines',
      'Ordered', 'Received', 'Still to receive', 'Value incl. GST', 'For PRN'],
    ...rows.map((r) => [r.doc_no, dmy(r.po_date), r.supplier_name, r.deliver_to_name,
      r.expected_date ? dmy(r.expected_date) : '', poStage(r.stage).label,
      r.line_count, r.ordered_qty, r.received_qty, r.pending_qty, r.po_value, r.indent_nos]),
  ]);

  const counts = rows.reduce((a, r) => ({ ...a, [r.stage]: (a[r.stage] || 0) + 1 }), {});
  const filtered = f.q || f.supplierId || f.overdue || f.stage !== 'ALL';

  return (
    <>
      <PageHead title="Purchase orders"
        sub="Orders to suppliers: approved twice, then followed until everything is received"
        actions={
          <>
            <button className="btn" onClick={grab} disabled={!rows.length}><Icon name="download" size={14} />Download</button>
            {canWrite('/purchase-orders') && <Link className="btn pri" to="/procurement"><Icon name="cart" />Raise from To buy</Link>}
          </>
        } />
      <div className="page-body">
        {error && <ErrorNote error={error} onRetry={reload} />}

        <Card>
          <div className="pad searchbar" style={{ marginBottom: 0 }}>
            <Field label="Search">
              <input className="inp" type="search" style={{ width: 230 }} placeholder="PO number, supplier, destination…"
                value={f.q} onChange={(e) => setF((x) => ({ ...x, q: e.target.value }))} />
            </Field>
            <Field label="Status">
              <select className="inp" style={{ width: 230 }} value={f.stage}
                onChange={(e) => setF((x) => ({ ...x, stage: e.target.value }))}>
                <option value="ALL">Everything</option>
                <option value="MINE">With Procurement (draft or sent back)</option>
                <option value="PIPELINE">Approved, not yet received in full</option>
                <option value="DRAFT">{poStage('DRAFT').label}</option>
                <option value="AWAITING_GM">{poStage('AWAITING_GM').label}</option>
                <option value="RETURNED">{poStage('RETURNED').label}</option>
                <option value="AWAITING">{poStage('AWAITING').label}</option>
                <option value="PARTIAL">{poStage('PARTIAL').label}</option>
                <option value="RECEIVED">{poStage('RECEIVED').label}</option>
                <option value="CANCELLED">{poStage('CANCELLED').label}</option>
              </select>
            </Field>
            <Field label="Supplier">
              <select className="inp" style={{ width: 200 }} value={f.supplierId}
                onChange={(e) => setF((x) => ({ ...x, supplierId: e.target.value }))}>
                <option value="">Every supplier</option>
                {(suppliers || []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </Field>
            <Field label="Sort by">
              <select className="inp" style={{ width: 180 }} value={f.sort}
                onChange={(e) => setF((x) => ({ ...x, sort: e.target.value }))}>
                <option value="date">Newest</option>
                <option value="expected">Expected soonest</option>
                <option value="supplier">Supplier</option>
                <option value="value">Value</option>
                <option value="pending">Most still to receive</option>
              </select>
            </Field>
            <label style={{ display: 'flex', gap: 7, alignItems: 'center', paddingBottom: 9, cursor: 'pointer' }}>
              <input type="checkbox" checked={f.overdue}
                onChange={(e) => setF((x) => ({ ...x, overdue: e.target.checked }))} />
              Overdue only
            </label>
          </div>
        </Card>

        {(counts.AWAITING_GM || counts.RETURNED) ? (
          <Banner kind={counts.RETURNED ? 'warn' : 'info'} icon={counts.RETURNED ? 'alert' : 'clock'}>
            {counts.AWAITING_GM ? <><b>{plural(counts.AWAITING_GM, 'order')}</b> awaiting approval. </> : null}
            {counts.RETURNED ? <><b>{plural(counts.RETURNED, 'order')}</b> sent back to Procurement to change. </> : null}
            Nothing goes to a supplier until both approvals are done.
          </Banner>
        ) : null}

        {loading && !data ? <Loading what="purchase orders" /> : (
          <Card title={plural(rows.length, 'purchase order')}>
            <div className="tw">
              <table>
                <thead>
                  <tr>
                    <th>PO</th><th>Supplier</th><th>Delivered to</th><th>Expected</th>
                    <th className="rt">Value incl. GST</th><th style={{ width: 150 }}>Received so far</th>
                    <th>Status</th><th>For PRN</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.po_id} className="click" tabIndex={0}
                      onClick={() => nav(`/purchase-orders/${r.po_id}`)}
                      onKeyDown={(e) => { if (e.key === 'Enter') nav(`/purchase-orders/${r.po_id}`); }}>
                      <td><Code as="b">{r.doc_no}</Code><small>{dmy(r.po_date)}</small></td>
                      <td>{r.supplier_name}</td>
                      <td>{r.deliver_to_name}
                        <small>{r.deliver_to_type === 'STORE' ? 'Central store' : 'Straight to site'}</small></td>
                      <td className="mono">
                        {r.expected_date ? dmy(r.expected_date) : '—'}
                        {Number(r.overdue) === 1 && <small style={{ color: 'var(--st-stop)', fontWeight: 600 }}>Overdue</small>}
                      </td>
                      <td className="rt mono">{money(r.po_value)}</td>
                      <td>
                        {r.status === 'APPROVED' ? (
                          <>
                            <Meter value={Number(r.received_qty)} max={Number(r.ordered_qty)} label="Received so far" />
                            <small className="mono">{qty(r.received_qty)} of {qty(r.ordered_qty)}</small>
                          </>
                        ) : <span style={{ color: 'var(--faint)' }}>Not with the supplier yet</span>}
                      </td>
                      <td><PoTag stage={r.stage} /></td>
                      <td>{r.indent_nos ? <Code>{r.indent_nos}</Code> : '—'}</td>
                    </tr>
                  ))}
                  {!rows.length && (
                    <tr><td colSpan={8}>
                      <Empty title={filtered ? 'No purchase order matches these filters'
                        : branchId ? `No purchase orders in ${branchName}` : 'No purchase orders yet'}
                        action={branchId && !filtered && <button className="btn" onClick={() => setBranch('ALL')}>Show all branches</button>}>
                        {filtered ? 'Clear the filters to see every order.'
                          : <>Orders are raised from <Link className="linkish" to="/procurement">To buy</Link>.</>}
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

/** Who has the order and what happens next, in words. */
function poNext(data) {
  const w = withWhom(data.approval);
  const back = [...(data.events || [])].reverse().find((e) => e.action === 'RETURNED');
  switch (data.status) {
    case 'DRAFT':
      return { tone: 'neutral', icon: 'draft', now: 'Draft — not sent for approval',
        then: 'Nothing is held for these PRNs until it is sent. It needs two approvals before it can go to the supplier.' };
    case 'SUBMITTED':
      return { tone: 'info', icon: 'clock',
        now: `With ${w?.who || 'the approvers'} for approval${w ? ` · level ${w.level} of ${w.levels}` : ''}`,
        then: w?.level === 2
          ? 'Level 1 is approved. Once Management approves, the order can go to the supplier.'
          : 'It holds the quantity so the same PRN cannot be ordered twice, but nothing goes to the supplier and nothing can be received until both approvals are done.' };
    case 'RETURNED':
      return { tone: 'attention', icon: 'alert',
        now: `Sent back${back?.user_name ? ` by ${back.user_name}` : ''}${back?.created_at ? ` on ${dmy(back.created_at)}` : ''}`,
        quote: back?.note || undefined,
        then: 'Change it and send it for approval again, or cancel it. Approval starts again at level 1.' };
    case 'APPROVED':
      return Number(data.pending_qty) > 0
        ? { tone: Number(data.overdue) === 1 ? 'attention' : 'info', icon: 'truck',
          now: Number(data.received_qty) > 0
            ? `Approved · partly received — ${qty(data.pending_qty)} still to receive`
            : `Approved · with the supplier — nothing received yet`,
          then: Number(data.overdue) === 1
            ? `Past the expected date (${dmy(data.expected_date)}). The order stays open until everything arrives.`
            : `Expected by ${data.expected_date ? dmy(data.expected_date) : 'no date given'}. It stays open until everything arrives.` }
        : { tone: 'done', icon: 'check', now: 'Received in full', then: 'Everything ordered has arrived.' };
    case 'CANCELLED':
      return { tone: 'stopped', icon: 'stop', now: 'Cancelled', then: 'Nothing can be received against it.' };
    default:
      return { tone: 'neutral', now: poStage(data.stage).label };
  }
}

/* ===================================================================
   One order, end to end: what it covers, what has arrived, who approved.
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

  if (loading && !data) return <Loading what="the purchase order" />;
  if (error) return <div className="page-body" style={{ paddingTop: 24 }}><ErrorNote error={error} onRetry={reload} /></div>;

  const level = data.approval?.level || 1;
  const decide = async () => {
    setBusy(true);
    try {
      let r;
      if (sign === 'CANCELLED') r = await api.post(`/purchase-orders/${id}/cancel`, { note });
      else r = await api.post(`/purchase-orders/${id}/decide`, { action: sign, note: note || undefined });
      toast(r?.message || (sign === 'APPROVED' ? `${data.doc_no} approved`
        : sign === 'RETURNED' ? `${data.doc_no} sent back to Procurement` : `${data.doc_no} cancelled`), 'ok');
      setSign(null); setNote(''); reload();
    } catch (e) { toast(e.message, 'bad'); }
    setBusy(false);
  };

  const submit = async () => {
    try {
      await api.post(`/purchase-orders/${id}/submit`);
      toast(`${data.doc_no} sent for approval`, 'ok');
      reload();
    } catch (e) { toast(e.message, 'bad'); }
  };

  const grab = () => downloadCsv(`po-${data.doc_no}`, [
    ['Purchase order', data.doc_no],
    ['Supplier', data.supplier_name], ['GSTIN', data.supplier_gstin || ''],
    ['Delivered to', data.deliver_to_name],
    ['Order date', dmy(data.po_date)], ['Expected', data.expected_date ? dmy(data.expected_date) : ''],
    ['For PRN', data.indents.map((i) => i.doc_no).join(', ')],
    ['Status', poStage(data.stage).label],
    [],
    ['Item code', 'Item', 'Unit', 'Ordered', 'Received', 'Still to receive', 'Rate', 'GST %', 'Amount', 'For PRN'],
    ...data.lines.map((l) => [l.item_code, l.item_name, l.uom, l.ordered_qty, l.received_qty,
      l.pending_qty, l.rate, l.gst_rate, l.total, l.against || '']),
    [], ['', '', '', '', '', '', '', 'Total', data.po_value],
  ]);

  const mayDecide = data.canApprove && canWrite(`/purchase-orders/${id}/decide`);
  const next = poNext(data);

  return (
    <>
      <DocHead kind="Purchase order"
        back={<button type="button" className="btn sm ghost" style={{ marginLeft: -8 }} onClick={() => nav('/purchase-orders')}><Icon name="arrowLeft" size={14} />Purchase orders</button>}
        docNo={<Code>{data.doc_no}</Code>}
        status={<Status is={poStage(data.stage)} lg />}
        meta={[<b>{data.supplier_name}</b>, `Delivered to ${data.deliver_to_name}`, `Ordered ${dmy(data.po_date)}`,
          <>Value <b className="mono">{money(data.po_value)}</b> incl. GST</>]}
        actions={
          <>
            <button className="btn" onClick={grab}><Icon name="download" size={14} />Download</button>
            {['DRAFT', 'RETURNED', 'SUBMITTED', 'APPROVED'].includes(data.status)
              && Number(data.received_qty) === 0 && canWrite(`/purchase-orders/${id}/cancel`) && (
              <button className="btn bad" onClick={() => setSign('CANCELLED')}>Cancel order</button>
            )}
            {data.canEdit && canWrite('/purchase-orders') && (
              <button className="btn pri" onClick={submit}><Icon name="send" />Send for approval</button>
            )}
            {mayDecide && (
              <>
                <button className="btn" onClick={() => setSign('RETURNED')}>Send back</button>
                <button className="btn pri" onClick={() => setSign('APPROVED')}><Icon name="check" />Approve PO</button>
              </>
            )}
            {data.status === 'APPROVED' && Number(data.pending_qty) > 0 && canWrite(`/purchase-orders/${id}/receipts`) && (
              <button className="btn pri" onClick={() => setReceiving(true)}>Receive delivery</button>
            )}
          </>
        } />

      <div className="page-body">
        <NextStep {...next} />

        <div className="grid2">
          <div>
            <Card title="Items ordered" sub="Ordered, received, and what is still to receive">
              <div className="tw">
                <table className="sheet">
                  <thead>
                    <tr>
                      <th style={{ width: 110 }}>Item code</th><th>Item</th><th style={{ width: 62 }}>Unit</th>
                      <th className="rt">Ordered</th><th className="rt">Received</th>
                      <th className="rt">Still to receive</th><th className="rt">Rate</th>
                      <th className="rt">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.lines.map((l) => (
                      <tr key={l.po_line_id}>
                        <td><Code>{l.item_code}</Code></td>
                        <td>{l.item_name}
                          {l.against && <small>For <Code>{l.against}</Code></small>}</td>
                        <td>{l.uom}</td>
                        <td className="rt mono">{qty(l.ordered_qty)}</td>
                        <td className="rt mono">{Number(l.received_qty) ? qty(l.received_qty) : '—'}</td>
                        <td className="rt mono"><b>{Number(l.pending_qty) ? qty(l.pending_qty) : '—'}</b></td>
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

            <Card title="Deliveries received" sub={`${plural(data.receipts.length, 'GRN')} so far`}>
              {data.receipts.length ? (
                <div className="tw">
                  <table>
                    <thead>
                      <tr><th>GRN</th><th>Received on</th><th>Supplier's challan</th><th>Received at</th>
                        <th className="rt">Units</th><th>Received by</th></tr>
                    </thead>
                    <tbody>
                      {data.receipts.map((g) => (
                        <tr key={g.id}>
                          <td><Link className="linkish" to={`/grns/${g.id}`}><Code>{g.doc_no}</Code></Link>
                            {g.status === 'DRAFT' && <small><Status tone="attention" label="Not in stock yet" /></small>}</td>
                          <td className="mono">{dmy(g.receipt_date)}</td>
                          <td>{g.supplier_dc ? <Code>{g.supplier_dc}</Code> : '—'}</td>
                          <td>{g.received_at_name}</td>
                          <td className="rt mono">{qty(g.qty)}</td>
                          <td>{g.received_by_name || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <Empty title="Nothing has been received yet">
                  {data.status === 'APPROVED'
                    ? 'The order is with the supplier.'
                    : 'The order has not gone to the supplier yet.'}
                </Empty>
              )}
            </Card>
          </div>

          <div>
            <Card title="Details">
              <div className="pad">
                {data.status === 'APPROVED' && (
                  <div style={{ marginBottom: 12 }}>
                    <Meter value={Number(data.received_qty)} max={Number(data.ordered_qty)} label="Received" />
                    <small style={{ color: 'var(--muted)' }}>
                      {qty(data.received_qty)} of {qty(data.ordered_qty)} received
                    </small>
                  </div>
                )}
                <table>
                  <tbody>
                    <tr><td style={{ color: 'var(--muted)', width: 120 }}>Supplier</td>
                      <td><b>{data.supplier_name}</b>
                        {data.supplier_gstin && <small><Code>{data.supplier_gstin}</Code></small>}</td></tr>
                    <tr><td style={{ color: 'var(--muted)' }}>Payment terms</td>
                      <td>{plural(data.terms_days, 'day')}</td></tr>
                    <tr><td style={{ color: 'var(--muted)' }}>Delivered to</td>
                      <td>{data.deliver_to_name}</td></tr>
                    <tr><td style={{ color: 'var(--muted)' }}>Expected</td>
                      <td className="mono">{data.expected_date ? dmy(data.expected_date) : '—'}</td></tr>
                    {data.decided_by_name && (
                      <tr><td style={{ color: 'var(--muted)' }}>Final approval</td>
                        <td>{data.decided_by_name}<small>{dmy(data.decided_at)}</small></td></tr>
                    )}
                    <tr><td style={{ color: 'var(--muted)' }}>Raised by</td>
                      <td>{data.created_by_name || '—'}</td></tr>
                  </tbody>
                </table>
                {data.notes && (
                  <p style={{ marginTop: 12, color: 'var(--muted)', fontSize: 13 }}>Note to supplier: {data.notes}</p>
                )}
              </div>
            </Card>

            <Card title="PRNs this order supplies">
              <div className="tw">
                <table>
                  <tbody>
                    {data.indents.map((i) => (
                      <tr key={i.id}>
                        <td><Link className="linkish" to={`/indents/${i.id}`}><Code>{i.doc_no}</Code></Link></td>
                        <td>{i.site_name}</td>
                        <td className="rt mono">{i.needed_by ? <>needed by {dmy(i.needed_by)}</> : '—'}</td>
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
                        <td><Status tone={eventTone(e.action)} label={eventWord(e.action)} /></td>
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
        <Modal title={sign === 'APPROVED' ? `Approve ${data.doc_no}?`
          : sign === 'RETURNED' ? `Send ${data.doc_no} back to Procurement?` : `Cancel ${data.doc_no}?`}
          onClose={() => { setSign(null); setNote(''); }}
          footer={<>
            <button className="btn" onClick={() => { setSign(null); setNote(''); }}>Go back</button>
            <button className={`btn ${sign === 'APPROVED' ? 'pri' : 'bad'}`}
              disabled={busy || (sign !== 'APPROVED' && !note.trim())} onClick={decide}>
              {busy ? 'Saving…' : sign === 'APPROVED' ? 'Approve PO' : sign === 'RETURNED' ? 'Send back' : 'Cancel order'}
            </button>
          </>}>
          <p className="consequence">
            {sign === 'APPROVED'
              ? (level === 1
                ? 'This is level 1 of 2. It then goes to Management for level 2; the supplier gets it after both.'
                : 'This is the final approval. The order can go to the supplier, and the store can receive against it.')
              : sign === 'RETURNED'
                ? 'It goes back to Procurement with your reason. They change it and send it again; approval starts again at level 1.'
                : 'The order is cancelled. Nothing can be received against it, and its PRNs go back on To buy.'}
          </p>
          {sign === 'APPROVED' && (
            <Banner kind="info">
              <b className="mono">{money(data.po_value)}</b> to {data.supplier_name}, delivered to {data.deliver_to_name}.
            </Banner>
          )}
          <Field label={sign === 'APPROVED' ? 'Note (optional)' : 'Reason'}
            hint={sign === 'APPROVED' ? undefined : 'Required — Procurement sees this. Be specific enough to act on.'}>
            <textarea className="inp" rows={3} value={note} onChange={(e) => setNote(e.target.value)}
              placeholder={sign === 'RETURNED'
                ? 'e.g. The rate is above the last comparison — renegotiate before sending'
                : ''} />
          </Field>
        </Modal>
      )}

      {receiving && (
        <ReceiveGrn poId={id} onClose={() => setReceiving(false)}
          onDone={() => { setReceiving(false); reload(); }} />
      )}
    </>
  );
}
