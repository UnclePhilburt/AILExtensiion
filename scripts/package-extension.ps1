$ErrorActionPreference = 'Stop'
$repoPath = Split-Path -Parent $PSScriptRoot
$manifest = Get-Content (Join-Path $repoPath 'extension/manifest.json') -Raw | ConvertFrom-Json
$downloadPath = Join-Path $repoPath 'phone-web/public/downloads'
New-Item -ItemType Directory -Force -Path $downloadPath | Out-Null
$zipPath = Join-Path $downloadPath ("impact-companion-" + $manifest.version + '.zip')
Compress-Archive -LiteralPath (Join-Path $repoPath 'extension') -DestinationPath $zipPath -Force
Write-Output $zipPath
