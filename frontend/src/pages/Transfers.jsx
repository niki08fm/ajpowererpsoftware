import { useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useApp, PageHead } from '../App';
import { api, qty, dmy, today } from '../api';
import { downloadCsv } from '../download';
import {
  useApi, Card, Tag, Empty, Loading, ErrorNote, Banner, Field, Modal, Stat, useToast,
} from '../components/ui';
import { useSite } from './SiteStore';

/**
 * Material moving between two sites, because the store sent it there.
 *
 * The store is the only party that starts one of these. A site raises a
 * PRN, the store hasn't got the material and knows another site is
 * sitting on it, and asks that site to send it straight across rather
 * than buy it twice.
 *
 * The sending site accepts and writes an ordinary challan. The
 * receiving site signs for it in the ordinary way — to them their PRN
 * has simply arrived, and there is nothing new on that end at all.
 *
 * The sending site is then short of material it indented for its own
 * work, and reorders it from the history screen. That reorder is a real
 * PRN the store must fulfil, but it is a REPLACEMENT: it does not count
 * against the site's BOQ a second time, because the site indented that
 * material once already.
 */

const STATE = {
  AWAITING:   { kind: 'warn',  label: 'Waiting on them' },
  TO_SEND:    { kind: 'brand', label: 'Accepted — to send' },
  PART_SENT:  { kind: 'brand', label: 'Part sent' },
  IN_TRANSIT: { kind: 'warn',  label: 'On the way' },
  COMPLETE:   { kind: 'ok',    label: 'Done' },
  REJECTED:   { kind: 'bad',   label: 'Refused' },
  CANCELLED:  { kind: '',      label: 'Cancelled' },
};
const tag = (s) => STATE[s] || { kind: '', label: s };

/* ==================================================================
   The store's side: ask a site to send material against a PRN.
   Opened from the PRNs-to-fulfil list.
   ================================================================== */
export function SourceFromSitePage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { storeId } = useApp();
  const indentId = params.get('prn');
  const back = () => navigate('/store/prns');

  const toast = useToast();
  const { data, loading, error } = useApi(
    indentId ? `/transfers/prn/${indentId}/outstanding` : null, [indentId]);
  const [fromSiteId, setFromSiteId] = useState('');
  const [ask, setAsk] = useState({});
  const [neededBy, setNeededBy] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  if (loading) return <Loading />;
  if (error) return <div className="page-body"><ErrorNote error={error} /></div>;
  if (!data) return <div className="page-body"><Empty title="No such PRN" /></div>;

  const { prn, lines, holders } = data;
  const heldAt = (siteId, itemId) => Number(
    holders.find((h) => h.siteId === Number(siteId) && h.itemId === itemId)?.qty || 0);

  // only sites that hold something this PRN is short of are worth asking
  const candidates = [...new Map(holders.map((h) => [h.siteId,
    { id: h.siteId, name: h.siteName, code: h.siteCode }])).values()];

  const going = lines.filter((l) => Number(ask[l.itemId]) > 0);
  const over = lines.filter((l) => Number(ask[l.itemId]) > heldAt(fromSiteId, l.itemId) + 0.0005
    || Number(ask[l.itemId]) > l.toDeliverQty + 0.0005);

  const save = async () => {
    setBusy(true);
    try {
      const r = await api.post('/transfers', {
        storeId, fromSiteId: Number(fromSiteId), indentId: prn.id,
        requestDate: today(), neededBy: neededBy || prn.neededBy?.slice(0, 10) || null,
        note: note.trim() || undefined,
        lines: going.map((g) => ({ itemId: g.itemId, qty: Number(ask[g.itemId]) })),
      });
      toast(`${r.docNo} sent to ${r.from.name}`, 'ok');
      back();
    } catch (e) { toast(e.message, 'bad'); } finally { setBusy(false); }
  };

  return (
    <>
      <PageHead title={`Source ${prn.docNo} from another site`}
        sub={`${prn.site.name} wants this. Ask a site that already holds it to send it across.`}
        actions={
          <>
            <button className="btn" onClick={back}>Back</button>
            <button className="btn pri"
              disabled={busy || !fromSiteId || !going.length || over.length > 0}
              onClick={save}>Send the request</button>
          </>
        } />
      <div className="page-body">
        <Banner kind="info" icon="◆">
          The material goes straight from that site to <b>{prn.site.name}</b> and never touches
          this store, so none of it appears in the store&rsquo;s stock ledger. {prn.site.name}
          {' '}signs for it as an ordinary challan and it closes out {prn.docNo}.
        </Banner>

        {!candidates.length ? (
          <Card><Empty title="No other site in this branch is holding any of it">
            Nothing outstanding on {prn.docNo} is sitting on another site&rsquo;s shelf, so there
            is nothing to transfer. Buy it, or issue it from this store.
          </Empty></Card>
        ) : (
          <>
            <div className="searchbar">
              <Field label="Ask which site" hint="Only sites holding some of it are listed">
                <select className="inp" style={{ width: 260 }} value={fromSiteId}
                  onChange={(e) => { setFromSiteId(e.target.value); setAsk({}); }}>
                  <option value="">Choose a site</option>
                  {candidates.map((c) => (
                    <option key={c.id} value={c.id}>{c.name} · {c.code}</option>
                  ))}
                </select>
              </Field>
              <Field label="Wanted by" hint={prn.neededBy ? `PRN says ${dmy(prn.neededBy)}` : 'Optional'}>
                <input type="date" className="inp" style={{ width: 170 }} value={neededBy}
                  onChange={(e) => setNeededBy(e.target.value)} />
              </Field>
            </div>

            {over.length > 0 && (
              <Banner kind="bad" icon="!">
                {over.length} line{over.length === 1 ? '' : 's'} above what that site holds, or
                above what the PRN is still owed.
              </Banner>
            )}

            <Card title={`${prn.docNo} — still outstanding`}
              sub={fromSiteId ? 'Type what to ask that site for' : 'Choose a site above first'}>
              <div className="tw">
                <table className="sheet">
                  <thead>
                    <tr>
                      <th style={{ width: 104 }}>Code</th><th>Item</th>
                      <th style={{ width: 56 }}>Unit</th>
                      <th className="rt" style={{ width: 100 }}>Still owed</th>
                      <th className="rt" style={{ width: 110 }}>They hold</th>
                      <th className="rt" style={{ width: 118 }}>Ask for</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map((l) => {
                      const h = fromSiteId ? heldAt(fromSiteId, l.itemId) : 0;
                      return (
                        <tr key={l.itemId}>
                          <td className="mono" style={{ color: 'var(--brand-ink)' }}>{l.itemCode}</td>
                          <td>{l.itemName}{l.make && <small>{l.make}</small>}</td>
                          <td>{l.uom}</td>
                          <td className="rt mono"><b>{qty(l.toDeliverQty)}</b></td>
                          <td className="rt mono"
                            style={{ color: h > 0 ? 'var(--ok)' : 'var(--faint)' }}>
                            {fromSiteId ? (h > 0 ? qty(h) : 'nothing held') : '—'}
                          </td>
                          <td>
                            <input className="inp rt" type="number" min="0" step="any"
                              disabled={!fromSiteId || h <= 0}
                              value={ask[l.itemId] ?? ''}
                              onChange={(e) => setAsk((a) => ({ ...a, [l.itemId]: e.target.value }))} />
                          </td>
                        </tr>
                      );
                    })}
                    {!lines.length && (
                      <tr><td colSpan={6}>
                        <Empty title="Nothing outstanding on this PRN" /></td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </Card>

            <Card className="pad">
              <Field label="A word to them" hint="Optional">
                <input className="inp" value={note} onChange={(e) => setNote(e.target.value)}
                  placeholder="You have this on the shelf and they need it Thursday" />
              </Field>
            </Card>
          </>
        )}
      </div>
    </>
  );
}

/* ==================================================================
   The store's own list of every request it has raised.
   ================================================================== */
export function StoreTransfers() {
  const { branchId, storeId } = useApp();
  const [show, setShow] = useState('OPEN');
  const { data, error, loading, reload } = useApi(
    storeId ? `/transfers?storeId=${storeId}&show=${show}` : null, [storeId, show]);
  const toast = useToast();

  const cancel = async (id) => {
    try { await api.post(`/transfers/${id}/cancel`); toast('Cancelled', 'ok'); reload(); }
    catch (e) { toast(e.message, 'bad'); }
  };

  return (
    <>
      <PageHead title="Transfer requests"
        sub="PRNs this store chose to answer from another site's shelf" />
      <div className="page-body">
        {error && <ErrorNote error={error} onRetry={reload} />}
        <Banner kind="info" icon="◆">
          Raised from <b>PRNs to fulfil</b> — the “From a site” button on any PRN this store
          cannot fill. The material never enters this store, so it never shows in its stock
          ledger.
        </Banner>

        <div className="searchbar">
          <Field label="Show">
            <select className="inp" value={show} onChange={(e) => setShow(e.target.value)}>
              <option value="OPEN">Still open</option>
              <option value="ALL">Everything</option>
            </select>
          </Field>
        </div>

        {data && (
          <Card className="pad">
            <div className="stats">
              <Stat n={data.totals.awaiting} label="waiting on the sending site"
                tone={data.totals.awaiting ? 'warn' : undefined} />
              <Stat n={data.totals.toSend} label="accepted, not yet sent" />
              <Stat n={data.totals.inTransit} label="on the way" />
              <Stat n={data.totals.late} label="past the day wanted"
                tone={data.totals.late ? 'bad' : undefined} />
            </div>
          </Card>
        )}

        {loading ? <Loading /> : (
          <Card title={`${data?.rows.length || 0} request${data?.rows.length === 1 ? '' : 's'}`}>
            <div className="tw">
              <table>
                <thead>
                  <tr>
                    <th style={{ width: 140 }}>Request</th>
                    <th>Asked of</th><th>To send to</th>
                    <th style={{ width: 140 }}>Against PRN</th>
                    <th className="rt" style={{ width: 88 }}>Asked</th>
                    <th className="rt" style={{ width: 88 }}>Sent</th>
                    <th style={{ width: 160 }}>State</th>
                    <th style={{ width: 90 }} />
                  </tr>
                </thead>
                <tbody>
                  {(data?.rows || []).map((r) => (
                    <tr key={r.id}>
                      <td><b className="mono" style={{ color: 'var(--brand-ink)' }}>{r.docNo}</b>
                        <small>{dmy(r.requestDate)}</small></td>
                      <td><b>{r.from.name}</b><small>{r.from.code}</small></td>
                      <td>{r.to.name}</td>
                      <td className="mono">{r.indent.docNo}</td>
                      <td className="rt mono">{qty(r.requestedQty)}</td>
                      <td className="rt mono">{r.sentQty ? qty(r.sentQty) : '—'}</td>
                      <td>
                        <Tag kind={tag(r.state).kind}>{tag(r.state).label}</Tag>
                        {r.state === 'REJECTED' && r.decideNote && (
                          <small style={{ color: 'var(--bad)' }}>{r.decideNote}</small>)}
                      </td>
                      <td>
                        {['AWAITING', 'TO_SEND'].includes(r.state) && r.sentQty === 0 && (
                          <button className="btn sm bad" onClick={() => cancel(r.id)}>Cancel</button>
                        )}
                      </td>
                    </tr>
                  ))}
                  {!(data?.rows || []).length && (
                    <tr><td colSpan={8}>
                      <Empty title="This store has not asked any site to send anything">
                        Use “From a site” on a PRN it cannot fill.
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

/* ==================================================================
   The site's side: requests to answer, and what it has sent.
   ================================================================== */
export function SiteTransfers() {
  const { siteId } = useSite();
  const [show, setShow] = useState('OPEN');
  const [open, setOpen] = useState(null);

  const { data, error, loading, reload } = useApi(
    siteId ? `/transfers?fromSiteId=${siteId}&show=${show}` : null, [siteId, show]);

  return (
    <>
      <PageHead title="Transfers out"
        sub="Material the store has asked this site to send to another site" />
      <div className="page-body">
        {error && <ErrorNote error={error} onRetry={reload} />}

        <div className="searchbar">
          <Field label="Show">
            <select className="inp" value={show} onChange={(e) => setShow(e.target.value)}>
              <option value="OPEN">Still open</option>
              <option value="ALL">Everything</option>
            </select>
          </Field>
        </div>

        {data && (
          <Card className="pad">
            <div className="stats">
              <Stat n={data.totals.awaiting} label="to answer"
                tone={data.totals.awaiting ? 'warn' : undefined} />
              <Stat n={data.totals.toSend} label="accepted, to send" />
              <Stat n={data.totals.inTransit} label="on the way" />
              <Stat n={data.totals.late} label="past the day wanted"
                tone={data.totals.late ? 'bad' : undefined} />
            </div>
          </Card>
        )}

        {loading ? <Loading /> : (
          <Card title={`${data?.rows.length || 0} request${data?.rows.length === 1 ? '' : 's'}`}>
            <div className="tw">
              <table>
                <thead>
                  <tr>
                    <th style={{ width: 140 }}>Request</th>
                    <th>Send to</th>
                    <th style={{ width: 140 }}>Against PRN</th>
                    <th style={{ width: 110 }}>Wanted by</th>
                    <th className="rt" style={{ width: 88 }}>Asked</th>
                    <th className="rt" style={{ width: 88 }}>Sent</th>
                    <th style={{ width: 160 }}>State</th>
                    <th style={{ width: 110 }} />
                  </tr>
                </thead>
                <tbody>
                  {(data?.rows || []).map((r) => (
                    <tr key={r.id}>
                      <td>
                        <button className="linkish" onClick={() => setOpen(r.id)}>{r.docNo}</button>
                        <small>{dmy(r.requestDate)}</small>
                      </td>
                      <td><b>{r.to.name}</b><small>{r.to.code}</small></td>
                      <td className="mono">{r.indent.docNo}</td>
                      <td className="mono">
                        {dmy(r.neededBy)}
                        {r.daysLate > 0 && <small style={{ color: 'var(--bad)' }}>
                          {r.daysLate}d late</small>}
                      </td>
                      <td className="rt mono">{qty(r.requestedQty)}</td>
                      <td className="rt mono">{r.sentQty ? qty(r.sentQty) : '—'}</td>
                      <td><Tag kind={tag(r.state).kind}>{tag(r.state).label}</Tag></td>
                      <td>
                        <button className="btn sm" onClick={() => setOpen(r.id)}>
                          {r.state === 'AWAITING' ? 'Answer'
                            : ['TO_SEND', 'PART_SENT'].includes(r.state) ? 'Send' : 'Open'}
                        </button>
                      </td>
                    </tr>
                  ))}
                  {!(data?.rows || []).length && (
                    <tr><td colSpan={8}>
                      <Empty title="Nothing has been asked of this site">
                        The store raises these when it decides to answer another site&rsquo;s PRN
                        from this site&rsquo;s shelf.
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
        <RequestDetail id={open} onClose={() => setOpen(null)} onChanged={reload} />
      )}
    </>
  );
}

function RequestDetail({ id, onClose, onChanged }) {
  const toast = useToast();
  const { data, loading, reload } = useApi(`/transfers/${id}`, [id]);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [sending, setSending] = useState(false);

  if (loading || !data) return <Modal title="Request" onClose={onClose}><Loading /></Modal>;

  const decide = async (action) => {
    if (action === 'REJECTED' && !note.trim()) {
      return toast('Say why — the store has to find it somewhere else', 'bad');
    }
    setBusy(true);
    try {
      await api.post(`/transfers/${id}/decide`, { action, note: note.trim() || undefined });
      toast(action === 'ACCEPTED' ? 'Accepted' : 'Refused', action === 'ACCEPTED' ? 'ok' : '');
      reload(); onChanged();
    } catch (e) { toast(e.message, 'bad'); } finally { setBusy(false); }
  };

  const short = data.lines.filter((l) => l.shortBy > 0);

  return (
    <Modal wide title={data.docNo}
      sub={`Send to ${data.to.name}, against their ${data.indent.docNo}`}
      onClose={onClose}
      actions={<Tag kind={tag(data.state).kind}>{tag(data.state).label}</Tag>}
      footer={
        <>
          <button className="btn" onClick={onClose}>Close</button>
          {data.state === 'AWAITING' && (
            <>
              <button className="btn bad" disabled={busy} onClick={() => decide('REJECTED')}>Refuse</button>
              <button className="btn pri" disabled={busy} onClick={() => decide('ACCEPTED')}>Accept</button>
            </>
          )}
          {['TO_SEND', 'PART_SENT'].includes(data.state) && (
            <button className="btn pri" onClick={() => setSending(true)}>Send it</button>
          )}
        </>
      }>
      <div className="stats" style={{ marginBottom: 14 }}>
        <Stat n={qty(data.requestedQty)} label="asked for" />
        <Stat n={qty(data.sentQty)} label="sent" />
        <Stat n={qty(data.ackedQty)} label="signed for there" />
        <Stat n={dmy(data.neededBy)} label="wanted by"
          tone={data.daysLate > 0 ? 'bad' : undefined} />
      </div>

      {data.state === 'REJECTED' && (
        <Banner kind="bad" icon="!">
          Refused{data.decidedBy ? ` by ${data.decidedBy}` : ''}
          {data.decideNote ? ` — ${data.decideNote}` : ''}
        </Banner>
      )}
      {data.state === 'AWAITING' && short.length > 0 && (
        <Banner kind="warn" icon="◆">
          This site is short on {short.length} line{short.length === 1 ? '' : 's'}. You can accept
          and send what there is — the rest stays open.
        </Banner>
      )}
      {['TO_SEND', 'PART_SENT', 'IN_TRANSIT', 'COMPLETE'].includes(data.state) && (
        <Banner kind="info" icon="◆">
          What you send here leaves this site&rsquo;s shelf. You can ask the store to replace it
          from <b>Sent &amp; reorder</b> once the challan is out.
        </Banner>
      )}

      <div className="tw">
        <table>
          <thead>
            <tr>
              <th style={{ width: 104 }}>Code</th><th>Item</th><th style={{ width: 56 }}>Unit</th>
              <th className="rt" style={{ width: 88 }}>Asked</th>
              <th className="rt" style={{ width: 88 }}>Sent</th>
              <th className="rt" style={{ width: 96 }}>We hold</th>
            </tr>
          </thead>
          <tbody>
            {data.lines.map((l) => (
              <tr key={l.lineId}>
                <td className="mono" style={{ color: 'var(--brand-ink)' }}>{l.itemCode}</td>
                <td>{l.itemName}{l.make && <small>{l.make}</small>}</td>
                <td>{l.uom}</td>
                <td className="rt mono"><b>{qty(l.requestedQty)}</b></td>
                <td className="rt mono">{l.sentQty ? qty(l.sentQty) : '—'}</td>
                <td className="rt mono" style={{ color: l.shortBy > 0 ? 'var(--bad)' : undefined }}>
                  {qty(l.heldQty)}
                  {l.shortBy > 0 && <small style={{ color: 'var(--bad)' }}>short {qty(l.shortBy)}</small>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {data.state === 'AWAITING' && (
        <Field label="A word back" hint="Required if you are refusing">
          <input className="inp" value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      )}

      {sending && (
        <SendModal tr={data} onClose={() => setSending(false)}
          onSent={() => { setSending(false); reload(); onChanged(); }} />
      )}
    </Modal>
  );
}

function SendModal({ tr, onClose, onSent }) {
  const toast = useToast();
  const [rows, setRows] = useState(() => tr.lines.filter((l) => l.pendingQty > 0)
    .map((l) => ({ ...l, send: String(Math.min(l.pendingQty, l.heldQty) || '') })));
  const [head, setHead] = useState({ dcDate: today(), vehicleNo: '', driver: '' });
  const [busy, setBusy] = useState(false);

  const going = rows.filter((r) => Number(r.send) > 0);
  const over = rows.filter((r) => Number(r.send) > r.heldQty + 0.0005
    || Number(r.send) > r.pendingQty + 0.0005);

  const send = async (dispatch) => {
    setBusy(true);
    try {
      const r = await api.post('/challans', {
        fromSiteId: tr.from.id, toSiteId: tr.to.id, dcDate: head.dcDate,
        vehicleNo: head.vehicleNo.trim() || undefined,
        driver: head.driver.trim() || undefined,
        dispatch,
        lines: going.map((g) => ({ itemId: g.itemId, qty: Number(g.send), trId: tr.id })),
      });
      toast(`${r.docNo} ${dispatch ? 'dispatched' : 'saved as a draft'}`, 'ok');
      onSent();
    } catch (e) { toast(e.message, 'bad'); } finally { setBusy(false); }
  };

  return (
    <Modal wide title={`Send against ${tr.docNo}`}
      sub={`${tr.from.name} → ${tr.to.name}. This writes an ordinary delivery challan.`}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn" disabled={busy || !going.length || over.length > 0}
            onClick={() => send(false)}>Save draft</button>
          <button className="btn pri" disabled={busy || !going.length || over.length > 0}
            onClick={() => send(true)}>Dispatch</button>
        </>
      }>
      {over.length > 0 && (
        <Banner kind="bad" icon="!">
          {over.length} line{over.length === 1 ? '' : 's'} above what is held or what was asked for.
        </Banner>
      )}
      <Banner kind="info" icon="◆">
        Stock leaves this site on dispatch and lands on {tr.to.name}&rsquo;s shelf when they sign
        for it. It closes out their {tr.indent.docNo} as though the store had sent it.
      </Banner>

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <Field label="Challan date">
          <input type="date" className="inp" style={{ width: 170 }} value={head.dcDate}
            onChange={(e) => setHead((h) => ({ ...h, dcDate: e.target.value }))} />
        </Field>
        <Field label="Vehicle" hint="Optional">
          <input className="inp mono" style={{ width: 150 }} value={head.vehicleNo}
            onChange={(e) => setHead((h) => ({ ...h, vehicleNo: e.target.value.toUpperCase() }))} />
        </Field>
        <Field label="Driver" hint="Optional">
          <input className="inp" style={{ width: 160 }} value={head.driver}
            onChange={(e) => setHead((h) => ({ ...h, driver: e.target.value }))} />
        </Field>
      </div>

      <div className="tw">
        <table className="sheet">
          <thead>
            <tr>
              <th style={{ width: 104 }}>Code</th><th>Item</th>
              <th className="rt" style={{ width: 92 }}>Still asked</th>
              <th className="rt" style={{ width: 92 }}>We hold</th>
              <th className="rt" style={{ width: 110 }}>Sending</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.lineId}>
                <td className="mono" style={{ color: 'var(--brand-ink)' }}>{r.itemCode}</td>
                <td>{r.itemName}<small>{r.uom}</small></td>
                <td className="rt mono">{qty(r.pendingQty)}</td>
                <td className="rt mono">{qty(r.heldQty)}</td>
                <td>
                  <input className="inp rt" type="number" min="0" step="any" value={r.send}
                    onChange={(e) => setRows((rs) => rs.map((x) => (x.lineId === r.lineId
                      ? { ...x, send: e.target.value } : x)))} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Modal>
  );
}

/* ==================================================================
   What this site has sent, document by document — and the reorder.
   ================================================================== */
export function SentAndReorder() {
  const { siteId } = useSite();
  const [reordering, setReordering] = useState(false);
  const [openDoc, setOpenDoc] = useState(null);
  const hist = useApi(siteId ? `/transfers/site/${siteId}/history` : null, [siteId]);
  const lent = useApi(siteId ? `/transfers/site/${siteId}/lent-out?show=ALL` : null, [siteId]);

  const toReorder = (lent.data?.totals.toReorder || 0);

  const grab = () => downloadCsv(`transfers-out-${hist.data.site.code}`, [
    ['Transfer challans sent from', hist.data.site.name],
    ['Challan', 'Date', 'Sent to', 'Against PRN', 'Request', 'Items', 'Sent', 'Signed for', 'State'],
    ...hist.data.docs.map((d) => [d.docNo, dmy(d.date), d.to.name, d.prns, d.requests,
      d.lineCount, d.sentQty, d.ackedQty, d.state]),
  ]);

  return (
    <>
      <PageHead title="Sent &amp; reorder"
        sub="Every transfer challan this site has written, and replacing what went out"
        actions={
          <>
            {hist.data?.docs.length ? <button className="btn" onClick={grab}>Download</button> : null}
            <button className="btn pri" disabled={!siteId || toReorder <= 0}
              onClick={() => setReordering(true)}>
              Reorder issued stock
            </button>
          </>
        } />
      <div className="page-body">
        {hist.error && <ErrorNote error={hist.error} onRetry={hist.reload} />}

        {lent.data && (
          <Card className="pad">
            <div className="stats">
              <Stat n={hist.data?.totals.challans || 0} label="transfer challans" />
              <Stat n={qty(lent.data.totals.lent)} label="units lent out" />
              <Stat n={qty(lent.data.totals.reordered)} label="already reordered" />
              <Stat n={qty(lent.data.totals.toReorder)} label="still to reorder"
                tone={lent.data.totals.toReorder > 0 ? 'warn' : undefined} />
            </div>
          </Card>
        )}

        <Banner kind="info" icon="◆">
          A reorder is a PRN on the central store like any other — but it does <b>not</b> count
          against this site&rsquo;s BOQ a second time. The material was indented once already and
          then lent away; counting it twice would overstate the BOQ and the billing ceiling with it.
        </Banner>

        {hist.loading ? <Loading /> : (
          <Card title="Sent, document by document"
            sub="Click a challan to see what was inside it and what the far end signed for">
            <div className="tw">
              <table>
                <thead>
                  <tr>
                    <th style={{ width: 150 }}>Challan</th>
                    <th>Sent to</th>
                    <th style={{ width: 150 }}>Against PRN</th>
                    <th className="rt" style={{ width: 80 }}>Items</th>
                    <th className="rt" style={{ width: 88 }}>Sent</th>
                    <th className="rt" style={{ width: 96 }}>Signed for</th>
                    <th className="rt" style={{ width: 96 }}>In transit</th>
                    <th style={{ width: 120 }}>State</th>
                  </tr>
                </thead>
                <tbody>
                  {(hist.data?.docs || []).map((d) => (
                    <tr key={d.dcId} style={{ cursor: 'pointer' }} onClick={() => setOpenDoc(d)}>
                      <td>
                        <b className="mono" style={{ color: 'var(--brand-ink)' }}>{d.docNo}</b>
                        <small>{dmy(d.date)}{d.vehicleNo ? ` · ${d.vehicleNo}` : ''}</small>
                      </td>
                      <td>{d.to.name}</td>
                      <td className="mono">{d.prns}<small>{d.requests}</small></td>
                      <td className="rt mono">{d.lineCount}</td>
                      <td className="rt mono">{qty(d.sentQty)}</td>
                      <td className="rt mono">{qty(d.ackedQty)}</td>
                      <td className="rt mono">
                        {d.inTransitQty ? <Tag kind="warn">{qty(d.inTransitQty)}</Tag> : '—'}
                      </td>
                      <td>{d.state}</td>
                    </tr>
                  ))}
                  {!(hist.data?.docs || []).length && (
                    <tr><td colSpan={8}>
                      <Empty title="This site has sent nothing to another site">
                        Transfer challans appear here once the store asks this site to send
                        something and it does.
                      </Empty>
                    </td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        )}
      </div>

      {openDoc && (
        <Modal title={openDoc.docNo}
          sub={`To ${openDoc.to.name} · ${dmy(openDoc.date)} · against ${openDoc.prns}`}
          onClose={() => setOpenDoc(null)}
          footer={<button className="btn" onClick={() => setOpenDoc(null)}>Close</button>}>
          <div className="tw">
            <table>
              <thead><tr><th style={{ width: 104 }}>Code</th><th>Item</th>
                <th style={{ width: 56 }}>Unit</th>
                <th className="rt" style={{ width: 90 }}>Sent</th>
                <th className="rt" style={{ width: 100 }}>Signed for</th></tr></thead>
              <tbody>
                {openDoc.items.map((i, n) => (
                  <tr key={n}>
                    <td className="mono" style={{ color: 'var(--brand-ink)' }}>{i.itemCode}</td>
                    <td>{i.itemName}</td><td>{i.uom}</td>
                    <td className="rt mono">{qty(i.sentQty)}</td>
                    <td className="rt mono">{qty(i.ackedQty)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Modal>
      )}

      {reordering && (
        <ReorderModal siteId={siteId} rows={lent.data?.rows || []}
          onClose={() => setReordering(false)}
          onSaved={() => { setReordering(false); lent.reload(); }} />
      )}
    </>
  );
}

/**
 * Reorder issued stock.
 *
 * Cumulative: what has been lent out over every transfer challan, what
 * has already been asked back, and what is left. The cap is what was
 * lent — past that point a site is not replacing anything, it is
 * indenting, and indenting has its own form that counts against the BOQ.
 */
function ReorderModal({ siteId, rows, onClose, onSaved }) {
  const toast = useToast();
  const [order, setOrder] = useState(() => Object.fromEntries(
    rows.filter((r) => r.toReorderQty > 0).map((r) => [r.itemId, String(r.toReorderQty)])));
  const [neededBy, setNeededBy] = useState('');
  const [busy, setBusy] = useState(false);

  const live = rows.filter((r) => r.toReorderQty > 0);
  const going = live.filter((r) => Number(order[r.itemId]) > 0);
  const over = live.filter((r) => Number(order[r.itemId]) > r.toReorderQty + 0.0005);

  const save = async () => {
    setBusy(true);
    try {
      const r = await api.post(`/transfers/site/${siteId}/reorder`, {
        indentDate: today(), neededBy: neededBy || null,
        lines: going.map((g) => ({ itemId: g.itemId, qty: Number(order[g.itemId]) })),
      });
      toast(`${r.docNo} raised — it does not count against the BOQ`, 'ok');
      onSaved();
    } catch (e) { toast(e.message, 'bad'); } finally { setBusy(false); }
  };

  return (
    <Modal wide title="Reorder issued stock"
      sub="Replacing material this site sent to another site"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn pri" disabled={busy || !going.length || over.length > 0}
            onClick={save}>Raise the PRN</button>
        </>
      }>
      <Banner kind="info" icon="◆">
        This raises an ordinary PRN on the central store, which fulfils it the usual way.
        It is marked a replacement, so it does <b>not</b> add to this site&rsquo;s indented
        quantity — that material was indented once already, and lending it out did not make it twice.
      </Banner>
      {over.length > 0 && (
        <Banner kind="bad" icon="!">
          {over.length} line{over.length === 1 ? '' : 's'} above what was lent out.
        </Banner>
      )}

      <Field label="Wanted by" hint="Optional">
        <input type="date" className="inp" style={{ width: 180 }} value={neededBy}
          onChange={(e) => setNeededBy(e.target.value)} />
      </Field>

      <div className="tw">
        <table className="sheet">
          <thead>
            <tr>
              <th style={{ width: 104 }}>Code</th><th>Item</th>
              <th className="rt" style={{ width: 96 }}>Lent out</th>
              <th className="rt" style={{ width: 110 }}>Already asked</th>
              <th className="rt" style={{ width: 110 }}>Still to order</th>
              <th className="rt" style={{ width: 96 }}>On shelf</th>
              <th className="rt" style={{ width: 118 }}>Order now</th>
            </tr>
          </thead>
          <tbody>
            {live.map((r) => (
              <tr key={r.itemId}>
                <td className="mono" style={{ color: 'var(--brand-ink)' }}>{r.itemCode}</td>
                <td>{r.itemName}<small>{r.uom} · {r.challans} challan{r.challans === 1 ? '' : 's'}</small></td>
                <td className="rt mono">{qty(r.lentQty)}</td>
                <td className="rt mono">{r.reorderedQty ? qty(r.reorderedQty) : '—'}</td>
                <td className="rt mono"><b>{qty(r.toReorderQty)}</b></td>
                <td className="rt mono">{qty(r.onShelfQty)}</td>
                <td>
                  <input className="inp rt" type="number" min="0" step="any"
                    value={order[r.itemId] ?? ''}
                    onChange={(e) => setOrder((o) => ({ ...o, [r.itemId]: e.target.value }))} />
                </td>
              </tr>
            ))}
            {!live.length && (
              <tr><td colSpan={7}>
                <Empty title="Nothing left to reorder">
                  Everything this site lent out has already been asked back.
                </Empty>
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
    </Modal>
  );
}
