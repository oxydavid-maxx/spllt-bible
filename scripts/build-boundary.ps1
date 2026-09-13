Set-StrictMode -Version Latest

function Normalize-BuildPath([string]$Value) {
  return ($Value -replace '/', '\').Trim().TrimEnd('\').ToLowerInvariant()
}

function Get-GeneratedBuildDirs([string]$ProjectRoot) {
  return @(
    (Join-Path $ProjectRoot 'android\app\.cxx'),
    (Join-Path $ProjectRoot 'node_modules\react-native-screens\android\.cxx'),
    (Join-Path $ProjectRoot 'node_modules\react-native-reanimated\android\.cxx'),
    (Join-Path $ProjectRoot 'node_modules\react-native-worklets\android\.cxx'),
    (Join-Path $ProjectRoot 'node_modules\react-native-gesture-handler\android\.cxx'),
    (Join-Path $ProjectRoot 'node_modules\react-native-mmkv\android\.cxx'),
    (Join-Path $ProjectRoot 'node_modules\react-native-nitro-google-signin\android\.cxx'),
    (Join-Path $ProjectRoot 'node_modules\react-native-nitro-modules\android\.cxx'),
    (Join-Path $ProjectRoot 'node_modules\expo\node_modules\expo-modules-core\android\.cxx')
  )
}

function Get-ReferencedProjectScopedPaths([string]$Text) {
  $normalized = $Text -replace '/', '\'
  $matches = [regex]::Matches($normalized, '(?i)([A-Za-z]:\\[^\s"'';]+)')
  foreach ($match in $matches) {
    $value = $match.Groups[1].Value.TrimEnd(')', ',', ';')
    if ($value -match '(?i)\\(?:android|node_modules|\.cxx|build\\intermediates\\cxx)(?:\\|$)') { $value }
  }
}

function Get-ReferencedGradleRoots([string]$Text) {
  $normalized = $Text -replace '/', '\'
  $roots = New-Object System.Collections.Generic.HashSet[string]([System.StringComparer]::OrdinalIgnoreCase)
  $matches = [regex]::Matches($normalized, '(?i)([A-Za-z]:\\[^\s"'';]+?)(?:\\caches\\|\\wrapper\\)')
  foreach ($match in $matches) { [void]$roots.Add((Normalize-BuildPath $match.Groups[1].Value)) }
  return @($roots)
}

function Get-StaleGeneratedBuildDirs([string]$ProjectRoot, [string]$EffectiveGradleHome, [string[]]$GeneratedDirs) {
  $project = Normalize-BuildPath $ProjectRoot
  $effective = Normalize-BuildPath $EffectiveGradleHome
  $markerPath = Join-Path $ProjectRoot 'android\.qingmu-gradle-home'
  $marker = if (Test-Path -LiteralPath $markerPath) { Normalize-BuildPath (Get-Content -LiteralPath $markerPath -Raw) } else { $null }
  $stale = New-Object System.Collections.Generic.HashSet[string]([System.StringComparer]::OrdinalIgnoreCase)
  foreach ($dir in $GeneratedDirs) {
    if (-not (Test-Path -LiteralPath $dir)) { continue }
    if ($marker -and $marker -ne $effective) { [void]$stale.Add($dir); continue }
    $metadata = Get-ChildItem -LiteralPath $dir -Recurse -File -Include 'CMakeCache.txt','build.ninja' -ErrorAction SilentlyContinue
    foreach ($file in $metadata) {
      $text = Get-Content -LiteralPath $file.FullName -Raw
      $roots = Get-ReferencedGradleRoots $text
      if ($roots | Where-Object { $_ -ne $effective }) { [void]$stale.Add($dir); break }
      $projectPaths = Get-ReferencedProjectScopedPaths $text
      if ($projectPaths | Where-Object { -not (Normalize-BuildPath $_).StartsWith($project + '\') }) { [void]$stale.Add($dir); break }
    }
  }
  return @($stale)
}

function Remove-StaleGeneratedBuildDirs([string]$ProjectRoot, [string[]]$Dirs, [string[]]$ApprovedRoots) {
  $project = Normalize-BuildPath $ProjectRoot
  $approved = @($ApprovedRoots | ForEach-Object { Normalize-BuildPath $_ })
  foreach ($dir in $Dirs) {
    $rawItem = Get-Item -LiteralPath $dir -Force -ErrorAction Stop
    if (($rawItem.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw "refusing reparse point generated target: $($rawItem.FullName)" }
    $resolved = (Resolve-Path -LiteralPath $dir -ErrorAction Stop).Path
    $normalized = Normalize-BuildPath $resolved
    if (-not $normalized.EndsWith('\.cxx')) { throw "refusing non-CMake generated target: $resolved" }
    if (-not ($approved | Where-Object { $normalized.StartsWith($_ + '\') })) { throw "refusing generated target outside approved roots: $resolved" }
    $reparse = @(Get-ChildItem -LiteralPath $resolved -Force -Recurse -ErrorAction Stop | Where-Object { ($_.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0 })
    if ($reparse.Count -gt 0) { throw "refusing reparse point inside generated target: $($reparse[0].FullName)" }
    [System.IO.Directory]::Delete($resolved, $true)
  }
}
