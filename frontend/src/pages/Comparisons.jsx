import { useEffect, useRef, useState } from 'react';
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
// the frozen left columns: item, PRN needs, at central store, order qty
const FZ = [240, 96, 112, 118];

export function ComparisonDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const toast = useToast();
  const { data, error, loading, reload } = useApi(`/comparisons/${id}`, [id]);
  const { data: suppliers } = useApi('/suppliers');
  const [rates, setRates] = useState({});      // "itemId:csId" -> string
  const [dirty, setDirty] = useState(false);
  const [qtys, setQtys] = useState({});         // comparison item id -> order qty
  const [adding, setAdding] = useState('');
  const [deciding, setDeciding] = useState(null); // the supplier whose Choose was pressed
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  // Saving a discount or freight reloads the sheet; rates typed and not
  // yet saved must survive that, so a reload only fills what nobody has
  // touched. Saving the rates clears the edits and the server wins again.
  const edited = useRef({});
  useEffect(() => {
    if (!data) return;
    const saved = Object.fromEntries(data.quotes.map((q) =>
      [`${q.comparison_item_id}:${q.comparison_supplier_id}`, String(q.rate)]));
    setRates({ ...saved, ...edited.current });
    setQtys(Object.fromEntries(data.items.map((i) => [i.id, String(Number(i.qty))])));
    setDirty(Object.keys(edited.current).length > 0);
  }, [data]);

  if (loading && !data) return <Loading what="the rate comparison" />;
  if (error) return <div className="page-body" style={{ paddingTop: 24 }}><ErrorNote error={error} onRetry={reload} /></div>;

  const key = (itemId, csId) => `${itemId}:${csId}`;
  const qOf = (i) => Number(qtys[i.id] ?? i.qty) || 0;
  const rateOf = (itemId, csId) => rates[key(itemId, csId)] ?? '';

  /** The same arithmetic the server does, so the totals update as you type. */
  const totals = data.suppliers.map((s) => {
    const basic = data.items.reduce((t, i) => {
      const r = Number(rateOf(i.id, s.comparison_supplier_id));
      return t + (Number.isFinite(r) ? r * qOf(i) : 0);
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
      edited.current = {};
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

  const setQty = async (item, value) => {
    const v = Number(value);
    if (!(v > 0)) {
      toast('The quantity to order has to be more than 0', 'bad');
      setQtys((x) => ({ ...x, [item.id]: String(Number(item.qty)) }));
      return;
    }
    if (v === Number(item.qty)) return;
    try {
      await api.patch(`/comparisons/${id}/items/${item.id}`, { qty: v });
      reload();
    } catch (e) {
      toast(e.message, 'bad');
      setQtys((x) => ({ ...x, [item.id]: String(Number(item.qty)) }));
    }
  };

  const setTerm = async (csId, field, value) => {
    try {
      await api.patch(`/comparisons/${id}/suppliers/${csId}`, { [field]: Number(value) || 0 });
      reload();
    } catch (e) { toast(e.message, 'bad'); }
  };

  /**
   * Select the supplier. Unsaved rates are saved first, so what is
   * chosen is what is on the sheet.
   */
  const select = async (chosen) => {
    setBusy(true);
    try {
      if (dirty) {
        await api.put(`/comparisons/${id}/quotes`, {
          quotes: data.items.flatMap((i) => data.suppliers.map((s) => {
            const v = rateOf(i.id, s.comparison_supplier_id);
            return {
              comparisonItemId: i.id, comparisonSupplierId: s.comparison_supplier_id,
              rate: v === '' ? null : Number(v),
            };
          })),
        });
      }
      edited.current = {};
      const r = await api.post(`/comparisons/${id}/decide`, {
        supplierId: chosen.supplier_id, note: note.trim() || undefined,
      });
      toast(r.message || `${r.supplierName} selected`, 'ok');
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
  const edit = data.canEdit && canWrite('/comparisons');
  const needsWhy = deciding && bestLanded && deciding.comparison_supplier_id !== bestLanded.comparison_supplier_id;
  const isBest = (t) => bestLanded && t.comparison_supplier_id === bestLanded.comparison_supplier_id;

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
            {edit && dirty && (
              <button className="btn" disabled={busy} onClick={saveRates}>Save rates</button>
            )}
            {data.status === 'APPROVED' && canWrite('/purchase-orders') && (
              <Link className="btn pri" to={`/procurement?comparison=${id}`}><Icon name="cart" />Raise purchase order</Link>
            )}
          </>
        } />

      <div className="page-body">
        {data.status === 'DECIDED' && (
          <NextStep tone="info" icon="clock"
            now={`${data.chosen_supplier_name} selected — with ${w?.who || 'Management'} for approval${w ? ` · level ${w.level} of ${w.levels}` : ''}`}
            quote={data.decided_note || undefined}
            then="A purchase order can be raised from this comparison once both approvals are done." />
        )}
        {data.status === 'APPROVED' && (
          <NextStep tone="done" icon="check"
            now={`Approved — ${data.chosen_supplier_name}${data.decided_at ? `, selected on ${dmy(data.decided_at)}` : ''}`}
            quote={data.decided_note || undefined}
            then="Raise the purchase order from it; the rates carry over." />
        )}

        <Banner kind="info">
          Whichever supplier is selected here becomes the rate on the purchase order — the buyer does not
          retype it, and the reason for the choice is recorded.
          {data.indents.length > 0 && (
            <> For {data.indents.map((i, n) => (
              <span key={i.id}>{n > 0 && ', '}<Code>{i.doc_no}</Code> ({i.site_name})</span>
            ))}.</>
          )}
        </Banner>

        <Card title="Quotes side by side"
          sub="Order qty starts at what the PRNs need less what the central store holds. Rate per unit, lowest in green. With many suppliers the sheet scrolls sideways and the item columns stay put."
          actions={edit && free.length ? (
            <div style={{ display: 'flex', gap: 8 }}>
              <select className="inp" style={{ width: 210 }} value={adding} aria-label="Add a supplier"
                onChange={(e) => setAdding(e.target.value)}>
                <option value="">Add a supplier who quoted…</option>
                {free.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
              <button className="btn sm" disabled={!adding} onClick={addSupplier}><Icon name="plus" size={14} />Add</button>
            </div>
          ) : null}>
          <div className="tw">
            <table>
              <thead>
                <tr>
                  <th className="frz" style={{ left: 0, width: FZ[0], minWidth: FZ[0] }}>Item</th>
                  <th className="frz rt" style={{ left: FZ[0], width: FZ[1], minWidth: FZ[1] }}>PRN needs</th>
                  <th className="frz rt" style={{ left: FZ[0] + FZ[1], width: FZ[2], minWidth: FZ[2] }}
                    title={data.storeName ? `On the shelf at ${data.storeName}` : undefined}>At central store</th>
                  <th className="frz frz-end rt" style={{ left: FZ[0] + FZ[1] + FZ[2], width: FZ[3], minWidth: FZ[3] }}>Order qty</th>
                  {totals.map((t) => (
                    <th key={t.comparison_supplier_id} className="rt" style={{ width: 140, minWidth: 140 }}>
                      {t.supplier_name}
                      {isBest(t) && totals.length > 1 && <> <Status tone="done" label="Lowest" /></>}
                      {edit && (
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
                  const quoted = totals.map((t) => Number(rateOf(i.id, t.comparison_supplier_id))).filter((r) => r > 0);
                  const low = quoted.length > 1 ? Math.min(...quoted) : null;
                  return (
                    <tr key={i.id}>
                      <td className="frz" style={{ left: 0 }}>{i.item_name}<small><Code>{i.item_code}</Code>{i.make_name ? ` · ${i.make_name}` : ''}</small></td>
                      <td className="frz rt mono" style={{ left: FZ[0] }}>{qty(i.need_qty)} <small style={{ display: 'inline' }}>{i.uom}</small></td>
                      <td className="frz rt mono" style={{ left: FZ[0] + FZ[1] }}>
                        {Number(i.store_qty) ? qty(i.store_qty) : '—'}
                        {Number(i.store_qty) >= Number(i.need_qty) && Number(i.store_qty) > 0 && (
                          <small style={{ color: 'var(--st-done)' }}>enough in stock</small>
                        )}
                      </td>
                      <td className="frz frz-end rt" style={{ left: FZ[0] + FZ[1] + FZ[2] }}>
                        {edit ? (
                          <input className="inp rt" type="number" min="0" step="any" inputMode="decimal"
                            style={{ width: 96 }} aria-label={`Quantity of ${i.item_name} to order`}
                            value={qtys[i.id] ?? ''}
                            onChange={(e) => setQtys((x) => ({ ...x, [i.id]: e.target.value }))}
                            onBlur={(e) => setQty(i, e.target.value)} />
                        ) : <b className="mono">{qty(i.qty)}</b>}
                      </td>
                      {totals.map((t) => {
                        const v = rateOf(i.id, t.comparison_supplier_id);
                        const lowest = low !== null && Number(v) === low;
                        const style = lowest ? { color: 'var(--st-done)', fontWeight: 700 } : undefined;
                        return (
                          <td key={t.comparison_supplier_id} className="rt mono">
                            {edit ? (
                              <input className="inp rt" type="number" min="0" step="any" placeholder="rate" inputMode="decimal"
                                aria-label={`${t.supplier_name}'s rate for ${i.item_name}`}
                                style={{ width: 110, ...(style || {}) }}
                                value={v}
                                onChange={(e) => {
                                  const k = key(i.id, t.comparison_supplier_id);
                                  edited.current = { ...edited.current, [k]: e.target.value };
                                  setRates((x) => ({ ...x, [k]: e.target.value }));
                                  setDirty(true);
                                }} />
                            ) : <span style={style}>{v ? money(v) : '—'}</span>}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
                {!totals.length && (
                  <tr><td colSpan={4}>
                    <Empty title="No supplier is quoting yet">Add each supplier who quoted, then type their rates.</Empty>
                  </td></tr>
                )}
              </tbody>

              {totals.length > 0 && (
                <tfoot>
                  <tr>
                    <th colSpan={4} className="frz frz-end rt" style={{ left: 0 }}>Quoted total</th>
                    {totals.map((t) => (
                      <th key={t.comparison_supplier_id} className="rt mono">
                        {money(t.basic)}
                        {!t.complete && t.quoted > 0 && (
                          <small style={{ color: 'var(--st-attn)' }}>{t.quoted} of {data.items.length} quoted</small>
                        )}
                      </th>
                    ))}
                  </tr>
                  {[
                    ['discountPct', 'discount_pct', 'Discount %', (t) => `${t.discount_pct}%`, '100'],
                    ['freight', 'freight', 'Freight & handling', (t) => money(t.freight)],
                    ['creditDays', 'credit_days', 'Credit days', (t) => t.credit_days],
                  ].map(([field, col, label, show, max]) => (
                    <tr key={field}>
                      <th colSpan={4} className="frz frz-end rt" style={{ left: 0 }}>{label}</th>
                      {totals.map((t) => (
                        <th key={t.comparison_supplier_id} className="rt">
                          {edit ? (
                            <input className="inp rt" type="number" min="0" max={max} step="any" inputMode="decimal"
                              style={{ width: 110 }} aria-label={`${t.supplier_name}'s ${label.toLowerCase()}`}
                              defaultValue={t[col]}
                              onBlur={(e) => setTerm(t.comparison_supplier_id, field, e.target.value)} />
                          ) : <span className="mono">{show(t)}</span>}
                        </th>
                      ))}
                    </tr>
                  ))}
                  <tr>
                    <th colSpan={4} className="frz frz-end rt" style={{ left: 0, color: 'var(--brand-ink)' }}>Landed cost</th>
                    {totals.map((t) => (
                      <th key={t.comparison_supplier_id} className="rt mono"
                        style={isBest(t) ? { color: 'var(--st-done)' } : undefined}>
                        {t.quoted ? money(t.landed) : '—'}{isBest(t) && totals.length > 1 ? ' ★' : ''}
                      </th>
                    ))}
                  </tr>
                  {edit && (
                    <tr>
                      <th colSpan={4} className="frz frz-end rt" style={{ left: 0, fontWeight: 500, color: 'var(--muted)' }}>
                        Choose the supplier to buy from
                      </th>
                      {totals.map((t) => (
                        <th key={t.comparison_supplier_id} className="rt">
                          <button className={`btn sm ${isBest(t) ? 'pri' : ''}`} disabled={!t.quoted || busy}
                            onClick={() => { setNote(''); setDeciding(t); }}>Choose</button>
                        </th>
                      ))}
                    </tr>
                  )}
                </tfoot>
              )}
            </table>
          </div>
        </Card>

        {bestLanded && totals.length > 1 && (split ? (
          <Banner kind="warn">
            <b>The cheapest quote is not the cheapest buy.</b>{' '}
            {bestQuoted.supplier_name} quotes lower per unit, but after discount and freight{' '}
            {bestLanded.supplier_name} lands {money(bestQuoted.landed - bestLanded.landed)} cheaper.
          </Banner>
        ) : (
          <Banner kind="ok">
            <b>{bestLanded.supplier_name} is lowest both on quote and on landed cost.</b>{' '}
            {plural(bestLanded.credit_days, 'day')} credit.
          </Banner>
        ))}

        {!edit && data.chosen_supplier_name && (
          <Banner kind="info">
            Selected: <b>{data.chosen_supplier_name}</b>{data.decided_note ? ` — ${data.decided_note}` : ''}
          </Banner>
        )}
      </div>

      {deciding && (
        <Modal title={`Choose ${deciding.supplier_name}?`}
          sub={`Landed ${money(deciding.landed)} · ${plural(deciding.credit_days, 'day')} credit`}
          onClose={() => setDeciding(null)}
          footer={<>
            <button className="btn" onClick={() => setDeciding(null)}>Go back</button>
            <button className="btn pri" disabled={busy || (needsWhy && !note.trim())}
              onClick={() => select(deciding)}>
              <Icon name="check" />Choose {deciding.supplier_name}
            </button>
          </>}>
          {needsWhy ? (
            <Banner kind="warn">
              <b>{bestLanded.supplier_name} lands cheaper</b>, at {money(bestLanded.landed)} —{' '}
              {money(deciding.landed - bestLanded.landed)} less. Choosing a dearer quote can be right,
              but the reason is recorded.
            </Banner>
          ) : (
            <Banner kind="ok">This is the lowest landed cost on the comparison.</Banner>
          )}
          <Field label={needsWhy ? 'Why this one (required)' : 'Why this one'}>
            <input className="inp" value={note} autoFocus onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. lowest landed cost, 45 days credit, delivers in 7 days" />
          </Field>
          <p style={{ color: 'var(--muted)', fontSize: 12.5, margin: 0 }}>
            It then goes for two approvals; the purchase order can be raised once both are done.
          </p>
        </Modal>
      )}
    </>
  );
}
