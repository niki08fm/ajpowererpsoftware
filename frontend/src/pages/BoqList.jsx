import { Fragment, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useApp, PageHead } from '../App';
import { api, qty } from '../api';
import {
  useApi, Card, Tag, Empty, Loading, ErrorNote, Meter, Modal, Field,
  ItemPicker, useToast, Banner, Stat,
} from '../components/ui';

/* ===================================================================
   The list: BOQs, and the work orders still waiting for one.
   =================================================================== */
export function BoqList() {
  const { branchId } = useApp();
  const toast = useToast();
  const { data, error, loading, reload } = useApi(branchId ? `/boq?branchId=${branchId}` : null, [branchId]);
  // the sheet opens over the list rather than taking you somewhere else,
  // so you never lose your place in the department
  const [openId, setOpenId] = useState(null);

  const start = async (workOrderId) => {
    try {
      const r = await api.post('/boq/prepare', { workOrderId });
      setOpenId(r.boqId);
    } catch (e) { toast(e.message, 'bad'); }
  };

  const waiting = data?.awaitingPreparation || [];

  return (
    <>
      <PageHead title="BOQ" sub="Every work order line prepared as items from the master" />
      <div className="page-body">
        {error && <ErrorNote error={error} onRetry={reload} />}
        <Banner kind="info" icon="▤">
          The <b>work order</b> is the client's — their scope, their quantity, their rate. The <b>BOQ</b> is
          ours: what each of those lines is actually made of. Nothing can be indented until it exists.
        </Banner>

        {loading ? <Loading /> : (
          <>
            {waiting.length > 0 && (
              <Card title="Work orders waiting for a BOQ" sub="Nothing can be indented against these yet">
                <div className="tw">
                  <table>
                    <thead><tr><th>Site</th><th>Work order</th><th className="rt">Lines</th><th /></tr></thead>
                    <tbody>
                      {waiting.map((w) => (
                        <tr key={w.work_order_id}>
                          <td><b>{w.site_name}</b></td>
                          <td className="mono">{w.client_wo_no || w.doc_no}</td>
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
                      <th>Prepared</th><th>Beyond estimate</th><th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(data?.boqs || []).map((b) => (
                      <tr key={b.id} className="click" onClick={() => setOpenId(b.id)}>
                        <td><b>{b.doc_no}</b><small className="mono">against {b.client_wo_no || b.wo_doc_no}</small></td>
                        <td>{b.site_name}</td>
                        <td className="rt mono">{b.line_count}</td>
                        <td style={{ minWidth: 130 }}>
                          <Meter value={b.prepared_count} max={b.wo_line_count} />
                          <small style={{ color: 'var(--muted)' }}>
                            {b.prepared_count} of {b.wo_line_count} work order lines
                          </small>
                        </td>
                        <td>
                          {b.status !== 'LOCKED' ? '—'
                            : b.over_allow
                              ? <Tag kind="warn">{Number(b.over_pct) ? `${b.over_pct}% over allowed` : 'No ceiling'}</Tag>
                              : <Tag>Hard stop</Tag>}
                        </td>
                        <td>
                          {b.state === 'AMENDMENT_DUE'
                            ? <Tag kind="bad">▲ Amendment due · {Number(b.worst_over_pct).toFixed(1)}%</Tag>
                            : b.state === 'LOCKED' ? <Tag kind="ok">Locked</Tag> : <Tag kind="warn">Draft</Tag>}
                        </td>
                      </tr>
                    ))}
                    {!(data?.boqs || []).length && (
                      <tr><td colSpan={6}>
                        <Empty title="No BOQ prepared yet">
                          Load a work order on a site, then prepare it here.
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
    </>
  );
}

/* ===================================================================
   The builder — the sheet this whole application is built around.

     Sl No | Item Code | Description | Unit | Item Qty | BOQ Qty | Est Qty | Make

   A work order line sits on a tinted row with a teal edge; the items
   it is made of are indented beneath it as 1a, 1b, 1c. BOQ Qty is
   calculated and never typed. Est Qty is typed once on the parent and
   the children follow it until one is overridden.
   =================================================================== */
const round3 = (n) => Math.round((Number(n) || 0) * 1000) / 1000;

export function BoqSheet({ boqId, onClose }) {
  const id = boqId;
  const toast = useToast();
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

  if (loading) return <Modal full title="BOQ" onClose={onClose}><Loading /></Modal>;
  if (error) {
    return (
      <Modal full title="BOQ" onClose={onClose}>
        <div className="pad"><ErrorNote error={error} onRetry={reload} /></div>
      </Modal>
    );
  }

  const locked = data.status === 'LOCKED';
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

  const dropLine = (w) => {
    if (edit[w.wo_line_id]?.items.some((r) => r.item)
      && !window.confirm(`Take line ${w.sno} off the sheet? What you typed into it is lost.`)) return;
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
      toast(`${r.docNo} locked — ${allow
        ? (Number(policy.overPct) ? `indents may go ${policy.overPct}% past the estimate` : 'indents may exceed the estimate')
        : 'the estimate is a hard stop'}`, 'ok');
    } catch (e) { toast(e.message, 'bad'); }
  };

  const allDone = data.remaining === 0 && pending.length === 0;

  return (
    <>
      <Modal
        full
        title={locked ? data.docNo : `Prepare ${data.docNo}`}
        sub={`${data.site.name} · ${data.client || ''} · against ${data.workOrder.clientWoNo || data.workOrder.docNo}`}
        onClose={onClose}
        actions={!locked && (
          <button className="btn pri" disabled={!allDone} onClick={() => setSubmitOpen(true)}>
            Submit BOQ
          </button>
        )}
      >
        <div style={{ padding: '16px 20px' }}>
          <Card>
            <div className="pad stats">
              <Stat n={data.prepared} label="prepared" />
              <Stat n={data.remaining} label="remaining" tone={data.remaining ? 'warn' : 'ok'} />
              <Stat n={data.ofLines} label="work order lines" />
              <div style={{ flex: 1, minWidth: 190 }}>
                <Meter value={data.prepared} max={data.ofLines} />
                <small style={{ color: 'var(--muted)' }}>
                  {onSheet.length} on the sheet
                  {pending.length ? ` · ${pending.length} not added yet` : ' · all added'}
                </small>
              </div>
              {data.state === 'AMENDMENT_DUE'
                ? <Tag kind="bad">▲ Amendment due · {Number(data.worstOverPct).toFixed(1)}% over</Tag>
                : locked ? <Tag kind="ok">Locked</Tag>
                  : <Tag kind={allDone ? 'ok' : 'warn'}>
                    {allDone ? 'Ready to submit' : 'Submit locked until every line is done'}
                  </Tag>}
            </div>
          </Card>

          <Card title="BOQ (Bill of Quantity)"
            sub="Item Qty is how many go into one of the work order line — BOQ Qty follows. Est Qty is yours to type.">
            <div className="tw">
              <table className="sheet">
                <thead>
                  <tr>
                    <th style={{ width: 62 }}>Sl No</th>
                    <th style={{ width: 108 }}>Item Code</th>
                    <th style={{ minWidth: 300 }}>Description</th>
                    <th style={{ width: 84 }}>Unit</th>
                    <th className="rt" style={{ width: 88 }}>Item Qty</th>
                    <th className="rt" style={{ width: 92 }}>BOQ Qty</th>
                    <th className="rt" style={{ width: 96 }}>Est Qty</th>
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
                            <td><b>{w.description}</b><small>work order line</small></td>
                            <td>{w.uom}</td><td />
                            <td className="rt mono"><b>{qty(w.qty)}</b></td>
                            <td className="rt mono">{qty(w.est_qty)}</td>
                            <td /><td />
                          </tr>
                          {w.items.map((i) => (
                            <tr key={i.boq_line_id} className="kid">
                              <td>{i.sno}</td>
                              <td className="mono" style={{ color: 'var(--brand-ink)' }}>{i.item_code}</td>
                              <td>{i.item_name}</td><td>{i.uom}</td>
                              <td className="rt mono">{qty(i.item_qty)}</td>
                              <td className="rt mono">{qty(i.boq_qty)}</td>
                              <td className="rt mono">
                                {qty(i.est_qty)}
                                {Number(i.var_qty) > 0 && (
                                  <small style={{ color: 'var(--brand)' }}>+{qty(i.var_qty)} variation</small>
                                )}
                              </td>
                              <td>{i.make_name || <span style={{ color: 'var(--faint)' }}>any</span>}</td>
                              <td className="rt">
                                {Number(i.over_qty) > 0 && <Tag kind="bad">▲ {qty(i.over_qty)} over</Tag>}
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
                              work order line ·{' '}
                              {ready
                                ? <span style={{ color: 'var(--ok)' }}>{ed.items.filter((r) => r.item).length} item(s)</span>
                                : <span style={{ color: 'var(--warn)' }}>Needs an item</span>}
                              {saving[lid] && <span style={{ color: 'var(--muted)' }}> · saving…</span>}
                            </small>
                          </td>
                          <td>{w.uom}</td>
                          <td />
                          <td className="rt mono"><b>{qty(w.qty)}</b></td>
                          <td>
                            <input className="inp rt" type="number" min="0" step="any" value={ed.estQty}
                              title="entered by hand" onBlur={() => saveLine(w, true)}
                              onChange={(e) => patch(lid, (x) => ({ ...x, estQty: e.target.value }))} />
                          </td>
                          <td />
                          <td className="rt">
                            <button className="btn sm" title="Take this line off the sheet"
                              onClick={() => dropLine(w)}>✕</button>
                          </td>
                        </tr>

                        {ed.items.map((row, j) => (
                          <tr key={`${lid}-${j}`} className="kid">
                            <td>{w.sno}{String.fromCharCode(97 + j)}</td>
                            <td className="mono" style={{ color: 'var(--brand-ink)' }}>
                              {row.item?.code || <span style={{ color: 'var(--faint)' }}>—</span>}
                            </td>
                            <td>
                              <ItemPicker value={row.item}
                                placeholder="type any part of the code or name"
                                autoFocus={j === ed.items.length - 1 && !row.item}
                                onPick={(it) => patch(lid, (x) => ({
                                  ...x, items: x.items.map((r, n) => (n === j ? { ...r, item: it, makeId: '' } : r)),
                                }))} />
                            </td>
                            <td>{row.item?.uom || <span style={{ color: 'var(--faint)' }}>—</span>}</td>
                            <td>
                              <input className="inp rt" type="number" min="0" step="any" value={row.itemQty}
                                title="how many go into one" onBlur={() => saveLine(w, true)}
                                onChange={(e) => patch(lid, (x) => ({
                                  ...x, items: x.items.map((r, n) => (n === j ? { ...r, itemQty: e.target.value } : r)),
                                }))} />
                            </td>
                            <td className="rt calc">
                              {qty(round3((Number(row.itemQty) || 0) * (Number(w.qty) || 0)))}
                            </td>
                            <td>
                              <input className="inp rt" type="number" min="0" step="any" value={childEst(row, ed)}
                                onBlur={() => saveLine(w, true)}
                                onChange={(e) => patch(lid, (x) => ({
                                  ...x,
                                  items: x.items.map((r, n) => (n === j
                                    ? { ...r, est: e.target.value, estManual: true } : r)),
                                }))} />
                            </td>
                            <td>
                              <select className="inp" value={row.makeId} onBlur={() => saveLine(w, true)}
                                onChange={(e) => patch(lid, (x) => ({
                                  ...x, items: x.items.map((r, n) => (n === j ? { ...r, makeId: e.target.value } : r)),
                                }))}>
                                <option value="">— any —</option>
                                {(row.item?.makes || []).map((m) => <option key={m} value={m}>{m}</option>)}
                              </select>
                            </td>
                            <td className="rt">
                              <button className="btn sm bad" title="Remove item"
                                onClick={() => patch(lid, (x) => ({
                                  ...x,
                                  items: x.items.length > 1 ? x.items.filter((_, n) => n !== j) : [blank()],
                                }))}>✕</button>
                            </td>
                          </tr>
                        ))}

                        <tr>
                          <td colSpan={9} style={{ paddingLeft: 26 }}>
                            <button className="btn sm" onClick={() => patch(lid, (x) => ({
                              ...x, items: [...x.items, blank()],
                            }))}>
                              + Add item to line {w.sno}
                            </button>{' '}
                            <button className="btn sm" onClick={() => setAskStore(w)}>
                              Item missing? Ask Store
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
                    <button className="btn pri" onClick={addNext}>+ Add work order line</button>
                    <span style={{ color: 'var(--muted)', fontSize: 12.5 }}>
                      Next up: <b>{pending[0].description}</b> · {pending.length} line(s) left to add
                    </span>
                  </>
                ) : <Tag kind="ok">Every work order line is on the sheet</Tag>}
              </div>
            )}
          </Card>
        </div>
      </Modal>

      {askStore && (
        <Modal title="Item missing from the master"
          sub={`Work order line ${askStore.sno}`} onClose={() => setAskStore(null)}
          footer={<button className="btn pri" onClick={() => setAskStore(null)}>Close</button>}>
          <Banner kind="info" icon="◆">
            Items are added to the master by Store, so the same thing cannot enter twice under two
            spellings. Send them the description below and they will create it with a code.
          </Banner>
          <Field label="The scope this line covers">
            <textarea className="inp" rows={3} readOnly value={askStore.description} />
          </Field>
        </Modal>
      )}

      {submitOpen && (
        <Modal
          title="Submit the BOQ" sub="One decision before it locks" onClose={() => setSubmitOpen(false)}
          footer={<>
            <button className="btn" onClick={() => setSubmitOpen(false)}>Cancel</button>
            <button className="btn pri" onClick={submit}>Lock the BOQ</button>
          </>}
        >
          <Banner kind="info" icon="▤">
            Once locked, every indent from this site is measured against the <b>estimated quantity</b> on
            each BOQ line. Decide now what happens when the site needs more than that.
          </Banner>
          <Field label="Can the site indent beyond the estimate?">
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
              <Banner kind="warn" icon="!">
                Anything past the estimate is flagged the moment it is raised, and the BOQ stays at
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
