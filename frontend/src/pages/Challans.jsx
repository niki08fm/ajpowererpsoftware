import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useApp, PageHead } from '../App';
import { api, qty, units, dmy, today, withBranch, canWrite, plural } from '../api';
import { downloadCsv, printDoc } from '../download';
import {
  useApi, Card, Empty, Loading, ErrorNote, Banner, Field, Modal, Meter, useToast, Code, Status,
  DateField, DocHead, NextStep,
} from '../components/ui';
import { PrnLink } from '../components/StorePrn';
import { Icon } from '../components/icons';
import { dcState, prnStage } from '../vocab';

/**
 * Delivery challans.
 *
 * Dispatching and receiving are two events. What is dispatched leaves
 * the store at once; what arrives becomes the site's stock only when the
 * site confirms receipt. The difference is on the road — it belongs to
 * nobody, and it stays on the screen until somebody accounts for it.
 */
export const DcTag = ({ state }) => <Status is={dcState(state)} />;

/** History rows written before the wording was settled, said the new way. */
const EVENT_WORD = {
  'Acknowledged in full': 'Received in full',
  'Part acknowledged': 'Part received',
  Drafted: 'Saved as draft',
};

/**
 * Where a challan has got to, left to right.
 *
 * A lorry goes through four states and it should be readable at a
 * glance which one it is in.
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
      label: done ? 'Received' : 'Being received',
      at: gone ? `${qty(acked)} of ${qty(sent)}` : null,
      done: acked > 0,
    },
    {
      label: 'Completed',
      at: done ? 'Nothing left on the road' : gone ? `${qty(left)} not yet received` : null,
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
  const { data: sites } = useApi(withBranch('/sites', branchId), [branchId]);
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
  const { data, error, loading, reload } = useApi(`/challans?${qs}`,
    [branchId, qs]);
  const rows = data || [];
  const out = rows.filter((r) => Number(r.in_transit_qty) > 0);

  const grab = () => downloadCsv('challans', [
    ['Challan', 'Dispatched', 'From', 'To', 'Vehicle', 'Lines', 'Dispatched qty', 'Received at site',
      'On the road', 'Days out', 'Status'],
    ...rows.map((r) => [r.doc_no, dmy(r.dc_date), r.from_name, r.to_name, r.vehicle_no || '',
      r.line_count, r.sent_qty, r.acked_qty, r.in_transit_qty, r.days_out,
      dcState(r.state).label]),
  ]);

  return (
    <>
      <PageHead title="Delivery challans" sub="What the store dispatched to sites, and how much each site has received"
        actions={
          <>
            <button className="btn" onClick={grab} disabled={!rows.length}><Icon name="download" size={14} />Download</button>
            {canWrite('/challans') && <Link className="btn pri" to="/store/prns"><Icon name="truck" />Dispatch against a PRN</Link>}
          </>
        } />
      <div className="page-body">
        {error && <ErrorNote error={error} onRetry={reload} />}

        <Card>
          <div className="pad" style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <Field label="Search">
              <input className="inp" type="search" style={{ width: 210 }} placeholder="Challan, site or vehicle…"
                value={f.q} onChange={(e) => setF((x) => ({ ...x, q: e.target.value }))} />
            </Field>
            <Field label="Status">
              <select className="inp" style={{ width: 180 }} value={f.state}
                onChange={(e) => setF((x) => ({ ...x, state: e.target.value }))}>
                <option value="ALL">Everything</option>
                <option value="PENDING">Not yet received in full</option>
                <option value="IN_TRANSIT">On the road</option>
                <option value="PART_ACK">Partly received</option>
                <option value="ACKNOWLEDGED">Received in full</option>
                <option value="DRAFT">Draft</option>
              </select>
            </Field>
            <Field label="Dispatched from">
              <select className="inp" style={{ width: 190 }} value={f.fromSiteId}
                onChange={(e) => setF((x) => ({ ...x, fromSiteId: e.target.value }))}>
                <option value="MINE">The store in the top bar</option>
                <option value="ALL">Every store</option>
                {(stores || []).map((st) => (
                  <option key={st.id} value={st.id}>{st.name}</option>
                ))}
              </select>
            </Field>
            <Field label="Dispatched to">
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
          <Banner kind="info" icon="truck">
            <b>{qty(out.reduce((t, r) => t + Number(r.in_transit_qty), 0))} units on the road</b> across{' '}
            {plural(out.length, 'challan')}. Until a site confirms receipt, that material is in
            nobody's stock.
          </Banner>
        )}

        {loading && !data ? <Loading what="delivery challans" /> : (
          <Card title={plural(rows.length, 'challan')}>
            <div className="tw">
              <table>
                <thead>
                  <tr>
                    <th>Challan</th><th>From</th><th>To</th><th>For PRN</th>
                    <th className="rt">Dispatched</th><th style={{ width: 150 }}>Received at site</th>
                    <th className="rt">On the road</th>
                    <th>Status</th><th className="rt">Days out</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.dc_id}>
                      <td><Link className="linkish" to={`/challans/${r.dc_id}`}><Code>{r.doc_no}</Code></Link>
                        <small>{dmy(r.dc_date)}{r.vehicle_no ? ` · ${r.vehicle_no}` : ''}</small></td>
                      <td>{r.from_name}</td>
                      <td>{r.to_name}</td>
                      <td>{r.prns ? <Code>{r.prns}</Code> : '—'}</td>
                      <td className="rt mono">{qty(r.sent_qty)}</td>
                      <td>
                        <Meter value={Number(r.acked_qty)} max={Number(r.sent_qty)} label="Received at site" />
                        <small className="mono">{qty(r.acked_qty)} of {qty(r.sent_qty)}</small>
                      </td>
                      <td className="rt mono">
                        {Number(r.in_transit_qty) ? <b>{qty(r.in_transit_qty)}</b> : '—'}
                      </td>
                      <td><DcTag state={r.state} /></td>
                      <td className="rt mono">
                        {Number(r.days_out) > 3
                          ? <Status tone="attention" icon="clock" label={plural(r.days_out, 'day')} hint="On the road more than 3 days" />
                          : Number(r.days_out) || '—'}
                      </td>
                    </tr>
                  ))}
                  {!rows.length && (
                    <tr><td colSpan={9}>
                      <Empty title="No delivery challans match these filters">
                        Clear the filters, or <Link className="linkish" to="/store/prns">dispatch against a PRN</Link>.
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
   One challan: what went, and what the site has received.
   =================================================================== */
export function ChallanDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const toast = useToast();
  const { data, error, loading, reload } = useApi(`/challans/${id}`, [id]);
  const [acking, setAcking] = useState(false);

  if (loading && !data) return <Loading what="the delivery challan" />;
  if (error) return <div className="page-body" style={{ paddingTop: 24 }}><ErrorNote error={error} onRetry={reload} /></div>;

  const dispatch = async () => {
    try {
      const r = await api.post(`/challans/${id}/dispatch`);
      toast(`Dispatched — ${units(r.inTransitQty)} on the road until the site confirms receipt`, 'ok');
      reload();
    } catch (e) { toast(e.message, 'bad'); }
  };

  /** What this site counted off the lorry, on paper, for whoever asks. */
  const ackSlip = (a) => printDoc({
    title: 'Material Receipt',
    docNo: `${data.doc_no} — received ${dmy(a.ack_date)}`,
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
      { label: 'Item code' }, { label: 'Item' }, { label: 'Unit' },
      { label: 'On the challan', rt: true }, { label: 'Received', rt: true },
    ],
    rows: (a.lines || []).map((l) => [l.item_code, l.item_name, l.uom,
      qty(l.sent_qty), qty(l.qty)]),
    totals: ['', '', 'Total received', '', qty(a.qty)],
    note: Number(data.in_transit_qty) > 0
      ? `${qty(data.in_transit_qty)} of this challan is not yet received.`
      : 'This challan is received in full.',
    footer: 'The signature below confirms the quantities received only.',
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
      { label: 'Item code' }, { label: 'Item' }, { label: 'Unit' },
      { label: 'Dispatched', rt: true }, { label: 'Received at site', rt: true },
      { label: 'Not yet received', rt: true },
    ],
    rows: data.lines.map((l) => [l.item_code, l.item_name, l.uom,
      qty(l.sent_qty), Number(l.acked_qty) ? qty(l.acked_qty) : '—',
      Number(l.in_transit_qty) ? qty(l.in_transit_qty) : '—']),
    totals: ['', '', 'Total', qty(data.sent_qty), qty(data.acked_qty),
      qty(data.in_transit_qty)],
    footer: dcState(data.state).label,
  });

  const grab = () => downloadCsv(`challan-${data.doc_no}`, [
    ['Delivery challan', data.doc_no],
    ['From', data.from_name], ['To', data.to_name],
    ['Date', dmy(data.dc_date)], ['Vehicle', data.vehicle_no || ''], ['Driver', data.driver || ''],
    ['Status', dcState(data.state).label], [],
    ['Item code', 'Item', 'Unit', 'Dispatched', 'Received at site', 'Not yet received', 'For PRN'],
    ...data.lines.map((l) => [l.item_code, l.item_name, l.uom, l.sent_qty, l.acked_qty,
      l.in_transit_qty, l.against || '']),
    [], ['', '', '', data.sent_qty, data.acked_qty, data.in_transit_qty],
  ]);

  return (
    <>
      <DocHead kind="Delivery challan"
        back={<button type="button" className="btn sm ghost" style={{ marginLeft: -8 }} onClick={() => nav('/challans')}><Icon name="arrowLeft" size={14} />Delivery challans</button>}
        docNo={<Code>{data.doc_no}</Code>}
        status={<DcTag state={data.state} />}
        meta={[<><b>{data.from_name}</b> → <b>{data.to_name}</b></>, `Dated ${dmy(data.dc_date)}`,
          data.vehicle_no && <>Vehicle <Code>{data.vehicle_no}</Code></>]}
        actions={
          <>
            <button className="btn" onClick={grab}><Icon name="download" size={14} />Download</button>
            <button className="btn" onClick={dcSlip}><Icon name="print" size={14} />Print challan</button>
            {data.canDispatch && canWrite('/challans') && <button className="btn pri" onClick={dispatch}><Icon name="truck" />Dispatch challan</button>}
            {data.canAck && canWrite(`/challans/${id}/acknowledge`) && (
              <button className="btn pri" onClick={() => setAcking(true)}>Confirm receipt</button>
            )}
          </>
        } />
      <div className="page-body">
        <Card>
          <div className="pad"><DcSteps dc={data} /></div>
        </Card>

        {Number(data.in_transit_qty) > 0 && data.status !== 'DRAFT' && (
          <NextStep tone={Number(data.days_out) > 3 ? 'attention' : 'info'} icon="truck"
            now={`${units(data.in_transit_qty)} not yet received at ${data.to_name}${Number(data.days_out) > 0 ? ` · on the road ${plural(data.days_out, 'day')}` : ''}`}
            then={`It has left the store's stock and is not yet in ${data.to_name}'s. Next: the site confirms what arrived.`} />
        )}
        {data.state === 'ACKNOWLEDGED' && (
          <NextStep tone="done" icon="check"
            now="Received in full"
            then={`Everything sent (${units(data.sent_qty)}) is in ${data.to_name}'s stock.`} />
        )}
        {data.status === 'DRAFT' && (
          <NextStep tone="neutral" icon="draft" now="Draft — not dispatched"
            then="Nothing has left the store. Dispatch it when the lorry leaves." />
        )}

        <div className="grid2">
          <div>
            <Card title="Items on this challan" sub="Dispatched, received at site, and what is still on the road">
              <div className="tw">
                <table className="sheet">
                  <thead>
                    <tr>
                      <th style={{ width: 110 }}>Item code</th><th>Item</th><th style={{ width: 60 }}>Unit</th>
                      <th className="rt">Dispatched</th><th className="rt">Received at site</th>
                      <th className="rt">Not yet received</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.lines.map((l) => (
                      <tr key={l.dc_line_id}>
                        <td><Code>{l.item_code}</Code></td>
                        <td>{l.item_name}
                          {l.against && <small>For <Code>{l.against}</Code></small>}</td>
                        <td>{l.uom}</td>
                        <td className="rt mono">{qty(l.sent_qty)}</td>
                        <td className="rt mono">{Number(l.acked_qty) ? qty(l.acked_qty) : '—'}</td>
                        <td className="rt mono">
                          <b>{Number(l.in_transit_qty) ? qty(l.in_transit_qty) : '—'}</b>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <th colSpan={3} className="rt">Total</th>
                      <th className="rt mono">{qty(data.sent_qty)}</th>
                      <th className="rt mono">{qty(data.acked_qty)}</th>
                      <th className="rt mono">{qty(data.in_transit_qty)}</th>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </Card>

            <Card title="PRNs on this challan"
              sub="How much of each PRN this lorry carried, and where each PRN now stands">
              <div className="tw">
                <table>
                  <thead>
                    <tr><th>PRN</th><th>Needed by</th><th className="rt">On this challan</th>
                      <th style={{ width: 150 }}>Received at site</th>
                      <th className="rt">Still to deliver</th><th>Material</th></tr>
                  </thead>
                  <tbody>
                    {data.prns.map((p) => (
                      <tr key={p.indent_id}>
                        <td><PrnLink id={p.indent_id}>
                          <Code>{p.doc_no}</Code></PrnLink></td>
                        <td className="mono">{p.needed_by ? dmy(p.needed_by) : '—'}</td>
                        <td className="rt mono"><b>{qty(p.on_this_dc)}</b></td>
                        <td>
                          <Meter value={Number(p.at_site_qty)} max={Number(p.indented_qty)} label="Received at site" />
                          <small className="mono">
                            {qty(p.at_site_qty)} of {qty(p.indented_qty)}</small>
                        </td>
                        <td className="rt mono">{qty(p.to_deliver_qty)}</td>
                        <td><Status is={prnStage(p.stage)} /></td>
                      </tr>
                    ))}
                    {!data.prns.length && (
                      <tr><td colSpan={6}>
                        <Empty title="This challan is not for any PRN">
                          Stock can be dispatched without a PRN behind it.
                        </Empty>
                      </td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </Card>

            <Card title="Receipts at site" sub={`${plural(data.acks.length, 'receipt')} so far`}>
              {data.acks.length ? (
                <div className="tw">
                  <table>
                    <thead><tr><th>Received on</th><th className="rt">Units</th><th>Received by</th>
                      <th>Note</th><th /></tr></thead>
                    <tbody>
                      {data.acks.map((a) => (
                        <tr key={a.id}>
                          <td className="mono">{dmy(a.ack_date)}</td>
                          <td className="rt mono">{qty(a.qty)}
                            <small>{plural((a.lines || []).length, 'item')}</small></td>
                          <td>{a.acked_by_name || '—'}</td>
                          <td>{a.note || '—'}</td>
                          <td className="rt">
                            <button className="btn sm" onClick={() => ackSlip(a)}><Icon name="print" size={14} />Receipt slip</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <Empty title="Nothing received yet">
                  {data.status === 'DRAFT'
                    ? 'It has not left the store.'
                    : `${data.to_name} has not confirmed receipt of any of it yet.`}
                </Empty>
              )}
            </Card>
          </div>

          <div>
            <Card title="History" sub="Added to, never edited">
              <div className="tw">
                <table>
                  <tbody>
                    {data.events.map((e, n) => (
                      <tr key={n}>
                        <td><Status tone={/full/i.test(e.action) ? 'done'
                          : /cancel/i.test(e.action) ? 'stopped' : 'neutral'}
                          label={EVENT_WORD[e.action] || e.action} /></td>
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

            <Card title="Details">
              <div className="pad">
                <Meter value={Number(data.acked_qty)} max={Number(data.sent_qty)} label="Received at site" />
                <small style={{ color: 'var(--muted)' }}>
                  {qty(data.acked_qty)} of {qty(data.sent_qty)} received at site
                </small>
                <table style={{ marginTop: 12 }}>
                  <tbody>
                    <tr><td style={{ color: 'var(--muted)' }}>From</td><td><b>{data.from_name}</b></td></tr>
                    <tr><td style={{ color: 'var(--muted)' }}>To</td><td><b>{data.to_name}</b></td></tr>
                    <tr><td style={{ color: 'var(--muted)' }}>Vehicle</td>
                      <td><Code>{data.vehicle_no || '—'}</Code></td></tr>
                    <tr><td style={{ color: 'var(--muted)' }}>Driver</td><td>{data.driver || '—'}</td></tr>
                    {data.dispatched_at && (
                      <tr><td style={{ color: 'var(--muted)' }}>Dispatched</td>
                        <td className="mono">{dmy(data.dispatched_at)}<small>{data.dispatched_by_name}</small></td></tr>
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

  /** The slip for what was just received, while the driver is still there. */
  const slip = (r) => printDoc({
    title: 'Material Receipt',
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
      { label: 'Item code' }, { label: 'Item' }, { label: 'Unit' },
      { label: 'On the challan', rt: true }, { label: 'Received', rt: true },
    ],
    rows: lines.map((l) => [l.item_code, l.item_name, l.uom,
      qty(l.sent_qty), qty(got[l.dc_line_id])]),
    totals: ['', '', 'Total received', '',
      qty(lines.reduce((t, l) => t + Number(got[l.dc_line_id]), 0))],
    note: Number(r.inTransitQty) > 0
      ? `${qty(r.inTransitQty)} of this challan is not yet received.`
      : 'This challan is received in full.',
    footer: 'The signature below confirms the quantities received only.',
  });

  const save = async () => {
    if (!lines.length) return toast('Type what actually arrived', 'bad');
    setBusy(true);
    try {
      const r = await api.post(`/challans/${dcId}/acknowledge`, {
        ackDate: head.ackDate, note: head.note || undefined,
        lines: lines.map((l) => ({ dcLineId: l.dc_line_id, qty: Number(got[l.dc_line_id]) })),
      });
      toast(r.state === 'ACKNOWLEDGED'
        ? 'Received in full — it is all in site stock now'
        : `Received. ${qty(r.inTransitQty)} is not yet received and stays on the challan.`, 'ok');
      // a receipt is wanted while the driver is still standing there
      setDone(r);
    } catch (e) { toast(e.message, 'bad'); }
    setBusy(false);
    return undefined;
  };

  if (loading) return <Modal wide title="Confirm receipt" onClose={onClose}><Loading what="the challan" /></Modal>;

  if (done) {
    const took = lines.reduce((t, l) => t + Number(got[l.dc_line_id]), 0);
    return (
      <Modal title="Receipt confirmed" sub={data.docNo} onClose={onDone}
        footer={<>
          <button className="btn" onClick={onDone}>Done</button>
          <button className="btn pri" onClick={() => slip(done)}><Icon name="print" size={14} />Print receipt slip</button>
        </>}>
        <Banner kind={Number(done.inTransitQty) > 0 ? 'warn' : 'ok'}>
          <b>{qty(took)} received at {data.to}.</b>{' '}
          {Number(done.inTransitQty) > 0
            ? `${qty(done.inTransitQty)} of this challan is not yet received and stays on it
               until somebody accounts for it.`
            : 'This challan is received in full.'}
        </Banner>
        <p style={{ color: 'var(--muted)', fontSize: 12.5 }}>
          The slip records what was counted off the lorry — hand it to the driver, or keep it
          with the site file.
        </p>
      </Modal>
    );
  }

  return (
    <Modal wide title={`Confirm receipt: ${data.docNo}`} sub={`${data.from} → ${data.to}`}
      onClose={onClose}
      footer={<>
        <button className="btn" onClick={onClose}>Cancel</button>
        <span className="sp" />
        <button className="btn" onClick={() => setGot(Object.fromEntries(
          data.lines.map((l) => [l.dc_line_id, String(l.in_transit_qty)])))}>
          Fill in: everything arrived
        </button>
        <button className="btn pri" disabled={busy || !lines.length} onClick={save}>
          {busy ? 'Saving…' : 'Confirm receipt'}
        </button>
      </>}>
      <Banner kind="info">
        Count what came off the lorry and type that. Only what you confirm goes into this site's
        stock; anything short stays on the challan as not yet received until it is accounted for.
      </Banner>
      <div className="row2">
        <DateField label="Received on" value={head.ackDate} max={today()}
          onChange={(e) => setHead((h) => ({ ...h, ackDate: e.target.value }))} />
        <Field label="Note">
          <input className="inp" value={head.note} placeholder="e.g. two bundles short"
            onChange={(e) => setHead((h) => ({ ...h, note: e.target.value }))} />
        </Field>
      </div>
      <div className="tw">
        <table className="sheet">
          <thead>
            <tr>
              <th style={{ width: 110 }}>Item code</th><th>Item</th><th style={{ width: 60 }}>Unit</th>
              <th className="rt" style={{ width: 96 }}>Dispatched</th>
              <th className="rt" style={{ width: 120 }}>Not yet received</th>
              <th className="rt" style={{ width: 110 }}>Arrived now</th>
            </tr>
          </thead>
          <tbody>
            {data.lines.map((l) => (
              <tr key={l.dc_line_id}
                style={Number(got[l.dc_line_id]) > 0 ? { background: 'var(--brand-soft)' } : undefined}>
                <td><Code>{l.item_code}</Code></td>
                <td>{l.item_name}</td><td>{l.uom}</td>
                <td className="rt mono">{qty(l.sent_qty)}</td>
                <td className="rt mono"><b>{qty(l.in_transit_qty)}</b></td>
                <td><input className="inp rt" type="number" min="0" step="any" placeholder="0" inputMode="decimal"
                  aria-label={`Quantity of ${l.item_name} that arrived`}
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
