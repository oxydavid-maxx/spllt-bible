$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'build-boundary.ps1')
$tempRoot = Join-Path $env:TEMP ("qingmu-boundary-" + [Guid]::NewGuid().ToString('N'))
$owned = Join-Path $tempRoot 'owned'
$staleDir = Join-Path $owned 'android\app\.cxx'
$sameDir = Join-Path $owned 'node_modules\react-native-screens\android\.cxx'
$nitroGoogleDir = Join-Path $owned 'node_modules\react-native-nitro-google-signin\android\.cxx'
$outside = Join-Path $tempRoot 'outside\.cxx'
New-Item -ItemType Directory -Force (Join-Path $staleDir 'RelWithDebInfo') | Out-Null
New-Item -ItemType Directory -Force (Join-Path $sameDir 'RelWithDebInfo') | Out-Null
New-Item -ItemType Directory -Force (Join-Path $nitroGoogleDir 'RelWithDebInfo') | Out-Null
New-Item -ItemType Directory -Force $outside | Out-Null
'-IC:\dev\apps\qingmu-youth\node_modules\react-native\ReactAndroid\cmake-utils\default-app-setup -IC:\dev\tools\qingmu-android\gradle-home\caches\9.3.1\transforms\old\build.ninja; "C:\dev\apps\quoted path"; -IC:\dev\tools\qingmu-android\gradle-home\wrapper\dists\gradle-9.3.1' | Set-Content (Join-Path $staleDir 'RelWithDebInfo\build.ninja')
$ownedForward = $owned.Replace('\', '/')
"-I${ownedForward}/node_modules/react-native/ReactAndroid/cmake-utils/default-app-setup -IC:\dev\g\caches\9.3.1\transforms\same\build.ninja; `"${ownedForward}/quoted path`"; -IC:\dev\g\wrapper\dists\gradle-9.3.1" | Set-Content (Join-Path $sameDir 'RelWithDebInfo\build.ninja')
$nitroGoogleMetadata = @'
CMAKE_HOME_DIRECTORY:INTERNAL=C:/dev/apps/qingmu-youth/node_modules/react-native-nitro-google-signin/android
CMAKE_CACHEFILE_DIR:INTERNAL=C:/dev/apps/qingmu-youth/node_modules/react-native-nitro-google-signin/android/.cxx/RelWithDebInfo/fixture/arm64-v8a
'@
$nitroGoogleMetadata | Set-Content (Join-Path $nitroGoogleDir 'RelWithDebInfo\CMakeCache.txt')
$stale = @(Get-StaleGeneratedBuildDirs $owned 'C:\dev\g' @($staleDir, $sameDir, $nitroGoogleDir))
if ($stale.Count -ne 2 -or -not ($stale | Where-Object { (Normalize-BuildPath $_) -eq (Normalize-BuildPath $staleDir) }) -or -not ($stale | Where-Object { (Normalize-BuildPath $_) -eq (Normalize-BuildPath $nitroGoogleDir) })) { throw "stale-root detection failed: $($stale -join ',')" }
if (@(Get-GeneratedBuildDirs $owned | Where-Object { (Normalize-BuildPath $_) -eq (Normalize-BuildPath $nitroGoogleDir) }).Count -ne 1) { throw 'Nitro Google Sign-In generated directory is not guarded' }
Remove-StaleGeneratedBuildDirs $owned @($staleDir, $nitroGoogleDir) @($owned)
if (Test-Path $staleDir) { throw 'stale generated directory was not removed' }
if (Test-Path $nitroGoogleDir) { throw 'Nitro Google Sign-In stale generated directory was not removed' }
if (-not (Test-Path $sameDir)) { throw 'same-root generated directory was incorrectly removed' }
$sentinel = Join-Path $outside 'sentinel.txt'; 'keep' | Set-Content $sentinel
try { Remove-StaleGeneratedBuildDirs $owned @($outside) @($owned); throw 'outside target was not rejected' } catch { if (-not $_.Exception.Message.Contains('outside approved roots')) { throw } }
if (-not (Test-Path $sentinel)) { throw 'outside sentinel changed' }
$reparseTarget = Join-Path $owned 'reparse-target'; New-Item -ItemType Directory -Force $reparseTarget | Out-Null
$reparseLink = Join-Path $owned 'node_modules\react-native-nitro-google-signin\android\reparse.cxx'
try {
  New-Item -ItemType Junction -Path $reparseLink -Target $reparseTarget | Out-Null
  try { Remove-StaleGeneratedBuildDirs $owned @($reparseLink) @($owned); throw 'reparse target was not rejected' } catch { if (-not $_.Exception.Message.Contains('reparse')) { throw } }
  if (-not (Test-Path $reparseTarget)) { throw 'reparse target was changed' }
} finally {
  if (Test-Path $reparseLink) { Remove-Item -LiteralPath $reparseLink -Force }
  if (Test-Path $reparseTarget) { Remove-Item -LiteralPath $reparseTarget -Force -Recurse }
}
$tempResolved = (Resolve-Path -LiteralPath $tempRoot).Path
$tempRootResolved = (Resolve-Path -LiteralPath $env:TEMP).Path
if (-not $tempResolved.StartsWith($tempRootResolved + '\')) { throw 'temporary cleanup target escaped TEMP' }
[System.IO.Directory]::Delete($tempResolved, $true)
Write-Output '{"status":"PASS","staleRootInvalidated":true,"nitroGoogleSigninGuarded":true,"sameRootPreserved":true,"outsideTargetRejected":true,"reparseTargetRejected":true}'
