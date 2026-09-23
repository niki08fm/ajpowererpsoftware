import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useApp, PageHead } from '../App';
import { api, money, dmy, plural } from '../api';
import {
  useApi, Card, Field, Empty, Loading, ErrorNote, Modal, Stat, useToast, Status, Code,
} from '../components/ui';
import { Icon } from '../components/icons';
import { AlertList } from './Alerts';

/**
 * Everything waiting on your decision, in one place.
 *
 * Five documents are approved twice — the BOQ, the PRN, the rate
 * comparison, the purchase order and the bill. The site's GM approves
 * level 1 and Management level 2, and the same person may not do both,
 * so a document you approved once does not come back to you for level 2.
 * The Level column says which of the two you are being asked for.
 *
 * Two are decided once. An expense claim is the site's own money and
 * its GM decides it; a transfer request is one site asking another for
 * stock, and only the site being asked can agree to send it.
 *
 * There is no second approval system behind this screen. Each decision
 * is the document's own — the same call its own screen makes — so the
 * document's history records it exactly as if it had been decided there.
 *
 * Oldest on your desk first.
 */

const TYPES = {
  BOQ: { label: 'BOQ', open: () => '/boq' },
  PRN: { label: 'PRN', open: (r) => `/indents/${r.id}` },
  COMPARISON: { label: 'Rate comparison', open: (r) => `/comparisons/${r.id}` },
  PO: { label: 'Purchase order', open: (r) => `/purchase-orders/${r.id}` },
  BILL: { label: 'RA bill', open: () => '/billing/bills' },
  EXPENSE: { label: 'Expense claim', open: () => '/site/expenses' },
  TRANSFER: { label: 'Transfer request', open: () => '/site/transfers' },
};

/** What happens after an approval, per document, so the button's consequence is known. */
const AFTER_APPROVAL = {
  BOQ: 'The BOQ locks, and the site can raise PRNs against it.',
  PRN: 'The store sends it from stock, or Procurement orders it.',
  COMPARISON: 'Procurement can raise a purchase order from the chosen supplier.',
  PO: 'The order can go to the supplier, and the store can receive against it.',
  BILL: 'The bill is raised to the client and counts as revenue.',
};

const TWO_LEVEL = (row) => ({
  action: 'APPROVED', label: 'Approve', pri: true,
  consequence: Number(row.level) === 1 && Number(row.levels) > 1
    ? 'This is level 1 of 2. It then goes to Management for level 2.'
    : `This is the final approval. ${AFTER_APPROVAL[row.type] || ''}`,
});
const SEND_BACK = (row) => ({
  action: 'RETURNED', label: 'Send back', note: true,
  consequence: `It goes back to ${row.raisedBy || 'whoever raised it'} with your reason. They can change it and send it again; approval starts again at level 1.`,
});

/** The decisions each type can take, and what each one does. */
const DECISIONS = {
  BOQ: (r) => [TWO_LEVEL(r), SEND_BACK(r)],
  PRN: (r) => [TWO_LEVEL(r), SEND_BACK(r)],
  COMPARISON: (r) => [TWO_LEVEL(r), SEND_BACK(r)],
  PO: (r) => [TWO_LEVEL(r), SEND_BACK(r)],
  BILL: (r) => [TWO_LEVEL(r), SEND_BACK(r)],
  EXPENSE: (r) => [
    { action: 'APPROVED', label: 'Approve', pri: true,
      consequence: 'The full amount claimed counts as cost for the site.' },
    { action: 'PART', label: 'Part-approve', amount: true, note: true,
      consequence: 'Only the amount you allow counts as cost. The rest is disallowed, and the site sees your reason.' },
    SEND_BACK(r),
    { action: 'REJECTED', label: 'Reject', note: true, bad: true,
      consequence: 'The claim is closed. None of it counts as cost, and it cannot be sent again.' },
  ],
  TRANSFER: () => [
    { action: 'ACCEPTED', label: 'Accept', pri: true,
      consequence: 'Your site agrees to send this material. You then dispatch it on a delivery challan from “Send to another site”.' },
    { action: 'REJECTED', label: 'Reject', note: true, bad: true,
      consequence: 'Your site will not send it. The store has to find it another way.' },
  ],
};
const ENDPOINT = {
  BOQ: (id) => `/boq/${id}/decide`,
  PRN: (id) => `/indents/${id}/decide`,
  // the comparison's own /decide picks the winning supplier; this one
  // approves that choice, which is why it has a name of its own
  COMPARISON: (id) => `/comparisons/${id}/decide-approval`,
  PO: (id) => `/purchase-orders/${id}/decide`,
  BILL: (id) => `/bills/${id}/decide`,
  EXPENSE: (id) => `/expenses/${id}/decide`,
  TRANSFER: (id) => `/transfers/${id}/decide`,
};

/** How long it has sat with you, and when that becomes something to act on. */
const ageTone = (d) => (d >= 3 ? 'attention' : 'neutral');
const ageWord = (d) => (d === 0 ? 'Today' : plural(d, 'day'));

export function Approvals() {
  const { refreshApprovals, access } = useApp();
  // what has gone wrong, shown to the people who oversee before anything else
  const alerts = useApi(access?.overseer ? '/alerts' : null, [access?.overseer]);
  const [type, setType] = useState('');
  const [deciding, setDeciding] = useState(null);   // { row, decision }
  const { data, error, loading, reload } = useApi(`/approvals${type ? `?type=${type}` : ''}`, [type]);

  const done = () => { setDeciding(null); reload(); refreshApprovals?.(); };
  const me = data?.me;

  return (
    <>
      <PageHead title="Waiting on me"
        sub={`Everything routed to ${me ? me.name : 'you'} by name, from every branch. Oldest first.`}
        actions={<button className="btn" onClick={reload}><Icon name="refresh" size={14} />Refresh</button>} />
      <div className="page-body">
        {error && <ErrorNote error={error} onRetry={reload} />}

        {(alerts.data?.rows || []).length > 0 && (
          <Card title="Needs attention"
            sub="Challans not signed for a day after dispatch, short deliveries, PRNs past their needed-by date, and orders past their due date"
            actions={<Link className="btn sm" to="/alerts">All alerts</Link>}>
            <AlertList rows={alerts.data.rows.slice(0, 5)} compact />
          </Card>
        )}

        {data && (
          <Card className="pad">
            <div className="stats">
              <Stat n={data.totals.waiting} label="waiting for you" />
              <Stat n={data.totals.overTwoDays} label="with you more than 2 days"
                tone={data.totals.overTwoDays ? 'warn' : undefined} />
              <Stat n={data.totals.oldestDays ? plural(data.totals.oldestDays, 'day') : 'Today'} label="oldest has waited" />
              {data.totals.value > 0 && <Stat n={money(data.totals.value)} label="value of claims and orders waiting" />}
            </div>
          </Card>
        )}

        <div className="chips" role="group" aria-label="Show one kind of document" style={{ margin: '14px 0' }}>
          {[['', 'Everything'], ...Object.entries(TYPES).map(([k, v]) => [k, v.label])].map(([k, l]) => (
            <button key={k || 'all'} type="button" aria-pressed={type === k}
              className={`btn sm toggle ${type === k ? 'on' : ''}`} onClick={() => setType(k)}>
              {l}{k && data?.totals.byType[k] ? <span className="n">{data.totals.byType[k]}</span> : null}
            </button>
          ))}
        </div>

        {loading && !data ? <Loading what="what is waiting on you" /> : (
          <Card>
            <div className="tw">
              <table>
                <thead>
                  <tr>
                    <th style={{ width: 210 }}>Document</th>
                    <th>For</th>
                    <th className="rt" style={{ width: 110 }}>Value</th>
                    <th style={{ width: 110 }}>You approve</th>
                    <th style={{ width: 96 }}>With you</th>
                    <th><span className="vh">Decide</span></th>
                  </tr>
                </thead>
                <tbody>
                  {(data?.rows || []).map((r) => (
                    <tr key={`${r.type}-${r.id}`}>
                      <td>
                        <span style={{ fontSize: 12.5, color: 'var(--muted)', fontWeight: 600 }}>{TYPES[r.type].label}</span>
                        <Link className="linkish" to={TYPES[r.type].open(r)} style={{ display: 'block' }}>
                          <Code>{r.docNo}</Code>
                        </Link>
                        <small>by {r.raisedBy || '—'} · {dmy(r.raisedOn)}</small>
                      </td>
                      <td>
                        <b>{r.site.name || r.branch.name}</b>
                        <small>{r.site.name ? `${r.branch.name} · ` : ''}
                          {r.summary}
                          {r.neededBy ? ` · needed by ${dmy(r.neededBy)}` : ''}
                        </small>
                        {r.flags ? (
                          <div style={{ marginTop: 4 }}>
                            <Status tone="attention" icon="alert" label={`${plural(r.flags, 'line')} past the estimate`} />
                          </div>
                        ) : null}
                      </td>
                      <td className="rt mono">{r.amount != null ? money(r.amount) : '—'}</td>
                      <td>{r.stage || <span style={{ color: 'var(--muted)' }}>One decision</span>}</td>
                      <td><Status tone={ageTone(r.daysWaiting)} icon="clock" label={ageWord(r.daysWaiting)} /></td>
                      <td className="rt" style={{ whiteSpace: 'nowrap' }}>
                        {DECISIONS[r.type](r).map((d) => (
                          <button key={d.action} type="button" style={{ marginLeft: 6 }}
                            className={`btn sm ${d.pri ? 'pri' : ''} ${d.bad ? 'bad' : ''}`}
                            onClick={() => setDeciding({ row: r, decision: d })}>{d.label}</button>
                        ))}
                      </td>
                    </tr>
                  ))}
                  {!(data?.rows || []).length && (
                    <tr><td colSpan={6}>
                      <Empty icon="check" title={type ? `No ${TYPES[type].label.toLowerCase()}s are waiting for you` : 'Nothing is waiting for you'}>
                        What arrives here: a PRN, BOQ, bill or expense claim from a site you are GM of;
                        a rate comparison or purchase order for Management; a transfer your site is asked to send.
                      </Empty>
                    </td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        )}
      </div>

      {deciding && (
        <Decide row={deciding.row} decision={deciding.decision}
          onClose={() => setDeciding(null)} onDone={done} />
      )}
    </>
  );
}

function Decide({ row, decision, onClose, onDone }) {
  const toast = useToast();
  const [note, setNote] = useState('');
  const [amount, setAmount] = useState(row.amount != null ? String(row.amount) : '');
  const [busy, setBusy] = useState(false);

  const needsNote = decision.note && decision.action !== 'PART';
  const amountBad = decision.amount
    && !(Number(amount) >= 0 && Number(amount) < Number(row.amount));
  const ready = !busy && (!needsNote || note.trim()) && !amountBad;

  const go = async () => {
    setBusy(true);
    try {
      const body = decision.action === 'PART'
        ? { action: 'APPROVED', amount: Number(amount), note: note.trim() || undefined }
        : { action: decision.action, note: note.trim() || undefined };
      const r = await api.post(ENDPOINT[row.type](row.id), body);
      const DONE = { APPROVED: 'approved', PART: 'part-approved', RETURNED: 'sent back',
        REJECTED: 'rejected', ACCEPTED: 'accepted' };
      toast(r?.message || `${row.docNo} ${DONE[decision.action]}`, 'ok');
      onDone();
    } catch (e) { toast(e.message, 'bad'); setBusy(false); }
  };

  return (
    <Modal title={`${decision.label}: ${row.docNo}`}
      sub={`${TYPES[row.type].label} · ${row.site.name || row.branch.name} · with you ${ageWord(row.daysWaiting).toLowerCase()}`}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>Go back</button>
          <button className={`btn ${decision.bad ? 'bad' : 'pri'}`} disabled={!ready} onClick={go}>
            {busy ? 'Saving…' : decision.label}
          </button>
        </>
      }>
      <p style={{ margin: '0 0 10px' }}>
        <b>{row.summary}</b>
        {row.amount != null && <> · claimed <b className="mono">{money(row.amount)}</b></>}
      </p>
      <p className="consequence">{decision.consequence}</p>
      {decision.amount && (
        <Field label="Amount allowed" bad={amountBad}
          hint={amountBad ? `Must be less than the ${money(row.amount)} claimed — for the full amount, use Approve` : 'The rest of the claim is disallowed'}>
          <input className="inp mono" type="number" min="0" step="0.01" inputMode="decimal" value={amount} autoFocus
            onChange={(e) => setAmount(e.target.value)} />
        </Field>
      )}
      {decision.note && (
        <Field label={needsNote ? 'Reason' : 'Reason (optional)'}
          hint={needsNote ? 'Required — whoever raised it sees this' : 'Whoever raised it sees this'}>
          <textarea className="inp" rows={3} value={note} autoFocus={!decision.amount}
            onChange={(e) => setNote(e.target.value)} />
        </Field>
      )}
    </Modal>
  );
}

/** What I have decided, read back from each document's own history. */
export function Decided() {
  const [days, setDays] = useState(60);
  const { data, error, loading, reload } = useApi(`/approvals/decided?days=${days}`, [days]);
  const WORD = {
    APPROVED: ['done', 'Approved'], ACCEPTED: ['done', 'Accepted'],
    RETURNED: ['attention', 'Sent back'], REJECTED: ['stopped', 'Rejected'],
  };
  return (
    <>
      <PageHead title="Decided by me" sub="Read back from each document's own history, newest first" />
      <div className="page-body">
        {error && <ErrorNote error={error} onRetry={reload} />}
        <div className="searchbar">
          <Field label="Period">
            <select className="inp" value={days} onChange={(e) => setDays(Number(e.target.value))}>
              <option value={7}>Last 7 days</option>
              <option value={30}>Last 30 days</option>
              <option value={60}>Last 60 days</option>
              <option value={365}>Last year</option>
            </select>
          </Field>
        </div>
        {loading && !data ? <Loading what="your decisions" /> : (
          <Card>
            <div className="tw">
              <table>
                <thead>
                  <tr><th style={{ width: 190 }}>Document</th>
                    <th>For</th><th style={{ width: 170 }}>Your decision</th>
                    <th className="rt" style={{ width: 120 }}>Allowed</th><th style={{ width: 130 }}>When</th></tr>
                </thead>
                <tbody>
                  {(data?.rows || []).map((r, i) => {
                    const [tone, word] = WORD[r.action] || ['neutral', r.action];
                    return (
                      <tr key={`${r.type}-${r.id}-${i}`}>
                        <td>
                          <span style={{ fontSize: 12.5, color: 'var(--muted)', fontWeight: 600 }}>{TYPES[r.type]?.label || r.type}</span>
                          <Link className="linkish" style={{ display: 'block' }} to={TYPES[r.type].open(r)}><Code>{r.docNo}</Code></Link>
                        </td>
                        <td>{r.site}{r.note && <small>“{r.note}”</small>}</td>
                        <td>
                          <Status tone={tone} label={word} />
                          {r.stage && <small>{r.stage}</small>}
                        </td>
                        <td className="rt mono">{r.amount != null ? money(r.amount) : '—'}</td>
                        <td className="mono">{dmy(r.at)}</td>
                      </tr>
                    );
                  })}
                  {!(data?.rows || []).length && (
                    <tr><td colSpan={5}><Empty title="You decided nothing in this period" /></td></tr>
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
