# Prepare static out/ folder for manual upload to Cloudflare Pages (PowerShell)
npm run build

$pagesPath = ".next\server\pages"
if (-not (Test-Path $pagesPath)) {
    Write-Error "Expected $pagesPath not found - build may have failed"
    exit 1
}

if (Test-Path out) { Remove-Item -Path out -Recurse -Force }
New-Item -ItemType Directory -Path out | Out-Null

Copy-Item -Path "$pagesPath\*" -Destination out -Recurse -Force
if (Test-Path _redirects) { Copy-Item -Path _redirects -Destination out -Force }

Write-Output "Prepared out/ - ready for upload to Cloudflare Pages"
