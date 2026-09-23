import { useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useApp, PageHead } from '../App';
import { api, qty, dmy, today, canWrite, plural } from '../api';
import { downloadCsv } from '../download';
import {
  useApi, Card, Empty, Loading, ErrorNote, Banner, Field, Modal, Stat, useToast, Status, DateField, Code,
} from '../components/ui';
import { Icon } from '../components/icons';
import { useSite } from './SiteStore';
import { transferState, dcState } from '../vocab';

/**
 * Material moving between two sites, because the store sent it there.
 *
 * The store is the only party that starts one of these. A site raises a
 * PRN, the store hasn't got the material and knows another site is
 * sitting on it, and asks that site to send it straight across rather
 * than buy it twice.
 *
 * The sending site accepts and writes an ordinary delivery challan.
 * The receiving site confirms receipt in the ordinary way — to them
 * their PRN has simply arrived, and there is nothing new on that end.
 *
 * The sending site is then short of material it asked for on its own
 * PRN, and reorders it from the history screen. That reorder is a real
 * PRN the store must fulfil, but it is a REPLACEMENT: it does not count
 * against the site's BOQ a second time, because the site already asked
 * for that material once.
 */

const TrTag = ({ state }) => <Status is={transferState(state)} />;

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

  if (loading) return <Loading what="the PRN" />;
  if (error) return <div className="page-body" style={{ paddingTop: 24 }}><ErrorNote error={error} /></div>;
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
      <PageHead title={`Ask another site to send ${prn.docNo}`}
        sub={`${prn.site.name} needs this and the store is short. Ask a site that already holds it to send it across.`}
        actions={
          <>
            <button className="btn" onClick={back}><Icon name="arrowLeft" size={14} />PRNs to fulfil</button>
            <button className="btn pri"
              disabled={busy || !fromSiteId || !going.length || over.length > 0}
              onClick={save}><Icon name="send" />Send the request</button>
          </>
        } />
      <div className="page-body">
        <Banner kind="info">
          The material goes straight from that site to <b>{prn.site.name}</b> and never passes through
          this store, so none of it appears in the store&rsquo;s stock ledger. {prn.site.name}
          {' '}confirms receipt of an ordinary delivery challan, and it counts towards <Code>{prn.docNo}</Code>.
        </Banner>

        {!candidates.length ? (
          <Card><Empty title="No other site in this branch holds any of it">
            Nothing still to deliver on {prn.docNo} is in another site&rsquo;s stock, so there
            is nothing to transfer. Buy it, or dispatch it from this store.
          </Empty></Card>
        ) : (
          <>
            <div className="searchbar">
              <Field label="Ask which site" hint="Only sites holding some of it are listed">
                <select className="inp" style={{ width: 260 }} value={fromSiteId}
                  onChange={(e) => { setFromSiteId(e.target.value); setAsk({}); }}>
                  <option value="">Choose a site…</option>
                  {candidates.map((c) => (
                    <option key={c.id} value={c.id}>{c.name} · {c.code}</option>
                  ))}
                </select>
              </Field>
              <DateField label="Needed by" value={neededBy}
                hint={prn.neededBy ? `The PRN says ${dmy(prn.neededBy)}` : 'Optional'}
                onChange={(e) => setNeededBy(e.target.value)} />
            </div>

            {over.length > 0 && (
              <Banner kind="bad">
                {plural(over.length, 'line')} asks for more than that site holds, or more than
                the PRN still needs.
              </Banner>
            )}

            <Card title={`${prn.docNo} — still to deliver`}
              sub={fromSiteId ? 'Type what to ask that site for' : 'Choose a site above first'}>
              <div className="tw">
                <table className="sheet">
                  <thead>
                    <tr>
                      <th style={{ width: 110 }}>Item code</th><th>Item</th>
                      <th style={{ width: 56 }}>Unit</th>
                      <th className="rt" style={{ width: 110 }}>Still to deliver</th>
                      <th className="rt" style={{ width: 120 }}>That site holds</th>
                      <th className="rt" style={{ width: 118 }}>Ask for</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map((l) => {
                      const h = fromSiteId ? heldAt(fromSiteId, l.itemId) : 0;
                      return (
                        <tr key={l.itemId}>
                          <td><Code>{l.itemCode}</Code></td>
                          <td>{l.itemName}{l.make && <small>{l.make}</small>}</td>
                          <td>{l.uom}</td>
                          <td className="rt mono"><b>{qty(l.toDeliverQty)}</b></td>
                          <td className="rt mono"
                            style={{ color: h > 0 ? undefined : 'var(--faint)' }}>
                            {fromSiteId ? (h > 0 ? qty(h) : 'None') : '—'}
                          </td>
                          <td>
                            <input className="inp rt" type="number" min="0" step="any" inputMode="decimal"
                              aria-label={`Quantity of ${l.itemName} to ask for`}
                              disabled={!fromSiteId || h <= 0}
                              value={ask[l.itemId] ?? ''}
                              onChange={(e) => setAsk((a) => ({ ...a, [l.itemId]: e.target.value }))} />
                          </td>
                        </tr>
                      );
                    })}
                    {!lines.length && (
                      <tr><td colSpan={6}>
                        <Empty title="Nothing is still to deliver on this PRN" /></td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </Card>

            <Card className="pad">
              <Field label="Note to that site" hint="Optional">
                <input className="inp" value={note} onChange={(e) => setNote(e.target.value)}
                  placeholder="e.g. You have this in stock and they need it by Thursday" />
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
    try { await api.post(`/transfers/${id}/cancel`); toast('Request cancelled', 'ok'); reload(); }
    catch (e) { toast(e.message, 'bad'); }
  };

  return (
    <>
      <PageHead title="Site-to-site requests"
        sub="PRNs this store asked another site to answer from its own stock" />
      <div className="page-body">
        {error && <ErrorNote error={error} onRetry={reload} />}
        <Banner kind="info">
          Raised from <b>PRNs to fulfil</b> with “Ask another site”, on a PRN this store cannot fill.
          The material never enters this store, so it never shows in its stock ledger.
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
              <Stat n={data.totals.awaiting} label="waiting for the other site to answer" />
              <Stat n={data.totals.toSend} label="accepted, not yet sent" />
              <Stat n={data.totals.inTransit} label="on the road" />
              <Stat n={data.totals.late} label="past their needed-by date" one="past its needed-by date"
                tone={data.totals.late ? 'bad' : undefined} />
            </div>
          </Card>
        )}

        {loading && !data ? <Loading what="requests" /> : (
          <Card title={plural(data?.rows.length || 0, 'request')}>
            <div className="tw">
              <table>
                <thead>
                  <tr>
                    <th style={{ width: 150 }}>Request</th>
                    <th>Asked of</th><th>To send to</th>
                    <th style={{ width: 150 }}>For PRN</th>
                    <th className="rt" style={{ width: 88 }}>Asked for</th>
                    <th className="rt" style={{ width: 88 }}>Sent</th>
                    <th style={{ width: 190 }}>Status</th>
                    <th style={{ width: 90 }} />
                  </tr>
                </thead>
                <tbody>
                  {(data?.rows || []).map((r) => (
                    <tr key={r.id}>
                      <td><Code as="b">{r.docNo}</Code>
                        <small>{dmy(r.requestDate)}</small></td>
                      <td><b>{r.from.name}</b><small><Code>{r.from.code}</Code></small></td>
                      <td>{r.to.name}</td>
                      <td><Code>{r.indent.docNo}</Code></td>
                      <td className="rt mono">{qty(r.requestedQty)}</td>
                      <td className="rt mono">{r.sentQty ? qty(r.sentQty) : '—'}</td>
                      <td>
                        <TrTag state={r.state} />
                        {r.state === 'REJECTED' && r.decideNote && (
                          <small>“{r.decideNote}”</small>)}
                      </td>
                      <td>
                        {['AWAITING', 'TO_SEND'].includes(r.state) && r.sentQty === 0 && (
                          <button className="btn sm bad" onClick={() => cancel(r.id)}>Cancel request</button>
                        )}
                      </td>
                    </tr>
                  ))}
                  {!(data?.rows || []).length && (
                    <tr><td colSpan={8}>
                      <Empty title="This store has not asked any site to send anything">
                        Use “Ask another site” on a PRN the store cannot fill.
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
      <PageHead title="Send to another site"
        sub="Material the store has asked this site to send across to another site" />
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
              <Stat n={data.totals.awaiting} label="waiting for your answer"
                tone={data.totals.awaiting ? 'warn' : undefined} />
              <Stat n={data.totals.toSend} label="accepted, still to send" />
              <Stat n={data.totals.inTransit} label="on the road" />
              <Stat n={data.totals.late} label="past their needed-by date" one="past its needed-by date"
                tone={data.totals.late ? 'bad' : undefined} />
            </div>
          </Card>
        )}

        {loading && !data ? <Loading what="requests" /> : (
          <Card title={plural(data?.rows.length || 0, 'request')}>
            <div className="tw">
              <table>
                <thead>
                  <tr>
                    <th style={{ width: 150 }}>Request</th>
                    <th>Send to</th>
                    <th style={{ width: 150 }}>For PRN</th>
                    <th style={{ width: 130 }}>Needed by</th>
                    <th className="rt" style={{ width: 88 }}>Asked for</th>
                    <th className="rt" style={{ width: 88 }}>Sent</th>
                    <th style={{ width: 190 }}>Status</th>
                    <th style={{ width: 110 }} />
                  </tr>
                </thead>
                <tbody>
                  {(data?.rows || []).map((r) => (
                    <tr key={r.id}>
                      <td>
                        <button className="linkish" onClick={() => setOpen(r.id)}><Code>{r.docNo}</Code></button>
                        <small>{dmy(r.requestDate)}</small>
                      </td>
                      <td><b>{r.to.name}</b><small><Code>{r.to.code}</Code></small></td>
                      <td><Code>{r.indent.docNo}</Code></td>
                      <td className="mono">
                        {dmy(r.neededBy)}
                        {r.daysLate > 0 && <small style={{ color: 'var(--st-stop)', fontWeight: 600 }}>
                          {plural(r.daysLate, 'day')} late</small>}
                      </td>
                      <td className="rt mono">{qty(r.requestedQty)}</td>
                      <td className="rt mono">{r.sentQty ? qty(r.sentQty) : '—'}</td>
                      <td><TrTag state={r.state} /></td>
                      <td>
                        <button className="btn sm" onClick={() => setOpen(r.id)}>
                          {r.state === 'AWAITING' ? 'Answer request'
                            : ['TO_SEND', 'PART_SENT'].includes(r.state) ? 'Dispatch' : 'Open'}
                        </button>
                      </td>
                    </tr>
                  ))}
                  {!(data?.rows || []).length && (
                    <tr><td colSpan={8}>
                      <Empty title="Nothing has been asked of this site">
                        The store raises these when it decides to answer another site&rsquo;s PRN
                        from this site&rsquo;s stock.
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

  if (loading || !data) return <Modal title="Request" onClose={onClose}><Loading what="the request" /></Modal>;

  const decide = async (action) => {
    if (action === 'REJECTED' && !note.trim()) {
      return toast('Type the reason — the store has to find it somewhere else', 'bad');
    }
    setBusy(true);
    try {
      await api.post(`/transfers/${id}/decide`, { action, note: note.trim() || undefined });
      toast(action === 'ACCEPTED' ? 'Accepted — dispatch it when it is ready to go' : 'Rejected', action === 'ACCEPTED' ? 'ok' : '');
      reload(); onChanged();
    } catch (e) { toast(e.message, 'bad'); } finally { setBusy(false); }
  };

  const short = data.lines.filter((l) => l.shortBy > 0);

  return (
    <Modal wide title={data.docNo}
      sub={`Send to ${data.to.name}, for their ${data.indent.docNo}`}
      onClose={onClose}
      actions={<TrTag state={data.state} />}
      footer={
        <>
          <button className="btn" onClick={onClose}>Close</button>
          {data.state === 'AWAITING' && canWrite(`/transfers/${id}/decide`) && (
            <>
              <button className="btn bad" disabled={busy} onClick={() => decide('REJECTED')}
                title="Your site will not send it; the store finds it another way">Reject</button>
              <button className="btn pri" disabled={busy} onClick={() => decide('ACCEPTED')}
                title="Your site agrees to send it, then dispatches it on a delivery challan">Accept</button>
            </>
          )}
          {['TO_SEND', 'PART_SENT'].includes(data.state) && canWrite('/challans') && (
            <button className="btn pri" onClick={() => setSending(true)}><Icon name="truck" />Dispatch</button>
          )}
        </>
      }>
      <div className="stats" style={{ marginBottom: 14 }}>
        <Stat n={qty(data.requestedQty)} label="asked for" />
        <Stat n={qty(data.sentQty)} label="sent" />
        <Stat n={qty(data.ackedQty)} label="received there" />
        <Stat n={dmy(data.neededBy)} label="needed by"
          tone={data.daysLate > 0 ? 'bad' : undefined} />
      </div>

      {data.state === 'REJECTED' && (
        <Banner kind="bad">
          Rejected{data.decidedBy ? ` by ${data.decidedBy}` : ''}
          {data.decideNote ? ` — ${data.decideNote}` : ''}
        </Banner>
      )}
      {data.state === 'AWAITING' && short.length > 0 && (
        <Banner kind="warn">
          This site is short on {plural(short.length, 'line')}. You can accept and send what
          there is — the rest stays open.
        </Banner>
      )}
      {['TO_SEND', 'PART_SENT', 'IN_TRANSIT', 'COMPLETE'].includes(data.state) && (
        <Banner kind="info">
          What you send leaves this site&rsquo;s stock. You can ask the store to replace it from
          <b> Sent to other sites</b> once the challan is dispatched.
        </Banner>
      )}

      <div className="tw">
        <table>
          <thead>
            <tr>
              <th style={{ width: 110 }}>Item code</th><th>Item</th><th style={{ width: 56 }}>Unit</th>
              <th className="rt" style={{ width: 88 }}>Asked for</th>
              <th className="rt" style={{ width: 88 }}>Sent</th>
              <th className="rt" style={{ width: 110 }}>In our stock</th>
            </tr>
          </thead>
          <tbody>
            {data.lines.map((l) => (
              <tr key={l.lineId}>
                <td><Code>{l.itemCode}</Code></td>
                <td>{l.itemName}{l.make && <small>{l.make}</small>}</td>
                <td>{l.uom}</td>
                <td className="rt mono"><b>{qty(l.requestedQty)}</b></td>
                <td className="rt mono">{l.sentQty ? qty(l.sentQty) : '—'}</td>
                <td className="rt mono">
                  {qty(l.heldQty)}
                  {l.shortBy > 0 && <small style={{ color: 'var(--st-stop)', fontWeight: 600 }}>short by {qty(l.shortBy)}</small>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {data.state === 'AWAITING' && (
        <Field label="Reason" hint="Required if you reject it — the store sees this">
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
    <Modal wide title={`Dispatch for ${tr.docNo}`}
      sub={`${tr.from.name} → ${tr.to.name}. This writes an ordinary delivery challan.`}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn" disabled={busy || !going.length || over.length > 0}
            onClick={() => send(false)}>Save as draft</button>
          <button className="btn pri" disabled={busy || !going.length || over.length > 0}
            onClick={() => send(true)}><Icon name="truck" />Dispatch challan</button>
        </>
      }>
      {over.length > 0 && (
        <Banner kind="bad">
          {plural(over.length, 'line')} sends more than is in stock, or more than was asked for.
        </Banner>
      )}
      <Banner kind="info">
        Stock leaves this site on dispatch and goes into {tr.to.name}&rsquo;s stock when they confirm
        receipt. It counts towards their {tr.indent.docNo} as though the store had sent it.
      </Banner>

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <DateField label="Dispatch date" value={head.dcDate}
          onChange={(e) => setHead((h) => ({ ...h, dcDate: e.target.value }))} />
        <Field label="Vehicle number" hint="Optional">
          <input className="inp code" style={{ width: 160 }} value={head.vehicleNo} spellCheck={false}
            onChange={(e) => setHead((h) => ({ ...h, vehicleNo: e.target.value.toUpperCase() }))} />
        </Field>
        <Field label="Driver's name" hint="Optional">
          <input className="inp" style={{ width: 160 }} value={head.driver}
            onChange={(e) => setHead((h) => ({ ...h, driver: e.target.value }))} />
        </Field>
      </div>

      <div className="tw">
        <table className="sheet">
          <thead>
            <tr>
              <th style={{ width: 110 }}>Item code</th><th>Item</th>
              <th className="rt" style={{ width: 100 }}>Still to send</th>
              <th className="rt" style={{ width: 100 }}>In our stock</th>
              <th className="rt" style={{ width: 110 }}>Send now</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.lineId}>
                <td><Code>{r.itemCode}</Code></td>
                <td>{r.itemName}<small>{r.uom}</small></td>
                <td className="rt mono">{qty(r.pendingQty)}</td>
                <td className="rt mono">{qty(r.heldQty)}</td>
                <td>
                  <input className="inp rt" type="number" min="0" step="any" inputMode="decimal" value={r.send}
                    aria-label={`Quantity of ${r.itemName} to send`}
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
   Sent to other sites, document by document — and replacing it.
   ================================================================== */
export function SentAndReorder() {
  const { siteId } = useSite();
  const [reordering, setReordering] = useState(false);
  const [openDoc, setOpenDoc] = useState(null);
  const hist = useApi(siteId ? `/transfers/site/${siteId}/history` : null, [siteId]);
  const lent = useApi(siteId ? `/transfers/site/${siteId}/lent-out?show=ALL` : null, [siteId]);

  const toReorder = (lent.data?.totals.toReorder || 0);

  const grab = () => downloadCsv(`transfers-out-${hist.data.site.code}`, [
    ['Delivery challans sent from', hist.data.site.name],
    ['Challan', 'Dispatched', 'Sent to', 'For PRN', 'Request', 'Items', 'Sent', 'Received there', 'Status'],
    ...hist.data.docs.map((d) => [d.docNo, dmy(d.date), d.to.name, d.prns, d.requests,
      d.lineCount, d.sentQty, d.ackedQty, dcState(d.state).label]),
  ]);

  return (
    <>
      <PageHead title="Sent to other sites"
        sub="Every delivery challan this site has sent to another site — and reordering what went out"
        actions={
          <>
            {hist.data?.docs.length ? <button className="btn" onClick={grab}><Icon name="download" size={14} />Download</button> : null}
            <button className="btn pri" disabled={!siteId || toReorder <= 0}
              hidden={!canWrite(`/transfers/site/${siteId}/reorder`)}
              title={toReorder <= 0 ? 'Nothing sent out is waiting to be replaced' : undefined}
              onClick={() => setReordering(true)}>
              Reorder what was sent
            </button>
          </>
        } />
      <div className="page-body">
        {hist.error && <ErrorNote error={hist.error} onRetry={hist.reload} />}

        {lent.data && (
          <Card className="pad">
            <div className="stats">
              <Stat n={hist.data?.totals.challans || 0} label="delivery challans sent" one="delivery challan sent" />
              <Stat n={qty(lent.data.totals.lent)} label="units sent to other sites" one="unit sent to other sites" />
              <Stat n={qty(lent.data.totals.reordered)} label="units already reordered" one="unit already reordered" />
              <Stat n={qty(lent.data.totals.toReorder)} label="units still to reorder" one="unit still to reorder" />
            </div>
          </Card>
        )}

        <Banner kind="info">
          A reorder is a PRN on the central store like any other — but it does <b>not</b> count
          against this site&rsquo;s BOQ a second time. The material was asked for once already and
          then sent away; counting it twice would overstate the BOQ, and the billing ceiling with it.
        </Banner>

        {hist.loading && !hist.data ? <Loading what="challans" /> : (
          <Card title="Sent, challan by challan"
            sub="Select a challan to see what was on it and what the other site received">
            <div className="tw">
              <table>
                <thead>
                  <tr>
                    <th style={{ width: 150 }}>Challan</th>
                    <th>Sent to</th>
                    <th style={{ width: 150 }}>For PRN</th>
                    <th className="rt" style={{ width: 80 }}>Items</th>
                    <th className="rt" style={{ width: 88 }}>Sent</th>
                    <th className="rt" style={{ width: 110 }}>Received there</th>
                    <th className="rt" style={{ width: 100 }}>On the road</th>
                    <th style={{ width: 150 }}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {(hist.data?.docs || []).map((d) => (
                    <tr key={d.dcId} className="click" tabIndex={0} onClick={() => setOpenDoc(d)}
                      onKeyDown={(e) => { if (e.key === 'Enter') setOpenDoc(d); }}>
                      <td>
                        <Code as="b">{d.docNo}</Code>
                        <small>{dmy(d.date)}{d.vehicleNo ? ` · ${d.vehicleNo}` : ''}</small>
                      </td>
                      <td>{d.to.name}</td>
                      <td><Code>{d.prns}</Code><small><Code>{d.requests}</Code></small></td>
                      <td className="rt mono">{d.lineCount}</td>
                      <td className="rt mono">{qty(d.sentQty)}</td>
                      <td className="rt mono">{qty(d.ackedQty)}</td>
                      <td className="rt mono">
                        {d.inTransitQty ? qty(d.inTransitQty) : '—'}
                      </td>
                      <td><Status is={dcState(d.state)} /></td>
                    </tr>
                  ))}
                  {!(hist.data?.docs || []).length && (
                    <tr><td colSpan={8}>
                      <Empty title="This site has sent nothing to another site">
                        Challans appear here once the store asks this site to send something
                        to another site and it is dispatched.
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
          sub={`To ${openDoc.to.name} · ${dmy(openDoc.date)} · for ${openDoc.prns}`}
          onClose={() => setOpenDoc(null)}
          footer={<button className="btn" onClick={() => setOpenDoc(null)}>Close</button>}>
          <div className="tw">
            <table>
              <thead><tr><th style={{ width: 110 }}>Item code</th><th>Item</th>
                <th style={{ width: 56 }}>Unit</th>
                <th className="rt" style={{ width: 90 }}>Sent</th>
                <th className="rt" style={{ width: 110 }}>Received there</th></tr></thead>
              <tbody>
                {openDoc.items.map((i, n) => (
                  <tr key={n}>
                    <td><Code>{i.itemCode}</Code></td>
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
 * Reorder what was sent to other sites.
 *
 * Cumulative: what has been sent out over every challan, what has
 * already been reordered, and what is left. The cap is what was sent —
 * past that point a site is not replacing anything, it is raising a new
 * requirement, and that is an ordinary PRN that counts against the BOQ.
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
      toast(`${r.docNo} raised as a replacement PRN — it does not count against the BOQ`, 'ok');
      onSaved();
    } catch (e) { toast(e.message, 'bad'); } finally { setBusy(false); }
  };

  return (
    <Modal wide title="Reorder what was sent"
      sub="Replacing material this site sent to another site"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn pri" disabled={busy || !going.length || over.length > 0}
            onClick={save}>Raise replacement PRN</button>
        </>
      }>
      <Banner kind="info">
        This raises an ordinary PRN on the central store, which supplies it the usual way.
        It is marked a replacement, so it does <b>not</b> add to what this site has asked for
        against its BOQ — that material was asked for once already, and sending it away did not make it twice.
      </Banner>
      {over.length > 0 && (
        <Banner kind="bad">
          {plural(over.length, 'line')} asks for more than was sent out.
        </Banner>
      )}

      <DateField label="Needed by" value={neededBy} hint="Optional"
        onChange={(e) => setNeededBy(e.target.value)} />

      <div className="tw">
        <table className="sheet">
          <thead>
            <tr>
              <th style={{ width: 110 }}>Item code</th><th>Item</th>
              <th className="rt" style={{ width: 96 }}>Sent out</th>
              <th className="rt" style={{ width: 120 }}>Already reordered</th>
              <th className="rt" style={{ width: 110 }}>Still to reorder</th>
              <th className="rt" style={{ width: 100 }}>In our stock</th>
              <th className="rt" style={{ width: 118 }}>Reorder now</th>
            </tr>
          </thead>
          <tbody>
            {live.map((r) => (
              <tr key={r.itemId}>
                <td><Code>{r.itemCode}</Code></td>
                <td>{r.itemName}<small>{r.uom} · {plural(r.challans, 'challan')}</small></td>
                <td className="rt mono">{qty(r.lentQty)}</td>
                <td className="rt mono">{r.reorderedQty ? qty(r.reorderedQty) : '—'}</td>
                <td className="rt mono"><b>{qty(r.toReorderQty)}</b></td>
                <td className="rt mono">{qty(r.onShelfQty)}</td>
                <td>
                  <input className="inp rt" type="number" min="0" step="any" inputMode="decimal"
                    aria-label={`Quantity of ${r.itemName} to reorder`}
                    value={order[r.itemId] ?? ''}
                    onChange={(e) => setOrder((o) => ({ ...o, [r.itemId]: e.target.value }))} />
                </td>
              </tr>
            ))}
            {!live.length && (
              <tr><td colSpan={7}>
                <Empty title="Nothing left to reorder">
                  Everything this site sent out has already been reordered.
                </Empty>
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
    </Modal>
  );
}
