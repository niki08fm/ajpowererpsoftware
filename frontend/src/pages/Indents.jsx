import { Fragment, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useApp, PageHead } from '../App';
import {
  api, qty, dmy, today, addDays, withBranch, canWrite, relDays, daysFrom, plural,
} from '../api';
import { downloadCsv } from '../download';
import {
  useApi, Card, Tag, Empty, Loading, ErrorNote, Banner, Field, Stat, useToast, useDialog,
  Status, Code, NextStep, DocHead, DateField,
} from '../components/ui';
import { Icon } from '../components/icons';
import {
  prnApproval, prnStage, PRN_JOURNEY, PRN_JOURNEY_AT, PRN_JOURNEY_PARTLY, poStage, eventWord,
  eventTone, withWhom,
} from '../vocab';

/**
 * The site's request for material — the PRN.
 *
 * Trial 1 called it an indent in the Site menu, a PRN in Approvals and
 * the store, and numbered it IND/. It is a PRN everywhere now, and the
 * new ones are numbered PRN/.
 */

/** Past the estimate: said as a count, only when it is true. */
export const SeverityTag = ({ severity, pct, count }) => {
  if (severity === 'none' || !count) return <span style={{ color: 'var(--faint)' }}>Within estimate</span>;
  return (
    <Status tone={severity === 'bad' ? 'stopped' : 'attention'} icon="alert"
      label={pct ? `${Number(pct).toFixed(1)}% past estimate` : `${plural(count, 'line')} past estimate`}
      hint={severity === 'bad'
        ? 'No ceiling was agreed on this BOQ; the overrun needs a BOQ amendment'
        : 'Inside the ceiling agreed on this BOQ, but it still needs a BOQ amendment'} />
  );
};

/** Needed by, with how far away it is, and late in words when it is. */
const NeededBy = ({ date, done }) => {
  if (!date) return <span style={{ color: 'var(--faint)' }}>—</span>;
  const d = daysFrom(date);
  return (
    <>
      {dmy(date)}
      <small style={!done && d < 0 ? { color: 'var(--st-stop)', fontWeight: 600 } : undefined}>
        {!done && d < 0 ? `${plural(-d, 'day')} late` : relDays(date)}
      </small>
    </>
  );
};

/** One PRN row: the two questions in two columns. */
function PrnRow({ r, showSite, onOpen }) {
  const ap = prnApproval(r);
  const st = prnStage(r.stage);
  const approved = r.status === 'APPROVED';
  return (
    <tr className="click" tabIndex={0} onClick={onOpen}
      onKeyDown={(e) => { if (e.key === 'Enter') onOpen(); }}>
      <td><Code as="b">{r.doc_no}</Code><small>by {r.raised_by_name || '—'}</small></td>
      {showSite && <td>{r.site_name}</td>}
      <td className="mono">{dmy(r.indent_date)}</td>
      <td className="mono"><NeededBy date={r.needed_by} done={r.stage === 'AT_SITE'} /></td>
      <td className="rt mono">{r.line_count}</td>
      <td>
        <Status is={ap} />
        <span className="status-sub">
          {r.status === 'SUBMITTED' && (r.waiting_on === 'GM'
            ? `${r.gm_name || 'Site GM'} · level 1 of 2${r.days_waiting > 0 ? ` · ${plural(r.days_waiting, 'day')}` : ''}`
            : `Level 2 of 2${r.days_waiting > 0 ? ` · ${plural(r.days_waiting, 'day')}` : ''}`)}
          {r.status === 'RETURNED' && r.sent_back_by && `by ${r.sent_back_by}: “${r.sent_back_note || 'no reason given'}”`}
        </span>
      </td>
      <td>
        {approved ? (
          <>
            <Status is={st} />
            {Number(r.indented_qty) > 0 && r.stage !== 'AWAITING_PO' && (
              <span className="status-sub">
                {qty(r.at_site_qty)} of {qty(r.indented_qty)} at site
                {Number(r.in_transit_qty) > 0 ? ` · ${qty(r.in_transit_qty)} on the road` : ''}
              </span>
            )}
          </>
        ) : <span style={{ color: 'var(--faint)' }}>Waits for approval</span>}
      </td>
      <td><SeverityTag severity={r.severity} count={r.over_lines} /></td>
    </tr>
  );
}

/* =================================================================== */
export function Indents() {
  const { branchId, site } = useApp();
  const nav = useNavigate();
  // inside the Site department the list is the chosen site's, and says so
  const path = site ? `/indents?siteId=${site.id}` : withBranch('/indents', branchId);
  const { data, error, loading, reload } = useApi(path, [path]);
  const showSite = !site;

  const head = (
    <thead><tr>
      <th>PRN</th>{showSite && <th>Site</th>}<th>Raised</th><th>Needed by</th><th className="rt">Lines</th>
      <th>Approval</th><th>Material</th><th>Against estimate</th>
    </tr></thead>
  );
  const cols = showSite ? 8 : 7;
  const drafts = data?.drafts || [];
  const sent = data?.indents || [];
  const backToYou = sent.filter((r) => r.status === 'RETURNED');

  return (
    <>
      <PageHead title="PRNs"
        sub={site
          ? `Material requirements for ${site.name}, measured against its BOQ`
          : 'Material requirements from every site, measured against each BOQ'}
        actions={canWrite('/indents') && (
          <Link className="btn pri" to="/indents/new"><Icon name="plus" />Raise PRN</Link>
        )} />
      <div className="page-body">
        {error && <ErrorNote error={error} onRetry={reload} />}

        {backToYou.length > 0 && (
          <Banner kind="warn" icon="alert">
            <b>{plural(backToYou.length, 'PRN')} sent back to the site.</b>{' '}
            Open {backToYou.length === 1 ? 'it' : 'each one'} to see why, change it and send it for approval again.
          </Banner>
        )}

        {loading && !data ? <Loading what="PRNs" /> : (
          <>
            {drafts.length > 0 && (
              <Card title="Drafts"
                sub="Not sent for approval. A draft holds no quantity against the BOQ until it is sent.">
                <div className="tw"><table>{head}<tbody>
                  {drafts.map((r) => <PrnRow key={r.id} r={r} showSite={showSite} onOpen={() => nav(`/indents/${r.id}`)} />)}
                </tbody></table></div>
              </Card>
            )}
            <Card title="Sent for approval and approved">
              <div className="tw">
                <table>{head}
                  <tbody>
                    {sent.map((r) => <PrnRow key={r.id} r={r} showSite={showSite} onOpen={() => nav(`/indents/${r.id}`)} />)}
                    {!sent.length && (
                      <tr><td colSpan={cols}>
                        <Empty title={site ? `No PRNs sent for ${site.name} yet` : 'No PRNs sent yet'}
                          action={canWrite('/indents') && <Link className="btn" to="/indents/new">Raise PRN</Link>}>
                          A site can raise a PRN once its BOQ is approved and locked.
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
   Raising a PRN. Every line shows BOQ qty, estimate, what is already
   requested and the balance, whatever the policy — those are facts
   about the line, not things that depend on a ceiling.
   =================================================================== */
export function IndentCart() {
  const { branchId, site: chosen } = useApp();
  const { id } = useParams();
  const nav = useNavigate();
  const toast = useToast();
  const ask = useDialog();

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

  // the site in the top bar, when there is one: the form never offers a
  // second, different choice of site beside it
  const locked = !!chosen && (sites || []).some((s) => s.id === chosen.id);
  useEffect(() => {
    if (siteId || !sites?.length) return;
    const mine = sites.find((s) => s.id === Number(chosen?.id));
    setSiteId(String((mine || sites[0]).id));
  }, [sites, siteId, chosen]);
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

  /** What this PRN becomes once approved: one line per item. */
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
      return toast('This BOQ does not allow asking for more than the estimate', 'bad');
    }
    if (send && overCount) {
      const ok = await ask({
        title: `Send with ${plural(overCount, 'line')} past the estimate?`,
        consequence: 'The BOQ will read “Amendment due” until Planning records a variation. '
          + 'The GM sees the overrun when approving this PRN.',
        confirm: 'Send for approval',
        cancel: 'Go back and change it',
      });
      if (ok === null) return undefined;
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
        toast(send ? `${existing?.docNo || 'PRN'} sent to the site's GM for approval` : 'Draft saved', 'ok');
        nav(`/indents/${id}`);
      } else {
        const r = await api.post('/indents', { ...body, send });
        toast(send ? `${r.docNo} sent to the site's GM for approval` : `${r.docNo} saved as a draft`, 'ok');
        nav(`/indents/${r.id}`);
      }
    } catch (e) { toast(e.message, 'bad'); }
    setBusy(false);
    return undefined;
  };

  if (loadingSites) return <Loading what="sites with a locked BOQ" />;
  if (!(sites || []).length) {
    return (
      <>
        <PageHead title="Raise PRN" />
        <div className="page-body">
          <Banner kind="warn">
            No site here has an approved, locked BOQ yet, and a PRN is always raised against one.
            Planning prepares it — <Link to="/boq" style={{ textDecoration: 'underline' }}>open BOQ</Link>.
          </Banner>
        </div>
      </>
    );
  }

  return (
    <>
      <PageHead title={id ? `Change ${existing?.docNo || 'draft'}` : 'Raise PRN'}
        sub="The site's BOQ as it was prepared. Type a quantity against the lines you need." />
      <div className="page-body">
        <Card>
          <div className="pad">
            <div className="row2">
              {locked || id ? (
                <Field label="Site"
                  hint={id ? 'A PRN stays with the site it was raised for' : 'To raise one for another site, change the site in the top bar'}>
                  <div className="inp" style={{ display: 'flex', alignItems: 'center' }}>{site?.name || '…'}</div>
                </Field>
              ) : (
                <Field label="Site">
                  <select className="inp" value={siteId}
                    onChange={(e) => { setSiteId(e.target.value); setWant({}); setWoWant({}); setAuto({}); }}>
                    {(sites || []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </Field>
              )}
              <DateField label="Needed at site by" value={dates.neededBy} min={today()}
                onChange={(e) => setDates((d) => ({ ...d, neededBy: e.target.value }))} />
            </div>
          </div>
        </Card>

        {site && (
          <Banner kind={site.state === 'AMENDMENT_DUE' ? 'warn' : 'info'}>
            {site.state === 'AMENDMENT_DUE' && (
              <><b>This BOQ is already past its estimate on {plural(site.over_line_count, 'line')}</b> and is
              waiting for an amendment. </>
            )}
            {site.over_allow
              ? <>This BOQ allows asking for more than the estimate{Number(site.over_pct)
                ? <> — up to <b>{site.over_pct}%</b> more</> : <> with <b>no ceiling</b></>}. Anything past the estimate is flagged for a BOQ amendment.</>
              : <>On this BOQ the estimate is a <b>hard stop</b>: a PRN cannot ask for more than the estimate.</>}
          </Banner>
        )}

        <Card title="BOQ lines"
          sub={`${site ? `${site.boq_doc_no}. ` : ''}“Already requested” is what earlier PRNs asked for that item on this BOQ, whatever line it was on.`}>
          <div className="tw">
            <table className="sheet">
              <thead>
                <tr>
                  <th style={{ width: 58 }}>Sl no</th>
                  <th style={{ width: 110 }}>Item code</th>
                  <th style={{ minWidth: 250 }}>Description</th>
                  <th style={{ width: 72 }}>Unit</th>
                  <th className="rt" style={{ width: 86 }}>BOQ qty</th>
                  <th className="rt" style={{ width: 86 }}>Estimate</th>
                  <th className="rt" style={{ width: 118 }}>Already requested</th>
                  <th className="rt" style={{ width: 110 }}>This PRN</th>
                  <th style={{ width: 180 }}>Against estimate</th>
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
                        <small>Work order line · {plural(w.item_count, 'item')}</small>
                      </td>
                      <td>{w.uom}</td>
                      <td className="rt mono"><b>{qty(w.effective_qty)}</b></td>
                      <td className="rt mono">{qty(w.effective_est)}</td>
                      <td />
                      <td>
                        <input className="inp rt" type="number" min="0" step="any" inputMode="decimal"
                          style={{ fontWeight: 600 }} placeholder="Qty"
                          aria-label={`Quantity for work order line ${w.sno}; fills every item under it`}
                          title="Type once here and every item under it follows"
                          value={woWant[w.boq_wo_line_id] ?? ''}
                          onChange={(e) => setWoLine(w, e.target.value)} />
                      </td>
                      <td>
                        {Number(woWant[w.boq_wo_line_id]) > 0
                          ? <Status tone="info" icon="arrowRight" label={`Fills ${plural(w.item_count, 'item')} below`} />
                          : <span style={{ color: 'var(--muted)', fontSize: 12.5 }}>Type here to fill every item, or per item below</span>}
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
                          <td><Code>{l.item_code}</Code></td>
                          <td>
                            {l.item_name}
                            {l.make_name && <small>{l.make_name}</small>}
                          </td>
                          <td>{l.uom}</td>
                          <td className="rt mono">{qty(l.boq_qty)}</td>
                          <td className="rt mono">
                            {qty(l.effective_est)}
                            {Number(l.var_qty) !== 0 && (
                              <small>
                                incl. {Number(l.var_qty) > 0 ? '+' : ''}{qty(l.var_qty)} amended
                              </small>
                            )}
                          </td>
                          <td className="rt mono">
                            {Number(l.item_indented_qty) > 0
                              ? qty(l.item_indented_qty)
                              : <span style={{ color: 'var(--faint)' }}>None yet</span>}
                          </td>
                          <td>
                            <input className="inp rt" type="number" min="0" step="any" inputMode="decimal"
                              value={want[l.boq_line_id] ?? ''} placeholder="0"
                              aria-label={`Quantity of ${l.item_name}`}
                              style={auto[l.boq_line_id]
                                ? { background: 'var(--brand-soft)', borderColor: 'var(--brand)' } : undefined}
                              title={auto[l.boq_line_id]
                                ? `${qty(l.item_qty)} per unit of the work order line — type over it to change this one item`
                                : undefined}
                              onChange={(e) => setItem(l, e.target.value)} />
                          </td>
                          <td>
                            {auto[l.boq_line_id] && (
                              <small style={{ color: 'var(--muted)', display: 'block', marginBottom: 3 }}>
                                From the line · {qty(l.item_qty)} per unit
                              </small>
                            )}
                            {!typed ? <span style={{ color: 'var(--faint)' }}>—</span>
                              : ov > 0
                                ? <Status tone={severity === 'bad' ? 'stopped' : 'attention'} icon="alert"
                                  label={`${qty(ov)} over · ${pct.toFixed(1)}%`} />
                                : <Status tone="done" label="Within estimate" />}
                          </td>
                        </tr>
                      );
                    })}
                  </Fragment>
                ))}
                {!(sheet?.woLines || []).length && (
                  <tr><td colSpan={9}>
                    <Empty title="Nothing is prepared on this BOQ">Planning adds the items for each work order line first.</Empty>
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>

        {rollup.length > 0 && (
          <Card title="Items on this PRN"
            sub="After approval the store and Procurement see one line per item, whatever BOQ line it was asked for on">
            <div className="tw">
              <table>
                <thead>
                  <tr>
                    <th style={{ width: 110 }}>Item code</th><th>Item</th>
                    <th style={{ width: 72 }}>Unit</th>
                    <th className="rt" style={{ width: 100 }}>Qty</th>
                    <th style={{ width: 180 }}>From BOQ lines</th>
                  </tr>
                </thead>
                <tbody>
                  {rollup.map((r) => (
                    <tr key={`${r.code}-${r.make || ''}`}>
                      <td><Code>{r.code}</Code></td>
                      <td>{r.name}{r.make && <small>{r.make}</small>}</td>
                      <td>{r.uom}</td>
                      <td className="rt mono"><b>{qty(r.qty)}</b></td>
                      <td>{r.from.join(', ')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}

        <Card>
          <div className="pad" style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
            <Stat n={asked.length} label="BOQ lines asked for" one="BOQ line asked for" />
            <Stat n={rollup.length} label="items" one="item" />
            <Stat n={overCount} label="past the estimate"
              tone={overCount ? (severity === 'bad' ? 'bad' : 'warn') : undefined} />
            <div style={{ flex: 1 }} />
            {!asked.length && <span className="why-not"><Icon name="info" size={14} />Type a quantity to continue</span>}
            <button className="btn" onClick={() => nav(id ? `/indents/${id}` : '/indents')}>Cancel</button>
            <button className="btn" disabled={busy || !asked.length} onClick={() => save(false)}>Save as draft</button>
            <button className="btn pri" disabled={busy || !asked.length} onClick={() => save(true)}>
              <Icon name="send" />Send for approval
            </button>
          </div>
        </Card>
      </div>
    </>
  );
}


/* ===================================================================
   Where the material is, all the way to the site.

   The journey has six steps, and the last two are the ones that matter
   to the person who raised it: material sitting in the central store is
   not material on the site, and it is only "here" when the site has
   confirmed receipt of the challan.
   =================================================================== */
function Journey({ stage }) {
  const at = PRN_JOURNEY_AT[stage] ?? 0;
  const part = PRN_JOURNEY_PARTLY.includes(stage);
  const complete = stage === 'AT_SITE';
  return (
    <ol className="journey" style={{ '--n': PRN_JOURNEY.length, listStyle: 'none', padding: 0 }}>
      {PRN_JOURNEY.map((s, i) => {
        const done = i < at || (complete && i === at);
        const now = i === at && !complete;
        return (
          <li key={s.key} className={`j ${done ? 'done' : ''} ${now ? 'now' : ''}`}
            aria-current={now ? 'step' : undefined}>
            <div className="dot">{done ? <Icon name="check" size={13} /> : now ? <Icon name="clock" size={13} /> : null}</div>
            <div className="t">{s.label}</div>
            {now && part && <div className="d">Part of it</div>}
            {now && !part && <div className="d">Now</div>}
          </li>
        );
      })}
    </ol>
  );
}

/** Who has it and what happens next, in words, from the PRN itself. */
function prnNext(data) {
  const w = withWhom(data.approval);
  const returned = data.status === 'RETURNED'
    ? [...(data.events || [])].reverse().find((e) => e.action === 'RETURNED') : null;
  switch (data.status) {
    case 'DRAFT':
      return {
        tone: 'neutral', icon: 'draft',
        now: 'Draft — not sent for approval',
        then: 'Nothing is held against the BOQ until it is sent. The site\'s GM approves it first (level 1), then Management (level 2).',
      };
    case 'SUBMITTED': {
      const first = (data.approval?.events || []).filter((e) => e.action === 'APPROVED' && e.level === 1).pop();
      return w?.level === 2
        ? {
          tone: 'info', icon: 'clock',
          now: `With ${w.who} for approval · level 2 of 2`,
          then: `${first?.by ? `${first.by} approved level 1. ` : ''}Once Management approves, the store sends it from stock or Procurement orders it.`,
        }
        : {
          tone: 'info', icon: 'clock',
          now: `With ${w?.who || 'the site GM'} for approval · level 1 of 2`,
          then: 'Next, Management approves (level 2). Nothing is ordered or dispatched until both have approved.',
        };
    }
    case 'RETURNED':
      return {
        tone: 'attention', icon: 'alert',
        now: `Sent back${returned?.user_name ? ` by ${returned.user_name}` : ''}${returned?.created_at ? ` on ${dmy(returned.created_at)}` : ''}`,
        quote: returned?.note || undefined,
        then: 'Change the PRN and send it for approval again. It starts again at level 1.',
      };
    case 'APPROVED': {
      const st = prnStage(data.pipeline?.stage);
      return {
        tone: st.tone === 'done' ? 'done' : 'info', icon: st.icon,
        now: `Approved · ${st.label.toLowerCase()}`,
        then: st.hint,
      };
    }
    default:
      return { tone: 'stopped', icon: 'stop', now: prnApproval(data).label, then: 'It will not go any further.' };
  }
}

export function IndentDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const toast = useToast();
  const ask = useDialog();
  const { data, error, loading, reload } = useApi(`/indents/${id}`);

  if (loading && !data) return <Loading what="the PRN" />;
  if (error) return <div className="page-body" style={{ paddingTop: 24 }}><ErrorNote error={error} onRetry={reload} /></div>;

  const approve = async () => {
    const lvl = data.approval?.level || 1;
    const ok = await ask({
      title: `Approve ${data.docNo}?`,
      consequence: lvl === 1
        ? 'It goes to Management for the second approval (level 2 of 2). Nothing is ordered until they approve too.'
        : 'This is the second approval. The PRN goes to the store and to Procurement to be supplied.',
      confirm: 'Approve PRN',
    });
    if (ok === null) return;
    try {
      const r = await api.post(`/indents/${id}/decide`, { action: 'APPROVED' });
      toast(r.message || `${data.docNo} approved`, 'ok');
      reload();
    } catch (e) { toast(e.message, 'bad'); }
  };

  const sendBack = async () => {
    const note = await ask({
      title: `Send ${data.docNo} back to the site?`,
      consequence: 'The site sees your reason at the top of the PRN, changes it and sends it for approval again from level 1.',
      confirm: 'Send back', tone: 'bad',
      note: true, noteLabel: 'Why is it going back?', noteRequired: true,
      noteHint: 'Required — the site sees this',
    });
    if (note === null) return;
    try {
      await api.post(`/indents/${id}/decide`, { action: 'RETURNED', note });
      toast(`${data.docNo} sent back to the site`, 'ok');
      reload();
    } catch (e) { toast(e.message, 'bad'); }
  };

  const submit = async () => {
    try {
      await api.post(`/indents/${id}/submit`);
      toast(`${data.docNo} sent to the site's GM for approval`, 'ok'); reload();
    } catch (e) { toast(e.message, 'bad'); }
  };

  const discard = async () => {
    const ok = await ask({
      title: `Delete draft ${data.docNo}?`,
      consequence: 'The draft and its lines are removed. Nothing was sent, so nobody else is affected.',
      confirm: 'Delete draft', tone: 'bad',
    });
    if (ok === null) return;
    try {
      await api.del(`/indents/${id}`);
      toast(`${data.docNo} deleted`, 'ok');
      nav('/indents');
    } catch (e) { toast(e.message, 'bad'); }
  };

  const mine = canWrite('/indents');
  // offered to the person it waits on — the server says who that is
  const canDecide = data.status === 'SUBMITTED' && Boolean(data.approval?.canApprove)
    && canWrite(`/indents/${id}/decide`);
  const next = prnNext(data);
  const stage = data.pipeline?.stage;

  return (
    <>
      <DocHead kind="PRN · requirement of materials"
        back={<Link to="/indents" className="btn sm ghost" style={{ marginLeft: -8 }}><Icon name="arrowLeft" size={14} />PRNs</Link>}
        docNo={<Code>{data.docNo}</Code>}
        status={<Status is={prnApproval(data)} lg />}
        meta={[
          <><b>{data.site.name}</b></>,
          <>Against <Code>{data.boqDocNo}</Code></>,
          <>Raised by <b>{data.raisedBy || '—'}</b> on {dmy(data.indentDate)}</>,
          data.neededBy && <>Needed by <b>{dmy(data.neededBy)}</b> ({relDays(data.neededBy)})</>,
        ]}
        actions={
          <>
            {data.canEdit && mine && data.status === 'DRAFT' && (
              <button className="btn bad" onClick={discard}>Delete draft</button>
            )}
            {data.canEdit && mine && <Link className="btn" to={`/indents/${id}/edit`}><Icon name="edit" />Change</Link>}
            {data.canEdit && mine && (
              <button className="btn pri" onClick={submit}><Icon name="send" />Send for approval</button>
            )}
            {canDecide && (
              <>
                <button className="btn" onClick={sendBack}>Send back</button>
                <button className="btn pri" onClick={approve}><Icon name="check" />Approve PRN</button>
              </>
            )}
          </>
        } />
      <div className="page-body">
        <NextStep {...next} />

        {data.overLines > 0 && (
          <Banner kind={data.severity === 'bad' ? 'bad' : 'warn'}>
            <b>{plural(data.overLines, 'line')} past the BOQ estimate — {Number(data.worstOverPct).toFixed(1)}% at the
            worst.</b>{' '}
            {data.policy.overAllow && Number(data.policy.overPct) > 0
              ? <>This BOQ allows up to {data.policy.overPct}% over, so this is within what was agreed — but the BOQ
                still needs an amendment before its estimate is right.</>
              : <><b>No ceiling was agreed on this BOQ</b>, so nothing caps how far past the estimate it can go.
                Approve only if the extra quantity is really needed.</>}
          </Banner>
        )}

        {data.pipeline && data.status !== 'DRAFT' && (() => {
          // one column per step, in the order the material moves; "sent"
          // is what left on a challan, "on the road" the part of it
          // nobody at site has received yet
          const n = (v) => Number(v) || 0;
          const cell = (v) => (n(v) ? qty(v) : '—');
          const sum = (k) => data.flow.reduce((t, f) => t + n(f[k]), 0);
          const approved = ['APPROVED', 'CLOSED'].includes(data.status);
          const COLS = [
            ['indented_qty', 'Asked for'], ['ordered_qty', 'PO raised'],
            ['received_qty', 'Received at central store'], ['issued_qty', 'Sent to site'],
            ['in_transit_qty', 'On the road'], ['at_site_qty', 'Received at site'],
            ['to_deliver_qty', 'Pending'],
          ];
          return (
            <Card title="Where the material is"
              sub="Item by item: asked for, on a PO, received at the central store, sent, on the road, received at site, and still pending"
              actions={
                <button className="btn sm" onClick={() => downloadCsv(`prn-${data.docNo}`, [
                  ['PRN', data.docNo], ['Site', data.site.name],
                  ['Stage', prnStage(stage).label], [],
                  ['Item code', 'Item', 'Unit', ...COLS.map((c) => c[1]), 'Order awaiting approval',
                    'Not ordered yet'],
                  ...data.flow.map((f) => [f.item_code, f.item_name, f.uom, ...COLS.map((c) => f[c[0]]),
                    f.pending_gm_qty, f.to_order_qty]),
                ])}><Icon name="download" size={14} />Download</button>
              }>
              <div className="pad">
                <Journey stage={stage} />
                <div className="stats" style={{ marginTop: 18 }}>
                  {COLS.map(([k, label]) => (
                    <Stat key={k} n={qty(data.pipeline[k])} label={label.toLowerCase()}
                      tone={k === 'to_deliver_qty' && !n(data.pipeline[k]) ? 'ok' : undefined} />
                  ))}
                </div>
              </div>

              <div className="tw">
                <table>
                  <thead>
                    <tr>
                      <th style={{ width: 110 }}>Item code</th><th>Item</th><th style={{ width: 62 }}>Unit</th>
                      {COLS.map(([k, label]) => <th key={k} className="rt">{label}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {data.flow.map((f) => (
                      <tr key={`${f.item_id}-${f.make_id || ''}`}>
                        <td style={{ whiteSpace: 'nowrap' }}><Code>{f.item_code}</Code></td>
                        <td>{f.item_name}{f.make_name && <small>{f.make_name}</small>}</td>
                        <td>{f.uom}</td>
                        <td className="rt mono"><b>{qty(f.indented_qty)}</b></td>
                        <td className="rt mono">
                          {cell(f.ordered_qty)}
                          {n(f.pending_gm_qty) > 0 && (
                            <small>{qty(f.pending_gm_qty)} on an order awaiting approval</small>
                          )}
                          {approved && n(f.to_order_qty) > 0 && (
                            <small style={{ color: 'var(--bad)' }}>{qty(f.to_order_qty)} not ordered yet</small>
                          )}
                        </td>
                        <td className="rt mono">{cell(f.received_qty)}</td>
                        <td className="rt mono">{cell(f.issued_qty)}</td>
                        <td className="rt mono">{cell(f.in_transit_qty)}</td>
                        <td className="rt mono">{n(f.at_site_qty) ? <b>{qty(f.at_site_qty)}</b> : '—'}</td>
                        <td className="rt mono">
                          {n(f.to_deliver_qty)
                            ? <b>{qty(f.to_deliver_qty)}</b>
                            : <Status tone="done" label="None" />}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  {data.flow.length > 1 && (
                    <tfoot>
                      <tr>
                        <th colSpan={3} style={{ textAlign: 'left' }}>All items</th>
                        {COLS.map(([k]) => <th key={k} className="rt mono">{qty(sum(k))}</th>)}
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            </Card>
          );
        })()}

        {data.orders?.length > 0 && (
          <Card title="Purchase orders for this PRN">
            <div className="tw">
              <table>
                <thead>
                  <tr><th>PO</th><th>Supplier</th><th>Delivered to</th><th>Expected</th><th>Status</th><th /></tr>
                </thead>
                <tbody>
                  {data.orders.map((o) => {
                    const st = o.status !== 'APPROVED'
                      ? poStage(o.status === 'SUBMITTED' ? 'AWAITING_GM' : o.status)
                      : poStage(o.receipt_state === 'RECEIVED' ? 'RECEIVED' : o.receipt_state === 'PARTIAL' ? 'PARTIAL' : 'AWAITING');
                    return (
                      <tr key={o.id}>
                        <td><Code as="b">{o.doc_no}</Code><small>{dmy(o.po_date)}</small></td>
                        <td>{o.supplier_name}</td>
                        <td>{o.deliver_to_name}
                          <small>{o.deliver_to_type === 'STORE' ? 'Central store' : 'Straight to site'}</small></td>
                        <td className="mono">{o.expected_date ? dmy(o.expected_date) : '—'}
                          {Number(o.overdue) === 1 && <small style={{ color: 'var(--st-stop)', fontWeight: 600 }}>Overdue</small>}</td>
                        <td><Status is={st} /></td>
                        <td className="rt">
                          <Link className="btn sm" to={`/purchase-orders/${o.id}`}>Open PO</Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        )}

        {data.rolledUp && (
          <Card title="Items on this PRN"
            sub="One line per item — this is what Procurement buys and the store picks, whatever BOQ line it was asked for on">
            <div className="tw">
              <table>
                <thead>
                  <tr>
                    <th style={{ width: 110 }}>Item code</th><th>Item</th>
                    <th style={{ width: 76 }}>Unit</th>
                    <th className="rt" style={{ width: 110 }}>Qty</th>
                    <th style={{ width: 180 }}>From BOQ lines</th>
                  </tr>
                </thead>
                <tbody>
                  {data.rollup.map((r) => (
                    <tr key={`${r.item_id}-${r.make_id || ''}`}>
                      <td><Code>{r.item_code}</Code></td>
                      <td><b>{r.item_name}</b>{r.make_name && <small>{r.make_name}</small>}</td>
                      <td>{r.uom}</td>
                      <td className="rt mono"><b>{qty(r.qty)}</b></td>
                      <td>{r.boq_snos}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}

        <Card title={data.rolledUp ? 'BOQ lines it was raised against' : 'Lines'}
          sub={data.rolledUp
            ? 'Kept on the record so a variation can still be traced to the BOQ line it came from'
            : undefined}>
          <div className="tw">
            <table>
              <thead>
                <tr>
                  <th>Sl no</th><th>Item</th><th>Unit</th>
                  <th className="rt">Estimate</th><th className="rt">This PRN</th><th>Against estimate</th>
                </tr>
              </thead>
              <tbody>
                {data.lines.map((l) => (
                  <tr key={l.id}>
                    <td className="sn">{l.sno}</td>
                    <td><b>{l.item_name}</b><small><Code>{l.item_code}</Code>{l.make_name ? ` · ${l.make_name}` : ''}</small></td>
                    <td>{l.uom}</td>
                    <td className="rt mono">{qty(l.effective_est)}</td>
                    <td className="rt mono"><b>{qty(l.qty)}</b></td>
                    <td>
                      {Number(l.over_qty) > 0
                        ? <Status tone={data.severity === 'bad' ? 'stopped' : 'attention'} icon="alert"
                          label={`${qty(l.over_qty)} over`} />
                        : <span style={{ color: 'var(--faint)' }}>Within estimate</span>}
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
              <thead><tr><th style={{ width: 200 }}>What happened</th><th>By</th><th>When</th><th>Note</th></tr></thead>
              <tbody>
                {data.events.map((e, i) => (
                  <tr key={i}>
                    <td><Status tone={eventTone(e.action)} label={eventWord(e.action)} /></td>
                    <td>{e.user_name || '—'}</td>
                    <td className="mono">{dmy(e.created_at)}</td>
                    <td>{e.note || '—'}</td>
                  </tr>
                ))}
                {!data.events.length && <tr><td colSpan={4}><Empty title="Not sent for approval yet" /></td></tr>}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </>
  );
}

export default Indents;
