$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'build-boundary.ps1')
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$cxx = Join-Path $projectRoot 'android\app\.cxx'
$effectiveGradleHome = Join-Path $env:SystemDrive 'dev\g'
$normalizedEffectiveGradleHome = $effectiveGradleHome.Replace('\\', '/').ToLowerInvariant()
$ninjaFiles = @(Get-ChildItem $cxx -Recurse -Filter build.ninja -File -ErrorAction SilentlyContinue)
if ($ninjaFiles.Count -eq 0) { throw 'actual generated Ninja metadata was not found' }
$roots = @()
foreach ($file in $ninjaFiles) { $roots += @(Get-ReferencedGradleRoots (Get-Content -LiteralPath $file.FullName -Raw)) }
if (-not ($roots -contains $normalizedEffectiveGradleHome)) { throw "actual Ninja metadata did not contain current root ${normalizedEffectiveGradleHome}: $($roots -join ',')" }
$stale = @(Get-StaleGeneratedBuildDirs $projectRoot $effectiveGradleHome @($cxx))
Write-Output (ConvertTo-Json ([ordered]@{ status = 'PASS'; actualNinjaFiles = $true; currentRootObserved = $true; staleDetectedForInvalidation = ($stale.Count -gt 0); staleCount = $stale.Count }))
