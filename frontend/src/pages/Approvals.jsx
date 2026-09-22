import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useApp, PageHead } from '../App';
import { api, money, dmy } from '../api';
import {
  useApi, Card, Field, Tag, Empty, Loading, ErrorNote, Banner, Modal, Stat, useToast,
} from '../components/ui';

/**
 * Everything waiting on your decision, in one place.
 *
 * Five documents are signed twice — the BOQ, the PRN, the rate
 * comparison, the purchase order and the bill. The site's GM signs
 * first and Management signs second, and the same person may not do
 * both, so a document you have already signed once does not come back
 * to you for its second signature. The stage column says which
 * signature you are being asked for.
 *
 * Two are decided once. An expense claim is the site's own money and
 * its GM decides it; a transfer request is one site asking another for
 * stock, and only the site being asked can agree to send it.
 *
 * With no login yet, "you" is the Working-as person in the top bar, so
 * this is strict about what is shown, not about who may act.
 *
 * There is no second approval system behind this screen. Each decision
 * is the document's own — the same call its own screen makes — so the
 * document's history records it exactly as if it had been decided
 * there.
 *
 * Oldest on your desk first. Late means how long it has sat with you.
 */

const TYPES = {
  BOQ: { label: 'BOQ', open: () => '/boq' },
  PRN: { label: 'PRN', open: (r) => `/indents/${r.id}` },
  COMPARISON: { label: 'Rate comparison', open: (r) => `/comparisons/${r.id}` },
  PO: { label: 'Purchase order', open: (r) => `/purchase-orders/${r.id}` },
  BILL: { label: 'Bill', open: () => '/billing/bills' },
  EXPENSE: { label: 'Expense claim', open: () => '/site/expenses' },
  TRANSFER: { label: 'Transfer', open: () => '/site/transfers' },
};

// what each type can be told, and where it is told it
const SIGN_OR_RETURN = [
  { action: 'APPROVED', label: 'Approve', pri: true },
  { action: 'RETURNED', label: 'Send back', note: true },
];
const DECISIONS = {
  BOQ: SIGN_OR_RETURN,
  PRN: SIGN_OR_RETURN,
  COMPARISON: SIGN_OR_RETURN,
  PO: SIGN_OR_RETURN,
  BILL: SIGN_OR_RETURN,
  EXPENSE: [
    { action: 'APPROVED', label: 'Approve', pri: true },
    { action: 'PART', label: 'Part-approve', amount: true, note: true },
    { action: 'REJECTED', label: 'Refuse', note: true, bad: true },
    { action: 'RETURNED', label: 'Send back', note: true },
  ],
  TRANSFER: [
    { action: 'ACCEPTED', label: 'Accept', pri: true },
    { action: 'REJECTED', label: 'Refuse', note: true, bad: true },
  ],
};
const ENDPOINT = {
  BOQ: (id) => `/boq/${id}/decide`,
  PRN: (id) => `/indents/${id}/decide`,
  // the comparison's own /decide picks the winning supplier; this one
  // signs that choice, which is why it has a name of its own
  COMPARISON: (id) => `/comparisons/${id}/decide-approval`,
  PO: (id) => `/purchase-orders/${id}/decide`,
  BILL: (id) => `/bills/${id}/decide`,
  EXPENSE: (id) => `/expenses/${id}/decide`,
  TRANSFER: (id) => `/transfers/${id}/decide`,
};

const age = (d) => (d >= 3 ? 'bad' : d === 2 ? 'warn' : '');

export function Approvals() {
  const { refreshApprovals } = useApp();
  const [type, setType] = useState('');
  const [deciding, setDeciding] = useState(null);   // { row, decision }
  const { data, error, loading, reload } = useApi(`/approvals${type ? `?type=${type}` : ''}`, [type]);

  const done = () => { setDeciding(null); reload(); refreshApprovals?.(); };
  const me = data?.me;

  return (
    <>
      <PageHead title="Waiting on me"
        sub={me ? `Routed to ${me.name} · ${me.department}. Oldest on your desk first.` : 'Oldest on your desk first'}
        actions={<button className="btn" onClick={reload}>Refresh</button>} />
      <div className="page-body">
        {error && <ErrorNote error={error} onRetry={reload} />}

        {data && (
          <Card className="pad">
            <div className="stats">
              <Stat n={data.totals.waiting} label="waiting on you" />
              <Stat n={data.totals.overTwoDays} label="with you more than 2 days"
                tone={data.totals.overTwoDays ? 'bad' : undefined} />
              <Stat n={`${data.totals.oldestDays}d`} label="oldest" />
              {data.totals.value > 0 && <Stat n={money(data.totals.value)} label="value waiting" />}
            </div>
          </Card>
        )}

        <div className="chips" style={{ margin: '14px 0' }}>
          {[['', 'Everything'], ...Object.entries(TYPES).map(([k, v]) => [k, v.label])].map(([k, l]) => (
            <button key={k || 'all'} type="button"
              className={`btn sm ${type === k ? 'pri' : ''}`} onClick={() => setType(k)}>
              {l}{k && data?.totals.byType[k] ? ` · ${data.totals.byType[k]}` : ''}
            </button>
          ))}
        </div>

        {loading && !data ? <Loading /> : (
          <Card>
            <div className="tw">
              <table>
                <thead>
                  <tr>
                    <th style={{ width: 130 }}>Type</th>
                    <th style={{ width: 150 }}>Document</th>
                    <th>For</th>
                    <th style={{ width: 130 }}>Raised by</th>
                    <th className="rt" style={{ width: 110 }}>Value</th>
                    <th className="rt" style={{ width: 110 }}>With you</th>
                    <th style={{ width: 280 }} />
                  </tr>
                </thead>
                <tbody>
                  {(data?.rows || []).map((r) => (
                    <tr key={`${r.type}-${r.id}`}>
                      <td><Tag kind="brand">{TYPES[r.type].label}</Tag></td>
                      <td>
                        <Link className="linkish" to={TYPES[r.type].open(r)}>{r.docNo}</Link>
                        <small>
                          {dmy(r.raisedOn)}
                          {r.stage ? ` · ${r.stage.toLowerCase()}` : ''}
                        </small>
                      </td>
                      <td>
                        <b>{r.site.name || r.branch.name}</b>
                        <small>
                          {r.summary}
                          {r.neededBy ? ` · wanted by ${dmy(r.neededBy)}` : ''}
                          {r.flags ? ` · ${r.flags} line(s) past the estimate` : ''}
                        </small>
                      </td>
                      <td>{r.raisedBy || '—'}<small>{r.branch.name}</small></td>
                      <td className="rt mono">{r.amount != null ? money(r.amount) : '—'}</td>
                      <td className="rt">
                        <Tag kind={age(r.daysWaiting)}>
                          {r.daysWaiting === 0 ? 'today' : `${r.daysWaiting} day${r.daysWaiting === 1 ? '' : 's'}`}
                        </Tag>
                      </td>
                      <td className="rt" style={{ whiteSpace: 'nowrap' }}>
                        {DECISIONS[r.type].map((d) => (
                          <button key={d.action} type="button" style={{ marginLeft: 5 }}
                            className={`btn sm ${d.pri ? 'pri' : ''} ${d.bad ? 'bad' : ''}`}
                            onClick={() => setDeciding({ row: r, decision: d })}>{d.label}</button>
                        ))}
                      </td>
                    </tr>
                  ))}
                  {!(data?.rows || []).length && (
                    <tr><td colSpan={7}>
                      <Empty title="Nothing is waiting on you">
                        Anything routed to you — a PRN or claim from a site you are GM of, an order
                        for Management, a transfer your site is asked to send — appears here.
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

  // a plain approval needs no questions answered; go straight through
  const quiet = !decision.note && !decision.amount;
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
      await api.post(ENDPOINT[row.type](row.id), body);
      const DONE = { APPROVED: 'approved', PART: 'part-approved', RETURNED: 'sent back',
        REJECTED: 'refused', ACCEPTED: 'accepted' };
      toast(`${row.docNo} ${DONE[decision.action]}`, 'ok');
      onDone();
    } catch (e) { toast(e.message, 'bad'); setBusy(false); }
  };

  return (
    <Modal title={`${decision.label} ${row.docNo}`}
      sub={`${TYPES[row.type].label} · ${row.site.name} · with you ${row.daysWaiting} day(s)`}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className={`btn ${decision.bad ? 'bad' : 'pri'}`} disabled={!ready} onClick={go}>
            {busy ? 'Saving…' : decision.label}
          </button>
        </>
      }>
      <p style={{ margin: '0 0 12px' }}>
        <b>{row.summary}</b>
        {row.amount != null && <> · claimed <b className="mono">{money(row.amount)}</b></>}
      </p>
      {quiet && (
        <Banner kind="info" icon="◆">
          Recorded against {row.docNo} under your name, exactly as if you had decided it on its own screen.
        </Banner>
      )}
      {decision.amount && (
        <Field label="Amount allowed"
          hint={amountBad ? `Less than the ${money(row.amount)} claimed — for the full amount, use Approve` : 'The rest of the claim is not allowed'}>
          <input className="inp mono" type="number" min="0" step="0.01" value={amount} autoFocus
            onChange={(e) => setAmount(e.target.value)} />
        </Field>
      )}
      {decision.note && (
        <Field label={needsNote ? 'Why' : 'Note'}
          hint={needsNote ? 'Required — it goes back to whoever raised it' : 'Optional'}>
          <input className="inp" value={note} autoFocus={!decision.amount}
            onChange={(e) => setNote(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && ready) go(); }} />
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
    APPROVED: ['ok', 'Approved'], ACCEPTED: ['ok', 'Accepted'],
    RETURNED: ['warn', 'Sent back'], REJECTED: ['bad', 'Refused'],
  };
  return (
    <>
      <PageHead title="Decided by me" sub="Read back from each document's own history" />
      <div className="page-body">
        {error && <ErrorNote error={error} onRetry={reload} />}
        <div className="searchbar">
          <Field label="Window">
            <select className="inp" value={days} onChange={(e) => setDays(Number(e.target.value))}>
              <option value={7}>Last 7 days</option>
              <option value={30}>Last 30 days</option>
              <option value={60}>Last 60 days</option>
              <option value={365}>Last year</option>
            </select>
          </Field>
        </div>
        {loading && !data ? <Loading /> : (
          <Card>
            <div className="tw">
              <table>
                <thead>
                  <tr><th style={{ width: 130 }}>Type</th><th style={{ width: 150 }}>Document</th>
                    <th>For</th><th style={{ width: 130 }}>Decision</th>
                    <th className="rt" style={{ width: 110 }}>Allowed</th><th style={{ width: 110 }}>When</th></tr>
                </thead>
                <tbody>
                  {(data?.rows || []).map((r, i) => {
                    const [kind, word] = WORD[r.action] || ['', r.action];
                    return (
                      <tr key={`${r.type}-${r.id}-${i}`}>
                        <td><Tag kind="brand">{TYPES[r.type]?.label || r.type}</Tag></td>
                        <td><Link className="linkish" to={TYPES[r.type].open(r)}>{r.docNo}</Link></td>
                        <td>{r.site}{r.note && <small>{r.note}</small>}</td>
                        <td><Tag kind={kind}>{word}</Tag></td>
                        <td className="rt mono">{r.amount != null ? money(r.amount) : '—'}</td>
                        <td className="mono">{dmy(r.at)}</td>
                      </tr>
                    );
                  })}
                  {!(data?.rows || []).length && (
                    <tr><td colSpan={6}><Empty title="Nothing decided in this window" /></td></tr>
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
