import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useApp, PageHead } from '../App';
import { api, qty, units, dmy, today, withBranch, canWrite, plural } from '../api';
import { downloadCsv, printDoc } from '../download';
import {
  useApi, Card, Empty, Loading, ErrorNote, Banner, Field, Modal, Stat, Meter, useToast, Code, Status,
  DateField, DocHead, NextStep,
} from '../components/ui';
import { Icon } from '../components/icons';

/**
 * Goods receipt notes.
 *
 * A GRN is not a form somebody fills in afterwards. It is what
 * receiving a delivery produces: you say what came off the lorry, the
 * stock goes in, and the GRN exists. So this screen is two halves — the
 * purchase orders still to receive, and the GRNs already created — and
 * the only action on it is receiving.
 */

/* ===================================================================
   Receiving against a purchase order. This is what writes the GRN.
   =================================================================== */
/**
 * The GRN as a receipt: what came off this lorry, signed for by the
 * store and by whoever delivered it. The driver takes a copy away as
 * proof of what was handed over. Ordered and still-owed stay off it —
 * the note claims only what arrived.
 */
export function printGrn(g) {
  printDoc({
    title: 'Goods Receipt Note',
    docNo: g.doc_no,
    sub: `Received at ${g.site_name}`,
    meta: [
      ['Received on', dmy(g.receipt_date)],
      ['Supplier', g.supplier_name],
      ["Supplier's challan / invoice", g.supplier_dc || '—'],
      ['Against PO', g.po_no],
      ['Received by', g.received_by_name || '—'],
      g.note ? ['Remark', g.note] : null,
    ],
    columns: [
      { label: 'Item code' }, { label: 'Item' }, { label: 'Unit' },
      { label: 'Received', rt: true },
    ],
    rows: g.lines.map((l) => [l.item_code, l.item_name, l.uom, qty(l.qty)]),
    totals: ['', '', 'Total', qty(g.grn_qty)],
    note: 'Received the goods listed above from the supplier\'s vehicle, in the quantities shown, '
      + 'subject to inspection. One copy for the store, one for the driver.',
    signs: ['Received by (store)', 'Delivered by (driver / supplier)'],
    footer: g.status === 'CONFIRMED'
      ? 'This material is in stock.'
      : 'DRAFT — this material is not in stock yet.',
  });
}

export function ReceiveGrn({ poId, at, atSiteId, onClose, onDone }) {
  const toast = useToast();
  const { data, loading } = useApi(`/purchase-orders/${poId}/pending`, [poId]);
  const [got, setGot] = useState({});
  const [head, setHead] = useState({ receiptDate: today(), supplierDc: '', note: '' });
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);     // the GRN just created

  const lines = (data?.lines || []).filter((l) => Number(got[l.po_line_id]) > 0);

  const printForDriver = async () => {
    try { printGrn(await api.get(`/grns/${done.id}`)); } catch (e) { toast(e.message, 'bad'); }
  };
  const total = lines.reduce((t, l) => t + Number(got[l.po_line_id]), 0);

  const save = async () => {
    if (!lines.length) return toast('Type what actually came off the lorry', 'bad');
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
        ? `${r.docNo} created — the purchase order is received in full`
        : `${r.docNo} created — ${qty(r.pendingQty)} still to receive on this order`, 'ok');
      // stay open: the driver is standing there waiting for his copy
      setDone(r);
    } catch (e) { toast(e.message, 'bad'); }
    setBusy(false);
    return undefined;
  };

  if (loading) return <Modal wide title="Receive from supplier" onClose={onClose}><Loading what="the purchase order" /></Modal>;

  if (done) {
    return (
      <Modal title={`${done.docNo} created`} onClose={() => onDone(done)}
        footer={<>
          <button className="btn" onClick={() => onDone(done)}>Done</button>
          <button className="btn pri" onClick={printForDriver}><Icon name="print" size={14} />Print receipt for the driver</button>
        </>}>
        <Banner kind="ok">
          {qty(total)} received against {data.docNo} and recorded on <b>{done.docNo}</b>.{' '}
          {done.poState === 'RECEIVED'
            ? 'The purchase order is now received in full.'
            : `${qty(done.pendingQty)} is still to come on this order — the next delivery gets its own GRN.`}
        </Banner>
        <p style={{ margin: 0, color: 'var(--muted)' }}>
          Print the receipt and sign it with the driver: one copy stays with the store, one goes with him
          as proof of what was handed over.
        </p>
      </Modal>
    );
  }

  return (
    <Modal wide title={`Receive against ${data.docNo}`}
      sub={`${data.supplier} · into ${at || data.receivedAtName}`}
      onClose={onClose}
      footer={<>
        <button className="btn" onClick={onClose}>Cancel</button>
        <span className="sp" />
        <button className="btn" onClick={() => setGot(Object.fromEntries(
          data.lines.map((l) => [l.po_line_id, String(l.pending_qty)])))}>Fill in: everything arrived</button>
        <button className="btn pri" disabled={busy || !lines.length} onClick={save}>
          {busy ? 'Saving…' : total > 0 ? `Receive ${units(total)}` : 'Receive'}
        </button>
      </>}>
      <Banner kind="info">
        What you receive goes into stock at <b>{at || data.receivedAtName}</b> at the rate this
        purchase order agreed, and a GRN is created for it. Anything short keeps the order open
        until it arrives.
      </Banner>
      <div className="row2">
        <DateField label="Received on" value={head.receiptDate} max={today()}
          onChange={(e) => setHead((h) => ({ ...h, receiptDate: e.target.value }))} />
        <Field label="Supplier's challan or invoice number" hint="As printed on the supplier's own paper">
          <input className="inp code" spellCheck={false} autoComplete="off" value={head.supplierDc}
            onChange={(e) => setHead((h) => ({ ...h, supplierDc: e.target.value }))} />
        </Field>
      </div>
      <div className="tw">
        <table className="sheet">
          <thead>
            <tr>
              <th style={{ width: 110 }}>Item code</th><th>Item</th><th style={{ width: 60 }}>Unit</th>
              <th className="rt" style={{ width: 88 }}>Ordered</th>
              <th className="rt" style={{ width: 110 }}>Still to receive</th>
              <th className="rt" style={{ width: 110 }}>Arrived now</th>
            </tr>
          </thead>
          <tbody>
            {data.lines.map((l) => (
              <tr key={l.po_line_id}
                style={Number(got[l.po_line_id]) > 0 ? { background: 'var(--brand-soft)' } : undefined}>
                <td><Code>{l.item_code}</Code></td>
                <td>{l.item_name}</td><td>{l.uom}</td>
                <td className="rt mono">{qty(l.ordered_qty)}</td>
                <td className="rt mono"><b>{qty(l.pending_qty)}</b></td>
                <td><input className="inp rt" type="number" min="0" step="any" placeholder="0" inputMode="decimal"
                  aria-label={`Quantity of ${l.item_name} that arrived`}
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
   Receive from supplier: purchase orders still to receive, and the GRNs created.
   =================================================================== */
export function Grns() {
  const { branchId, storeId } = useApp();
  const [tab, setTab] = useState('pending');
  const [receiving, setReceiving] = useState(null);
  const { data, error, loading, reload } = useApi(
    branchId && storeId ? `/grns/desk?branchId=${branchId}&storeId=${storeId}` : null,
    [branchId, storeId]);

  if (error) {
    return <div className="page-body" style={{ paddingTop: 24 }}><ErrorNote error={error} onRetry={reload} /></div>;
  }
  if (loading || !data) return <Loading what="deliveries" />;

  const { place, pending, history, totals } = data;

  return (
    <>
      <PageHead title="Receive from supplier"
        sub={`Supplier deliveries to ${place.name}. Receiving one creates its GRN and puts the material into stock.`}
        actions={<Link className="btn" to="/grns/register">GRN register</Link>} />
      <div className="page-body">
        <Card className="pad">
          <div className="stats">
            <Stat n={totals.orders} label="purchase orders still to receive" one="purchase order still to receive" />
            <Stat n={qty(totals.pendingQty)} label="units still to receive" one="unit still to receive" />
            <Stat n={totals.overdue} label="past their expected date" one="past its expected date"
              tone={totals.overdue ? 'bad' : undefined} />
            <Stat n={totals.notes} label="GRNs created" one="GRN created" />
          </div>
        </Card>

        <p style={{ color: 'var(--muted)', fontSize: 13, margin: '12px 0 14px' }}>
          Only purchase orders delivered to <b>{place.name}</b> appear here — a delivery is received
          where it was sent. One delivered straight to a site is received at that site.
        </p>

        <div className="seg" role="group" aria-label="Show" style={{ marginBottom: 14 }}>
          <button type="button" aria-pressed={tab === 'pending'} className={tab === 'pending' ? 'on' : ''}
            onClick={() => setTab('pending')}>
            Still to receive{pending.length > 0 ? ` · ${pending.length}` : ''}
          </button>
          <button type="button" aria-pressed={tab === 'history'} className={tab === 'history' ? 'on' : ''}
            onClick={() => setTab('history')}>
            GRNs created{history.length > 0 ? ` · ${history.length}` : ''}
          </button>
        </div>

        {tab === 'pending' ? (
          <Card title="Purchase orders still to receive"
            sub="Approved orders on their way to this store">
            <div className="tw">
              <table>
                <thead>
                  <tr>
                    <th>PO</th><th>Supplier</th><th>For PRN</th><th>Expected</th>
                    <th className="rt">Ordered</th><th style={{ width: 150 }}>Received so far</th>
                    <th className="rt">Still to receive</th><th style={{ width: 110 }} />
                  </tr>
                </thead>
                <tbody>
                  {pending.map((p) => (
                    <tr key={p.po_id}>
                      <td><Link className="linkish" to={`/purchase-orders/${p.po_id}`}>
                        <Code>{p.doc_no}</Code></Link>
                        <small>{dmy(p.po_date)}</small></td>
                      <td>{p.supplier_name}</td>
                      <td>{p.prns ? <Code>{p.prns}</Code> : '—'}</td>
                      <td className="mono">
                        {p.expected_date ? dmy(p.expected_date) : '—'}
                        {Number(p.overdue) > 0 && <small style={{ color: 'var(--st-stop)', fontWeight: 600 }}>
                          {plural(p.overdue, 'day')} late</small>}
                      </td>
                      <td className="rt mono">{qty(p.ordered_qty)}</td>
                      <td>
                        <Meter value={Number(p.received_qty)} max={Number(p.ordered_qty)} label="Received so far" />
                        <small className="mono">
                          {qty(p.received_qty)} of {qty(p.ordered_qty)}
                          {Number(p.grn_count) > 0 && ` · ${plural(p.grn_count, 'GRN')}`}
                        </small>
                      </td>
                      <td className="rt mono"><b>{qty(p.pending_qty)}</b></td>
                      <td className="rt">
                        <button className="btn sm pri" onClick={() => setReceiving(p)}>
                          Receive
                        </button>
                      </td>
                    </tr>
                  ))}
                  {!pending.length && (
                    <tr><td colSpan={8}>
                      <Empty icon="check" title="Nothing is on its way here">
                        Every approved purchase order for this store has been received in full.
                      </Empty>
                    </td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        ) : (
          <Card title="GRNs created here"
            sub="The last 50"
            actions={<Link className="btn sm" to="/grns/register">GRN register</Link>}>
            <div className="tw">
              <table>
                <thead>
                  <tr>
                    <th>GRN</th><th>PO</th><th>Supplier</th><th>Supplier's challan</th>
                    <th className="rt">Units</th>
                    <th>Received by</th><th />
                  </tr>
                </thead>
                <tbody>
                  {history.map((g) => (
                    <tr key={g.grn_id}>
                      <td><Link className="linkish" to={`/grns/${g.grn_id}`}><Code>{g.doc_no}</Code></Link>
                        <small>{dmy(g.receipt_date)}</small></td>
                      <td><Link to={`/purchase-orders/${g.po_id}`} className="linkish"><Code>{g.po_no}</Code></Link></td>
                      <td>{g.supplier_name}</td>
                      <td>{g.supplier_dc ? <Code>{g.supplier_dc}</Code> : '—'}</td>
                      <td className="rt mono">{qty(g.grn_qty)}</td>
                      <td>{g.received_by_name || '—'}</td>
                      <td>
                        {g.status === 'DRAFT' ? <Status tone="attention" label="Not in stock yet" /> : null}
                        {Number(g.days_late) > 0 && <Status tone="neutral" icon="clock" label={`${plural(g.days_late, 'day')} late`} />}
                      </td>
                    </tr>
                  ))}
                  {!history.length && (
                    <tr><td colSpan={8}>
                      <Empty title="No GRN has been created here yet">
                        Receive a delivery and its GRN appears here.
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
    ['GRN', 'Received on', 'PO', 'Supplier', "Supplier's challan", 'Received at', 'Lines', 'Units',
      'Days late', 'Status'],
    ...rows.map((r) => [r.doc_no, dmy(r.receipt_date), r.po_no, r.supplier_name,
      r.supplier_dc || '', r.site_name, r.line_count, r.grn_qty, r.days_late, r.status]),
  ]);

  return (
    <>
      <PageHead title="GRN register" sub="Every goods receipt note, wherever the delivery was received"
        actions={
          <>
            <Link className="btn" to="/grns">Receive from supplier</Link>
            <button className="btn" onClick={grab} disabled={!rows.length}><Icon name="download" size={14} />Download</button>
          </>
        } />
      <div className="page-body">
        {error && <ErrorNote error={error} onRetry={reload} />}

        <Card>
          <div className="pad" style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <Field label="Search" hint="GRN, PO, supplier's challan, supplier">
              <input className="inp" type="search" style={{ width: 230 }} value={f.q}
                onChange={(e) => setF((x) => ({ ...x, q: e.target.value }))} />
            </Field>
            <Field label="Received at">
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
                <option value="DRAFT">Not in stock yet</option>
              </select>
            </Field>
            <Field label="Sort by">
              <select className="inp" style={{ width: 160 }} value={f.sort}
                onChange={(e) => setF((x) => ({ ...x, sort: e.target.value }))}>
                <option value="date">Newest</option>
                <option value="oldest">Oldest</option>
                <option value="value">Largest value</option>
                <option value="late">Most days late</option>
                <option value="supplier">Supplier</option>
              </select>
            </Field>
          </div>
        </Card>

        {data && (
          <div className="stats" style={{ margin: '16px 0' }}>
            <Stat n={data.totals.notes} label="GRNs" one="GRN" />
            <Stat n={qty(data.totals.qty)} label="units received" one="unit received" />
            <Stat n={data.totals.late} label="arrived late"
              tone={data.totals.late ? 'bad' : undefined} />
          </div>
        )}

        {loading && !data ? <Loading what="GRNs" /> : (
          <Card title={plural(rows.length, 'GRN')}>
            <div className="tw">
              <table>
                <thead>
                  <tr>
                    <th>GRN</th><th>PO</th><th>Supplier</th><th>Supplier's challan</th>
                    <th>Received at</th><th className="rt">Lines</th><th className="rt">Units</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.grn_id}>
                      <td><Link className="linkish" to={`/grns/${r.grn_id}`}><Code>{r.doc_no}</Code></Link>
                        <small>{dmy(r.receipt_date)}</small></td>
                      <td><Link to={`/purchase-orders/${r.po_id}`} className="linkish"><Code>{r.po_no}</Code></Link></td>
                      <td>{r.supplier_name}</td>
                      <td>{r.supplier_dc ? <Code>{r.supplier_dc}</Code> : '—'}</td>
                      <td>{r.site_name}<small>{r.site_type === 'STORE' ? 'Central store' : 'Straight to site'}</small></td>
                      <td className="rt mono">{r.line_count}</td>
                      <td className="rt mono">{qty(r.grn_qty)}</td>
                      <td>
                        {r.status === 'DRAFT' && <Status tone="attention" label="Not in stock yet" />}
                        {Number(r.days_late) > 0 && <Status tone="neutral" icon="clock" label={`${plural(r.days_late, 'day')} late`} />}
                      </td>
                    </tr>
                  ))}
                  {!rows.length && (
                    <tr><td colSpan={8}><Empty title="No GRN matches these filters">Clear the filters or widen the dates.</Empty></td></tr>
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
   One GRN, read end to end.
   =================================================================== */
export function GrnDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const toast = useToast();
  const { data, error, loading, reload } = useApi(`/grns/${id}`, [id]);

  if (loading && !data) return <Loading what="the GRN" />;
  if (error) return <div className="page-body" style={{ paddingTop: 24 }}><ErrorNote error={error} onRetry={reload} /></div>;

  const confirm = async () => {
    try {
      const r = await api.post(`/grns/${id}/confirm`);
      toast(`${units(r.qty)} put into stock`, 'ok');
      reload();
    } catch (e) { toast(e.message, 'bad'); }
  };

  // The note is a record of what arrived. Ordered, still owed and the
  // rest belong to the order; putting them on the note invites somebody
  // to read a number off it that the note is not making a claim about.
  const slip = () => printGrn(data);

  const grab = () => downloadCsv(`grn-${data.doc_no}`, [
    ['Goods receipt note', data.doc_no],
    ['Received on', dmy(data.receipt_date)],
    ['Against PO', data.po_no], ['Supplier', data.supplier_name],
    ["Supplier's challan", data.supplier_dc || ''],
    ['Received at', data.site_name], ['Received by', data.received_by_name || ''],
    ['Status', data.status === 'CONFIRMED' ? 'In stock' : 'Not in stock yet'], [],
    ['Item code', 'Item', 'Unit', 'Ordered', 'This GRN', 'Received in all', 'Still to receive', 'For PRN'],
    ...data.lines.map((l) => [l.item_code, l.item_name, l.uom, l.ordered_qty, l.qty,
      l.received_qty, l.pending_qty, l.against || '']),
    [], ['', '', '', '', data.grn_qty],
  ]);

  return (
    <>
      <DocHead kind="GRN · goods receipt note"
        back={<button type="button" className="btn sm ghost" style={{ marginLeft: -8 }} onClick={() => nav(-1)}><Icon name="arrowLeft" size={14} />Back</button>}
        docNo={<Code>{data.doc_no}</Code>}
        status={data.status === 'CONFIRMED'
          ? <Status tone="done" label="In stock" lg />
          : <Status tone="attention" label="Not in stock yet" lg />}
        meta={[<>Against <Code>{data.po_no}</Code></>, <b>{data.supplier_name}</b>,
          `Received at ${data.site_name} on ${dmy(data.receipt_date)}`]}
        actions={
          <>
            <button className="btn" onClick={grab}><Icon name="download" size={14} />Download</button>
            <button className="btn" onClick={slip}><Icon name="print" size={14} />Print GRN</button>
            {data.canConfirm && canWrite('/grns') && <button className="btn pri" onClick={confirm}>Put into stock</button>}
          </>
        } />
      <div className="page-body">
        {data.status === 'DRAFT' && (
          <NextStep tone="attention" now="Not in stock yet"
            then="This GRN is a draft. Nothing is in stock, and the purchase order does not count it received, until it is put into stock." />
        )}
        {Number(data.days_late) > 0 && (
          <Banner kind="warn" icon="clock">
            Arrived <b>{plural(data.days_late, 'day')}</b> after the date the purchase order
            asked for ({dmy(data.expected_date)}).
          </Banner>
        )}

        <div className="grid2">
          <div>
            <Card title="Items received"
              sub="Each line against what the purchase order asked for, and what is still to receive">
              <div className="tw">
                <table className="sheet">
                  <thead>
                    <tr>
                      <th style={{ width: 110 }}>Item code</th><th>Item</th><th style={{ width: 56 }}>Unit</th>
                      <th className="rt">Ordered</th><th className="rt">This GRN</th>
                      <th className="rt">Still to receive</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.lines.map((l) => (
                      <tr key={l.grn_line_id}>
                        <td><Code>{l.item_code}</Code></td>
                        <td>{l.item_name}
                          {l.against && <small>For <Code>{l.against}</Code></small>}</td>
                        <td>{l.uom}</td>
                        <td className="rt mono">{qty(l.ordered_qty)}</td>
                        <td className="rt mono"><b>{qty(l.qty)}</b></td>
                        <td className="rt mono">
                          {Number(l.pending_qty) > 0 ? qty(l.pending_qty) : '—'}
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

            <Card title="Stock this GRN added"
              sub="Read back from the stock ledger, not assumed">
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
                          <td className="mono">{dmy(m.moved_on)}</td>
                          <td>{m.item_name}<small><Code>{m.item_code}</Code></small></td>
                          <td className="rt mono">+{qty(m.qty)}</td>
                          <td>{m.site_name}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <Empty title="Nothing is in stock from this GRN yet">
                  It is a draft — put it into stock to add the material.
                </Empty>
              )}
            </Card>
          </div>

          <div>
            <Card title="Details">
              <div className="pad">
                <table>
                  <tbody>
                    <tr><td style={{ color: 'var(--muted)', width: 150 }}>Received on</td>
                      <td><b>{dmy(data.receipt_date)}</b></td></tr>
                    <tr><td style={{ color: 'var(--muted)' }}>Supplier's challan</td>
                      <td>{data.supplier_dc ? <Code>{data.supplier_dc}</Code> : '—'}</td></tr>
                    <tr><td style={{ color: 'var(--muted)' }}>Received at</td>
                      <td>{data.site_name}</td></tr>
                    <tr><td style={{ color: 'var(--muted)' }}>Received by</td>
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
              <Card title="Where the purchase order stands">
                <div className="pad">
                  <Link className="linkish" to={`/purchase-orders/${data.po.poId}`}>
                    <Code>{data.po.docNo}</Code></Link>
                  <div style={{ margin: '10px 0' }}>
                    <Meter value={Number(data.po.receivedQty)} max={Number(data.po.orderedQty)} label="Received" />
                    <small style={{ color: 'var(--muted)' }}>
                      {qty(data.po.receivedQty)} of {qty(data.po.orderedQty)} received
                    </small>
                  </div>
                  {Number(data.po.pendingQty) > 0 ? (
                    <p style={{ fontSize: 13, margin: 0 }}>
                      <b>{qty(data.po.pendingQty)} still to receive.</b> The purchase order stays open
                      until it has all arrived.
                    </p>
                  ) : (
                    <Status tone="done" label="Received in full" />
                  )}
                </div>
              </Card>
            )}

            <Card title="History" sub="Added to, never edited">
              <div className="tw">
                <table>
                  <tbody>
                    {data.events.map((e, n) => (
                      <tr key={n}>
                        <td><Status tone={/confirm|receiv/i.test(e.action) ? 'done' : 'neutral'} label={e.action} /></td>
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
              <Card title="Other GRNs on this purchase order">
                <div className="tw">
                  <table>
                    <tbody>
                      {data.siblings.map((s) => (
                        <tr key={s.grn_id}
                          style={s.grn_id === data.grn_id ? { background: 'var(--brand-soft)' } : undefined}>
                          <td>{s.grn_id === data.grn_id
                            ? <Code as="b">{s.doc_no}</Code>
                            : <Link to={`/grns/${s.grn_id}`} className="linkish"><Code>{s.doc_no}</Code></Link>}
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
