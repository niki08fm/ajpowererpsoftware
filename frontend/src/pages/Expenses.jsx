import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useApp, PageHead } from '../App';
import { api, money, dmy, today, canWrite, plural } from '../api';
import { downloadCsv } from '../download';
import {
  useApi, useToast, Card, Empty, Loading, ErrorNote, Banner, Field, Modal, Stat, Code, Status,
  DateField,
} from '../components/ui';
import { Icon } from '../components/icons';
import { expenseStatus, eventWord, eventTone } from '../vocab';

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
 * The site's GM decides claims, from Approvals or from here. A claim
 * waiting for that decision says whose desk it is on.
 *
 * Like every Site screen, this one is the site in the top bar's —
 * trial 1 carried its own site filter that could disagree with it.
 */
const Outcome = ({ outcome }) => <Status is={expenseStatus(outcome)} />;

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
      sub="It counts as the site's cost only once the site's GM approves it"
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
        <Field label="Kind of expense">
          <select className="inp" style={{ width: 220 }} value={f.categoryId}
            onChange={(e) => set({ categoryId: e.target.value })}>
            <option value="">Choose the kind…</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>
        <DateField label="Spent on" value={f.spentOn} max={today()}
          onChange={(e) => set({ spentOn: e.target.value })} />
        <Field label="Amount (₹)">
          <input className="inp rt mono" type="number" min="0" step="0.01" inputMode="decimal"
            style={{ width: 150 }} value={f.amount} placeholder="0.00"
            onChange={(e) => set({ amount: e.target.value })} />
        </Field>
      </div>
      <Field label="What it was for">
        <input className="inp" value={f.description}
          placeholder="e.g. Lorry from the central store to site, 2 trips"
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
      <Field label="Note">
        <input className="inp" value={f.note} placeholder="Optional"
          onChange={(e) => set({ note: e.target.value })} />
      </Field>
      <Banner kind="info">
        <b className="mono">{money(amount)}</b> claimed. The site's GM can allow all of it or part of it —
        only what is allowed counts as cost on the expense report.
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
          : action === 'REJECTED' ? `${head.doc_no} rejected` : `${head.doc_no} sent back to the site`,
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
      sub={`${head.site_name} · ${head.category} · spent ${dmy(head.spent_on)}`}
      onClose={onClose}
      footer={
        <>
          <button className="btn bad" disabled={busy || !note.trim()}
            onClick={() => decide('REJECTED')} title={!note.trim() ? 'Type the reason first' : 'Close the claim; nothing counts as cost'}>
            Reject
          </button>
          <button className="btn" disabled={busy || !note.trim()}
            onClick={() => decide('RETURNED')}
            title={!note.trim() ? 'Type what to fix first' : 'Return it to the site to change and send again'}>
            Send back
          </button>
          <span className="sp" />
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
          tone={over ? 'bad' : undefined} />
        <Stat n={money(Math.max(0, claimed - allowed))} label="disallowed" />
      </div>
      <Field label="Amount allowed (₹)" bad={over}
        hint={over ? 'More than the site claimed — that would be a new claim, not an approval'
          : cut ? 'Less than claimed, so this is a part-approval' : 'The full amount claimed'}>
        <input className="inp rt mono" type="number" min="0" step="0.01" max={claimed} inputMode="decimal"
          style={{ width: 180, ...(over ? { borderColor: 'var(--st-stop)' } : {}) }}
          value={amount} onChange={(e) => setAmount(e.target.value)} />
      </Field>
      <Field label="Reason"
        hint={needsReason
          ? 'Required — the site sees why it was cut'
          : 'Required to reject or send back; the site sees it'}>
        <input className="inp" value={note} placeholder="The site will see this"
          onChange={(e) => setNote(e.target.value)} />
      </Field>
      {head.paid_to && (
        <p style={{ color: 'var(--muted)', fontSize: 12 }}>
          Paid to {head.paid_to}{head.bill_no ? ` · bill no. ${head.bill_no}` : ''}
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
  if (loading || !data) return <Modal title="Expense claim" onClose={onClose}><Loading what="the claim" /></Modal>;
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
            {head.status === 'DRAFT' && canWrite('/expenses') && (
              <button className="btn pri" onClick={() => act('submit', 'sent for approval')}>
                Send for approval
              </button>
            )}
            {head.status === 'RETURNED' && canWrite('/expenses') && (
              <button className="btn pri" onClick={() => act('submit', 'sent for approval again')}>
                Send for approval again
              </button>
            )}
            {canWithdraw && canWrite('/expenses') && (
              <button className="btn" onClick={() => act('withdraw', 'withdrawn to draft')}
                title="Take it back from the GM to change it">
                Withdraw
              </button>
            )}
            {canDecide && canWrite(`/expenses/${head.expense_id}/decide`) && (
              <button className="btn pri" onClick={() => setDeciding(true)}>Decide claim</button>
            )}
          </>
        }>
        <p style={{ margin: '0 0 12px', fontSize: 15 }}>{head.description}</p>

        <div className="stats">
          <Stat n={money(head.claimed_amount)} label="claimed" />
          <Stat n={head.approved_amount == null ? '—' : money(head.approved_amount)}
            label="allowed"
          />
          <Stat n={money(head.cost_amount)} label="counts as cost" />
          <Stat n={money(head.disallowed_amount)} label="disallowed" />
        </div>

        {head.status === 'SUBMITTED' && (
          <Banner kind="info" icon="clock">
            With the site's GM for a decision{head.days_waiting > 0 && ` — ${plural(head.days_waiting, 'day')} so far`}.
            Nothing counts as cost until it is decided.
          </Banner>
        )}
        {head.outcome === 'PART_APPROVED' && (
          <Banner kind="info">
            {money(head.claimed_amount)} claimed, <b>{money(head.approved_amount)}</b> allowed.
            {head.decision_note && <> {head.decision_note}</>}
          </Banner>
        )}
        {['REJECTED', 'RETURNED'].includes(head.status) && (
          <Banner kind={head.status === 'REJECTED' ? 'bad' : 'warn'}>
            {head.status === 'REJECTED' ? 'Rejected' : 'Sent back to the site — change it and send it for approval again'}
            {head.decided_by_name && ` by ${head.decided_by_name}`}
            {head.decision_note && <> — {head.decision_note}</>}
          </Banner>
        )}

        <Card title="History">
          <div className="tw">
            <table>
              <thead>
                <tr><th>When</th><th>What happened</th><th className="rt">Amount</th>
                  <th>By</th><th>Note</th></tr>
              </thead>
              <tbody>
                {events.map((ev) => (
                  <tr key={ev.id}>
                    <td className="mono">{dmy(ev.created_at)}</td>
                    <td><Status tone={eventTone(ev.action)} label={eventWord(ev.action)} /></td>
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
          {head.bill_no && <>Bill no. {head.bill_no}. </>}
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
  const { site: here } = useApp();
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

  // the site in the top bar, always — one site, said once
  const site = here ? String(here.id) : '';
  const status = get('status', 'ALL');
  const { data: categories } = useApi('/expenses/categories');

  const qs = new URLSearchParams({
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
    ['Claim', 'Spent on', 'Site', 'Kind', 'What for', 'Paid to', 'Bill no.',
      'Claimed', 'Allowed', 'Counts as cost', 'Status', 'Claimed by', 'Decided by'],
    ...rows.map((r) => [
      r.doc_no, dmy(r.spent_on), r.site_name, r.category, r.description,
      r.paid_to || '', r.bill_no || '', r.claimed_amount,
      r.approved_amount ?? '', r.cost_amount, expenseStatus(r.outcome).label,
      r.raised_by_name || '', r.decided_by_name || '',
    ]),
  ]);

  return (
    <>
      <PageHead title="Expenses"
        sub={`Money ${here ? here.name : 'the site'} spends that never goes into stock. It counts as cost only once the GM approves it.`}
        actions={
          <>
            <button className="btn" onClick={grab} disabled={!rows.length}><Icon name="download" size={14} />Download</button>
            {canWrite('/expenses') && (
              <button className="btn pri" onClick={() => setClaiming(true)} disabled={!site}>
                <Icon name="plus" />Claim an expense
              </button>
            )}
          </>
        } />

      <div className="page-body">
        {error && <ErrorNote error={error} onRetry={reload} />}

        <Card>
          <div className="pad searchbar" style={{ marginBottom: 0 }}>
            <Field label="Status">
              <select className="inp" style={{ width: 200 }} value={status}
                onChange={(e) => set({ status: e.target.value })}>
                <option value="ALL">Everything</option>
                <option value="WAITING">With GM for a decision</option>
                <option value="MINE">Drafts (not sent)</option>
                <option value="APPROVED">Approved (in full or part)</option>
                <option value="REJECTED">Rejected</option>
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
              <input className="inp" type="search" style={{ width: 220 }} value={get('q')}
                placeholder="Claim number, description, payee…"
                onChange={(e) => set({ q: e.target.value })} />
            </Field>
          </div>
        </Card>

        {loading && !data ? <Loading what="expense claims" /> : data && (
          <>
            <div className="stats" style={{ margin: '16px 0' }}>
              <Stat n={data.totals.claims} label="claims" one="claim" />
              <Stat n={money(data.totals.claimed)} label="claimed" />
              <Stat n={money(data.totals.approved)} label="allowed" />
              <Stat n={money(data.totals.disallowed)} label="disallowed" />
              <Stat n={money(data.totals.waiting)} label="with GM for a decision" />
            </div>

            {data.totals.waitingCount > 0 && status !== 'WAITING' && (
              <Banner kind="info" icon="clock"
                action={<button className="btn sm" onClick={() => set({ status: 'WAITING' })}>
                  Show them
                </button>}>
                {plural(data.totals.waitingCount, 'claim')} worth {money(data.totals.waiting)}{' '}
                {data.totals.waitingCount === 1 ? 'is' : 'are'} with the GM for a decision. None of it counts as cost yet.
              </Banner>
            )}

            <Card title={plural(rows.length, 'claim')}
              sub="Select a claim to see it, decide it, or send it for approval">
              <div className="tw">
                <table>
                  <thead>
                    <tr>
                      <th>Claim</th><th>Spent on</th><th>Site</th><th>Kind</th>
                      <th>What for</th><th className="rt">Claimed</th>
                      <th className="rt">Allowed</th><th>Status</th><th>Claimed by</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.expense_id} className="click" tabIndex={0}
                        onClick={() => setOpen(r.expense_id)}
                        onKeyDown={(e) => { if (e.key === 'Enter') setOpen(r.expense_id); }}>
                        <td><Code as="b">{r.doc_no}</Code></td>
                        <td className="mono">{dmy(r.spent_on)}</td>
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
                        <Empty title={status === 'ALL' ? 'No expense claims yet' : 'No claim matches these filters'}>
                          {status === 'ALL'
                            ? 'Claim an expense and it appears here, with the GM for a decision.'
                            : 'Clear the filters to see every claim.'}
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
