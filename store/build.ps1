# Builds the Edge Add-ons package dist/transmission-edge-<version>.zip from the runtime files only.
# Usage (from anywhere):  pwsh store/build.ps1            keeps the manifest "key"
#                         pwsh store/build.ps1 -StripKey  drops it (only if Partner Center rejects it)
param([switch]$StripKey)
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.IO.Compression, System.IO.Compression.FileSystem

$root = Split-Path $PSScriptRoot -Parent
$manifestText = Get-Content (Join-Path $root "manifest.json") -Raw -Encoding utf8
$version = ($manifestText | ConvertFrom-Json).version
$dirs = "background", "content", "popup", "options", "add", "lib", "icons", "_locales"

$dist = Join-Path $root "dist"
New-Item -ItemType Directory -Force $dist | Out-Null
$zipPath = Join-Path $dist "transmission-edge-$version.zip"
if (Test-Path $zipPath) { Remove-Item $zipPath -Force -Confirm:$false }

$zip = [System.IO.Compression.ZipFile]::Open($zipPath, "Create")
try {
  # manifest.json, optionally without "key" (removed as a whole line so the rest stays byte-identical)
  if ($StripKey) { $manifestText = $manifestText -replace '(?m)^\s*"key":\s*"[^"]*",\r?\n', '' }
  $entry = $zip.CreateEntry("manifest.json", "Optimal")
  $w = New-Object System.IO.StreamWriter($entry.Open(), (New-Object System.Text.UTF8Encoding($false)))
  $w.Write($manifestText); $w.Close()

  foreach ($d in $dirs) {
    Get-ChildItem (Join-Path $root $d) -Recurse -File | ForEach-Object {
      # Forward slashes: Windows PowerShell's Compress-Archive writes backslashes, which stores reject.
      $rel = $_.FullName.Substring($root.Length + 1).Replace("\", "/")
      [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $_.FullName, $rel, "Optimal") | Out-Null
    }
  }
} finally { $zip.Dispose() }

$kb = [math]::Round((Get-Item $zipPath).Length / 1KB)
Write-Host "Built $zipPath ($kb KB)$(if ($StripKey) { ', without key' })"
