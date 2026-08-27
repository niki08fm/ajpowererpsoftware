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
| `POST /sites` | name, branch, client, head, keeper, dates, addresses, team |
| `PATCH /sites/:id` | |
| `GET /sites/stores/list?branchId=` | branch warehouses |
| `POST /sites/stores` | |

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
| `POST /boq/:id/amendments` | `{reason, lines:[{boqLineId,qty}]}` |
| `GET /boq/:id/amendments` | the trail |

`GET /boq/:id` returns `state` as `DRAFT`, `LOCKED` or `AMENDMENT_DUE`,
with `prepared` / `ofLines` / `remaining` for the counter at the top.

## Indents
| | |
|---|---|
| `GET /indents/sites?branchId=` | sites with a locked BOQ |
| `GET /indents/boq/:boqId/lines` | boq qty, est, variation, committed, balance, ceiling |
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

## Consumption
| | |
|---|---|
| `GET /consumption/boq/:boqId/available` | what is at site: indented less already used |
| `POST /consumption/evaluate` | dry run against what is at site |
| `POST /consumption` | `{...,confirm:false}` saves a draft, `confirm:true` books it |
| `PUT /consumption/:id` | edit while DRAFT |
| `POST /consumption/:id/confirm` | re-checks availability, then books it |
| `DELETE /consumption/:id` | drafts only |
| `GET /consumption?branchId=&siteId=` | `{drafts, entries}` |
| `GET /consumption/:id` | lines with estimated / indented / used / at site |

A draft is a working note. Only `CONFIRMED` counts as consumed. Until
the store side exists, a site can only use what its indents were
approved for, so `available = approved − consumed`.

## Progress
| | |
|---|---|
| `GET /progress/site/:siteId` | the whole spine for one site, line by line |
| `GET /progress/desk?branchId=` | amendments due, work orders awaiting a BOQ, BOQ drafts, indents waiting |

`GET /progress/site/:id` returns, per BOQ line: `boq_qty`,
`effective_est`, `approved_qty`, `consumed_qty`, `available_qty`,
`balance` and `over_qty`. Every one of them derived.
