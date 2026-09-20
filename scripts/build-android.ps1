param(
  [switch]$SkipReceipt,
  [ValidateSet('debug', 'release')]
  [string]$Variant = 'debug',
  [string]$ReactNativeArchitectures,
  [string]$LogPath,
  [switch]$LegacyPackaging
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
# The toolchain lives under the governed dev root, not in AppData. The old default outlived the
# move and turned a relocated toolchain into "JDK not found", which reads like a missing install
# rather than a stale path.
$toolRoot = if ($env:QINGMU_ANDROID_TOOL_ROOT) { $env:QINGMU_ANDROID_TOOL_ROOT } else { 'C:\dev\tools\qingmu-android' }
# The cache is kept apart from the toolchain and its depth is capped on purpose. Long paths are
# disabled on this machine, and ninja stats prefab headers through this cache while re-checking
# globbed directories; the deepest one it reaches is 223 characters below the cache root
# (react/renderer/uimanager/consistency/LazyShadowTreeRevisionConsistencyManager.h), so a root of
# 39 characters put it at 262 and the C++ build stopped. This root is 26, which leaves 11 to spare.
# Not every path here fits in 260 — some are 281 and are never stat-ed — so the budget is about
# the headers ninja actually touches rather than about the cache as a whole.
$defaultGradleHome = 'C:\dev\machine\gradle-home'
$maxWorkers = if ($env:QINGMU_GRADLE_MAX_WORKERS) { [int]$env:QINGMU_GRADLE_MAX_WORKERS } else { 1 }
$maxMetaspaceMiB = if ($env:QINGMU_GRADLE_MAX_METASPACE_MIB) { [int]$env:QINGMU_GRADLE_MAX_METASPACE_MIB } else { 768 }
# Heap was hardcoded at 1536m. A four-ABI release packageRelease died with
# "java.lang.OutOfMemoryError: Java heap space" while two AVDs held ~7.6 GB, so the ceiling has to be
# raisable the same way metaspace already is. Default is unchanged, so no existing build shifts.
$maxHeapMiB = if ($env:QINGMU_GRADLE_MAX_HEAP_MIB) { [int]$env:QINGMU_GRADLE_MAX_HEAP_MIB } else { 1536 }
if ($maxWorkers -lt 1) { throw "QINGMU_GRADLE_MAX_WORKERS must be at least 1" }
if ($maxMetaspaceMiB -lt 512) { throw "QINGMU_GRADLE_MAX_METASPACE_MIB must be at least 512" }
if ($maxHeapMiB -lt 1024) { throw "QINGMU_GRADLE_MAX_HEAP_MIB must be at least 1024" }
$javaHome = if ($env:JAVA_HOME) { $env:JAVA_HOME } else { Join-Path $toolRoot 'jdk-17.0.20.1+1' }
$sdkRoot = if ($env:ANDROID_SDK_ROOT) { $env:ANDROID_SDK_ROOT } elseif ($env:ANDROID_HOME) { $env:ANDROID_HOME } else { Join-Path $toolRoot 'sdk' }
$gradlew = Join-Path $root 'android\gradlew.bat'

if (-not (Test-Path $gradlew)) { throw "Android native project is missing: $gradlew" }
if (-not (Test-Path $javaHome)) { throw "JDK not found at $javaHome; use the bounded environment owner toolchain" }
if (-not (Test-Path $sdkRoot)) { throw "Android SDK not found at $sdkRoot; use the bounded environment owner toolchain" }

$env:JAVA_HOME = $javaHome
$env:ANDROID_SDK_ROOT = $sdkRoot
$env:ANDROID_HOME = $sdkRoot
$env:GRADLE_USER_HOME = if ($env:QINGMU_GRADLE_USER_HOME) { $env:QINGMU_GRADLE_USER_HOME } else { $defaultGradleHome }
$env:QINGMU_BUILD_STARTED_UTC = [DateTime]::UtcNow.ToString('o')
. (Join-Path $PSScriptRoot 'build-boundary.ps1')
. (Join-Path $PSScriptRoot 'build-dom-boundary.ps1')
. (Join-Path $PSScriptRoot 'google-services-boundary.ps1')

# Load a private YouVersion App Key only into this build process. The file is
# never copied, logged, hashed, or written into a receipt/source artifact.
$yvEnvFile = $env:QINGMU_YOUVERSION_ENV_FILE
if ($yvEnvFile -and (Test-Path -LiteralPath $yvEnvFile)) {
  foreach ($line in Get-Content -LiteralPath $yvEnvFile) {
    if ($line -match '^EXPO_PUBLIC_YOUVERSION_APP_KEY=(.+)$' -and -not $env:EXPO_PUBLIC_YOUVERSION_APP_KEY) {
      $env:EXPO_PUBLIC_YOUVERSION_APP_KEY = $Matches[1].Trim()
    }
  }
}

# Load non-secret Google OAuth client metadata only into this build process. The
# client IDs and reversed iOS scheme are public OAuth identifiers; no client
# secret or token is copied, logged, hashed, or written into receipts/source.
$googleConfigFile = $env:QINGMU_GOOGLE_CONFIG_FILE
if ($googleConfigFile -and (Test-Path -LiteralPath $googleConfigFile)) {
  $googleConfig = [IO.File]::ReadAllText($googleConfigFile) | ConvertFrom-Json
  if (-not $env:EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID -and $googleConfig.clients.web.client_id) {
    $env:EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID = [string]$googleConfig.clients.web.client_id
  }
  if (-not $env:EXPO_PUBLIC_GOOGLE_IOS_URL_SCHEME -and $googleConfig.clients.ios.reversed_client_id_scheme) {
    $env:EXPO_PUBLIC_GOOGLE_IOS_URL_SCHEME = [string]$googleConfig.clients.ios.reversed_client_id_scheme
  }
}

# Bind the official Android Firebase/Google Services file independently of the
# deferred iOS plist. Read only an explicitly configured file or the native
# project's existing file; do not search the developer's Downloads directory.
$googleAndroidServicesFile = if ($env:QINGMU_GOOGLE_ANDROID_SERVICES_FILE) {
  $env:QINGMU_GOOGLE_ANDROID_SERVICES_FILE
} elseif ($env:EXPO_PUBLIC_GOOGLE_ANDROID_SERVICES_FILE) {
  $env:EXPO_PUBLIC_GOOGLE_ANDROID_SERVICES_FILE
} else {
  $ownedCandidate = Join-Path $root 'android\app\google-services.json'
  if (Test-Path -LiteralPath $ownedCandidate) { $ownedCandidate }
  else { $null }
}
$googleAndroidServicesBinding = $null
if ($googleAndroidServicesFile) {
  $ownedGoogleServicesPath = [IO.Path]::GetFullPath((Join-Path $root 'android\app\google-services.json'))
  if ([IO.Path]::GetFullPath($googleAndroidServicesFile) -eq $ownedGoogleServicesPath) {
    $binding = Get-GoogleServicesBinding $googleAndroidServicesFile 'org.qingmu.youth'
    $googleAndroidServicesBinding = [pscustomobject]@{ sourcePath = $binding.sourcePath; sha256 = $binding.sha256; projectId = $binding.projectId; appId = $binding.appId; packageName = $binding.packageName; clientCount = $binding.clientCount; stagedPath = 'android\app\google-services.json' }
  } else {
    $googleAndroidServicesBinding = Stage-GoogleServicesFile $root $googleAndroidServicesFile 'org.qingmu.youth'
  }
  $env:EXPO_PUBLIC_GOOGLE_ANDROID_SERVICES_FILE = $googleAndroidServicesBinding.sourcePath
}

# Expo SDK 56's Hermes V1 build is known to have a memory regression. Expo 56
# requires the native project and export configuration to agree, so this
# candidate keeps Hermes enabled and constrains Gradle memory/workers below.
$gradleProperties = Join-Path $root 'android\gradle.properties'
$gradlePropertiesBefore = Get-Content $gradleProperties -Raw
$gradlePropertiesAfter = $gradlePropertiesBefore -replace 'hermesEnabled=false', 'hermesEnabled=true'
if ($gradlePropertiesAfter -cne $gradlePropertiesBefore) {
  Set-Content -LiteralPath $gradleProperties -Value $gradlePropertiesAfter -Encoding utf8
}

$gradleTask = if ($Variant -eq 'release') { 'assembleRelease' } else { 'assembleDebug' }
$fixtureEnabled = $env:EXPO_PUBLIC_QINGMU_FIXTURE -eq 'true'
$buildProfile = if ($fixtureEnabled) { 'QA_CORE_FIXTURE_ONLY' } else { 'PILOT_GOOGLE_HTTPS' }
$logPath = if ($LogPath) {
  if ([IO.Path]::IsPathRooted($LogPath)) { $LogPath } else { Join-Path $root $LogPath }
} else {
  Join-Path $root "docs\receipts\android-$Variant-gradle.log"
}
New-Item -ItemType Directory -Force (Split-Path $logPath) | Out-Null
"QINGMU_GRADLE_USER_HOME=$env:GRADLE_USER_HOME" | Set-Content -LiteralPath $logPath -Encoding utf8
$knownCxxDirs = Get-GeneratedBuildDirs $root
$staleCxxDirs = @(Get-StaleGeneratedBuildDirs $root $env:GRADLE_USER_HOME $knownCxxDirs)
if ($staleCxxDirs.Count -gt 0) {
  Remove-StaleGeneratedBuildDirs $root $staleCxxDirs @($root, (Join-Path $root 'node_modules'))
  $staleCxxDirs = @($staleCxxDirs | ForEach-Object { $_.Substring($root.Length + 1) })
}
$domAssetPublication = Clear-QingmuDomAssetPublication -ProjectRoot $root -Variant $Variant
if ($Variant -eq 'release') {
  $releaseSigningProperties = $env:QINGMU_RELEASE_SIGNING_PROPERTIES
  if (-not $releaseSigningProperties) { throw 'QINGMU_RELEASE_SIGNING_PROPERTIES is required for release builds' }
  if (-not (Test-Path -LiteralPath $releaseSigningProperties)) { throw "Release signing properties are missing: $releaseSigningProperties" }

  # The API base url is inlined into the JS bundle at bundle time. Unset, it falls back to
  # http://127.0.0.1:8787, which on a phone is the phone itself: the app builds, installs, signs and
  # launches, and every request fails. A release that points at localhost is indistinguishable from a
  # good one until somebody opens it, so it is refused here instead.
  $apiBaseUrl = $env:EXPO_PUBLIC_QINGMU_API_BASE_URL
  if (-not $apiBaseUrl) { throw 'EXPO_PUBLIC_QINGMU_API_BASE_URL is required for release builds; without it the bundle points at 127.0.0.1' }
  if ($apiBaseUrl -match '127\.0\.0\.1|localhost') { throw "A release cannot point at the build machine: $apiBaseUrl" }

  # assembleRelease never reads app.json. Expo writes the version into android/app/build.gradle at
  # prebuild time, and android/ is untracked, so the two drift silently: a build announced as 0.4.0
  # installs and reports itself as whatever the native project still says. Same class of defect as
  # the base url — it looks finished and is wrong only where somebody has to notice it.
  $appConfig = Get-Content -LiteralPath (Join-Path $root 'app.json') -Raw -Encoding utf8 | ConvertFrom-Json
  $gradleText = Get-Content -LiteralPath (Join-Path $root 'android/app/build.gradle') -Raw
  $gradleName = [regex]::Match($gradleText, 'versionName\s+"([^"]+)"').Groups[1].Value
  $gradleCode = [regex]::Match($gradleText, 'versionCode\s+(\d+)').Groups[1].Value
  if ($gradleName -ne $appConfig.expo.version -or [int]$gradleCode -ne [int]$appConfig.expo.android.versionCode) {
    throw "Version drift: app.json says $($appConfig.expo.version)/$($appConfig.expo.android.versionCode), android/app/build.gradle says $gradleName/$gradleCode. Update the native project or re-run prebuild."
  }

  $argumentsReleaseSigning = '-PqingmuRelease=true'
}
$arguments = @(
  $gradleTask,
  '--no-daemon',
  "--max-workers=$maxWorkers",
  '--stacktrace',
  "-Dorg.gradle.jvmargs=-Xmx${maxHeapMiB}m -XX:MaxMetaspaceSize=${maxMetaspaceMiB}m -Dfile.encoding=UTF-8",
  "-Dorg.gradle.workers.max=$maxWorkers",
  '-Dorg.gradle.parallel=false'
)
if ($Variant -eq 'release') { $arguments += $argumentsReleaseSigning }
if ($ReactNativeArchitectures) {
  $arguments += "-PreactNativeArchitectures=$ReactNativeArchitectures"
}
if ($LegacyPackaging) {
  $arguments += '-Pexpo.useLegacyPackaging=true'
}
$architectureArgument = if ($ReactNativeArchitectures) { " -PreactNativeArchitectures=$ReactNativeArchitectures" } else { '' }
$packagingArgument = if ($LegacyPackaging) { ' -Pexpo.useLegacyPackaging=true' } else { '' }
$releaseArgument = if ($Variant -eq 'release') { ' -PqingmuRelease=true' } else { '' }
if ($env:QINGMU_GRADLE_FRESH -eq 'true') {
  $arguments += @('--refresh-dependencies', '--no-build-cache')
}
Push-Location (Join-Path $root 'android')
try {
  $previousErrorActionPreference = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  & $gradlew @arguments 2>&1 | Tee-Object -FilePath $logPath -Append
  $gradleExitCode = $LASTEXITCODE
  $ErrorActionPreference = $previousErrorActionPreference
  if ($gradleExitCode -ne 0) { throw "Gradle failed with exit code $gradleExitCode" }
} finally {
  $ErrorActionPreference = 'Stop'
  Pop-Location
}
$markerPath = Join-Path $root 'android\.qingmu-gradle-home'
$env:GRADLE_USER_HOME | Set-Content -LiteralPath $markerPath -Encoding utf8

$apkDirectory = if ($Variant -eq 'release') { 'release' } else { 'debug' }
$apkName = if ($Variant -eq 'release') { 'app-release.apk' } else { 'app-debug.apk' }
$apk = Join-Path $root "android\app\build\outputs\apk\$apkDirectory\$apkName"
if (-not (Test-Path $apk)) { throw "Gradle completed but APK was not found: $apk" }
$hash = (Get-FileHash $apk -Algorithm SHA256).Hash.ToLowerInvariant()
$receipt = [ordered]@{
  kind = "android-$Variant-candidate"
  profile = $buildProfile
  variant = $Variant
  fixture = $fixtureEnabled
  command = ".\gradlew.bat $gradleTask --no-daemon --max-workers=$maxWorkers --stacktrace -Dorg.gradle.jvmargs=-Xmx${maxHeapMiB}m -XX:MaxMetaspaceSize=${maxMetaspaceMiB}m -Dfile.encoding=UTF-8 -Dorg.gradle.workers.max=$maxWorkers -Dorg.gradle.parallel=false$architectureArgument$packagingArgument$releaseArgument"
  reactNativeArchitectures = if ($ReactNativeArchitectures) { $ReactNativeArchitectures } else { $null }
  legacyPackaging = $LegacyPackaging.IsPresent
  maxWorkers = $maxWorkers
  maxMetaspaceMiB = $maxMetaspaceMiB
  maxHeapMiB = $maxHeapMiB
  javaHome = $javaHome
  androidSdkRoot = $sdkRoot
  gradleUserHome = $env:GRADLE_USER_HOME
  staleCxxDirsInvalidated = $staleCxxDirs
  domAssetPublicationReset = $domAssetPublication
  youVersionVersionId = if ($env:EXPO_PUBLIC_YOUVERSION_VERSION_ID) { $env:EXPO_PUBLIC_YOUVERSION_VERSION_ID } else { $null }
  youVersionAppKeyPresent = [bool]($env:EXPO_PUBLIC_YOUVERSION_APP_KEY)
  audioAuthorized = $env:EXPO_PUBLIC_QINGMU_AUDIO_AUTHORIZED -eq 'true'
  qaAudioFlagEnabled = $env:EXPO_PUBLIC_QINGMU_QA_TEST_AUDIO -eq 'true'
  qaAudioUriPresent = [bool]($env:EXPO_PUBLIC_QINGMU_AUDIO_URI)
  fixtureBackend = if ($fixtureEnabled) { 'two-member-week process env' } else { 'not enabled' }
  googleOAuthConfigPresent = [bool]($googleConfigFile -and (Test-Path -LiteralPath $googleConfigFile))
  googleAndroidServices = if ($googleAndroidServicesBinding) {
    [ordered]@{
      present = $true
      sha256 = $googleAndroidServicesBinding.sha256
      projectId = $googleAndroidServicesBinding.projectId
      appId = $googleAndroidServicesBinding.appId
      packageName = $googleAndroidServicesBinding.packageName
      stagedPath = $googleAndroidServicesBinding.stagedPath
    }
  } else {
    [ordered]@{ present = $false; sha256 = $null; projectId = $null; appId = $null; packageName = $null; stagedPath = $null }
  }
  toolchainReceiptSha256 = if (Test-Path (Join-Path $toolRoot 'toolchain-receipt.json')) { (Get-FileHash (Join-Path $toolRoot 'toolchain-receipt.json') -Algorithm SHA256).Hash.ToLowerInvariant() } else { $null }
  apk = $apk.Substring($root.Length + 1)
  apkSha256 = $hash
  gradleExitCode = 0
  logPath = $logPath.Substring($root.Length + 1)
  selfContained = $Variant -eq 'release'
  signingConfig = if ($Variant -eq 'release') {
    if ($fixtureEnabled) { 'owner-controlled-release-keystore-fixture' } else { 'owner-controlled-release-keystore' }
  } else { 'debug' }
  completedAtUtc = [DateTime]::UtcNow.ToString('o')
}
if (-not $SkipReceipt) {
  $receiptPath = Join-Path $root 'docs\receipts\build-receipt.json'
  New-Item -ItemType Directory -Force (Split-Path $receiptPath) | Out-Null
  $receipt | ConvertTo-Json -Depth 5 | Set-Content -Encoding utf8 $receiptPath
}
$receipt | ConvertTo-Json -Depth 5
