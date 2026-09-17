# AJ Power ERP — Development Environment

## Stack

| Layer | Technology | Version |
|-------|-----------|---------|
| Database | MySQL 8.4 | installed locally |
| Backend | Node.js | 26.x |
| Backend framework | Express | 4.x |
| Backend validation | Zod | 3.x |
| DB driver | mysql2 | 3.x |
| Frontend | React | 18.x |
| Bundler | Vite | 5.x |
| Router | react-router-dom | 6.x |

No ORM. Raw SQL via `mysql2` pool with helper functions. No TypeScript.

---

## Starting Everything

From the project root in PowerShell:

```powershell
.\start.ps1
```

Starts MySQL, backend (port 4000), and frontend (port 5173) — each in their own window.

| Service | URL |
|---------|-----|
| Frontend | http://localhost:5173 |
| Backend | http://localhost:4000 |
| MySQL | localhost:3306 |

---

## MySQL Setup (Windows, No Docker)

MySQL 8.4 is installed at `C:\Program Files\MySQL\MySQL Server 8.4\`.  
Data directory: `C:\Users\JakkaAbhilashReddy\mysql-data`

MySQL runs as a detached process started by `start.ps1`. **After a reboot**, either run `.\start.ps1` or register it as a permanent Windows service (run once as Administrator):

```powershell
& "C:\Program Files\MySQL\MySQL Server 8.4\bin\mysqld.exe" --install MySQL84 --datadir="C:\Users\JakkaAbhilashReddy\mysql-data"
Start-Service MySQL84
```

---

## Environment Variables

File: `backend/.env`

```env
DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=root
DB_PASSWORD=
DB_NAME=ajp_erp
PORT=4000
```

Root has no password (installed with `--initialize-insecure`).

---

## NPM Scripts

### Backend (`cd backend`)

| Command | What it does |
|---------|-------------|
| `npm run dev` | Runs migrations + seeds then starts with `--watch` |
| `npm start` | Same without `--watch` |
| `npm run db:reset` | **Destructive** — drops DB, reruns all 23 migrations + all 4 seeds |
| `npm test` | Runs all backend tests |

### Frontend (`cd frontend`)

| Command | What it does |
|---------|-------------|
| `npm run dev` | Vite dev server with HMR at port 5173 |
| `npm run build` | Production build to `dist/` |

---

## Vite Proxy

`frontend/vite.config.js` proxies `/api` → `http://localhost:4000`.  
`api.js` uses `BASE = '/api'` — no CORS issues in dev.

---

## Database Reset & Seeds

```powershell
cd backend
npm run db:reset
```

This drops and recreates the database, applies all 23 migrations in order, then loads 4 seed files:

| Seed | Contents |
|------|----------|
| `001_reference.sql` | 2 branches, 5 users, 3 clients |
| `002_items.sql` | 2,607 electrical items |
| `003_demo_data.sql` | 3 work orders with full lifecycle (GMR T2, Brigade, Salarpuria) |
| `004_expanded_data.sql` | 5 more sites + WOs, all dashboard states populated |

Seeds are idempotent — running `npm run dev` on an already-populated DB is safe (seeds only fire when the respective gate table is empty).

**After reset the DB has:**
- 7 clients, 5 suppliers, 4 stores (2 HYD + 2 BLR), 8 project sites
- 8 work orders, 10 indents (DRAFT/SUBMITTED/APPROVED)
- 8 purchase orders (DRAFT/SUBMITTED/APPROVED), 5 GRNs, 7 challans
- 18 expenses across 6 sites, 7 bills (4 RAISED + 3 DRAFT)
- 43 stock movements

---

## Direct MySQL Access

```powershell
& "C:\Program Files\MySQL\MySQL Server 8.4\bin\mysql.exe" -uroot ajp_erp
```

---

## API Health Check

```powershell
Invoke-RestMethod http://localhost:4000/health
# → ok: True
```
