param([switch]$ChromeStore)
$ErrorActionPreference = 'Stop'
$repoPath = Split-Path -Parent $PSScriptRoot
$manifest = Get-Content (Join-Path $repoPath 'extension/manifest.json') -Raw | ConvertFrom-Json
$downloadPath = Join-Path $repoPath 'phone-web/public/downloads'
New-Item -ItemType Directory -Force -Path $downloadPath | Out-Null
$suffix = if ($ChromeStore) { '-chrome-store' } else { '' }
$zipPath = Join-Path $downloadPath ("impact-companion-" + $manifest.version + $suffix + '.zip')
if ($ChromeStore) {
    # Build in a unique workspace staging directory; never alter the installed extension.
    $stagingPath = Join-Path $repoPath ('release/chrome-store-' + [guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Force -Path $stagingPath | Out-Null
    Copy-Item -Path (Join-Path $repoPath 'extension/*') -Destination $stagingPath -Recurse
    $manifest.PSObject.Properties.Remove('update_url')
    $manifest | ConvertTo-Json -Depth 30 | Set-Content -LiteralPath (Join-Path $stagingPath 'manifest.json') -Encoding utf8
    # Store package has manifest.json at the archive root.
    Compress-Archive -Path (Join-Path $stagingPath '*') -DestinationPath $zipPath -Force
} else {
    Compress-Archive -LiteralPath (Join-Path $repoPath 'extension') -DestinationPath $zipPath -Force
}
Write-Output $zipPath
