import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useApp, PageHead } from '../App';
import { api, money, dmy, today, withBranch } from '../api';
import { downloadCsv } from '../download';
import {
  useApi, useToast, Card, Tag, Empty, Loading, ErrorNote, Banner, Field, Modal, Stat,
} from '../components/ui';

/**
 * Money a site spends that never touches a shelf.
 *
 * This is the one Site screen that shows money, and it has to: a
 * transport bill is a number somebody typed, not a quantity anybody
 * can check against a shelf. Which is also why it is the one document
 * here that needs approving before it counts.
 *
 * The two amounts stay apart all the way through. What the site asked
 * for is one number and what was allowed is another, and only the
 * second reaches a report. Cutting ₹4,000 down to ₹3,200 is one
 * document with both figures on it, not a refusal followed by a fresh
 * claim — so anybody can ask later how much of what sites asked for
 * was actually granted, and the answer is in the documents.
 *
 * There are no permissions anywhere in this system yet, so there is
 * no separate approver's screen. Everything is here, and a claim
 * waiting to be decided says so.
 */

const STATUS = {
  DRAFT:         { tone: '',      word: 'Draft' },
  SUBMITTED:     { tone: 'warn',  word: 'Waiting' },
  APPROVED:      { tone: 'ok',    word: 'Approved' },
  PART_APPROVED: { tone: 'brand', word: 'Part approved' },
  NIL_APPROVED:  { tone: 'bad',   word: 'Nothing allowed' },
  REJECTED:      { tone: 'bad',   word: 'Refused' },
  RETURNED:      { tone: 'bad',   word: 'Sent back' },
};
const Outcome = ({ outcome }) => {
  const s = STATUS[outcome] || { tone: '', word: outcome };
  return <Tag kind={s.tone}>{s.word}</Tag>;
};

/* ===================================================================
   Raising one
   =================================================================== */
function ClaimForm({ siteId, categories, onDone, onClose }) {
  const toast = useToast();
  const [f, setF] = useState({
    categoryId: '', spentOn: today(), description: '', paidTo: '', billNo: '',
    amount: '', note: '',
  });
  const [saving, setSaving] = useState(false);
  const set = (patch) => setF((x) => ({ ...x, ...patch }));

  const amount = Number(f.amount) || 0;
  const ready = siteId && f.categoryId && f.description.trim().length >= 3
    && amount > 0 && !saving;

  const save = async (send) => {
    setSaving(true);
    try {
      const r = await api.post('/expenses', {
        siteId: Number(siteId),
        categoryId: Number(f.categoryId),
        spentOn: f.spentOn,
        description: f.description.trim(),
        paidTo: f.paidTo.trim() || undefined,
        billNo: f.billNo.trim() || undefined,
        amount,
        note: f.note.trim() || undefined,
        send,
      });
      toast(send ? `${r.docNo} sent for approval` : `${r.docNo} saved as a draft`, 'ok');
      onDone();
      onClose();
    } catch (e) {
      toast(e.message, 'bad');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal wide title="Claim an expense"
      sub="Nothing is counted until somebody approves it"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={() => save(false)} disabled={!ready}>
            Save as draft
          </button>
          <button className="btn pri" onClick={() => save(true)} disabled={!ready}>
            {saving ? 'Sending…' : 'Send for approval'}
          </button>
        </>
      }>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <Field label="What kind">
          <select className="inp" style={{ width: 220 }} value={f.categoryId}
            onChange={(e) => set({ categoryId: e.target.value })}>
            <option value="">Choose one</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>
        <Field label="Spent on">
          <input className="inp" type="date" style={{ width: 160 }} value={f.spentOn}
            max={today()} onChange={(e) => set({ spentOn: e.target.value })} />
        </Field>
        <Field label="Amount">
          <input className="inp rt mono" type="number" min="0" step="0.01"
            style={{ width: 150 }} value={f.amount} placeholder="0.00"
            onChange={(e) => set({ amount: e.target.value })} />
        </Field>
      </div>
      <Field label="What it was for">
        <input className="inp" value={f.description}
          placeholder="Lorry from the central store to site, 2 trips"
          onChange={(e) => set({ description: e.target.value })} />
      </Field>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <Field label="Paid to">
          <input className="inp" style={{ width: 240 }} value={f.paidTo}
            placeholder="Optional" onChange={(e) => set({ paidTo: e.target.value })} />
        </Field>
        <Field label="Bill number">
          <input className="inp" style={{ width: 180 }} value={f.billNo}
            placeholder="Optional" onChange={(e) => set({ billNo: e.target.value })} />
        </Field>
      </div>
      <Field label="Anything else">
        <input className="inp" value={f.note} placeholder="Optional"
          onChange={(e) => set({ note: e.target.value })} />
      </Field>
      <Banner kind="info" icon="₹">
        <b>{money(amount)}</b> claimed. Whoever decides it can allow all of it or less —
        what they allow is what shows on the expense report.
      </Banner>
    </Modal>
  );
}

/* ===================================================================
   Deciding one
   =================================================================== */
function DecideForm({ head, onDone, onClose }) {
  const toast = useToast();
  const claimed = Number(head.claimed_amount);
  const [amount, setAmount] = useState(String(claimed));
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const allowed = Number(amount) || 0;
  const cut = allowed < claimed - 0.004;
  const over = allowed > claimed + 0.004;
  const needsReason = cut;

  const decide = async (action) => {
    setBusy(true);
    try {
      const r = await api.post(`/expenses/${head.expense_id}/decide`, {
        action,
        ...(action === 'APPROVED' ? { amount: allowed } : {}),
        note: note.trim() || undefined,
      });
      toast(
        action === 'APPROVED'
          ? `${head.doc_no} — ${money(r.approved)} allowed`
          : action === 'REJECTED' ? `${head.doc_no} refused` : `${head.doc_no} sent back`,
        action === 'APPROVED' ? 'ok' : '',
      );
      onDone();
      onClose();
    } catch (e) {
      toast(e.message, 'bad');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={`Decide ${head.doc_no}`}
      sub={`${head.site_name} · ${head.category} · ${dmy(head.spent_on)}`}
      onClose={onClose}
      footer={
        <>
          <button className="btn bad" disabled={busy || !note.trim()}
            onClick={() => decide('REJECTED')} title={!note.trim() ? 'Say why first' : ''}>
            Refuse
          </button>
          <button className="btn" disabled={busy || !note.trim()}
            onClick={() => decide('RETURNED')}
            title={!note.trim() ? 'Say what to fix first' : ''}>
            Send back
          </button>
          <button className="btn pri"
            disabled={busy || over || allowed <= 0 || (needsReason && !note.trim())}
            onClick={() => decide('APPROVED')}>
            {cut ? `Allow ${money(allowed)}` : 'Approve in full'}
          </button>
        </>
      }>
      <p style={{ margin: '0 0 12px' }}>{head.description}</p>
      <div className="stats">
        <Stat n={money(claimed)} label="claimed" />
        <Stat n={money(allowed)} label="you are allowing"
          tone={over ? 'bad' : cut ? 'warn' : 'ok'} />
        <Stat n={money(Math.max(0, claimed - allowed))} label="disallowed" />
      </div>
      <Field label="Allow"
        hint={over ? 'More than the site asked for — that is a new claim, not an approval'
          : cut ? 'Less than claimed, so this is a part approval' : undefined}>
        <input className="inp rt mono" type="number" min="0" step="0.01" max={claimed}
          style={{ width: 180, ...(over ? { borderColor: 'var(--bad)' } : {}) }}
          value={amount} onChange={(e) => setAmount(e.target.value)} />
      </Field>
      <Field label="Reason"
        hint={needsReason
          ? 'Required — the site will ask why it was cut'
          : 'Required to refuse or send back'}>
        <input className="inp" value={note} placeholder="Why"
          onChange={(e) => setNote(e.target.value)} />
      </Field>
      {head.paid_to && (
        <p style={{ color: 'var(--muted)', fontSize: 12 }}>
          Paid to {head.paid_to}{head.bill_no ? ` · bill ${head.bill_no}` : ''}
          {head.raised_by_name ? ` · claimed by ${head.raised_by_name}` : ''}
        </p>
      )}
    </Modal>
  );
}

/* ===================================================================
   One claim, whole
   =================================================================== */
function ExpenseCard({ id, onClose, onChanged }) {
  const toast = useToast();
  const { data, loading, reload } = useApi(`/expenses/${id}`, [id]);
  const [deciding, setDeciding] = useState(false);
  if (loading || !data) return <Modal title="Expense" onClose={onClose}><Loading /></Modal>;
  const { head, events, canDecide, canWithdraw } = data;

  const act = async (path, word) => {
    try {
      await api.post(`/expenses/${head.expense_id}/${path}`);
      toast(`${head.doc_no} ${word}`, 'ok');
      reload();
      onChanged();
    } catch (e) { toast(e.message, 'bad'); }
  };

  return (
    <>
      <Modal wide title={head.doc_no}
        sub={`${head.site_name} · ${head.category} · spent ${dmy(head.spent_on)}`}
        onClose={onClose}
        actions={<Outcome outcome={head.outcome} />}
        footer={
          <>
            {head.status === 'DRAFT' && (
              <button className="btn pri" onClick={() => act('submit', 'sent for approval')}>
                Send for approval
              </button>
            )}
            {head.status === 'RETURNED' && (
              <button className="btn pri" onClick={() => act('submit', 'sent again')}>
                Send again
              </button>
            )}
            {canWithdraw && (
              <button className="btn" onClick={() => act('withdraw', 'pulled back')}>
                Pull it back
              </button>
            )}
            {canDecide && (
              <button className="btn pri" onClick={() => setDeciding(true)}>Decide</button>
            )}
          </>
        }>
        <p style={{ margin: '0 0 12px', fontSize: 15 }}>{head.description}</p>

        <div className="stats">
          <Stat n={money(head.claimed_amount)} label="claimed" />
          <Stat n={head.approved_amount == null ? '—' : money(head.approved_amount)}
            label="allowed"
            tone={head.approved_amount == null ? undefined
              : Number(head.approved_amount) < Number(head.claimed_amount) ? 'warn' : 'ok'} />
          <Stat n={money(head.cost_amount)} label="counts as cost" />
          <Stat n={money(head.disallowed_amount)} label="disallowed"
            tone={Number(head.disallowed_amount) > 0 ? 'bad' : undefined} />
        </div>

        {head.status === 'SUBMITTED' && (
          <Banner kind="warn" icon="…">
            Waiting to be decided{head.days_waiting > 0 && ` — ${head.days_waiting} day${
              head.days_waiting === 1 ? '' : 's'} now`}. Nothing is counted as cost until
            it is.
          </Banner>
        )}
        {head.outcome === 'PART_APPROVED' && (
          <Banner kind="brand" icon="½">
            {money(head.claimed_amount)} claimed, <b>{money(head.approved_amount)}</b> allowed.
            {head.decision_note && <> {head.decision_note}</>}
          </Banner>
        )}
        {['REJECTED', 'RETURNED'].includes(head.status) && (
          <Banner kind="bad" icon="!">
            {head.status === 'REJECTED' ? 'Refused' : 'Sent back'}
            {head.decided_by_name && ` by ${head.decided_by_name}`}
            {head.decision_note && <> — {head.decision_note}</>}
          </Banner>
        )}

        <Card title="What happened to it">
          <div className="tw">
            <table>
              <thead>
                <tr><th>When</th><th>What</th><th className="rt">Amount</th>
                  <th>Who</th><th>Note</th></tr>
              </thead>
              <tbody>
                {events.map((ev) => (
                  <tr key={ev.id}>
                    <td>{dmy(ev.created_at)}</td>
                    <td><Outcome outcome={ev.action} /></td>
                    <td className="rt mono">{ev.amount == null ? '—' : money(ev.amount)}</td>
                    <td>{ev.by_name || '—'}</td>
                    <td style={{ color: 'var(--muted)' }}>{ev.note || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <p style={{ color: 'var(--muted)', fontSize: 12 }}>
          {head.paid_to && <>Paid to {head.paid_to}. </>}
          {head.bill_no && <>Bill {head.bill_no}. </>}
          Claimed by {head.raised_by_name || 'unknown'}
          {head.decided_by_name && <>, decided by {head.decided_by_name}</>}.
        </p>
      </Modal>
      {deciding && (
        <DecideForm head={head} onClose={() => setDeciding(false)}
          onDone={() => { reload(); onChanged(); }} />
      )}
    </>
  );
}

/* ===================================================================
   The register
   =================================================================== */
export default function Expenses() {
  const { branchId, siteId } = useApp();
  const [params, setParams] = useSearchParams();
  const [claiming, setClaiming] = useState(false);
  const [open, setOpen] = useState(null);
  const [tick, setTick] = useState(0);

  const get = (k, d = '') => params.get(k) ?? d;
  const set = (patch) => setParams((p) => {
    for (const [k, v] of Object.entries(patch)) {
      if (!v) p.delete(k); else p.set(k, String(v));
    }
    return p;
  }, { replace: true });

  const site = get('site', String(siteId || ''));
  const status = get('status', 'ALL');
  const { data: sites } = useApi(withBranch('/sites', branchId), [branchId]);
  const { data: categories } = useApi('/expenses/categories');

  const qs = new URLSearchParams({
    ...(branchId ? { branchId } : {}),
    ...(site ? { siteId: site } : {}),
    ...(get('category') ? { categoryId: get('category') } : {}),
    ...(get('from') ? { from: get('from') } : {}),
    ...(get('to') ? { to: get('to') } : {}),
    ...(get('q') ? { q: get('q') } : {}),
    status,
    sort: status === 'WAITING' ? 'waiting' : 'recent',
  }).toString();

  const { data, error, loading, reload } = useApi(
    `/expenses?${qs}`, [qs, tick]);
  const rows = data?.rows || [];
  const refresh = () => { setTick((t) => t + 1); reload(); };

  const grab = () => downloadCsv('expenses', [
    ['Document', 'Spent on', 'Site', 'Kind', 'What for', 'Paid to', 'Bill',
      'Claimed', 'Allowed', 'Counts as cost', 'Status', 'Claimed by', 'Decided by'],
    ...rows.map((r) => [
      r.doc_no, dmy(r.spent_on), r.site_name, r.category, r.description,
      r.paid_to || '', r.bill_no || '', r.claimed_amount,
      r.approved_amount ?? '', r.cost_amount, r.outcome,
      r.raised_by_name || '', r.decided_by_name || '',
    ]),
  ]);

  return (
    <>
      <PageHead title="Expenses"
        sub="What a site spends that never touches a shelf"
        actions={
          <div style={{ display: 'flex', gap: 9 }}>
            <button className="btn" onClick={grab} disabled={!rows.length}>Download</button>
            <button className="btn pri" onClick={() => setClaiming(true)} disabled={!site}>
              Claim an expense
            </button>
          </div>
        } />

      <div className="page-body">
        {error && <ErrorNote error={error} onRetry={reload} />}

        <Card>
          <div className="pad" style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <Field label="Site" hint={!site ? 'Pick one to claim against' : undefined}>
              <select className="inp" style={{ width: 220 }} value={site}
                onChange={(e) => set({ site: e.target.value })}>
                <option value="">Every site</option>
                {(sites || []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </Field>
            <Field label="Status">
              <select className="inp" style={{ width: 170 }} value={status}
                onChange={(e) => set({ status: e.target.value })}>
                <option value="ALL">Everything</option>
                <option value="WAITING">Waiting to be decided</option>
                <option value="MINE">Not sent yet</option>
                <option value="APPROVED">Approved</option>
                <option value="REJECTED">Refused</option>
                <option value="RETURNED">Sent back</option>
              </select>
            </Field>
            <Field label="Kind">
              <select className="inp" style={{ width: 190 }} value={get('category')}
                onChange={(e) => set({ category: e.target.value })}>
                <option value="">Every kind</option>
                {(categories || []).map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </Field>
            <Field label="From">
              <input className="inp" type="date" style={{ width: 150 }} value={get('from')}
                onChange={(e) => set({ from: e.target.value })} />
            </Field>
            <Field label="To">
              <input className="inp" type="date" style={{ width: 150 }} value={get('to')}
                onChange={(e) => set({ to: e.target.value })} />
            </Field>
            <Field label="Find">
              <input className="inp" style={{ width: 200 }} value={get('q')}
                placeholder="Document, description, payee"
                onChange={(e) => set({ q: e.target.value })} />
            </Field>
          </div>
        </Card>

        {loading || !data ? <Loading /> : (
          <>
            <div className="stats">
              <Stat n={data.totals.claims} label="claims" />
              <Stat n={money(data.totals.claimed)} label="claimed" />
              <Stat n={money(data.totals.approved)} label="allowed" tone="ok" />
              <Stat n={money(data.totals.disallowed)} label="disallowed"
                tone={data.totals.disallowed > 0 ? 'bad' : undefined} />
              <Stat n={money(data.totals.waiting)} label="waiting to be decided"
                tone={data.totals.waitingCount ? 'warn' : undefined} />
            </div>

            {data.totals.waitingCount > 0 && status !== 'WAITING' && (
              <Banner kind="warn" icon="…"
                action={<button className="btn sm" onClick={() => set({ status: 'WAITING' })}>
                  Show them
                </button>}>
                {data.totals.waitingCount} claim{data.totals.waitingCount === 1 ? '' : 's'}{' '}
                worth {money(data.totals.waiting)} {data.totals.waitingCount === 1 ? 'is' : 'are'}{' '}
                waiting to be decided. None of it counts as cost yet.
              </Banner>
            )}

            <Card title={`${rows.length} claim${rows.length === 1 ? '' : 's'}`}
              sub="Click one to see it, decide it, or send it on">
              <div className="tw">
                <table>
                  <thead>
                    <tr>
                      <th>Document</th><th>Spent on</th><th>Site</th><th>Kind</th>
                      <th>What for</th><th className="rt">Claimed</th>
                      <th className="rt">Allowed</th><th>Status</th><th>Claimed by</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.expense_id} style={{ cursor: 'pointer' }}
                        onClick={() => setOpen(r.expense_id)}>
                        <td className="mono" style={{ color: 'var(--brand-ink)' }}>{r.doc_no}</td>
                        <td>{dmy(r.spent_on)}</td>
                        <td>{r.site_name}</td>
                        <td>{r.category}</td>
                        <td>
                          {r.description}
                          {r.paid_to && (
                            <span style={{ color: 'var(--muted)' }}> · {r.paid_to}</span>
                          )}
                        </td>
                        <td className="rt mono">{money(r.claimed_amount)}</td>
                        <td className="rt mono">
                          {r.approved_amount == null
                            ? <span style={{ color: 'var(--muted)' }}>—</span>
                            : <b>{money(r.approved_amount)}</b>}
                        </td>
                        <td><Outcome outcome={r.outcome} /></td>
                        <td style={{ color: 'var(--muted)' }}>{r.raised_by_name || '—'}</td>
                      </tr>
                    ))}
                    {!rows.length && (
                      <tr><td colSpan={9}>
                        <Empty title="Nothing here">
                          {site
                            ? 'Claim an expense and it will appear, waiting to be decided.'
                            : 'Pick a site to claim against, or clear the filters.'}
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

      {claiming && (
        <ClaimForm siteId={site} categories={categories || []}
          onDone={refresh} onClose={() => setClaiming(false)} />
      )}
      {open && (
        <ExpenseCard id={open} onChanged={refresh} onClose={() => setOpen(null)} />
      )}
    </>
  );
}
