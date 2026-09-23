import { useMemo, useState } from 'react';
import { useApp } from '../App';
import { qty, dmy, plural } from '../api';
import { useApi, Modal, Loading, ErrorNote, Code, Status, Stat } from './ui';

/**
 * A PRN as the store needs to read it, opened where the store is
 * working rather than on a page its login does not reach.
 *
 * Items only — the BOQ is Planning's business. For each item: what the
 * site asked for, what has been sent so far, what is on the road, what
 * the site has received, and what is still left to send — beside what
 * this store holds now, which is what decides whether it can go.
 */
export function PrnLink({ id, children, className = 'linkish' }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={className}
        style={className === 'linkish' ? undefined : { font: 'inherit', cursor: 'pointer', border: 0 }}
        onClick={(e) => { e.stopPropagation(); e.preventDefault(); setOpen(true); }}>
        {children}
      </button>
      {open && <StorePrnPeek id={id} onClose={() => setOpen(false)} />}
    </>
  );
}

export function StorePrnPeek({ id, onClose }) {
  const { storeId, store } = useApp();
  const { data, error, loading } = useApi(`/indents/${id}`, [id]);
  const stock = useApi(storeId ? `/store/stock?storeId=${storeId}` : null, [storeId]);

  const items = useMemo(() => {
    const held = Object.fromEntries((stock.data?.rows || []).map((r) => [r.item_id, Number(r.qty)]));
    return (data?.flow || []).map((f) => {
      const asked = Number(f.indented_qty) || 0;
      const sent = Number(f.issued_qty) || 0;
      return { ...f, asked, sent, left: Math.max(Math.round((asked - sent) * 1000) / 1000, 0), held: held[f.item_id] };
    }).sort((a, b) => a.item_name.localeCompare(b.item_name));
  }, [data, stock.data]);

  const sum = (k) => items.reduce((t, x) => t + (Number(x[k]) || 0), 0);
  const n = (v) => (Number(v) ? qty(v) : '—');

  return (
    <div onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
      <Modal wide title={data ? data.docNo : 'PRN'}
        sub={data ? `${data.site.name} · raised by ${data.raisedBy || '—'} on ${dmy(data.indentDate)}`
          + `${data.neededBy ? ` · needed by ${dmy(data.neededBy)}` : ''}` : undefined}
        onClose={onClose}
        footer={<button className="btn pri" onClick={onClose}>Close</button>}>
        {error && <ErrorNote error={error} />}
        {loading && !data ? <Loading what="the PRN" /> : data && (
          <>
            <div className="stats" style={{ marginBottom: 16 }}>
              <Stat n={qty(sum('asked'))} label="asked for" />
              <Stat n={qty(sum('sent'))} label="sent till date" />
              <Stat n={qty(sum('in_transit_qty'))} label="on the road" />
              <Stat n={qty(sum('at_site_qty'))} label="received at site" />
              <Stat n={qty(sum('left'))} label="left to send" />
            </div>
            <div className="tw">
              <table>
                <thead>
                  <tr>
                    <th style={{ width: 110 }}>Item code</th><th>Item</th><th style={{ width: 62 }}>Unit</th>
                    <th className="rt">Asked for</th><th className="rt">Sent till date</th>
                    <th className="rt">On the road</th><th className="rt">Received at site</th>
                    <th className="rt">Left to send</th>
                    {storeId && <th className="rt" title={store ? `On the shelf at ${store.name}` : undefined}>In store now</th>}
                  </tr>
                </thead>
                <tbody>
                  {items.map((it) => (
                    <tr key={`${it.item_id}-${it.make_id || ''}`}>
                      <td style={{ whiteSpace: 'nowrap' }}><Code>{it.item_code}</Code></td>
                      <td>{it.item_name}{it.make_name && <small>{it.make_name}</small>}</td>
                      <td>{it.uom}</td>
                      <td className="rt mono"><b>{qty(it.asked)}</b></td>
                      <td className="rt mono">{n(it.sent)}</td>
                      <td className="rt mono">{n(it.in_transit_qty)}</td>
                      <td className="rt mono">{n(it.at_site_qty)}</td>
                      <td className="rt mono">
                        {it.left > 0 ? <b style={{ color: 'var(--st-stop)' }}>{qty(it.left)}</b> : <Status tone="done" label="All sent" />}
                      </td>
                      {storeId && (
                        <td className="rt mono">
                          {it.held ? qty(it.held) : '—'}
                          {it.left > 0 && (it.held || 0) >= it.left && <small style={{ color: 'var(--st-done)' }}>can send</small>}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
                {items.length > 1 && (
                  <tfoot>
                    <tr>
                      <th colSpan={3} style={{ textAlign: 'left' }}>{plural(items.length, 'item')}</th>
                      <th className="rt mono">{qty(sum('asked'))}</th>
                      <th className="rt mono">{qty(sum('sent'))}</th>
                      <th className="rt mono">{qty(sum('in_transit_qty'))}</th>
                      <th className="rt mono">{qty(sum('at_site_qty'))}</th>
                      <th className="rt mono">{qty(sum('left'))}</th>
                      {storeId && <th />}
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </>
        )}
      </Modal>
    </div>
  );
}
