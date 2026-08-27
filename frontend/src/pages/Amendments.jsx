import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useApp, PageHead } from '../App';
import { api, qty, dmy } from '../api';
import {
  useApi, Card, Tag, Empty, Loading, ErrorNote, Banner, Field, Modal, Stat, useToast,
} from '../components/ui';

/**
 * A BOQ goes to "Amendment due" the moment a site indents past the
 * estimate on any line. This is where that gets regularised: the
 * variation quantity is added, the estimate moves up to cover what was
 * actually raised, and the reason is on the record next to it.
 *
 * The shortfall is pre-filled because that is almost always the answer.
 * The reason is not, because a variation without one is just a number
 * someone changed.
 */
export default function Amendments() {
  const { branchId, refreshDesk } = useApp();
  const toast = useToast();
  const { data: desk, loading, error, reload } = useApi(
    branchId ? `/progress/desk?branchId=${branchId}` : null, [branchId]);

  const [open, setOpen] = useState(null);      // the boq being amended
  const [lines, setLines] = useState([]);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const start = async (boq) => {
    try {
      const r = await api.get(`/boq/${boq.boq_id}/over-lines`);
      setLines(r.lines.map((l) => ({ ...l, add: String(l.over_qty) })));
      setReason('');
      setOpen({ ...boq, docNo: r.docNo });
    } catch (e) { toast(e.message, 'bad'); }
  };

  const save = async () => {
    const use = lines.filter((l) => Number(l.add) > 0);
    if (!use.length) return toast('Give at least one line a variation quantity', 'bad');
    if (reason.trim().length < 5) return toast('Say why the quantity changed', 'bad');
    setBusy(true);
    try {
      const r = await api.post(`/boq/${open.boq_id}/amendments`, {
        reason: reason.trim(),
        lines: use.map((l) => ({ boqLineId: l.boq_line_id, qty: Number(l.add) })),
      });
      toast(r.state === 'LOCKED'
        ? `${open.docNo} is back to normal`
        : `${open.docNo} amended — ${r.overLines} line(s) still over`, 'ok');
      setOpen(null);
      reload();
      refreshDesk?.();
    } catch (e) { toast(e.message, 'bad'); }
    setBusy(false);
    return undefined;
  };

  const due = desk?.amendmentDue || [];

  return (
    <>
      <PageHead title="Amendments" sub="Bring a BOQ back in line with what the site actually raised" />
      <div className="page-body">
        {error && <ErrorNote error={error} onRetry={reload} />}

        {loading ? <Loading /> : due.length === 0 ? (
          <Card>
            <Empty title="Nothing needs amending">
              Every BOQ in this branch is within its estimate. This screen fills up when a site indents
              past one.
            </Empty>
          </Card>
        ) : (
          <>
            <Banner kind="bad" icon="▲">
              <b>{due.length} BOQ{due.length === 1 ? '' : 's'} indented past the estimate.</b> Until a
              variation quantity is recorded, the estimate on those lines does not reflect what the site
              has actually been given.
            </Banner>

            <Card title="Waiting on an amendment">
              <div className="tw">
                <table>
                  <thead>
                    <tr>
                      <th>BOQ</th><th>Site</th>
                      <th className="rt">Lines over</th><th className="rt">Worst line</th><th />
                    </tr>
                  </thead>
                  <tbody>
                    {due.map((b) => (
                      <tr key={b.boq_id}>
                        <td><b className="mono">{b.doc_no}</b></td>
                        <td>
                          <Link to={`/sites/${b.site_id}`} style={{ textDecoration: 'underline' }}>
                            {b.site_name}
                          </Link>
                        </td>
                        <td className="rt mono">{b.over_line_count}</td>
                        <td className="rt">
                          <Tag kind="bad">▲ {Number(b.worst_over_pct).toFixed(1)}% over</Tag>
                        </td>
                        <td className="rt">
                          <Link className="btn sm" to="/boq">Open BOQ</Link>{' '}
                          <button className="btn sm pri" onClick={() => start(b)}>Amend</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          </>
        )}
      </div>

      {open && (
        <Modal
          wide
          title={`Amend ${open.docNo}`}
          sub={`${open.site_name} · ${open.over_line_count} line(s) past the estimate`}
          onClose={() => setOpen(null)}
          footer={<>
            <button className="btn" onClick={() => setOpen(null)}>Cancel</button>
            <button className="btn pri" disabled={busy} onClick={save}>Record the amendment</button>
          </>}
        >
          <Banner kind="bad" icon="▲">
            Adding the variation quantity brings the BOQ back to normal and leaves a record of what
            changed and why. The estimate itself is not overwritten — the variation sits beside it.
          </Banner>

          <div className="tw">
            <table className="sheet">
              <thead>
                <tr>
                  <th style={{ width: 52 }}>Sl No</th><th>Item</th>
                  <th className="rt" style={{ width: 84 }}>Est qty</th>
                  <th className="rt" style={{ width: 90 }}>Indented</th>
                  <th className="rt" style={{ width: 110 }}>Over</th>
                  <th className="rt" style={{ width: 104 }}>Variation</th>
                  <th className="rt" style={{ width: 96 }}>New estimate</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l, i) => (
                  <tr key={l.boq_line_id}>
                    <td className="sn">{l.sno}</td>
                    <td><b>{l.item_name}</b><small className="mono">{l.item_code} · {l.uom}</small></td>
                    <td className="rt mono">{qty(l.effective_est)}</td>
                    <td className="rt mono">{qty(l.committed_qty)}</td>
                    <td className="rt">
                      <Tag kind="bad">▲ {qty(l.over_qty)} · {Number(l.over_pct_actual).toFixed(1)}%</Tag>
                    </td>
                    <td>
                      <input className="inp rt" type="number" min="0" step="any" value={l.add}
                        onChange={(e) => setLines((x) => x.map((y, n) => (n === i ? { ...y, add: e.target.value } : y)))} />
                    </td>
                    <td className="rt mono">
                      <b>{qty(Number(l.effective_est) + (Number(l.add) || 0))}</b>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div style={{ marginTop: 16 }}>
            <Field label="Why" hint="This sits on the record next to the quantity. Be specific.">
              <textarea className="inp" rows={2} value={reason} onChange={(e) => setReason(e.target.value)}
                placeholder="e.g. extra points added on the east riser, approved by the client on 12/09" />
            </Field>
          </div>
        </Modal>
      )}
    </>
  );
}
