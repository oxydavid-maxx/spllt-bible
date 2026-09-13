Set-StrictMode -Version Latest

function Get-GoogleServicesBinding([string]$FilePath, [string]$ExpectedPackageName) {
  if (-not $FilePath -or -not (Test-Path -LiteralPath $FilePath -PathType Leaf)) { throw "Android Google Services file was not found: $FilePath" }
  $resolved = (Resolve-Path -LiteralPath $FilePath -ErrorAction Stop).Path
  $raw = Get-Content -LiteralPath $resolved -Raw
  try { $document = $raw | ConvertFrom-Json -ErrorAction Stop } catch { throw "Android Google Services JSON is invalid: $resolved" }
  $projectId = [string]$document.project_info.project_id
  if (-not $projectId.Trim()) { throw 'Android Google Services project_info.project_id is required' }
  $clients = @($document.client)
  $matches = @($clients | Where-Object { [string]$_.client_info.android_client_info.package_name -eq $ExpectedPackageName })
  if ($matches.Count -ne 1) { throw "Android Google Services client applicationId does not match $ExpectedPackageName" }
  $appId = [string]$matches[0].client_info.mobilesdk_app_id
  if (-not $appId.Trim()) { throw 'Android Google Services client_info.mobilesdk_app_id is required' }
  return [pscustomobject]@{
    sourcePath = $resolved
    sha256 = (Get-FileHash -LiteralPath $resolved -Algorithm SHA256).Hash.ToLowerInvariant()
    projectId = $projectId.Trim()
    appId = $appId.Trim()
    packageName = $ExpectedPackageName
    clientCount = $clients.Count
  }
}

function Stage-GoogleServicesFile([string]$ProjectRoot, [string]$FilePath, [string]$ExpectedPackageName) {
  $binding = Get-GoogleServicesBinding $FilePath $ExpectedPackageName
  $destination = Join-Path $ProjectRoot 'android\app\google-services.json'
  $destinationParent = Split-Path -Parent $destination
  New-Item -ItemType Directory -Force $destinationParent | Out-Null
  if (Test-Path -LiteralPath $destination) {
    $destinationItem = Get-Item -LiteralPath $destination -Force
    if (($destinationItem.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw "refusing reparse Google Services destination: $destination" }
  }
  Copy-Item -LiteralPath $binding.sourcePath -Destination $destination -Force
  return [pscustomobject]@{
    sourcePath = $binding.sourcePath
    sha256 = $binding.sha256
    projectId = $binding.projectId
    appId = $binding.appId
    packageName = $binding.packageName
    clientCount = $binding.clientCount
    stagedPath = $destination.Substring($ProjectRoot.Length + 1)
  }
}
