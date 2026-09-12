import { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useApp, PageHead } from '../App';
import { api, qty, money, dmy, today } from '../api';
import { downloadCsv } from '../download';
import {
  useApi, useToast, Card, Tag, Empty, Loading, ErrorNote, Banner, Field, Modal, Stat, Meter,
} from '../components/ui';

/**
 * Billing the client.
 *
 * The first screen in this system that earns money rather than
 * spending it. Everything else here answers to the store or the site;
 * this one answers to the client, so it speaks entirely in their
 * terms: their line, their wording, their unit, their rate.
 *
 * The indent is the ceiling on what may be billed. A line agreed at
 * 100 with material in for 60 bills to 60 — work nobody has asked
 * for material for has not been done, and invoicing it is how an RA
 * bill gets thrown back.
 *
 * The agreed quantity is not a second ceiling, and running past it
 * is not treated as a fault. A work order is written before the work
 * is measured — the client is estimating their own requirement, and
 * on this kind of job it goes over. The indent is what reflects what
 * was actually needed, so billing follows the indent. The screen
 * shows the part that runs past the order because somebody will ask,
 * not because anything is wrong.
 *
 * Bills run RA 1, RA 2, RA 3. The running total is held for them, and
 * a quantity cannot be billed twice.
 */

const num = (v) => (v === '' || v == null ? 0 : Number(v) || 0);

const STATUS = {
  DRAFT:     { tone: '',     word: 'Draft' },
  RAISED:    { tone: 'ok',   word: 'Raised' },
  CANCELLED: { tone: 'bad',  word: 'Cancelled' },
};
const BillTag = ({ status }) => {
  const s = STATUS[status] || { tone: '', word: status };
  return <Tag kind={s.tone}>{s.word}</Tag>;
};

/* ===================================================================
   Which site
   =================================================================== */
export function Billing() {
  const { branchId } = useApp();
  const [params, setParams] = useSearchParams();
  const q = params.get('q') || '';
  const client = params.get('client') || '';
  const { data: clients } = useApi(
    branchId ? `/masters/clients?branchId=${branchId}` : null, [branchId]);
  const { data, error, loading, reload } = useApi(
    branchId
      ? `/bills/sites?branchId=${branchId}${client ? `&clientId=${client}` : ''}`
        + `${q ? `&q=${encodeURIComponent(q)}` : ''}`
      : null,
    [branchId, q, client]);
  const rows = data?.rows || [];

  const set = (patch) => setParams((p) => {
    for (const [k, v] of Object.entries(patch)) {
      if (!v) p.delete(k); else p.set(k, v);
    }
    return p;
  }, { replace: true });

  return (
    <>
      <PageHead title="Billing"
        sub="Open a site to bill against its work order"
        actions={<Link className="btn" to="/billing/bills">All bills</Link>} />

      <div className="page-body">
        {error && <ErrorNote error={error} onRetry={reload} />}

        <Card>
          <div className="pad" style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <Field label="Client">
              <select className="inp" style={{ width: 230 }} value={client}
                onChange={(e) => set({ client: e.target.value })}>
                <option value="">Every client</option>
                {(clients || []).map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </Field>
            <Field label="Find a site" hint="By site name or client">
              <input className="inp" style={{ width: 260 }} value={q}
                placeholder="Type either" onChange={(e) => set({ q: e.target.value })} />
            </Field>
          </div>
        </Card>

        {loading || !data ? <Loading /> : (
          <>
            <div className="stats">
              <Stat n={data.totals.sites} label="sites with a work order" />
              <Stat n={money(data.totals.contractValue)} label="contracted" />
              <Stat n={money(data.totals.billedValue)} label="billed" tone="ok" />
              <Stat n={money(data.totals.contractValue - data.totals.billedValue)}
                label="left to bill" tone="warn" />
              <Stat n={data.totals.unbilled} label="never billed"
                tone={data.totals.unbilled ? 'warn' : undefined} />
            </div>

            <Card title={`${rows.length} site${rows.length === 1 ? '' : 's'}`}
              sub="Only sites with a work order can be billed — a bill is raised on the client's own lines">
              <div className="tw">
                <table>
                  <thead>
                    <tr>
                      <th>Site</th><th>Client</th><th>Work order</th>
                      <th className="rt">Contracted</th><th className="rt">Billed</th>
                      <th style={{ width: 130 }}>Progress</th>
                      <th className="rt">Left to bill</th><th>Last bill</th><th />
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.site_id}>
                        <td>
                          <b>{r.name}</b>
                          <div className="mono" style={{ color: 'var(--muted)', fontSize: 11 }}>
                            {r.code}
                          </div>
                        </td>
                        <td>{r.client_name || '—'}</td>
                        <td className="mono" style={{ color: 'var(--brand-ink)' }}>
                          {r.wo_no}
                          {r.client_wo_no && (
                            <div style={{ color: 'var(--muted)', fontSize: 11 }}>
                              {r.client_wo_no}
                            </div>
                          )}
                        </td>
                        <td className="rt mono">{money(r.contract_value)}</td>
                        <td className="rt mono">{money(r.billed_value)}</td>
                        <td>
                          <Meter value={Number(r.billed_value)} max={Number(r.contract_value)} />
                          <div style={{ fontSize: 11, color: 'var(--muted)' }}>
                            {r.billed_pct}%
                          </div>
                        </td>
                        <td className="rt mono"><b>{money(r.to_bill_value)}</b></td>
                        <td>
                          {Number(r.bills)
                            ? <>RA {r.last_ra_no}
                              <div style={{ color: 'var(--muted)', fontSize: 11 }}>
                                {dmy(r.last_billed_on)}
                              </div></>
                            : <Tag kind="warn">never billed</Tag>}
                          {Number(r.drafts) > 0 && <Tag>draft open</Tag>}
                        </td>
                        <td>
                          <Link className="btn sm pri" to={`/billing/site/${r.site_id}`}>
                            Open
                          </Link>
                        </td>
                      </tr>
                    ))}
                    {!rows.length && (
                      <tr><td colSpan={9}>
                        <Empty title="No site here can be billed yet">
                          A site needs a work order before there is anything to bill against.
                        </Empty>
                      </td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </Card>
          </>
        )}
      </div>
    </>
  );
}

/* ===================================================================
   The sheet for one site
   =================================================================== */
export function BillingSheet() {
  const { siteId } = useParams();
  const toast = useToast();
  const [entry, setEntry] = useState({});
  const [head, setHead] = useState({
    billDate: today(), periodFrom: '', periodTo: '', clientRef: '', note: '',
  });
  const [saving, setSaving] = useState(false);
  const [open, setOpen] = useState(null);
  const [tick, setTick] = useState(0);

  const { data, error, loading, reload } = useApi(
    `/bills/sheet/${siteId}`, [siteId, tick]);
  const refresh = () => { setTick((t) => t + 1); };

  // a draft already on this site is what we are editing
  useEffect(() => {
    if (!data) return;
    const seeded = {};
    for (const l of data.lines) {
      if (Number(l.draft_qty) > 0) seeded[l.wo_line_id] = String(l.draft_qty);
    }
    setEntry(seeded);
    if (data.draft) {
      setHead((h) => ({
        ...h,
        billDate: data.draft.bill_date?.slice(0, 10) || h.billDate,
        periodFrom: data.draft.period_from?.slice(0, 10) || '',
        periodTo: data.draft.period_to?.slice(0, 10) || '',
        clientRef: data.draft.client_ref || '',
      }));
    }
  }, [data]);

  if (loading || !data) {
    return (
      <>
        <PageHead title="Billing" />
        <div className="page-body">
          {error ? <ErrorNote error={error} onRetry={reload} /> : <Loading />}
        </div>
      </>
    );
  }

  const lines = data.lines;
  const picked = lines
    .map((l) => ({ line: l, qty: num(entry[l.wo_line_id]) }))
    .filter((x) => x.qty > 0);
  const value = picked.reduce((t, x) => t + x.qty * Number(x.line.rate), 0);
  const over = picked.filter((x) => x.qty > Number(x.line.to_bill_qty) + 0.0005);
  const ready = picked.length > 0 && !over.length && !saving;

  const body = (raise) => ({
    siteId: Number(siteId),
    billDate: head.billDate,
    periodFrom: head.periodFrom || undefined,
    periodTo: head.periodTo || undefined,
    clientRef: head.clientRef.trim() || undefined,
    note: head.note.trim() || undefined,
    lines: picked.map((x) => ({ woLineId: x.line.wo_line_id, qty: x.qty })),
    ...(raise ? { raise: true } : {}),
  });

  const save = async (raise) => {
    setSaving(true);
    try {
      if (data.draft) {
        await api.put(`/bills/${data.draft.bill_id}`, body(false));
        if (raise) await api.post(`/bills/${data.draft.bill_id}/raise`);
        toast(raise ? `${data.draft.doc_no} raised — ${money(value)}` : 'Draft saved', 'ok');
      } else {
        const r = await api.post('/bills', body(raise));
        toast(raise ? `${r.docNo} raised — ${money(r.value)}` : `${r.docNo} saved as a draft`,
          'ok');
      }
      refresh();
    } catch (e) {
      toast(e.message, 'bad');
    } finally {
      setSaving(false);
    }
  };

  const discard = async () => {
    try {
      await api.del(`/bills/${data.draft.bill_id}`);
      toast('Draft deleted', 'ok');
      setEntry({});
      refresh();
    } catch (e) { toast(e.message, 'bad'); }
  };

  const grab = () => downloadCsv(`billing-${data.site.code}`, [
    ['Sno', 'Description', 'Unit', 'BOQ quantity', 'Indented till date',
      'Billed till date', 'Left to bill', 'Not indented for', 'Rate',
      'Billing now', 'Amount'],
    ...lines.map((l) => [
      l.sno, l.description, l.uom, l.boq_qty, l.indented_qty, l.billed_qty,
      l.to_bill_qty, l.unprovisioned_qty, l.rate, num(entry[l.wo_line_id]) || '',
      num(entry[l.wo_line_id]) ? num(entry[l.wo_line_id]) * Number(l.rate) : '',
    ]),
  ]);

  return (
    <>
      <PageHead title={data.site.name}
        sub={`${data.site.client_name || 'No client'} · ${data.workOrder.doc_no}`
          + `${data.workOrder.client_wo_no ? ` · their ${data.workOrder.client_wo_no}` : ''}`}
        actions={
          <div style={{ display: 'flex', gap: 9 }}>
            <button className="btn" onClick={grab}>Download</button>
            <Link className="btn" to="/billing">All sites</Link>
          </div>
        } />

      <div className="page-body">
        <div className="stats">
          <Stat n={money(data.totals.contractValue)} label="contracted" />
          <Stat n={money(data.totals.billedValue)} label="billed to date" tone="ok" />
          <Stat n={money(data.totals.toBillValue)} label="can be billed now" tone="warn" />
          <Stat n={money(data.totals.unprovisionedValue)} label="not indented for yet" />
          <Stat n={`${data.totals.billedPct}%`} label="of the work order" />
        </div>

        {Number(data.totals.overContractValue) > 0 && (
          <Banner kind="info" icon="▸">
            <b>{money(data.totals.overContractValue)}</b> beyond the work order has been
            indented for, and is billable. A work order is written before the work is
            measured, so the real requirement running past it is ordinary — this is here
            to be seen, not to be fixed.
          </Banner>
        )}

        {lines.some((l) => Number(l.over_billed_qty) > 0) && (
          <Banner kind="bad" icon="!">
            Some lines have been billed past what was indented for —{' '}
            {lines.filter((l) => Number(l.over_billed_qty) > 0)
              .map((l) => `line ${l.sno} by ${qty(l.over_billed_qty)} ${l.uom}`).join(', ')}.
            Those bills are already with the client so nothing is undone here, but no more
            can go on those lines until the material is indented for.
          </Banner>
        )}

        {Number(data.totals.unprovisionedValue) > 0 && (
          <Banner kind="info" icon="▸"
            action={<Link className="btn sm" to={`/indents?site=${siteId}`}>Indents</Link>}>
            <b>{money(data.totals.unprovisionedValue)}</b> of this work order has no material
            indented for it, so it cannot be billed yet. Billing stops at whatever material
            has been asked for.
          </Banner>
        )}

        {data.draft && (
          <Banner kind="warn" icon="✎"
            action={<button className="btn sm bad" onClick={discard}>Delete the draft</button>}>
            <b>{data.draft.doc_no}</b> is open as a draft (RA {data.draft.ra_no}). The
            quantities below are its. Nothing is billed until you raise it.
          </Banner>
        )}

        <Card title={`RA ${data.draft ? data.draft.ra_no : data.nextRaNo}`}
          sub="What this bill covers">
          <div className="pad" style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <Field label="Bill date">
              <input className="inp" type="date" style={{ width: 155 }} value={head.billDate}
                onChange={(e) => setHead((h) => ({ ...h, billDate: e.target.value }))} />
            </Field>
            <Field label="Period from">
              <input className="inp" type="date" style={{ width: 155 }} value={head.periodFrom}
                onChange={(e) => setHead((h) => ({ ...h, periodFrom: e.target.value }))} />
            </Field>
            <Field label="Period to">
              <input className="inp" type="date" style={{ width: 155 }} value={head.periodTo}
                onChange={(e) => setHead((h) => ({ ...h, periodTo: e.target.value }))} />
            </Field>
            <Field label="Their reference" hint="Certificate or measurement sheet number">
              <input className="inp" style={{ width: 200 }} value={head.clientRef}
                placeholder="Optional"
                onChange={(e) => setHead((h) => ({ ...h, clientRef: e.target.value }))} />
            </Field>
          </div>
        </Card>

        <Card title="The work order, line by line"
          sub="Quantities are the client's. A line bills up to what material has been indented for — past the agreed quantity too, if the indent went there.">
          <div className="tw">
            <table>
              <thead>
                <tr>
                  <th style={{ width: 50 }}>Sno</th>
                  <th>Description</th>
                  <th style={{ width: 55 }}>Unit</th>
                  <th className="rt" style={{ width: 100 }}>BOQ qty</th>
                  <th className="rt" style={{ width: 110 }}>Indented</th>
                  <th className="rt" style={{ width: 110 }}>Billed</th>
                  <th className="rt" style={{ width: 120 }}>Left to bill</th>
                  <th className="rt" style={{ width: 100 }}>Rate</th>
                  <th className="rt" style={{ width: 125 }}>Billing now</th>
                  <th className="rt" style={{ width: 130 }}>Amount</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l) => {
                  const v = num(entry[l.wo_line_id]);
                  const left = Number(l.to_bill_qty);
                  const bad = v > left + 0.0005;
                  const done = left <= 0.0005;
                  // nothing left to bill means one of two things:
                  // the whole agreed quantity is invoiced, or the
                  // indent has run out
                  const capped = Number(l.indented_qty) < Number(l.boq_qty);
                  const fullyBilled = Number(l.billed_qty) >= Number(l.boq_qty) - 0.0005;
                  const pastWo = Number(l.over_contract_qty) > 0;
                  return (
                    <tr key={l.wo_line_id} style={done ? { opacity: 0.68 } : undefined}>
                      <td className="mono">{l.sno}</td>
                      <td>
                        <b>{l.description}</b>
                        {Number(l.var_qty) !== 0 && (
                          <div style={{ color: 'var(--muted)', fontSize: 11 }}>
                            contracted {qty(l.contracted_qty)}, amended by {qty(l.var_qty)}
                          </div>
                        )}
                      </td>
                      <td>{l.uom}</td>
                      <td className="rt mono">
                        {qty(l.boq_qty)}
                        {pastWo && (
                          <div style={{ color: 'var(--muted)', fontSize: 11 }}>
                            +{qty(l.over_contract_qty)} indented
                          </div>
                        )}
                      </td>
                      <td className="rt mono"
                        title="Material indented for, in the client's units. This is the ceiling on what may be billed.">
                        {Number(l.indented_qty) > 0
                          ? <b style={capped ? { color: 'var(--warn)' } : undefined}>
                            {qty(l.indented_qty)}</b>
                          : <span style={{ color: 'var(--muted)' }}>—</span>}
                      </td>
                      <td className="rt mono">
                        {qty(l.billed_qty)}
                        {Number(l.over_billed_qty) > 0 && (
                          <div style={{ color: 'var(--bad)', fontSize: 11 }}>
                            {qty(l.over_billed_qty)} past the indent
                          </div>
                        )}
                      </td>
                      <td className="rt mono">
                        {done
                          ? (fullyBilled
                            ? <Tag kind="ok">done</Tag>
                            : <Tag kind="warn">indent more</Tag>)
                          : <b>{qty(left)}</b>}
                      </td>
                      <td className="rt mono">{money(l.rate)}</td>
                      <td>
                        <input className="inp rt mono" type="number" min="0" step="0.001"
                          value={entry[l.wo_line_id] ?? ''}
                          disabled={done}
                          placeholder={done ? '' : '0'}
                          style={bad ? { borderColor: 'var(--bad)', color: 'var(--bad)' } : undefined}
                          onChange={(e) => setEntry((x) => ({
                            ...x, [l.wo_line_id]: e.target.value,
                          }))} />
                      </td>
                      <td className="rt mono">
                        {v > 0 ? <b>{money(v * Number(l.rate))}</b>
                          : <span style={{ color: 'var(--muted)' }}>—</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={8} className="rt"><b>This bill</b></td>
                  <td className="rt mono">
                    {picked.length} line{picked.length === 1 ? '' : 's'}
                  </td>
                  <td className="rt mono"><b style={{ fontSize: 16 }}>{money(value)}</b></td>
                </tr>
              </tfoot>
            </table>
          </div>
        </Card>

        {over.length > 0 && (
          <Banner kind="bad" icon="!">
            {over.map((x) => (
              <div key={x.line.wo_line_id}>
                Line {x.line.sno} — only {qty(x.line.to_bill_qty)} {x.line.uom} can be
                billed. Material has been indented for {qty(x.line.indented_qty)}
                {' '}and {qty(x.line.billed_qty)} is already billed; indent the rest
                before invoicing it.
              </div>
            ))}
          </Banner>
        )}

        <Card>
          <div className="pad" style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <div>
              <div style={{ fontSize: 22, fontWeight: 700 }}>{money(value)}</div>
              <div style={{ color: 'var(--muted)', fontSize: 12 }}>
                at the rates on {data.workOrder.doc_no}. Raising it makes this revenue —
                a draft is not.
              </div>
            </div>
            <div className="sp" />
            <button className="btn" disabled={!picked.length || saving}
              onClick={() => save(false)}>
              {data.draft ? 'Save the draft' : 'Save as draft'}
            </button>
            <button className="btn pri" disabled={!ready} onClick={() => save(true)}>
              {saving ? 'Raising…' : `Raise RA ${data.draft ? data.draft.ra_no : data.nextRaNo}`}
            </button>
          </div>
        </Card>

        <Card title="Bills on this site" sub="Newest first">
          <div className="tw">
            <table>
              <thead>
                <tr>
                  <th>RA</th><th>Document</th><th>Date</th><th>Period</th>
                  <th>Their reference</th><th className="rt">Lines</th>
                  <th className="rt">Value</th><th>Status</th>
                </tr>
              </thead>
              <tbody>
                {data.bills.map((b) => (
                  <tr key={b.bill_id} style={{ cursor: 'pointer' }}
                    onClick={() => setOpen(b.bill_id)}>
                    <td><b>RA {b.ra_no}</b></td>
                    <td className="mono" style={{ color: 'var(--brand-ink)' }}>{b.doc_no}</td>
                    <td>{dmy(b.bill_date)}</td>
                    <td style={{ color: 'var(--muted)' }}>
                      {b.period_from ? `${dmy(b.period_from)} – ${dmy(b.period_to)}` : '—'}
                    </td>
                    <td className="mono">{b.client_ref || '—'}</td>
                    <td className="rt mono">{b.line_count}</td>
                    <td className="rt mono"><b>{money(b.bill_value)}</b></td>
                    <td><BillTag status={b.status} /></td>
                  </tr>
                ))}
                {!data.bills.length && (
                  <tr><td colSpan={8}>
                    <Empty title="This site has never been billed">
                      Put quantities against the lines above and raise RA 1.
                    </Empty>
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      {open && <BillCard id={open} onClose={() => setOpen(null)} onChanged={refresh} />}
    </>
  );
}

/* ===================================================================
   One bill
   =================================================================== */
export function BillCard({ id, onClose, onChanged }) {
  const toast = useToast();
  const { data, loading, reload } = useApi(`/bills/${id}`, [id]);
  const [cancelling, setCancelling] = useState(false);
  const [why, setWhy] = useState('');
  if (loading || !data) return <Modal title="Bill" onClose={onClose}><Loading /></Modal>;
  const { head, lines, canRaise, canCancel } = data;

  const act = async (fn, word) => {
    try { await fn(); toast(`${head.doc_no} ${word}`, 'ok'); reload(); onChanged?.(); }
    catch (e) { toast(e.message, 'bad'); }
  };

  const grab = () => downloadCsv(`${head.doc_no.replace(/\//g, '-')}`, [
    [head.doc_no, `RA ${head.ra_no}`],
    ['Site', head.site_name], ['Client', head.client_name || ''],
    ['Work order', head.wo_no], ['Their reference', head.client_ref || ''],
    ['Bill date', dmy(head.bill_date)],
    ...(head.period_from ? [['Period', `${dmy(head.period_from)} to ${dmy(head.period_to)}`]] : []),
    [],
    ['Sno', 'Description', 'Unit', 'BOQ qty', 'Billed before', 'This bill', 'To date',
      'Supply rate', 'Installation rate', 'Amount'],
    ...lines.map((l) => [
      l.sno, l.description, l.uom, l.boq_qty, l.previous_qty, l.qty, l.to_date_qty,
      l.supply_rate, l.inst_rate, l.line_total,
    ]),
    [],
    ['', '', '', '', '', '', '', '', 'Supply', head.supply_value],
    ['', '', '', '', '', '', '', '', 'Installation', head.inst_value],
    ['', '', '', '', '', '', '', '', 'TOTAL', head.bill_value],
  ]);

  return (
    <>
      <Modal full title={`${head.doc_no} — RA ${head.ra_no}`}
        sub={`${head.site_name} · ${head.client_name || 'no client'} · ${dmy(head.bill_date)}`}
        onClose={onClose}
        actions={<BillTag status={head.status} />}
        footer={
          <>
            <button className="btn" onClick={grab}>Download</button>
            {canCancel && (
              <button className="btn bad" onClick={() => setCancelling(true)}>Cancel it</button>
            )}
            {canRaise && (
              <button className="btn pri"
                onClick={() => act(() => api.post(`/bills/${head.bill_id}/raise`), 'raised')}>
                Raise it
              </button>
            )}
          </>
        }>
        <div className="stats">
          <Stat n={money(head.supply_value)} label="supply" />
          <Stat n={money(head.inst_value)} label="installation" />
          <Stat n={money(head.bill_value)} label="bill value" tone="brand" />
          <Stat n={head.line_count} label="lines" />
        </div>

        {head.status === 'DRAFT' && (
          <Banner kind="warn" icon="✎">
            This is a draft. It is not revenue and does not hold any quantity — another
            bill could take the same work first.
          </Banner>
        )}
        {head.status === 'CANCELLED' && (
          <Banner kind="bad" icon="!">
            Cancelled{head.note ? ` — ${head.note}` : ''}. What it billed is free to be
            billed again.
          </Banner>
        )}

        <div className="tw">
          <table>
            <thead>
              <tr>
                <th style={{ width: 50 }}>Sno</th><th>Description</th>
                <th style={{ width: 55 }}>Unit</th>
                <th className="rt">BOQ qty</th><th className="rt">Up to last bill</th>
                <th className="rt">This bill</th><th className="rt">To date</th>
                <th className="rt">Rate</th><th className="rt">Amount</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => (
                <tr key={l.line_id}>
                  <td className="mono">{l.sno}</td>
                  <td><b>{l.description}</b></td>
                  <td>{l.uom}</td>
                  <td className="rt mono">{qty(l.boq_qty)}</td>
                  <td className="rt mono" style={{ color: 'var(--muted)' }}>
                    {qty(l.previous_qty)}
                  </td>
                  <td className="rt mono"><b>{qty(l.qty)}</b></td>
                  <td className="rt mono">{qty(l.to_date_qty)}</td>
                  <td className="rt mono">{money(l.rate)}</td>
                  <td className="rt mono"><b>{money(l.line_total)}</b></td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={8} className="rt"><b>Total</b></td>
                <td className="rt mono"><b style={{ fontSize: 16 }}>{money(head.bill_value)}</b></td>
              </tr>
            </tfoot>
          </table>
        </div>

        <p style={{ color: 'var(--muted)', fontSize: 12 }}>
          Rates are the ones on {head.wo_no}, stamped when the bill was made, so a later
          correction upstream cannot reprice what is already with the client.
          {head.raised_by_name && ` Raised by ${head.raised_by_name}.`}
        </p>
      </Modal>

      {cancelling && (
        <Modal title={`Cancel ${head.doc_no}?`}
          sub="The number stays used and the trail stays readable. What it billed becomes free to bill again."
          onClose={() => setCancelling(false)}
          footer={
            <button className="btn bad" disabled={why.trim().length < 3}
              onClick={() => { setCancelling(false);
                act(() => api.post(`/bills/${head.bill_id}/cancel`, { note: why.trim() }),
                  'cancelled'); }}>
              Cancel this bill
            </button>
          }>
          <Field label="Why" hint="Required — the client will ask">
            <input className="inp" value={why} autoFocus placeholder="Measurement disputed"
              onChange={(e) => setWhy(e.target.value)} />
          </Field>
        </Modal>
      )}
    </>
  );
}

/* ===================================================================
   Every bill
   =================================================================== */
export function Bills() {
  const { branchId } = useApp();
  const [params, setParams] = useSearchParams();
  const [open, setOpen] = useState(null);
  const [tick, setTick] = useState(0);
  const status = params.get('status') || 'ALL';
  const q = params.get('q') || '';
  const client = params.get('client') || '';
  const { data: clients } = useApi(
    branchId ? `/masters/clients?branchId=${branchId}` : null, [branchId]);

  const qs = new URLSearchParams({
    ...(branchId ? { branchId } : {}), status,
    ...(client ? { clientId: client } : {}),
    ...(q ? { q } : {}),
  }).toString();
  const { data, error, loading, reload } = useApi(
    branchId ? `/bills?${qs}` : null, [qs, tick]);
  const rows = data?.rows || [];

  const set = (patch) => setParams((p) => {
    for (const [k, v] of Object.entries(patch)) {
      if (!v || v === 'ALL') p.delete(k); else p.set(k, v);
    }
    return p;
  }, { replace: true });

  return (
    <>
      <PageHead title="Bills" sub="Every running account bill in this branch"
        actions={<Link className="btn pri" to="/billing">Bill a site</Link>} />

      <div className="page-body">
        {error && <ErrorNote error={error} onRetry={reload} />}

        <Card>
          <div className="pad" style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <Field label="Status">
              <select className="inp" style={{ width: 160 }} value={status}
                onChange={(e) => set({ status: e.target.value })}>
                <option value="ALL">Everything</option>
                <option value="RAISED">Raised</option>
                <option value="DRAFT">Drafts</option>
                <option value="CANCELLED">Cancelled</option>
              </select>
            </Field>
            <Field label="Client">
              <select className="inp" style={{ width: 220 }} value={client}
                onChange={(e) => set({ client: e.target.value })}>
                <option value="">Every client</option>
                {(clients || []).map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </Field>
            <Field label="Find" hint="Bill number, site, client or their reference">
              <input className="inp" style={{ width: 250 }} value={q}
                placeholder="Type any of them"
                onChange={(e) => set({ q: e.target.value })} />
            </Field>
          </div>
        </Card>

        {loading || !data ? <Loading /> : (
          <>
            <div className="stats">
              <Stat n={data.totals.raised} label="raised" />
              <Stat n={money(data.totals.value)} label="billed" tone="ok" />
              <Stat n={data.totals.drafts} label="drafts"
                tone={data.totals.drafts ? 'warn' : undefined} />
            </div>

            <Card title={`${rows.length} bill${rows.length === 1 ? '' : 's'}`}>
              <div className="tw">
                <table>
                  <thead>
                    <tr>
                      <th>Document</th><th>RA</th><th>Site</th><th>Client</th>
                      <th>Date</th><th className="rt">Lines</th>
                      <th className="rt">Value</th><th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((b) => (
                      <tr key={b.bill_id} style={{ cursor: 'pointer' }}
                        onClick={() => setOpen(b.bill_id)}>
                        <td className="mono" style={{ color: 'var(--brand-ink)' }}>{b.doc_no}</td>
                        <td>RA {b.ra_no}</td>
                        <td>{b.site_name}</td>
                        <td style={{ color: 'var(--muted)' }}>{b.client_name || '—'}</td>
                        <td>{dmy(b.bill_date)}</td>
                        <td className="rt mono">{b.line_count}</td>
                        <td className="rt mono"><b>{money(b.bill_value)}</b></td>
                        <td><BillTag status={b.status} /></td>
                      </tr>
                    ))}
                    {!rows.length && (
                      <tr><td colSpan={8}>
                        <Empty title="No bills yet">
                          Open a site and raise RA 1.
                        </Empty>
                      </td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </Card>
          </>
        )}
      </div>

      {open && (
        <BillCard id={open} onClose={() => setOpen(null)}
          onChanged={() => setTick((t) => t + 1)} />
      )}
    </>
  );
}
