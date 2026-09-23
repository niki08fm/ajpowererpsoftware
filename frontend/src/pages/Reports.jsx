import { Fragment, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useApp, PageHead } from '../App';
import { qty, money, dmy, today, addDays, withBranch, plural } from '../api';
import { downloadCsv } from '../download';
import {
  useApi, Card, Tag, Empty, Loading, ErrorNote, Banner, Field, Code,
} from '../components/ui';
import {
  TrendChart, RankBars, DonutChart, LineChart, StackedBars, HeatStrip, Treemap,
  Waterfall, DivergingBars, Gauge, Bullet, Sparkline,
} from '../components/charts';

/**
 * What it has cost, and what it has earned.
 *
 * Cost is answerable to the rupee. Every issue and return carries the
 * rate the central store held the item at on the day it moved, and
 * every approved claim carries the amount that was allowed. Add them
 * up over a window and you have what the work cost.
 *
 * Earnings are not answerable at all, and this is the important part.
 * A work order is what a client agreed to pay, not what has been
 * invoiced and not what has been received. Treating an agreement as
 * income is exactly how a business persuades itself it is profitable
 * while running out of money — so the profit and loss screen shows
 * the cost it knows, names the revenue it does not, and refuses to
 * subtract one from the other until somebody has actually billed.
 */

function useFilters(initial) {
  const [params, setParams] = useSearchParams();
  const set = (patch) => setParams((p) => {
    for (const [k, v] of Object.entries(patch)) {
      if (v === '' || v == null) p.delete(k); else p.set(k, String(v));
    }
    return p;
  }, { replace: true });
  const values = Object.fromEntries(
    Object.keys(initial).map((k) => [k, params.get(k) ?? initial[k] ?? '']));
  return [values, set];
}

/** Site or all sites, and a window. Both reports want exactly this. */
function Filters({ f, set, children, dates = true }) {
  const { branchId, branchName } = useApp();
  const { data: sites } = useApi(withBranch('/sites', branchId), [branchId]);
  const preset = (days) => set({ from: addDays(today(), -days), to: today() });
  const fy = () => {
    const n = new Date();
    const y = n.getMonth() + 1 >= 4 ? n.getFullYear() : n.getFullYear() - 1;
    set({ from: `${y}-04-01`, to: today() });
  };
  return (
    <Card>
      <div className="pad" style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <Field label="Site">
          <select className="inp" style={{ width: 230 }} value={f.site}
            onChange={(e) => set({ site: e.target.value })}>
            <option value="">{branchId ? `Every site in ${branchName}` : 'Every site, all branches'}</option>
            {(sites || []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </Field>
        {dates && (
          <>
            <Field label="From">
              <input className="inp" type="date" style={{ width: 150 }} value={f.from}
                onChange={(e) => set({ from: e.target.value })} />
            </Field>
            <Field label="To">
              <input className="inp" type="date" style={{ width: 150 }} value={f.to}
                onChange={(e) => set({ to: e.target.value })} />
            </Field>
            <div style={{ display: 'flex', gap: 5, paddingBottom: 8 }}>
              <button className="btn sm" onClick={() => preset(30)}>30 days</button>
              <button className="btn sm" onClick={() => preset(90)}>90 days</button>
              <button className="btn sm" onClick={fy}>This FY</button>
              <button className="btn sm" onClick={() => set({ from: '', to: '' })}>
                All time
              </button>
            </div>
          </>
        )}
        {children}
      </div>
    </Card>
  );
}

/* ===================================================================
   THE EXPENSE REPORT
   ===================================================================
   Laid out the way a cost statement is always laid out: material
   item by item with its own total, then labour, then everything
   else, then one figure at the bottom. That is the report — the
   charts are a second view of the same numbers, not a different
   report, which is why they are a toggle rather than a screen.

   Material carries a net quantity and an amount, and nothing else.

   No rate, because there is no single rate to show: an item is
   priced at what the central store held it at on the day it moved,
   so cable that went out on Monday at 10 and Tuesday at 13 has two.
   Dividing the amount by the quantity gives 11.50, which was never
   the price of anything, and printing that under a heading saying
   "rate" invites somebody to multiply it back out and get a
   different figure from the one beside it.

   And no issued-and-returned breakdown, because the reader of a cost
   statement wants what was used and what it cost. What went out and
   came back is a stores question, and the Site screens answer it.
   =================================================================== */

const Row = ({ label, amount, strong, tone, sub }) => (
  // a subtotal is shaded, not blacked out — the old --faint was a pale
  // slate and is now a mid grey, which turned every total into a slab
  <tr style={strong ? { background: 'var(--line-2)' } : undefined}>
    <td colSpan={6} style={{ textAlign: 'right', paddingRight: 14 }}>
      {strong ? <b>{label}</b> : label}
      {sub && <div style={{ color: 'var(--muted)', fontSize: 11 }}>{sub}</div>}
    </td>
    <td className="rt mono" style={tone ? { color: `var(--${tone})` } : undefined}>
      {strong ? <b style={{ fontSize: 15 }}>{money(amount)}</b> : money(amount)}
    </td>
  </tr>
);

const SectionHead = ({ title, note }) => (
  <tr>
    <td colSpan={7} style={{
      paddingTop: 18, borderBottom: '2px solid var(--line)', background: 'transparent',
    }}>
      <b style={{ fontSize: 13, letterSpacing: '.04em', textTransform: 'uppercase' }}>
        {title}
      </b>
      {note && <span style={{ color: 'var(--muted)', fontSize: 12 }}> — {note}</span>}
    </td>
  </tr>
);

/* Each section is a different document underneath — items on one,
   claims on the other — so each carries its own column headings
   rather than being forced into a shared row that fits neither. */
const ColHead = ({ cols }) => (
  <tr>
    {cols.map((c, i) => (
      <td key={c.label || i} className={c.rt ? 'rt' : ''} colSpan={c.cs || 1}
        style={{
          color: 'var(--muted)', fontSize: 11, textTransform: 'uppercase',
          letterSpacing: '.04em', paddingTop: 8, paddingBottom: 4,
          borderBottom: '1px solid var(--line)', width: c.w,
        }}>
        {c.label}
      </td>
    ))}
  </tr>
);

const MATERIAL_COLS = [
  { label: 'Code', w: 92 }, { label: 'Item', cs: 3 }, { label: 'Unit', w: 58 },
  { label: 'Consumed', rt: true, w: 130 },
  { label: 'Amount', rt: true, w: 140 },
];

// when the statement is for one site, naming it on every line is
// noise — the column is better spent on who was actually paid
const CLAIM_COLS = (showSite) => [
  { label: 'Date', w: 90 }, { label: 'Document', w: 125 },
  { label: showSite ? 'Site' : 'Paid to', w: 150 },
  { label: 'Kind', w: 140 }, { label: 'What for' },
  { label: 'Comment', w: 230 },
  { label: 'Amount', rt: true, w: 130 },
];

/** The comment the site wrote, and what the approver wrote back. */
function Comment({ row }) {
  const cut = Number(row.claimed_amount) > Number(row.cost_amount) + 0.004;
  if (!row.note && !row.decision_note && !cut) {
    return <span style={{ color: 'var(--muted)' }}>—</span>;
  }
  return (
    <>
      {row.note && <div>{row.note}</div>}
      {cut && (
        <div style={{ color: 'var(--warn)' }}>
          {money(row.claimed_amount)} claimed, {money(row.cost_amount)} allowed
          {row.decision_note ? ` — ${row.decision_note}` : ''}
        </div>
      )}
      {!cut && row.decision_note && (
        <div style={{ color: 'var(--muted)' }}>{row.decision_note}</div>
      )}
    </>
  );
}

function ClaimRows({ rows, showSite }) {
  return rows.map((r) => (
    <tr key={r.expense_id}>
      <td>{dmy(r.spent_on)}</td>
      <td><Code>{r.doc_no}</Code></td>
      <td>
        {showSite ? r.site_name
          : (r.paid_to || <span style={{ color: 'var(--muted)' }}>—</span>)}
        {!showSite && r.bill_no && (
          <div style={{ color: 'var(--muted)', fontSize: 11 }}>bill {r.bill_no}</div>
        )}
      </td>
      <td>{r.category}</td>
      <td>
        <b>{r.description}</b>
        {showSite && r.paid_to && (
          <div style={{ color: 'var(--muted)', fontSize: 11 }}>
            paid to {r.paid_to}{r.bill_no ? ` · bill ${r.bill_no}` : ''}
          </div>
        )}
      </td>
      <td style={{ fontSize: 12 }}><Comment row={r} /></td>
      <td className="rt mono"><b>{money(r.cost_amount)}</b></td>
    </tr>
  ));
}

/* ===================================================================
   THE EXPENSE REPORT — the analysis, then the statement
   ===================================================================
   It opens on what the money did rather than on eleven hundred rows.

   The order is the order somebody asks the questions in: how much,
   then what on, then which items and which sites, then when — and the
   statement itself, which is the document people print and argue
   over, waits at the bottom until it is asked for.

   The statement has not changed a line. It is the same cost statement
   as before, folded rather than removed, because a cost statement is
   a legal artefact and the charts are a way of looking at it.
   =================================================================== */

/** A figure with its share of the total, and its own shape. */
const Kpi = ({ cap, value, foot, tone, share, spark, sparkTone }) => (
  <div className={`ov-tile ${tone || ''}`}>
    <span className="ribbon" />
    <span className="cap">{cap}</span>
    <div className="fig"><b className="num">{value}</b></div>
    {foot && <div className="foot">{foot}</div>}
    {share != null && (
      <div className="meter" aria-hidden="true"><i style={{ width: `${share}%` }} /></div>
    )}
    {spark && spark.length > 1 && (
      <Sparkline values={spark} tone={sparkTone || 'brand'} width={150} height={28} />
    )}
  </div>
);

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

export function ExpenseReport() {
  const { branchId } = useApp();
  const [f, set] = useFilters({
    site: '', from: '', to: '', bucket: 'month', source: 'ALL',
  });
  const [shape, setShape] = useState('stacked');

  const qs = new URLSearchParams({
    ...(branchId ? { branchId } : {}),
    ...(f.site ? { siteId: f.site } : {}),
    ...(f.from ? { from: f.from } : {}),
    ...(f.to ? { to: f.to } : {}),
    ...(f.source !== 'ALL' ? { source: f.source } : {}),
    bucket: f.bucket,
  }).toString();

  const st = useApi(`/costs/expense/statement?${qs}`, [qs]);
  const ch = useApi(`/costs/expense?${qs}`, [qs]);
  const d = st.data;
  const a = ch.data;
  const showSite = !f.site;

  const view = useMemo(() => {
    if (!d) return null;
    const t = d.totals;
    const total = Number(t.total) || 0;
    const pct = (v) => (total > 0 ? (Number(v) / total) * 100 : 0);
    const series = a?.series || [];
    // the expense categories on their own: "cable" and "transport" are
    // not comparable, so material stays out of this ranking
    const cats = (a?.byCategory || []).filter((c) => c.source === 'EXPENSE');
    const spend = series.map((s) => Number(s.total) || 0);
    const busiest = series.reduce((best, s) =>
      (Number(s.total) > Number(best?.total || -1) ? s : best), null);
    // the counts are on the analysis payload; the statement carries
    // the money only, and printing "undefined entries" is worse than
    // printing nothing
    return {
      t,
      total,
      pct,
      series,
      cats,
      spend,
      busiest,
      entries: Number(a?.totals?.entries) || 0,
      sites: Number(a?.totals?.sites) || 0,
      // a donut of one slice is a circle: it says 100% of something we
      // already printed above it, and nothing about a mix
      mix: [
        { label: 'Material', value: Number(t.material) || 0, tone: 'brand' },
        { label: 'Labour', value: Number(t.labour) || 0, tone: 'warn' },
        { label: 'Other expenses', value: Number(t.other) || 0, tone: 'ok' },
      ].filter((x) => x.value > 0),
      avg: spend.length ? spend.reduce((x, y) => x + y, 0) / spend.length : 0,
      quiet: !spend.some((v) => v),
      multiSite: (a?.bySite || []).length > 1,
    };
  }, [d, a]);

  const grab = () => {
    const window = f.from || f.to
      ? `${f.from ? dmy(f.from) : 'the beginning'} to ${f.to ? dmy(f.to) : dmy(today())}`
      : 'all time';
    const rows = [
      ['EXPENSE REPORT'],
      ['Site', d.site ? `${d.site.name} (${d.site.code})` : 'Every site in the chosen branch'],
      ...(d.site?.client_name ? [['Client', d.site.client_name]] : []),
      ['Period', window],
      [],
      ['Material is priced at what the central store held each item at on the day it moved,'],
      ['so an item that moved on several days has no single rate. The amount is the sum of'],
      ['each day at that day’s price.'],
      [],
      ['MATERIAL CONSUMED'],
      ['Code', 'Item', 'Unit', 'Consumed', 'Amount'],
      ...d.material.rows.map((r) => [
        r.item_code, r.item_name, r.uom, r.qty, r.amount,
      ]),
      ['', '', '', 'Total material', d.totals.material],
      [],
      ['LABOUR'],
      ['Date', 'Document', 'Site', 'Kind', 'What for', 'Paid to', 'Comment',
        'Claimed', 'Approved'],
      ...d.labour.rows.map((r) => [
        dmy(r.spent_on), r.doc_no, r.site_name, r.category, r.description, r.paid_to || '',
        [r.note, r.decision_note].filter(Boolean).join(' / '),
        r.claimed_amount, r.cost_amount,
      ]),
      ['', '', '', '', '', '', '', 'Total labour', d.totals.labour],
      [],
      ['OTHER EXPENSES'],
      ['Date', 'Document', 'Site', 'Kind', 'What for', 'Paid to', 'Comment',
        'Claimed', 'Approved'],
      ...d.other.groups.flatMap((g) => [
        ...g.rows.map((r) => [
          dmy(r.spent_on), r.doc_no, r.site_name, r.category, r.description, r.paid_to || '',
          [r.note, r.decision_note].filter(Boolean).join(' / '),
          r.claimed_amount, r.cost_amount,
        ]),
        ['', '', '', '', '', '', '', `Total ${g.category}`, g.total],
      ]),
      ['', '', '', '', '', '', '', 'Total other expenses', d.totals.other],
      [],
      ['SUMMARY'],
      ['Material consumed', d.totals.material],
      ['Labour', d.totals.labour],
      ['Other expenses', d.totals.other],
      ['TOTAL', d.totals.total],
      ...(Number(d.totals.beforeWindow)
        ? [['Spent before this period', d.totals.beforeWindow],
          ['TOTAL TO DATE', d.totals.toDate]]
        : []),
    ];
    downloadCsv(`expense-report${d.site ? `-${d.site.code}` : ''}`, rows);
  };

  return (
    <>
      <PageHead title="Expense report"
        sub={d?.site
          ? `${d.site.name} — material consumed, labour, and every other approved expense`
          : 'Material consumed, labour, and every other approved expense'}
        actions={<button className="btn" onClick={grab} disabled={!d}>Download</button>} />

      <div className="page-body">
        {st.error && <ErrorNote error={st.error} onRetry={st.reload} />}

        <Filters f={f} set={set}>
          <Field label="Show">
            <select className="inp" style={{ width: 170 }} value={f.source}
              onChange={(e) => set({ source: e.target.value })}>
              <option value="ALL">Material and expenses</option>
              <option value="MATERIAL">Material only</option>
              <option value="EXPENSE">Expenses only</option>
            </select>
          </Field>
          <Field label="Group by">
            <select className="inp" style={{ width: 110 }} value={f.bucket}
              onChange={(e) => set({ bucket: e.target.value })}>
              <option value="day">Day</option>
              <option value="week">Week</option>
              <option value="month">Month</option>
            </select>
          </Field>
        </Filters>

        {st.loading || !d ? <Loading /> : (
          <>
            {a?.pending?.claims > 0 && (
              <Banner kind="info" icon="clock">
                <b>{money(a.pending.amount)}</b> across {a.pending.claims} claim
                {a.pending.claims === 1 ? '' : 's'} is with the GM for a decision and is in none of
                these figures.
              </Banner>
            )}

            {/* ---- 1. how much ------------------------------------- */}
            <div className="ov-grid">
              <Kpi cap="Total cost" value={money(view.total)}
                foot={f.from
                  ? `${dmy(f.from)} to ${f.to ? dmy(f.to) : dmy(today())}`
                  : view.entries
                    ? `${plural(view.entries, 'entry', 'entries')} across ${plural(view.sites, 'site')}`
                    : 'all time'}
                spark={view.spend} />
              <Kpi cap="Material consumed" value={money(view.t.material)}
                foot={`${Math.round(view.pct(view.t.material))}% of the total`}
                share={view.pct(view.t.material)} />
              <Kpi cap="Labour" value={money(view.t.labour)}
                foot={`${Math.round(view.pct(view.t.labour))}% of the total`}
                share={view.pct(view.t.labour)} />
              <Kpi cap="Other expenses" value={money(view.t.other)}
                foot={`${Math.round(view.pct(view.t.other))}% of the total`}
                share={view.pct(view.t.other)} />
              {Number(view.t.beforeWindow) > 0 && (
                <Kpi cap="Total to date" value={money(view.t.toDate)}
                  foot={`${money(view.t.beforeWindow)} of it before this window`} />
              )}
            </div>

            {/* ---- 2. what on -------------------------------------- */}
            <div className="ov-row two">
              <Panel title="What the money went on"
                sub="material against labour against everything else">
                {view.mix.length > 1 ? (
                  <DonutChart centreLabel="total cost" parts={view.mix} />
                ) : view.mix.length === 1 ? (
                  <div style={{ padding: '18px 4px' }}>
                    <div style={{ fontSize: 13.5, lineHeight: 1.6, marginBottom: 14 }}>
                      Every rupee in this window was <b>{view.mix[0].label.toLowerCase()}</b> —{' '}
                      <b className="mono">{money(view.total)}</b> of it. There is no mix to
                      split while the other two are nil.
                    </div>
                    <Bullet rows={[
                      { label: 'Material', value: view.t.material, target: view.total, tone: 'brand' },
                      { label: 'Labour', value: view.t.labour, target: view.total, tone: 'warn' },
                      { label: 'Other expenses', value: view.t.other, target: view.total, tone: 'ok' },
                    ]} format={money} />
                  </div>
                ) : <Empty title="Nothing spent in this window" />}
              </Panel>

              <Panel title="Expenses by kind"
                sub="approved claims, material set aside">
                {view.cats.length ? (
                  <RankBars rows={view.cats} labelKey="category" valueKey="amount" max={8} />
                ) : (
                  <Empty title="No approved expenses in this window">
                    Claims count here once somebody approves them.
                  </Empty>
                )}
              </Panel>
            </div>

            {/* ---- 3. when ----------------------------------------- */}
            <div className="ov-row">
              <Panel title={`Spending by ${f.bucket}`}
                sub={view.busiest
                  ? `busiest ${f.bucket}: ${dmy(view.busiest.bucket)} at ${money(view.busiest.total)}`
                  : 'material and expenses, period by period'}
                aside={
                  <div className="seg" role="group" aria-label="chart shape">
                    {[['stacked', 'Stacked'], ['running', 'To date'], ['heat', 'Heat']].map(([k, l]) => (
                      <button key={k} type="button" className={shape === k ? 'on' : ''}
                        onClick={() => setShape(k)}>{l}</button>
                    ))}
                  </div>
                }>
                {ch.loading && !a ? <Loading />
                  : view.quiet ? (
                    <Empty title="Nothing in this window">
                      Widen the dates, or clear a filter.
                    </Empty>
                  ) : shape === 'heat' ? (
                    <HeatStrip series={view.series} bucket={f.bucket} format={money} lines={[
                      { key: 'material', label: 'Material', tone: 'brand' },
                      { key: 'expense', label: 'Expenses', tone: 'warn' },
                      { key: 'total', label: 'Total', tone: 'ok' },
                    ]} />
                  ) : shape === 'running' ? (
                    <TrendChart series={view.series} bucket={f.bucket}
                      valueKey="total" runningKey="running_value" label="cost" />
                  ) : (
                    <StackedBars series={view.series} bucket={f.bucket} height={250} stacked
                      lines={[
                        { key: 'material', label: 'Material', tone: 'brand' },
                        { key: 'expense', label: 'Expenses', tone: 'warn' },
                      ]} />
                  )}
                <div style={{
                  marginTop: 12, display: 'flex', gap: 22, flexWrap: 'wrap',
                  fontSize: 12.5, color: 'var(--muted)',
                }}>
                  <span>Average per {f.bucket} <b className="mono" style={{ color: 'var(--ink)' }}>
                    {money(view.avg)}</b></span>
                  {view.busiest && (
                    <span>Heaviest <b className="mono" style={{ color: 'var(--ink)' }}>
                      {money(view.busiest.total)}</b></span>
                  )}
                  <span>Periods <b className="mono" style={{ color: 'var(--ink)' }}>
                    {view.series.length}</b></span>
                </div>
              </Panel>
            </div>

            {/* ---- 4. which items, which sites --------------------- */}
            <div className="ov-row two">
              <Panel title="Where the material went"
                sub="area is the share of the material bill" pad={false}>
                <div style={{ padding: '10px 14px 14px' }}>
                  {a?.byItem?.length
                    ? <Treemap rows={a.byItem} labelKey="item_name" valueKey="amount" height={230} />
                    : <Empty title="No material consumed in this window" />}
                </div>
              </Panel>

              <Panel title={view.multiSite ? 'By site' : 'Dearest material'}
                sub={view.multiSite
                  ? 'which sites are carrying the cost'
                  : 'net of anything returned'}>
                {view.multiSite
                  ? <RankBars rows={a.bySite} labelKey="site_name" valueKey="total" max={10} />
                  : a?.byItem?.length
                    ? <RankBars rows={a.byItem} labelKey="item_name" valueKey="amount"
                      subKey="qty" max={8} />
                    : <Empty title="Nothing to rank" />}
              </Panel>
            </div>

            {/* ---- 5. the statement, on request -------------------- */}
            <details className="fold">
              <summary>
                <span className="mark" aria-hidden="true">{'▶'}</span>
                <div>
                  <h3>The cost statement</h3>
                  <p>
                    Every line behind these figures — material item by item, then labour,
                    then everything else
                  </p>
                </div>
                <div className="sp" />
                <span className="tag brand">{money(view.total)}</span>
              </summary>
              <Statement d={d} showSite={showSite} f={f} bare />
            </details>
          </>
        )}
      </div>
    </>
  );
}

/* --------------------------------------------------- the statement */
function Statement({ d, showSite, f, bare }) {
  // inside the fold it is already in a card; a card in a card is a
  // border for the sake of a border
  const Wrap = bare
    ? ({ children }) => <>{children}</>
    : ({ children }) => (
      <Card title={d.site ? `${d.site.name} — cost statement` : 'Cost statement — every site'}
        sub={d.site?.client_name
          ? `${d.site.client_name}${f.from ? ` · from ${dmy(f.from)}` : ''}`
          : f.from ? `From ${dmy(f.from)}${f.to ? ` to ${dmy(f.to)}` : ''}` : 'All time'}>
        {children}
      </Card>
    );
  return (
    <Wrap>
      <div className="tw">
        <table>
          <tbody>
            <SectionHead title="Material consumed"
              note="each item, net of anything returned" />
            <ColHead cols={MATERIAL_COLS} />
            {d.material.rows.map((r) => (
              <tr key={r.item_id}>
                <td><Code>{r.item_code}</Code></td>
                <td colSpan={3}><b>{r.item_name}</b></td>
                <td>{r.uom}</td>
                <td className="rt mono"><b>{qty(r.qty)}</b></td>
                <td className="rt mono"><b>{money(r.amount)}</b></td>
              </tr>
            ))}
            {!d.material.rows.length && (
              <tr><td colSpan={7} style={{ color: 'var(--muted)' }}>
                No material consumed in this period.
              </td></tr>
            )}
            <Row label="Total material" amount={d.totals.material} strong />

            <SectionHead title="Labour"
              note="approved claims only — what the site asked for is beside what was allowed" />
            <ColHead cols={CLAIM_COLS(showSite)} />
            <ClaimRows rows={d.labour.rows} showSite={showSite} />
            {!d.labour.rows.length && (
              <tr><td colSpan={7} style={{ color: 'var(--muted)' }}>
                No approved labour in this period.
              </td></tr>
            )}
            <Row label="Total labour" amount={d.totals.labour} strong />

            <SectionHead title="Other expenses" note="grouped by what they were for" />
            <ColHead cols={CLAIM_COLS(showSite)} />
            {d.other.groups.map((g) => (
              <Fragment key={g.category_id}>
                <tr>
                  <td colSpan={7} style={{ paddingTop: 10 }}>
                    <b style={{ color: 'var(--brand-ink)' }}>{g.category}</b>
                  </td>
                </tr>
                <ClaimRows rows={g.rows} showSite={showSite} />
                <Row label={`Total ${g.category.toLowerCase()}`} amount={g.total} />
              </Fragment>
            ))}
            {!d.other.groups.length && (
              <tr><td colSpan={7} style={{ color: 'var(--muted)' }}>
                No other approved expenses in this period.
              </td></tr>
            )}
            <Row label="Total other expenses" amount={d.totals.other} strong />

            <tr><td colSpan={7} style={{ paddingTop: 20 }} /></tr>
            <Row label="Material" amount={d.totals.material} />
            <Row label="Labour" amount={d.totals.labour} />
            <Row label="Other expenses" amount={d.totals.other} />
            <tr>
              <td colSpan={6} style={{
                textAlign: 'right', paddingRight: 14, borderTop: '2px solid var(--ink)',
              }}>
                <b style={{ fontSize: 15 }}>TOTAL</b>
              </td>
              <td className="rt mono" style={{ borderTop: '2px solid var(--ink)' }}>
                <b style={{ fontSize: 18 }}>{money(d.totals.total)}</b>
              </td>
            </tr>
            {Number(d.totals.beforeWindow) > 0 && (
              <>
                <Row label={`Spent before ${dmy(f.from)}`} amount={d.totals.beforeWindow}
                  sub="not included in the total above" />
                <Row label="Total to date" amount={d.totals.toDate} strong tone="brand" />
              </>
            )}
          </tbody>
        </table>
      </div>
    </Wrap>
  );
}

/* ===================================================================
   PROFIT AND LOSS
   ===================================================================
   It exists now, because billing does.

   Revenue is raised bills and nothing else — not the work order,
   which is an agreement, and not a draft, which is a working note.
   A site nobody has billed still gets the sentence saying so and a
   way through to the expense report, because showing a cost figure
   under a heading that reads "profit and loss" invites somebody to
   read it as a loss.

   The screen answers three questions in order. What is left, as a
   bridge from billed down to margin — so the reader sees which cost
   did the damage rather than guessing at it from a pie. Whether it is
   getting better or worse, as the two figures period by period, with
   the running pair underneath: cost is spent when material moves and
   revenue arrives when work is certified, so the two rarely land in
   the same month and it is where the running lines cross that the
   work turned profitable. And which sites carry it, as profit above
   and below a centre line, because a loss drawn the same length as a
   gain is the one thing a margin chart must never do.
   =================================================================== */
export function ProfitLoss() {
  const { branchId, branches } = useApp();
  const [f, set] = useFilters({ site: '', from: '', to: '', bucket: 'month' });
  const [shape, setShape] = useState('period');
  const { data: sites } = useApi(withBranch('/sites', branchId), [branchId]);

  const qs = new URLSearchParams({
    ...(branchId ? { branchId } : {}),
    ...(f.site ? { siteId: f.site } : {}),
    ...(f.from ? { from: f.from } : {}),
    ...(f.to ? { to: f.to } : {}),
    bucket: f.bucket,
  }).toString();
  const { data, error, loading, reload } = useApi(`/costs/pl?${qs}`, [qs]);

  const site = (sites || []).find((x) => String(x.id) === String(f.site));
  const branch = (branches || []).find((b) => b.id === branchId);

  const view = useMemo(() => {
    if (!data?.available) return null;
    const series = data.series || [];
    const profitable = series.filter((s) => Number(s.profit) > 0).length;
    // where the running lines cross: the period the work paid for itself
    const turned = series.find((s) => Number(s.running_profit) > 0);
    const billedPct = data.orderValue > 0
      ? (data.revenue.total / data.orderValue) * 100 : 0;
    return {
      series,
      profitable,
      turned,
      billedPct,
      quiet: !series.some((s) => s.revenue || s.cost),
      revSpark: series.map((s) => Number(s.revenue) || 0),
      costSpark: series.map((s) => Number(s.cost) || 0),
      marginSpark: series.map((s) => Number(s.running_profit) || 0),
      // only sites that have been billed can show a margin at all
      billedSites: (data.sites || []).filter((r) => Number(r.bills) > 0),
      unbilledSites: (data.sites || []).filter((r) => !Number(r.bills) && Number(r.cost) > 0),
    };
  }, [data]);

  const grab = () => downloadCsv(`profit-and-loss${site ? `-${site.code || site.id}` : ''}`, [
    ['PROFIT AND LOSS'],
    ['Scope', site ? site.name : (branch ? `Every site in ${branch.name}` : 'Every site, all branches')],
    [],
    ['Revenue — raised bills', data.revenue.total],
    ['  Supply', data.revenue.supply],
    ['  Installation', data.revenue.installation],
    [],
    ['Cost', data.cost.total],
    ['  Material consumed', data.cost.material],
    ['  Labour', data.cost.labour],
    ['  Other expenses', data.cost.other],
    [],
    ['GROSS PROFIT', data.profit.gross],
    ['Margin %', data.profit.marginPct],
    [],
    ['PERIOD BY PERIOD'],
    ['Period', 'Revenue', 'Cost', 'Profit', 'Revenue to date', 'Cost to date', 'Profit to date'],
    ...(data.series || []).map((r) => [
      r.bucket, r.revenue, r.cost, r.profit,
      r.running_revenue, r.running_cost, r.running_profit,
    ]),
    [],
    ['Site', 'Client', 'Work order', 'Revenue', 'Cost', 'Profit', 'Margin %'],
    ...data.sites.map((r) => [
      r.site_name, r.client_name || '', r.order_value, r.revenue, r.cost, r.profit,
      r.margin_pct ?? '',
    ]),
  ]);

  return (
    <>
      <PageHead title="Profit and loss"
        sub={data?.available
          ? `${site ? site.name : (branch ? `Every site in ${branch.name}` : 'Every site, all branches')}`
            + ' — revenue from raised bills, less what the work cost'
          : 'Nothing has been billed in this scope yet'}
        actions={data?.available
          ? <button className="btn" onClick={grab}>Download</button> : null} />

      <div className="page-body">
        {error && <ErrorNote error={error} onRetry={reload} />}

        <Filters f={f} set={set} />

        {loading || !data ? <Loading />
          : !data.available ? (
            <Card>
              <div className="pad" style={{ textAlign: 'center', padding: '46px 24px' }}>
                <div style={{ fontSize: 34, lineHeight: 1, marginBottom: 14 }} aria-hidden="true">
                  ₹
                </div>
                <h2 style={{ margin: '0 0 8px', fontSize: 19 }}>
                  {site
                    ? `${site.name} has not been billed yet`
                    : (branch ? `No site in ${branch.name} has been billed yet` : 'No site in any branch has been billed yet')}
                </h2>
                <p style={{
                  margin: '0 auto 20px', maxWidth: 470, color: 'var(--muted)', lineHeight: 1.7,
                }}>
                  A profit and loss is revenue less cost, and there is no revenue until a
                  bill is raised. A work order is what the client agreed to pay, not what
                  they have been invoiced.
                </p>
                <div style={{ display: 'flex', gap: 9, justifyContent: 'center' }}>
                  <Link className="btn pri"
                    to={site ? `/billing/site/${site.id}` : '/billing'}>
                    {site ? `Bill ${site.name}` : 'Bill a site'}
                  </Link>
                  <Link className="btn"
                    to={`/reports/expense${f.site ? `?site=${f.site}` : ''}`}>
                    See what it has cost
                  </Link>
                </div>
              </div>
            </Card>
          ) : (
            <>
              {/* ---- the figures --------------------------------- */}
              <div className="ov-grid">
                <Kpi cap="Revenue billed" value={money(data.revenue.total)}
                  foot={`${data.revenue.bills} bill${data.revenue.bills === 1 ? '' : 's'} raised`}
                  tone="ok" spark={view.revSpark} sparkTone="ok" />
                <Kpi cap="Cost booked" value={money(data.cost.total)}
                  foot={`${money(data.cost.material)} material · ${money(data.cost.expense)} claims`}
                  spark={view.costSpark} sparkTone="warn" />
                <Kpi cap="Gross profit" value={money(data.profit.gross)}
                  foot={data.profit.gross >= 0
                    ? 'revenue less every booked cost'
                    : 'cost has run ahead of billing'}
                  tone={data.profit.gross >= 0 ? 'ok' : 'bad'}
                  spark={view.marginSpark}
                  sparkTone={data.profit.gross >= 0 ? 'ok' : 'bad'} />
                <Kpi cap="Margin" value={`${data.profit.marginPct}%`}
                  foot="of what has been billed"
                  tone={data.profit.marginPct >= 0 ? '' : 'bad'} />
                {Number(data.unbilledOrderValue) > 0 && (
                  <Kpi cap="Order book not billed" value={money(data.unbilledOrderValue)}
                    foot={`${Math.round(view.billedPct)}% of ${money(data.orderValue)} billed so far`}
                    share={view.billedPct} />
                )}
              </div>

              {data.profit.gross < 0 && (
                <Banner kind="bad" icon="!">
                  This scope has cost <b>{money(Math.abs(data.profit.gross))}</b> more than
                  has been billed. That is normal early on — work is done before it is
                  certified — but it is worth knowing which it is.
                </Banner>
              )}

              {/* ---- how it got there ---------------------------- */}
              <div className="ov-row wide">
                <Panel title="Margin bridge"
                  sub="billed, then each cost knocked off it, down to what is left">
                  <Waterfall steps={[
                    { label: 'Billed', value: data.revenue.total, tone: 'ok' },
                    ...(data.cost.material ? [{ label: 'Material', value: -data.cost.material }] : []),
                    ...(data.cost.labour ? [{ label: 'Labour', value: -data.cost.labour }] : []),
                    ...(data.cost.other ? [{ label: 'Other', value: -data.cost.other }] : []),
                    { label: 'Gross profit', value: data.profit.gross, total: true },
                  ]} />
                </Panel>

                <Panel title="Margin kept"
                  sub={`${money(data.profit.gross)} of every ${money(data.revenue.total)} billed`}>
                  <Gauge value={Math.max(0, data.profit.marginPct)} max={100}
                    tone={data.profit.marginPct >= 25 ? 'ok'
                      : data.profit.marginPct >= 0 ? 'warn' : 'bad'}
                    label="of billed value"
                    format={() => `${data.profit.marginPct}%`} />
                  <div style={{ marginTop: 14 }}>
                    <Bullet
                      rows={[{
                        label: 'Billed against the order book',
                        value: data.revenue.total,
                        target: data.orderValue,
                        tone: 'brand',
                      }]}
                      format={money} />
                  </div>
                </Panel>
              </div>

              {/* ---- is it getting better ------------------------ */}
              <div className="ov-row">
                <Panel title={`Revenue against cost, ${f.bucket} by ${f.bucket}`}
                  sub={view.turned
                    ? `in the black from ${dmy(view.turned.bucket)} onward, taken cumulatively`
                    : 'cost is spent when material moves; revenue arrives when work is certified'}
                  aside={
                    <div className="seg" role="group" aria-label="chart shape">
                      {[['period', 'Each period'], ['running', 'To date'], ['heat', 'Heat']].map(([k, l]) => (
                        <button key={k} type="button" className={shape === k ? 'on' : ''}
                          onClick={() => setShape(k)}>{l}</button>
                      ))}
                    </div>
                  }>
                  {view.quiet ? (
                    <Empty title="Nothing in this window">
                      Widen the dates, or clear the site filter.
                    </Empty>
                  ) : shape === 'heat' ? (
                    <HeatStrip series={view.series} bucket={f.bucket} format={money} lines={[
                      { key: 'revenue', label: 'Billed', tone: 'ok' },
                      { key: 'cost', label: 'Cost', tone: 'warn' },
                    ]} />
                  ) : shape === 'running' ? (
                    <LineChart series={view.series} bucket={f.bucket} height={260} lines={[
                      { key: 'running_revenue', label: 'Billed to date', tone: 'ok' },
                      { key: 'running_cost', label: 'Cost to date', tone: 'warn' },
                      { key: 'running_profit', label: 'Profit to date', tone: 'brand' },
                    ]} />
                  ) : (
                    <StackedBars series={view.series} bucket={f.bucket} height={260}
                      stacked={false} lines={[
                        { key: 'revenue', label: 'Billed', tone: 'ok' },
                        { key: 'cost', label: 'Cost', tone: 'warn' },
                      ]} />
                  )}
                  <div style={{
                    marginTop: 12, display: 'flex', gap: 22, flexWrap: 'wrap',
                    fontSize: 12.5, color: 'var(--muted)',
                  }}>
                    <span>Periods in profit <b className="mono" style={{ color: 'var(--ink)' }}>
                      {view.profitable} of {view.series.length}</b></span>
                    {data.revenue.firstOn && (
                      <span>First bill <b className="mono" style={{ color: 'var(--ink)' }}>
                        {dmy(data.revenue.firstOn)}</b></span>
                    )}
                    {data.revenue.lastOn && (
                      <span>Latest bill <b className="mono" style={{ color: 'var(--ink)' }}>
                        {dmy(data.revenue.lastOn)}</b></span>
                    )}
                  </div>
                </Panel>
              </div>

              {/* ---- who carries it ------------------------------ */}
              <div className="ov-row two">
                <Panel title="Profit by site"
                  sub="above the line is kept, below it is spent and not yet billed">
                  {view.billedSites.length ? (
                    <DivergingBars
                      rows={view.billedSites.map((r) => ({
                        label: r.site_name,
                        value: Number(r.profit),
                        note: r.margin_pct == null ? '' : `${r.margin_pct}%`,
                      }))} />
                  ) : (
                    <Empty title="No site has been billed yet" />
                  )}
                  {view.unbilledSites.length > 0 && (
                    <div style={{ marginTop: 14, fontSize: 12.5, color: 'var(--muted)' }}>
                      {view.unbilledSites.length} site
                      {view.unbilledSites.length === 1 ? '' : 's'} carrying{' '}
                      <b className="mono" style={{ color: 'var(--ink)' }}>
                        {money(view.unbilledSites.reduce((t, r) => t + Number(r.cost), 0))}
                      </b>{' '}
                      of cost with nothing billed — no margin can be struck for them.{' '}
                      <Link to="/billing" style={{ color: 'var(--brand-ink)' }}>Bill a site</Link>
                    </div>
                  )}
                </Panel>

                <Panel title="Where the billed rupee went"
                  sub="cost against what is left of it">
                  <DonutChart centreLabel="billed" parts={[
                    { label: 'Material', value: data.cost.material, tone: 'brand' },
                    { label: 'Labour', value: data.cost.labour, tone: 'warn' },
                    { label: 'Other expenses', value: data.cost.other, tone: 'cat3' },
                    ...(data.profit.gross > 0
                      ? [{ label: 'Gross profit', value: data.profit.gross, tone: 'ok' }]
                      : []),
                  ]} />
                </Panel>
              </div>

              {Number(data.unbilledOrderValue) > 0 && (
                <Banner kind="info" icon="▸"
                  action={<Link className="btn sm" to="/billing">Bill a site</Link>}>
                  <b>{money(data.unbilledOrderValue)}</b> of the work orders here has not
                  been billed. It is not revenue and is not in any figure above.
                </Banner>
              )}

              {/* ---- the statement, on request -------------------- */}
              <details className="fold">
                <summary>
                  <span className="mark" aria-hidden="true">{'▶'}</span>
                  <div>
                    <h3>The statement, and every site</h3>
                    <p>Revenue less cost as a statement, then the same figures site by site</p>
                  </div>
                  <div className="sp" />
                  <span className={`tag ${data.profit.gross >= 0 ? 'ok' : 'bad'}`}>
                    {money(data.profit.gross)}
                  </span>
                </summary>

                <div className="pad">
                  <div className="tw">
                    <table>
                      <tbody>
                        <tr><td colSpan={2}><b>Revenue</b></td>
                          <td className="rt mono"><b>{money(data.revenue.total)}</b></td></tr>
                        <tr><td style={{ paddingLeft: 22 }} colSpan={2}>Supply</td>
                          <td className="rt mono">{money(data.revenue.supply)}</td></tr>
                        <tr><td style={{ paddingLeft: 22 }} colSpan={2}>Installation</td>
                          <td className="rt mono">{money(data.revenue.installation)}</td></tr>
                        <tr><td colSpan={2} style={{ paddingTop: 14 }}><b>Cost</b></td>
                          <td className="rt mono" style={{ paddingTop: 14 }}>
                            <b>{money(data.cost.total)}</b></td></tr>
                        <tr><td style={{ paddingLeft: 22 }} colSpan={2}>Material consumed</td>
                          <td className="rt mono">{money(data.cost.material)}</td></tr>
                        <tr><td style={{ paddingLeft: 22 }} colSpan={2}>Labour</td>
                          <td className="rt mono">{money(data.cost.labour)}</td></tr>
                        <tr><td style={{ paddingLeft: 22 }} colSpan={2}>Other expenses</td>
                          <td className="rt mono">{money(data.cost.other)}</td></tr>
                        <tr>
                          <td colSpan={2} style={{ borderTop: '2px solid var(--ink)' }}>
                            <b style={{ fontSize: 15 }}>Gross profit</b>
                          </td>
                          <td className="rt mono" style={{ borderTop: '2px solid var(--ink)' }}>
                            <b style={{
                              fontSize: 18,
                              color: `var(--${data.profit.gross >= 0 ? 'ok' : 'bad'})`,
                            }}>{money(data.profit.gross)}</b>
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>

                <div className="tw" style={{ borderTop: '1px solid var(--line-2)' }}>
                  <table>
                    <thead>
                      <tr><th>Site</th><th>Client</th><th className="rt">Work order</th>
                        <th className="rt">Revenue</th><th className="rt">Cost</th>
                        <th className="rt">Profit</th><th className="rt">Margin</th></tr>
                    </thead>
                    <tbody>
                      {data.sites.map((r) => (
                        <tr key={r.site_id}>
                          <td><b>{r.site_name}</b></td>
                          <td style={{ color: 'var(--muted)' }}>{r.client_name || '—'}</td>
                          <td className="rt mono">
                            {Number(r.order_value) ? money(r.order_value) : '—'}
                          </td>
                          <td className="rt mono">
                            {Number(r.bills)
                              ? money(r.revenue)
                              : <span style={{ color: 'var(--faint)' }}>Not billed yet</span>}
                          </td>
                          <td className="rt mono">{money(r.cost)}</td>
                          <td className="rt mono">
                            {Number(r.bills)
                              ? <b style={{
                                color: `var(--${Number(r.profit) >= 0 ? 'ok' : 'bad'})`,
                              }}>{money(r.profit)}</b>
                              : <span style={{ color: 'var(--muted)' }}>—</span>}
                          </td>
                          <td className="rt mono">
                            {r.margin_pct == null ? '—' : `${r.margin_pct}%`}
                          </td>
                        </tr>
                      ))}
                      {!data.sites.length && (
                        <tr><td colSpan={7}><Empty title="Nothing here yet" /></td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </details>
            </>
          )}
      </div>
    </>
  );
}
