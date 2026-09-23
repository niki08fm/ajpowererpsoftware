# AJ Power ERP

Two folders. Run `npm run dev` in each.

```
ajp-erp/
  backend/     Node + Express + MySQL   →  http://localhost:4000
  frontend/    React + Vite             →  http://localhost:5173
```

## Run it

You need **MySQL 8** and **Node 18+**.

If you don't have MySQL running, `docker compose up -d db` starts one.

**Terminal 1**

```bash
cd backend
npm install
npm run dev
```

The first run creates the database, applies the schema and loads the
item master (2,607 items). Later runs skip straight to starting.

**Terminal 2**

```bash
cd frontend
npm install
npm run dev
```

Open **http://localhost:5173**.

Sign in. On first start everyone is given the trial password
**`ajpower@123`** (set `TRIAL_PASSWORD` in `backend/.env` to change it);
Management changes it per person from **Logins › Users & access**, and
anyone can change their own from the top bar.

## Logins and what each one sees

| Login | Email | Sees |
|---|---|---|
| Management | anil@, deepak@ | Every department and project, **view only**. Signs the second level. Makes logins and gives access. |
| General Manager | kavya@ | The same, but only the projects they are GM of. Signs the first level. |
| Planning | suresh@ | Sites, BOQs, clients, stores, item master. |
| Site | ravi@, vikram@ | Their own sites: indents, acknowledgements, site store, expenses, transfers. **Issue material only as the site's store keeper.** |
| Store | imran@ | PRNs, GRNs, challans, stock, movement. |
| Procurement | prakash@ | To buy, rate comparisons, orders, suppliers. |
| Billing | lakshmi@ | Bills for each site. |

All emails are `@ajpower.test`. A GM or Site login sees nothing until
Management gives it sites under **Users & access › Sites**: a GM is
made GM of projects; a Site person is put on a site's team or made its
store keeper.

The server enforces the same lines (`backend/src/lib/access.js`): a
write the role may not make is refused, a site the person is not on is
refused, and lists sent to a GM or Site login drop other sites' rows.

## If MySQL isn't root with no password

Create `backend/.env`:

```
DB_USER=your_user
DB_PASSWORD=your_password
```

Everything else has a working default.

## Other commands

```bash
cd backend
npm run db:reset     # DROPS your database and rebuilds it empty
npm test             # 257 tests
```

`npm test` builds and uses its own database, `ajp_erp_test`. It deletes
every site, work order, BOQ, indent, issue, return, expense and bill
before it runs, so it refuses to
start against any database whose name does not end in `_test`. Your
working data is never touched.

`npm run db:reset` is the destructive one — it drops the database named
in your `.env`.

## What's in it

**My desk** is the first tab of every department: the counts that need
someone, the documents behind them with anything past its date first,
the actions people start most often, and a trend of the last twelve
weeks or six months. Late means past a date somebody was promised — a
PRN's needed-by, a supplier's expected date — or sitting too long with
whoever has to act. Site and store desks count documents rather than
rupees; the money departments get their trends in money.

**Approvals** is a department of its own: everything waiting on the
person signed in, oldest on their desk first. A PRN or an
expense claim goes to the GM of the site that raised it, a purchase
order to Management, a transfer request to the head of the site asked
to send. Nothing else is shown to anyone. Each decision is the
document's own — the same call its own screen makes — so its history
records it exactly as if it had been decided there.

**Choosing where you work.** The Site department opens on a page of
cards — every open site, in every branch, grouped by branch — and
everything inside it is answered for the one you pick. The Store
department does the same with stores. Neither asks for a branch: it
follows from the site or store chosen, and the top bar offers the site
or store instead, with a switch back to the cards. A remembered choice
that has since closed is dropped, so you land on the cards rather than
on a dead page.

Everywhere else the branch picker decides, and it can be set to **All
branches**. Creating something still needs one branch, so New site and
Create store ask for it when you are viewing all, and a rate comparison
takes its branch from the indents on it — and refuses indents from two
branches on one sheet. Branches are Hyderabad, Bengaluru and Pune
(Pune's GSTIN is still to be filled in).

**Planning** — sites, clients, stores, the site team, work orders (with
the client's spreadsheet droppable straight in), and the BOQ.

A client belongs to one branch, and a site may only be given a client of
its own branch. That makes a client filed under the wrong branch
invisible on the site form and reachable from nowhere else, so the
**Clients** screen lists every client across every branch — and lets the
branch be corrected, right up until the client has its first site.

**Site** — indents, acknowledgements, the site's own store, and the
material it spends: issuing to a person, and taking back what was not
used.

Site also carries the three screens you reach for while working:
every transaction with filters, an audit that answers either
"everywhere this item has been" or "everything this person has had",
and consumption — net consumed, issued less returned, for a single day
or any window.

When the store cannot fill a PRN but another site is sitting on the
material, it asks that site to send it across rather than buy it twice.
The store raises the request; the sending site accepts and writes an
ordinary challan; the receiving site signs for it in the ordinary way,
because from where it stands its own PRN has simply arrived. The
material never touches the store, so it never appears in the store's
ledger.

The lending site then reorders what it gave away, from a cumulative
sheet showing what it lent, what it has already asked back, and what is
left. That reorder is a real PRN the store must fulfil — but it does
**not** count against the site's BOQ a second time. The site indented
that cable once; lending it out did not make it twice, and counting it
again would overstate the BOQ and double what the site could invoice.

Site also raises **expenses** — money it spends that never touches a
shelf. Those are claimed at site and approved elsewhere, in full or in
part, and only what is approved ever counts.

No other screen under Site shows a rate or a value. A site bought none
of that material and has no price to quote. Every document still
stamps what the central store was holding the item at on the day it
moved, and keeps it.

**What an item costs is Procurement's business and nobody else's.**
Rates are stored, stamped on every movement and kept — they are simply
not shown outside the buying screens. The item master carries no rate,
a goods receipt note shows what arrived but not what it cost, and a
delivery challan carries no value. The one exception is the store's own
stocktaking total: a storekeeper may see what the whole shelf is worth,
because that is his count, but not what any single item on it cost.

Procurement sees rates where they are used — on the sheet for the order
being placed, each line shows what the central store is already holding
that item at and what was last paid for it anywhere, so a buyer is
never typing into a vacuum.

Only Procurement may act here; Management and the GM see it view only.

The **item master** sits under Planning, which reads it, and under
Store, which is the only department that adds to it — the storekeeper
is the one person who knows whether a thing arriving on a lorry is
genuinely new or the same item under a different spelling. Adding one
allocates the code from the category; nobody types a code, and nobody
types a price — an item has no single price anyway, since every
movement stamps what it stood at on the day. The same name twice is
refused outright, and the same words in a different order are saved
with a warning naming the look-alikes.

**Billing** — open a site and bill against its work order, line by
line, at the rates the client agreed. Bills run RA 1, RA 2, RA 3, and
a line bills up to what material has been indented for — past the
agreed quantity too, if the indent went there, with the sheet saying
so.

**Reports** — the expense report: material consumed plus approved
expenses, for one site or all of them, over any window, with the
running total to date. And a profit and loss, which exists for a site
the moment its first bill is raised and declines to exist before
that — cost minus an agreement is not profit.

The thread runs: work order line → BOQ lines (1a, 1b, 1c) → indented →
used. For any BOQ line you can ask what was estimated, what's been
indented, what's been used and what's left, and none of those four
numbers is stored anywhere — they're all derived from the documents
behind them.

`docs/API.md` lists every endpoint.
# ajpowererpsoftware
