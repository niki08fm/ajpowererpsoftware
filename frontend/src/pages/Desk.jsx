import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useApp, PageHead } from '../App';
import { money } from '../api';
import { useApi, Tag, Empty, Loading, ErrorNote } from '../components/ui';
import {
  StackedBars, HeatStrip, Waffle, Gauge, Funnel, RadialBars, Treemap, Histogram,
  Bullet, Sparkline, shortNum, shortMoney,
} from '../components/charts';

/**
 * Overview — the first screen of every department.
 *
 * Read top to bottom it answers four questions in order, and stops at
 * whichever one you came for:
 *
 *   1. how are we doing        the figures, each with its own shape
 *   2. where is the work       what the pile is made of, and how late
 *   3. what has been happening the last few weeks, as columns and a heat strip
 *   4. which documents exactly the list — folded shut unless something is late
 *
 * The old desk put a line chart under every department, which was the
 * wrong picture for most of them: a line implies a quantity moving
 * continuously, and "six PRNs raised on Tuesday" is not that. Each
 * question here gets the shape that suits it — a dial for a share, a
 * waffle for a makeup, columns for a count per week, a histogram for a
 * spread — so two charts on a screen no longer look alike.
 *
 * Nothing new is fetched. Every picture is computed from the same
 * /desk/:dept payload the old screen already had.
 */

const TITLES = {
  plan: 'Planning', site: 'Site', store: 'Store', procure: 'Procurement',
  billing: 'Billing', reports: 'Reports',
};

// the things people start most often from each department
const ACTIONS = {
  plan: [
    { label: 'New site', to: '/sites/new', pri: true },
    { label: 'BOQ list', to: '/boq' },
    { label: 'Clients', to: '/clients' },
    { label: 'Item master', to: '/items' },
  ],
  site: [
    { label: 'Raise a PRN', to: '/indents/new', pri: true },
    { label: 'Sign for deliveries', to: '/site/inbox' },
    { label: 'Issue material', to: '/site/issue' },
    { label: 'Claim an expense', to: '/site/expenses' },
  ],
  store: [
    { label: 'PRNs to fulfil', to: '/store/prns', pri: true },
    { label: 'Receive a delivery', to: '/grns' },
    { label: 'Challans', to: '/challans' },
    { label: 'Stock', to: '/stock' },
  ],
  procure: [
    { label: 'To buy', to: '/procurement', pri: true },
    { label: 'Rate comparison', to: '/comparisons' },
    { label: 'Orders', to: '/purchase-orders' },
    { label: 'Suppliers', to: '/suppliers' },
  ],
  billing: [
    { label: 'Bill a site', to: '/billing', pri: true },
    { label: 'Bills raised', to: '/billing/bills' },
  ],
  reports: [
    { label: 'Expense report', to: '/reports/expense', pri: true },
    { label: 'Profit and loss', to: '/reports/pl' },
  ],
};

const whole = (n) => (Number(n) || 0).toLocaleString('en-IN');

/* A card with a heading, used everywhere below. Kept local because the
   overview wants the header row to carry a control now and then. */
const Panel = ({ title, sub, aside, children, pad = true }) => (
  <div className="card">
    <header>
      <div><h3>{title}</h3>{sub && <p>{sub}</p>}</div>
      <div className="sp" />
      {aside}
    </header>
    <div className={pad ? 'pad' : ''}>{children}</div>
  </div>
);

/* How the waiting work splits between late, due soon and comfortable.
   Rings rather than a stacked bar, because each is a share of the same
   whole and the eye compares three arcs faster than three segments. */
const UrgencyPanel = ({ view }) => (
  <Panel title="Urgency" sub="how much of each state the desk is holding">
    <RadialBars parts={[
      { label: 'Late', value: view.late.length, max: view.needs.length, tone: 'bad' },
      { label: 'Due soon', value: view.soon.length, max: view.needs.length, tone: 'warn' },
      {
        label: 'Comfortable',
        value: view.needs.length - view.late.length - view.soon.length,
        max: view.needs.length,
        tone: 'ok',
      },
    ]} />
  </Panel>
);

export default function Desk({ dept }) {
  const { branchId, siteId, storeId, site, store, allBranches, branches } = useApp();
  // Stacking claims the parts add up to a meaningful whole. That is
  // true of "issues + PRNs + acks — how busy was the week" and false of
  // "billed against cost", so more than one line starts side by side
  // and stacking is offered rather than assumed.
  const [pickedShape, setShape] = useState(null);

  const q = new URLSearchParams();
  if (dept === 'site') { if (siteId) q.set('siteId', siteId); }
  else if (dept === 'store') { if (storeId) q.set('storeId', storeId); }
  else if (branchId) q.set('branchId', branchId);
  const ready = dept === 'site' ? !!siteId : dept === 'store' ? !!storeId : true;
  const { data, error, loading, reload } = useApi(ready ? `/desk/${dept}?${q}` : null, [dept, q.toString()]);

  const where = dept === 'site' ? site?.name
    : dept === 'store' ? store?.name
      : allBranches ? 'every branch'
        : (branches || []).find((b) => b.id === branchId)?.name;

  /* ---- everything the pictures need, derived from the one payload ---- */
  const view = useMemo(() => {
    if (!data) return null;
    const needs = data.needs || [];
    const tiles = (data.tiles || []).filter((t) => !t.money);
    const load = tiles.reduce((a, t) => a + (Number(t.n) || 0), 0);

    const late = needs.filter((n) => n.severity === 'bad');
    const soon = needs.filter((n) => n.severity === 'warn');
    const onTime = needs.length - late.length;

    // what the pile is made of, by the kind of document
    const byKind = Object.values(needs.reduce((acc, n) => {
      acc[n.kind] = acc[n.kind] || { label: n.kind, value: 0, amount: 0 };
      acc[n.kind].value += 1;
      acc[n.kind].amount += Number(n.amount) || 0;
      return acc;
    }, {})).sort((a, b) => b.value - a.value);

    const trend = (data.trends || [])[0] || null;
    const totals = trend
      ? trend.lines.map((l) => ({
        ...l,
        total: trend.series.reduce((a, s) => a + (Number(s[l.key]) || 0), 0),
      }))
      : [];
    // A funnel claims each step feeds the next. Only the trend itself
    // knows whether that is true — billed against cost are two separate
    // measures that happen to be ordered by size, and drawing them as a
    // funnel would invent "₹8,660 dropped out" from nothing. So the API
    // says so explicitly, and everything else is compared as rings.
    const isFunnel = !!trend?.funnel && totals.length > 1 && totals[0].total > 0;

    const sparks = trend
      ? trend.series.map((s) => trend.lines.reduce((a, l) => a + (Number(s[l.key]) || 0), 0))
      : [];
    // one line over time is not a pipeline and not a comparison; what
    // there is to say about it is how the latest period sits against
    // the best one and the average, which is a bullet, not a ring
    const single = trend && totals.length === 1 ? {
      label: totals[0].label,
      total: totals[0].total,
      peak: Math.max(...sparks, 0),
      avg: sparks.length ? sparks.reduce((a, b) => a + b, 0) / sparks.length : 0,
      last: sparks[sparks.length - 1] || 0,
    } : null;

    return {
      needs, tiles, load, late, soon, onTime, byKind, trend, totals, isFunnel, sparks, single,
      moneyTiles: (data.tiles || []).filter((t) => t.money),
      anyAmount: needs.some((n) => n.amount),
      // one kind of document is not a composition; a waffle of a single
      // colour and a treemap of one tile both say "100%" and nothing else
      manyKinds: byKind.length > 1,
      // and rings comparing three states are only worth drawing when
      // the work is actually spread across more than one of them
      mixedUrgency: [late.length, soon.length, needs.length - late.length - soon.length]
        .filter((n) => n > 0).length > 1,
      quiet: trend ? sparks.every((v) => !v) : true,
    };
  }, [data]);

  const shape = pickedShape
    || ((view?.trend?.lines.length || 1) > 1 ? 'side' : 'columns');

  return (
    <>
      <PageHead title={`${TITLES[dept]} overview`}
        sub={`${where ? `${where} — ` : ''}how it stands, then what needs you`}
        actions={<button className="btn" onClick={reload}>Refresh</button>} />

      <div className="page-body">
        {error && <ErrorNote error={error} onRetry={reload} />}
        {loading && !data ? <Loading /> : view && (
          <>
            {/* ---- 1. the figures ------------------------------------ */}
            <div className="ov-grid">
              <div className={`ov-tile ${view.late.length ? 'bad' : view.needs.length ? 'warn' : 'ok'}`}>
                <span className="ribbon" />
                <span className="cap">Waiting on this desk</span>
                <div className="fig">
                  <b className="num">{whole(view.needs.length)}</b>
                  {view.late.length > 0 && (
                    <span className="delta down">{view.late.length} late</span>
                  )}
                </div>
                <div className="foot">
                  {view.needs.length === 0 ? 'Nothing is waiting'
                    : `${view.onTime} still within their date`}
                </div>
                {view.sparks.length > 1 && (
                  <Sparkline values={view.sparks} width={150} height={30}
                    tone={view.late.length ? 'bad' : 'brand'} />
                )}
              </div>

              {view.tiles.map((t) => (
                <Link key={t.key} to={t.to} className={`ov-tile ${t.tone || ''}`}>
                  <span className="ribbon" />
                  <span className="cap">{t.label}</span>
                  <div className="fig"><b className="num">{whole(t.n)}</b></div>
                  <div className="foot">
                    {view.load > 0
                      ? `${Math.round((t.n / view.load) * 100)}% of everything open here`
                      : 'clear'}
                  </div>
                  <div className="meter" aria-hidden="true">
                    <i style={{ width: `${view.load ? (t.n / view.load) * 100 : 0}%` }} />
                  </div>
                </Link>
              ))}

              {view.moneyTiles.map((t) => (
                <Link key={t.key} to={t.to} className={`ov-tile ${t.tone || ''}`}>
                  <span className="ribbon" />
                  <span className="cap">{t.label}</span>
                  <div className="fig"><b className="num">{money(t.n)}</b></div>
                  <div className="foot">in this window</div>
                </Link>
              ))}
            </div>

            <div className="quick">
              {(ACTIONS[dept] || []).map((a) => (
                <Link key={a.to} to={a.to} className={`btn ${a.pri ? 'pri' : ''}`}>{a.label}</Link>
              ))}
            </div>

            {/* ---- 2. where the work is ------------------------------ */}
            {view.needs.length > 0 && (
              <div className={`ov-row ${view.manyKinds ? 'wide'
                : view.mixedUrgency ? 'two' : 'one'}`}>
                {view.manyKinds && (
                  <Panel title="What the pile is made of"
                    sub="one square per percent of everything waiting here">
                    <Waffle parts={view.byKind.slice(0, 5).map((k) => ({ label: k.label, value: k.value }))} />
                  </Panel>
                )}

                <Panel title="Kept to its date"
                  sub={view.late.length
                    ? `${view.late.length} past a date somebody was promised`
                    : 'nothing has slipped'}>
                  <Gauge value={view.onTime} max={view.needs.length}
                    tone={view.late.length ? 'warn' : 'ok'}
                    label={`${view.onTime} of ${view.needs.length} on time`}
                    format={(v) => `${Math.round((v / (view.needs.length || 1)) * 100)}%`} />
                  {/* a spread needs something to spread: three bars and
                      five empty bins say less than the sentence above */}
                  {view.late.length >= 4 && (
                    <div style={{ marginTop: 10 }}>
                      <div className="cap" style={{
                        fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase',
                        letterSpacing: '.06em', marginBottom: 6,
                      }}>How far past, in days</div>
                      <Histogram values={view.late.map((n) => n.late || 0)} unit="days" height={132} />
                    </div>
                  )}
                </Panel>

                {!view.manyKinds && view.mixedUrgency && <UrgencyPanel view={view} />}
              </div>
            )}

            {view.manyKinds && (
              <div className="ov-row two">
                <Panel title={view.anyAmount ? 'The biggest of them, by value' : 'The biggest of them'}
                  sub="area is the share — the large ones are where the day goes"
                  pad={false}>
                  <div style={{ padding: '10px 14px 14px' }}>
                    <Treemap
                      rows={view.byKind.map((k) => ({
                        label: k.label, value: view.anyAmount && k.amount ? k.amount : k.value,
                      }))}
                      height={210}
                      format={view.anyAmount ? money : whole} />
                  </div>
                </Panel>

                <UrgencyPanel view={view} />
              </div>
            )}

            {/* ---- 3. what has been happening ------------------------ */}
            {view.trend && (
              <div className="ov-row two">
                <Panel title={view.trend.title} sub={view.trend.sub}
                  aside={
                    <div className="seg" role="group" aria-label="chart shape">
                      {[['columns', 'Columns'], ['side', 'Side by side'], ['heat', 'Heat']].map(([k, l]) => (
                        <button key={k} type="button" className={shape === k ? 'on' : ''}
                          onClick={() => setShape(k)}>{l}</button>
                      ))}
                    </div>
                  }>
                  {view.quiet ? (
                    <Empty title="Quiet window">
                      Nothing was raised here in this period.
                    </Empty>
                  ) : shape === 'heat' ? (
                    <HeatStrip series={view.trend.series} lines={view.trend.lines}
                      bucket={view.trend.bucket}
                      format={view.trend.unit === 'money' ? money : whole} />
                  ) : (
                    <StackedBars series={view.trend.series} lines={view.trend.lines}
                      bucket={view.trend.bucket} stacked={shape === 'columns'} height={235}
                      format={view.trend.unit === 'money' ? money : whole}
                      axis={view.trend.unit === 'money' ? shortMoney : shortNum} />
                  )}
                </Panel>

                <Panel
                  title={view.isFunnel ? 'How many carried through'
                    : view.single ? `The best ${view.trend.bucket}, and this one`
                      : 'The window in total'}
                  sub={view.isFunnel
                    ? 'everything raised, and how much of it reached the next step'
                    : `over the last ${view.trend.series.length} ${view.trend.bucket}s`}>
                  {view.quiet ? (
                    <Empty title={`Nothing in the last ${view.trend.series.length} ${view.trend.bucket}s`}>
                      The picture fills in as documents are raised.
                    </Empty>
                  ) : view.isFunnel ? (
                    <Funnel
                      steps={view.totals.map((t) => ({ label: t.label, value: t.total, tone: t.tone }))}
                      format={view.trend.unit === 'money' ? money : whole} />
                  ) : view.single ? (
                    <>
                      <Bullet
                        rows={[
                          { label: `Best ${view.trend.bucket}`, value: view.single.peak, tone: 'ok' },
                          { label: 'Average', value: view.single.avg, tone: 'cat3' },
                          { label: `This ${view.trend.bucket}`, value: view.single.last, tone: 'brand' },
                        ].map((r) => ({ ...r, target: view.single.peak }))}
                        format={view.trend.unit === 'money' ? money : whole} />
                      <div style={{ marginTop: 14, fontSize: 12.5, color: 'var(--muted)' }}>
                        {view.single.label} over the whole window:{' '}
                        <b className="mono" style={{ color: 'var(--ink)' }}>
                          {(view.trend.unit === 'money' ? money : whole)(view.single.total)}
                        </b>
                      </div>
                    </>
                  ) : (
                    <RadialBars parts={view.totals.map((t) => ({
                      label: t.label,
                      value: t.total,
                      max: Math.max(...view.totals.map((x) => x.total), 1),
                      tone: t.tone,
                    }))} />
                  )}
                </Panel>
              </div>
            )}

            {/* ---- 4. the documents, folded away --------------------- */}
            <details className="fold" open={view.late.length > 0}>
              <summary>
                <span className="mark" aria-hidden="true">{'▶'}</span>
                <div>
                  <h3>Needs you now</h3>
                  <p>
                    {view.needs.length
                      ? `${view.needs.length} document${view.needs.length === 1 ? '' : 's'}`
                        + `${view.late.length ? ` — ${view.late.length} past a promised date` : ''}, worst first`
                      : 'Nothing waiting'}
                  </p>
                </div>
                <div className="sp" />
                {view.late.length > 0 && <span className="count">{view.late.length} late</span>}
              </summary>

              {view.needs.length ? (
                <div className="tw">
                  <table>
                    <thead>
                      <tr>
                        <th style={{ width: 160 }}>What</th>
                        <th style={{ width: 150 }}>Document</th>
                        <th>Detail</th>
                        <th className="rt" style={{ width: 110 }}>Late by</th>
                        {view.anyAmount && <th className="rt" style={{ width: 120 }}>Value</th>}
                        <th style={{ width: 80 }} />
                      </tr>
                    </thead>
                    <tbody>
                      {view.needs.map((n, i) => (
                        <tr key={`${n.kind}-${n.ref}-${i}`}>
                          <td>
                            {/* status is never colour alone: the word travels with it */}
                            <Tag kind={n.severity || ''}>
                              {n.severity === 'bad' ? '! ' : ''}{n.kind}
                            </Tag>
                          </td>
                          <td><b className="mono">{n.ref}</b></td>
                          <td>{n.title}{n.detail && <small>{n.detail}</small>}</td>
                          <td className="rt mono" style={{ color: n.late ? 'var(--bad)' : 'var(--faint)' }}>
                            {n.late ? `${n.late} day${n.late === 1 ? '' : 's'}` : '—'}
                          </td>
                          {view.anyAmount && (
                            <td className="rt mono">{n.amount ? money(n.amount) : '—'}</td>
                          )}
                          <td className="rt"><Link className="btn sm" to={n.to}>Open</Link></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <Empty title="Your desk is clear">
                  Nothing is late and nothing is waiting on you here.
                </Empty>
              )}
            </details>
          </>
        )}
      </div>
    </>
  );
}
