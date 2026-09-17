# AJ Power ERP — Development Environment

## Stack

| Layer | Technology | Version |
|-------|-----------|---------|
| Database | MySQL 8.4 | installed locally via winget |
| Backend runtime | Node.js | 26.x |
| Backend framework | Express | 4.x |
| Backend validation | Zod | 3.x |
| Backend DB driver | mysql2 | 3.x |
| Frontend runtime | React | 18.x |
| Frontend bundler | Vite | 5.x |
| Frontend router | react-router-dom | 6.x |

No ORM. Raw SQL via `mysql2` pool with helper functions. No TypeScript on either end.

---

## Starting All Servers (One Command)

From the project root in PowerShell:

```powershell
.\start.ps1
```

This starts MySQL, the backend (port 4000), and the frontend (port 5173) — each in their own window.

- Frontend → http://localhost:5173
- Backend  → http://localhost:4000
- MySQL    → localhost:3306

---

## MySQL Setup (Local — No Docker)

MySQL 8.4 is installed at `C:\Program Files\MySQL\MySQL Server 8.4\`.
Data directory: `C:\Users\JakkaAbhilashReddy\mysql-data`

MySQL runs as a **detached process** started by `start.ps1`. It survives terminal closes but not reboots.

**After a reboot**, either run `.\start.ps1` (it starts MySQL automatically) or register it as a permanent Windows service (run once as Administrator):

```powershell
& "C:\Program Files\MySQL\MySQL Server 8.4\bin\mysqld.exe" --install MySQL84 --datadir="C:\Users\JakkaAbhilashReddy\mysql-data"
Start-Service MySQL84
```

---

## Environment Variables (Backend)

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
| `npm run dev` | Runs migrations/seeds then starts with `--watch` (auto-restart) |
| `npm start` | Same without `--watch` |
| `npm run db:reset` | **Destructive** — drops and recreates full schema + seeds |
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

## Database Management

```powershell
# Full reset — drops everything, reruns all 23 migrations + seeds
cd backend; npm run db:reset

# Connect directly
& "C:\Program Files\MySQL\MySQL Server 8.4\bin\mysql.exe" -uroot ajp_erp
```

The migration runner (`setup.js`) is idempotent — tracks applied migrations in `migration_log`, skips already-run ones. Only `--fresh` drops and recreates.

---

## API Health Check

```powershell
Invoke-RestMethod http://localhost:4000/health
# → ok: True, at: ...
```

---

## Seeded Reference Data

After `db:reset`, the database contains:
- **2 branches**: Hyderabad (HYD), Bengaluru (BLR)
- **5 users**: Suresh Rao (Planning), Ravi Kumar (Site), Vikram Nair (Site), Imran Sheikh (Store), Anil Menon (Management)
- **2,607 items** in the electrical item master
- **10 expense categories** (Transport, Fuel, Freight, Food, etc.)

The "Working as" dropdown in the app top bar selects among these users.
