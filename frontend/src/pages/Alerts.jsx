import { Link } from 'react-router-dom';
import { PageHead, useApp } from '../App';
import { dmy, plural } from '../api';
import { useApi, Card, Empty, Loading, ErrorNote, Status } from '../components/ui';
import { PrnLink } from '../components/StorePrn';

/**
 * What has gone wrong or is late, for Management, the GM and the store.
 *
 * Worked out live by the server (modules/alerts.routes.js): a challan
 * the site has not signed for a day after dispatch, a short delivery,
 * a purchase order past its expected date. Each one clears itself the
 * moment it is put right — there is nothing here to dismiss.
 */
const KIND = {
  NOT_SIGNED: 'Challan not signed for',
  SHORT_DELIVERY: 'Short delivery',
  PRN_LATE: 'PRN past needed-by',
  PRN_NOT_ORDERED: 'PRN not ordered in time',
  PO_LATE: 'Supplier delivery late',
};

export function AlertList({ rows, compact }) {
  if (!rows.length) {
    return <Empty icon="check" title="Nothing needs attention">Every challan is signed for, and every PRN and order is on time.</Empty>;
  }
  return (
    <div className="tw">
      <table>
        <thead>
          <tr><th style={{ width: 200 }}>What</th><th>Detail</th>{!compact && <th style={{ width: 120 }}>Since</th>}<th /></tr>
        </thead>
        <tbody>
          {rows.map((a) => (
            <tr key={a.key}>
              <td><Status tone={a.tone} icon="alert" label={KIND[a.kind] || a.kind} /></td>
              <td><b>{a.title}</b><small>{a.detail}</small></td>
              {!compact && <td className="mono">{a.since ? dmy(a.since) : '—'}</td>}
              <td className="rt">
                {/* a PRN opens where you are: not every login may open its page */}
                {a.indentId
                  ? <PrnLink id={a.indentId} className="btn sm">Open</PrnLink>
                  : <Link className="btn sm" to={a.link}>Open</Link>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function Alerts() {
  const { refreshAlerts } = useApp();
  const { data, error, loading, reload } = useApi('/alerts');
  const rows = data?.rows || [];
  return (
    <>
      <PageHead title="Alerts"
        sub="Challans not signed for a day after dispatch, short deliveries, PRNs past their needed-by date, and orders past their due date. Each clears itself once it is put right."
        actions={<button className="btn" onClick={() => { reload(); refreshAlerts?.(); }}>Refresh</button>} />
      <div className="page-body">
        {error && <ErrorNote error={error} onRetry={reload} />}
        {loading && !data ? <Loading what="alerts" /> : (
          <Card title={rows.length ? plural(rows.length, 'alert') : 'All clear'}>
            <AlertList rows={rows} />
          </Card>
        )}
      </div>
    </>
  );
}
