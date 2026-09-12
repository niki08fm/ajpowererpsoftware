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

That's it. There's no login — pick who you're working as from the top
bar; it only decides whose name goes on a document.

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
npm test             # 168 tests
```

`npm test` builds and uses its own database, `ajp_erp_test`. It deletes
every site, work order, BOQ, indent, issue, return and expense before
it runs, so it refuses to
start against any database whose name does not end in `_test`. Your
working data is never touched.

`npm run db:reset` is the destructive one — it drops the database named
in your `.env`.

## What's in it

**Planning** — sites, stores, the site team, work orders (with the
client's spreadsheet droppable straight in), and the BOQ.

**Site** — indents, acknowledgements, the site's own store, and the
material it spends: issuing to a person, and taking back what was not
used.

Site also carries the three screens you reach for while working:
every transaction with filters, an audit that answers either
"everywhere this item has been" or "everything this person has had",
and consumption — net consumed, issued less returned, for a single day
or any window.

Site also raises **expenses** — money it spends that never touches a
shelf. Those are claimed at site and approved elsewhere, in full or in
part, and only what is approved ever counts.

No other screen under Site shows a rate or a value. A site bought none
of that material and has no price to quote. Every document still
stamps what the central store was holding the item at on the day it
moved, and keeps it.

**Reports** — the expense report: material consumed plus approved
expenses, for one site or all of them, over any window, with the
running total to date. And a profit and loss that declines to exist,
because nothing has been billed to a client yet and cost minus an
agreement is not profit.

The thread runs: work order line → BOQ lines (1a, 1b, 1c) → indented →
used. For any BOQ line you can ask what was estimated, what's been
indented, what's been used and what's left, and none of those four
numbers is stored anywhere — they're all derived from the documents
behind them.

`docs/API.md` lists every endpoint.
