# AJ Power ERP — Start all servers
# Run from the project root: .\start.ps1

$root = $PSScriptRoot

# ── 1. MySQL ────────────────────────────────────────────────────────
Write-Host "Starting MySQL..." -ForegroundColor Cyan

$mysqlRunning = Get-Process mysqld -ErrorAction SilentlyContinue
if ($mysqlRunning) {
    Write-Host "  MySQL already running (PID $($mysqlRunning[0].Id))" -ForegroundColor Green
} else {
    Start-Process -FilePath "C:\Program Files\MySQL\MySQL Server 8.4\bin\mysqld.exe" `
        -ArgumentList "--datadir=C:\Users\JakkaAbhilashReddy\mysql-data --port=3306" `
        -WindowStyle Hidden
    Start-Sleep -Seconds 4
    $mysqlRunning = Get-Process mysqld -ErrorAction SilentlyContinue
    if ($mysqlRunning) {
        Write-Host "  MySQL started (PID $($mysqlRunning[0].Id))" -ForegroundColor Green
    } else {
        Write-Host "  MySQL failed to start. Check mysql-data folder." -ForegroundColor Red
        exit 1
    }
}

# ── 2. Backend ──────────────────────────────────────────────────────
Write-Host "Starting backend (port 4000)..." -ForegroundColor Cyan
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$root\backend'; node src/index.js" -WindowStyle Normal

Start-Sleep -Seconds 3

# ── 3. Frontend ─────────────────────────────────────────────────────
Write-Host "Starting frontend (port 5173)..." -ForegroundColor Cyan
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$root\frontend'; npm run dev" -WindowStyle Normal

Start-Sleep -Seconds 2

# ── Done ─────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "All servers started:" -ForegroundColor Green
Write-Host "  Frontend  →  http://localhost:5173" -ForegroundColor White
Write-Host "  Backend   →  http://localhost:4000" -ForegroundColor White
Write-Host "  MySQL     →  localhost:3306" -ForegroundColor White
Write-Host ""
Write-Host "Close the two terminal windows to stop the servers." -ForegroundColor DarkGray
