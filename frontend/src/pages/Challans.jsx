import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useApp, PageHead } from '../App';
import { api, qty, money, dmy, today } from '../api';
import { downloadCsv, printDoc } from '../download';
import {
  useApi, Card, Tag, Empty, Loading, ErrorNote, Banner, Field, Modal, Meter, useToast,
} from '../components/ui';

/**
 * Delivery challans.
 *
 * Dispatching and acknowledging are two events. What is sent leaves the
 * store at once; what arrives becomes the site's only when the site
 * says so. The difference is in transit — it belongs to nobody, and it
 * stays on the screen until somebody accounts for it.
 */
const STATE = {
  DRAFT: { label: 'Draft', kind: '' },
  IN_TRANSIT: { label: 'On the road', kind: 'warn' },
  PART_ACK: { label: 'Part received', kind: 'warn' },
  ACKNOWLEDGED: { label: 'Received in full', kind: 'ok' },
  CANCELLED: { label: 'Cancelled', kind: '' },
};
export const DcTag = ({ state }) => {
  const s = STATE[state] || { label: state, kind: '' };
  return <Tag kind={s.kind}>{s.label}</Tag>;
};

/**
 * Where a challan has got to, left to right.
 *
 * A lorry goes through four states and it should be readable at a
 * glance which one it is in — the same way an order says whether it is
 * with the GM or with the supplier.
 */
function DcSteps({ dc }) {
  const acked = Number(dc.acked_qty);
  const sent = Number(dc.sent_qty);
  const left = Number(dc.in_transit_qty);
  const gone = dc.status !== 'DRAFT' && dc.status !== 'CANCELLED';
  const done = gone && left <= 0.0005 && acked > 0;

  const steps = [
    { label: 'Raised', at: dc.created_by_name, done: true },
    { label: 'Dispatched', at: dc.dispatched_at ? dmy(dc.dispatched_at) : null, done: gone },
    {
      label: done ? 'Signed for' : 'Being signed for',
      at: gone ? `${qty(acked)} of ${qty(sent)}` : null,
      done: acked > 0,
    },
    {
      label: 'Completed',
      at: done ? 'nothing outstanding' : gone ? `${qty(left)} outstanding` : null,
      done,
    },
  ];
  const now = steps.filter((x) => x.done).length - 1;

  return (
    <div className="steps">
      {steps.map((x, i) => (
        <div key={x.label}
          className={`step ${x.done ? 'done' : ''} ${i === now && !done ? 'now' : ''}`}>
          <b>{x.label}</b>
          <small>{x.at || '—'}</small>
        </div>
      ))}
    </div>
  );
}

/* =================================================================== */
export function Challans() {
  const { branchId, storeId, stores } = useApp();
  const [params] = useSearchParams();
  const [f, setF] = useState({
    q: '', state: params.get('state') || 'ALL', siteId: '', from: '', to: '', sort: 'date',
    // default to the shelf you are standing on, but it can be widened
    fromSiteId: params.get('from') || 'MINE',
  });
  const { data: sites } = useApi(branchId ? `/sites?branchId=${branchId}` : null, [branchId]);
  const sentFrom = f.fromSiteId === 'MINE' ? storeId : f.fromSiteId;
  const qs = new URLSearchParams({
    ...(branchId ? { branchId } : {}),
    ...(f.q ? { q: f.q } : {}),
    ...(f.siteId ? { siteId: f.siteId } : {}),
    ...(sentFrom && f.fromSiteId !== 'ALL' ? { fromSiteId: sentFrom } : {}),
    ...(f.from ? { from: f.from } : {}),
    ...(f.to ? { to: f.to } : {}),
    state: f.state, sort: f.sort,
  }).toString();
  const { data, error, loading, reload } = useApi(branchId ? `/challans?${qs}` : null,
    [branchId, qs]);
  const rows = data || [];
  const out = rows.filter((r) => Number(r.in_transit_qty) > 0);

  const grab = () => downloadCsv('challans', [
    ['Challan', 'Date', 'From', 'To', 'Vehicle', 'Lines', 'Sent', 'Signed for',
      'In transit', 'Value', 'Days out', 'State'],
    ...rows.map((r) => [r.doc_no, dmy(r.dc_date), r.from_name, r.to_name, r.vehicle_no || '',
      r.line_count, r.sent_qty, r.acked_qty, r.in_transit_qty, r.dc_value, r.days_out,
      (STATE[r.state] || {}).label || r.state]),
  ]);

  return (
    <>
      <PageHead title="Challans" sub="Store to site, and who has signed for what"
        actions={
          <div style={{ display: 'flex', gap: 9 }}>
            <button className="btn" onClick={grab} disabled={!rows.length}>Download</button>
            <Link className="btn pri" to="/store/prns">Issue against a PRN</Link>
          </div>
        } />
      <div className="page-body">
        {error && <ErrorNote error={error} onRetry={reload} />}

        <Card>
          <div className="pad" style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <Field label="Search">
              <input className="inp" style={{ width: 210 }} placeholder="Challan, site or vehicle"
                value={f.q} onChange={(e) => setF((x) => ({ ...x, q: e.target.value }))} />
            </Field>
            <Field label="State">
              <select className="inp" style={{ width: 180 }} value={f.state}
                onChange={(e) => setF((x) => ({ ...x, state: e.target.value }))}>
                <option value="ALL">Everything</option>
                <option value="PENDING">Awaiting a signature</option>
                <option value="IN_TRANSIT">On the road</option>
                <option value="PART_ACK">Part received</option>
                <option value="ACKNOWLEDGED">Received in full</option>
                <option value="DRAFT">Draft</option>
              </select>
            </Field>
            <Field label="Sent from">
              <select className="inp" style={{ width: 190 }} value={f.fromSiteId}
                onChange={(e) => setF((x) => ({ ...x, fromSiteId: e.target.value }))}>
                <option value="MINE">The store I am in</option>
                <option value="ALL">Every store</option>
                {(stores || []).map((st) => (
                  <option key={st.id} value={st.id}>{st.name}</option>
                ))}
              </select>
            </Field>
            <Field label="Sent to">
              <select className="inp" style={{ width: 185 }} value={f.siteId}
                onChange={(e) => setF((x) => ({ ...x, siteId: e.target.value }))}>
                <option value="">Anywhere</option>
                {(sites || []).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
              </select>
            </Field>
            <Field label="From">
              <input className="inp" type="date" style={{ width: 150 }} value={f.from}
                onChange={(e) => setF((x) => ({ ...x, from: e.target.value }))} />
            </Field>
            <Field label="To">
              <input className="inp" type="date" style={{ width: 150 }} value={f.to}
                onChange={(e) => setF((x) => ({ ...x, to: e.target.value }))} />
            </Field>
            <Field label="Sort by">
              <select className="inp" style={{ width: 165 }} value={f.sort}
                onChange={(e) => setF((x) => ({ ...x, sort: e.target.value }))}>
                <option value="date">Newest</option>
                <option value="oldest_out">Longest on the road</option>
                <option value="site">Site</option>
              </select>
            </Field>
          </div>
        </Card>

        {out.length > 0 && (
          <Banner kind="warn" icon="⇄">
            <b>{qty(out.reduce((t, r) => t + Number(r.in_transit_qty), 0))} units on the road</b> across{' '}
            {out.length} challan{out.length === 1 ? '' : 's'}. Until a site signs for it, that
            material is on nobody&apos;s books.
          </Banner>
        )}

        {loading ? <Loading /> : (
          <Card title={`${rows.length} challan${rows.length === 1 ? '' : 's'}`}>
            <div className="tw">
              <table>
                <thead>
                  <tr>
                    <th>Challan</th><th>From</th><th>To</th><th>Answering</th>
                    <th className="rt">Sent</th><th style={{ width: 140 }}>Signed for</th>
                    <th className="rt">In transit</th><th className="rt">Value</th>
                    <th>State</th><th className="rt">Days out</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.dc_id}>
                      <td><Link to={`/challans/${r.dc_id}`}><b className="mono">{r.doc_no}</b></Link>
                        <small>{dmy(r.dc_date)}{r.vehicle_no ? ` · ${r.vehicle_no}` : ''}</small></td>
                      <td>{r.from_name}</td>
                      <td>{r.to_name}</td>
                      <td><small className="mono">{r.prns || '—'}</small></td>
                      <td className="rt mono">{qty(r.sent_qty)}</td>
                      <td>
                        <Meter value={Number(r.acked_qty)} max={Number(r.sent_qty)} />
                        <small className="mono">{qty(r.acked_qty)} of {qty(r.sent_qty)}</small>
                      </td>
                      <td className="rt mono"
                        style={{ color: Number(r.in_transit_qty) > 0 ? 'var(--bad)' : undefined }}>
                        {Number(r.in_transit_qty) ? <b>{qty(r.in_transit_qty)}</b> : 'nil'}
                      </td>
                      <td className="rt mono">{money(r.dc_value)}</td>
                      <td><DcTag state={r.state} /></td>
                      <td className="rt mono">
                        {Number(r.days_out) > 3
                          ? <Tag kind="bad">{r.days_out}</Tag>
                          : Number(r.days_out) || '—'}
                      </td>
                    </tr>
                  ))}
                  {!rows.length && (
                    <tr><td colSpan={10}>
                      <Empty title="No challans match">
                        Clear the filters, or <Link to="/store/prns">issue against a PRN</Link>.
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
   One challan: what went, what has been signed for.
   =================================================================== */
export function ChallanDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const toast = useToast();
  const { data, error, loading, reload } = useApi(`/challans/${id}`, [id]);
  const [acking, setAcking] = useState(false);

  if (loading) return <Loading />;
  if (error) return <div className="page-body"><ErrorNote error={error} onRetry={reload} /></div>;

  const dispatch = async () => {
    try {
      const r = await api.post(`/challans/${id}/dispatch`);
      toast(`On the road — ${qty(r.inTransitQty)} until the site signs`, 'ok');
      reload();
    } catch (e) { toast(e.message, 'bad'); }
  };

  /** What this site counted off the lorry, on paper, for whoever asks. */
  const ackSlip = (a) => printDoc({
    title: 'Material Receipt Acknowledgement',
    docNo: `${data.doc_no} — ack ${dmy(a.ack_date)}`,
    sub: `Received at ${data.to_name}`,
    meta: [
      ['Challan', `${data.doc_no} dated ${dmy(data.dc_date)}`],
      ['Sent from', data.from_name],
      ['Vehicle', data.vehicle_no || '—'],
      ['Received on', dmy(a.ack_date)],
      ['Received by', a.acked_by_name || '—'],
      data.prns?.length
        ? ['Against PRN', data.prns.map((p) => p.doc_no).join(', ')] : null,
      a.note ? ['Remark', a.note] : null,
    ],
    columns: [
      { label: 'Code' }, { label: 'Item' }, { label: 'Unit' },
      { label: 'On the challan', rt: true }, { label: 'Received', rt: true },
    ],
    rows: (a.lines || []).map((l) => [l.item_code, l.item_name, l.uom,
      qty(l.sent_qty), qty(l.qty)]),
    totals: ['', '', 'Total received', '', qty(a.qty)],
    note: Number(data.in_transit_qty) > 0
      ? `${qty(data.in_transit_qty)} of this challan is still unaccounted for.`
      : 'This challan is now accounted for in full.',
    footer: 'Signing acknowledges the quantities above only.',
  });

  /** The challan itself, for the driver to carry. */
  const dcSlip = () => printDoc({
    title: 'Delivery Challan',
    docNo: data.doc_no,
    sub: `${data.from_name} → ${data.to_name}`,
    meta: [
      ['Date', dmy(data.dc_date)],
      ['Vehicle', data.vehicle_no || '—'],
      ['Driver', data.driver || '—'],
      ['Dispatched by', data.dispatched_by_name || data.created_by_name || '—'],
      data.prns?.length
        ? ['Against PRN', data.prns.map((p) => p.doc_no).join(', ')] : null,
      data.note ? ['Remark', data.note] : null,
    ],
    columns: [
      { label: 'Code' }, { label: 'Item' }, { label: 'Unit' },
      { label: 'Sent', rt: true }, { label: 'Received at site', rt: true },
      { label: 'Still pending', rt: true },
    ],
    rows: data.lines.map((l) => [l.item_code, l.item_name, l.uom,
      qty(l.sent_qty), Number(l.acked_qty) ? qty(l.acked_qty) : '—',
      Number(l.in_transit_qty) ? qty(l.in_transit_qty) : 'nil']),
    totals: ['', '', 'Total', qty(data.sent_qty), qty(data.acked_qty),
      qty(data.in_transit_qty)],
    footer: (STATE[data.state] || {}).label || data.state,
  });

  const grab = () => downloadCsv(`challan-${data.doc_no}`, [
    ['Delivery challan', data.doc_no],
    ['From', data.from_name], ['To', data.to_name],
    ['Date', dmy(data.dc_date)], ['Vehicle', data.vehicle_no || ''], ['Driver', data.driver || ''],
    ['State', (STATE[data.state] || {}).label || data.state], [],
    ['Code', 'Item', 'Unit', 'Sent', 'Received at site', 'Still pending', 'Rate', 'Value', 'Against'],
    ...data.lines.map((l) => [l.item_code, l.item_name, l.uom, l.sent_qty, l.acked_qty,
      l.in_transit_qty, l.rate, l.line_value, l.against || '']),
    [], ['', '', '', data.sent_qty, data.acked_qty, data.in_transit_qty, '', data.dc_value],
  ]);

  return (
    <>
      <PageHead title={data.doc_no}
        sub={`${data.from_name} → ${data.to_name} · ${dmy(data.dc_date)}`}
        actions={
          <div style={{ display: 'flex', gap: 9, flexWrap: 'wrap' }}>
            <button className="btn" onClick={() => nav('/challans')}>Back</button>
            <button className="btn" onClick={grab}>Download</button>
            <button className="btn" onClick={dcSlip}>Print the challan</button>
            {data.canDispatch && <button className="btn pri" onClick={dispatch}>Dispatch</button>}
            {data.canAck && (
              <button className="btn pri" onClick={() => setAcking(true)}>Acknowledge</button>
            )}
          </div>
        } />
      <div className="page-body">
        <Card>
          <div className="pad"><DcSteps dc={data} /></div>
        </Card>

        {Number(data.in_transit_qty) > 0 && data.status !== 'DRAFT' && (
          <Banner kind={Number(data.days_out) > 3 ? 'bad' : 'warn'} icon="⇄">
            <b>{qty(data.in_transit_qty)} still unaccounted for</b>
            {Number(data.days_out) > 0 && `, ${data.days_out} day${data.days_out === 1 ? '' : 's'} after it left`}.
            {' '}It is off the store&apos;s books and not yet on {data.to_name}&apos;s.
          </Banner>
        )}
        {data.state === 'ACKNOWLEDGED' && (
          <Banner kind="ok" icon="✓">
            Signed for in full. All {qty(data.sent_qty)} units are on {data.to_name}&apos;s books.
          </Banner>
        )}

        <div className="grid2">
          <div>
            <Card title="What went" sub="Sent, signed for, and what is still on the road">
              <div className="tw">
                <table className="sheet">
                  <thead>
                    <tr>
                      <th style={{ width: 100 }}>Code</th><th>Item</th><th style={{ width: 60 }}>Unit</th>
                      <th className="rt">Sent</th><th className="rt">Received at site</th>
                      <th className="rt">Still pending</th><th className="rt">Value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.lines.map((l) => (
                      <tr key={l.dc_line_id}>
                        <td className="mono" style={{ color: 'var(--brand-ink)' }}>{l.item_code}</td>
                        <td>{l.item_name}
                          {l.against && <small>for {l.against}</small>}</td>
                        <td>{l.uom}</td>
                        <td className="rt mono">{qty(l.sent_qty)}</td>
                        <td className="rt mono">{Number(l.acked_qty) ? qty(l.acked_qty) : '—'}</td>
                        <td className="rt mono"
                          style={{ color: Number(l.in_transit_qty) > 0 ? 'var(--bad)' : 'var(--ok)' }}>
                          <b>{Number(l.in_transit_qty) ? qty(l.in_transit_qty) : 'nil'}</b>
                        </td>
                        <td className="rt mono">{money(l.line_value)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <th colSpan={3} className="rt">Total</th>
                      <th className="rt mono">{qty(data.sent_qty)}</th>
                      <th className="rt mono">{qty(data.acked_qty)}</th>
                      <th className="rt mono">{qty(data.in_transit_qty)}</th>
                      <th className="rt mono">{money(data.dc_value)}</th>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </Card>

            <Card title="The PRNs this answers"
              sub="How much of each one this lorry carried, and where each now stands">
              <div className="tw">
                <table>
                  <thead>
                    <tr><th>PRN</th><th>Needed</th><th className="rt">On this challan</th>
                      <th style={{ width: 150 }}>At the site</th>
                      <th className="rt">Still owed</th><th>Stage</th></tr>
                  </thead>
                  <tbody>
                    {data.prns.map((p) => (
                      <tr key={p.indent_id}>
                        <td><Link to={`/indents/${p.indent_id}`}>
                          <b className="mono">{p.doc_no}</b></Link></td>
                        <td>{p.needed_by ? dmy(p.needed_by) : '—'}</td>
                        <td className="rt mono"><b>{qty(p.on_this_dc)}</b></td>
                        <td>
                          <Meter value={Number(p.at_site_qty)} max={Number(p.indented_qty)} />
                          <small className="mono">
                            {qty(p.at_site_qty)} of {qty(p.indented_qty)}</small>
                        </td>
                        <td className="rt mono">{qty(p.to_deliver_qty)}</td>
                        <td><Tag kind={p.stage === 'AT_SITE' ? 'ok' : 'warn'}>
                          {p.stage.replace(/_/g, ' ').toLowerCase()}</Tag></td>
                      </tr>
                    ))}
                    {!data.prns.length && (
                      <tr><td colSpan={6}>
                        <Empty title="This challan answers no PRN">
                          Stock may travel without answering a requirement.
                        </Empty>
                      </td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </Card>

            <Card title="Signatures" sub={`${data.acks.length} so far`}>
              {data.acks.length ? (
                <div className="tw">
                  <table>
                    <thead><tr><th>Date</th><th className="rt">Received</th><th>By</th>
                      <th>Note</th><th /></tr></thead>
                    <tbody>
                      {data.acks.map((a) => (
                        <tr key={a.id}>
                          <td>{dmy(a.ack_date)}</td>
                          <td className="rt mono">{qty(a.qty)}
                            <small>{(a.lines || []).length} item(s)</small></td>
                          <td>{a.acked_by_name || '—'}</td>
                          <td>{a.note || '—'}</td>
                          <td className="rt">
                            <button className="btn sm" onClick={() => ackSlip(a)}>Slip</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <Empty title="Nobody has signed yet">
                  {data.status === 'DRAFT'
                    ? 'It has not left the store.'
                    : `${data.to_name} has not acknowledged any of it.`}
                </Empty>
              )}
            </Card>
          </div>

          <div>
            <Card title="History" sub="Appended, never edited">
              <div className="tw">
                <table>
                  <tbody>
                    {data.events.map((e, n) => (
                      <tr key={n}>
                        <td><Tag kind={/full/i.test(e.action) ? 'ok'
                          : /cancel/i.test(e.action) ? 'bad' : ''}>{e.action}</Tag></td>
                        <td>{e.user_name || '—'}<small>{dmy(e.created_at)}</small></td>
                        <td>{e.detail || ''}</td>
                      </tr>
                    ))}
                    {!data.events.length && (
                      <tr><td colSpan={3} style={{ color: 'var(--faint)' }}>Nothing yet.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </Card>

            <Card title="Where it is">
              <div className="pad">
                <div style={{ marginBottom: 12 }}><DcTag state={data.state} /></div>
                <Meter value={Number(data.acked_qty)} max={Number(data.sent_qty)} />
                <small style={{ color: 'var(--muted)' }}>
                  {qty(data.acked_qty)} of {qty(data.sent_qty)} signed for
                </small>
                <table style={{ marginTop: 12 }}>
                  <tbody>
                    <tr><td style={{ color: 'var(--muted)' }}>From</td><td><b>{data.from_name}</b></td></tr>
                    <tr><td style={{ color: 'var(--muted)' }}>To</td><td><b>{data.to_name}</b></td></tr>
                    <tr><td style={{ color: 'var(--muted)' }}>Vehicle</td>
                      <td className="mono">{data.vehicle_no || '—'}</td></tr>
                    <tr><td style={{ color: 'var(--muted)' }}>Driver</td><td>{data.driver || '—'}</td></tr>
                    {data.dispatched_at && (
                      <tr><td style={{ color: 'var(--muted)' }}>Dispatched</td>
                        <td>{dmy(data.dispatched_at)}<small>{data.dispatched_by_name}</small></td></tr>
                    )}
                    <tr><td style={{ color: 'var(--muted)' }}>Raised by</td>
                      <td>{data.created_by_name || '—'}</td></tr>
                  </tbody>
                </table>
                {data.note && (
                  <p style={{ marginTop: 12, color: 'var(--muted)', fontSize: 12.5 }}>{data.note}</p>
                )}
              </div>
            </Card>
          </div>
        </div>
      </div>

      {acking && (
        <AckModal dcId={id} onClose={() => setAcking(false)}
          onDone={() => { setAcking(false); reload(); }} />
      )}
    </>
  );
}

/* =================================================================== */
export function AckModal({ dcId, onClose, onDone }) {
  const toast = useToast();
  const { me } = useApp();
  const { data, loading } = useApi(`/challans/${dcId}/pending`, [dcId]);
  const [got, setGot] = useState({});
  const [head, setHead] = useState({ ackDate: today(), note: '' });
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);

  const lines = (data?.lines || []).filter((l) => Number(got[l.dc_line_id]) > 0);

  /** The slip for what was just signed for, while it is still in hand. */
  const slip = (r) => printDoc({
    title: 'Material Receipt Acknowledgement',
    docNo: `${data.docNo} — ${dmy(head.ackDate)}`,
    sub: `Received at ${data.to}`,
    meta: [
      ['Challan', data.docNo],
      ['Sent from', data.from],
      ['Received on', dmy(head.ackDate)],
      ['Received by', me?.name || '—'],
      head.note ? ['Remark', head.note] : null,
    ],
    columns: [
      { label: 'Code' }, { label: 'Item' }, { label: 'Unit' },
      { label: 'On the challan', rt: true }, { label: 'Received', rt: true },
    ],
    rows: lines.map((l) => [l.item_code, l.item_name, l.uom,
      qty(l.sent_qty), qty(got[l.dc_line_id])]),
    totals: ['', '', 'Total received', '',
      qty(lines.reduce((t, l) => t + Number(got[l.dc_line_id]), 0))],
    note: Number(r.inTransitQty) > 0
      ? `${qty(r.inTransitQty)} of this challan is still unaccounted for.`
      : 'This challan is now accounted for in full.',
    footer: 'Signing acknowledges the quantities above only.',
  });

  const save = async () => {
    if (!lines.length) return toast('Enter what actually arrived', 'bad');
    setBusy(true);
    try {
      const r = await api.post(`/challans/${dcId}/acknowledge`, {
        ackDate: head.ackDate, note: head.note || undefined,
        lines: lines.map((l) => ({ dcLineId: l.dc_line_id, qty: Number(got[l.dc_line_id]) })),
      });
      toast(r.state === 'ACKNOWLEDGED'
        ? 'Signed for in full — it is all on the site now'
        : `${qty(r.inTransitQty)} still unaccounted for`, 'ok');
      // a receipt is wanted while the driver is still standing there
      setDone(r);
    } catch (e) { toast(e.message, 'bad'); }
    setBusy(false);
    return undefined;
  };

  if (loading) return <Modal wide title="Acknowledge" onClose={onClose}><Loading /></Modal>;

  if (done) {
    const took = lines.reduce((t, l) => t + Number(got[l.dc_line_id]), 0);
    return (
      <Modal title="Signed for" sub={data.docNo} onClose={onDone}
        footer={<>
          <button className="btn" onClick={onDone}>Done</button>
          <button className="btn pri" onClick={() => slip(done)}>Print the slip</button>
        </>}>
        <Banner kind={Number(done.inTransitQty) > 0 ? 'warn' : 'ok'} icon="✓">
          <b>{qty(took)} received at {data.to}.</b>{' '}
          {Number(done.inTransitQty) > 0
            ? `${qty(done.inTransitQty)} of this challan is still unaccounted for and stays
               outstanding until somebody signs for it.`
            : 'This challan is accounted for in full.'}
        </Banner>
        <p style={{ color: 'var(--muted)', fontSize: 12.5 }}>
          The slip records what was counted off the lorry — hand it to the driver, or keep it
          with the site file.
        </p>
      </Modal>
    );
  }

  return (
    <Modal wide title={`Acknowledge ${data.docNo}`} sub={`${data.from} → ${data.to}`}
      onClose={onClose}
      footer={<>
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn" onClick={() => setGot(Object.fromEntries(
          data.lines.map((l) => [l.dc_line_id, String(l.in_transit_qty)])))}>
          Everything arrived
        </button>
        <button className="btn pri" disabled={busy} onClick={save}>Sign for it</button>
      </>}>
      <Banner kind="info" icon="✓">
        Count what came off the lorry. What you sign for goes on this site&apos;s books; anything
        short stays in transit and on the challan until it is accounted for.
      </Banner>
      <div className="row2">
        <Field label="Received on">
          <input className="inp" type="date" value={head.ackDate}
            onChange={(e) => setHead((h) => ({ ...h, ackDate: e.target.value }))} />
        </Field>
        <Field label="Note">
          <input className="inp" value={head.note} placeholder="e.g. two bundles short"
            onChange={(e) => setHead((h) => ({ ...h, note: e.target.value }))} />
        </Field>
      </div>
      <div className="tw">
        <table className="sheet">
          <thead>
            <tr>
              <th style={{ width: 100 }}>Code</th><th>Item</th><th style={{ width: 60 }}>Unit</th>
              <th className="rt" style={{ width: 88 }}>Sent</th>
              <th className="rt" style={{ width: 100 }}>Unaccounted</th>
              <th className="rt" style={{ width: 100 }}>Arrived</th>
            </tr>
          </thead>
          <tbody>
            {data.lines.map((l) => (
              <tr key={l.dc_line_id}
                style={Number(got[l.dc_line_id]) > 0 ? { background: 'var(--brand-soft)' } : undefined}>
                <td className="mono" style={{ color: 'var(--brand-ink)' }}>{l.item_code}</td>
                <td>{l.item_name}</td><td>{l.uom}</td>
                <td className="rt mono">{qty(l.sent_qty)}</td>
                <td className="rt mono"><b>{qty(l.in_transit_qty)}</b></td>
                <td><input className="inp rt" type="number" min="0" step="any" placeholder="—"
                  value={got[l.dc_line_id] ?? ''}
                  onChange={(e) => setGot((x) => ({ ...x, [l.dc_line_id]: e.target.value }))} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Modal>
  );
}
