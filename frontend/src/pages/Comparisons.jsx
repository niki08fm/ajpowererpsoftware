import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useApp, PageHead } from '../App';
import { api, qty, money, dmy } from '../api';
import { downloadCsv } from '../download';
import {
  useApi, Card, Tag, Empty, Loading, ErrorNote, Banner, Field, Modal, Stat, useToast,
} from '../components/ui';

/**
 * Rate comparison.
 *
 * A rate is not a price. The discount comes off, the freight goes on,
 * and the supplier who quoted lowest is regularly not the one it is
 * cheapest to buy from. This sheet reports both, and says so plainly
 * when they differ — which is the only reason it exists.
 */

/* =================================================================== */
export function Comparisons() {
  const { branchId } = useApp();
  const [f, setF] = useState({ q: '', status: 'ALL' });
  const qs = new URLSearchParams({
    ...(branchId ? { branchId } : {}), ...(f.q ? { q: f.q } : {}), status: f.status,
  }).toString();
  const { data, error, loading, reload } = useApi(branchId ? `/comparisons?${qs}` : null,
    [branchId, qs]);
  const rows = data || [];

  const grab = () => downloadCsv('rate-comparisons', [
    ['Sheet', 'Title', 'Items', 'Quoting', 'Cheapest quoted', 'Cheapest landed', 'Landed', 'Status', 'Chosen'],
    ...rows.map((r) => [r.doc_no, r.title || '', r.item_count, r.supplier_count,
      r.best_quoted_supplier_name || '', r.best_landed_supplier_name || '', r.best_landed || '',
      r.status, r.chosen_supplier_name || '']),
  ]);

  return (
    <>
      <PageHead title="Rate comparison" sub="What it costs to buy, not what it was quoted at"
        actions={
          <div style={{ display: 'flex', gap: 9 }}>
            <button className="btn" onClick={grab} disabled={!rows.length}>Download</button>
            <Link className="btn pri" to="/procurement">Start one from an indent</Link>
          </div>
        } />
      <div className="page-body">
        {error && <ErrorNote error={error} onRetry={reload} />}
        <Card>
          <div className="pad" style={{ display: 'flex', gap: 10, alignItems: 'flex-end' }}>
            <Field label="Search">
              <input className="inp" style={{ width: 240 }} placeholder="Sheet number or title"
                value={f.q} onChange={(e) => setF((x) => ({ ...x, q: e.target.value }))} />
            </Field>
            <Field label="Status">
              <select className="inp" style={{ width: 170 }} value={f.status}
                onChange={(e) => setF((x) => ({ ...x, status: e.target.value }))}>
                <option value="ALL">Everything</option>
                <option value="DRAFT">Still comparing</option>
                <option value="DECIDED">Decided</option>
              </select>
            </Field>
          </div>
        </Card>

        {loading ? <Loading /> : (
          <Card title={`${rows.length} sheet${rows.length === 1 ? '' : 's'}`}>
            <div className="tw">
              <table>
                <thead>
                  <tr>
                    <th>Sheet</th><th>For</th>
                    <th className="rt">Items</th><th className="rt">Quoting</th>
                    <th>Cheapest quoted</th><th>Cheapest landed</th>
                    <th className="rt">Landed</th><th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.comparison_id} className="click">
                      <td><Link to={`/comparisons/${r.comparison_id}`}>
                        <b className="mono">{r.doc_no}</b></Link>
                        <small>{dmy(r.created_at)}</small></td>
                      <td>{r.title || <span style={{ color: 'var(--faint)' }}>—</span>}</td>
                      <td className="rt mono">{r.item_count}</td>
                      <td className="rt mono">{r.supplier_count}</td>
                      <td>{r.best_quoted_supplier_name || '—'}</td>
                      <td>
                        {r.best_landed_supplier_name || '—'}
                        {r.best_landed_supplier_id && r.best_quoted_supplier_id
                          && r.best_landed_supplier_id !== r.best_quoted_supplier_id && (
                          <small style={{ color: 'var(--warn)' }}>not the lowest quote</small>
                        )}
                      </td>
                      <td className="rt mono">{r.best_landed ? money(r.best_landed) : '—'}</td>
                      <td>
                        {r.status === 'DECIDED'
                          ? <Tag kind="ok">{r.chosen_supplier_name}</Tag>
                          : <Tag kind="warn">Still comparing</Tag>}
                      </td>
                    </tr>
                  ))}
                  {!rows.length && (
                    <tr><td colSpan={8}>
                      <Empty title="No comparisons yet">
                        Tick some indents on <Link to="/procurement">To buy</Link> and compare rates
                        before raising the order.
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
   The sheet itself.
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

  if (loading) return <Loading />;
  if (error) return <div className="page-body"><ErrorNote error={error} onRetry={reload} /></div>;

  const key = (itemId, csId) => `${itemId}:${csId}`;
  const rateOf = (itemId, csId) => rates[key(itemId, csId)] ?? '';

  /** The same arithmetic the server does, so the sheet totals live. */
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
      toast(r.wasCheapest
        ? `${r.supplierName} chosen — the cheapest landed`
        : `${r.supplierName} chosen, and the reason is on the record`, 'ok');
      setDeciding(null); setNote(''); reload();
    } catch (e) { toast(e.message, 'bad'); }
    setBusy(false);
  };

  const grab = () => downloadCsv(`comparison-${data.doc_no}`, [
    ['Comparison', data.doc_no], ['For', data.title || ''],
    ['Raised from', data.indents.map((i) => i.doc_no).join(', ')], [],
    ['Item code', 'Item', 'Unit', 'Qty', ...totals.map((t) => t.supplier_name)],
    ...data.items.map((i) => [i.item_code, i.item_name, i.uom, i.qty,
      ...totals.map((t) => rateOf(i.id, t.comparison_supplier_id) || '')]),
    [],
    ['', '', '', 'Basic', ...totals.map((t) => t.basic)],
    ['', '', '', 'Discount %', ...totals.map((t) => t.discount_pct)],
    ['', '', '', 'Discount', ...totals.map((t) => t.discountAmt)],
    ['', '', '', 'Freight', ...totals.map((t) => t.freight)],
    ['', '', '', 'Landed', ...totals.map((t) => t.landed)],
    ['', '', '', 'Credit days', ...totals.map((t) => t.credit_days)],
    [],
    ['Cheapest quoted', bestQuoted ? bestQuoted.supplier_name : ''],
    ['Cheapest landed', bestLanded ? bestLanded.supplier_name : ''],
    ['Chosen', data.chosen_supplier_name || 'not yet'],
    ['Because', data.decided_note || ''],
  ]);

  const free = (suppliers || []).filter((s) =>
    !data.suppliers.some((x) => x.supplier_id === s.id));

  return (
    <>
      <PageHead title={data.doc_no}
        sub={`${data.item_count} item(s) · ${data.supplier_count} quoting${data.title ? ` · ${data.title}` : ''}`}
        actions={
          <div style={{ display: 'flex', gap: 9, flexWrap: 'wrap' }}>
            <button className="btn" onClick={() => nav('/comparisons')}>Back</button>
            <button className="btn" onClick={grab}>Download</button>
            {data.canEdit && dirty && (
              <button className="btn pri" disabled={busy} onClick={saveRates}>Save rates</button>
            )}
            {data.status === 'DECIDED' && (
              <Link className="btn pri" to={`/procurement?comparison=${id}`}>Raise the order</Link>
            )}
          </div>
        } />

      <div className="page-body">
        {data.status === 'DECIDED' ? (
          <Banner kind="ok" icon="✓">
            <b>{data.chosen_supplier_name}</b> chosen{data.decided_at ? ` on ${dmy(data.decided_at)}` : ''}.
            {data.decided_note ? ` ${data.decided_note}` : ''}
          </Banner>
        ) : split ? (
          <Banner kind="warn" icon="⚠">
            <b>The cheapest quote is not the cheapest buy.</b>{' '}
            {bestQuoted.supplier_name} quoted lowest at {money(bestQuoted.basic)}, but after discount
            and freight {bestLanded.supplier_name} lands at {money(bestLanded.landed)} —{' '}
            {money(bestQuoted.landed - bestLanded.landed)} less.
          </Banner>
        ) : bestLanded ? (
          <Banner kind="info" icon="▤">
            <b>{bestLanded.supplier_name}</b> is cheapest both on the quote and once it lands,
            at {money(bestLanded.landed)}.
          </Banner>
        ) : (
          <Banner kind="info" icon="▤">
            Add whoever quoted, then put their rates in. Discount and freight belong to the whole
            quote, not to a line — which is what turns a rate into a price.
          </Banner>
        )}

        {data.indents.length > 0 && (
          <Card>
            <div className="pad" style={{ color: 'var(--muted)', fontSize: 12.5 }}>
              Raised from {data.indents.map((i, n) => (
                <span key={i.id}>
                  {n > 0 && ', '}
                  <Link to={`/indents/${i.id}`} style={{ textDecoration: 'underline' }}>{i.doc_no}</Link>
                  {' '}({i.site_name})
                </span>
              ))}
            </div>
          </Card>
        )}

        <Card title="The sheet" sub="Rates as quoted. Everything below the line is what it becomes."
          actions={data.canEdit && free.length ? (
            <div style={{ display: 'flex', gap: 8 }}>
              <select className="inp" style={{ width: 200 }} value={adding}
                onChange={(e) => setAdding(e.target.value)}>
                <option value="">Add a supplier…</option>
                {free.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
              <button className="btn sm" disabled={!adding} onClick={addSupplier}>Add</button>
            </div>
          ) : null}>
          <div className="tw">
            <table className="sheet">
              <thead>
                <tr>
                  <th style={{ width: 100 }}>Code</th>
                  <th style={{ minWidth: 220 }}>Item</th>
                  <th style={{ width: 60 }}>Unit</th>
                  <th className="rt" style={{ width: 84 }}>Qty</th>
                  {totals.map((t) => (
                    <th key={t.comparison_supplier_id} className="rt" style={{ width: 118 }}>
                      {t.supplier_name}
                      {data.canEdit && (
                        <button className="btn sm bad" style={{ marginLeft: 6, padding: '0 6px' }}
                          title="Take them off the sheet"
                          onClick={async () => {
                            await api.del(`/comparisons/${id}/suppliers/${t.comparison_supplier_id}`);
                            reload();
                          }}>✕</button>
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
                      <td className="mono" style={{ color: 'var(--brand-ink)' }}>{i.item_code}</td>
                      <td>{i.item_name}{i.make_name && <small>{i.make_name}</small>}</td>
                      <td>{i.uom}</td>
                      <td className="rt mono">{qty(i.qty)}</td>
                      {totals.map((t) => {
                        const v = rateOf(i.id, t.comparison_supplier_id);
                        const isLow = low !== null && Number(v) === low && Number(v) > 0;
                        return (
                          <td key={t.comparison_supplier_id}>
                            {data.canEdit ? (
                              <input className="inp rt" type="number" min="0" step="any" placeholder="—"
                                style={isLow ? { borderColor: 'var(--ok)', fontWeight: 700 } : undefined}
                                value={v}
                                onChange={(e) => {
                                  setRates((x) => ({
                                    ...x, [key(i.id, t.comparison_supplier_id)]: e.target.value,
                                  }));
                                  setDirty(true);
                                }} />
                            ) : (
                              <div className="rt mono" style={isLow ? { color: 'var(--ok)', fontWeight: 700 } : undefined}>
                                {v ? money(v) : '—'}
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
                    <Empty title="Nobody is quoting yet">Add a supplier to start.</Empty>
                  </td></tr>
                )}
              </tbody>

              {totals.length > 0 && (
                <tfoot>
                  <tr>
                    <th colSpan={4} className="rt">Quoted</th>
                    {totals.map((t) => (
                      <th key={t.comparison_supplier_id} className="rt mono">
                        {money(t.basic)}
                        {!t.complete && t.quoted > 0 && (
                          <small style={{ color: 'var(--warn)' }}>{t.quoted} of {data.items.length}</small>
                        )}
                      </th>
                    ))}
                  </tr>
                  <tr>
                    <th colSpan={4} className="rt">Discount %</th>
                    {totals.map((t) => (
                      <th key={t.comparison_supplier_id} className="rt">
                        {data.canEdit ? (
                          <input className="inp rt" type="number" min="0" max="100" step="any"
                            defaultValue={t.discount_pct}
                            onBlur={(e) => setTerm(t.comparison_supplier_id, 'discountPct', e.target.value)} />
                        ) : <span className="mono">{t.discount_pct}%</span>}
                      </th>
                    ))}
                  </tr>
                  <tr>
                    <th colSpan={4} className="rt">Freight</th>
                    {totals.map((t) => (
                      <th key={t.comparison_supplier_id} className="rt">
                        {data.canEdit ? (
                          <input className="inp rt" type="number" min="0" step="any"
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
                          <input className="inp rt" type="number" min="0" step="1"
                            defaultValue={t.credit_days}
                            onBlur={(e) => setTerm(t.comparison_supplier_id, 'creditDays', e.target.value)} />
                        ) : <span className="mono">{t.credit_days}</span>}
                      </th>
                    ))}
                  </tr>
                  <tr style={{ background: 'var(--brand-soft)' }}>
                    <th colSpan={4} className="rt">Landed</th>
                    {totals.map((t) => {
                      const best = bestLanded
                        && t.comparison_supplier_id === bestLanded.comparison_supplier_id;
                      return (
                        <th key={t.comparison_supplier_id} className="rt mono"
                          style={best ? { color: 'var(--ok)' } : undefined}>
                          <b>{t.quoted ? money(t.landed) : '—'}</b>
                          {best && <small style={{ color: 'var(--ok)' }}>cheapest</small>}
                        </th>
                      );
                    })}
                  </tr>
                  {data.canEdit && (
                    <tr>
                      <th colSpan={4} />
                      {totals.map((t) => (
                        <th key={t.comparison_supplier_id} className="rt">
                          <button className="btn sm pri" disabled={!t.quoted}
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
          <Card title="Side by side">
            <div className="pad stats">
              {bestQuoted && <Stat n={bestQuoted.supplier_name} label="cheapest quoted" />}
              {bestLanded && <Stat n={bestLanded.supplier_name} label="cheapest landed" tone="brand" />}
              {split && (
                <Stat n={money(bestQuoted.landed - bestLanded.landed)} label="saved by looking" tone="ok" />
              )}
            </div>
          </Card>
        )}
      </div>

      {deciding && (
        <Modal title={`Choose ${deciding.supplier_name}`}
          sub={`${money(deciding.landed)} landed · ${deciding.credit_days} days credit`}
          onClose={() => { setDeciding(null); setNote(''); }}
          footer={<>
            <button className="btn" onClick={() => { setDeciding(null); setNote(''); }}>Cancel</button>
            <button className="btn pri" disabled={busy} onClick={decide}>Choose them</button>
          </>}>
          {bestLanded && deciding.comparison_supplier_id !== bestLanded.comparison_supplier_id ? (
            <Banner kind="warn" icon="⚠">
              <b>{bestLanded.supplier_name} lands cheaper</b>, at {money(bestLanded.landed)} —{' '}
              {money(deciding.landed - bestLanded.landed)} less. Choosing a dearer quote is often
              right, but the reason has to go on the record.
            </Banner>
          ) : (
            <Banner kind="ok" icon="✓">The cheapest landed cost on the sheet.</Banner>
          )}
          <Field label="Why this one"
            hint="Delivery, credit, a supplier who actually turns up — whatever decided it.">
            <textarea className="inp" rows={3} value={note} onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. 45 days against 15, and they deliver to site" />
          </Field>
        </Modal>
      )}
    </>
  );
}
