import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useApp, PageHead } from '../App';
import { qty, dmy, plural, canWrite } from '../api';
import { downloadCsv } from '../download';
import {
  useApi, Card, Empty, Loading, ErrorNote, Banner, Field, Modal, Stat, Meter, Status, Code,
} from '../components/ui';
import { Icon } from '../components/icons';
import { AckModal } from './Challans';
import { ReceiveGrn } from './Grns';
import { DocLink, DocPeek } from './Store';

/**
 * The site's side of the store.
 *
 * Receiving happens here, not at the central store. Whatever is
 * directed at this site — a challan the store dispatched, or an order
 * the buyer had delivered straight to site — is this team's to receive.
 * Nothing lands on the site's shelf until they confirm what arrived.
 *
 * Trial 1 called this "acknowledging" and "signing for", and "sign" is
 * also what a GM does to approve. Here it is receiving, and the button
 * says Confirm receipt.
 *
 * And the site's shelf keeps no rates. The site never negotiated a
 * price and has no business quoting one; what it holds is a quantity.
 */

/**
 * Which site this screen is answered for.
 *
 * Picked once, on the cards the Site department opens with, and switched
 * from the top bar.
 *
 * `picker` is kept so older call sites still destructure cleanly; there
 * is nothing left for it to draw.
 */
export function useSite() {
  const { siteId, allSites, branchId } = useApp();
  const sites = (allSites || []).filter((x) => !branchId || x.branch.id === branchId);
  return { siteId: siteId ? String(siteId) : '', sites, picker: null };
}

/* ===================================================================
   Receive deliveries: what is on its way to this site.
   =================================================================== */
export function SiteInbox() {
  const { siteId } = useSite();
  const [acking, setAcking] = useState(null);
  const [receiving, setReceiving] = useState(null);
  const { data, error, loading, reload } = useApi(
    siteId ? `/site-store/${siteId}/inbox` : null, [siteId]);
  const mayReceive = canWrite('/challans/0/acknowledge');

  return (
    <>
      <PageHead title="Receive deliveries"
        sub={data ? `What is on its way to ${data.site.name}. Count what comes off the lorry and confirm that.` : 'What is on its way to this site'}
        actions={<Link className="btn" to="/site/stock">Site stock</Link>} />
      <div className="page-body">
        {error && <ErrorNote error={error} onRetry={reload} />}

        {loading || !data ? <Loading what="deliveries" /> : (
          <>
            <Card className="pad" >
              <div className="stats">
                <Stat n={data.totals.waiting} label="deliveries to receive" one="delivery to receive" />
                <Stat n={qty(data.totals.inTransitQty)} label="units on the road here" one="unit on the road here" />
                <Stat n={qty(data.totals.onOrderQty)} label="units on order, delivered straight here" one="unit on order, delivered straight here" />
                <Stat n={data.totals.overdue} label="overdue" tone={data.totals.overdue ? 'bad' : undefined} />
              </div>
            </Card>

            <Banner kind="info">
              Only what you confirm goes into <b>{data.site.name}</b>&apos;s stock. If something is short,
              confirm what arrived — the rest stays on the challan as not yet received until somebody
              accounts for it.
            </Banner>

            <Card title="Delivery challans from the store"
              sub="Dispatched by the central store and not yet received in full">
              <div className="tw">
                <table>
                  <thead>
                    <tr><th>Challan</th><th>From</th><th>For PRN</th><th>Vehicle</th>
                      <th style={{ width: 150 }}>Received so far</th><th className="rt">Not yet received</th>
                      <th>On the road</th><th /></tr>
                  </thead>
                  <tbody>
                    {data.challans.map((c) => (
                      <tr key={c.dc_id}>
                        <td><Link className="linkish" to={`/challans/${c.dc_id}`}><Code>{c.doc_no}</Code></Link>
                          <small>Dispatched {dmy(c.dc_date)}</small></td>
                        <td>{c.from_name}</td>
                        <td>{c.prns ? <Code>{c.prns}</Code> : '—'}</td>
                        <td><Code>{c.vehicle_no || '—'}</Code></td>
                        <td>
                          <Meter value={Number(c.acked_qty)} max={Number(c.sent_qty)} label="Received so far" />
                          <small className="mono">{qty(c.acked_qty)} of {qty(c.sent_qty)}</small>
                        </td>
                        <td className="rt mono"><b>{qty(c.in_transit_qty)}</b></td>
                        <td>
                          {Number(c.days_out) > 3
                            ? <Status tone="attention" icon="clock" label={plural(c.days_out, 'day')} hint="On the road more than 3 days" />
                            : <span className="mono">{Number(c.days_out) ? plural(c.days_out, 'day') : 'Today'}</span>}
                        </td>
                        <td className="rt">
                          {mayReceive && (
                            <button className="btn sm pri" onClick={() => setAcking(c.dc_id)}>
                              Confirm receipt
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                    {!data.challans.length && (
                      <tr><td colSpan={8}>
                        <Empty icon="truck" title="Nothing is on the road to this site">
                          Everything the store dispatched here has been received.
                        </Empty>
                      </td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </Card>

            <Card title="Purchase orders delivered straight to this site"
              sub="Procurement had the supplier deliver here instead of the central store, so this site receives them">
              <div className="tw">
                <table>
                  <thead>
                    <tr><th>PO</th><th>Supplier</th><th>For PRN</th><th>Expected</th>
                      <th style={{ width: 150 }}>Received so far</th><th className="rt">Still to receive</th><th /></tr>
                  </thead>
                  <tbody>
                    {data.orders.map((o) => (
                      <tr key={o.po_id}>
                        <td><Link className="linkish" to={`/purchase-orders/${o.po_id}`}><Code>{o.doc_no}</Code></Link>
                          <small>{dmy(o.po_date)}</small></td>
                        <td>{o.supplier_name}</td>
                        <td>{o.prns ? <Code>{o.prns}</Code> : '—'}</td>
                        <td className="mono">{o.expected_date ? dmy(o.expected_date) : '—'}
                          {Number(o.overdue) > 0 && (
                            <small style={{ color: 'var(--st-stop)', fontWeight: 600 }}>{plural(o.overdue, 'day')} late</small>)}</td>
                        <td>
                          <Meter value={Number(o.received_qty)} max={Number(o.ordered_qty)} label="Received so far" />
                          <small className="mono">{qty(o.received_qty)} of {qty(o.ordered_qty)}</small>
                        </td>
                        <td className="rt mono"><b>{qty(o.pending_qty)}</b></td>
                        <td className="rt">
                          {mayReceive && (
                            <button className="btn sm pri" onClick={() => setReceiving(o)}>
                              Confirm receipt
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                    {!data.orders.length && (
                      <tr><td colSpan={7}>
                        <Empty title="No direct deliveries are due">
                          Orders for this site are coming through the central store.
                        </Empty>
                      </td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </Card>

            <Card title="Received at this site" sub="The last 40 receipts, from the store and straight from suppliers">
              <div className="tw">
                <table>
                  <thead>
                    <tr><th>Document</th><th>Received on</th><th>How it came</th>
                      <th className="rt">Units</th><th>Received by</th><th>Note</th></tr>
                  </thead>
                  <tbody>
                    {data.signed.map((s) => (
                      <tr key={`${s.kind}:${s.id}`}>
                        <td><Code>{s.doc_no}</Code></td>
                        <td className="mono">{dmy(s.on_date)}</td>
                        <td>{s.kind === 'DC'
                          ? <Status tone="neutral" icon="truck" label="Delivery challan from store" />
                          : <Status tone="neutral" icon="box" label="GRN — straight from supplier" />}</td>
                        <td className="rt mono">{qty(s.qty)}</td>
                        <td>{s.by_name || '—'}</td>
                        <td>{s.note || '—'}</td>
                      </tr>
                    ))}
                    {!data.signed.length && (
                      <tr><td colSpan={6}>
                        <Empty title="Nothing has been received at this site yet" />
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
   The site's own stock. Quantities, never money.
   =================================================================== */
export function SiteStock() {
  const { siteId } = useSite();
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
    ['Item code', 'Item', 'Unit', 'In site stock', 'On the road here', 'Last received', 'Last moved'],
    ...rows.map((r) => [r.item_code, r.item_name, r.uom, r.qty, r.incoming_qty || 0,
      r.last_in ? dmy(r.last_in) : '', r.last_moved ? dmy(r.last_moved) : '']),
  ]);

  return (
    <>
      <PageHead title="Site stock" sub={data ? `What ${data.site.name} holds now, in quantities` : ''}
        actions={
          <>
            <Link className="btn" to="/site/inbox">Receive deliveries</Link>
            <button className="btn" onClick={grab} disabled={!rows.length}
              title={rows.length ? undefined : 'Nothing to download'}><Icon name="download" size={14} />Download</button>
          </>
        } />
      <div className="page-body">
        {error && <ErrorNote error={error} onRetry={reload} />}

        <Card>
          <div className="pad searchbar" style={{ marginBottom: 0 }}>
            <Field label="Find an item">
              <input className="inp" style={{ width: 260 }} value={f.q} type="search"
                placeholder="Name or code…" spellCheck={false}
                onChange={(e) => setF((x) => ({ ...x, q: e.target.value }))} />
            </Field>
            <Field label="Sort by">
              <select className="inp" style={{ width: 170 }} value={f.sort}
                onChange={(e) => setF((x) => ({ ...x, sort: e.target.value }))}>
                <option value="item">Item name</option>
                <option value="qty">Most held</option>
                <option value="moved">Recently moved</option>
              </select>
            </Field>
            <label style={{ display: 'flex', gap: 7, alignItems: 'center', paddingBottom: 9 }}>
              <input type="checkbox" checked={f.hideEmpty}
                onChange={(e) => setF((x) => ({ ...x, hideEmpty: e.target.checked }))} />
              Hide items with nothing left
            </label>
          </div>
        </Card>

        {data && (
          <div className="stats" style={{ margin: '16px 0' }}>
            <Stat n={data.totals.items} label="items in stock" />
            <Stat n={qty(data.totals.qty)} label="units held" />
            <Stat n={qty(data.totals.incoming)} label="units on the road here" one="unit on the road here" />
          </div>
        )}

        <Banner kind="info">
          Site stock is kept in quantities, not money. What the material cost was settled on the
          purchase order, and the central store carries the value.
        </Banner>

        {loading && !data ? <Loading what="site stock" /> : (
          <Card title={plural(rows.length, 'item')}
            sub="Select an item to see every movement that brought it here or took it out">
            <div className="tw">
              <table>
                <thead>
                  <tr>
                    <th style={{ width: 110 }}>Item code</th><th>Item</th><th style={{ width: 60 }}>Unit</th>
                    <th className="rt">In stock</th><th className="rt">On the road here</th>
                    <th>Last received</th><th>Last moved</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.item_id} className="click" tabIndex={0}
                      onClick={() => setOpen(r.item_id)}
                      onKeyDown={(e) => { if (e.key === 'Enter') setOpen(r.item_id); }}>
                      <td><Code>{r.item_code}</Code></td>
                      <td><b>{r.item_name}</b></td>
                      <td>{r.uom}</td>
                      <td className="rt mono"><b>{qty(r.qty)}</b></td>
                      <td className="rt mono">{Number(r.incoming_qty) ? qty(r.incoming_qty) : '—'}</td>
                      <td className="mono">{r.last_in ? dmy(r.last_in) : '—'}</td>
                      <td className="mono">{r.last_moved ? dmy(r.last_moved) : '—'}</td>
                    </tr>
                  ))}
                  {!rows.length && (
                    <tr><td colSpan={7}>
                      <Empty title={f.q ? `No item here matches “${f.q}”` : 'This site holds nothing yet'}>
                        {f.q ? 'Try fewer words, or part of the code.' : 'Material arrives here when the site confirms receipt of a delivery.'}
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

const MOVE_WHY = {
  DC_IN: 'Received off a delivery challan',
  GRN: 'Received straight from a supplier',
  ISSUE: 'Issued to a worker',
  RETURN: 'Taken back from a worker',
  DC_OUT: 'Dispatched to another site',
};

function SiteItemCard({ siteId, itemId, onClose }) {
  const [peek, setPeek] = useState(null);
  const { data, loading } = useApi(`/site-store/${siteId}/stock/${itemId}`, [siteId, itemId]);
  if (loading || !data) return <Modal title="Item" onClose={onClose}><Loading what="the item" /></Modal>;
  if (peek) return <DocPeek doc={peek} onClose={() => setPeek(null)} />;

  return (
    <Modal wide title={data.item.name} sub={`${data.item.code} · at ${data.site.name}`}
      onClose={onClose}
      footer={<button className="btn" onClick={onClose}>Close</button>}>
      <div className="stats" style={{ marginBottom: 12 }}>
        <Stat n={`${qty(data.balance.qty || 0)} ${data.item.uom}`} label="in site stock now" />
      </div>
      <div className="tw" style={{ maxHeight: 420, overflowY: 'auto' }}>
        <table>
          <thead>
            <tr><th>Date</th><th>Document</th><th>What happened</th>
              <th className="rt">In</th><th className="rt">Out</th><th>By</th></tr>
          </thead>
          <tbody>
            {data.moves.map((m) => (
              <tr key={m.id}>
                <td className="mono">{dmy(m.moved_on)}</td>
                <td><DocLink refType={m.ref_type} refId={m.ref_id} refNo={m.ref_no}
                  onPeek={setPeek} /></td>
                <td>{MOVE_WHY[m.kind] || m.kind}</td>
                <td className="rt mono">{Number(m.qty) > 0 ? `+${qty(m.qty)}` : ''}</td>
                <td className="rt mono">{Number(m.qty) < 0 ? `−${qty(Math.abs(m.qty))}` : ''}</td>
                <td>{m.by_name || '—'}</td>
              </tr>
            ))}
            {!data.moves.length && (
              <tr><td colSpan={6}><Empty title="This item has never moved here" /></td></tr>
            )}
          </tbody>
        </table>
      </div>
    </Modal>
  );
}
