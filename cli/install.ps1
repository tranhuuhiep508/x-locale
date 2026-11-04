# Install the standalone `loc` binary (no Python needed) on Windows.
#
#   irm https://github.com/tranhuuhiep508/x-locale/releases/latest/download/install.ps1 | iex
#
# Environment overrides:
#   LOC_VERSION      release to install, e.g. 0.2.0 or cli-v0.2.0 (default: newest cli-v* release)
#   LOC_INSTALL_DIR  install directory (default: %LOCALAPPDATA%\Programs\loc)
#   LOC_REPO         GitHub owner/repo hosting the releases
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$repo = if ($env:LOC_REPO) { $env:LOC_REPO } else { 'tranhuuhiep508/x-locale' }
$installDir = if ($env:LOC_INSTALL_DIR) { $env:LOC_INSTALL_DIR } else { Join-Path $env:LOCALAPPDATA 'Programs\loc' }
$asset = 'loc-windows-x64.exe'

if ($env:LOC_VERSION) {
    $tag = if ($env:LOC_VERSION -like 'cli-v*') { $env:LOC_VERSION } else { "cli-v$($env:LOC_VERSION)" }
} else {
    $releases = Invoke-RestMethod "https://api.github.com/repos/$repo/releases?per_page=100"
    $tag = ($releases | Where-Object { $_.tag_name -like 'cli-v*' } | Select-Object -First 1).tag_name
    if (-not $tag) { throw "No cli-v* release found in $repo" }
}

$base = "https://github.com/$repo/releases/download/$tag"
$tmp = Join-Path ([IO.Path]::GetTempPath()) ([Guid]::NewGuid())
New-Item -ItemType Directory -Path $tmp | Out-Null
try {
    Write-Host "Downloading $asset ($tag)..."
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
