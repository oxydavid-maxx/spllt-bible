function Assert-QingmuReleaseEnvironment {
  param([Parameter(Mandatory = $true)][string]$ProjectRoot)

  $envRequired = @{
    'EXPO_PUBLIC_YOUVERSION_APP_KEY' = 'the reader cannot initialise without it'
    'EXPO_PUBLIC_QINGMU_API_BASE_URL' = 'the app has no backend without it'
    'EXPO_PUBLIC_QINGMU_YV_TEXT_PROBE' = 'gates the reader itself; must be exactly true'
  }
  # Only these two flags have a meaningful disabled value. Tokens, dates and URLs never do.
  $envForbiddenFlags = @('EXPO_PUBLIC_QINGMU_FIXTURE', 'EXPO_PUBLIC_QINGMU_QA_TEST_AUDIO')
  $envForbiddenValues = @(
    'EXPO_PUBLIC_QINGMU_DEV_TOKEN', 'EXPO_PUBLIC_QINGMU_TEST_DATE',
    'EXPO_PUBLIC_QINGMU_QA_AUDIO_URI', 'EXPO_PUBLIC_QINGMU_AUDIO_URI'
  )
  $envOptional = @(
    'EXPO_PUBLIC_GOOGLE_ANDROID_SERVICES_FILE', 'EXPO_PUBLIC_GOOGLE_IOS_SERVICES_FILE',
    'EXPO_PUBLIC_GOOGLE_IOS_URL_SCHEME', 'EXPO_PUBLIC_GOOGLE_CLIENT_ID',
    'EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID', 'EXPO_PUBLIC_QINGMU_AUDIO_AUTHORIZED'
  )
  # Keep the classification tied to the app source: new bundle inputs must be classified explicitly.
  $sourceRoots = @('app', 'src', 'plugins', 'app.config.js') |
    ForEach-Object { Join-Path $ProjectRoot $_ } | Where-Object { Test-Path $_ }
  $readByApp = Get-ChildItem -Path $sourceRoots -Recurse -File -Include '*.ts', '*.tsx', '*.js' -ErrorAction SilentlyContinue |
    Select-String -Pattern 'EXPO_PUBLIC_[A-Z0-9_]+' -AllMatches |
    ForEach-Object { $_.Matches.Value } | Sort-Object -Unique
  $classified = @($envRequired.Keys) + $envForbiddenFlags + $envForbiddenValues + $envOptional
  $unclassified = $readByApp | Where-Object { $classified -notcontains $_ }
  if ($unclassified) {
    throw "Unclassified EXPO_PUBLIC_ variables read by the app: $($unclassified -join ', '). Classify them in scripts/release-environment.ps1."
  }
  foreach ($name in $envRequired.Keys) {
    if ([string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable($name))) {
      throw "$name is required for release builds: $($envRequired[$name]). Set the process variable or private build binding."
    }
  }
  if ($env:EXPO_PUBLIC_QINGMU_YV_TEXT_PROBE -cne 'true') {
    throw "EXPO_PUBLIC_QINGMU_YV_TEXT_PROBE must be exactly 'true' for release builds."
  }
  foreach ($name in $envForbiddenFlags) {
    $value = [Environment]::GetEnvironmentVariable($name)
    if (-not [string]::IsNullOrEmpty($value) -and $value -cne 'false') {
      throw "$name must be unset or exactly 'false' for release builds."
    }
  }
  foreach ($name in $envForbiddenValues) {
    if (-not [string]::IsNullOrEmpty([Environment]::GetEnvironmentVariable($name))) {
      throw "$name must be unset for release builds."
    }
  }
  if ($env:EXPO_PUBLIC_QINGMU_API_BASE_URL -match '127\.0\.0\.1|localhost') {
    throw 'EXPO_PUBLIC_QINGMU_API_BASE_URL must not point at localhost or 127.0.0.1 for release builds.'
  }
}
