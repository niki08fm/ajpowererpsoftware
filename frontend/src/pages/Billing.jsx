import { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useApp, PageHead } from '../App';
import { api, qty, money, dmy, today, withBranch, canWrite, plural } from '../api';
import { downloadCsv } from '../download';
import {
  useApi, useToast, Card, Empty, Loading, ErrorNote, Banner, Field, Modal, Stat, Meter, Code, Status,
  DateField, NextStep,
} from '../components/ui';
import { Icon } from '../components/icons';
import { billStatus, withWhom } from '../vocab';

/**
 * Billing the client.
 *
 * The first screen in this system that earns money rather than
 * spending it. Everything else here answers to the store or the site;
 * this one answers to the client, so it speaks entirely in their
 * terms: their line, their wording, their unit, their rate.
 *
 * What PRNs have asked for is the ceiling on what may be billed. A
 * line agreed at 100 with material requested for 60 bills to 60 — work
 * nobody has asked for material for has not been done, and invoicing it
 * is how an RA bill gets thrown back.
 *
 * The agreed quantity is not a second ceiling, and running past it
 * is not treated as a fault. A work order is written before the work
 * is measured — the client is estimating their own requirement, and
 * on this kind of job it goes over. The PRNs are what reflect what was
 * actually needed, so billing follows them.
 *
 * "Raise" used to mean two things here: the button that sends a bill
 * for its two approvals, and the status once they are done. The button
 * now says what it does — send for approval — and only the approved
 * bill is Raised. The screen
 * shows the part that runs past the order because somebody will ask,
 * not because anything is wrong.
 *
 * Bills run RA 1, RA 2, RA 3. The running total is held for them, and
 * a quantity cannot be billed twice.
 */

const num = (v) => (v === '' || v == null ? 0 : Number(v) || 0);

const BillTag = ({ status }) => <Status is={billStatus(status)} />;

/* ===================================================================
   Bill a site: which one
   =================================================================== */
export function Billing() {
  const { branchId } = useApp();
  const [params, setParams] = useSearchParams();
  const q = params.get('q') || '';
  const client = params.get('client') || '';
  const { data: clients } = useApi(
    withBranch('/masters/clients', branchId), [branchId]);
  const { data, error, loading, reload } = useApi(
    `/bills/sites?${new URLSearchParams({
      ...(branchId ? { branchId } : {}),
      ...(client ? { clientId: client } : {}),
      ...(q ? { q } : {}),
    })}`,
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
      <PageHead title="Bill a site"
        sub="Choose a site to bill against its work order, at the rates the client agreed"
        actions={<Link className="btn" to="/billing/bills">RA bills</Link>} />

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
            <Field label="Find a site">
              <input className="inp" type="search" style={{ width: 260 }} value={q}
                placeholder="Site or client name…" onChange={(e) => set({ q: e.target.value })} />
            </Field>
          </div>
        </Card>

        {loading && !data ? <Loading what="sites" /> : data && (
          <>
            <div className="stats" style={{ margin: '16px 0' }}>
              <Stat n={data.totals.sites} label="sites with a work order" one="site with a work order" />
              <Stat n={money(data.totals.contractValue)} label="contracted" />
              <Stat n={money(data.totals.billedValue)} label="billed" />
              <Stat n={money(data.totals.contractValue - data.totals.billedValue)}
                label="left to bill" />
              <Stat n={data.totals.unbilled} label="sites never billed" one="site never billed" />
            </div>

            <Card title={plural(rows.length, 'site')}
              sub="Only sites with a work order can be billed — a bill uses the client's own lines">
              <div className="tw">
                <table>
                  <thead>
                    <tr>
                      <th>Site</th><th>Client</th><th>Work order</th>
                      <th className="rt">Contracted</th><th className="rt">Billed</th>
                      <th style={{ width: 130 }}>Billed so far</th>
                      <th className="rt">Left to bill</th><th>Last RA bill</th><th />
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.site_id}>
                        <td>
                          <b>{r.name}</b>
                          <small><Code>{r.code}</Code></small>
                        </td>
                        <td>{r.client_name || '—'}</td>
                        <td>
                          <Code>{r.wo_no}</Code>
                          {r.client_wo_no && <small>Client's: <Code>{r.client_wo_no}</Code></small>}
                        </td>
                        <td className="rt mono">{money(r.contract_value)}</td>
                        <td className="rt mono">{money(r.billed_value)}</td>
                        <td>
                          <Meter value={Number(r.billed_value)} max={Number(r.contract_value)} label="Billed so far" />
                          <small className="mono">{r.billed_pct}% of the work order</small>
                        </td>
                        <td className="rt mono"><b>{money(r.to_bill_value)}</b></td>
                        <td>
                          {Number(r.bills)
                            ? <>RA {r.last_ra_no}<small>{dmy(r.last_billed_on)}</small></>
                            : <Status tone="neutral" label="Never billed" />}
                          {Number(r.drafts) > 0 && <small><Status tone="neutral" icon="draft" label="Draft open" /></small>}
                        </td>
                        <td>
                          <Link className="btn sm pri" to={`/billing/site/${r.site_id}`}>
                            Open bill sheet
                          </Link>
                        </td>
                      </tr>
                    ))}
                    {!rows.length && (
                      <tr><td colSpan={9}>
                        <Empty title="No site can be billed yet">
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
        <PageHead title="Bill a site" />
        <div className="page-body">
          {error ? <ErrorNote error={error} onRetry={reload} /> : <Loading what="the bill sheet" />}
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
        let m = null;
        if (raise) m = await api.post(`/bills/${data.draft.bill_id}/raise`);
        toast(raise ? (m?.message || `${data.draft.doc_no} sent for approval — ${money(value)}`) : 'Draft saved', 'ok');
      } else {
        const r = await api.post('/bills', body(raise));
        toast(raise ? `${r.docNo} sent for approval — ${money(r.value)}. It becomes revenue once both approvals are done.`
          : `${r.docNo} saved as a draft`, 'ok');
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
    ['Sl no', 'Description', 'Unit', 'BOQ quantity', 'Requested on PRNs to date',
      'Billed to date', 'Left to bill', 'Not yet requested on a PRN', 'Rate',
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
        sub={`${data.site.client_name || 'No client'} · work order ${data.workOrder.doc_no}`
          + `${data.workOrder.client_wo_no ? ` (client's ${data.workOrder.client_wo_no})` : ''}`}
        actions={
          <>
            <button className="btn" onClick={grab}><Icon name="download" size={14} />Download</button>
            <Link className="btn" to="/billing">All sites</Link>
          </>
        } />

      <div className="page-body">
        <Card className="pad">
          <div className="stats">
            <Stat n={money(data.totals.contractValue)} label="contracted" />
            <Stat n={money(data.totals.billedValue)} label="billed to date" />
            <Stat n={money(data.totals.toBillValue)} label="can be billed now" />
            <Stat n={money(data.totals.unprovisionedValue)} label="not yet requested on a PRN" />
            <Stat n={`${data.totals.billedPct}%`} label="of the work order billed" />
          </div>
        </Card>
        <div style={{ height: 16 }} />

        {Number(data.totals.overContractValue) > 0 && (
          <Banner kind="info">
            <b>{money(data.totals.overContractValue)}</b> beyond the work order has been
            requested on PRNs, and is billable. A work order is written before the work is
            measured, so the real requirement running past it is ordinary — this is shown
            so it can be seen, not because anything is wrong.
          </Banner>
        )}

        {lines.some((l) => Number(l.over_billed_qty) > 0) && (
          <Banner kind="bad">
            Some lines have been billed past what PRNs asked for —{' '}
            {lines.filter((l) => Number(l.over_billed_qty) > 0)
              .map((l) => `line ${l.sno} by ${qty(l.over_billed_qty)} ${l.uom}`).join(', ')}.
            Those bills are already with the client so nothing is undone here, but no more
            can go on those lines until the site requests the material on a PRN.
          </Banner>
        )}

        {Number(data.totals.unprovisionedValue) > 0 && (
          <Banner kind="info">
            <b>{money(data.totals.unprovisionedValue)}</b> of this work order has no material
            requested on a PRN yet, so it cannot be billed yet. Billing stops at whatever
            material the site's PRNs have asked for.
          </Banner>
        )}

        {data.draft && (
          <Banner kind="info" icon="draft"
            action={<button className="btn sm bad" onClick={discard}>Delete draft</button>}>
            <Code as="b">{data.draft.doc_no}</Code> is open as a draft (RA {data.draft.ra_no}). The
            quantities below are its. Nothing is billed until it is sent for approval and approved.
          </Banner>
        )}

        <Card title={`RA ${data.draft ? data.draft.ra_no : data.nextRaNo}`}
          sub="What this bill covers">
          <div className="pad searchbar" style={{ marginBottom: 0 }}>
            <DateField label="Bill date" value={head.billDate}
              onChange={(e) => setHead((h) => ({ ...h, billDate: e.target.value }))} />
            <DateField label="Period from" value={head.periodFrom}
              onChange={(e) => setHead((h) => ({ ...h, periodFrom: e.target.value }))} />
            <DateField label="Period to" value={head.periodTo} min={head.periodFrom || undefined}
              onChange={(e) => setHead((h) => ({ ...h, periodTo: e.target.value }))} />
            <Field label="Client's reference" hint="Certificate or measurement sheet number">
              <input className="inp" style={{ width: 200 }} value={head.clientRef}
                placeholder="Optional"
                onChange={(e) => setHead((h) => ({ ...h, clientRef: e.target.value }))} />
            </Field>
          </div>
        </Card>

        <Card title="The work order, line by line"
          sub="Quantities are the client's. A line bills up to what the site's PRNs have asked for — past the agreed quantity too, if the PRNs went there.">
          <div className="tw">
            <table>
              <thead>
                <tr>
                  <th style={{ width: 56 }}>Sl no</th>
                  <th>Description</th>
                  <th style={{ width: 55 }}>Unit</th>
                  <th className="rt" style={{ width: 100 }}>BOQ qty</th>
                  <th className="rt" style={{ width: 120 }}>Requested on PRNs</th>
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
                  // the whole agreed quantity is invoiced, or what
                  // the PRNs asked for has run out
                  const capped = Number(l.indented_qty) < Number(l.boq_qty);
                  const fullyBilled = Number(l.billed_qty) >= Number(l.boq_qty) - 0.0005;
                  const pastWo = Number(l.over_contract_qty) > 0;
                  return (
                    <tr key={l.wo_line_id} style={done ? { opacity: 0.68 } : undefined}>
                      <td className="mono">{l.sno}</td>
                      <td>
                        <b>{l.description}</b>
                        {Number(l.var_qty) !== 0 && (
                          <small>Contracted {qty(l.contracted_qty)}, amended by {qty(l.var_qty)}</small>
                        )}
                      </td>
                      <td>{l.uom}</td>
                      <td className="rt mono">
                        {qty(l.boq_qty)}
                        {pastWo && (
                          <small>+{qty(l.over_contract_qty)} requested on PRNs</small>
                        )}
                      </td>
                      <td className="rt mono"
                        title="Material requested on PRNs, in the client's units. This is the ceiling on what may be billed.">
                        {Number(l.indented_qty) > 0
                          ? <b>{qty(l.indented_qty)}{capped && <small style={{ fontWeight: 500 }}>Less than the BOQ</small>}</b>
                          : <span style={{ color: 'var(--muted)' }}>—</span>}
                      </td>
                      <td className="rt mono">
                        {qty(l.billed_qty)}
                        {Number(l.over_billed_qty) > 0 && (
                          <small style={{ color: 'var(--st-stop)', fontWeight: 600 }}>
                            {qty(l.over_billed_qty)} past what PRNs asked for
                          </small>
                        )}
                      </td>
                      <td className="rt mono">
                        {done
                          ? (fullyBilled
                            ? <Status tone="done" label="Billed in full" />
                            : <Status tone="attention" label="Needs a PRN" hint="Nothing more can be billed until the site requests more material on a PRN" />)
                          : <b>{qty(left)}</b>}
                      </td>
                      <td className="rt mono">{money(l.rate)}</td>
                      <td>
                        <input className="inp rt mono" type="number" min="0" step="0.001" inputMode="decimal"
                          value={entry[l.wo_line_id] ?? ''}
                          disabled={done}
                          placeholder={done ? '' : '0'}
                          aria-label={`Quantity to bill on line ${l.sno}`} aria-invalid={bad || undefined}
                          style={bad ? { borderColor: 'var(--st-stop)', color: 'var(--st-stop)' } : undefined}
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
                    {plural(picked.length, 'line')}
                  </td>
                  <td className="rt mono"><b style={{ fontSize: 16 }}>{money(value)}</b></td>
                </tr>
              </tfoot>
            </table>
          </div>
        </Card>

        {over.length > 0 && (
          <Banner kind="bad">
            {over.map((x) => (
              <div key={x.line.wo_line_id}>
                Line {x.line.sno} — only {qty(x.line.to_bill_qty)} {x.line.uom} can be
                billed. PRNs have asked for {qty(x.line.indented_qty)}
                {' '}and {qty(x.line.billed_qty)} is already billed; the site has to request the rest
                on a PRN before it can be billed.
              </div>
            ))}
          </Banner>
        )}

        <Card>
          <div className="pad" style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <div>
              <div style={{ fontSize: 20, fontWeight: 600 }} className="mono">{money(value)}</div>
              <div style={{ color: 'var(--muted)', fontSize: 12.5 }}>
                at the rates on {data.workOrder.doc_no}. It goes to the site's GM and then Management
                for approval, and becomes revenue only once both approve.
              </div>
            </div>
            <div className="sp" />
            {!picked.length && <span className="why-not"><Icon name="info" size={14} />Type a quantity to bill</span>}
            <button className="btn" disabled={!picked.length || saving}
              onClick={() => save(false)}>
              Save as draft
            </button>
            <button className="btn pri" disabled={!ready} onClick={() => save(true)}>
              <Icon name="send" />{saving ? 'Sending…' : `Send RA ${data.draft ? data.draft.ra_no : data.nextRaNo} for approval`}
            </button>
          </div>
        </Card>

        <Card title="RA bills for this site" sub="Newest first">
          <div className="tw">
            <table>
              <thead>
                <tr>
                  <th>RA</th><th>Bill number</th><th>Bill date</th><th>Period</th>
                  <th>Client's reference</th><th className="rt">Lines</th>
                  <th className="rt">Value</th><th>Status</th>
                </tr>
              </thead>
              <tbody>
                {data.bills.map((b) => (
                  <tr key={b.bill_id} className="click" tabIndex={0}
                    onClick={() => setOpen(b.bill_id)}
                    onKeyDown={(e) => { if (e.key === 'Enter') setOpen(b.bill_id); }}>
                    <td><b>RA {b.ra_no}</b></td>
                    <td><Code>{b.doc_no}</Code></td>
                    <td className="mono">{dmy(b.bill_date)}</td>
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
                      Type quantities against the lines above and send RA 1 for approval.
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
  if (loading || !data) return <Modal title="RA bill" onClose={onClose}><Loading what="the bill" /></Modal>;
  const { head, lines, canRaise, canCancel } = data;
  const w = withWhom(data.approval);

  const act = async (fn, word) => {
    try { await fn(); toast(`${head.doc_no} ${word}`, 'ok'); reload(); onChanged?.(); }
    catch (e) { toast(e.message, 'bad'); }
  };

  const grab = () => downloadCsv(`${head.doc_no.replace(/\//g, '-')}`, [
    [head.doc_no, `RA ${head.ra_no}`],
    ['Site', head.site_name], ['Client', head.client_name || ''],
    ['Work order', head.wo_no], ["Client's reference", head.client_ref || ''],
    ['Bill date', dmy(head.bill_date)],
    ...(head.period_from ? [['Period', `${dmy(head.period_from)} to ${dmy(head.period_to)}`]] : []),
    [],
    ['Sl no', 'Description', 'Unit', 'BOQ qty', 'Billed before', 'This bill', 'To date',
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
            <button className="btn" onClick={grab}><Icon name="download" size={14} />Download</button>
            {canCancel && canWrite('/bills') && (
              <button className="btn bad" onClick={() => setCancelling(true)}>Cancel bill</button>
            )}
            {canRaise && canWrite('/bills') && (
              <button className="btn pri"
                onClick={() => act(() => api.post(`/bills/${head.bill_id}/raise`), 'sent for approval')}>
                <Icon name="send" />Send for approval
              </button>
            )}
          </>
        }>
        <div className="stats">
          <Stat n={money(head.supply_value)} label="supply" />
          <Stat n={money(head.inst_value)} label="installation" />
          <Stat n={money(head.bill_value)} label="bill value" />
          <Stat n={head.line_count} label="lines" one="line" />
        </div>

        {head.status === 'DRAFT' && (
          <NextStep tone="neutral" icon="draft" now="Draft — not sent for approval"
            then="It is not revenue and holds no quantity — another bill could take the same work first." />
        )}
        {head.status === 'SUBMITTED' && (
          <NextStep tone="info" icon="clock"
            now={`With ${w?.who || 'the site GM'} for approval${w ? ` · level ${w.level} of ${w.levels}` : ''}`}
            then="The site's GM approves first, then Management. It goes to the client after both, and is not revenue until then." />
        )}
        {head.status === 'CANCELLED' && (
          <Banner kind="bad">
            Cancelled{head.note ? ` — ${head.note}` : ''}. What it billed is free to be
            billed again.
          </Banner>
        )}

        <div className="tw">
          <table>
            <thead>
              <tr>
                <th style={{ width: 56 }}>Sl no</th><th>Description</th>
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
          {head.raised_by_name && ` Prepared by ${head.raised_by_name}.`}
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
              Cancel bill
            </button>
          }>
          <Field label="Reason" hint="Required — the client will ask">
            <input className="inp" value={why} autoFocus placeholder="e.g. Measurement disputed"
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
    withBranch('/masters/clients', branchId), [branchId]);

  const qs = new URLSearchParams({
    ...(branchId ? { branchId } : {}), status,
    ...(client ? { clientId: client } : {}),
    ...(q ? { q } : {}),
  }).toString();
  const { data, error, loading, reload } = useApi(
    `/bills?${qs}`, [qs, tick]);
  const rows = data?.rows || [];

  const set = (patch) => setParams((p) => {
    for (const [k, v] of Object.entries(patch)) {
      if (!v || v === 'ALL') p.delete(k); else p.set(k, v);
    }
    return p;
  }, { replace: true });

  return (
    <>
      <PageHead title="RA bills" sub="Every running account bill, numbered RA 1, RA 2, RA 3 for each site"
        actions={canWrite('/bills') && <Link className="btn pri" to="/billing"><Icon name="plus" />Bill a site</Link>} />

      <div className="page-body">
        {error && <ErrorNote error={error} onRetry={reload} />}

        <Card>
          <div className="pad" style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <Field label="Status">
              <select className="inp" style={{ width: 160 }} value={status}
                onChange={(e) => set({ status: e.target.value })}>
                <option value="ALL">Everything</option>
                <option value="RAISED">{billStatus('RAISED').label}</option>
                <option value="SUBMITTED">{billStatus('SUBMITTED').label}</option>
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
            <Field label="Find">
              <input className="inp" type="search" style={{ width: 260 }} value={q}
                placeholder="Bill number, site, client, reference…"
                onChange={(e) => set({ q: e.target.value })} />
            </Field>
          </div>
        </Card>

        {loading && !data ? <Loading what="RA bills" /> : data && (
          <>
            <div className="stats" style={{ margin: '16px 0' }}>
              <Stat n={data.totals.raised} label="raised" />
              <Stat n={money(data.totals.value)} label="billed (raised bills)" />
              <Stat n={data.totals.drafts} label="drafts" one="draft" />
            </div>

            <Card title={plural(rows.length, 'RA bill')}>
              <div className="tw">
                <table>
                  <thead>
                    <tr>
                      <th>Bill number</th><th>RA</th><th>Site</th><th>Client</th>
                      <th>Bill date</th><th className="rt">Lines</th>
                      <th className="rt">Value</th><th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((b) => (
                      <tr key={b.bill_id} className="click" tabIndex={0}
                        onClick={() => setOpen(b.bill_id)}
                        onKeyDown={(e) => { if (e.key === 'Enter') setOpen(b.bill_id); }}>
                        <td><Code as="b">{b.doc_no}</Code></td>
                        <td>RA {b.ra_no}</td>
                        <td>{b.site_name}</td>
                        <td style={{ color: 'var(--muted)' }}>{b.client_name || '—'}</td>
                        <td className="mono">{dmy(b.bill_date)}</td>
                        <td className="rt mono">{b.line_count}</td>
                        <td className="rt mono"><b>{money(b.bill_value)}</b></td>
                        <td><BillTag status={b.status} /></td>
                      </tr>
                    ))}
                    {!rows.length && (
                      <tr><td colSpan={8}>
                        <Empty title="No RA bills yet">
                          Open a site under Bill a site and send RA 1 for approval.
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
