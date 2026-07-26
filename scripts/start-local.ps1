# Start TMS locally without Docker (SQLite + Python + Node)
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot

$python = @(
    "$env:LOCALAPPDATA\Programs\Python\Python312\python.exe",
    "$env:LOCALAPPDATA\Programs\Python\Python313\python.exe",
    "python"
) | Where-Object { Test-Path $_ -ErrorAction SilentlyContinue } | Select-Object -First 1

$nodeDir = "$env:ProgramFiles\nodejs"
$node = @(
    "$nodeDir\node.exe",
    "node"
) | Where-Object { if ($_ -eq "node") { $true } else { Test-Path $_ } } | Select-Object -First 1
$npm = "$nodeDir\npm.cmd"

if (-not $python) { throw "Python not found. Install Python 3.12+ first." }
if (-not (Test-Path $node)) { throw "Node.js not found. Install Node LTS first." }
if (-not (Test-Path $npm)) { throw "npm not found at $npm. Reinstall Node.js LTS." }

$env:Path = "$env:ProgramFiles\nodejs;$env:LOCALAPPDATA\Programs\Python\Python312;$env:LOCALAPPDATA\Programs\Python\Python312\Scripts;$env:Path"

Write-Host "Using Python: $python" -ForegroundColor Cyan
Write-Host "Using Node:   $node" -ForegroundColor Cyan

function Stop-DevServerOnPort {
    param([int]$Port, [string]$Pattern)
    $pids = @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
        ForEach-Object { $_.OwningProcess } |
        Sort-Object -Unique)
    foreach ($procId in $pids) {
        $proc = Get-CimInstance Win32_Process -Filter "ProcessId=$procId" -ErrorAction SilentlyContinue
        if ($proc -and $proc.CommandLine -match $Pattern) {
            Write-Host "Stopping existing dev server on port $Port (PID $procId)..." -ForegroundColor Yellow
            Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
        }
    }
}

# Avoid duplicate dev servers — a second Vite instance can bind only to ::1 and break /api proxy on localhost.
Stop-DevServerOnPort -Port 8000 -Pattern "uvicorn"
Stop-DevServerOnPort -Port 5173 -Pattern "vite"
Start-Sleep -Seconds 1

# Backend setup
Write-Host "`n[1/4] Installing backend dependencies..." -ForegroundColor Yellow
Set-Location "$Root\backend"
& $python -m pip install -q -r requirements.txt

# Frontend setup
Write-Host "[2/4] Installing frontend dependencies..." -ForegroundColor Yellow
Set-Location "$Root\frontend"
npm install --silent

# CLI setup
Write-Host "[3/4] Installing CLI..." -ForegroundColor Yellow
Set-Location "$Root\cli"
& $python -m pip install -q -e .

# Start servers
Write-Host "[4/4] Starting backend (8000) and frontend (5173)..." -ForegroundColor Yellow
Set-Location $Root

$backendJob = Start-Process -FilePath $python -ArgumentList "-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--reload" -WorkingDirectory "$Root\backend" -PassThru -WindowStyle Normal
Start-Sleep -Seconds 3

# Use npm.cmd — Start-Process cannot launch the npm shim directly on Windows.
$frontendJob = Start-Process -FilePath $npm -ArgumentList "run", "dev" -WorkingDirectory "$Root\frontend" -PassThru -WindowStyle Normal

Write-Host "`nTMS is starting!" -ForegroundColor Green
Write-Host "  Dashboard:  http://localhost:5173"
Write-Host "  API docs:   http://localhost:8000/docs"
Write-Host "  API key:    demo-api-key-change-me"
Write-Host "`nPress Ctrl+C in each terminal window to stop."
Write-Host "Or close the two new terminal windows."
