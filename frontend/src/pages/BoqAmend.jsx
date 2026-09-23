import { Fragment, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, qty, dmy, plural } from '../api';
import {
  useApi, Card, Tag, Empty, Loading, ErrorNote, Modal, Field, Banner, useToast, Code, Status,
} from '../components/ui';
import { prnApproval } from '../vocab';

const n3 = (v) => Math.round(Number(v || 0) * 1000) / 1000;

/* =====================================================================
   AMEND
   The same sheet as preparation. The quantity is typed once against the
   work order line and every item under it recomputes on the formula
   preparation already uses — item qty x the line quantity. Nobody
   retypes fifteen numbers to say the client added twenty points.
   ===================================================================== */
export function AmendSheet({ boqId, onClose, onDone }) {
  const toast = useToast();
  const { data, loading, error, reload } = useApi(`/boq/${boqId}/amend-sheet`, [boqId]);
  const [by, setBy] = useState({});          // boq_wo_line_id -> typed string
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  /** What each amended line becomes. Same arithmetic as the server. */
  const project = useMemo(() => {
    const out = {};
    for (const w of data?.woLines || []) {
      const raw = by[w.boq_wo_line_id];
      const amend = raw === undefined || raw === '' ? 0 : Number(raw);
      if (!amend || Number.isNaN(amend)) continue;
      const newQty = n3(Number(w.effective_qty) + amend);
      out[w.boq_wo_line_id] = {
        amend,
        newQty,
        newEst: n3(Number(w.effective_est) + amend),
        leavesNothing: newQty <= 0,
        items: Object.fromEntries(w.items.map((i) => {
          const iq = Number(i.item_qty);
          const newVar = n3(iq * (Number(w.var_qty) + amend));
          return [i.boq_line_id, {
            newBoqQty: n3(iq * newQty),
            newEst: n3(Number(i.est_qty) + newVar),
          }];
        })),
      };
    }
    return out;
  }, [by, data]);

  const touched = Object.values(project);
  const broken = touched.filter((p) => p.leavesNothing);

  const save = async () => {
    if (!touched.length) return toast('Type a quantity against at least one work order line', 'bad');
    if (broken.length) return toast('A cut cannot leave a line at nothing', 'bad');
    if (reason.trim().length < 5) return toast('Type why the quantity changed', 'bad');
    setBusy(true);
    try {
      const r = await api.post(`/boq/${boqId}/amendments`, {
        reason: reason.trim(),
        lines: Object.entries(project).map(([id, p]) => ({
          boqWoLineId: Number(id), qty: p.amend,
        })),
      });
      toast(r.state === 'LOCKED'
        ? `${data.docNo} amended and back in line`
        : `${data.docNo} amended — ${plural(r.overLines, 'line')} still past the estimate`, 'ok');
      onDone?.();
      onClose();
    } catch (e) { toast(e.message, 'bad'); }
    setBusy(false);
    return undefined;
  };

  if (loading) return <Modal full title="Amend" onClose={onClose}><Loading /></Modal>;
  if (error) {
    return (
      <Modal full title="Amend" onClose={onClose}>
        <ErrorNote error={error} onRetry={reload} />
      </Modal>
    );
  }

  return (
    <Modal
      full
      title={`Amend ${data.docNo}`}
      sub={`${data.site.name} · against ${data.workOrder.clientWoNo || data.workOrder.docNo}`}
      onClose={onClose}
      footer={<>
        <span style={{ color: 'var(--muted)', fontSize: 12.5, marginRight: 'auto' }}>
          {touched.length
            ? `${plural(touched.length, 'work order line')} amended`
            : 'Type against a work order line to amend it'}
        </span>
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn pri" disabled={busy || !touched.length} onClick={save}>
          Record the amendment
        </button>
      </>}
    >
      <Banner kind="info" icon="▤">
        Type the change against the <b>work order line</b> — a plus to add, a minus to cut. Every item
        under it recomputes the way it did when the BOQ was prepared: <b>item qty × the line quantity</b>.
        The client&apos;s own quantity is never overwritten; it sits beside the amended one.
      </Banner>

      {data.state === 'AMENDMENT_DUE' && (
        <Banner kind="warn">
          PRNs on this BOQ have gone past its estimate. Raising the line to cover what was actually
          asked for is what brings it back in line.
        </Banner>
      )}

      <Card title="BOQ (bill of quantities)"
        sub="“Change by” is the only column you type. BOQ qty and the estimate follow from it.">
        <div className="tw">
          <table className="sheet">
            <thead>
              <tr>
                <th style={{ width: 62 }}>Sl no</th>
                <th style={{ width: 110 }}>Item code</th>
                <th style={{ minWidth: 260 }}>Description</th>
                <th style={{ width: 76 }}>Unit</th>
                <th className="rt" style={{ width: 82 }}>Item qty</th>
                <th className="rt" style={{ width: 92 }}>BOQ qty</th>
                <th className="rt" style={{ width: 92 }}>Estimate</th>
                <th className="rt" style={{ width: 104 }}>Change by</th>
                <th className="rt" style={{ width: 150 }}>Becomes</th>
              </tr>
            </thead>
            <tbody>
              {data.woLines.map((w) => {
                const p = project[w.boq_wo_line_id];
                return (
                  <Fragment key={w.boq_wo_line_id}>
                    <tr className="wo-row">
                      <td className="sn"><b>{w.sno}</b></td>
                      <td />
                      <td>
                        <b>{w.description}</b>
                        <small>
                          Work order line · {plural(w.item_count, 'item')}
                          {Number(w.var_qty) !== 0
                            && ` · contracted ${qty(w.contracted_qty)}, amended by ${Number(w.var_qty) > 0 ? '+' : ''}${qty(w.var_qty)}`}
                        </small>
                      </td>
                      <td>{w.uom}</td>
                      <td />
                      <td className="rt mono"><b>{qty(w.effective_qty)}</b></td>
                      <td className="rt mono">{qty(w.effective_est)}</td>
                      <td className="rt">
                        <input
                          className="inp rt" type="number" step="any" placeholder="+ / −" inputMode="decimal"
                          aria-label={`Change to work order line ${w.sno}: plus to add, minus to cut`}
                          value={by[w.boq_wo_line_id] ?? ''}
                          onChange={(e) => setBy((x) => ({ ...x, [w.boq_wo_line_id]: e.target.value }))}
                        />
                      </td>
                      <td className="rt mono">
                        {p ? (
                          p.leavesNothing
                            ? <Status tone="stopped" label="Leaves nothing" hint="A cut cannot take a line to zero" />
                            : <><b>{qty(p.newQty)}</b><small>estimate {qty(p.newEst)}</small></>
                        ) : <span style={{ color: 'var(--faint)' }}>—</span>}
                      </td>
                    </tr>

                    {w.items.map((i) => {
                      const np = p?.items?.[i.boq_line_id];
                      return (
                        <tr key={i.boq_line_id} className="kid">
                          <td>{i.sno}</td>
                          <td><Code>{i.item_code}</Code></td>
                          <td>{i.item_name}</td>
                          <td>{i.uom}</td>
                          <td className="rt mono">{qty(i.item_qty)}</td>
                          <td className="rt mono">{qty(i.boq_qty)}</td>
                          <td className="rt mono">
                            {qty(i.effective_est)}
                            {Number(i.var_qty) !== 0 && (
                              <small style={{ color: 'var(--brand)' }}>
                                incl. {Number(i.var_qty) > 0 ? '+' : ''}{qty(i.var_qty)} amended
                              </small>
                            )}
                          </td>
                          <td className="rt" style={{ color: 'var(--faint)' }}>
                            {np ? <small>calculated</small> : ''}
                          </td>
                          <td className="rt mono">
                            {np && !p.leavesNothing ? (
                              <>
                                <b>{qty(np.newBoqQty)}</b>
                                <small>est {qty(np.newEst)}</small>
                              </>
                            ) : <span style={{ color: 'var(--faint)' }}>—</span>}
                          </td>
                        </tr>
                      );
                    })}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <div style={{ marginTop: 16 }}>
        <Field label="Why" hint="This sits on the record next to the quantity. Be specific.">
          <textarea className="inp" rows={2} value={reason} onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. client added twenty points on the east riser, approved 12/09" />
        </Field>
      </div>
    </Modal>
  );
}

/* =====================================================================
   HISTORY
   One BOQ read backwards: what was done to it, what each amendment
   moved, and every indent raised against it.
   ===================================================================== */
const csv = (rows) => rows.map((r) => r
  .map((c) => (/[",\n]/.test(String(c)) ? `"${String(c).replace(/"/g, '""')}"` : c))
  .join(',')).join('\n');

function download(name, text) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv' }));
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

export function BoqHistory({ boqId, onClose }) {
  const nav = useNavigate();
  const toast = useToast();
  const { data, loading, error, reload } = useApi(`/boq/${boqId}/history`, [boqId]);
  const { data: amendments } = useApi(`/boq/${boqId}/amendments`, [boqId]);
  const [tab, setTab] = useState('amendments');

  const grab = async (ind) => {
    try {
      const full = await api.get(`/indents/${ind.id}`);
      download(`${ind.doc_no.replace(/\//g, '-')}.csv`, csv([
        ['PRN', ind.doc_no], ['Site', data.site.name], ['Raised', dmy(ind.indent_date)],
        ['Needed by', ind.needed_by ? dmy(ind.needed_by) : ''], ['Status', ind.status], [],
        ['Sl no', 'Item code', 'Item', 'Qty', 'Estimate', 'Past estimate'],
        ...full.lines.map((l) => [
          l.sno, l.item_code, l.item_name, l.qty, l.effective_est, l.over_qty,
        ]),
      ]));
      toast('Downloaded', 'ok');
    } catch (e) { toast(e.message, 'bad'); }
  };

  if (loading) return <Modal full title="History" onClose={onClose}><Loading /></Modal>;
  if (error) {
    return (
      <Modal full title="History" onClose={onClose}>
        <ErrorNote error={error} onRetry={reload} />
      </Modal>
    );
  }

  const tabs = [
    ['amendments', `Amendments (${amendments?.length || 0})`],
    ['indents', `PRNs (${data.indents.length})`],
    ['trail', `Trail (${data.events.length})`],
  ];

  return (
    <Modal
      full
      title={data.docNo}
      sub={`${data.site.name} · against ${data.workOrder.clientWoNo || data.workOrder.docNo}`}
      onClose={onClose}
      footer={<button className="btn" onClick={onClose}>Close</button>}
    >
      <div className="tabs" style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
        {tabs.map(([k, label]) => (
          <button key={k} className={`btn sm ${tab === k ? 'pri' : ''}`} onClick={() => setTab(k)}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'amendments' && (
        (amendments || []).length ? (amendments.map((a) => (
          <Card key={a.id} title={`Amended ${dmy(a.at)}`} sub={`${a.by || 'someone'} · ${a.reason}`}>
            <div className="tw">
              <table>
                <thead>
                  <tr>
                    <th style={{ width: 62 }}>Sl no</th><th>Line</th><th style={{ width: 76 }}>Unit</th>
                    <th className="rt" style={{ width: 90 }}>Was</th>
                    <th className="rt" style={{ width: 100 }}>Change</th>
                    <th className="rt" style={{ width: 90 }}>Became</th>
                  </tr>
                </thead>
                <tbody>
                  {a.lines.map((l, n) => (
                    <tr key={n}>
                      <td className="sn">{l.sno}</td>
                      <td>{l.kind === 'WO_LINE'
                        ? <b>{l.description}</b>
                        : <>{l.itemName}<small><Code>{l.itemCode}</Code> · recorded before amendments moved to the work order line</small></>}
                      </td>
                      <td>{l.uom || ''}</td>
                      <td className="rt mono">{l.from != null ? qty(l.from) : '—'}</td>
                      <td className="rt">
                        <span className="mono" style={{ fontWeight: 600 }}>
                          {Number(l.qty) > 0 ? '+' : Number(l.qty) < 0 ? '−' : ''}{qty(Math.abs(Number(l.qty)))}
                        </span>
                      </td>
                      <td className="rt mono"><b>{l.to != null ? qty(l.to) : '—'}</b></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        ))) : (
          <Card><Empty title="Never amended">
            Nothing on this BOQ has moved since it was locked.
          </Empty></Card>
        )
      )}

      {tab === 'indents' && (
        <Card title="PRNs raised against this BOQ" sub="Every PRN, whatever became of it">
          {data.indents.length ? (
            <div className="tw">
              <table>
                <thead>
                  <tr>
                    <th>PRN</th><th>Raised</th><th>Needed by</th><th>By</th>
                    <th className="rt">Lines</th><th className="rt">Qty</th>
                    <th>Status</th><th style={{ width: 160 }} />
                  </tr>
                </thead>
                <tbody>
                  {data.indents.map((i) => (
                    <tr key={i.id}>
                      <td><Code as="b">{i.doc_no}</Code></td>
                      <td className="mono">{dmy(i.indent_date)}</td>
                      <td className="mono">{i.needed_by ? dmy(i.needed_by) : '—'}</td>
                      <td>{i.raised_by_name || '—'}</td>
                      <td className="rt mono">{i.line_count}</td>
                      <td className="rt mono">{qty(i.total_qty)}</td>
                      <td>
                        <Status is={prnApproval(i)} />
                        {i.severity !== 'none' && (
                          <small><Status tone="attention" icon="alert" label={`${i.over_lines} past the estimate`} /></small>
                        )}
                      </td>
                      <td className="rt">
                        <button className="btn sm" onClick={() => { onClose(); nav(`/indents/${i.id}`); }}>
                          Open PRN
                        </button>{' '}
                        <button className="btn sm" onClick={() => grab(i)}>Download</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty title="Nothing raised yet">
              This BOQ is locked and ready; no PRN has been raised against it yet.
            </Empty>
          )}
        </Card>
      )}

      {tab === 'trail' && (
        <Card title="What was done to this BOQ" sub="Newest first">
          <div className="tw">
            <table>
              <thead>
                <tr><th style={{ width: 170 }}>When</th><th style={{ width: 190 }}>Action</th><th>Detail</th><th style={{ width: 150 }}>By</th></tr>
              </thead>
              <tbody>
                {data.events.map((e, n) => (
                  <tr key={n}>
                    <td className="mono">{dmy(e.created_at)}</td>
                    <td><b>{e.action}</b></td>
                    <td>{e.detail || '—'}</td>
                    <td>{e.by_name || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </Modal>
  );
}
