import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { PageHead } from '../App';
import { money, qty, dmy } from '../api';
import { useApi, Card, Tag, Loading, ErrorNote, Banner, Stat, Meter, Empty } from '../components/ui';
import { BoqSheet } from './BoqList';

/**
 * One site read end to end: who runs it, the work order it runs on,
 * and the BOQ that prepares it.
 */
export default function SiteDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const { data: site, error, loading, reload } = useApi(`/sites/${id}`);
  const { data: prog, reload: reloadProg } = useApi(`/progress/site/${id}`, [id]);
  // the sheet opens over this page, not somewhere else
  const [sheet, setSheet] = useState(false);

  if (loading) return <Loading />;
  if (error) return <div className="page-body"><ErrorNote error={error} onRetry={reload} /></div>;

  const boq = prog?.boq;

  return (
    <>
      <PageHead title={site.name}
        sub={`${site.code} · ${site.client?.name || 'no client'} · ${site.branch.name}`}
        actions={
          <div style={{ display: 'flex', gap: 9 }}>
            <button className="btn" onClick={() => nav('/planning/sites')}>Back</button>
            {boq && <button className="btn pri" onClick={() => setSheet(true)}>Open BOQ</button>}
          </div>
        } />
      <div className="page-body">
        {boq?.state === 'AMENDMENT_DUE' && (
          <Banner kind="bad" icon="▲"
            action={<button className="btn sm" onClick={() => setSheet(true)}>Open BOQ</button>}>
            <b>{boq.overLines} line(s) have been indented past their estimate</b> — {Number(boq.worstOverPct).toFixed(1)}%
            at the worst line. A variation quantity has to be recorded before the estimate reads true again.
          </Banner>
        )}

        <div className="grid2">
          <div>
            <Card title="The project">
              <div className="pad">
                <table>
                  <tbody>
                    <tr><td style={{ color: 'var(--muted)', width: 170 }}>Client</td><td><b>{site.client?.name || '—'}</b></td></tr>
                    <tr><td style={{ color: 'var(--muted)' }}>Site head</td><td>{site.head?.name || '—'}</td></tr>
                    <tr><td style={{ color: 'var(--muted)' }}>Storekeeper</td><td>{site.keeper?.name || '—'}</td></tr>
                    <tr><td style={{ color: 'var(--muted)' }}>General manager</td><td>{site.gm?.name || '—'}</td></tr>
                    <tr><td style={{ color: 'var(--muted)' }}>Others on the project</td>
                      <td>{site.team?.length
                        ? site.team.map((t) => <span className="chip" key={t.id} style={{ marginRight: 6 }}>{t.name}<small>{t.department}</small></span>)
                        : <span style={{ color: 'var(--faint)' }}>nobody added</span>}</td></tr>
                    <tr><td style={{ color: 'var(--muted)' }}>Period</td>
                      <td className="mono">{dmy(site.startDate)} — {site.targetCompletion ? dmy(site.targetCompletion) : 'open'}</td></tr>
                    <tr><td style={{ color: 'var(--muted)' }}>Location</td><td>{site.location || '—'}</td></tr>
                    <tr><td style={{ color: 'var(--muted)' }}>Billing address</td><td>{site.billingAddress || '—'}</td></tr>
                  </tbody>
                </table>
              </div>
            </Card>

            {prog?.lines?.length ? (
              <Card title="Indented against the BOQ"
                sub="What has been asked for, and how much of it went past the estimate">
                <div className="tw">
                  <table className="sheet">
                    <thead>
                      <tr>
                        <th style={{ width: 56 }}>Sl No</th><th>Item</th><th style={{ width: 70 }}>Unit</th>
                        <th className="rt">BOQ qty</th><th className="rt">Estimate</th>
                        <th className="rt">Indented</th><th className="rt">Variation</th>
                      </tr>
                    </thead>
                    <tbody>
                      {prog.lines.map((l) => (
                        <tr key={l.sno}>
                          <td className="sn">{l.sno}</td>
                          <td><b>{l.item_name}</b><small className="mono">{l.item_code}</small></td>
                          <td>{l.uom}</td>
                          <td className="rt mono">{qty(l.boq_qty)}</td>
                          <td className="rt mono">
                            {qty(l.effective_est)}
                            {Number(l.var_qty) > 0 && <small style={{ color: 'var(--brand)' }}>incl. +{qty(l.var_qty)} amended</small>}
                          </td>
                          <td className="rt mono">{qty(l.approved_qty)}</td>
                          <td className="rt mono" style={{ color: Number(l.over_qty) > 0 ? 'var(--bad)' : undefined }}>
                            {Number(l.over_qty) > 0
                              ? <><b>▲ {qty(l.over_qty)}</b><small style={{ color: 'var(--bad)' }}>{Number(l.over_pct_actual).toFixed(1)}% over</small></>
                              : <span style={{ color: 'var(--faint)' }}>—</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            ) : (
              <Card title="Indented against the BOQ">
                <Empty title={site.workOrder ? 'The BOQ is not prepared yet' : 'No work order loaded yet'}>
                  {site.workOrder
                    ? 'Prepare it from the BOQ screen to start indenting.'
                    : 'A site runs on its work order — load it to get started.'}
                </Empty>
              </Card>
            )}
          </div>

          <div>
            <Card title="Work order">
              <div className="pad">
                {site.workOrder ? (
                  <>
                    <div className="stats">
                      <Stat n={money(site.workOrder.value)} label={site.workOrder.clientWoNo || site.workOrder.docNo} />
                    </div>
                    <p style={{ color: 'var(--muted)', fontSize: 12.5, marginBottom: 0 }}>
                      {site.workOrder.lineCount} lines. The client's document — it can only change through
                      an amendment.
                    </p>
                  </>
                ) : <Empty title="Not loaded" />}
              </div>
            </Card>

            <Card title="BOQ">
              <div className="pad">
                {boq ? (
                  <>
                    <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 10 }}>
                      <b className="mono">{boq.docNo}</b>
                      {boq.state === 'AMENDMENT_DUE' ? <Tag kind="bad">▲ Amendment due</Tag>
                        : boq.state === 'LOCKED' ? <Tag kind="ok">Locked</Tag> : <Tag kind="warn">Draft</Tag>}
                    </div>
                    <Meter value={boq.prepared} max={boq.ofLines} />
                    <small style={{ color: 'var(--muted)' }}>
                      {boq.prepared} of {boq.ofLines} work order lines prepared
                    </small>
                    <div style={{ marginTop: 12, fontSize: 12.5, color: 'var(--muted)' }}>
                      Beyond the estimate:{' '}
                      {boq.policy.overAllow
                        ? (Number(boq.policy.overPct) ? `${boq.policy.overPct}% allowed` : 'allowed, no ceiling')
                        : 'not allowed'}
                    </div>
                  </>
                ) : <Empty title="Not prepared" />}
              </div>
            </Card>

            {prog && (
              <Card title="Material">
                <div className="pad stats">
                  <Stat n={qty(prog.totals.indented)} label="indented" />
                  <Stat n={qty(prog.totals.consumed)} label="used" />
                  <Stat n={qty(prog.totals.atSite)} label="at site" tone="brand" />
                </div>
              </Card>
            )}
          </div>
        </div>
      </div>

      {sheet && boq && (
        <BoqSheet boqId={boq.id} onClose={() => { setSheet(false); reload(); reloadProg(); }} />
      )}
    </>
  );
}
