import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useApp, PageHead } from '../App';
import { qty, dmy } from '../api';
import { downloadCsv } from '../download';
import {
  useApi, Card, Tag, Empty, Loading, ErrorNote, Banner, Field, Modal, Stat, Meter,
} from '../components/ui';
import { AckModal } from './Challans';
import { ReceiveGrn } from './Grns';
import { DocLink, DocPeek } from './Store';

/**
 * The site's side of the store.
 *
 * Acknowledgement happens here, not at the central store. Whatever is
 * directed at this site — a challan the store sent, or an order the
 * buyer had delivered straight to site — is this team's to receive.
 * Nothing lands on the site's shelf until they say it arrived.
 *
 * And the site's shelf keeps no rates. The site never negotiated a
 * price and has no business quoting one; what it holds is a quantity.
 */

/** Every site screen needs to know which site. */
export function useSite() {
  const { branchId } = useApp();
  const [params, setParams] = useSearchParams();
  const { data: sites } = useApi(branchId ? `/sites?branchId=${branchId}` : null, [branchId]);
  const siteId = params.get('site') || '';

  useEffect(() => {
    if (!siteId && sites?.length) {
      setParams((p) => { p.set('site', String(sites[0].id)); return p; }, { replace: true });
    }
  }, [sites, siteId, setParams]);

  const picker = (
    <Field label="Site">
      <select className="inp" style={{ width: 240 }} value={siteId}
        onChange={(e) => setParams((p) => { p.set('site', e.target.value); return p; })}>
        {(sites || []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
      </select>
    </Field>
  );
  return { siteId, sites, picker };
}

/* ===================================================================
   Acknowledgements: what is waiting for this site's signature.
   =================================================================== */
export function SiteInbox() {
  const { siteId, picker } = useSite();
  const [acking, setAcking] = useState(null);
  const [receiving, setReceiving] = useState(null);
  const { data, error, loading, reload } = useApi(
    siteId ? `/site-store/${siteId}/inbox` : null, [siteId]);

  return (
    <>
      <PageHead title="Acknowledgements"
        sub="Everything directed at this site, waiting to be signed for"
        actions={<div style={{ display: 'flex', gap: 9 }}>
          <Link className="btn" to={`/site/stock?site=${siteId}`}>Site store</Link>
        </div>} />
      <div className="page-body">
        {error && <ErrorNote error={error} onRetry={reload} />}

        <Card><div className="pad">{picker}</div></Card>

        {loading || !data ? <Loading /> : (
          <>
            <div className="stats">
              <Stat n={data.totals.waiting} label="waiting on this site"
                tone={data.totals.waiting ? 'warn' : undefined} />
              <Stat n={qty(data.totals.inTransitQty)} label="on the road to it" />
              <Stat n={qty(data.totals.onOrderQty)} label="on order, direct to site" />
              <Stat n={data.totals.overdue} label="overdue"
                tone={data.totals.overdue ? 'bad' : undefined} />
            </div>

            <Banner kind="info" icon="✓">
              Count what comes off the lorry and sign for that. What you sign for goes on{' '}
              <b>{data.site.name}</b>&apos;s shelf; anything short stays outstanding on the
              document until somebody accounts for it.
            </Banner>

            <Card title="Challans from the store"
              sub="Sent from the central store, not yet fully signed for">
              <div className="tw">
                <table>
                  <thead>
                    <tr><th>Challan</th><th>From</th><th>Answering</th><th>Vehicle</th>
                      <th style={{ width: 140 }}>Signed for</th><th className="rt">Outstanding</th>
                      <th className="rt">Days out</th><th /></tr>
                  </thead>
                  <tbody>
                    {data.challans.map((c) => (
                      <tr key={c.dc_id}>
                        <td><Link to={`/challans/${c.dc_id}`}>
                          <b className="mono">{c.doc_no}</b></Link>
                          <small>{dmy(c.dc_date)}</small></td>
                        <td>{c.from_name}</td>
                        <td><small className="mono">{c.prns || '—'}</small></td>
                        <td className="mono">{c.vehicle_no || '—'}</td>
                        <td>
                          <Meter value={Number(c.acked_qty)} max={Number(c.sent_qty)} />
                          <small className="mono">{qty(c.acked_qty)} of {qty(c.sent_qty)}</small>
                        </td>
                        <td className="rt mono" style={{ color: 'var(--bad)' }}>
                          <b>{qty(c.in_transit_qty)}</b></td>
                        <td className="rt mono">
                          {Number(c.days_out) > 3
                            ? <Tag kind="bad">{c.days_out}</Tag> : Number(c.days_out) || '—'}
                        </td>
                        <td className="rt">
                          <button className="btn sm pri" onClick={() => setAcking(c.dc_id)}>
                            Acknowledge
                          </button>
                        </td>
                      </tr>
                    ))}
                    {!data.challans.length && (
                      <tr><td colSpan={8}>
                        <Empty title="Nothing on the road to this site">
                          Everything the store has sent has been signed for.
                        </Empty>
                      </td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </Card>

            <Card title="Orders delivered straight here"
              sub="The buyer sent these direct to site, so this team signs for them">
              <div className="tw">
                <table>
                  <thead>
                    <tr><th>Order</th><th>Supplier</th><th>Answering</th><th>Expected</th>
                      <th style={{ width: 140 }}>Received</th><th className="rt">Still owed</th><th /></tr>
                  </thead>
                  <tbody>
                    {data.orders.map((o) => (
                      <tr key={o.po_id}>
                        <td><Link to={`/purchase-orders/${o.po_id}`}>
                          <b className="mono">{o.doc_no}</b></Link>
                          <small>{dmy(o.po_date)}</small></td>
                        <td>{o.supplier_name}</td>
                        <td><small className="mono">{o.prns || '—'}</small></td>
                        <td>{o.expected_date ? dmy(o.expected_date) : '—'}
                          {Number(o.overdue) > 0 && (
                            <small style={{ color: 'var(--bad)' }}>{o.overdue}d late</small>)}</td>
                        <td>
                          <Meter value={Number(o.received_qty)} max={Number(o.ordered_qty)} />
                          <small className="mono">
                            {qty(o.received_qty)} of {qty(o.ordered_qty)}</small>
                        </td>
                        <td className="rt mono"><b>{qty(o.pending_qty)}</b></td>
                        <td className="rt">
                          <button className="btn sm pri" onClick={() => setReceiving(o)}>
                            Acknowledge
                          </button>
                        </td>
                      </tr>
                    ))}
                    {!data.orders.length && (
                      <tr><td colSpan={7}>
                        <Empty title="No direct deliveries outstanding">
                          Orders for this site are going through the central store.
                        </Empty>
                      </td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </Card>

            <Card title="What this site has signed for" sub="The last 40, both ways in">
              <div className="tw">
                <table>
                  <thead>
                    <tr><th>Document</th><th>Date</th><th>Kind</th>
                      <th className="rt">Units</th><th>By</th><th>Note</th></tr>
                  </thead>
                  <tbody>
                    {data.signed.map((s) => (
                      <tr key={`${s.kind}:${s.id}`}>
                        <td className="mono">{s.doc_no}</td>
                        <td>{dmy(s.on_date)}</td>
                        <td>{s.kind === 'DC'
                          ? <Tag>Challan signature</Tag>
                          : <Tag kind="ok">GRN — direct delivery</Tag>}</td>
                        <td className="rt mono">{qty(s.qty)}</td>
                        <td>{s.by_name || '—'}</td>
                        <td>{s.note || '—'}</td>
                      </tr>
                    ))}
                    {!data.signed.length && (
                      <tr><td colSpan={6}>
                        <Empty title="This site has not signed for anything yet" />
                      </td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </Card>
          </>
        )}
      </div>

      {acking && (
        <AckModal dcId={acking} onClose={() => setAcking(null)}
          onDone={() => { setAcking(null); reload(); }} />
      )}
      {receiving && (
        <ReceiveGrn poId={receiving.po_id} at={data.site.name} atSiteId={data.site.id}
          onClose={() => setReceiving(null)}
          onDone={() => { setReceiving(null); reload(); }} />
      )}
    </>
  );
}

/* ===================================================================
   The site's own shelf. Quantities, never money.
   =================================================================== */
export function SiteStock() {
  const { siteId, picker } = useSite();
  const [f, setF] = useState({ q: '', sort: 'item', hideEmpty: true });
  const [open, setOpen] = useState(null);
  const qs = new URLSearchParams({
    ...(f.q ? { q: f.q } : {}),
    sort: f.sort, hideEmpty: String(f.hideEmpty),
  }).toString();
  const { data, error, loading, reload } = useApi(
    siteId ? `/site-store/${siteId}/stock?${qs}` : null, [siteId, qs]);
  const rows = data?.rows || [];

  const grab = () => downloadCsv(`site-stock-${data?.site.code || ''}`, [
    ['Code', 'Item', 'Unit', 'On site', 'On the road to it', 'Last in', 'Last moved'],
    ...rows.map((r) => [r.item_code, r.item_name, r.uom, r.qty, r.incoming_qty || 0,
      r.last_in ? dmy(r.last_in) : '', r.last_moved ? dmy(r.last_moved) : '']),
  ]);

  return (
    <>
      <PageHead title="Site store" sub={data ? `${data.site.name} — what this site holds` : ''}
        actions={
          <div style={{ display: 'flex', gap: 9 }}>
            <Link className="btn" to={`/site/inbox?site=${siteId}`}>Acknowledgements</Link>
            <button className="btn" onClick={grab} disabled={!rows.length}>Download</button>
          </div>
        } />
      <div className="page-body">
        {error && <ErrorNote error={error} onRetry={reload} />}

        <Card>
          <div className="pad" style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            {picker}
            <Field label="Find an item">
              <input className="inp" style={{ width: 250 }} value={f.q}
                placeholder="By name or code"
                onChange={(e) => setF((x) => ({ ...x, q: e.target.value }))} />
            </Field>
            <Field label="Sort by">
              <select className="inp" style={{ width: 160 }} value={f.sort}
                onChange={(e) => setF((x) => ({ ...x, sort: e.target.value }))}>
                <option value="item">Item name</option>
                <option value="qty">Most held</option>
                <option value="moved">Recently moved</option>
              </select>
            </Field>
            <label style={{ display: 'flex', gap: 6, alignItems: 'center', paddingBottom: 8 }}>
              <input type="checkbox" checked={f.hideEmpty}
                onChange={(e) => setF((x) => ({ ...x, hideEmpty: e.target.checked }))} />
              Hide nil balances
            </label>
          </div>
        </Card>

        {data && (
          <div className="stats">
            <Stat n={data.totals.items} label="items on site" />
            <Stat n={qty(data.totals.qty)} label="units held" />
            <Stat n={qty(data.totals.incoming)} label="on the road to it"
              tone={data.totals.incoming ? 'warn' : undefined} />
          </div>
        )}

        <Banner kind="info" icon="₹">
          A site store keeps quantities, not rates. What this material cost was settled by the
          purchase order, and it is the central store that carries the value.
        </Banner>

        {loading ? <Loading /> : (
          <Card title={`${rows.length} item${rows.length === 1 ? '' : 's'}`}
            sub="Click one for how it got here">
            <div className="tw">
              <table>
                <thead>
                  <tr>
                    <th>Code</th><th>Item</th><th style={{ width: 56 }}>Unit</th>
                    <th className="rt">On site</th><th className="rt">On the road</th>
                    <th>Last in</th><th>Last moved</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.item_id} style={{ cursor: 'pointer' }}
                      onClick={() => setOpen(r.item_id)}>
                      <td className="mono" style={{ color: 'var(--brand-ink)' }}>{r.item_code}</td>
                      <td><b>{r.item_name}</b></td>
                      <td>{r.uom}</td>
                      <td className="rt mono"><b>{qty(r.qty)}</b></td>
                      <td className="rt mono">
                        {Number(r.incoming_qty)
                          ? <Tag kind="warn">{qty(r.incoming_qty)}</Tag> : '—'}
                      </td>
                      <td>{r.last_in ? dmy(r.last_in) : '—'}</td>
                      <td>{r.last_moved ? dmy(r.last_moved) : '—'}</td>
                    </tr>
                  ))}
                  {!rows.length && (
                    <tr><td colSpan={7}>
                      <Empty title={f.q ? `Nothing here matches "${f.q}"` : 'This site holds nothing yet'}>
                        Material lands here when the site signs for a delivery.
                      </Empty>
                    </td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        )}
      </div>

      {open && (
        <SiteItemCard siteId={siteId} itemId={open} onClose={() => setOpen(null)} />
      )}
    </>
  );
}

function SiteItemCard({ siteId, itemId, onClose }) {
  const [peek, setPeek] = useState(null);
  const { data, loading } = useApi(`/site-store/${siteId}/stock/${itemId}`, [siteId, itemId]);
  if (loading || !data) return <Modal title="Item" onClose={onClose}><Loading /></Modal>;
  if (peek) return <DocPeek doc={peek} onClose={() => setPeek(null)} />;

  return (
    <Modal wide title={data.item.name} sub={`${data.item.code} · at ${data.site.name}`}
      onClose={onClose}
      footer={<button className="btn" onClick={onClose}>Close</button>}>
      <div className="stats">
        <Stat n={qty(data.balance.qty || 0)} label={`${data.item.uom} on site`} tone="brand" />
      </div>
      <div className="tw" style={{ maxHeight: 420, overflowY: 'auto' }}>
        <table>
          <thead>
            <tr><th>Date</th><th>Document</th><th>Why</th>
              <th className="rt">In</th><th className="rt">Out</th><th>By</th></tr>
          </thead>
          <tbody>
            {data.moves.map((m) => (
              <tr key={m.id}>
                <td>{dmy(m.moved_on)}</td>
                <td><DocLink refType={m.ref_type} refId={m.ref_id} refNo={m.ref_no}
                  onPeek={setPeek} /></td>
                <td>{m.kind === 'DC_IN' ? 'Signed for off a challan'
                  : m.kind === 'GRN' ? 'Delivered direct on an order' : m.kind}</td>
                <td className="rt mono" style={{ color: 'var(--ok)' }}>
                  {Number(m.qty) > 0 ? `+${qty(m.qty)}` : ''}</td>
                <td className="rt mono" style={{ color: 'var(--bad)' }}>
                  {Number(m.qty) < 0 ? qty(Math.abs(m.qty)) : ''}</td>
                <td>{m.by_name || '—'}</td>
              </tr>
            ))}
            {!data.moves.length && (
              <tr><td colSpan={6}><Empty title="Never moved" /></td></tr>
            )}
          </tbody>
        </table>
      </div>
    </Modal>
  );
}
