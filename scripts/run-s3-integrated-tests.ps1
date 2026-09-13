$ErrorActionPreference = 'Stop'
$logPath = Join-Path (Split-Path -Parent $PSScriptRoot) 'docs/receipts/s3-integrated-test-pack.log'
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $logPath) | Out-Null
$testFiles = @(
  'tests/services/authSessionHydration.test.ts', 'tests/ui/accountSurface.test.ts', 'tests/server/profile.test.ts',
  'tests/services/authSession.test.ts', 'tests/services/authSessionRace.test.ts', 'tests/services/apiClient.test.ts', 'tests/server/authBoundary.test.ts', 'tests/server/session.test.ts',
  'tests/storage/readerPosition.test.ts', 'tests/ui/readerLayoutContract.test.ts', 'tests/ui/completionFeedback.test.ts',
  'tests/ui/youVersionReader.test.ts', 'tests/storage/mobileRepository.test.ts', 'tests/storage/mobileDatabase.test.ts',
  'tests/server/groupSchedule.test.ts', 'tests/ui/groupContext.test.ts', 'tests/ui/groupContext.property.test.ts', 'tests/ui/groupLinkFallback.test.ts', 'tests/services/groupProfile.test.ts',
  'tests/services/reminderDevice.test.ts', 'tests/services/reminderLifecycle.test.ts', 'tests/services/reminderRuntime.test.ts', 'tests/services/reminderDelivery.test.ts', 'tests/services/reminderApiClient.test.ts',
  'tests/services/reminderScheduler.test.ts', 'tests/services/reminderReconciler.test.ts', 'tests/services/reminderCompletion.test.ts', 'tests/server/reminders.test.ts',
  'tests/server/fcmAuth.test.ts', 'tests/server/reminderWorker.test.ts', 'tests/integration/reminderWorkerBackend.test.ts',
  'tests/ui/reminderSettings.test.ts', 'tests/ui/todayAuthGate.test.ts', 'tests/services/audioSession.test.ts', 'tests/ui/contentPresentation.test.ts'
  'tests/ui/authenticatedSurface.test.ts', 'tests/ui/groupsIdentityBoundary.test.ts', 'tests/ui/reminderAuthorityBoundary.test.ts', 'tests/config/googleServicesWiring.test.ts'
)
$previousErrorActionPreference = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
& npx vitest run @testFiles 2>&1 | Tee-Object -FilePath $logPath
$testExitCode = $LASTEXITCODE
$preflightOutput = & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'build-preflight.ps1') 2>&1
$preflightExitCode = $LASTEXITCODE
$preflightOutput | Tee-Object -FilePath $logPath -Append
$ErrorActionPreference = $previousErrorActionPreference
if ($testExitCode -ne 0) { throw "S3 integrated test pack failed with exit code $testExitCode" }
if ($preflightExitCode -ne 0) { throw "S3 native/config preflight failed with exit code $preflightExitCode" }
Write-Output "log=$logPath"
Write-Output "sha256=$((Get-FileHash -LiteralPath $logPath -Algorithm SHA256).Hash.ToLower())"
