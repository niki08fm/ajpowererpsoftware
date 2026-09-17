import { useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp, PageHead } from '../App';
import { api, money, qty, today, ApiError } from '../api';
import { useApi, Card, Field, Banner, Empty, useToast, ClientPicker } from '../components/ui';

/**
 * Creating a site is two steps because that is how it happens: agree
 * who the project belongs to, then load the work order the client
 * signed. Neither half is useful without the other, so nothing is
 * written until both are done.
 */
const Steps = ({ step }) => (
  <div className="wiz">
    <div className={`s ${step === 1 ? 'on' : 'done'}`}><b>{step > 1 ? '✓' : '1'}</b><span>The project</span></div>
    <div className="ln" />
    <div className={`s ${step === 2 ? 'on' : ''}`}><b>2</b><span>The work order</span></div>
  </div>
);

const blankLine = (uom) => ({ description: '', uom, qty: '', supplyRate: '', instRate: '' });
const lineTotal = (l) => (Number(l.qty) || 0) * ((Number(l.supplyRate) || 0) + (Number(l.instRate) || 0));

export default function NewSite() {
  const { branchId, branches, users } = useApp();
  const nav = useNavigate();
  const toast = useToast();
  const fileRef = useRef(null);

  const { data: clients } = useApi(branchId ? `/masters/clients?branchId=${branchId}` : null, [branchId]);
  const { data: uoms } = useApi('/masters/uoms');
  const defaultUom = uoms?.find((u) => /^no/i.test(u.code))?.code || uoms?.[0]?.code || '';

  const [step, setStep] = useState(1);
  const [busy, setBusy] = useState(false);
  const [p, setP] = useState({
    name: '', clientId: '', headUserId: '', keeperUserId: '', gmUserId: '',
    location: '', billingAddress: '', startDate: today(), targetCompletion: '',
    clientWoNo: '', team: [],
  });
  const [lines, setLines] = useState([]);
  const [imported, setImported] = useState(null);
  const [hot, setHot] = useState(false);

  const set = (k) => (e) => setP((x) => ({ ...x, [k]: e.target.value }));
  const free = users.filter((u) => !p.team.includes(u.id)
    && u.id !== Number(p.headUserId) && u.id !== Number(p.keeperUserId)
    && u.id !== Number(p.gmUserId));

  const totals = useMemo(() => lines.reduce((a, l) => ({
    supply: a.supply + (Number(l.qty) || 0) * (Number(l.supplyRate) || 0),
    inst: a.inst + (Number(l.qty) || 0) * (Number(l.instRate) || 0),
  }), { supply: 0, inst: 0 }), [lines]);

  const next = () => {
    if (p.name.trim().length < 3) return toast('Give the site a name', 'bad');
    if (!p.clientId) return toast('Pick the client this site belongs to', 'bad');
    if (!p.headUserId) return toast('Choose the site head', 'bad');
    if (!p.keeperUserId) return toast('Choose the site storekeeper', 'bad');
    if (!p.gmUserId) return toast('Choose the general manager', 'bad');
    if (p.targetCompletion && p.startDate && p.targetCompletion < p.startDate) {
      return toast('Completion cannot be before the start date', 'bad');
    }
    if (!lines.length) setLines([blankLine(defaultUom)]);
    return setStep(2);
  };

  const readFile = async (file) => {
    if (!file) return;
    try {
      const r = await api.upload('/work-orders/parse', file);
      setImported(r);
    } catch (e) {
      toast(e.message, 'bad');
    }
  };

  const applyImport = (replace) => {
    const rows = imported.lines.map((l) => ({
      description: l.description, uom: l.uom,
      qty: l.qty || '', supplyRate: l.supplyRate || '', instRate: l.instRate || '',
    }));
    setLines(replace ? rows : lines.filter((l) => l.description.trim()).concat(rows));
    toast(`${rows.length} line(s) ${replace ? 'imported' : 'added'}`, 'ok');
    setImported(null);
  };

  const submit = async () => {
    const clean = lines.filter((l) => l.description.trim());
    if (!clean.length) return toast('Add at least one work order line', 'bad');
    const bad = clean.find((l) => !Number(l.qty) || (!Number(l.supplyRate) && !Number(l.instRate)));
    if (bad) return toast(`"${bad.description.slice(0, 40)}" needs a quantity and a rate`, 'bad');

    setBusy(true);
    try {
      const site = await api.post('/sites', {
        name: p.name.trim(), branchId, clientId: Number(p.clientId),
        headUserId: Number(p.headUserId), keeperUserId: Number(p.keeperUserId),
        gmUserId: Number(p.gmUserId),
        location: p.location || undefined, billingAddress: p.billingAddress || undefined,
        startDate: p.startDate || undefined, targetCompletion: p.targetCompletion || undefined,
        team: p.team,
      });
      await api.post('/work-orders', {
        siteId: site.id, clientWoNo: p.clientWoNo || undefined, woDate: p.startDate || today(),
        lines: clean.map((l) => ({
          description: l.description.trim(), uom: l.uom,
          qty: Number(l.qty), supplyRate: Number(l.supplyRate) || 0, instRate: Number(l.instRate) || 0,
        })),
      });
      toast(`${site.name} is live — ${site.code}`, 'ok');
      nav(`/planning/sites/${site.id}`);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Could not create the site', 'bad');
      setBusy(false);
    }
  };

  /* ------------------------------------------------------- step 1 */
  if (step === 1) {
    return (
      <>
        <PageHead title="New site" sub="Who the project belongs to, then the work order it runs on" />
        <div className="page-body">
          <Steps step={1} />
          <div className="grid2">
            <Card title="The project" sub="Who it is for, who runs it, and where it is">
              <div className="pad">
                <Field label="Site name" hint="Checked against every site you already have, ignoring case and punctuation.">
                  <input className="inp" value={p.name} onChange={set('name')} autoFocus
                    placeholder="e.g. GMR Aerocity — Block C" />
                </Field>
                <div className="row2">
                  <Field label="Client">
                    <ClientPicker value={p.clientId} branchId={branchId} branches={branches}
                      width={250}
                      onChange={(v) => setP((x) => ({ ...x, clientId: v }))} />
                  </Field>
                  <Field label="Client work order no.">
                    <input className="inp" value={p.clientWoNo} onChange={set('clientWoNo')}
                      placeholder="e.g. GMR/EL/2026/114" />
                  </Field>
                </div>
                <div className="row2">
                  <Field label="Site head" hint="Owns the site.">
                    <select className="inp" value={p.headUserId} onChange={set('headUserId')}>
                      <option value="">— choose —</option>
                      {users.map((u) => <option key={u.id} value={u.id}>{u.name} — {u.department}</option>)}
                    </select>
                  </Field>
                  <Field label="Site storekeeper" hint="Receives material and acknowledges challans.">
                    <select className="inp" value={p.keeperUserId} onChange={set('keeperUserId')}>
                      <option value="">— choose —</option>
                      {users.map((u) => <option key={u.id} value={u.id}>{u.name} — {u.department}</option>)}
                    </select>
                  </Field>
                </div>
                <Field label="General manager" hint="The person this project answers to.">
                  <select className="inp" value={p.gmUserId} onChange={set('gmUserId')}>
                    <option value="">— choose —</option>
                    {users.map((u) => <option key={u.id} value={u.id}>{u.name} — {u.department}</option>)}
                  </select>
                </Field>
                <Field label="Others on this project"
                  hint="Recorded now. What it controls is decided when we settle access.">
                  <div style={{ display: 'flex', gap: 8 }}>
                    <select className="inp" value="" onChange={(e) => {
                      const id = Number(e.target.value);
                      if (id) setP((x) => ({ ...x, team: [...x.team, id] }));
                    }}>
                      <option value="">— add a person —</option>
                      {free.map((u) => <option key={u.id} value={u.id}>{u.name} — {u.department}</option>)}
                    </select>
                  </div>
                  <div className="chips">
                    {p.team.length ? p.team.map((id) => {
                      const u = users.find((x) => x.id === id);
                      return (
                        <span className="chip" key={id}>
                          {u?.name}<small>{u?.department}</small>
                          <button type="button" title="Remove"
                            onClick={() => setP((x) => ({ ...x, team: x.team.filter((t) => t !== id) }))}>✕</button>
                        </span>
                      );
                    }) : <small style={{ color: 'var(--faint)' }}>Nobody added yet</small>}
                  </div>
                </Field>
                <Field label="Site location">
                  <input className="inp" value={p.location} onChange={set('location')} placeholder="where the work is" />
                </Field>
                <Field label="Billing address" hint="Printed on every client bill raised against this site.">
                  <textarea className="inp" rows={2} value={p.billingAddress} onChange={set('billingAddress')} />
                </Field>
                <div className="row2">
                  <Field label="Project start date">
                    <input className="inp" type="date" value={p.startDate} onChange={set('startDate')} />
                  </Field>
                  <Field label="Target completion">
                    <input className="inp" type="date" value={p.targetCompletion} onChange={set('targetCompletion')} />
                  </Field>
                </div>
              </div>
              <div style={{ padding: '0 18px 18px', display: 'flex', gap: 9, justifyContent: 'flex-end' }}>
                <button className="btn" onClick={() => nav('/planning/sites')}>Cancel</button>
                <button className="btn pri" onClick={next}>Add the work order</button>
              </div>
            </Card>

            <Card title="What happens next">
              <div className="pad">
                <Banner kind="info" icon="▤">
                  The work order is the contract. Once it is loaded, every quantity downstream — BOQ,
                  indent, purchase order, client bill — is measured against it, and it can only change
                  through an amendment.
                </Banner>
                <p style={{ color: 'var(--muted)', fontSize: 13, lineHeight: 1.6 }}>
                  You can type the lines, or drop the client's own spreadsheet in and let it read them.
                  Nothing is saved until you submit both steps together.
                </p>
              </div>
            </Card>
          </div>
        </div>
      </>
    );
  }

  /* ------------------------------------------------------- step 2 */
  const upd = (i, k, v) => setLines((ls) => ls.map((l, n) => (n === i ? { ...l, [k]: v } : l)));

  return (
    <>
      <PageHead title="New site" sub={p.name} />
      <div className="page-body">
        <Steps step={2} />
        <Banner kind="info" icon="▤"
          action={<button className="btn sm" onClick={() => setStep(1)}>Edit the project</button>}>
          <b>{p.name}</b> · {(clients || []).find((c) => c.id === Number(p.clientId))?.name}
          {p.clientWoNo ? ` · WO ${p.clientWoNo}` : ''}
        </Banner>

        <Card
          title="Work order lines"
          sub="Amounts are worked out for you — quantity × rate"
          actions={<button className="btn sm pri" onClick={() => setLines((l) => [...l, blankLine(defaultUom)])}>
            Add line
          </button>}
        >
          <div className="tw">
            <table className="sheet">
              <thead>
                <tr>
                  <th style={{ width: 48 }}>S.No</th>
                  <th style={{ minWidth: 260 }}>Line name</th>
                  <th style={{ width: 100 }}>Unit</th>
                  <th className="rt" style={{ width: 92 }}>Quantity</th>
                  <th className="rt" style={{ width: 108 }}>Supply rate</th>
                  <th className="rt" style={{ width: 118 }}>Supply amount</th>
                  <th className="rt" style={{ width: 108 }}>Inst. rate</th>
                  <th className="rt" style={{ width: 118 }}>Inst. amount</th>
                  <th className="rt" style={{ width: 120 }}>Line total</th>
                  <th style={{ width: 40 }} />
                </tr>
              </thead>
              <tbody>
                {lines.map((l, i) => (
                  <tr key={i}>
                    <td className="sn" style={{ color: 'var(--faint)' }}>{i + 1}</td>
                    <td>
                      <input className="inp" value={l.description} onChange={(e) => upd(i, 'description', e.target.value)}
                        placeholder="as written on the client work order" />
                    </td>
                    <td>
                      <select className="inp" value={l.uom} onChange={(e) => upd(i, 'uom', e.target.value)}>
                        {(uoms || []).map((u) => <option key={u.id} value={u.code}>{u.code}</option>)}
                      </select>
                    </td>
                    <td><input className="inp rt" type="number" min="0" step="any" value={l.qty}
                      onChange={(e) => upd(i, 'qty', e.target.value)} /></td>
                    <td><input className="inp rt" type="number" min="0" step="any" value={l.supplyRate}
                      onChange={(e) => upd(i, 'supplyRate', e.target.value)} /></td>
                    <td className="rt calc">{money((Number(l.qty) || 0) * (Number(l.supplyRate) || 0))}</td>
                    <td><input className="inp rt" type="number" min="0" step="any" value={l.instRate}
                      onChange={(e) => upd(i, 'instRate', e.target.value)} /></td>
                    <td className="rt calc">{money((Number(l.qty) || 0) * (Number(l.instRate) || 0))}</td>
                    <td className="rt mono"><b>{money(lineTotal(l))}</b></td>
                    <td>
                      <button className="btn sm bad" title="Remove line"
                        onClick={() => setLines((ls) => (ls.length > 1 ? ls.filter((_, n) => n !== i) : [blankLine(defaultUom)]))}>✕</button>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <th colSpan={5} className="rt">Totals</th>
                  <th className="rt mono">{money(totals.supply)}</th>
                  <th />
                  <th className="rt mono">{money(totals.inst)}</th>
                  <th className="rt mono">{money(totals.supply + totals.inst)}</th>
                  <th />
                </tr>
              </tfoot>
            </table>
          </div>
        </Card>

        <div className="grid2" style={{ marginTop: 16 }}>
          <Card title="Or drop the client's work order in" sub="Excel or CSV — one row per line">
            <div className="pad">
              <div className={`drop ${hot ? 'hot' : ''}`}
                onClick={() => fileRef.current?.click()}
                onDragOver={(e) => { e.preventDefault(); setHot(true); }}
                onDragLeave={() => setHot(false)}
                onDrop={(e) => { e.preventDefault(); setHot(false); readFile(e.dataTransfer.files?.[0]); }}>
                <b>Drop the work order file here</b>
                <small>or click to choose · .xlsx, .xls or .csv</small>
              </div>
              <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv,.txt" style={{ display: 'none' }}
                onChange={(e) => { readFile(e.target.files?.[0]); e.target.value = ''; }} />

              {imported && (
                <div style={{ marginTop: 12 }}>
                  <Banner kind="ok" icon="✓">
                    <b>{imported.lines.length} line(s)</b> read from {imported.sheet} — {money(imported.value)}.
                    {imported.incomplete > 0 && (
                      <><br /><small>{imported.incomplete} line(s) came in without a quantity or rate. They will
                      import, and you can fill them in before submitting.</small></>
                    )}
                    <div style={{ marginTop: 9, display: 'flex', gap: 8 }}>
                      <button className="btn sm pri" onClick={() => applyImport(true)}>Replace the lines</button>
                      <button className="btn sm" onClick={() => applyImport(false)}>Add to what's there</button>
                      <button className="btn sm" onClick={() => setImported(null)}>Cancel</button>
                    </div>
                  </Banner>
                  <div className="tw" style={{ maxHeight: 220, overflow: 'auto' }}>
                    <table>
                      <thead><tr><th>#</th><th>Line name</th><th>Unit</th><th className="rt">Qty</th><th className="rt">Supply</th></tr></thead>
                      <tbody>
                        {imported.lines.slice(0, 30).map((l) => (
                          <tr key={l.sno}>
                            <td className="sn">{l.sno}</td><td>{l.description}</td><td>{l.uom}</td>
                            <td className="rt mono">{qty(l.qty)}</td><td className="rt mono">{money(l.supplyRate)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {imported.lines.length > 30 && <Empty title={`and ${imported.lines.length - 30} more`} />}
                  </div>
                </div>
              )}
            </div>
          </Card>

          <Card title="What the columns should say">
            <div className="pad" style={{ fontSize: 12.5 }}>
              <p style={{ color: 'var(--muted)', marginTop: 0 }}>
                Headers are matched on their wording, so the client's own sheet usually works untouched.
                Anything it doesn't recognise is left blank for you to fill in.
              </p>
              <table>
                <tbody>
                  <tr><td><b>Line name</b></td><td style={{ color: 'var(--muted)' }}>description, particulars, item, scope of work</td></tr>
                  <tr><td><b>Unit</b></td><td style={{ color: 'var(--muted)' }}>unit, uom</td></tr>
                  <tr><td><b>Quantity</b></td><td style={{ color: 'var(--muted)' }}>qty, quantity</td></tr>
                  <tr><td><b>Supply rate</b></td><td style={{ color: 'var(--muted)' }}>supply rate, material rate</td></tr>
                  <tr><td><b>Inst. rate</b></td><td style={{ color: 'var(--muted)' }}>installation, erection, labour rate</td></tr>
                </tbody>
              </table>
            </div>
          </Card>
        </div>

        <Card className="" >
          <div className="pad" style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
            <div>
              <b>Work order value</b>
              <div style={{ color: 'var(--muted)', fontSize: 12.5 }}>
                {lines.filter((l) => l.description.trim()).length} line(s) · supply {money(totals.supply)} · installation {money(totals.inst)}
              </div>
            </div>
            <div style={{ flex: 1 }} />
            <div className="num" style={{ fontSize: 22 }}>{money(totals.supply + totals.inst)}</div>
            <button className="btn" onClick={() => setStep(1)}>Back</button>
            <button className="btn pri" onClick={submit} disabled={busy}>
              {busy ? 'Creating…' : 'Create the site'}
            </button>
          </div>
        </Card>
      </div>
    </>
  );
}
