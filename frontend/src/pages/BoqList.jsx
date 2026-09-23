import { Fragment, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useApp, PageHead } from '../App';
import { AmendSheet, BoqHistory } from './BoqAmend';
import { api, qty, withBranch, canWrite, plural } from '../api';
import {
  useApi, Card, Empty, Loading, ErrorNote, Meter, Modal, Field, ItemPicker, useToast, Banner, Stat, Code,
  Status, useDialog,
} from '../components/ui';
import { Icon } from '../components/icons';

/** A BOQ's status in words: draft, awaiting approval, locked, amendment due. */
const BoqStatus = ({ b }) => (b.state === 'AMENDMENT_DUE'
  ? <Status tone="attention" icon="alert" label={`Amendment due · ${Number(b.worst_over_pct ?? b.worstOverPct).toFixed(1)}% over`}
    hint="A PRN went past the estimate; Planning records a variation to put it right" />
  : b.status === 'LOCKED' ? <Status tone="done" icon="lock" label="Approved · locked" hint="PRNs are measured against it" />
    : b.status === 'SUBMITTED' ? <Status tone="info" label="Awaiting approval" hint="With the site's GM, then Management. It locks once both approve." />
      : <Status tone="neutral" label="Draft" hint="Being prepared; not sent for approval" />);

/* ===================================================================
   The list: BOQs, and the work orders still waiting for one.
   =================================================================== */
export function BoqList() {
  const { branchId } = useApp();
  const toast = useToast();
  const { data, error, loading, reload } = useApi(withBranch('/boq', branchId), [branchId]);
  // the sheet opens over the list rather than taking you somewhere else,
  // so you never lose your place in the department
  const [openId, setOpenId] = useState(null);
  const [amendId, setAmendId] = useState(null);
  const [historyId, setHistoryId] = useState(null);

  const start = async (workOrderId) => {
    try {
      const r = await api.post('/boq/prepare', { workOrderId });
      setOpenId(r.boqId);
    } catch (e) { toast(e.message, 'bad'); }
  };

  const waiting = data?.awaitingPreparation || [];

  return (
    <>
      <PageHead title="BOQ" sub="What each work order line is made of, item by item — and the estimate every PRN is measured against" />
      <div className="page-body">
        {error && <ErrorNote error={error} onRetry={reload} />}
        <Banner kind="info">
          The <b>work order</b> is the client's — their scope, their quantity, their rate. The <b>BOQ</b> is
          ours: what each of those lines is actually made of. A site cannot raise a PRN until its BOQ is
          approved and locked.
        </Banner>

        {loading && !data ? <Loading what="BOQs" /> : (
          <>
            {waiting.length > 0 && (
              <Card title="Work orders waiting for a BOQ" sub="No PRN can be raised against these yet">
                <div className="tw">
                  <table>
                    <thead><tr><th>Site</th><th>Work order</th><th className="rt">Lines</th><th /></tr></thead>
                    <tbody>
                      {waiting.map((w) => (
                        <tr key={w.work_order_id}>
                          <td><b>{w.site_name}</b></td>
                          <td><Code>{w.client_wo_no || w.doc_no}</Code></td>
                          <td className="rt mono">{w.line_count}</td>
                          <td className="rt">
                            <button className="btn sm pri" onClick={() => start(w.work_order_id)}>Prepare BOQ</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            )}

            <Card title="BOQs">
              <div className="tw">
                <table>
                  <thead>
                    <tr>
                      <th>BOQ</th><th>Site</th><th className="rt">Lines</th>
                      <th>Prepared</th><th>Past the estimate</th><th>Status</th>
                      <th style={{ width: 170 }} />
                    </tr>
                  </thead>
                  <tbody>
                    {(data?.boqs || []).map((b) => (
                      <tr key={b.id} className="click" tabIndex={0} onClick={() => setOpenId(b.id)}
                        onKeyDown={(e) => { if (e.key === 'Enter') setOpenId(b.id); }}>
                        <td><Code as="b">{b.doc_no}</Code><small>Against <Code>{b.client_wo_no || b.wo_doc_no}</Code></small></td>
                        <td>{b.site_name}</td>
                        <td className="rt mono">{b.line_count}</td>
                        <td style={{ minWidth: 130 }}>
                          <Meter value={b.prepared_count} max={b.wo_line_count} label="Work order lines prepared" />
                          <small style={{ color: 'var(--muted)' }}>
                            {b.prepared_count} of {b.wo_line_count} work order lines
                          </small>
                        </td>
                        <td>
                          {b.status !== 'LOCKED' ? '—'
                            : b.over_allow
                              ? (Number(b.over_pct) ? `Allowed, up to ${b.over_pct}%` : 'Allowed, no ceiling')
                              : 'Not allowed (hard stop)'}
                        </td>
                        <td><BoqStatus b={b} /></td>
                        <td className="rt" onClick={(e) => e.stopPropagation()}>
                          <button className="btn sm" onClick={() => setHistoryId(b.id)}>History</button>{' '}
                          {b.status === 'LOCKED' && canWrite(`/boq/${b.id}/amendments`) && (
                            <button className={`btn sm ${b.state === 'AMENDMENT_DUE' ? 'pri' : ''}`}
                              onClick={() => setAmendId(b.id)}>Amend</button>
                          )}
                        </td>
                      </tr>
                    ))}
                    {!(data?.boqs || []).length && (
                      <tr><td colSpan={7}>
                        <Empty title="No BOQ prepared yet">
                          Load a work order on a site under Sites, then prepare its BOQ here.
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

      {openId && (
        <BoqSheet boqId={openId} onClose={() => { setOpenId(null); reload(); }} />
      )}
      {amendId && (
        <AmendSheet boqId={amendId} onClose={() => setAmendId(null)} onDone={reload} />
      )}
      {historyId && (
        <BoqHistory boqId={historyId} onClose={() => setHistoryId(null)} />
      )}
    </>
  );
}

/* ===================================================================
   The builder — the sheet this whole application is built around.

     Sl No | Item Code | Description | Unit | Item Qty | BOQ Qty | Est Qty | Make

   A work order line sits on a tinted row; the items it is made of are
   listed beneath it as 1a, 1b, 1c. BOQ Qty is
   calculated and never typed. Est Qty is typed once on the parent and
   the children follow it until one is overridden.
   =================================================================== */
const round3 = (n) => Math.round((Number(n) || 0) * 1000) / 1000;

export function BoqSheet({ boqId, onClose }) {
  const id = boqId;
  const toast = useToast();
  const ask = useDialog();
  const { data, error, loading, reload } = useApi(`/boq/${id}`);

  /* Work order lines come onto the sheet one at a time, the way the
     prototype settled on: you finish a line, then bring the next one
     down. `shown` is which ones are on the sheet; `edit` holds what is
     typed into them until it is saved. */
  const [shown, setShown] = useState(null);
  const [edit, setEdit] = useState({});
  const [saving, setSaving] = useState({});
  const [submitOpen, setSubmitOpen] = useState(false);
  const [askStore, setAskStore] = useState(null);
  const [policy, setPolicy] = useState({ overAllow: 'NO', overPct: '10' });

  const blank = () => ({ item: null, makeId: '', itemQty: '1', est: '', estManual: false });

  /* On open, everything already prepared is on the sheet. Nothing is
     folded away — if it is on the BOQ, you can see it. */
  useEffect(() => {
    if (!data || shown !== null) return;
    const done = data.woLines.filter((w) => w.items.length).map((w) => w.wo_line_id);
    const start = done.length ? done : (data.woLines[0] ? [data.woLines[0].wo_line_id] : []);
    setShown(start);
    const seed = {};
    for (const w of data.woLines) {
      if (!start.includes(w.wo_line_id)) continue;
      seed[w.wo_line_id] = {
        estQty: Number(w.est_qty) > 0 ? String(w.est_qty) : String(w.qty),
        items: w.items.length
          ? w.items.map((i) => ({
            item: { id: i.item_id, code: i.item_code, name: i.item_name, uom: i.uom, makes: [] },
            makeId: i.make_id || '', itemQty: String(i.item_qty),
            est: String(i.est_qty), estManual: !!i.est_manual,
          }))
          : [blank()],
      };
    }
    setEdit(seed);
  }, [data, shown]);

  if (loading && !data) return <Modal full title="BOQ" onClose={onClose}><Loading what="the BOQ" /></Modal>;
  if (error) {
    return (
      <Modal full title="BOQ" onClose={onClose}>
        <div className="pad"><ErrorNote error={error} onRetry={reload} /></div>
      </Modal>
    );
  }

  // with its approvers it is as closed as locked: changing a line under
  // an approval means the thing approved is not the thing you have
  const locked = data.status === 'LOCKED' || data.status === 'SUBMITTED';
  const onSheet = (shown || []);
  const pending = data.woLines.filter((w) => !onSheet.includes(w.wo_line_id));
  const patch = (lid, fn) => setEdit((d) => ({ ...d, [lid]: fn(d[lid]) }));
  const childEst = (row, ed) => (row.estManual
    ? row.est
    : round3((Number(row.itemQty) || 0) * (Number(ed.estQty) || 0)));

  /** Save one work order line. Returns true when it went through. */
  const saveLine = async (w, quiet) => {
    const ed = edit[w.wo_line_id];
    if (!ed) return false;
    const items = ed.items.filter((r) => r.item && Number(r.itemQty) > 0);
    if (!items.length || !(Number(ed.estQty) > 0)) {
      if (!quiet) toast(`Line ${w.sno} needs an item and an estimated quantity`, 'bad');
      return false;
    }
    setSaving((x) => ({ ...x, [w.wo_line_id]: true }));
    try {
      await api.put(`/boq/${id}/wo-line/${w.wo_line_id}`, {
        estQty: Number(ed.estQty),
        items: items.map((r) => ({
          itemId: r.item.id,
          makeId: r.makeId ? Number(r.makeId) : null,
          itemQty: Number(r.itemQty),
          ...(r.estManual ? { estQty: Number(r.est) || 0 } : {}),
        })),
      });
      if (!quiet) toast(`Line ${w.sno} saved`, 'ok');
      reload();
      return true;
    } catch (e) {
      toast(e.message, 'bad');
      return false;
    } finally {
      setSaving((x) => ({ ...x, [w.wo_line_id]: false }));
    }
  };

  /** Bring the next work order line down, saving the current one first. */
  const addNext = async () => {
    const next = pending[0];
    if (!next) return;
    const last = data.woLines.find((w) => w.wo_line_id === onSheet[onSheet.length - 1]);
    if (last) await saveLine(last, true);
    setShown((x) => [...x, next.wo_line_id]);
    setEdit((d) => ({ ...d, [next.wo_line_id]: { estQty: String(next.qty), items: [blank()] } }));
  };

  const dropLine = async (w) => {
    if (edit[w.wo_line_id]?.items.some((r) => r.item)) {
      const ok = await ask({
        title: `Take line ${w.sno} off the BOQ?`,
        consequence: 'The items typed against it are removed. You can add the line back later.',
        confirm: 'Take it off', tone: 'bad',
      });
      if (ok === null) return;
    }
    setShown((x) => x.filter((v) => v !== w.wo_line_id));
    setEdit((d) => { const n = { ...d }; delete n[w.wo_line_id]; return n; });
    if (w.items.length) api.del(`/boq/${id}/wo-line/${w.wo_line_id}`).then(reload).catch(() => {});
  };

  const submit = async () => {
    for (const lid of onSheet) {
      const w = data.woLines.find((x) => x.wo_line_id === lid);
      if (w) await saveLine(w, true);
    }
    try {
      const allow = policy.overAllow === 'YES';
      const r = await api.post(`/boq/${id}/submit`, {
        overAllow: allow, overPct: allow ? Number(policy.overPct) : 0,
      });
      setSubmitOpen(false);
      reload();
      toast(r.message || `${r.docNo} sent for approval — it locks once the GM and Management both approve`, 'ok');
    } catch (e) { toast(e.message, 'bad'); }
  };

  const allDone = data.remaining === 0 && pending.length === 0;

  return (
    <>
      <Modal
        full
        title={locked ? data.docNo : `Prepare ${data.docNo}`}
        sub={`${data.site.name} · ${data.client || ''} · against work order ${data.workOrder.clientWoNo || data.workOrder.docNo}`}
        onClose={onClose}
        actions={!locked && canWrite(`/boq/${id}/submit`) && (
          <>
            {!allDone && <span className="why-not"><Icon name="info" size={14} />Prepare every work order line first</span>}
            <button className="btn pri" disabled={!allDone} onClick={() => setSubmitOpen(true)}>
              <Icon name="send" />Send for approval
            </button>
          </>
        )}
      >
        <div style={{ padding: '16px 20px' }}>
          <Card>
            <div className="pad stats">
              <Stat n={data.prepared} label="prepared" />
              <Stat n={data.remaining} label="still to prepare" />
              <Stat n={data.ofLines} label="work order lines" one="work order line" />
              <div style={{ flex: 1, minWidth: 190 }}>
                <Meter value={data.prepared} max={data.ofLines} label="Work order lines prepared" />
                <small style={{ color: 'var(--muted)' }}>
                  {plural(onSheet.length, 'line')} on the BOQ
                  {pending.length ? ` · ${pending.length} not added yet` : ' · all added'}
                </small>
              </div>
              {locked
                ? <BoqStatus b={{ state: data.state, status: data.status, worstOverPct: data.worstOverPct }} />
                : <Status tone={allDone ? 'done' : 'neutral'} label={allDone ? 'Ready to send for approval' : 'Every line must be prepared first'} />}
            </div>
          </Card>

          <Card title="BOQ (bill of quantities)"
            sub="Item qty is how many go into one unit of the work order line — BOQ qty follows from it. The estimate is yours to type.">
            <div className="tw">
              <table className="sheet">
                <thead>
                  <tr>
                    <th style={{ width: 62 }}>Sl no</th>
                    <th style={{ width: 110 }}>Item code</th>
                    <th style={{ minWidth: 300 }}>Description</th>
                    <th style={{ width: 84 }}>Unit</th>
                    <th className="rt" style={{ width: 88 }}>Item qty</th>
                    <th className="rt" style={{ width: 92 }}>BOQ qty</th>
                    <th className="rt" style={{ width: 96 }}>Estimate</th>
                    <th style={{ width: 140 }}>Make</th>
                    <th style={{ width: 44 }} />
                  </tr>
                </thead>
                <tbody>
                  {onSheet.map((lid) => {
                    const w = data.woLines.find((x) => x.wo_line_id === lid);
                    if (!w) return null;
                    const ed = edit[lid];
                    if (locked) {
                      return (
                        <Fragment key={lid}>
                          <tr className="wo-row">
                            <td className="sn"><b>{w.sno}</b></td><td />
                            <td><b>{w.description}</b><small>Work order line</small></td>
                            <td>{w.uom}</td><td />
                            <td className="rt mono"><b>{qty(w.qty)}</b></td>
                            <td className="rt mono">{qty(w.est_qty)}</td>
                            <td /><td />
                          </tr>
                          {w.items.map((i) => (
                            <tr key={i.boq_line_id} className="kid">
                              <td>{i.sno}</td>
                              <td><Code>{i.item_code}</Code></td>
                              <td>{i.item_name}</td><td>{i.uom}</td>
                              <td className="rt mono">{qty(i.item_qty)}</td>
                              <td className="rt mono">{qty(i.boq_qty)}</td>
                              <td className="rt mono">
                                {qty(i.est_qty)}
                                {Number(i.var_qty) > 0 && (
                                  <small>+{qty(i.var_qty)} variation</small>
                                )}
                              </td>
                              <td>{i.make_name || <span style={{ color: 'var(--faint)' }}>Any make</span>}</td>
                              <td className="rt">
                                {Number(i.over_qty) > 0 && <Status tone="attention" icon="alert" label={`${qty(i.over_qty)} over`} />}
                              </td>
                            </tr>
                          ))}
                        </Fragment>
                      );
                    }
                    if (!ed) return null;
                    const ready = ed.items.some((r) => r.item) && Number(ed.estQty) > 0;
                    return (
                      <Fragment key={lid}>
                        <tr className="wo-row">
                          <td className="sn"><b>{w.sno}</b></td>
                          <td />
                          <td>
                            <b>{w.description}</b>
                            <small>
                              Work order line ·{' '}
                              {ready
                                ? <span>{plural(ed.items.filter((r) => r.item).length, 'item')}</span>
                                : <span style={{ color: 'var(--st-attn)', fontWeight: 600 }}>Needs an item</span>}
                              {saving[lid] && <span style={{ color: 'var(--muted)' }}> · saving…</span>}
                            </small>
                          </td>
                          <td>{w.uom}</td>
                          <td />
                          <td className="rt mono"><b>{qty(w.qty)}</b></td>
                          <td>
                            <input className="inp rt" type="number" min="0" step="any" value={ed.estQty} inputMode="decimal"
                              aria-label={`Estimate for work order line ${w.sno}`}
                              title="Typed by hand; the items below follow it" onBlur={() => saveLine(w, true)}
                              onChange={(e) => patch(lid, (x) => ({ ...x, estQty: e.target.value }))} />
                          </td>
                          <td />
                          <td className="rt">
                            <button className="btn sm ghost" aria-label={`Take line ${w.sno} off the BOQ`} title="Take this line off the BOQ"
                              onClick={() => dropLine(w)}><Icon name="x" size={14} /></button>
                          </td>
                        </tr>

                        {ed.items.map((row, j) => (
                          <tr key={`${lid}-${j}`} className="kid">
                            <td>{w.sno}{String.fromCharCode(97 + j)}</td>
                            <td>
                              {row.item?.code ? <Code>{row.item.code}</Code> : <span style={{ color: 'var(--faint)' }}>—</span>}
                            </td>
                            <td>
                              <ItemPicker value={row.item}
                                placeholder="Type any part of the code or name…"
                                autoFocus={j === ed.items.length - 1 && !row.item}
                                onPick={(it) => patch(lid, (x) => ({
                                  ...x, items: x.items.map((r, n) => (n === j ? { ...r, item: it, makeId: '' } : r)),
                                }))} />
                            </td>
                            <td>{row.item?.uom || <span style={{ color: 'var(--faint)' }}>—</span>}</td>
                            <td>
                              <input className="inp rt" type="number" min="0" step="any" value={row.itemQty} inputMode="decimal"
                                aria-label="Item qty per unit of the work order line"
                                title="How many go into one unit of the work order line" onBlur={() => saveLine(w, true)}
                                onChange={(e) => patch(lid, (x) => ({
                                  ...x, items: x.items.map((r, n) => (n === j ? { ...r, itemQty: e.target.value } : r)),
                                }))} />
                            </td>
                            <td className="rt calc">
                              {qty(round3((Number(row.itemQty) || 0) * (Number(w.qty) || 0)))}
                            </td>
                            <td>
                              <input className="inp rt" type="number" min="0" step="any" value={childEst(row, ed)} inputMode="decimal"
                                aria-label="Estimate for this item"
                                onBlur={() => saveLine(w, true)}
                                onChange={(e) => patch(lid, (x) => ({
                                  ...x,
                                  items: x.items.map((r, n) => (n === j
                                    ? { ...r, est: e.target.value, estManual: true } : r)),
                                }))} />
                            </td>
                            <td>
                              <select className="inp" value={row.makeId} onBlur={() => saveLine(w, true)} aria-label="Make"
                                onChange={(e) => patch(lid, (x) => ({
                                  ...x, items: x.items.map((r, n) => (n === j ? { ...r, makeId: e.target.value } : r)),
                                }))}>
                                <option value="">Any make</option>
                                {(row.item?.makes || []).map((m) => <option key={m} value={m}>{m}</option>)}
                              </select>
                            </td>
                            <td className="rt">
                              <button className="btn sm ghost" aria-label="Remove this item" title="Remove this item"
                                onClick={() => patch(lid, (x) => ({
                                  ...x,
                                  items: x.items.length > 1 ? x.items.filter((_, n) => n !== j) : [blank()],
                                }))}><Icon name="x" size={14} /></button>
                            </td>
                          </tr>
                        ))}

                        <tr>
                          <td colSpan={9} style={{ paddingLeft: 26 }}>
                            <button className="btn sm" onClick={() => patch(lid, (x) => ({
                              ...x, items: [...x.items, blank()],
                            }))}>
                              <Icon name="plus" size={14} />Add item to line {w.sno}
                            </button>{' '}
                            <button className="btn sm ghost" onClick={() => setAskStore(w)}>
                              Item not in the master? Ask Store
                            </button>
                          </td>
                        </tr>
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {!locked && (
              <div className="pad" style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', borderTop: '1px solid var(--line-2)' }}>
                {pending.length ? (
                  <>
                    <button className="btn pri" onClick={addNext}><Icon name="plus" />Add the next work order line</button>
                    <span style={{ color: 'var(--muted)', fontSize: 13 }}>
                      Next: <b>{pending[0].description}</b> · {plural(pending.length, 'line')} left to add
                    </span>
                  </>
                ) : <Status tone="done" label="Every work order line is on the BOQ" />}
              </div>
            )}
          </Card>
        </div>
      </Modal>

      {askStore && (
        <Modal title="Item missing from the master"
          sub={`Work order line ${askStore.sno}`} onClose={() => setAskStore(null)}
          footer={<button className="btn pri" onClick={() => setAskStore(null)}>Close</button>}>
          <Banner kind="info">
            Only Store adds items to the item master, so the same thing cannot go in twice under two
            spellings. Send them the description below and they will create it with a code.
          </Banner>
          <Field label="The scope this line covers">
            <textarea className="inp" rows={3} readOnly value={askStore.description} />
          </Field>
        </Modal>
      )}

      {submitOpen && (
        <Modal
          title="Send the BOQ for approval" sub="One decision first: what happens past the estimate" onClose={() => setSubmitOpen(false)}
          footer={<>
            <button className="btn" onClick={() => setSubmitOpen(false)}>Go back</button>
            <button className="btn pri" onClick={submit}><Icon name="send" />Send for approval</button>
          </>}
        >
          <p className="consequence">
            It goes to the site's GM, then Management. It locks once both approve — after that,
            every PRN from this site is measured against the <b>estimate</b> on each BOQ line.
          </p>
          <Field label="Can the site ask for more than the estimate on a PRN?">
            <select className="inp" value={policy.overAllow}
              onChange={(e) => setPolicy((p) => ({ ...p, overAllow: e.target.value }))}>
              <option value="NO">No — the estimate is a hard stop</option>
              <option value="YES">Yes — allow it, and flag it</option>
            </select>
          </Field>
          {policy.overAllow === 'YES' && (
            <>
              <Field label="By how much?">
                <select className="inp" value={policy.overPct}
                  onChange={(e) => setPolicy((p) => ({ ...p, overPct: e.target.value }))}>
                  <option value="10">Up to 10% over the estimate</option>
                  <option value="15">Up to 15%</option>
                  <option value="25">Up to 25%</option>
                  <option value="50">Up to 50%</option>
                  <option value="0">No ceiling — any quantity</option>
                </select>
              </Field>
              <Banner kind="warn">
                Anything past the estimate is flagged the moment a PRN asks for it, and the BOQ shows
                <b> Amendment due</b> until a variation quantity is recorded.
              </Banner>
            </>
          )}
        </Modal>
      )}
    </>
  );
}

export default BoqList;
