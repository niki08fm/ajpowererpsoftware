import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp, PageHead } from '../App';
import { api, qty, dmy, today } from '../api';
import {
  useApi, Card, Tag, Empty, Loading, ErrorNote, Banner, Field, Stat, useToast, Modal,
} from '../components/ui';

/**
 * Consumption closes the spine: material indented against a BOQ line
 * is used against that same line. Until the store side exists, a site
 * can only use what its indents actually got approved for — so the
 * quantity available is indented less already used.
 */
export default function Consumption() {
  const { branchId } = useApp();
  const toast = useToast();
  const nav = useNavigate();

  const { data: sites } = useApi(branchId ? `/indents/sites?branchId=${branchId}` : null, [branchId]);
  const { data: list, loading, error, reload } = useApi(
    branchId ? `/consumption?branchId=${branchId}` : null, [branchId]);

  const [open, setOpen] = useState(false);
  const [siteId, setSiteId] = useState('');
  const site = (sites || []).find((s) => s.id === Number(siteId));
  const { data: avail } = useApi(site ? `/consumption/boq/${site.boq_id}/available` : null, [site?.boq_id]);

  const [rows, setRows] = useState([]);
  const [usedOn, setUsedOn] = useState(today());
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (!siteId && sites?.length) setSiteId(String(sites[0].id)); }, [sites, siteId]);

  const byId = useMemo(
    () => Object.fromEntries((avail || []).map((l) => [l.boq_line_id, l])), [avail]);
  const free = (avail || []).filter((l) => !rows.some((r) => r.boqLineId === l.boq_line_id));

  const tooMuch = rows.filter((r) => {
    const l = byId[r.boqLineId];
    return l && Number(r.qty) > Number(l.available_qty);
  }).length;

  const reset = () => { setRows([]); setNote(''); setUsedOn(today()); setOpen(false); };

  const save = async (confirm) => {
    const clean = rows.filter((r) => Number(r.qty) > 0);
    if (!clean.length) return toast('Add at least one line', 'bad');
    setBusy(true);
    try {
      const r = await api.post('/consumption', {
        siteId: Number(siteId), usedOn, note: note || undefined,
        lines: clean.map((x) => ({ boqLineId: x.boqLineId, qty: Number(x.qty) })),
        confirm,
      });
      toast(confirm ? `${r.docNo} confirmed` : `${r.docNo} saved as a draft`, 'ok');
      reset(); reload();
    } catch (e) { toast(e.message, 'bad'); }
    setBusy(false);
    return undefined;
  };

  const confirmEntry = async (id) => {
    try {
      await api.post(`/consumption/${id}/confirm`);
      toast('Consumption confirmed', 'ok'); reload();
    } catch (e) { toast(e.message, 'bad'); }
  };

  const row = (c) => (
    <tr key={c.id}>
      <td><b>{c.doc_no}</b><small>{c.recorded_by_name || '—'}</small></td>
      <td>{c.site_name}</td>
      <td className="mono">{dmy(c.used_on)}</td>
      <td className="rt mono">{c.line_count}</td>
      <td className="rt mono">{qty(c.total_qty)}</td>
      <td>{c.status === 'DRAFT' ? <Tag kind="warn">Draft</Tag> : <Tag kind="ok">Confirmed</Tag>}</td>
      <td className="rt">
        {c.status === 'DRAFT' && (
          <button className="btn sm pri" onClick={() => confirmEntry(c.id)}>Confirm</button>
        )}
      </td>
    </tr>
  );

  const head = (
    <thead><tr>
      <th>Entry</th><th>Site</th><th>Used on</th><th className="rt">Lines</th>
      <th className="rt">Quantity</th><th>Status</th><th />
    </tr></thead>
  );

  return (
    <>
      <PageHead title="Consumption" sub="What the site used, booked against the BOQ line it was indented on"
        actions={<button className="btn pri" onClick={() => setOpen(true)}>Record consumption</button>} />
      <div className="page-body">
        {error && <ErrorNote error={error} onRetry={reload} />}
        <Banner kind="info" icon="●">
          Material is booked against the same BOQ line it was indented on — which is what lets anyone ask
          how much of line 1a is left and get an answer that agrees with every document behind it.
          A site can only use what its indents were approved for.
        </Banner>

        {loading ? <Loading /> : (
          <>
            {!!(list?.drafts || []).length && (
              <Card title="Drafts" sub="A working note — nothing counts as used until it is confirmed">
                <div className="tw"><table>{head}<tbody>{list.drafts.map(row)}</tbody></table></div>
              </Card>
            )}
            <Card title="Confirmed">
              <div className="tw">
                <table>{head}
                  <tbody>
                    {(list?.entries || []).map(row)}
                    {!(list?.entries || []).length && (
                      <tr><td colSpan={7}>
                        <Empty title="Nothing consumed yet">
                          Once an indent is approved, what arrives can be booked against its BOQ line.
                        </Empty>
                      </td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </Card>
          </>
        )}
      </div>

      {open && (
        <Modal wide title="Record consumption" sub="Only what has been indented and not yet used"
          onClose={reset}
          footer={<>
            <button className="btn" onClick={reset}>Cancel</button>
            <button className="btn" disabled={busy} onClick={() => save(false)}>Save draft</button>
            <button className="btn pri" disabled={busy || !!tooMuch} onClick={() => save(true)}>
              Confirm consumption
            </button>
          </>}>
          <div className="row2">
            <Field label="Site">
              <select className="inp" value={siteId} onChange={(e) => { setSiteId(e.target.value); setRows([]); }}>
                {(sites || []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </Field>
            <Field label="Used on">
              <input className="inp" type="date" value={usedOn} onChange={(e) => setUsedOn(e.target.value)} />
            </Field>
          </div>

          {!(avail || []).length ? (
            <Banner kind="warn" icon="!">
              Nothing has been indented and approved on this site yet, so there is nothing at site to use.
            </Banner>
          ) : (
            <>
              <Field label="Add an item">
                <select className="inp" value=""
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    if (v) setRows((r) => [...r, { boqLineId: v, qty: '' }]);
                  }}>
                  <option value="">Choose a BOQ line…</option>
                  {free.map((l) => (
                    <option key={l.boq_line_id} value={l.boq_line_id}>
                      {l.sno} · {l.item_code} — {l.item_name} ({qty(l.available_qty)} at site)
                    </option>
                  ))}
                </select>
              </Field>

              <div className="tw">
                <table className="sheet">
                  <thead>
                    <tr>
                      <th style={{ width: 52 }}>Sl No</th><th>Item</th>
                      <th className="rt" style={{ width: 84 }}>Indented</th>
                      <th className="rt" style={{ width: 76 }}>Used</th>
                      <th className="rt" style={{ width: 82 }}>At site</th>
                      <th className="rt" style={{ width: 96 }}>Using now</th>
                      <th style={{ width: 40 }} />
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r, i) => {
                      const l = byId[r.boqLineId];
                      if (!l) return null;
                      const excess = Number(r.qty) > Number(l.available_qty);
                      return (
                        <tr key={r.boqLineId}>
                          <td className="sn">{l.sno}</td>
                          <td><b>{l.item_name}</b><small className="mono">{l.item_code} · {l.uom}</small></td>
                          <td className="rt mono">{qty(l.approved_qty)}</td>
                          <td className="rt mono">{qty(l.consumed_qty)}</td>
                          <td className="rt mono">{qty(l.available_qty)}</td>
                          <td>
                            <input className="inp rt" type="number" min="0" step="any" value={r.qty}
                              style={excess ? { borderColor: 'var(--bad)' } : undefined}
                              onChange={(e) => setRows((x) => x.map((y, n) => (n === i ? { ...y, qty: e.target.value } : y)))} />
                            {excess && (
                              <small style={{ color: 'var(--bad)' }}>only {qty(l.available_qty)} at site</small>
                            )}
                          </td>
                          <td>
                            <button className="btn sm bad" title="Remove"
                              onClick={() => setRows((x) => x.filter((_, n) => n !== i))}>✕</button>
                          </td>
                        </tr>
                      );
                    })}
                    {!rows.length && (
                      <tr><td colSpan={7}><Empty title="Nothing added yet">Choose a BOQ line above.</Empty></td></tr>
                    )}
                  </tbody>
                </table>
              </div>

              <Field label="Note" hint="Optional — where it went, or which activity used it.">
                <input className="inp" value={note} onChange={(e) => setNote(e.target.value)}
                  placeholder="e.g. east riser, floors 3 to 6" />
              </Field>

              {tooMuch > 0 && (
                <Banner kind="bad" icon="▲">
                  {tooMuch} line(s) ask for more than is at site. Reduce them, or indent more first.
                </Banner>
              )}
            </>
          )}
        </Modal>
      )}
    </>
  );
}
