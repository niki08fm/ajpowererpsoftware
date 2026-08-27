import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useApp, PageHead } from '../App';
import { api, qty, dmy, today, addDays } from '../api';
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
  const { branchId } = useApp();
  const nav = useNavigate();
  const { data, error, loading, reload } = useApi(
    branchId ? `/indents?branchId=${branchId}` : null, [branchId]);

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
  const { branchId } = useApp();
  const { id } = useParams();
  const nav = useNavigate();
  const toast = useToast();

  const { data: sites, loading: loadingSites } = useApi(
    branchId ? `/indents/sites?branchId=${branchId}` : null, [branchId]);
  const [siteId, setSiteId] = useState('');
  const site = (sites || []).find((s) => s.id === Number(siteId));

  const { data: lines } = useApi(site ? `/indents/boq/${site.boq_id}/lines` : null, [site?.boq_id]);
  const { data: existing } = useApi(id ? `/indents/${id}` : null, [id]);

  const [rows, setRows] = useState([]);
  const [dates, setDates] = useState({ indentDate: today(), neededBy: addDays(today(), 14) });
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (!siteId && sites?.length) setSiteId(String(sites[0].id)); }, [sites, siteId]);
  useEffect(() => {
    if (!existing) return;
    setSiteId(String(existing.site.id));
    setDates({ indentDate: existing.indentDate, neededBy: existing.neededBy || '' });
    setRows(existing.lines.map((l) => ({ boqLineId: l.boq_line_id, qty: String(l.qty) })));
  }, [existing]);

  const byId = useMemo(
    () => Object.fromEntries((lines || []).map((l) => [l.boq_line_id, l])), [lines]);

  const free = (lines || []).filter((l) => !rows.some((r) => r.boqLineId === l.boq_line_id));

  const over = (r) => {
    const l = byId[r.boqLineId];
    if (!l) return 0;
    return Math.max(0, (Number(r.qty) || 0) - Math.max(Number(l.balance), 0));
  };
  const overCount = rows.filter((r) => over(r) > 0).length;
  const severity = !overCount ? 'none'
    : (site?.over_allow && Number(site.over_pct) > 0) ? 'warn' : 'bad';

  const save = async (send) => {
    const clean = rows.filter((r) => Number(r.qty) > 0);
    if (!clean.length) return toast('Add at least one line', 'bad');
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
        lines: clean.map((r) => ({ boqLineId: r.boqLineId, qty: Number(r.qty) })),
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
        sub="Items from this site's BOQ, measured against the estimate" />
      <div className="page-body">
        <Card>
          <div className="pad">
            <div className="row2">
              <Field label="Site">
                <select className="inp" value={siteId} disabled={!!id}
                  onChange={(e) => { setSiteId(e.target.value); setRows([]); }}>
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

        <Card title="Lines" sub={site ? `Against ${site.boq_doc_no}` : undefined}
          actions={
            <select className="inp" style={{ width: 260 }} value=""
              onChange={(e) => {
                const v = Number(e.target.value);
                if (v) setRows((r) => [...r, { boqLineId: v, qty: '' }]);
              }}>
              <option value="">Add a BOQ line…</option>
              {free.map((l) => (
                <option key={l.boq_line_id} value={l.boq_line_id}>
                  {l.sno} · {l.item_code} — {l.item_name}
                </option>
              ))}
            </select>
          }>
          <div className="tw">
            <table className="sheet">
              <thead>
                <tr>
                  <th style={{ width: 56 }}>Sl No</th>
                  <th style={{ minWidth: 240 }}>Item</th>
                  <th className="rt" style={{ width: 88 }}>BOQ qty</th>
                  <th className="rt" style={{ width: 88 }}>Est qty</th>
                  <th className="rt" style={{ width: 90 }}>Variation</th>
                  <th className="rt" style={{ width: 90 }}>Indented</th>
                  <th className="rt" style={{ width: 88 }}>Balance</th>
                  <th className="rt" style={{ width: 100 }}>Indent qty</th>
                  <th style={{ width: 150 }}>Against estimate</th>
                  <th style={{ width: 40 }} />
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => {
                  const l = byId[r.boqLineId];
                  if (!l) return null;
                  const ov = over(r);
                  const pct = Number(l.effective_est) > 0 ? (ov / Number(l.effective_est)) * 100 : 0;
                  return (
                    <tr key={r.boqLineId}>
                      <td className="sn">{l.sno}</td>
                      <td>
                        <b>{l.item_name}</b>
                        <small className="mono">{l.item_code} · {l.uom}{l.make_name ? ` · ${l.make_name}` : ''}</small>
                      </td>
                      <td className="rt mono">{qty(l.boq_qty)}</td>
                      <td className="rt mono">{qty(l.est_qty)}</td>
                      <td className="rt mono">
                        {Number(l.var_qty) ? <span style={{ color: 'var(--brand)' }}>+{qty(l.var_qty)}</span> : '—'}
                      </td>
                      <td className="rt mono">{qty(l.committed_qty)}</td>
                      <td className="rt mono" style={{ color: Number(l.balance) < 0 ? 'var(--bad)' : undefined }}>
                        {qty(l.balance)}
                      </td>
                      <td>
                        <input className="inp rt" type="number" min="0" step="any" value={r.qty}
                          onChange={(e) => setRows((x) => x.map((y, n) => (n === i ? { ...y, qty: e.target.value } : y)))} />
                      </td>
                      <td>
                        {ov > 0
                          ? <Tag kind={severity === 'bad' ? 'bad' : 'warn'}>
                            {severity === 'bad' ? '▲' : '⚠'} {qty(ov)} over · {pct.toFixed(1)}%
                          </Tag>
                          : <Tag kind="ok">✓ within</Tag>}
                      </td>
                      <td>
                        <button className="btn sm bad" title="Remove line"
                          onClick={() => setRows((x) => x.filter((_, n) => n !== i))}>✕</button>
                      </td>
                    </tr>
                  );
                })}
                {!rows.length && (
                  <tr><td colSpan={10}>
                    <Empty title="Nothing in the cart yet">Add a BOQ line to indent against.</Empty>
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>

        <Card>
          <div className="pad" style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
            <Stat n={rows.length} label="lines" />
            <Stat n={overCount} label="past the estimate" tone={overCount ? (severity === 'bad' ? 'bad' : 'warn') : undefined} />
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

        <Card title="Lines">
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
