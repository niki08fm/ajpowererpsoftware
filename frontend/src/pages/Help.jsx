import { Link } from 'react-router-dom';
import { PageHead } from '../App';
import { Card } from '../components/ui';
import { Icon } from '../components/icons';
import { GLOSSARY } from '../vocab';

/**
 * How work moves through the company, department by department — the
 * project execution process from the company's own deck, drawn as the
 * documents that carry it. Each one links to the screen where it lives.
 */
const LANES = [
  {
    who: 'Planning',
    docs: [
      { name: 'Work order (WO)', note: 'What the client agreed to pay for', to: '/sites' },
      { name: 'BOQ', note: 'Items per WO line · approved twice', to: '/boq' },
    ],
  },
  {
    who: 'Site',
    docs: [
      { name: 'PRN', note: 'Requirement of materials · approved twice', to: '/indents' },
    ],
  },
  {
    who: 'Store',
    docs: [
      { name: 'Stock check', note: 'In stock → dispatch; short → To buy', to: '/store/prns' },
    ],
  },
  {
    who: 'Procurement',
    docs: [
      { name: 'To buy', note: 'What the store cannot send', to: '/procurement' },
      { name: 'Rate comparison', note: 'Landed cost · approved twice', to: '/comparisons' },
      { name: 'Purchase order (PO)', note: 'Approved twice, then to the supplier', to: '/purchase-orders' },
    ],
  },
  {
    who: 'Store',
    docs: [
      { name: 'GRN', note: 'Receive from supplier', to: '/grns' },
      { name: 'Delivery challan (DC)', note: 'Dispatch to the site', to: '/challans' },
    ],
  },
  {
    who: 'Site',
    docs: [
      { name: 'Receive delivery', note: 'Confirm what came off the lorry', to: '/site/inbox' },
      { name: 'Issue to worker', note: 'Counts as consumed', to: '/site/issue' },
      { name: 'Take back from worker', note: 'Unused material returns', to: '/site/returns' },
    ],
  },
  {
    who: 'Billing',
    docs: [
      { name: 'RA bill', note: 'Against WO lines · approved twice', to: '/billing' },
    ],
  },
  {
    who: 'Reports',
    docs: [
      { name: 'Expense report', note: 'Consumed + approved expenses', to: '/reports/expense' },
      { name: 'Profit & loss', note: 'Billed revenue less cost', to: '/reports/pl' },
    ],
  },
];

export function HowWorkMoves() {
  return (
    <>
      <PageHead title="How work moves"
        sub="From the client's work order to the bill, as the documents that carry it. Select any document to open its screen." />
      <div className="page-body">
        <Card title="The project execution process"
          sub="Every document marked “approved twice” goes to the site's GM first (level 1) and Management second (level 2) — never the same person twice.">
          <div className="pad">
            <div className="flowmap">
              {LANES.map((lane, i) => (
                <div className="lane" key={`${lane.who}-${i}`}>
                  <b>{i + 1}. {lane.who}</b>
                  <div className="docs">
                    {lane.docs.map((d, j) => (
                      <span key={d.name} style={{ display: 'contents' }}>
                        {j > 0 && <Icon name="arrowRight" className="arrow" />}
                        <Link className="doc" to={d.to}>
                          <b>{d.name}</b>
                          <small>{d.note}</small>
                        </Link>
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </Card>

        <Card title="Two questions every PRN answers"
          sub="A PRN's list shows them in separate columns, because “approved” does not mean “arrived”.">
          <div className="pad" style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))' }}>
            <div>
              <b>Approval — where is the paperwork?</b>
              <p style={{ margin: '6px 0 0', color: 'var(--ink-2)' }}>
                Draft → With GM (level 1) → With Management (level 2) → Approved.
                Either approver can send it back with a reason; it then says so at the top of the PRN.
              </p>
            </div>
            <div>
              <b>Material — where is the stuff?</b>
              <p style={{ margin: '6px 0 0', color: 'var(--ink-2)' }}>
                Nothing sent yet → Order awaiting approval → Ordered → At central store →
                On the road → Received at site.
              </p>
            </div>
          </div>
        </Card>

        <p style={{ color: 'var(--muted)', fontSize: 13, marginTop: 16 }}>
          Accounts and HR are part of the company process but are not built into the system yet.{' '}
          <Link to="/help/glossary" className="linkish">See what each word means</Link>
        </p>
      </div>
    </>
  );
}

export function Glossary() {
  return (
    <>
      <PageHead title="Glossary"
        sub="One name for each thing, used the same way on every screen. These are the words on the company's own paperwork." />
      <div className="page-body">
        <Card>
          <dl className="gloss" style={{ margin: 0 }}>
            {GLOSSARY.map((g) => (
              <div className="g" key={g.term} id={g.term.toLowerCase().replace(/[^a-z]+/g, '-')}>
                <dt>{g.term}{g.long && <small>{g.long}</small>}</dt>
                <dd>
                  {g.means}
                  {g.not && <span className="not">{g.not}</span>}
                </dd>
              </div>
            ))}
          </dl>
        </Card>
      </div>
    </>
  );
}
