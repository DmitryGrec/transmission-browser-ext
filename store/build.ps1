# Builds the Edge Add-ons package dist/transmission-edge-<version>.zip from the runtime files only.
# Usage (from anywhere): pwsh store/build.ps1
# The manifest "key" (it pins the ID of unpacked copies) is left out of the package: Edge Add-ons and
# the Chrome Web Store both reject it. manifest.json in the repo keeps it.
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.IO.Compression, System.IO.Compression.FileSystem

$root = Split-Path $PSScriptRoot -Parent
$manifestText = Get-Content (Join-Path $root "manifest.json") -Raw -Encoding utf8
$version = ($manifestText | ConvertFrom-Json).version
$dirs = "background", "content", "popup", "options", "add", "lib", "icons", "_locales"

# Drop the "key" line as a whole so the rest of the manifest stays byte-identical.
$storeManifest = $manifestText -replace '(?m)^[ \t]*"key":[ \t]*"[^"]*",[ \t]*\r?\n', ''
if (($storeManifest | ConvertFrom-Json).PSObject.Properties.Name -contains "key") {
  throw "Could not remove `"key`" from manifest.json"
}

$dist = Join-Path $root "dist"
New-Item -ItemType Directory -Force $dist | Out-Null
$zipPath = Join-Path $dist "transmission-edge-$version.zip"
if (Test-Path $zipPath) { Remove-Item $zipPath -Force -Confirm:$false }

$zip = [System.IO.Compression.ZipFile]::Open($zipPath, "Create")
try {
  $entry = $zip.CreateEntry("manifest.json", "Optimal")
  $w = New-Object System.IO.StreamWriter($entry.Open(), (New-Object System.Text.UTF8Encoding($false)))
  $w.Write($storeManifest); $w.Close()

  foreach ($d in $dirs) {
    Get-ChildItem (Join-Path $root $d) -Recurse -File | ForEach-Object {
      # Forward slashes: Windows PowerShell's Compress-Archive writes backslashes, which stores reject.
      $rel = $_.FullName.Substring($root.Length + 1).Replace("\", "/")
      [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $_.FullName, $rel, "Optimal") | Out-Null
    }
  }
} finally { $zip.Dispose() }

$kb = [math]::Round((Get-Item $zipPath).Length / 1KB)
Write-Host "Built $zipPath ($kb KB, without manifest key)"
