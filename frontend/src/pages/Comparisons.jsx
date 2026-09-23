import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useApp, PageHead } from '../App';
import { api, qty, money, dmy, canWrite, plural } from '../api';
import { downloadCsv } from '../download';
import {
  useApi, Card, Empty, Loading, ErrorNote, Banner, Field, Modal, Stat, useToast, Code, Status,
  DocHead, NextStep,
} from '../components/ui';
import { Icon } from '../components/icons';
import { withWhom } from '../vocab';

/**
 * Rate comparison.
 *
 * A rate is not a price. The discount comes off, the freight goes on,
 * and the supplier who quoted lowest is regularly not the one it is
 * cheapest to buy from. This sheet reports both, and says so plainly
 * when they differ — which is the only reason it exists.
 *
 * Choosing a supplier is not the end: the choice is approved twice
 * (Management, both levels) before an order can be raised from it.
 * Trial 1 offered "Raise the order" the moment a supplier was chosen,
 * which the server then refused, and hid it once the sheet was
 * approved. Here the button appears exactly when it will work.
 */
const STATUS = {
  DRAFT: { tone: 'neutral', icon: 'draft', label: 'Comparing', hint: 'Quotes are being entered. No supplier chosen yet.' },
  DECIDED: { tone: 'info', icon: 'clock', label: 'Supplier chosen · awaiting approval', hint: 'An order can be raised once both approvals are done.' },
  APPROVED: { tone: 'done', icon: 'check', label: 'Approved', hint: 'An order can be raised from it.' },
};
const cmpStatus = (s) => STATUS[s] || { tone: 'neutral', label: s };

/* =================================================================== */
export function Comparisons() {
  const { branchId } = useApp();
  const nav = useNavigate();
  const [f, setF] = useState({ q: '', status: 'ALL' });
  const qs = new URLSearchParams({
    ...(branchId ? { branchId } : {}), ...(f.q ? { q: f.q } : {}), status: f.status,
  }).toString();
  const { data, error, loading, reload } = useApi(`/comparisons?${qs}`,
    [branchId, qs]);
  const rows = data || [];

  const grab = () => downloadCsv('rate-comparisons', [
    ['Comparison', 'Title', 'Items', 'Suppliers quoting', 'Lowest quote', 'Lowest landed cost', 'Landed cost', 'Status', 'Chosen'],
    ...rows.map((r) => [r.doc_no, r.title || '', r.item_count, r.supplier_count,
      r.best_quoted_supplier_name || '', r.best_landed_supplier_name || '', r.best_landed || '',
      cmpStatus(r.status).label, r.chosen_supplier_name || '']),
  ]);

  return (
    <>
      <PageHead title="Rate comparisons"
        sub="What each supplier costs once discount and freight are counted — not just what they quoted"
        actions={
          <>
            <button className="btn" onClick={grab} disabled={!rows.length}><Icon name="download" size={14} />Download</button>
            {canWrite('/comparisons') && <Link className="btn pri" to="/procurement"><Icon name="plus" />Start from To buy</Link>}
          </>
        } />
      <div className="page-body">
        {error && <ErrorNote error={error} onRetry={reload} />}
        <Card>
          <div className="pad searchbar" style={{ marginBottom: 0 }}>
            <Field label="Search">
              <input className="inp" type="search" style={{ width: 240 }} placeholder="Comparison number or title…"
                value={f.q} onChange={(e) => setF((x) => ({ ...x, q: e.target.value }))} />
            </Field>
            <Field label="Status">
              <select className="inp" style={{ width: 250 }} value={f.status}
                onChange={(e) => setF((x) => ({ ...x, status: e.target.value }))}>
                <option value="ALL">Everything</option>
                <option value="DRAFT">{STATUS.DRAFT.label}</option>
                <option value="DECIDED">{STATUS.DECIDED.label}</option>
                <option value="APPROVED">{STATUS.APPROVED.label}</option>
              </select>
            </Field>
          </div>
        </Card>

        {loading && !data ? <Loading what="rate comparisons" /> : (
          <Card title={plural(rows.length, 'rate comparison')}>
            <div className="tw">
              <table>
                <thead>
                  <tr>
                    <th>Comparison</th><th>For</th>
                    <th className="rt">Items</th><th className="rt">Suppliers</th>
                    <th>Lowest quote</th><th>Lowest landed cost</th>
                    <th className="rt">Landed cost</th><th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.comparison_id} className="click" tabIndex={0}
                      onClick={() => nav(`/comparisons/${r.comparison_id}`)}
                      onKeyDown={(e) => { if (e.key === 'Enter') nav(`/comparisons/${r.comparison_id}`); }}>
                      <td><Code as="b">{r.doc_no}</Code><small>{dmy(r.created_at)}</small></td>
                      <td>{r.title || <span style={{ color: 'var(--faint)' }}>—</span>}</td>
                      <td className="rt mono">{r.item_count}</td>
                      <td className="rt mono">{r.supplier_count}</td>
                      <td>{r.best_quoted_supplier_name || '—'}</td>
                      <td>
                        {r.best_landed_supplier_name || '—'}
                        {r.best_landed_supplier_id && r.best_quoted_supplier_id
                          && r.best_landed_supplier_id !== r.best_quoted_supplier_id && (
                          <small>Not the lowest quote</small>
                        )}
                      </td>
                      <td className="rt mono">{r.best_landed ? money(r.best_landed) : '—'}</td>
                      <td>
                        <Status is={cmpStatus(r.status)} />
                        {r.chosen_supplier_name && <small>Chosen: {r.chosen_supplier_name}</small>}
                      </td>
                    </tr>
                  ))}
                  {!rows.length && (
                    <tr><td colSpan={8}>
                      <Empty title="No rate comparisons yet">
                        Tick PRNs on <Link className="linkish" to="/procurement">To buy</Link> and choose
                        Compare rates before raising the purchase order.
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

/* ===================================================================
   The comparison itself.
   =================================================================== */
export function ComparisonDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const toast = useToast();
  const { data, error, loading, reload } = useApi(`/comparisons/${id}`, [id]);
  const { data: suppliers } = useApi('/suppliers');
  const [rates, setRates] = useState({});      // "itemId:csId" -> string
  const [dirty, setDirty] = useState(false);
  const [adding, setAdding] = useState('');
  const [deciding, setDeciding] = useState(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!data) return;
    setRates(Object.fromEntries(data.quotes.map((q) =>
      [`${q.comparison_item_id}:${q.comparison_supplier_id}`, String(q.rate)])));
    setDirty(false);
  }, [data]);

  if (loading && !data) return <Loading what="the rate comparison" />;
  if (error) return <div className="page-body" style={{ paddingTop: 24 }}><ErrorNote error={error} onRetry={reload} /></div>;

  const key = (itemId, csId) => `${itemId}:${csId}`;
  const rateOf = (itemId, csId) => rates[key(itemId, csId)] ?? '';

  /** The same arithmetic the server does, so the totals update as you type. */
  const totals = data.suppliers.map((s) => {
    const basic = data.items.reduce((t, i) => {
      const r = Number(rateOf(i.id, s.comparison_supplier_id));
      return t + (Number.isFinite(r) ? r * Number(i.qty) : 0);
    }, 0);
    const quoted = data.items.filter((i) => Number(rateOf(i.id, s.comparison_supplier_id)) > 0).length;
    const disc = (basic * Number(s.discount_pct)) / 100;
    return {
      ...s, basic, quoted, discountAmt: disc, landed: basic - disc + Number(s.freight),
      complete: quoted === data.items.length,
    };
  });
  const priced = totals.filter((t) => t.quoted > 0);
  const bestLanded = priced.length
    ? priced.reduce((a, b) => (b.landed < a.landed ? b : a)) : null;
  const bestQuoted = priced.length
    ? priced.reduce((a, b) => (b.basic < a.basic ? b : a)) : null;
  const split = bestLanded && bestQuoted
    && bestLanded.comparison_supplier_id !== bestQuoted.comparison_supplier_id;

  const saveRates = async () => {
    setBusy(true);
    try {
      await api.put(`/comparisons/${id}/quotes`, {
        quotes: data.items.flatMap((i) => data.suppliers.map((s) => {
          const v = rateOf(i.id, s.comparison_supplier_id);
          return {
            comparisonItemId: i.id,
            comparisonSupplierId: s.comparison_supplier_id,
            rate: v === '' ? null : Number(v),
          };
        })),
      });
      toast('Rates saved', 'ok');
      reload();
    } catch (e) { toast(e.message, 'bad'); }
    setBusy(false);
  };

  const addSupplier = async () => {
    if (!adding) return;
    try {
      await api.post(`/comparisons/${id}/suppliers`, { supplierId: Number(adding) });
      setAdding(''); reload();
    } catch (e) { toast(e.message, 'bad'); }
  };

  const setTerm = async (csId, field, value) => {
    try {
      await api.patch(`/comparisons/${id}/suppliers/${csId}`, { [field]: Number(value) || 0 });
      reload();
    } catch (e) { toast(e.message, 'bad'); }
  };

  const decide = async () => {
    setBusy(true);
    try {
      const r = await api.post(`/comparisons/${id}/decide`, {
        supplierId: deciding.supplier_id, note: note || undefined,
      });
      toast(r.message || `${r.supplierName} chosen`, 'ok');
      setDeciding(null); setNote(''); reload();
    } catch (e) { toast(e.message, 'bad'); }
    setBusy(false);
  };

  const grab = () => downloadCsv(`comparison-${data.doc_no}`, [
    ['Rate comparison', data.doc_no], ['For', data.title || ''],
    ['For PRN', data.indents.map((i) => i.doc_no).join(', ')], [],
    ['Item code', 'Item', 'Unit', 'Qty', ...totals.map((t) => t.supplier_name)],
    ...data.items.map((i) => [i.item_code, i.item_name, i.uom, i.qty,
      ...totals.map((t) => rateOf(i.id, t.comparison_supplier_id) || '')]),
    [],
    ['', '', '', 'Quoted total', ...totals.map((t) => t.basic)],
    ['', '', '', 'Discount %', ...totals.map((t) => t.discount_pct)],
    ['', '', '', 'Discount', ...totals.map((t) => t.discountAmt)],
    ['', '', '', 'Freight', ...totals.map((t) => t.freight)],
    ['', '', '', 'Landed cost', ...totals.map((t) => t.landed)],
    ['', '', '', 'Credit days', ...totals.map((t) => t.credit_days)],
    [],
    ['Lowest quote', bestQuoted ? bestQuoted.supplier_name : ''],
    ['Lowest landed cost', bestLanded ? bestLanded.supplier_name : ''],
    ['Chosen', data.chosen_supplier_name || 'not yet'],
    ['Reason', data.decided_note || ''],
  ]);

  const free = (suppliers || []).filter((s) =>
    !data.suppliers.some((x) => x.supplier_id === s.id));
  const w = withWhom(data.approval);

  return (
    <>
      <DocHead kind="Rate comparison"
        back={<button type="button" className="btn sm ghost" style={{ marginLeft: -8 }} onClick={() => nav('/comparisons')}><Icon name="arrowLeft" size={14} />Rate comparisons</button>}
        docNo={<Code>{data.doc_no}</Code>}
        status={<Status is={cmpStatus(data.status)} lg />}
        meta={[data.title, plural(data.item_count, 'item'), `${plural(data.supplier_count, 'supplier')} quoting`]}
        actions={
          <>
            <button className="btn" onClick={grab}><Icon name="download" size={14} />Download</button>
            {data.canEdit && dirty && canWrite('/comparisons') && (
              <button className="btn pri" disabled={busy} onClick={saveRates}>Save rates</button>
            )}
            {data.status === 'APPROVED' && canWrite('/purchase-orders') && (
              <Link className="btn pri" to={`/procurement?comparison=${id}`}><Icon name="cart" />Raise purchase order</Link>
            )}
          </>
        } />

      <div className="page-body">
        {data.status === 'DECIDED' && (
          <NextStep tone="info" icon="clock"
            now={`${data.chosen_supplier_name} chosen — with ${w?.who || 'Management'} for approval${w ? ` · level ${w.level} of ${w.levels}` : ''}`}
            quote={data.decided_note || undefined}
            then="A purchase order can be raised from this comparison once both approvals are done." />
        )}
        {data.status === 'APPROVED' && (
          <NextStep tone="done" icon="check"
            now={`Approved — ${data.chosen_supplier_name}${data.decided_at ? `, chosen on ${dmy(data.decided_at)}` : ''}`}
            quote={data.decided_note || undefined}
            then="Raise the purchase order from it; the rates carry over." />
        )}
        {data.status === 'DRAFT' && (split ? (
          <Banner kind="warn">
            <b>The lowest quote is not the cheapest buy.</b>{' '}
            {bestQuoted.supplier_name} quoted lowest at {money(bestQuoted.basic)}, but after discount
            and freight {bestLanded.supplier_name} lands at {money(bestLanded.landed)} —{' '}
            {money(bestQuoted.landed - bestLanded.landed)} less.
          </Banner>
        ) : bestLanded ? (
          <Banner kind="info">
            <b>{bestLanded.supplier_name}</b> is the cheapest both on the quote and once it lands,
            at {money(bestLanded.landed)}.
          </Banner>
        ) : (
          <Banner kind="info">
            Add each supplier who quoted, then type their rates. Discount and freight apply to a
            supplier&apos;s whole quote, not to one line — that is what turns a rate into a landed cost.
          </Banner>
        ))}

        {data.indents.length > 0 && (
          <p style={{ color: 'var(--muted)', fontSize: 13, margin: '0 0 14px' }}>
            For {data.indents.map((i, n) => (
              <span key={i.id}>
                {n > 0 && ', '}
                <Link className="linkish" to={`/indents/${i.id}`}><Code>{i.doc_no}</Code></Link>
                {' '}({i.site_name})
              </span>
            ))}
          </p>
        )}

        <Card title="Quotes" sub="Rates as quoted, per unit. The rows below the line turn them into what each supplier actually costs."
          actions={data.canEdit && free.length ? (
            <div style={{ display: 'flex', gap: 8 }}>
              <select className="inp" style={{ width: 210 }} value={adding} aria-label="Add a supplier"
                onChange={(e) => setAdding(e.target.value)}>
                <option value="">Add a supplier…</option>
                {free.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
              <button className="btn sm" disabled={!adding} onClick={addSupplier}><Icon name="plus" size={14} />Add</button>
            </div>
          ) : null}>
          <div className="tw">
            <table className="sheet">
              <thead>
                <tr>
                  <th style={{ width: 110 }}>Item code</th>
                  <th style={{ minWidth: 220 }}>Item</th>
                  <th style={{ width: 60 }}>Unit</th>
                  <th className="rt" style={{ width: 84 }}>Qty</th>
                  {totals.map((t) => (
                    <th key={t.comparison_supplier_id} className="rt" style={{ width: 130 }}>
                      {t.supplier_name}
                      {data.canEdit && (
                        <button className="btn sm ghost" style={{ marginLeft: 4, padding: '0 5px', minHeight: 22 }}
                          aria-label={`Take ${t.supplier_name} off the comparison`}
                          title={`Take ${t.supplier_name} off the comparison`}
                          onClick={async () => {
                            await api.del(`/comparisons/${id}/suppliers/${t.comparison_supplier_id}`);
                            reload();
                          }}><Icon name="x" size={13} /></button>
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.items.map((i) => {
                  const row = totals
                    .map((t) => ({ t, r: Number(rateOf(i.id, t.comparison_supplier_id)) }))
                    .filter((x) => x.r > 0);
                  const low = row.length ? Math.min(...row.map((x) => x.r)) : null;
                  return (
                    <tr key={i.id}>
                      <td><Code>{i.item_code}</Code></td>
                      <td>{i.item_name}{i.make_name && <small>{i.make_name}</small>}</td>
                      <td>{i.uom}</td>
                      <td className="rt mono">{qty(i.qty)}</td>
                      {totals.map((t) => {
                        const v = rateOf(i.id, t.comparison_supplier_id);
                        const isLow = low !== null && Number(v) === low && Number(v) > 0 && row.length > 1;
                        return (
                          <td key={t.comparison_supplier_id}>
                            {data.canEdit ? (
                              <input className="inp rt" type="number" min="0" step="any" placeholder="0" inputMode="decimal"
                                aria-label={`${t.supplier_name}'s rate for ${i.item_name}`}
                                style={isLow ? { borderColor: 'var(--st-done)', fontWeight: 600 } : undefined}
                                title={isLow ? 'Lowest rate for this item' : undefined}
                                value={v}
                                onChange={(e) => {
                                  setRates((x) => ({
                                    ...x, [key(i.id, t.comparison_supplier_id)]: e.target.value,
                                  }));
                                  setDirty(true);
                                }} />
                            ) : (
                              <div className="rt mono" style={isLow ? { fontWeight: 700 } : undefined}>
                                {v ? money(v) : '—'}
                                {isLow && <small style={{ color: 'var(--st-done)' }}>Lowest</small>}
                              </div>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
                {!totals.length && (
                  <tr><td colSpan={4}>
                    <Empty title="No supplier is quoting yet">Add a supplier to start.</Empty>
                  </td></tr>
                )}
              </tbody>

              {totals.length > 0 && (
                <tfoot>
                  <tr>
                    <th colSpan={4} className="rt">Quoted total</th>
                    {totals.map((t) => (
                      <th key={t.comparison_supplier_id} className="rt mono">
                        {money(t.basic)}
                        {!t.complete && t.quoted > 0 && (
                          <small style={{ color: 'var(--st-attn)' }}>{t.quoted} of {data.items.length} items quoted</small>
                        )}
                      </th>
                    ))}
                  </tr>
                  <tr>
                    <th colSpan={4} className="rt">Discount %</th>
                    {totals.map((t) => (
                      <th key={t.comparison_supplier_id} className="rt">
                        {data.canEdit ? (
                          <input className="inp rt" type="number" min="0" max="100" step="any" inputMode="decimal"
                            aria-label={`${t.supplier_name}'s discount %`}
                            defaultValue={t.discount_pct}
                            onBlur={(e) => setTerm(t.comparison_supplier_id, 'discountPct', e.target.value)} />
                        ) : <span className="mono">{t.discount_pct}%</span>}
                      </th>
                    ))}
                  </tr>
                  <tr>
                    <th colSpan={4} className="rt">Freight (₹)</th>
                    {totals.map((t) => (
                      <th key={t.comparison_supplier_id} className="rt">
                        {data.canEdit ? (
                          <input className="inp rt" type="number" min="0" step="any" inputMode="decimal"
                            aria-label={`${t.supplier_name}'s freight in rupees`}
                            defaultValue={t.freight}
                            onBlur={(e) => setTerm(t.comparison_supplier_id, 'freight', e.target.value)} />
                        ) : <span className="mono">{money(t.freight)}</span>}
                      </th>
                    ))}
                  </tr>
                  <tr>
                    <th colSpan={4} className="rt">Credit days</th>
                    {totals.map((t) => (
                      <th key={t.comparison_supplier_id} className="rt">
                        {data.canEdit ? (
                          <input className="inp rt" type="number" min="0" step="1" inputMode="numeric"
                            aria-label={`${t.supplier_name}'s credit days`}
                            defaultValue={t.credit_days}
                            onBlur={(e) => setTerm(t.comparison_supplier_id, 'creditDays', e.target.value)} />
                        ) : <span className="mono">{t.credit_days}</span>}
                      </th>
                    ))}
                  </tr>
                  <tr style={{ background: 'var(--brand-soft)' }}>
                    <th colSpan={4} className="rt">Landed cost</th>
                    {totals.map((t) => {
                      const best = bestLanded
                        && t.comparison_supplier_id === bestLanded.comparison_supplier_id;
                      return (
                        <th key={t.comparison_supplier_id} className="rt mono">
                          <b>{t.quoted ? money(t.landed) : '—'}</b>
                          {best && <small style={{ color: 'var(--st-done)' }}>Cheapest</small>}
                        </th>
                      );
                    })}
                  </tr>
                  {data.canEdit && (
                    <tr>
                      <th colSpan={4} className="rt" style={{ fontWeight: 500, color: 'var(--muted)' }}>
                        {dirty ? 'Save the rates before choosing' : 'Choose the supplier to buy from'}
                      </th>
                      {totals.map((t) => (
                        <th key={t.comparison_supplier_id} className="rt">
                          <button className="btn sm pri" disabled={!t.quoted || dirty}
                            onClick={() => setDeciding(t)}>Choose</button>
                        </th>
                      ))}
                    </tr>
                  )}
                </tfoot>
              )}
            </table>
          </div>
        </Card>

        {totals.length > 0 && (
          <Card title="Summary">
            <div className="pad stats">
              {bestQuoted && <Stat n={bestQuoted.supplier_name} label="lowest quote" />}
              {bestLanded && <Stat n={bestLanded.supplier_name} label="lowest landed cost" />}
              {split && (
                <Stat n={money(bestQuoted.landed - bestLanded.landed)} label="saved by counting discount and freight" tone="ok" />
              )}
            </div>
          </Card>
        )}
      </div>

      {deciding && (
        <Modal title={`Choose ${deciding.supplier_name}?`}
          sub={`${money(deciding.landed)} landed cost · ${plural(deciding.credit_days, 'day')} credit`}
          onClose={() => { setDeciding(null); setNote(''); }}
          footer={<>
            <button className="btn" onClick={() => { setDeciding(null); setNote(''); }}>Go back</button>
            <button className="btn pri" onClick={decide}
              disabled={busy || (bestLanded && deciding.comparison_supplier_id !== bestLanded.comparison_supplier_id && !note.trim())}>
              Choose {deciding.supplier_name}
            </button>
          </>}>
          <p className="consequence">
            The choice then goes to Management for two approvals. A purchase order can be raised
            from this comparison once both are done.
          </p>
          {bestLanded && deciding.comparison_supplier_id !== bestLanded.comparison_supplier_id ? (
            <Banner kind="warn">
              <b>{bestLanded.supplier_name} lands cheaper</b>, at {money(bestLanded.landed)} —{' '}
              {money(deciding.landed - bestLanded.landed)} less. Choosing a dearer quote is often
              right, but the reason has to be recorded.
            </Banner>
          ) : (
            <Banner kind="ok">This is the lowest landed cost on the comparison.</Banner>
          )}
          <Field label={bestLanded && deciding.comparison_supplier_id !== bestLanded.comparison_supplier_id ? 'Reason' : 'Reason (optional)'}
            hint="Delivery, credit, a supplier who actually turns up — whatever decided it.">
            <textarea className="inp" rows={3} value={note} onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. 45 days' credit against 15, and they deliver to site" />
          </Field>
        </Modal>
      )}
    </>
  );
}
