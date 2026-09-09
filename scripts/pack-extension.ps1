# Pack PageChat for the Chrome Web Store.
# Output: store/dist/pagechat-<version>.zip with manifest.json at the zip root.

$ErrorActionPreference = "Stop"
$root = Split-Path $PSScriptRoot -Parent
$manifestPath = Join-Path $root "manifest.json"
$configPath = Join-Path $root "src\config.js"

if (-not (Test-Path $configPath)) {
  Write-Error "Missing src/config.js. Copy src/config.example.js, set proxyUrl and appToken, then pack."
}

$manifest = Get-Content $manifestPath -Raw | ConvertFrom-Json
$version = $manifest.version
$dist = Join-Path $root "store\dist"
$stage = Join-Path $dist "stage"
$zip = Join-Path $dist "pagechat-$version.zip"

if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }
if (Test-Path $zip) { Remove-Item $zip -Force }
New-Item -ItemType Directory -Path $stage | Out-Null
New-Item -ItemType Directory -Path (Join-Path $stage "icons") | Out-Null
New-Item -ItemType Directory -Path (Join-Path $stage "ui") | Out-Null
New-Item -ItemType Directory -Path (Join-Path $stage "src") | Out-Null

Copy-Item $manifestPath (Join-Path $stage "manifest.json")
Copy-Item (Join-Path $root "icons\*.png") (Join-Path $stage "icons")
Copy-Item (Join-Path $root "ui\*") (Join-Path $stage "ui")
Copy-Item (Join-Path $root "src\background.js") (Join-Path $stage "src")
Copy-Item $configPath (Join-Path $stage "src\config.js")

Compress-Archive -Path (Join-Path $stage "*") -DestinationPath $zip -Force
Write-Host "Packed $zip"
Get-Item $zip | Select-Object FullName, Length, LastWriteTime
