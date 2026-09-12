import { Fragment } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useApp, PageHead } from '../App';
import { qty, money, dmy, today, addDays } from '../api';
import { downloadCsv } from '../download';
import {
  useApi, Card, Empty, Loading, ErrorNote, Banner, Field, Stat,
} from '../components/ui';
import { TrendChart, RankBars, DonutChart, LineChart } from '../components/charts';

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
  const { branchId } = useApp();
  const { data: sites } = useApi(branchId ? `/sites?branchId=${branchId}` : null, [branchId]);
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
            <option value="">Every site in this branch</option>
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
  <tr style={strong ? { background: 'var(--faint)' } : undefined}>
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
      <td className="mono" style={{ color: 'var(--brand-ink)' }}>{r.doc_no}</td>
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

export function ExpenseReport() {
  const { branchId } = useApp();
  const [f, set] = useFilters({
    site: '', from: '', to: '', bucket: 'month', source: 'ALL', view: 'table',
  });
  const charts = f.view === 'charts';

  const qs = new URLSearchParams({
    ...(branchId ? { branchId } : {}),
    ...(f.site ? { siteId: f.site } : {}),
    ...(f.from ? { from: f.from } : {}),
    ...(f.to ? { to: f.to } : {}),
    ...(f.source !== 'ALL' ? { source: f.source } : {}),
    bucket: f.bucket,
  }).toString();

  const st = useApi(branchId ? `/costs/expense/statement?${qs}` : null, [qs]);
  const ch = useApi(charts && branchId ? `/costs/expense?${qs}` : null, [qs, charts]);
  const d = st.data;
  const showSite = !f.site;

  const grab = () => {
    const window = f.from || f.to
      ? `${f.from ? dmy(f.from) : 'the beginning'} to ${f.to ? dmy(f.to) : dmy(today())}`
      : 'all time';
    const rows = [
      ['EXPENSE REPORT'],
      ['Site', d.site ? `${d.site.name} (${d.site.code})` : 'Every site in this branch'],
      ...(d.site?.client_name ? [['Client', d.site.client_name]] : []),
      ['Period', window],
      [],
      ['Material is priced at what the central store held each item at on the day it moved,'],
      ['so an item that moved on several days has no single rate. The amount is the sum of'],
      ['each day at that day\u2019s price.'],
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
        sub="Material consumed, labour, and every other approved expense"
        actions={
          <div style={{ display: 'flex', gap: 9 }}>
            <div style={{ display: 'flex', gap: 4 }}>
              <button className={`btn ${!charts ? 'pri' : ''}`}
                onClick={() => set({ view: 'table' })}>Statement</button>
              <button className={`btn ${charts ? 'pri' : ''}`}
                onClick={() => set({ view: 'charts' })}>Charts</button>
            </div>
            <button className="btn" onClick={grab} disabled={!d}>Download</button>
          </div>
        } />

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
          {charts && (
            <Field label="Group by">
              <select className="inp" style={{ width: 110 }} value={f.bucket}
                onChange={(e) => set({ bucket: e.target.value })}>
                <option value="day">Day</option>
                <option value="week">Week</option>
                <option value="month">Month</option>
              </select>
            </Field>
          )}
        </Filters>

        {st.loading || !d ? <Loading /> : (
          <>
            <div className="stats">
              <Stat n={money(d.totals.material)} label="material consumed" />
              <Stat n={money(d.totals.labour)} label="labour" />
              <Stat n={money(d.totals.other)} label="other expenses" />
              <Stat n={money(d.totals.total)} label="total" tone="brand" />
              {Number(d.totals.beforeWindow) > 0 && (
                <Stat n={money(d.totals.toDate)} label="to date" />
              )}
            </div>

            {charts ? (
              ch.error ? <ErrorNote error={ch.error} onRetry={ch.reload} />
                : ch.loading || !ch.data ? <Loading />
                  : <ChartView data={ch.data} bucket={f.bucket} totals={d.totals} />
            ) : (
              <Statement d={d} showSite={showSite} f={f} />
            )}
          </>
        )}
      </div>
    </>
  );
}

/* --------------------------------------------------- the statement */
function Statement({ d, showSite, f }) {
  return (
    <Card title={d.site ? `${d.site.name} — cost statement` : 'Cost statement — every site'}
      sub={d.site?.client_name
        ? `${d.site.client_name}${f.from ? ` · from ${dmy(f.from)}` : ''}`
        : f.from ? `From ${dmy(f.from)}${f.to ? ` to ${dmy(f.to)}` : ''}` : 'All time'}>
      <div className="tw">
        <table>
          <tbody>
            <SectionHead title="Material consumed"
              note="each item, net of anything returned" />
            <ColHead cols={MATERIAL_COLS} />
            {d.material.rows.map((r) => (
              <tr key={r.item_id}>
                <td className="mono" style={{ color: 'var(--brand-ink)' }}>{r.item_code}</td>
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
    </Card>
  );
}

/* ------------------------------------------------------ the charts */
function ChartView({ data, bucket, totals }) {
  const expenseCats = (data.byCategory || []).filter((c) => c.source === 'EXPENSE');

  return (
    <>
      {data.pending.claims > 0 && (
        <Banner kind="warn" icon="…"
          action={<Link className="btn sm" to="/site/expenses?status=WAITING">Decide them</Link>}>
          <b>{money(data.pending.amount)}</b> across {data.pending.claims} claim
          {data.pending.claims === 1 ? '' : 's'} is waiting to be approved and is in none of
          these figures.
        </Banner>
      )}

      <div className="grid2">
        <Card title="What the money went on" sub="Material against labour against the rest">
          <div className="pad">
            <DonutChart centreLabel="total cost" parts={[
              { label: 'Material', value: totals.material, tone: 'brand' },
              { label: 'Labour', value: totals.labour, tone: 'warn' },
              { label: 'Other expenses', value: totals.other, tone: 'ok' },
            ]} />
          </div>
        </Card>
        <Card title="Expenses by kind" sub="Approved claims, material set aside">
          <div className="pad">
            {expenseCats.length
              ? <DonutChart centreLabel="expenses"
                parts={expenseCats.map((c) => ({ label: c.category, value: c.amount }))} />
              : <Empty title="No approved expenses in this window">
                Claims count here once somebody approves them.
              </Empty>}
          </div>
        </Card>
      </div>

      <Card title="How it has run"
        sub={`By ${bucket} — material and expenses moving against each other`}>
        <div className="pad">
          <LineChart series={data.series} bucket={bucket} lines={[
            { key: 'total', label: 'Total', tone: 'brand' },
            { key: 'material', label: 'Material', tone: 'navy' },
            { key: 'expense', label: 'Expenses', tone: 'warn' },
          ]} />
        </div>
      </Card>

      <Card title="Cost to date" sub="The running total, period by period">
        <div className="pad">
          <TrendChart series={data.series} bucket={bucket}
            valueKey="total" runningKey="running_value" label="cost" />
        </div>
      </Card>

      <div className="grid2">
        <Card title="By site" sub="Where the money went">
          <div className="pad">
            {data.bySite.length > 1
              ? <DonutChart centreLabel="total"
                parts={data.bySite.map((x) => ({ label: x.site_name, value: x.total }))} />
              : <RankBars rows={data.bySite} labelKey="site_name" valueKey="total" />}
          </div>
        </Card>
        <Card title="Dearest material" sub="Net of anything returned">
          <div className="pad">
            {data.byItem.length
              ? <RankBars rows={data.byItem} labelKey="item_name" valueKey="amount"
                subKey="qty" max={10} />
              : <Empty title="No material consumed in this window" />}
          </div>
        </Card>
      </div>
    </>
  );
}

/* ===================================================================
   PROFIT AND LOSS
   ===================================================================
   There is nothing to show, and the screen says so in a sentence.

   A profit and loss is revenue less cost. Cost is known to the rupee;
   revenue is not known at all, because nothing has been billed. The
   only income-side figure this system holds is the work order — what
   a client agreed to pay — and an agreement is not income.

   So there is no date filter here, because a window over nothing is
   still nothing, and no cost breakdown either: that is the expense
   report's job and duplicating it here would only invite somebody to
   read the cost as though it were a loss. One choice, one sentence,
   one way out to the report that does have the answer.
   =================================================================== */
export function ProfitLoss() {
  const { branchId, branches } = useApp();
  const [f, set] = useFilters({ site: '' });
  const { data: sites } = useApi(branchId ? `/sites?branchId=${branchId}` : null, [branchId]);
  const { data, error, loading, reload } = useApi(
    branchId ? `/costs/pl?${new URLSearchParams({
      branchId, ...(f.site ? { siteId: f.site } : {}),
    })}` : null, [branchId, f.site]);

  const site = (sites || []).find((x) => String(x.id) === String(f.site));
  const branch = (branches || []).find((b) => b.id === branchId);

  return (
    <>
      <PageHead title="Profit and loss"
        sub="Nothing has been billed, so there is nothing to report" />

      <div className="page-body">
        {error && <ErrorNote error={error} onRetry={reload} />}

        <Card>
          <div className="pad" style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <Field label="Site">
              <select className="inp" style={{ width: 260 }} value={f.site}
                onChange={(e) => set({ site: e.target.value })}>
                <option value="">Every site in this branch</option>
                {(sites || []).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
              </select>
            </Field>
          </div>
        </Card>

        {loading || !data ? <Loading /> : data.available ? null : (
          <Card>
            <div className="pad" style={{ textAlign: 'center', padding: '46px 24px' }}>
              <div style={{ fontSize: 34, lineHeight: 1, marginBottom: 14 }} aria-hidden="true">
                ₹
              </div>
              <h2 style={{ margin: '0 0 8px', fontSize: 19 }}>
                {site
                  ? `${site.name} has not been billed yet`
                  : `No site in ${branch?.name || 'this branch'} has been billed yet`}
              </h2>
              <p style={{
                margin: '0 auto 20px', maxWidth: 460, color: 'var(--muted)', lineHeight: 1.7,
              }}>
                A profit and loss is revenue less cost, and there is no revenue until a
                client is invoiced. What {site ? 'this site' : 'the work'} has <em>cost</em>
                {' '}is known to the rupee — it is on the expense report.
              </p>
              <Link className="btn pri"
                to={`/reports/expense${f.site ? `?site=${f.site}` : ''}`}>
                See the expense report{site ? ` for ${site.name}` : ''}
              </Link>
              <p style={{ marginTop: 22, marginBottom: 0, fontSize: 12, color: 'var(--muted)' }}>
                This screen fills in on its own once Billing exists. Nothing about the cost
                side changes when it does.
              </p>
            </div>
          </Card>
        )}
      </div>
    </>
  );
}