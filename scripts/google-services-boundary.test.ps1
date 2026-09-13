$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'google-services-boundary.ps1')
$tempRoot = Join-Path $env:TEMP ("qingmu-google-services-" + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force $tempRoot | Out-Null
try {
  $fixturePath = Join-Path $tempRoot 'google-services.json'
  $fixture = [ordered]@{
    project_info = [ordered]@{ project_id = 'fixture-project' }
    client = @([ordered]@{ client_info = [ordered]@{ mobilesdk_app_id = '1:123:android:fixture'; android_client_info = [ordered]@{ package_name = 'org.qingmu.youth' } }; api_key = @([ordered]@{ current_key = 'AIzaFixtureKeyIsNotLogged' }) })
  }
  $fixture | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $fixturePath -Encoding utf8
  $binding = Get-GoogleServicesBinding $fixturePath 'org.qingmu.youth'
  if ($binding.projectId -ne 'fixture-project' -or $binding.appId -ne '1:123:android:fixture' -or $binding.packageName -ne 'org.qingmu.youth') { throw 'synthetic Android Google Services binding mismatch' }
  if ($binding.PSObject.Properties.Name -contains 'apiKey') { throw 'private or transport key leaked into binding' }
  $projectRoot = Join-Path $tempRoot 'project'
  $staged = Stage-GoogleServicesFile $projectRoot $fixturePath 'org.qingmu.youth'
  if ($staged.stagedPath -ne 'android\app\google-services.json' -or -not (Test-Path (Join-Path $projectRoot $staged.stagedPath))) { throw 'Android Google Services staging failed' }
  if ((Get-FileHash -LiteralPath (Join-Path $projectRoot $staged.stagedPath) -Algorithm SHA256).Hash.ToLowerInvariant() -ne $binding.sha256) { throw 'staged Android Google Services content changed' }
  try { [void](Get-GoogleServicesBinding $fixturePath 'org.other.app'); throw 'package mismatch was not rejected' } catch { if (-not $_.Exception.Message.Contains('applicationId')) { throw } }
  Write-Output '{"status":"PASS","androidOnly":true,"contentBound":true,"packageBound":true,"secretFieldsExcluded":true,"stagedOwnedPath":true,"mismatchRejected":true}'
} finally {
  if (Test-Path $tempRoot) { Remove-Item -LiteralPath $tempRoot -Recurse -Force }
}
