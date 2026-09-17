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

A client has to exist before a site can belong to one, and the only
moment anybody notices one is missing is halfway through creating the
site. So the picker adds to itself — `ClientPicker` in the UI offers
"+ Add a client", takes a name, GSTIN and branch, and selects the new
client when the dialog closes. Nothing typed into the site is lost.

`POST /masters/clients` refuses a duplicate with `409` and returns the
existing client's id in `detail.clientId`; the picker selects that one
rather than making the user read an error and go looking for it.

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

`std_rate` is still stored and still returned, but **no screen outside
Procure displays it**. The item master, goods receipts and delivery
challans show quantities only; the store keeps its own stocktaking
total and nothing per item. Rates appear on the buying sheet
(`POST /procurement/demand` returns `storeRate`, `lastPaidRate` and
`suggestedRate` per line), the rate comparison and the purchase order.

This is a choice about which screens render what — not access control.
There is no authentication yet, so the API returns these fields to any
caller and anyone may open Procure.

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

## Consumption — issue and return

| | |
|---|---|
| `POST /consumption/issues` | issue material to a person; confirmed at once |
| `GET /consumption/issues` | the register — `siteId` `person` `itemId` `from` `to` `q` |
| `GET /consumption/issues/:id` | one slip, its lines and anything returned against it |
| `POST /consumption/returns` | material back on the shelf, cost reversed |
| `GET /consumption/returns` | the return register, same filters |
| `GET /consumption/returns/:id` | one return and its lines |
| `GET /consumption/issuable/:siteId` | what this site holds, priced the way an issue will price it |
| `GET /consumption/returnable/:siteId` | what one person took and has not brought back — `?person=` |
| `GET /consumption/people/:siteId` | names this site has issued to; `?outstanding=true` for only those still holding something |

This is the last hop. Everything before it moves material between
places that are answerable for it; this moves it into a person's
hands, which is where it stops being stock and becomes cost.

**An issue names an item, not a BOQ line.** Asking a storekeeper which
BOQ line a coil of wire belongs to, while somebody stands in front of
him waiting for it, is how you get a system nobody uses.
`consumption_lines.boq_line_id` is kept and NULL-able so that link can
be switched on later without moving any data — until it is, a BOQ
line's `consumed_qty` counts only rows that carry one.

**An issue names a person by hand.** There is no site login yet and
the people drawing material are often not system users at all.
`issued_to_user_id` is reserved for when site attendance arrives; the
typed name is the record, and it is what the audit searches on.
`GET /consumption/people/:siteId` exists so the second issue to Ramesh
is a click rather than a fresh spelling.

**The costing rule.** A day's cost for an item is that day's *net*
quantity — issued less returned — times what the central store was
holding that item at *on that day*. Cost to date is those days added
up. Two switches out and one back on a ten-rupee day is ₹10; ten out
and four back on an eleven-rupee day is ₹66.

Both sides of a day are therefore struck at the same price. A return
is *not* credited at what the material went out at last month — it is
credited at today's rate, exactly as an issue is charged at today's
rate.

**Rates are stamped, not looked up.** This is the one place the schema
writes down a number it could derive, deliberately: the line carries
the rate that was in force when it moved. An expense report whose past
changes every time the store buys cable at a new price is not a report.

And "in force when it moved" means as at the *document's* date, not as
at now. A slip written up late and dated last Tuesday prices at last
Tuesday's rate — otherwise backdating silently reprices it. Every
lookup in `lib/rates.js` is bounded by the asking document's date, and
`GET /consumption/issuable/:siteId?asOf=` quotes the same number the
save will stamp, so the screen never shows one price and record
another.

`lib/rates.js` looks in four places, in the order a storekeeper would —
the branch's central store, any store in the branch, what this site was
last charged on the way in, then the item master — each bounded by that
date.

**A return answers to a person, not a document.** Nobody can tell you
which slip material left on days later; asking means they pick the
first one in the list and the link looks authoritative while being
wrong. So the handle is the person.

And on the way back nothing is typed. Issuing takes a typed name,
because the man drawing material may be nobody the system has heard
of. Returning does not: by then the system recorded exactly who it
went to, so `?outstanding=true` lists the people actually holding
something and the screen makes you pick one. A name that is not on
that list has nothing to return, and no amount of typing should
conjure one.

The return side shows no money at all. The cost comes off at the
central store's rate on the day it comes back, worked out behind the
screen and never surfaced on it. A man handing back a coil of wire has
no opinion about its price. `outstanding()` is the quantity cap only;
it prices nothing.

**Issued and not returned is consumed.** Nothing calls it an
outstanding balance, because it is not one — material put into
somebody's hands has been used, and that is what issuing it means. The
screens say "consumed". `v_person_outstanding.open_qty` exists only to
cap a return so it cannot invent stock that never left, and is a
mechanic rather than a figure anyone is shown.

**Neither document can invent stock.** An issue is refused for more
than the site is holding, checked inside the transaction. A return is
refused for more than the named person took and has not brought
back.

`v_consumption_event` puts both documents on one signed ledger, issues
positive and returns negative, and is what the tracking screens and
the expense report read. `v_site_consumption` sums it per site and
item.

## Tracking — transactions, audit, consumption

| | |
|---|---|
| `GET /tracking/transactions` | every movement, filtered — `siteId` `kind` `direction` `siteType` `itemId` `person` `from` `to` `q` `sort` |
| `GET /tracking/transactions/kinds` | the kinds actually present, so the filter offers only real options |
| `GET /tracking/audit/item/:itemId` | one item: every movement, where it is standing, and who has had it |
| `GET /tracking/audit/people` | everyone who has drawn material, ranked |
| `GET /tracking/audit/person?name=` | one person: every line with its date, folded by item, plus the spellings the search swept up |
| `GET /tracking/consumed` | issued less returned by item, over a window, with a series for the chart |

Three screens, one ledger, all three under Site — they are what a site
team reaches for while working.

**None of them shows money, and all of them carry it.** Every response
here has `rate` and `value` on it, because the expense report is built
from exactly these rows and splitting the query would let the two
drift. The screens simply do not render them: a site bought none of
this material and has no price to quote, so putting a value column in
front of a storekeeper starts an argument nobody there can settle.
The `series` carries `running_qty` and `running_value` for the same
reason — one series, whichever the caller plots. `v_consumption_event` has issues positive
and returns negative, so every one of these is the same rows sliced
differently — which is the only way three screens can be relied on to
agree. `/tracking/transactions` is the exception and reads
`v_stock_movement` instead, because "what happened to this material"
includes the receipt and the challan that brought it here, not only
what was spent.

**A balance is as at today**, whatever date window is set. Asking what
an item did last September and what is on the shelf right now are two
different questions, and answering the second one "as at September"
would be a stock figure nobody could act on.

**`/tracking/consumed` answers both "in this window" and "to date".**
`beforeWindowValue` is everything consumed before `from`, so
`toDateValue` is the real running total no matter how narrow the
window. The `series` carries `running_value` down its length, and its
last point equals `consumedValue` — tested, because a chart whose line
does not land on the number beside it is worse than no chart.

**Names are typed, so the audit tells you what it swept up.**
`spellings` lists every distinct name a loose search matched, with a
count. Case is folded by the database's collation, so "ramesh kumar"
and "Ramesh Kumar" are one person; a genuinely different spelling
("R Kumar") shows as its own row rather than being silently added in.
`exact=true` matches the whole name instead.

## Expenses

| | |
|---|---|
| `GET /expenses/categories` | the list of kinds; `POST` adds one |
| `POST /expenses` | claim one — `send: true` puts it straight in the queue |
| `PUT /expenses/:id` | edit a draft or one that was sent back |
| `POST /expenses/:id/submit` | send it for approval |
| `POST /expenses/:id/withdraw` | pull it back out of the queue |
| `POST /expenses/:id/decide` | `APPROVED` (with an `amount` to cut it), `REJECTED`, `RETURNED` |
| `GET /expenses` | the register — `siteId` `categoryId` `status` `from` `to` `q` |
| `GET /expenses/:id` | one claim and everything that happened to it |

Money a site spends that never touches a shelf. A quantity of cable
can be checked against a shelf; a claim for ₹4,000 of transport can
only be checked by somebody who knows whether that lorry ran — which
is why this is the one site document that needs approving.

**Two amounts, kept apart.** `claimed_amount` is what the site asked
for and `approved_amount` is what was allowed. Only the second ever
reaches a cost figure. Cutting ₹4,000 to ₹3,200 is one document
carrying both numbers, not a rejection followed by a fresh claim, so
"how much of what sites asked for was granted" stays answerable —
`v_site_expense` derives `outcome` (`APPROVED` / `PART_APPROVED` /
`NIL_APPROVED`) and `disallowed_amount` from them rather than storing
either.

`approved_amount` is NULL until somebody decides, never 0. A claim
nobody has looked at is not the same as one refused. The schema
refuses an approval above the claim — cutting a claim down is an
approval, adding to it is a different document — and the API refuses
a cut, a refusal or a send-back with no reason, because the site is
going to ask and "the system does not say" is not an answer.

There are no permission checks, here or anywhere else in this system
yet. Who may approve is a decision nobody has taken. What the document
records is who *did* decide, which is the part that has to be true
whenever the rules arrive.

## Cost and P&L

| | |
|---|---|
| `GET /costs/expense/statement` | the report as a statement: material item by item, then labour, then everything else, then one total |
| `GET /costs/expense` | the same numbers shaped for charts — series, category and site splits |
| `GET /costs/expense/lines` | every line behind it |
| `GET /costs/pl` | the half of a profit and loss that can be answered |

### The statement

`GET /costs/expense/statement` returns the shape every cost statement
in this trade has, and it is what both the screen and the download
use:

```
MATERIAL CONSUMED     one row per item — net quantity and amount
  Total material
LABOUR                one row per approved claim, with the comments on it
  Total labour
OTHER EXPENSES        the same, grouped by what they were for
  Total other
TOTAL
```

**There is no rate on the material rows, and that is deliberate.** An
item is priced at what the central store held it at on the day it
moved, so one that moved on several days has several rates. Dividing
the amount by the quantity would give an average that was never the
price of anything — cable out on Monday at 10 and Tuesday at 13 is
not cable at 11.50 — and printing that under a heading saying "rate"
invites somebody to multiply it back out and get a different figure
from the one beside it. The quantity is exact, the amount is exact,
and `days` says how many days the item moved on. A single rate is not
available, so none is offered.

Nor is there an issued-and-returned breakdown. The reader of a cost
statement wants what was used and what it cost; what went out and
came back is a stores question, and the Site screens answer it.

Material is listed **per item**, not per issue: "what did the cable
cost" is the question, and forty slips is not an answer to it. Every
other section is listed **per claim**, because there the document is
the answer — somebody asked for money, and the reader wants to see
what for, on whose site, and what was written against it.

Each claim row carries `note` (what the site wrote when it raised it)
and `decision_note` (what the approver wrote back), beside
`claimed_amount` and `cost_amount`. A claim cut from ₹9,000 to ₹7,500
shows both figures and the reason on the same line, which is the
whole point of keeping them apart.

Labour is sectioned off `expense_categories.kind`, not off the
category's name. A business that decides tomorrow that hire charges
are really labour moves one row rather than editing a query.

`v_cost_event` is the one ledger. Material rows come from
`v_consumption_event` — issues positive, returns negative, at the rate
stamped on each line, so a day's material cost is that day's net
quantity at that day's central store rate. Expense rows come from
approved claims at the amount allowed. Sum it for a window and that is
what the work cost; there is no second place where either number is
worked out differently.

**Nothing unapproved is counted**, and the report says so rather than
staying silent: `pending` carries the claims sitting in a queue, their
value and how long the oldest has waited, kept out of every total.

**A window knows what came before it.** `beforeWindow` is everything
up to the start date, so `toDate` is a real running total however
narrow the window, and the chart's line starts where the previous one
finished instead of at zero. The last point of `series.running_value`
equals `totals.total` — tested, because a line that does not land on
the number beside it is worse than no chart.

### Why there is no profit and loss

`GET /costs/pl` returns `available: false` and `blockedBy: "BILLING"`,
and nothing in its response is called revenue or profit.

Cost is known to the rupee. Revenue is not known at all. The only
figure this system holds on the income side is the work order — what a
client *agreed* to pay — and that is not revenue: it has not been
invoiced, nothing has been received against it, and the quantities
actually executed will differ from the ones agreed. Subtracting cost
from an agreement is how a business persuades itself it is profitable
while running out of money, so the endpoint reports the cost it knows,
names what is missing, and refuses to do the subtraction.

`orderValue` is returned for scale and is deliberately not named
revenue. When Billing exists this endpoint gains a revenue side and
nothing else about it changes.

Since Billing exists, `available` is true wherever a bill has been
raised, and the endpoint returns revenue, cost split three ways, gross
profit and margin. Where nothing has been billed it still returns
`available: false` and the screen shows one sentence saying so, with a
way through to Billing and to the expense report — showing a cost
figure under a heading that reads "profit and loss" invites somebody
to read it as a loss.

`orderValue` is the order book struck on the **amended** quantity, the
same one billing works to. Using `work_order_lines.line_total` there
is the original contract, and on an amended site it makes "not yet
billed" come out negative.

## Billing

| | |
|---|---|
| `GET /bills/sites?branchId=` | sites with a work order, and how much of each is billed — `clientId`, or `q` for site or client name |
| `GET /bills/sheet/:siteId` | the sheet — one row per work order line |
| `POST /bills` | raise one (`raise: true`) or save a draft |
| `PUT /bills/:id` | edit a draft |
| `POST /bills/:id/raise` | a draft becomes revenue |
| `POST /bills/:id/cancel` | a raised bill, with a reason |
| `DELETE /bills/:id` | drafts only |
| `GET /bills` · `GET /bills/:id` | the register, and one bill — `clientId`, or `q` for any of bill number / site / client / their reference |

The first document here that earns money. It is raised against **work
order lines**, not items: the client agreed to supply and install a
hundred socket points, they did not agree to buy metal boxes. So the
quantity is in their units, at their rate, against their wording, and
the BOQ and indents sit underneath as evidence.

Bills run RA 1, RA 2, RA 3 per site. `v_bill_line` carries
`previous_qty` so a bill reads the way an RA bill is meant to — up to
the last one, this one, to date — and `uq_bill_ra (site_id, ra_no)`
means two people pressing Raise cannot take the same number.

### What may be billed

**One ceiling: what material has been indented for.** Work nobody has
asked for material for has not been done, and invoicing it is how a
running account bill gets thrown back.

**The agreed quantity is not a second ceiling, and running past it is
not an error.** A work order is written before the work is measured —
the client is estimating their own requirement, and on this kind of
job it goes over. The indent is what reflects what was actually
needed, so the billing follows the indent.

`over_contract_qty` names the part running past the order anyway,
because somebody will ask how a line came to be billed at 115% of
what was signed. The screen reports it plainly rather than as a
warning.

Indents are raised per **item** and a work order line is not an item —
it is 100 socket points, each needing one box and two plates. So
`v_wo_line_indented` translates into the client's units by taking the
**least-provisioned item**: boxes in for 80 points and plates for only
60 means 60 points, not 80.

Every line satisfies

```
agreed + past the order  =  billed + can be billed + waiting on material
```

The fourth term exists because the indent may run past what the client
signed, and when it does that work is billable but is not part of the
contract value. `unprovisioned_qty` is measured from whichever of
indented/billed has got further, rather than from the agreed quantity:
the two look equivalent and are not, and a line billed past its indent
— which happens, and did before this rule existed — would otherwise
count the same work twice and the row would not add up.
`over_billed_qty` names that condition instead of hiding it; the bills
are with the client, so nothing is undone, but no more goes on until
the material is asked for.

### Revenue

`v_site_revenue` is raised bills and nothing else. Not the work order,
which is an agreement. Not a draft, which is a working note. That view
is what gives `GET /costs/pl` its revenue side, and the moment RA 1 is
raised the profit and loss stops saying it cannot exist.

A cancelled bill stops counting, and what it billed becomes free to
bill again. Bills come off in the order they went on — cancelling RA 2
before RA 3 — so the running total can never be reconstructed wrongly.

## Progress
| | |
|---|---|
| `GET /progress/site/:siteId` | the whole spine for one site, line by line |
| `GET /progress/desk?branchId=` | amendments due, work orders awaiting a BOQ, BOQ drafts, indents waiting |

`GET /progress/site/:id` returns, per BOQ line: `boq_qty`,
`effective_est`, `approved_qty`, `committed_qty`, `item_indented_qty`,
`balance` and `over_qty`. Every one of them derived.

## Transfers — sourcing a PRN from another site

| | |
|---|---|
| `GET /transfers/prn/:indentId/outstanding` | what a PRN still wants, and which sites hold it |
| `POST /transfers` | the store asks a site to send, against that PRN |
| `POST /transfers/:id/decide` | `ACCEPTED` / `REJECTED` — the sending site answers |
| `POST /transfers/:id/cancel` | only while nothing has gone against it |
| `GET /transfers?storeId=&fromSiteId=&toSiteId=&state=&show=` | |
| `GET /transfers/:id` | lines, what the sending site holds, events, challans |
| `GET /transfers/site/:siteId/history` | every transfer challan sent, document by document |
| `GET /transfers/site/:siteId/lent-out?show=` | lent, already reordered, still to reorder |
| `POST /transfers/site/:siteId/reorder` | raise the replacement PRN |

**Only the central store raises one.** Sites do not trade with each
other directly — the store decides what moves, because the store is
what knows where everything is. A request names a site to send, the PRN
being answered, and therefore the site to receive.

The sending site accepts, then writes an **ordinary delivery challan**
(`POST /challans` with `trId` on the lines). That challan is linked to
the PRN behind the request as well, so the receiving site's requirement
closes out exactly as if the store had sent it. To the receiver nothing
new is happening: an ordinary challan lands in the ordinary inbox.

Guards: the request quantity cannot exceed what the sending site holds
(checked when the store raises it, and again on dispatch); the request
must be `ACCEPTED` before anything ships; it cannot be over-answered;
and a refusal must carry a note.

`state`: `AWAITING`, `TO_SEND`, `PART_SENT`, `IN_TRANSIT`, `COMPLETE`,
`REJECTED`, `CANCELLED`.

### Reordering issued stock, and the rule behind it

`indents` gains `kind`: `DEMAND` (everything that came before) or
`REPLACEMENT`. A reorder is a **real PRN** — it appears on PRNs to
fulfil, procurement buys against it, the store challans it out. What it
is **not** is a fresh claim on the site's work order.

`v_boq_item_indented` and `v_boq_line_movement` — the only two views
that answer *"how much has been indented"* — now ignore `REPLACEMENT`.
Everything downstream inherits that without knowing: `v_boq_line_status`,
the BOQ balance, the amendment trigger, `v_wo_line_indented` and through
it the billing ceiling. Nothing that answers *"what still has to be
delivered"* is touched — `v_indent_rollup`, `v_indent_item_flow` and
`v_indent_pipeline` see replacements in full, because somebody really
does have to send them.

Without this, a site that lent out cable and reordered it would have
indented the same cable twice: its BOQ would read overspent, it could
trigger a false amendment, and **its billing ceiling would double**.

A reorder is capped at what was lent, net of what has already been
asked back (`to_reorder_qty`). Past that point a site is not replacing
anything, it is indenting — and indenting has its own form.

### The store's ledger

Transfer challans never appear in the central store's stock movements,
because the material never went near it: a challan writes `DC_OUT`
against `from_site_id` and `DC_IN` against `to_site_id`, and neither is
the store. `v_site_lent_out` counts only material that left on a
transfer challan — material issued to a person was spent on that site's
own work and is not reorderable this way.


### Clients

`GET /masters/clients` returns every client with its branch name and a
count of the sites using it. `branchId` filters it — which is what the
client picker on the site form does, because **a site may only be given
a client of its own branch** (`POST /sites` refuses the pairing
otherwise, and a client name is unique across the whole system, so a
client belongs to exactly one branch).

`PATCH /masters/clients/:id` edits one. The branch may be changed only
while the client has **no sites**: a site carries its own `branch_id`
and the two must agree, so moving a client out from under a live site
would leave a pairing the system refuses to create. Renaming is guarded
against duplicates the same way `POST` is.

This matters because a client filed under the wrong branch is otherwise
stranded — invisible in the site form's picker and reachable from
nowhere else. The Clients screen under Planning lists every client
across every branch, which is where such a one is found and put right.
