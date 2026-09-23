/**
 * The words the app uses, in one place.
 *
 * Every screen used to keep its own map of statuses, and they drifted:
 * the same challan was "On the road" on one screen and "On the way" on
 * another; "Waiting" was grey on PRNs and amber on expenses; an approved
 * PRN with no order yet was red, the colour of an error. A person reads
 * a colour before a word, so two colours for one state reads as two
 * states.
 *
 * So: one glossary (the company's own paper words — see the process
 * deck), one status vocabulary per document, and five tones that each
 * mean one thing wherever they appear:
 *
 *   neutral    not started, or not sent — nobody is waiting on it
 *   info       with someone, moving — nothing for you to do
 *   attention  needs a person to act (sent back, short, late soon)
 *   done       finished
 *   stopped    rejected, cancelled, refused — it will not move again
 *
 * Every status carries words and an icon as well as its tone, so it
 * never rests on colour alone.
 */

/* ------------------------------------------------------------ glossary */
export const GLOSSARY = [
  {
    term: 'PRN',
    long: 'Requirement of materials',
    means: 'The site\'s request for material, raised against its BOQ. The GM approves it first, Management second. The store then sends it from stock or Procurement buys it.',
    not: 'Not an indent. On paper the store raises the indent; in this system the store\'s shortfall is Procurement\'s To buy list.',
  },
  {
    term: 'To buy',
    means: 'What Procurement still has to order: approved PRN quantities the central store cannot send from its own stock. The company\'s paper calls this the store indent.',
  },
  {
    term: 'Rate comparison',
    means: 'Quotes from several suppliers for the same items, compared on landed cost (rate, discount and freight). Approved twice before an order can be raised from it.',
  },
  {
    term: 'PO',
    long: 'Purchase order',
    means: 'The order to a supplier. It goes to the supplier only after two approvals. Not the client\'s work order.',
  },
  {
    term: 'GRN',
    long: 'Goods receipt note',
    means: 'The central store\'s record of what a supplier delivered against a purchase order. Only what is received goes on the shelf.',
  },
  {
    term: 'DC',
    long: 'Delivery challan',
    means: 'The document that goes on the lorry when the store dispatches material to a site. Until the site confirms receipt, the material is on the road and belongs to nobody\'s stock.',
  },
  {
    term: 'Dispatch',
    means: 'The store sending material to a site on a delivery challan.',
    not: 'Not "issue". Issue is what the site does with its own stock.',
  },
  {
    term: 'Confirm receipt',
    means: 'The site counting what came off the lorry and taking it into its own store. Anything short stays on the road until it is accounted for.',
    not: 'Not "approve" and not "sign". Approving is a manager\'s decision.',
  },
  {
    term: 'Issue to worker',
    means: 'The site\'s store keeper handing material to a named person for use. That is when it counts as consumed.',
  },
  {
    term: 'Take back from worker',
    means: 'Unused material a worker brings back to the site store. It can never exceed what that person was issued.',
  },
  {
    term: 'Approve',
    means: 'A manager\'s decision on a document. BOQs, PRNs, rate comparisons, purchase orders and bills are approved twice: level 1 by the site\'s GM, level 2 by Management — never the same person twice.',
  },
  {
    term: 'Send back',
    means: 'An approver returning a document to whoever raised it, with a reason. It can be changed and sent for approval again.',
    not: 'Not a material return.',
  },
  {
    term: 'Reject',
    means: 'An approver ending a request for good (expense claims and transfer requests). It cannot be sent again.',
  },
  {
    term: 'BOQ',
    long: 'Bill of quantities',
    means: 'The items each work order line needs, and the quantity estimated. Every PRN is measured against it.',
  },
  {
    term: 'WO',
    long: 'Work order',
    means: 'What the client agreed to pay for, line by line, at agreed rates. Locked once loaded.',
  },
  {
    term: 'RA bill',
    long: 'Running account bill',
    means: 'A bill to the client against the work order, numbered RA 1, RA 2, RA 3 for each site.',
  },
  {
    term: 'Level 1 / level 2',
    means: 'The two approvals. Level 1 is the site\'s GM (or Management where there is no GM, such as an order delivered to the central store); level 2 is Management.',
  },
];

/* --------------------------------------------------------------- tones */
export const TONES = ['neutral', 'info', 'attention', 'done', 'stopped'];
const ICON_FOR = {
  neutral: 'draft', info: 'clock', attention: 'alert', done: 'check', stopped: 'stop',
};
export const iconForTone = (tone) => ICON_FOR[tone] || 'draft';

/** A status: tone, the word on the badge, and a sentence behind it. */
const s = (tone, label, hint, icon) => ({ tone, label, hint, icon: icon || ICON_FOR[tone] });

/* ------------------------------------------------------------- the PRN */

/** Where the paperwork is: whose desk, which level. */
export function prnApproval(r) {
  switch (r.status) {
    case 'DRAFT':
      return s('neutral', 'Draft', 'Not sent for approval. Nobody else is waiting on it.');
    case 'SUBMITTED': {
      // a list row carries waiting_on; an opened PRN carries its approval trail
      const on = r.waiting_on || r.waitingOn || r.approval?.waitingOn;
      const level = Number(r.approval_level || r.approval?.level) || (on === 'GM' ? 1 : 2);
      const names = r.approval?.waitingOnNames?.join(' or ');
      if (on === 'GM') {
        return s('info', 'With GM', `Waiting for ${r.gm_name || r.gmName || names || 'the site GM'} to approve · level 1 of 2`);
      }
      return s('info', 'With Management', level === 1
        ? 'This site has no GM, so Management approves both levels · level 1 of 2'
        : `Level 1 approved. Waiting for ${names || 'Management'} · level 2 of 2`);
    }
    case 'RETURNED':
      return s('attention', 'Sent back',
        r.sent_back_by
          ? `Sent back by ${r.sent_back_by}${r.sent_back_note ? `: “${r.sent_back_note}”` : ''}. Change it and send it again.`
          : 'Sent back to the site. Change it and send it again.');
    case 'APPROVED':
      return s('done', 'Approved', 'Both approvals done.');
    case 'REJECTED':
      return s('stopped', 'Rejected', 'It will not go any further.');
    case 'CANCELLED':
      return s('stopped', 'Cancelled', 'It will not go any further.');
    default:
      return s('neutral', r.status || '—');
  }
}

/** Where the material is — separate from the paperwork on purpose. */
export const PRN_STAGE = {
  NOT_APPROVED: s('neutral', 'Not started', 'Nothing moves until the PRN is approved.', 'draft'),
  AWAITING_PO: s('info', 'Nothing sent yet', 'Approved. The store sends it from stock, or Procurement orders it.', 'clock'),
  PO_WITH_GM: s('info', 'Order awaiting approval', 'A purchase order is raised and waiting for its approvals.', 'clock'),
  PART_ORDERED: s('info', 'Partly ordered', 'Some of it is on a purchase order; the rest is still to buy.', 'cart'),
  ORDERED: s('info', 'Ordered', 'On a purchase order with the supplier. Not yet at the store.', 'cart'),
  PART_RECEIVED: s('info', 'Partly at central store', 'Some has reached the central store; the rest is still with the supplier.', 'store'),
  AT_STORE: s('info', 'At central store', 'Received at the central store. Not yet dispatched to the site.', 'store'),
  IN_TRANSIT: s('info', 'On the road', 'Dispatched on a delivery challan. The site has not confirmed receipt yet.', 'truck'),
  PART_AT_SITE: s('info', 'Partly at site', 'Some of it has been received at site; the rest is still to come.', 'pin'),
  AT_SITE: s('done', 'Received at site', 'Everything asked for is in the site\'s store.', 'check'),
};
export const prnStage = (stage) => PRN_STAGE[stage] || s('neutral', stage || '—');

/** The journey a PRN's material takes, in order, for the tracker. */
export const PRN_JOURNEY = [
  { key: 'AWAITING_PO', label: 'Approved' },
  { key: 'PO_WITH_GM', label: 'Order approval' },
  { key: 'ORDERED', label: 'Ordered' },
  { key: 'AT_STORE', label: 'At central store' },
  { key: 'IN_TRANSIT', label: 'On the road' },
  { key: 'AT_SITE', label: 'Received at site' },
];
export const PRN_JOURNEY_AT = {
  NOT_APPROVED: -1, AWAITING_PO: 0, PO_WITH_GM: 1, PART_ORDERED: 2, ORDERED: 2,
  PART_RECEIVED: 3, AT_STORE: 3, IN_TRANSIT: 4, PART_AT_SITE: 5, AT_SITE: 5,
};
export const PRN_JOURNEY_PARTLY = ['PART_ORDERED', 'PART_RECEIVED', 'PART_AT_SITE'];

/* ------------------------------------------------------ purchase order */
export const PO_STAGE = {
  DRAFT: s('neutral', 'Draft', 'Not sent for approval.'),
  AWAITING_GM: s('info', 'Awaiting approval', 'Waiting for its two approvals. It goes to the supplier after both.'),
  RETURNED: s('attention', 'Sent back', 'Sent back to Procurement. Change it and send it again.'),
  AWAITING: s('info', 'Awaiting delivery', 'Approved and with the supplier. Nothing received yet.', 'truck'),
  PARTIAL: s('info', 'Partly received', 'Some of the order has been received; the rest is still owed.', 'truck'),
  RECEIVED: s('done', 'Received in full', 'Everything ordered has been received.'),
  CANCELLED: s('stopped', 'Cancelled', 'It will not go any further.'),
};
export const poStage = (k) => PO_STAGE[k] || s('neutral', k || '—');

/* -------------------------------------------------- delivery challan */
export const DC_STATE = {
  DRAFT: s('neutral', 'Draft', 'Not dispatched yet.'),
  IN_TRANSIT: s('info', 'On the road', 'Dispatched. Waiting for the site to confirm receipt.', 'truck'),
  PART_ACK: s('attention', 'Partly received', 'The site received part of it. The rest is unaccounted for.'),
  ACKNOWLEDGED: s('done', 'Received in full', 'The site confirmed receipt of everything on it.'),
  CANCELLED: s('stopped', 'Cancelled', 'It will not go any further.'),
  IN_STOCK: s('done', 'In stock', 'On the shelf.'),
};
export const dcState = (k) => DC_STATE[k] || s('neutral', k || '—');

/* ------------------------------------------------------ expense claim */
export const EXPENSE_STATUS = {
  DRAFT: s('neutral', 'Draft', 'Not sent for approval.'),
  SUBMITTED: s('info', 'With GM', 'Waiting for the site\'s GM to decide.'),
  APPROVED: s('done', 'Approved', 'Allowed in full. It counts as cost.'),
  PART_APPROVED: s('done', 'Part-approved', 'Part of it was allowed. Only that part counts as cost.'),
  NIL_APPROVED: s('stopped', 'Nothing allowed', 'None of it counts as cost.'),
  REJECTED: s('stopped', 'Rejected', 'Not allowed. It cannot be sent again.'),
  RETURNED: s('attention', 'Sent back', 'Sent back to the site. Change it and send it again.'),
};
export const expenseStatus = (k) => EXPENSE_STATUS[k] || s('neutral', k || '—');

/* ---------------------------------------------------------------- bill */
export const BILL_STATUS = {
  DRAFT: s('neutral', 'Draft', 'Not sent for approval.'),
  SUBMITTED: s('info', 'Awaiting approval', 'Waiting for its two approvals. It is not revenue until both are done.'),
  RAISED: s('done', 'Raised', 'Approved and issued to the client. It counts as revenue.'),
  CANCELLED: s('stopped', 'Cancelled', 'It will not go any further.'),
};
export const billStatus = (k) => BILL_STATUS[k] || s('neutral', k || '—');

/* ------------------------------------------------- site-to-site transfer */
export const TRANSFER_STATE = {
  AWAITING: s('info', 'Waiting for the other site', 'The site asked to send has not answered yet.'),
  TO_SEND: s('attention', 'Accepted — to send', 'The other site agreed. It still has to dispatch it.'),
  PART_SENT: s('info', 'Partly sent', 'Some of it is on a challan; the rest is still to send.', 'truck'),
  IN_TRANSIT: s('info', 'On the road', 'Dispatched. Waiting for the receiving site to confirm receipt.', 'truck'),
  COMPLETE: s('done', 'Done', 'Sent and received in full.'),
  REJECTED: s('stopped', 'Rejected', 'The other site will not send it.'),
  CANCELLED: s('stopped', 'Cancelled', 'It will not go any further.'),
};
export const transferState = (k) => TRANSFER_STATE[k] || s('neutral', k || '—');

/* -------------------------------------------- history: what happened */
const EVENT = {
  CREATED: 'Created',
  EDITED: 'Changed',
  SUBMITTED: 'Sent for approval',
  GM_APPROVED: 'Approved · level 1',
  APPROVED: 'Approved',
  PART_APPROVED: 'Part-approved',
  RETURNED: 'Sent back',
  REJECTED: 'Rejected',
  CANCELLED: 'Cancelled',
  DECIDED: 'Supplier chosen',
  RAISED: 'Raised',
  LOCKED: 'Locked',
  DISPATCHED: 'Dispatched',
  ACKNOWLEDGED: 'Receipt confirmed',
  PART_ACK: 'Part received',
  ACCEPTED: 'Accepted',
  REOPENED: 'Reopened',
  AMENDED: 'Amended',
};
const EVENT_TONE = {
  APPROVED: 'done', GM_APPROVED: 'done', PART_APPROVED: 'done', RAISED: 'done', ACCEPTED: 'done',
  ACKNOWLEDGED: 'done', LOCKED: 'done',
  RETURNED: 'attention', REJECTED: 'stopped', CANCELLED: 'stopped',
};
/** A history row: "Sent back", not SENT_BACK. */
export const eventWord = (action, level) => {
  if (action === 'APPROVED' && level) return `Approved · level ${level}`;
  return EVENT[action] || (action ? action.charAt(0) + action.slice(1).toLowerCase().replace(/_/g, ' ') : '—');
};
export const eventTone = (action) => EVENT_TONE[action] || 'neutral';

/* ----------------------------------------- who has it: said in words */
/**
 * "With Kavya Reddy (GM) · level 1 of 2", from an approval trail as the
 * API returns it, or null when nobody is waiting.
 */
export function withWhom(approval) {
  if (!approval || approval.status !== 'PENDING') return null;
  const names = approval.waitingOnNames || [];
  const desk = approval.waitingOn === 'GM' ? 'GM' : 'Management';
  const who = names.length === 1 ? `${names[0]} (${desk})`
    : names.length > 1 ? `${desk} (${names.join(' or ')})` : desk;
  return { who, level: approval.level, levels: approval.levels, desk };
}
