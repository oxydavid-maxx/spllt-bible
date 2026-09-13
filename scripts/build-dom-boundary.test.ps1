$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'build-dom-boundary.ps1')
$tempRoot = Join-Path $env:TEMP ('qingmu-dom-boundary-' + [guid]::NewGuid().ToString('N'))
$variantRoot = Join-Path $tempRoot 'android\app\build\generated\assets\react\release'
$www = Join-Path $variantRoot 'www.bundle'
$outside = Join-Path $env:TEMP ('qingmu-dom-outside-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $www,$outside -Force | Out-Null
Set-Content -LiteralPath (Join-Path $www 'old.html') -Value '<script src="./_expo/static/js/web/entry-old.js"></script>' -Encoding utf8
New-Item -ItemType Directory -Path (Join-Path $www '_expo\static\js\web') -Force | Out-Null
Set-Content -LiteralPath (Join-Path $www '_expo\static\js\web\entry-old.js') -Value '//# sourceMappingURL=entry-old.js.map' -Encoding utf8
Set-Content -LiteralPath (Join-Path $www '_expo\static\js\web\entry-old.js.map') -Value '{}' -Encoding utf8
Set-Content -LiteralPath (Join-Path $outside 'sentinel.txt') -Value 'must remain' -Encoding utf8
$projectRoot = (Resolve-Path -LiteralPath $tempRoot).Path
$removed = Clear-QingmuDomAssetPublication -ProjectRoot $projectRoot -Variant 'release'
if (-not $removed.removed -or (Test-Path -LiteralPath $www)) { throw 'stale DOM publication was not removed' }
New-Item -ItemType Directory -Path (Join-Path $www '_expo\static\js\web') -Force | Out-Null
Set-Content -LiteralPath (Join-Path $www 'new.html') -Value '<script src="./_expo/static/js/web/entry-new.js"></script>' -Encoding utf8
Set-Content -LiteralPath (Join-Path $www '_expo\static\js\web\entry-new.js') -Value '//# sourceMappingURL=entry-new.js.map' -Encoding utf8
Set-Content -LiteralPath (Join-Path $www '_expo\static\js\web\entry-new.js.map') -Value '{}' -Encoding utf8
$published = Test-QingmuDomAssetPublication -ProjectRoot $projectRoot -Variant 'release'
if (-not $published.pass -or $published.unresolved.Count -ne 0 -or $published.orphanWebAssetCount -ne 0) { throw ('active DOM publication proof failed: ' + ($published | ConvertTo-Json -Compress)) }
try {
  Assert-QingmuDomAssetTarget -ProjectRoot $projectRoot -Variant 'release' -Target $outside
  throw 'outside target was not rejected'
} catch {
  if ($_.Exception.Message -notmatch 'outside approved generated root|DOM asset cleanup target') { throw }
}
if ((Get-Content -LiteralPath (Join-Path $outside 'sentinel.txt') -Raw).Trim() -ne 'must remain') { throw 'outside sentinel changed' }
$tempResolved = (Resolve-Path -LiteralPath $tempRoot).Path
$tempBase = (Resolve-Path -LiteralPath $env:TEMP).Path
if (-not $tempResolved.StartsWith($tempBase + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'temporary target escaped TEMP' }
[IO.Directory]::Delete($tempResolved, $true)
[IO.Directory]::Delete((Resolve-Path -LiteralPath $outside).Path, $true)
Write-Output ($published | ConvertTo-Json -Compress)
