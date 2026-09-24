$ErrorActionPreference = 'Stop'
$repoPath = Split-Path -Parent $PSScriptRoot
$manifestPath = Join-Path $repoPath 'extension/manifest.json'
$manifest = Get-Content $manifestPath -Raw | ConvertFrom-Json
$bravePath = 'C:\Program Files\BraveSoftware\Brave-Browser\Application\brave.exe'
if (-not (Test-Path -LiteralPath $bravePath)) { throw 'Brave was not found at the standard Windows location.' }
$releasePath = Join-Path $repoPath 'release'
$stagePath = Join-Path $releasePath 'impact-companion'
$keyPath = Join-Path $releasePath 'impact-companion.pem'
$crxPath = "$stagePath.crx"
$downloadsPath = Join-Path $repoPath 'phone-web/public/downloads'
$publicCrx = Join-Path $downloadsPath ("impact-companion-" + $manifest.version + '.crx')
$updateUrl = 'https://unclephilburt.github.io/AILExtensiion/downloads/' + [IO.Path]::GetFileName($publicCrx)
$updateManifest = Join-Path $repoPath 'phone-web/public/updates/updates.xml'

Remove-Item -LiteralPath $stagePath -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath $crxPath -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $releasePath, $downloadsPath | Out-Null
Copy-Item -LiteralPath (Join-Path $repoPath 'extension') -Destination $stagePath -Recurse -Force
$packArgs = @("--pack-extension=$stagePath")
if (Test-Path -LiteralPath $keyPath) { $packArgs += "--pack-extension-key=$keyPath" }
& $bravePath @packArgs
# Brave's pack command writes a valid CRX but can return a nonzero process
# status on Windows. The created package is the reliable completion signal.
for ($attempt = 0; $attempt -lt 40 -and -not (Test-Path -LiteralPath $crxPath); $attempt++) { Start-Sleep -Milliseconds 250 }
if (-not (Test-Path -LiteralPath $crxPath)) { throw 'Brave could not package the signed extension.' }
Copy-Item -LiteralPath $crxPath -Destination $publicCrx -Force
$extensionId = node (Join-Path $repoPath 'scripts/write-update-manifest.cjs') $keyPath $manifest.version $updateUrl $updateManifest
if ($LASTEXITCODE -ne 0) { throw 'Could not create the update manifest.' }
$policyPath = Join-Path $repoPath 'phone-web/public/admin/brave-extension-policy.json'
New-Item -ItemType Directory -Force -Path (Split-Path $policyPath) | Out-Null
@{
  ExtensionSettings = @{
    $extensionId = @{
      installation_mode = 'force_installed'
      update_url = 'https://unclephilburt.github.io/AILExtensiion/updates/updates.xml'
      override_update_url = $true
    }
  }
} | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $policyPath -Encoding utf8
Write-Output "Signed CRX: $publicCrx"
Write-Output "Extension ID: $extensionId"
Write-Output "Policy file: $policyPath"
