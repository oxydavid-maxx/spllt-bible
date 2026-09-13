$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$buildScript = Get-Content (Join-Path $root 'scripts\build-android.ps1') -Raw
. (Join-Path $PSScriptRoot 'google-services-boundary.ps1')
$defaultGradleHome = Join-Path $env:SystemDrive 'dev\g'
$defaultMetaspaceMiB = 768
$defaultMaxWorkers = 1
$boundaryOutput = & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'build-boundary.test.ps1')
$boundaryExitCode = $LASTEXITCODE
$actualBoundaryOutput = & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'build-boundary.actual.test.ps1')
$actualBoundaryExitCode = $LASTEXITCODE
$googleServicesOutput = & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'google-services-boundary.test.ps1')
$googleServicesExitCode = $LASTEXITCODE
$realGoogleServicesPath = Join-Path $root 'android\app\google-services.json'
$realGoogleServicesBinding = if (Test-Path -LiteralPath $realGoogleServicesPath) { Get-GoogleServicesBinding $realGoogleServicesPath 'org.qingmu.youth' } else { $null }
$checks = [ordered]@{
  nativeProject = Test-Path (Join-Path $root 'android\gradlew.bat')
  defaultGradleHome = $defaultGradleHome
  defaultGradleHomePathLength = $defaultGradleHome.Length
  defaultPathSafe = $defaultGradleHome.Length -lt 40 -and $defaultGradleHome -notmatch 'qingmu-android\\gradle-home'
  supportsProcessOverride = $buildScript.Contains('QINGMU_GRADLE_USER_HOME')
  defaultMetaspaceMiB = $defaultMetaspaceMiB
  defaultMaxWorkers = $defaultMaxWorkers
  resourceDefaultsInEntry = $buildScript -match 'else \{ 768 \}' -and $buildScript -match 'else \{ 1 \}' -and $buildScript -match 'MaxMetaspaceSize=\$\{maxMetaspaceMiB\}m' -and $buildScript -match 'max-workers=\$maxWorkers'
  staleRootBehaviorTest = $boundaryExitCode -eq 0 -and ($boundaryOutput -join [Environment]::NewLine) -match '"staleRootInvalidated":true'
  actualGeneratedNinjaProof = $actualBoundaryExitCode -eq 0 -and ($actualBoundaryOutput -join [Environment]::NewLine) -match 'currentRootObserved'
  generatedCxxInvalidationEntry = $buildScript.Contains('Remove-StaleGeneratedBuildDirs $root')
  nitroGoogleSigninBoundaryEntry = $buildScript.Contains('google-services-boundary.ps1') -and (Get-Content (Join-Path $root 'scripts\build-boundary.ps1') -Raw).Contains('react-native-nitro-google-signin')
  googleServicesBindingProof = $googleServicesExitCode -eq 0 -and ($googleServicesOutput -join [Environment]::NewLine) -match '"contentBound":true'
  realGoogleServicesBinding = $null -ne $realGoogleServicesBinding -and $realGoogleServicesBinding.projectId -eq 'qingmu-youth-test-20260908' -and $realGoogleServicesBinding.appId -eq '1:379502210828:android:7e4e832b3e0f6316312329'
}
if ($checks.Values -contains $false) { throw "build preflight failed: $($checks | ConvertTo-Json -Compress)" }
$receipt = [ordered]@{
  kind = 'build-preflight'
  status = 'PASS'
  checks = $checks
  scope = 'entry path only; no build, clean, emulator, or package install'
  staleRootHandling = 'inspect generated CMakeCache.txt/build.ninja for project or Gradle roots, reject reparse/outside targets, and delete only affected owned .cxx directories before build'
  googleServicesHandling = 'validate synthetic/official Android google-services.json project_id, mobilesdk_app_id, and applicationId, stage only android/app/google-services.json, and keep iOS deferred'
  googleServicesInput = if ($realGoogleServicesBinding) { [ordered]@{ path = 'android/app/google-services.json'; sha256 = $realGoogleServicesBinding.sha256; bytes = (Get-Item $realGoogleServicesPath).Length; projectId = $realGoogleServicesBinding.projectId; appId = $realGoogleServicesBinding.appId; packageName = $realGoogleServicesBinding.packageName } } else { $null }
}
$receiptPath = Join-Path $root 'docs\receipts\build-preflight.json'
New-Item -ItemType Directory -Force (Split-Path $receiptPath) | Out-Null
$receipt | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $receiptPath -Encoding utf8
$receipt | ConvertTo-Json -Depth 5
