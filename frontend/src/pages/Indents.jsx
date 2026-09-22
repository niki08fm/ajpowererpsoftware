import { Fragment, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useApp, PageHead } from '../App';
import { api, qty, dmy, today, addDays, withBranch } from '../api';
import { downloadCsv } from '../download';
import {
  useApi, Card, Tag, Empty, Loading, ErrorNote, Banner, Field, Stat, useToast,
} from '../components/ui';

/** amber inside an agreed ceiling, red where none was agreed */
export const SeverityTag = ({ severity, pct, count }) => {
  if (severity === 'none' || !count) return <Tag kind="ok">✓ within estimate</Tag>;
  return (
    <Tag kind={severity === 'bad' ? 'bad' : 'warn'}>
      {severity === 'bad' ? '▲' : '⚠'} {Number(pct || 0).toFixed(1)}% past the estimate
    </Tag>
  );
};

/* =================================================================== */
export function Indents() {
  const { branchId, siteId: chosenSite } = useApp();
  const nav = useNavigate();
  const { data, error, loading, reload } = useApi(
    withBranch('/indents', branchId), [branchId]);

  const row = (i) => (
    <tr key={i.id} className="click" onClick={() => nav(`/indents/${i.id}`)}>
      <td><b>{i.doc_no}</b><small>{i.raised_by_name}</small></td>
      <td>{i.site_name}</td>
      <td className="mono">{dmy(i.indent_date)}<small>{i.needed_by ? `needed ${dmy(i.needed_by)}` : ''}</small></td>
      <td className="rt mono">{i.line_count}</td>
      <td><SeverityTag severity={i.severity} count={i.over_lines} pct={0} /></td>
      <td>
        {i.status === 'DRAFT' ? <Tag kind="warn">Draft</Tag>
          : i.status === 'APPROVED' ? <Tag kind="ok">Approved</Tag>
            : i.status === 'RETURNED' ? <Tag kind="bad">Returned</Tag>
              : <Tag>Waiting</Tag>}
      </td>
    </tr>
  );

  const head = (
    <thead><tr>
      <th>Indent</th><th>Site</th><th>Date</th><th className="rt">Lines</th>
      <th>Against estimate</th><th>Status</th>
    </tr></thead>
  );

  return (
    <>
      <PageHead title="Indents" sub="What the site needs, measured against its BOQ"
        actions={<Link className="btn pri" to="/indents/new">Raise indent</Link>} />
      <div className="page-body">
        {error && <ErrorNote error={error} onRetry={reload} />}
        <Banner kind="info" icon="↗">
          An indent is a cart: build it, save it as a draft, change it, and send it when the site is
          ready. <b>A draft holds no quantity</b> — nothing is committed until it is submitted.
        </Banner>

        {loading ? <Loading /> : (
          <>
            {!!(data?.drafts || []).length && (
              <Card title="Your drafts" sub="Not sent anywhere yet — edit freely">
                <div className="tw"><table>{head}<tbody>{data.drafts.map(row)}</tbody></table></div>
              </Card>
            )}
            <Card title="Indents">
              <div className="tw">
                <table>{head}
                  <tbody>
                    {(data?.indents || []).map(row)}
                    {!(data?.indents || []).length && (
                      <tr><td colSpan={6}>
                        <Empty title="No indents raised yet">
                          A site can indent once its BOQ is locked.
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
   The cart. Every line shows BOQ qty, est qty, variation, indented
   and balance whatever the policy is — those are facts about the
   line, not things that depend on a ceiling.
   =================================================================== */
export function IndentCart() {
  const { branchId, siteId: chosenSite } = useApp();
  const { id } = useParams();
  const nav = useNavigate();
  const toast = useToast();

  const { data: sites, loading: loadingSites } = useApi(
    withBranch('/indents/sites', branchId), [branchId]);
  const [siteId, setSiteId] = useState('');
  const site = (sites || []).find((s) => s.id === Number(siteId));

  // the whole BOQ, exactly as it was prepared
  const { data: sheet } = useApi(site ? `/indents/boq/${site.boq_id}/sheet` : null, [site?.boq_id]);
  const { data: existing } = useApi(id ? `/indents/${id}` : null, [id]);

  // boq_line_id -> what is being asked for on it
  const [want, setWant] = useState({});
  // boq_wo_line_id -> typed against the work order line
  const [woWant, setWoWant] = useState({});
  // which item quantities came off a work order line rather than a
  // keystroke of their own, so the sheet can say so and take it back
  const [auto, setAuto] = useState({});

  /**
   * One number against the work order line fills every item under it,
   * item qty x what was typed — the same arithmetic that built the BOQ
   * and the same that amends it. An item can still be overridden after.
   */
  const setWoLine = (w, value) => {
    setWoWant((x) => ({ ...x, [w.boq_wo_line_id]: value }));
    const n = Number(value);
    setWant((x) => {
      const next = { ...x };
      for (const i of w.items) {
        if (!value || Number.isNaN(n) || n <= 0) delete next[i.boq_line_id];
        else next[i.boq_line_id] = String(Math.round(Number(i.item_qty) * n * 1000) / 1000);
      }
      return next;
    });
    setAuto((x) => {
      const next = { ...x };
      for (const i of w.items) {
        if (!value || Number.isNaN(n) || n <= 0) delete next[i.boq_line_id];
        else next[i.boq_line_id] = w.boq_wo_line_id;
      }
      return next;
    });
  };

  /** Typing on one item makes it its own; it stops following the line. */
  const setItem = (l, value) => {
    setWant((x) => ({ ...x, [l.boq_line_id]: value }));
    setAuto((x) => { const n = { ...x }; delete n[l.boq_line_id]; return n; });
  };
  const [dates, setDates] = useState({ indentDate: today(), neededBy: addDays(today(), 14) });
  const [busy, setBusy] = useState(false);

  // open on the site chosen for the Site department, when it can raise one
  useEffect(() => {
    if (siteId || !sites?.length) return;
    const mine = sites.find((s) => s.id === Number(chosenSite));
    setSiteId(String((mine || sites[0]).id));
  }, [sites, siteId, chosenSite]);
  useEffect(() => {
    if (!existing) return;
    setSiteId(String(existing.site.id));
    setDates({ indentDate: existing.indentDate, neededBy: existing.neededBy || '' });
    setWant(Object.fromEntries(existing.lines.map((l) => [l.boq_line_id, String(l.qty)])));
    setWoWant({}); setAuto({});
  }, [existing]);

  const all = useMemo(
    () => (sheet?.woLines || []).flatMap((w) => w.items), [sheet]);

  /** How much of a typed quantity sits past the estimate on that line. */
  const over = (l) => Math.max(0,
    (Number(want[l.boq_line_id]) || 0) - Math.max(Number(l.balance), 0));

  const asked = all.filter((l) => Number(want[l.boq_line_id]) > 0);
  const overCount = asked.filter((l) => over(l) > 0).length;
  const severity = !overCount ? 'none'
    : (site?.over_allow && Number(site.over_pct) > 0) ? 'warn' : 'bad';

  /** What this indent becomes once approved: one line per item. */
  const rollup = useMemo(() => {
    const m = {};
    for (const l of asked) {
      const k = `${l.item_id}|${l.make_id || ''}`;
      m[k] = m[k] || { code: l.item_code, name: l.item_name, uom: l.uom, make: l.make_name, qty: 0, from: [] };
      m[k].qty += Number(want[l.boq_line_id]) || 0;
      m[k].from.push(l.sno);
    }
    return Object.values(m).sort((a, b) => a.name.localeCompare(b.name));
  }, [asked, want]);

  const save = async (send) => {
    if (!asked.length) return toast('Type a quantity against at least one line', 'bad');
    if (send && overCount && !site?.over_allow) {
      return toast('This BOQ does not allow going past the estimate', 'bad');
    }
    if (send && overCount) {
      const ok = window.confirm(
        `${overCount} line(s) go past the estimate.\n\n`
        + 'The BOQ will be marked "Amendment due" until a variation quantity is recorded.\n\nSend anyway?');
      if (!ok) return undefined;
    }
    setBusy(true);
    try {
      const body = {
        siteId: Number(siteId), indentDate: dates.indentDate,
        neededBy: dates.neededBy || undefined,
        lines: asked.map((l) => ({ boqLineId: l.boq_line_id, qty: Number(want[l.boq_line_id]) })),
      };
      if (id) {
        await api.put(`/indents/${id}`, body);
        if (send) await api.post(`/indents/${id}/submit`);
        toast(send ? 'Indent submitted' : 'Draft saved', 'ok');
        nav(`/indents/${id}`);
      } else {
        const r = await api.post('/indents', { ...body, send });
        toast(send ? `${r.docNo} submitted` : `${r.docNo} saved as a draft`, 'ok');
        nav(`/indents/${r.id}`);
      }
    } catch (e) { toast(e.message, 'bad'); }
    setBusy(false);
    return undefined;
  };

  if (loadingSites) return <Loading />;
  if (!(sites || []).length) {
    return (
      <>
        <PageHead title="Raise indent" />
        <div className="page-body">
          <Banner kind="warn" icon="!">
            No site in this branch has a locked BOQ yet. Prepare one first —{' '}
            <Link to="/boq" style={{ textDecoration: 'underline' }}>go to BOQ</Link>.
          </Banner>
        </div>
      </>
    );
  }

  return (
    <>
      <PageHead title={id ? `Edit ${existing?.docNo || 'draft'}` : 'Raise indent'}
        sub="The site's BOQ, as it was prepared. Type against the lines you need." />
      <div className="page-body">
        <Card>
          <div className="pad">
            <div className="row2">
              <Field label="Site">
                <select className="inp" value={siteId} disabled={!!id}
                  onChange={(e) => { setSiteId(e.target.value); setWant({}); setWoWant({}); setAuto({}); }}>
                  {(sites || []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </Field>
              <Field label="Needed by">
                <input className="inp" type="date" value={dates.neededBy}
                  onChange={(e) => setDates((d) => ({ ...d, neededBy: e.target.value }))} />
              </Field>
            </div>
          </div>
        </Card>

        {site && (
          <Banner kind={site.state === 'AMENDMENT_DUE' ? 'bad' : site.over_allow ? 'warn' : 'info'}
            icon={site.state === 'AMENDMENT_DUE' ? '▲' : site.over_allow ? '⚠' : '▤'}>
            {site.state === 'AMENDMENT_DUE' && (
              <><b>This BOQ is already past its estimate on {site.over_line_count} line(s)</b> and is
              waiting on an amendment. </>
            )}
            {site.over_allow
              ? <>This BOQ allows indenting beyond the estimate{Number(site.over_pct)
                ? <> up to <b>{site.over_pct}%</b></> : <> with <b>no ceiling</b></>}. Anything past it is flagged.</>
              : <>This BOQ does not allow indenting beyond the estimate — the estimated quantity is a hard stop.</>}
          </Banner>
        )}

        <Card title="BOQ (Bill of Quantity)"
          sub={`${site ? `Against ${site.boq_doc_no}. ` : ''}Already ordered is the total for that item across this BOQ, whatever line it was asked for on.`}>
          <div className="tw">
            <table className="sheet">
              <thead>
                <tr>
                  <th style={{ width: 58 }}>Sl No</th>
                  <th style={{ width: 104 }}>Item Code</th>
                  <th style={{ minWidth: 250 }}>Description</th>
                  <th style={{ width: 72 }}>Unit</th>
                  <th className="rt" style={{ width: 86 }}>BOQ Qty</th>
                  <th className="rt" style={{ width: 86 }}>Est Qty</th>
                  <th className="rt" style={{ width: 108 }}>Already ordered</th>
                  <th className="rt" style={{ width: 100 }}>Indent Qty</th>
                  <th style={{ width: 148 }}>Variation</th>
                </tr>
              </thead>
              <tbody>
                {(sheet?.woLines || []).map((w) => (
                  <Fragment key={w.boq_wo_line_id}>
                    <tr className="wo-row">
                      <td className="sn"><b>{w.sno}</b></td>
                      <td />
                      <td>
                        <b>{w.description}</b>
                        <small>work order line · {w.item_count} item(s)</small>
                      </td>
                      <td>{w.uom}</td>
                      <td className="rt mono"><b>{qty(w.effective_qty)}</b></td>
                      <td className="rt mono">{qty(w.effective_est)}</td>
                      <td />
                      <td>
                        <input className="inp rt" type="number" min="0" step="any"
                          style={{ fontWeight: 600 }} placeholder="for the line"
                          title="Type once here and every item under it follows"
                          value={woWant[w.boq_wo_line_id] ?? ''}
                          onChange={(e) => setWoLine(w, e.target.value)} />
                      </td>
                      <td>
                        {Number(woWant[w.boq_wo_line_id]) > 0
                          ? <Tag kind="ok">{w.item_count} item(s) follow</Tag>
                          : <span style={{ color: 'var(--faint)' }}>or type per item below</span>}
                      </td>
                    </tr>

                    {w.items.map((l) => {
                      const ov = over(l);
                      const pct = Number(l.effective_est) > 0 ? (ov / Number(l.effective_est)) * 100 : 0;
                      const typed = Number(want[l.boq_line_id]) > 0;
                      return (
                        <tr key={l.boq_line_id} className="kid"
                          style={typed ? { background: 'var(--brand-soft)' } : undefined}>
                          <td>{l.sno}</td>
                          <td className="mono" style={{ color: 'var(--brand-ink)' }}>{l.item_code}</td>
                          <td>
                            {l.item_name}
                            {l.make_name && <small>{l.make_name}</small>}
                          </td>
                          <td>{l.uom}</td>
                          <td className="rt mono">{qty(l.boq_qty)}</td>
                          <td className="rt mono">
                            {qty(l.effective_est)}
                            {Number(l.var_qty) !== 0 && (
                              <small style={{ color: 'var(--brand)' }}>
                                incl. {Number(l.var_qty) > 0 ? '+' : ''}{qty(l.var_qty)} amended
                              </small>
                            )}
                          </td>
                          <td className="rt mono">
                            {Number(l.item_indented_qty) > 0
                              ? qty(l.item_indented_qty)
                              : <span style={{ color: 'var(--faint)' }}>none yet</span>}
                          </td>
                          <td>
                            <input className="inp rt" type="number" min="0" step="any"
                              value={want[l.boq_line_id] ?? ''} placeholder="—"
                              style={auto[l.boq_line_id]
                                ? { background: 'var(--brand-soft)', borderColor: 'var(--brand)' } : undefined}
                              title={auto[l.boq_line_id]
                                ? `${qty(l.item_qty)} per unit of the work order line — type over it to fix this one item`
                                : undefined}
                              onChange={(e) => setItem(l, e.target.value)} />
                          </td>
                          <td>
                            {auto[l.boq_line_id] && (
                              <small style={{ color: 'var(--muted)', display: 'block' }}>
                                from the line · {qty(l.item_qty)} per unit
                              </small>
                            )}
                            {!typed ? <span style={{ color: 'var(--faint)' }}>—</span>
                              : ov > 0
                                ? <Tag kind={severity === 'bad' ? 'bad' : 'warn'}>
                                  {severity === 'bad' ? '▲' : '⚠'} {qty(ov)} over · {pct.toFixed(1)}%
                                </Tag>
                                : <Tag kind="ok">within estimate</Tag>}
                          </td>
                        </tr>
                      );
                    })}
                  </Fragment>
                ))}
                {!(sheet?.woLines || []).length && (
                  <tr><td colSpan={9}>
                    <Empty title="Nothing prepared on this BOQ" />
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>

        {rollup.length > 0 && (
          <Card title="What this orders"
            sub="Once approved it goes out like this — one line per item, whatever it was asked for against">
            <div className="tw">
              <table>
                <thead>
                  <tr>
                    <th style={{ width: 104 }}>Item Code</th><th>Item</th>
                    <th style={{ width: 72 }}>Unit</th>
                    <th className="rt" style={{ width: 100 }}>Qty</th>
                    <th style={{ width: 160 }}>From</th>
                  </tr>
                </thead>
                <tbody>
                  {rollup.map((r) => (
                    <tr key={`${r.code}-${r.make || ''}`}>
                      <td className="mono" style={{ color: 'var(--brand-ink)' }}>{r.code}</td>
                      <td>{r.name}{r.make && <small>{r.make}</small>}</td>
                      <td>{r.uom}</td>
                      <td className="rt mono"><b>{qty(r.qty)}</b></td>
                      <td>
                        {r.from.length > 1
                          ? <Tag kind="brand">{r.from.length} lines · {r.from.join(', ')}</Tag>
                          : <span style={{ color: 'var(--muted)' }}>{r.from[0]}</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}

        <Card>
          <div className="pad" style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
            <Stat n={asked.length} label="lines asked for" />
            <Stat n={rollup.length} label="items to order" tone="brand" />
            <Stat n={overCount} label="past the estimate"
              tone={overCount ? (severity === 'bad' ? 'bad' : 'warn') : undefined} />
            <div style={{ flex: 1 }} />
            <button className="btn" onClick={() => nav('/indents')}>Cancel</button>
            <button className="btn" disabled={busy} onClick={() => save(false)}>Save draft</button>
            <button className="btn pri" disabled={busy} onClick={() => save(true)}>Submit indent</button>
          </div>
        </Card>
      </div>
    </>
  );
}


/* =================================================================== */
/**
 * Where the material is. Five stages, and the one it has reached is
 * lit — so a site chasing a delivery can see whether it is waiting on
 * a signature or on a supplier, which are different problems with
 * different people to ring.
 */
const STEPS = [
  ['AWAITING_PO', 'Approved'],
  ['PO_WITH_GM', 'With the GM'],
  ['ORDERED', 'Ordered'],
  ['PART_RECEIVED', 'Arriving'],
  ['RECEIVED', 'Received'],
];
const REACHED = {
  NOT_APPROVED: -1, AWAITING_PO: 0, PO_WITH_GM: 1,
  PART_ORDERED: 1, ORDERED: 2, PART_RECEIVED: 3, RECEIVED: 4,
};

function Pipeline({ stage, onOpen }) {
  const at = REACHED[stage] ?? 0;
  return (
    <div style={{ display: 'flex', alignItems: 'stretch', gap: 2, flexWrap: 'wrap' }}>
      {STEPS.map(([key, label], i) => {
        const done = i < at;
        const now = i === at;
        return (
          <button key={key} type="button"
            onClick={() => onOpen && onOpen(key)}
            title={i === at ? 'Where it is now' : undefined}
            style={{
              flex: '1 1 120px', textAlign: 'left', cursor: onOpen ? 'pointer' : 'default',
              padding: '9px 12px', border: '1px solid var(--line)', borderRadius: 6,
              background: now ? 'var(--brand)' : done ? 'var(--brand-soft)' : 'var(--card)',
              color: now ? '#fff' : done ? 'var(--brand-ink)' : 'var(--faint)',
              fontWeight: now ? 700 : 500, fontSize: 12.5,
            }}>
            <div style={{ fontSize: 10.5, opacity: 0.8 }}>{done ? '✓' : now ? '●' : '○'}</div>
            {label}
          </button>
        );
      })}
    </div>
  );
}

export function IndentDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const toast = useToast();
  const { data, error, loading, reload } = useApi(`/indents/${id}`);

  if (loading) return <Loading />;
  if (error) return <div className="page-body"><ErrorNote error={error} onRetry={reload} /></div>;

  const act = async (action) => {
    const note = action === 'RETURNED' ? window.prompt('Why is it going back?') : null;
    if (action === 'RETURNED' && note === null) return;
    try {
      await api.post(`/indents/${id}/decide`, { action, note: note || undefined });
      toast(action === 'APPROVED' ? 'Indent approved' : 'Indent returned', 'ok');
      reload();
    } catch (e) { toast(e.message, 'bad'); }
  };

  const submit = async () => {
    try {
      await api.post(`/indents/${id}/submit`);
      toast('Indent submitted', 'ok'); reload();
    } catch (e) { toast(e.message, 'bad'); }
  };

  return (
    <>
      <PageHead title={data.docNo} sub={`${data.site.name} · against ${data.boqDocNo} · raised by ${data.raisedBy}`}
        actions={
          <div style={{ display: 'flex', gap: 9 }}>
            <button className="btn" onClick={() => nav('/indents')}>Back</button>
            {data.canEdit && <Link className="btn" to={`/indents/${id}/edit`}>Edit</Link>}
            {data.canEdit && <button className="btn pri" onClick={submit}>Submit</button>}
            {data.status === 'SUBMITTED' && (
              <>
                <button className="btn bad" onClick={() => act('RETURNED')}>Return</button>
                <button className="btn pri" onClick={() => act('APPROVED')}>Approve</button>
              </>
            )}
          </div>
        } />
      <div className="page-body">
        {data.overLines > 0 && (
          <Banner kind={data.severity === 'bad' ? 'bad' : 'warn'} icon={data.severity === 'bad' ? '▲' : '⚠'}>
            <b>{data.overLines} line(s) go past the BOQ estimate — {Number(data.worstOverPct).toFixed(1)}% at the
            worst line.</b><br />
            {data.policy.overAllow && Number(data.policy.overPct) > 0
              ? <>This BOQ allows up to {data.policy.overPct}% over, so this is inside what was agreed — but it
                still needs a BOQ amendment before the estimate reads true.</>
              : <><b>No ceiling was agreed on this BOQ</b>, so there is nothing capping how far past the
                estimate it can go. Approve only if the extra quantity is genuinely needed.</>}
          </Banner>
        )}

        {data.pipeline && data.status === 'APPROVED' && (
          <Card title="Where the material is"
            sub="Every figure below comes from the orders and deliveries behind it"
            actions={
              <button className="btn sm" onClick={() => downloadCsv(`indent-${data.docNo}`, [
                ['Indent', data.docNo], ['Site', data.site.name],
                ['Stage', data.pipeline.stage], [],
                ['Item code', 'Item', 'Unit', 'Indented', 'Ordered', 'With the GM',
                  'Received', 'Still to come'],
                ...data.flow.map((f) => [f.item_code, f.item_name, f.uom, f.indented_qty,
                  f.ordered_qty, f.pending_gm_qty, f.received_qty, f.to_receive_qty]),
              ])}>Download</button>
            }>
            <div className="pad">
              <Pipeline stage={data.pipeline.stage} />
              <div className="stats" style={{ marginTop: 14 }}>
                <Stat n={qty(data.pipeline.indented_qty)} label="indented" />
                <Stat n={qty(data.pipeline.ordered_qty)} label="ordered" />
                <Stat n={qty(data.pipeline.received_qty)} label="received" tone="brand" />
                <Stat n={qty(data.pipeline.to_receive_qty)} label="still to come"
                  tone={Number(data.pipeline.to_receive_qty) > 0 ? 'warn' : undefined} />
              </div>
            </div>

            <div className="tw">
              <table>
                <thead>
                  <tr>
                    <th style={{ width: 100 }}>Code</th><th>Item</th><th style={{ width: 62 }}>Unit</th>
                    <th className="rt">Indented</th><th className="rt">Ordered</th>
                    <th className="rt">Received</th><th className="rt">Still to come</th>
                  </tr>
                </thead>
                <tbody>
                  {data.flow.map((f) => (
                    <tr key={`${f.item_id}-${f.make_id || ''}`}>
                      <td className="mono" style={{ color: 'var(--brand-ink)' }}>{f.item_code}</td>
                      <td>{f.item_name}{f.make_name && <small>{f.make_name}</small>}</td>
                      <td>{f.uom}</td>
                      <td className="rt mono">{qty(f.indented_qty)}</td>
                      <td className="rt mono">
                        {Number(f.ordered_qty) ? qty(f.ordered_qty) : '—'}
                        {Number(f.pending_gm_qty) > 0 && (
                          <small style={{ color: 'var(--warn)' }}>
                            {qty(f.pending_gm_qty)} with the GM
                          </small>
                        )}
                      </td>
                      <td className="rt mono">{Number(f.received_qty) ? qty(f.received_qty) : '—'}</td>
                      <td className="rt mono"
                        style={{ color: Number(f.to_receive_qty) > 0 ? 'var(--bad)' : 'var(--ok)' }}>
                        <b>{Number(f.to_receive_qty) ? qty(f.to_receive_qty) : 'nil'}</b>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}

        {data.orders?.length > 0 && (
          <Card title="Orders raised against it">
            <div className="tw">
              <table>
                <thead>
                  <tr><th>PO</th><th>Supplier</th><th>Deliver to</th><th>Expected</th><th>Where it is</th><th /></tr>
                </thead>
                <tbody>
                  {data.orders.map((o) => (
                    <tr key={o.id}>
                      <td><b className="mono">{o.doc_no}</b><small>{dmy(o.po_date)}</small></td>
                      <td>{o.supplier_name}</td>
                      <td>{o.deliver_to_name}
                        <small>{o.deliver_to_type === 'STORE' ? 'store' : 'site'}</small></td>
                      <td>{o.expected_date ? dmy(o.expected_date) : '—'}
                        {Number(o.overdue) === 1 && <Tag kind="bad">overdue</Tag>}</td>
                      <td>
                        {o.status !== 'APPROVED'
                          ? <Tag kind="warn">{o.status === 'SUBMITTED' ? 'With the GM' : o.status}</Tag>
                          : <Tag kind={o.receipt_state === 'RECEIVED' ? 'ok' : 'warn'}>
                            {o.receipt_state === 'RECEIVED' ? 'Received in full'
                              : o.receipt_state === 'PARTIAL' ? 'Part received' : 'Awaiting delivery'}
                          </Tag>}
                      </td>
                      <td className="rt">
                        <Link className="btn sm" to={`/purchase-orders/${o.id}`}>Open</Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}

        {data.rolledUp && (
          <Card title="What this orders"
            sub="One line per item. Which BOQ line it was asked for against stops mattering the
                 moment it is approved — this is what Procurement buys and the store picks.">
            <div className="tw">
              <table>
                <thead>
                  <tr>
                    <th style={{ width: 110 }}>Item Code</th><th>Item</th>
                    <th style={{ width: 76 }}>Unit</th>
                    <th className="rt" style={{ width: 110 }}>Qty</th>
                    <th style={{ width: 180 }}>Raised against</th>
                  </tr>
                </thead>
                <tbody>
                  {data.rollup.map((r) => (
                    <tr key={`${r.item_id}-${r.make_id || ''}`}>
                      <td className="mono" style={{ color: 'var(--brand-ink)' }}>{r.item_code}</td>
                      <td><b>{r.item_name}</b>{r.make_name && <small>{r.make_name}</small>}</td>
                      <td>{r.uom}</td>
                      <td className="rt mono"><b>{qty(r.qty)}</b></td>
                      <td>
                        {Number(r.from_lines) > 1
                          ? <Tag kind="brand">{r.from_lines} lines · {r.boq_snos}</Tag>
                          : <span style={{ color: 'var(--muted)' }}>{r.boq_snos}</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}

        <Card title={data.rolledUp ? 'How it was raised' : 'Lines'}
          sub={data.rolledUp
            ? 'Kept on the record so a variation can still be traced to the line it came off'
            : undefined}>
          <div className="tw">
            <table>
              <thead>
                <tr>
                  <th>Sl No</th><th>Item</th><th>Unit</th>
                  <th className="rt">Est qty</th><th className="rt">Indent qty</th><th>Against estimate</th>
                </tr>
              </thead>
              <tbody>
                {data.lines.map((l) => (
                  <tr key={l.id}>
                    <td className="sn">{l.sno}</td>
                    <td><b>{l.item_name}</b><small className="mono">{l.item_code}{l.make_name ? ` · ${l.make_name}` : ''}</small></td>
                    <td>{l.uom}</td>
                    <td className="rt mono">{qty(l.effective_est)}</td>
                    <td className="rt mono"><b>{qty(l.qty)}</b></td>
                    <td>
                      {Number(l.over_qty) > 0
                        ? <Tag kind={data.severity === 'bad' ? 'bad' : 'warn'}>
                          {data.severity === 'bad' ? '▲' : '⚠'} {qty(l.over_qty)} over
                        </Tag>
                        : <Tag kind="ok">✓ within estimate</Tag>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <Card title="History">
          <div className="tw">
            <table>
              <thead><tr><th>Action</th><th>By</th><th>When</th><th>Note</th></tr></thead>
              <tbody>
                {data.events.map((e, i) => (
                  <tr key={i}>
                    <td><Tag kind={e.action === 'APPROVED' ? 'ok' : e.action === 'RETURNED' ? 'bad' : ''}>{e.action}</Tag></td>
                    <td>{e.user_name || '—'}</td>
                    <td className="mono">{dmy(e.created_at)}</td>
                    <td>{e.note || '—'}</td>
                  </tr>
                ))}
                {!data.events.length && <tr><td colSpan={4}><Empty title="Not sent yet" /></td></tr>}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </>
  );
}

export default Indents;
