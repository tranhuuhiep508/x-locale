# Install TMS CLI so `tms` is on PATH (Windows).
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$CliDir = Join-Path $Root "cli"

$python = @(
    "$env:LOCALAPPDATA\Programs\Python\Python314\python.exe",
    "$env:LOCALAPPDATA\Programs\Python\Python313\python.exe",
    "$env:LOCALAPPDATA\Programs\Python\Python312\python.exe",
    "python"
) | Where-Object { if ($_ -eq "python") { $true } else { Test-Path $_ } } | Select-Object -First 1

if (-not $python) { throw "Python not found. Install Python 3.14+ first." }

Write-Host "Installing tms-cli..." -ForegroundColor Yellow
& $python -m pip install -q -e $CliDir
& $python -m tms_cli.windows
Write-Host "CLI ready. Try: tms --help" -ForegroundColor Green
