# Build the BeamNG mod zip locally for upload to beamng.com/resources.
#
# IMPORTANT: We do NOT use PowerShell's Compress-Archive — it's known to
# write zip entries with backslash path separators in PowerShell 5.1
# (https://github.com/PowerShell/PowerShell/issues/6750), which some unzip
# tools and BeamNG mod loaders mishandle. We use 7-Zip's CLI instead, which
# always writes forward-slash paths, exactly matching the zip the GitHub
# Actions release workflow produces.
#
# Usage:  pwsh scripts/build_zip.ps1
# Output: dist/fueltech_boost_controller.zip

$ErrorActionPreference = "Stop"

# Locate 7-Zip
$candidates = @(
  "C:\Program Files\7-Zip\7z.exe",
  "C:\Program Files (x86)\7-Zip\7z.exe"
)
$sevenZip = $candidates | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $sevenZip) {
  Write-Error "7-Zip not found. Install from https://www.7-zip.org/ then re-run."
}

# Repo root = parent of this script's directory
$repoRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $repoRoot

# Output
$dist = Join-Path $repoRoot "dist"
New-Item -ItemType Directory -Path $dist -Force | Out-Null
$out = Join-Path $dist "fueltech_boost_controller.zip"
if (Test-Path $out) { Remove-Item $out -Force }

# Build the zip. Same recipe as .github/workflows/release.yml — keep them
# in sync so the local zip and the GitHub release zip are byte-equivalent
# (modulo timestamps).
$includes = @("lua", "ui", "vehicles", "mod_info", "scripts/modScript.lua", "README.md")
$args = @("a", "-tzip", "-mx=9", "-bso0", "-bsp1", $out) + $includes
& $sevenZip @args
if ($LASTEXITCODE -ne 0) {
  Write-Error "7-Zip failed with exit code $LASTEXITCODE"
}

# Verify the stored entry names directly via .NET's ZipArchive — this reads
# raw paths from the zip central directory without any platform conversion
# (unlike `7z l` which prints backslashes on Windows even when the stored
# paths use forward slashes).
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = [System.IO.Compression.ZipFile]::OpenRead($out)
try {
  $entryNames = @()
  foreach ($entry in $archive.Entries) { $entryNames += $entry.FullName }
} finally {
  $archive.Dispose()
}

# Correct BeamNG mod zips use forward slashes only. PowerShell 5.1's
# Compress-Archive is the cmdlet known to violate this — 7-Zip should be safe.
$badPaths = $entryNames | Where-Object { $_.Contains([char]92) }
if ($badPaths) {
  Write-Warning "Entries with backslash paths in stored zip (will break Linux/macOS BeamNG):"
  $badPaths | ForEach-Object { Write-Warning "  $_" }
}

# Sanity check structure: top-level entries must be lua/, ui/, vehicles/,
# mod_info/, README.md — no wrapper folder.
$expectedTop = @{ "lua" = $true; "ui" = $true; "vehicles" = $true; "mod_info" = $true; "scripts" = $true; "README.md" = $true }
$topLevels = $entryNames | ForEach-Object {
  $idx = $_.IndexOf("/")
  if ($idx -lt 0) { $_ } else { $_.Substring(0, $idx) }
} | Sort-Object -Unique
foreach ($top in $topLevels) {
  if (-not $expectedTop.ContainsKey($top)) {
    Write-Warning "Unexpected top-level entry in zip: '$top' (BeamNG expects only lua/ui/vehicles/mod_info/README.md)"
  }
}

$size = (Get-Item $out).Length
$sizeKB = [math]::Round($size / 1KB, 1)
Write-Output ""
Write-Output "Built: $out"
Write-Output "Size:  $sizeKB KB"
Write-Output "Top-level entries: $($topLevels -join ', ')"
Write-Output ""
Write-Output "Upload this file to beamng.com/resources via 'Upload Update'."
