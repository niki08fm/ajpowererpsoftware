# API

Base `/api`. **No authentication yet** — that decision is deliberately
deferred. Send `X-User-Id: <id>` to act as a particular person; without
it the first user is assumed. It only decides whose name goes on a
document, nothing is checked.

Errors come back as `{ error: { code, message, detail? } }` with a
readable `message` — the database's own constraints are translated, so a
duplicate item name reads "Already in the master as WIR-0052", not
"ER_DUP_ENTRY".

## Who
| | |
|---|---|
| `GET /whoami` | the caller |
| `GET /users` | everyone, for a "working as" switcher |

## Masters
`GET /masters/branches` · `/uoms` · `/categories` · `/makes`
`GET /masters/users?department=Site`
`GET /masters/clients?branchId=1` · `POST /masters/clients`

## Items
| | |
|---|---|
| `GET /items?q=&categoryId=&type=&page=&pageSize=` | paged, server-side search |
| `GET /items/search?q=wire red 1.5` | typeahead; words in any order |
| `GET /items/:id` | one item with its approved makes |
| `POST /items` | code assigned from the category |
| `PATCH /items/:id` | |

`POST /items` refuses an exact duplicate with `409` and the existing
code. A word-order match is saved with a `warning` and the `similar`
items listed.

## Sites and stores
| | |
|---|---|
| `GET /sites?branchId=&includeClosed=` | with work order and BOQ state |
| `GET /sites/:id` | including the team |
| `POST /sites` | name, branch, client, head, keeper, **gm**, dates, addresses, team |
| `PATCH /sites/:id` | |
| `GET /sites/stores/list?branchId=` | branch warehouses |
| `POST /sites/stores` | |

A site records three people: `headUserId` runs it, `keeperUserId` keeps
its material, `gmUserId` is the one it answers to. All three are
required, and the database enforces the GM too — a row with
`site_type='SITE'` and no `gm_user_id` is refused. A store has none of
them but the keeper.

## Work orders
| | |
|---|---|
| `POST /work-orders/parse` | multipart `file` → parsed lines. Saves nothing |
| `POST /work-orders` | writes it, locked. One per site |
| `GET /work-orders/site/:siteId` | with values |

## BOQ
| | |
|---|---|
| `GET /boq?branchId=` | `{boqs, awaitingPreparation}` |
| `POST /boq/prepare` | `{workOrderId}` → opens or resumes the draft |
| `GET /boq/:id` | the sheet: WO lines each with their items |
| `PUT /boq/:id/wo-line/:woLineId` | `{estQty, items:[{itemId,makeId,itemQty,estQty?}]}` |
| `DELETE /boq/:id/wo-line/:woLineId` | take a line back off the sheet |
| `POST /boq/:id/submit` | `{overAllow, overPct}`; `overPct:0` + `overAllow:true` = no ceiling |
| `GET /boq/:id/over-lines` | what has been indented past its estimate |
| `GET /boq/:id/amend-sheet` | the BOQ grouped by work order line, ready to amend |
| `POST /boq/:id/amendments/preview` | the new numbers, saving nothing |
| `POST /boq/:id/amendments` | `{reason, lines:[{boqWoLineId,qty}]}` |
| `GET /boq/:id/amendments` | the trail, one entry per amendment |

An amendment is typed against a **work order line**, not against each
item. One number, and every item under it recomputes on the formula
preparation uses:

```
boq_qty = item_qty x (contracted qty + amendment)
est_qty = item_qty x (contracted est + amendment)
```

`work_order_lines.qty` is never touched — it is what the client signed.
The amendment accumulates on the BOQ's own copy of the line, so
`contracted_qty` and `qty` come back side by side and the sheet can say
"contracted 10, now 11". `qty` is negative for a cut; one that would
leave the line at nothing is refused.

`GET /boq/:id` returns `state` as `DRAFT`, `LOCKED` or `AMENDMENT_DUE`,
with `prepared` / `ofLines` / `remaining` for the counter at the top.

## Indents
| | |
|---|---|
| `GET /indents/sites?branchId=` | sites with a locked BOQ |
| `GET /indents/boq/:boqId/lines` | flat: every BOQ line with its figures |
| `GET /indents/boq/:boqId/sheet` | the BOQ grouped by work order line — what the screen uses |
| `POST /indents/evaluate` | dry run: over quantities and severity, before committing |
| `POST /indents` | `{...,send:false}` saves a cart, `send:true` submits it |
| `PUT /indents/:id` | edit while DRAFT or RETURNED; any subset of fields |
| `POST /indents/:id/submit` | cart → queue. This is when it starts holding quantity |
| `POST /indents/:id/decide` | `{action:'APPROVED'\|'RETURNED', note}` |
| `DELETE /indents/:id` | drafts only |
| `GET /indents?branchId=&siteId=` | `{drafts, indents}`, each with a `severity` |
| `GET /indents/:id` | lines, event trail, `canEdit` |

Status runs `DRAFT → SUBMITTED → APPROVED`, or back to `RETURNED`, which
is editable again. **Only `SUBMITTED` and `APPROVED` hold quantity.**

`severity` is `none`, `warn` (past the estimate, inside an agreed
ceiling) or `bad` (no ceiling was agreed, or the ceiling is passed).

Who may approve is open for now — the trail is recorded either way, so
nothing is lost by deciding later.

An indent is raised on the same sheet the BOQ was prepared on. The
column beside the estimate is `item_indented_qty` — what has already
been ordered for that item **anywhere on this BOQ**, not on that line.
The same switch prepared on 1a and on 2a is one switch to whoever buys
it, so a per-line balance was never the useful figure.

Once approved, `GET /indents/:id` returns `rolledUp: true` and a
`rollup` array: one row per item and make, quantities summed across
the lines it was raised against, with `boq_snos` naming them. That is
what Procurement and the store work from. The per-line breakdown stays
in `lines` so a variation can still be traced to where it came from.

## Suppliers
| | |
|---|---|
| `GET /suppliers?q=&makeId=&includeInactive=` | |
| `GET /suppliers/:id` | with the makes they carry |
| `POST /suppliers` · `PATCH /suppliers/:id` | code assigned, `SUP-0001` |

Same duplicate guard as the item master — "Polycab Distributors" and
"polycab  distributors." are one supplier, and the second is refused
with the first one's code.

## Procurement
| | |
|---|---|
| `GET /procurement/queue?branchId=&siteId=&q=&stage=&sort=` | approved indents and how far each has got |
| `POST /procurement/demand` | `{indentIds}` → one line per item, with what the store holds |

`stage` defaults to `OPEN` — anything still owing an order. The full
set is `AWAITING_PO`, `PART_ORDERED`, `ORDERED`, `PART_RECEIVED`,
`RECEIVED`, `ALL`. `sort` is `needed` (default), `raised`, `site` or
`value`.

`POST /procurement/demand` is the buying sheet. Several indents in, one
line per item out, each carrying `indentedQty`, `orderedQty`,
`toOrderQty`, and beside them `storeQty`, `storeRate` and
`lastPaidRate` — because the cheapest way to fill a requirement is
often not to buy it.

It also returns `deliverOptions`. Indents for **one** site may be
delivered to that site or to the store; indents for **more than one**
can only go to a store, and be issued on from there.

## Rate comparison
| | |
|---|---|
| `GET /comparisons?branchId=&status=&q=` | |
| `GET /comparisons/:id` | items, who is quoting, every rate, the landed totals |
| `POST /comparisons` | `{branchId, indentIds}` seeds it, or `{items}` directly |
| `POST /comparisons/:id/suppliers` | `{supplierId}` |
| `DELETE /comparisons/:id/suppliers/:csId` | |
| `PATCH /comparisons/:id/suppliers/:csId` | `{discountPct, freight, creditDays, note}` |
| `PUT /comparisons/:id/quotes` | the whole grid at once; `rate: null` clears one |
| `POST /comparisons/:id/decide` | `{supplierId, note}` |
| `POST /comparisons/:id/reopen` | unless an order already leans on it |
| `DELETE /comparisons/:id` | same condition |

**Landed cost.** A rate is not a price:

```
basic   = Σ rate × quantity
less    = basic × discount%
plus    = freight, charged on the whole consignment
landed  = basic − discount + freight
```

Discount and freight belong to the **quote**, not to a line — which is
what turns a rate into a price, and what makes the cheapest quote and
the cheapest buy regularly two different suppliers. The sheet reports
both: `best_quoted_supplier_name` and `best_landed_supplier_name`, with
`cheapestIsNotLowest` true when they differ.

Credit days are carried alongside rather than priced in. Forty-five
days against fifteen is a judgement a buyer makes differently in
different months, and folding it into one number would hide it.

**Choosing a dearer quote is allowed** — delivery, credit, a supplier
who actually turns up — but not silently: deciding against anyone other
than the cheapest landed is refused without a reason, and the reason
goes on the record. Choosing the cheapest needs no excuse.

A decided sheet stops taking rates. Raising a purchase order from it
carries `comparisonId`, and from then on the sheet cannot be reopened
or deleted.

## Purchase orders
| | |
|---|---|
| `GET /purchase-orders?branchId=&supplierId=&state=&overdue=&q=&sort=` | |
| `GET /purchase-orders/:id` | lines, the indents it covers, every receipt |
| `POST /purchase-orders` | `{supplierId, indentIds, deliverToId, poDate, lines, submit}` |
| `PUT /purchase-orders/:id` | edit while `DRAFT` or `RETURNED` |
| `POST /purchase-orders/:id/submit` | to the GM |
| `POST /purchase-orders/:id/decide` | `{action:'APPROVED'\|'RETURNED', note}` |
| `POST /purchase-orders/:id/cancel` | `{note}`, only before anything arrives |
| `DELETE /purchase-orders/:id` | drafts only |
| `GET /purchase-orders/:id/pending` | what is still owed, for whoever unloads it |
| `POST /purchase-orders/:id/receipts` | `{receiptDate, supplierDc, lines:[{poLineId, qty}]}` |
| `POST /purchase-orders/receipts/:id/confirm` | a drafted receipt |

**The signature.** A purchase order commits money, so the GM signs it
before it reaches a supplier:

```
DRAFT ──submit──► SUBMITTED ──┬─ APPROVED ──► delivery
  ▲                           │
  └────── RETURNED ◄──────────┘  with a remark, editable again
```

Returning without a remark is refused. A `RETURNED` order is the
buyer's again: edit it, resubmit it, or cancel it. Nothing is received
against an unsigned order.

`stage` is the one column that says where an order is, whether that is
a signature or a delivery: `DRAFT`, `AWAITING_GM`, `RETURNED`,
`AWAITING`, `PARTIAL`, `RECEIVED`, `CANCELLED`. Two shortcuts:
`PIPELINE` is everything signed with something still owed, `MINE` is
everything sitting with the buyer.

**No closing short.** A part-delivered order stays in the pipeline
until it is fully received. Cancelling is only possible before anything
has arrived.

A line cannot be ordered for more than the chosen indents are still
owed, and cannot be received for more than the order still owes. When a
returned order is edited, what it already holds is added back before
that cap is applied — otherwise an order would be refused for the
quantity it is itself responsible for.

**Holding versus ordered.** An order with the GM *holds* quantity, so
the same requirement cannot be ordered twice while he is looking at it,
but it is not *ordered* until it is signed. `committed_qty` is the
first, `ordered_qty` the second, and `to_order_qty` is what is left
after the first.

**The allocation.** One order answers several indents, so a line's
quantity is split across them — soonest needed first, capped at what
each is owed — and that split is *recorded*, in `po_line_indents`.
Receipts follow it in proportion: 70 of a 100 line received means each
indent has 70% of its share received. Which is what lets an indent
answer "how much of me was ordered, and how much has arrived".

**Stock.** A confirmed receipt writes to `stock_movements` at the
destination. A balance is the sum of those movements and is never
written down. `v_stock_balance` carries the quantity and the weighted
average of what it cost.

**The indent pipeline.** `GET /indents/:id` now also returns
`pipeline` (the stage), `flow` (per item: indented, ordered, received,
still owed) and `orders` (the purchase orders answering it). The stage
runs `AWAITING_PO → PO_WITH_GM → PART_ORDERED → ORDERED →
PART_RECEIVED → RECEIVED`, so a site can see its material is waiting on
a signature rather than on a supplier.

## Store — the central store

A branch may run several stores. Every endpoint here answers for **one
of them** — `storeId`, or the central one if none is named — and the
screens carry a store picker in the header, remembered the way the
branch is.

What is shared and what is not:

- **PRNs are everyone's.** Any store sees every PRN in the branch and
  may fulfil it. Only `can_send_qty` differs, because only the shelf
  you are standing on can answer it today.
- **Stock, movements and challans are one store's.** They are read for
  the store you are in; the challan list defaults to what this store
  sent, and widens to every store on request.
- **An order is signed for where it was sent.** A purchase order
  appears on the GRN desk of its destination and no other. Passing
  `atSiteId` that is not the order's `deliver_to_id` is refused, naming
  the store that should be signing. One store taking in another's
  delivery would land the stock on the wrong shelf and answer a PRN
  from a place the material never reached.

A site's own store is **not** one of these. It is in the Site
department below, keeps no rates, and holds only what the site has
signed for.

| | |
|---|---|
| `GET /store/stores?branchId=` | the stores you can stand in, each with what it holds and what it is owed |
| `GET /store/desk?branchId=&storeId=` | orders coming in, challans out unsigned, sites waiting, what the shelf holds |
| `GET /store/prns?branchId=&siteId=&q=&show=&sort=` | every PRN, until it is fully fulfilled |
| `GET /store/issue?branchId=&indentIds=1,2&storeId=` | the issue sheet for those PRNs (or `siteId=` for all of a site's) |
| `GET /store/stock?branchId=&q=&categoryId=&hideEmpty=&sort=` | the shelf, valued at the last rate paid |
| `GET /store/stock/:itemId?branchId=` | one item: balance and every movement |
| `GET /store/movements?branchId=&from=&to=&kind=&direction=&q=&itemId=` | the ledger, and the same movements gathered into `docs` |
| `GET /store/document/:refType/:refId` | what was in one challan or note, in one shape for both |

**PRNs stay until they are fulfilled.** `show=PENDING` (the default)
lists approved indents with anything still to deliver; one that has
fully arrived at its site falls off the list. Each row carries where it
has got to — `ordered_qty`, `received_qty`, `issued_qty`,
`in_transit_qty`, `at_site_qty`, `to_deliver_qty` — plus `can_send_qty`,
how much of what it still wants is on this shelf right now.

**The shelf is chosen, not assumed.** Every endpoint here defaults to
the branch's central store, but `storeId` names another — and the PRN
list's `can_send_qty` and the issue sheet's `storeQty` are then reckoned
against that shelf instead. The requirement does not move with it: what
a PRN is owed belongs to the site, not to whichever store answers it.
Only a `STORE` may be named; pointing `storeId` at a site is a 404.

**One challan goes to one site.** The issue sheet takes several PRNs at
once, but refuses a set spanning two sites and says which sites they
were. Several PRNs may ask for the same item: each keeps its own row,
because what is being answered matters, and `storeQty` is repeated so
it is plain the rows draw on one shelf.

| | |
|---|---|
| `GET /challans?branchId=&siteId=&state=&q=&from=&to=&sort=` | `state=PENDING` is everything still owing a signature |
| `GET /challans/:id` | lines, signatures, and `prns` — each PRN with its own progress |
| `POST /challans` | `{fromSiteId, toSiteId, dcDate, vehicleNo, dispatch, lines:[{indentId, itemId, qty}]}` |
| `POST /challans/:id/dispatch` | a draft leaves the store |
| `GET /challans/:id/pending`, `POST /challans/:id/acknowledge` | the site's, see below |

**Several PRNs, one line.** Two PRNs asking for the same item become
ONE line on the challan — a lorry carries boxes, not paperwork. The
split across them is recorded in `dc_line_indents`, which is what lets
each PRN say how much of itself has been sent. Naming `indentId` on a
line is the store issuing against its pending list and is checked
against what that PRN is still owed; leaving it out attributes the
quantity soonest-needed-first instead.

**Dispatch and acknowledgement are two events.**

```
DRAFT ──dispatch──► IN_TRANSIT ──┬─ PART_ACK ──► ACKNOWLEDGED
                                 └─ ACKNOWLEDGED
```

What is dispatched leaves the store at once — it is off its books
whatever happens next. What arrives becomes the site's only when the
site signs for it. The difference is **in transit**: it belongs to
nobody, and it stays on both screens until somebody accounts for it.
`v_dc_status.days_out` counts how long that has been true.

## GRN

| | |
|---|---|
| `GET /grns/desk?branchId=` | orders still owing this place, and the notes already raised |
| `GET /grns?branchId=&siteId=&poId=&supplierId=&itemId=&status=&from=&to=&q=&sort=` | the register |
| `GET /grns/:id` | lines, what the order still owes, the PRNs answered, the stock created |
| `GET /grns/item/:itemId` | every note that ever touched one item |
| `POST /purchase-orders/:id/receipts` | `{receiptDate, supplierDc, atSiteId, lines:[{poLineId, qty}]}` — acknowledging |
| `POST /grns/:id/confirm` | puts a drafted note's stock on the shelf |
| `DELETE /grns/:id` | drafts only |

**A GRN is not written separately.** It is what acknowledging a
delivery produces: you say what came off the lorry, the stock goes on
the shelf at the rate the order agreed, and the note exists — appearing
in the desk's history immediately. A *drafted* note is one that has not
happened yet: nothing is on the shelf and the order does not count it
received until it is confirmed.

**Rates follow the last purchase.** Because a receipt carries the rate
it was bought at, `v_stock_balance.latest_rate` is what the store's
items are worth the moment a new order lands. `avg_rate` is carried
alongside but the screens show the latest: a store that bought cable at
112 last week and 128 this week will be asked what the cable on the
floor is worth today, and the answer people act on is 128.

**Opening a document.** A movement line says a quantity moved; it does
not say what the lorry had on it. `GET /store/document/DC|GRN/:id`
answers that in one shape for both kinds — header, state, totals and
lines, plus the PRNs a challan answered or the order a note was raised
against, and an `href` through to the full document. The movement
screen opens it in place rather than navigating away from the window
being read. Any other `refType` is a 400.

**A challan reads like an order.** `GET /challans/:id` and
`GET /grns/:id` both return `events` — the appended-never-edited trail
from the audit log, each step with who and when. Together with `state`
that gives a challan the same four-step reading an order has: raised,
dispatched, being signed for, completed.

**Movement is read as documents.** `GET /store/movements` returns both
`rows` (the ledger) and `docs` (the same movements gathered back into
the GRNs and challans that caused them). A ledger line is a
consequence; the document is the thing that happened, and it is what a
storekeeper remembers. Each `doc` carries `refType`/`refId`, so the
screen links straight through to the note or the challan and the items
inside it.

## Site store

| | |
|---|---|
| `GET /site-store/:siteId/inbox` | everything waiting for this site's signature |
| `GET /site-store/:siteId/stock?q=&hideEmpty=&sort=` | the site's shelf — quantities, no rates |
| `GET /site-store/:siteId/stock/:itemId` | one item: how it got here |
| `GET /site-store/:siteId/movements?from=&to=&kind=&direction=&q=` | the site's ledger |

**Paper people can hand over.** A CSV is for a spreadsheet; a receipt
is for a person. Three documents print: the **GRN note**, which shows
what was received and nothing else — ordered and still-owed belong to
the order, and putting them on the note invites somebody to read a
number off it the note is not claiming; the **delivery challan**, which
shows sent, received at site and still pending; and the
**acknowledgement slip**, offered the moment a site signs, while the
driver is still standing there. `GET /challans/:id` returns each
signature's own lines for that reason — a slip has to say what was
counted off the lorry, not just how much.

**Acknowledgement belongs to the site.** Whatever is directed at a
site — a challan the store sent, or an order the buyer had delivered
straight to site — is that team's to receive, and the inbox is where
both appear. A site may sign for part of a challan; the rest stays
outstanding and the challan stays in the inbox until it is accounted
for. Signing for more than is outstanding is refused.

Acknowledging a challan writes `DC_IN` at the site. Acknowledging a
direct-to-site order raises a GRN there, through the same
`POST /purchase-orders/:id/receipts` the store uses — the action is
identical, only the place differs.

**The site's shelf keeps no rates.** The site never negotiated a price
and has no business quoting one, so the stock endpoint returns
quantities and omits `latest_rate` and `value` entirely. The central
store carries the valuation. The shelf also carries `incoming_qty` —
signed out of the store and not yet signed for here — including items
this site has never held, which would otherwise not appear at all.

**Received is not arrived.** An order delivered to a central store has
not met the site's requirement. `v_indent_item_flow` therefore carries
`issued_qty`, `in_transit_qty`, `at_site_qty` and `to_deliver_qty`
separately, and the PRN's own pipeline runs the whole distance:

```
NOT_APPROVED → AWAITING_PO → PO_WITH_GM → PART_ORDERED → ORDERED
             → PART_RECEIVED → AT_STORE → IN_TRANSIT → PART_AT_SITE → AT_SITE
```

Every proportional split in that view — one order line answering
several PRNs, one challan line answering several — is rounded to three
decimals, the precision quantities are stored at. 35 sent against a
15/20 split is 15 and 20, not 14.999999.

## Progress
| | |
|---|---|
| `GET /progress/site/:siteId` | the whole spine for one site, line by line |
| `GET /progress/desk?branchId=` | amendments due, work orders awaiting a BOQ, BOQ drafts, indents waiting |

`GET /progress/site/:id` returns, per BOQ line: `boq_qty`,
`effective_est`, `approved_qty`, `committed_qty`, `item_indented_qty`,
`balance` and `over_qty`. Every one of them derived.
