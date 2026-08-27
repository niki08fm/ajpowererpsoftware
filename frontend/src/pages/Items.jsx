import { useState } from 'react';
import { PageHead } from '../App';
import { money, qty } from '../api';
import { useApi, Card, Tag, Empty, Loading, ErrorNote, Banner } from '../components/ui';

/**
 * 2,600 items. Everything here is searched and paged on the server —
 * the client never holds the whole list, and neither does a dropdown.
 */
const PAGE = 60;

export default function Items() {
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('');
  const [type, setType] = useState('');
  const [page, setPage] = useState(1);

  const { data: cats } = useApi('/masters/categories');
  const path = `/items?page=${page}&pageSize=${PAGE}`
    + (q.trim() ? `&q=${encodeURIComponent(q.trim())}` : '')
    + (cat ? `&categoryId=${cat}` : '')
    + (type ? `&type=${type}` : '');
  const { data, error, loading, reload } = useApi(path);

  const pages = data ? Math.ceil(data.total / PAGE) : 1;
  const reset = (fn) => (e) => { fn(e.target.value); setPage(1); };

  return (
    <>
      <PageHead title="Item master" sub="Codes are the company's own — nobody types them" />
      <div className="page-body">
        {error && <ErrorNote error={error} onRetry={reload} />}
        <Banner kind="info" icon="◆">
          <b>Items are picked, never typed.</b> Every other screen selects from this list, so the same
          thing cannot enter twice under two spellings.
        </Banner>

        <div className="searchbar">
          <input className="inp" style={{ minWidth: 260 }} placeholder="Search code, name or make"
            value={q} onChange={reset(setQ)} />
          <select className="inp" value={cat} onChange={reset(setCat)}>
            <option value="">All categories</option>
            {(cats || []).map((c) => <option key={c.id} value={c.id}>{c.name} ({c.item_count})</option>)}
          </select>
          <select className="inp" value={type} onChange={reset(setType)}>
            <option value="">Billable and consumable</option>
            <option value="BILLABLE">Billable only</option>
            <option value="CONSUMABLE">Consumable only</option>
          </select>
          {data && (
            <span style={{ color: 'var(--muted)' }}>
              {data.total.toLocaleString('en-IN')} item{data.total === 1 ? '' : 's'}
            </span>
          )}
        </div>

        <Card>
          {loading ? <Loading /> : (
            <div className="tw">
              <table>
                <thead>
                  <tr>
                    <th style={{ width: 108 }}>Code</th><th>Item</th><th style={{ width: 80 }}>Unit</th>
                    <th style={{ width: 110 }}>Type</th>
                    <th className="rt" style={{ width: 110 }}>Rate</th>
                    <th className="rt" style={{ width: 110 }}>Opening</th>
                  </tr>
                </thead>
                <tbody>
                  {(data?.items || []).map((i) => (
                    <tr key={i.id}>
                      <td><Tag kind="brand">{i.code}</Tag></td>
                      <td>
                        <b>{i.name}</b>
                        <small>
                          {i.category.name}
                          {i.makes.length ? ` · ${i.makes.slice(0, 5).join(', ')}${i.makes.length > 5 ? ` +${i.makes.length - 5}` : ''}` : ' · make not specified'}
                        </small>
                      </td>
                      <td>{i.uom}</td>
                      <td>
                        <Tag kind={i.type === 'CONSUMABLE' ? 'warn' : 'ok'}>
                          {i.type === 'CONSUMABLE' ? 'Consumable' : 'Billable'}
                        </Tag>
                      </td>
                      <td className="rt mono">{Number(i.stdRate) ? money(i.stdRate) : '—'}</td>
                      <td className="rt mono">{Number(i.openingQty) ? qty(i.openingQty) : '—'}</td>
                    </tr>
                  ))}
                  {!(data?.items || []).length && (
                    <tr><td colSpan={6}><Empty title="Nothing matches">Try fewer words, or part of the code.</Empty></td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
          {pages > 1 && (
            <div className="pad" style={{ display: 'flex', gap: 10, alignItems: 'center', borderTop: '1px solid var(--line-2)' }}>
              <button className="btn sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</button>
              <span style={{ color: 'var(--muted)' }}>Page {page} of {pages}</span>
              <button className="btn sm" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>Next</button>
            </div>
          )}
        </Card>
      </div>
    </>
  );
}
