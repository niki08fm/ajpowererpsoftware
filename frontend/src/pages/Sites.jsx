import { Link, useNavigate } from 'react-router-dom';
import { useApp, PageHead } from '../App';
import { useApi, Card, Tag, Empty, Loading, ErrorNote, Meter } from '../components/ui';
import { money, dmy, withBranch, canWrite } from '../api';

/** What a site's BOQ is doing, in one chip. */
function BoqCell({ site }) {
  if (!site.workOrder) return <Tag kind="warn">No work order</Tag>;
  if (!site.boq) return <Tag>Not prepared</Tag>;
  const { state, prepared, ofLines, worstOverPct } = site.boq;
  if (state === 'AMENDMENT_DUE') {
    return <Tag kind="bad">▲ Amendment due · {Number(worstOverPct).toFixed(1)}% over</Tag>;
  }
  if (state === 'LOCKED') return <Tag kind="ok">{site.boq.docNo}</Tag>;
  return (
    <div style={{ minWidth: 120 }}>
      <Meter value={prepared} max={ofLines} />
      <small style={{ color: 'var(--muted)' }}>{prepared} of {ofLines} lines prepared</small>
    </div>
  );
}

export default function Sites() {
  const { branchId } = useApp();
  const nav = useNavigate();
  const { data, error, loading, reload } = useApi(withBranch('/sites', branchId), [branchId]);

  return (
    <>
      <PageHead
        title="Sites"
        sub="Every project — its client, its team, and the work order it runs on"
        actions={canWrite('/sites') && <Link className="btn pri" to="/sites/new">New site</Link>}
      />
      <div className="page-body">
        {error && <ErrorNote error={error} onRetry={reload} />}
        {loading ? <Loading /> : (
          <Card>
            <div className="tw">
              <table>
                <thead>
                  <tr>
                    <th>Site</th><th>Branch</th><th>Site head</th><th>Period</th>
                    <th className="rt">Work order</th><th>BOQ</th><th />
                  </tr>
                </thead>
                <tbody>
                  {(data || []).map((s) => (
                    <tr key={s.id} className="click" onClick={() => nav(`/sites/${s.id}`)}>
                      <td>
                        <b>{s.name}</b>
                        <small>{s.code} · {s.client?.name || 'no client'}{s.location ? ` · ${s.location}` : ''}</small>
                      </td>
                      <td>{s.branch.name}</td>
                      <td>
                        {s.head?.name || '—'}
                        <small>
                          {s.keeper ? `store: ${s.keeper.name}` : 'no storekeeper'}
                          {s.teamCount ? ` · +${s.teamCount} on the team` : ''}
                        </small>
                      </td>
                      <td className="mono">
                        {dmy(s.startDate)}
                        <small>{s.targetCompletion ? `to ${dmy(s.targetCompletion)}` : 'no end date'}</small>
                      </td>
                      <td className="rt mono">
                        {s.workOrder ? money(s.workOrder.value) : '—'}
                        {s.workOrder && <small>{s.workOrder.lineCount} lines · {s.workOrder.clientWoNo || s.workOrder.docNo}</small>}
                      </td>
                      <td><BoqCell site={s} /></td>
                      <td className="rt" onClick={(e) => e.stopPropagation()}>
                        {!s.workOrder ? (
                          <Link className="btn sm pri" to={`/sites/${s.id}`}>Load work order</Link>
                        ) : !s.boq ? (
                          <Link className="btn sm pri" to="/boq">Prepare BOQ</Link>
                        ) : (
                          <Link className="btn sm" to="/boq">Open BOQ</Link>
                        )}
                      </td>
                    </tr>
                  ))}
                  {!loading && !(data || []).length && (
                    <tr><td colSpan={7}>
                      <Empty title="No sites in this branch yet">
                        A site is where work happens and cost is booked.{' '}
                        <Link to="/sites/new" style={{ color: 'var(--brand-ink)', textDecoration: 'underline' }}>
                          Create the first one
                        </Link>.
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
