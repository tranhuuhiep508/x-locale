# Install the standalone `loc` binary (no Python needed) on Windows.
#
#   irm https://<your-x-locale-host>/cli/install.ps1 | iex
#
# Served by your x-locale server, which fills in its own address below; when run
# from elsewhere, set LOC_BASE_URL to the server origin.
#
# Environment overrides:
#   LOC_BASE_URL     x-locale server origin, e.g. https://x-locale.example.com
#   LOC_INSTALL_DIR  install directory (default: %LOCALAPPDATA%\Programs\loc)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$baseUrl = if ($env:LOC_BASE_URL) { $env:LOC_BASE_URL } else { '__LOC_BASE_URL__' }
if ($baseUrl -like '*LOC_BASE_URL__') {
    throw 'Set LOC_BASE_URL to your x-locale server, e.g. https://x-locale.example.com'
}
$installDir = if ($env:LOC_INSTALL_DIR) { $env:LOC_INSTALL_DIR } else { Join-Path $env:LOCALAPPDATA 'Programs\loc' }
$asset = 'loc-windows-x64.exe'
$base = "$($baseUrl.TrimEnd('/'))/cli"
$tmp = Join-Path ([IO.Path]::GetTempPath()) ([Guid]::NewGuid())
New-Item -ItemType Directory -Path $tmp | Out-Null
try {
    Write-Host "Downloading $asset from $base ..."
    Invoke-WebRequest "$base/$asset" -OutFile (Join-Path $tmp $asset) -UseBasicParsing
    Invoke-WebRequest "$base/SHA256SUMS" -OutFile (Join-Path $tmp 'SHA256SUMS') -UseBasicParsing

    $line = Get-Content (Join-Path $tmp 'SHA256SUMS') | Where-Object { $_ -match "\s$([regex]::Escape($asset))$" }
    if (-not $line) { throw "$asset is missing from SHA256SUMS" }
    $expected = ($line -split '\s+')[0]
    $actual = (Get-FileHash (Join-Path $tmp $asset) -Algorithm SHA256).Hash
    if ($expected -ne $actual.ToLower()) { throw "Checksum mismatch for $asset" }

    New-Item -ItemType Directory -Force -Path $installDir | Out-Null
    $target = Join-Path $installDir 'loc.exe'
    Move-Item -Force (Join-Path $tmp $asset) $target
} finally {
    Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
}

$userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
if (($userPath -split ';') -notcontains $installDir) {
    $newPath = if ($userPath) { "$($userPath.TrimEnd(';'));$installDir" } else { $installDir }
    [Environment]::SetEnvironmentVariable('Path', $newPath, 'User')
    Write-Host "Added $installDir to your user PATH (open a new terminal to use it)."
}
Write-Host "Installed $(& $target --version) to $target"
