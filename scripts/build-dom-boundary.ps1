function Get-QingmuDomAssetRoot {
  param(
    [Parameter(Mandatory = $true)][string]$ProjectRoot,
    [Parameter(Mandatory = $true)][ValidateSet('debug', 'release')][string]$Variant
  )
  $project = (Resolve-Path -LiteralPath $ProjectRoot).Path
  $buildPath = Join-Path $project 'android\app\build'
  if (-not (Test-Path -LiteralPath $buildPath)) { New-Item -ItemType Directory -Force -Path $buildPath | Out-Null }
  $buildRoot = (Resolve-Path -LiteralPath $buildPath).Path
  $variantRoot = (Resolve-Path -LiteralPath (Join-Path $buildRoot "generated\assets\react\$Variant") -ErrorAction SilentlyContinue)
  if (-not $variantRoot) {
    return Join-Path $buildRoot "generated\assets\react\$Variant\www.bundle"
  }
  return Join-Path $variantRoot.Path 'www.bundle'
}

function Get-QingmuRelativePath {
  param(
    [Parameter(Mandatory = $true)][string]$Base,
    [Parameter(Mandatory = $true)][string]$Path
  )
  $baseFull = (Resolve-Path -LiteralPath $Base).Path.TrimEnd('\')
  $pathFull = (Resolve-Path -LiteralPath $Path).Path
  if (-not $pathFull.StartsWith($baseFull + '\', [StringComparison]::OrdinalIgnoreCase)) {
    throw "Path is outside approved base: $pathFull"
  }
  return $pathFull.Substring($baseFull.Length + 1).Replace('\', '/')
}

function Assert-QingmuDomAssetTarget {
  param(
    [Parameter(Mandatory = $true)][string]$ProjectRoot,
    [Parameter(Mandatory = $true)][ValidateSet('debug', 'release')][string]$Variant,
    [Parameter(Mandatory = $true)][string]$Target
  )
  $project = (Resolve-Path -LiteralPath $ProjectRoot).Path
  $buildRoot = (Resolve-Path -LiteralPath (Join-Path $project 'android\app\build')).Path
  $allowedRoot = (Resolve-Path -LiteralPath (Join-Path $buildRoot "generated\assets\react\$Variant") -ErrorAction SilentlyContinue)
  if (-not $allowedRoot) { throw 'DOM asset variant root is missing' }
  $resolvedTarget = (Resolve-Path -LiteralPath $Target).Path
  if (-not $resolvedTarget.StartsWith($allowedRoot.Path + '\', [StringComparison]::OrdinalIgnoreCase) -or (Split-Path -Leaf $resolvedTarget) -ne 'www.bundle') {
    throw "DOM asset cleanup target escaped approved generated root: $resolvedTarget"
  }
  return $resolvedTarget
}

function Clear-QingmuDomAssetPublication {
  param(
    [Parameter(Mandatory = $true)][string]$ProjectRoot,
    [Parameter(Mandatory = $true)][ValidateSet('debug', 'release')][string]$Variant
  )
  $target = Get-QingmuDomAssetRoot -ProjectRoot $ProjectRoot -Variant $Variant
  if (-not (Test-Path -LiteralPath $target)) {
    return [pscustomobject]@{ target = $target; existed = $false; removed = $false }
  }
  $resolved = Assert-QingmuDomAssetTarget -ProjectRoot $ProjectRoot -Variant $Variant -Target $target
  $count = @(Get-ChildItem -LiteralPath $resolved -Recurse -File).Count
  Remove-Item -LiteralPath $resolved -Recurse -Force
  return [pscustomobject]@{ target = $resolved; existed = $true; removed = $true; removedFiles = $count }
}

function Test-QingmuDomAssetPublication {
  param(
    [Parameter(Mandatory = $true)][string]$ProjectRoot,
    [Parameter(Mandatory = $true)][ValidateSet('debug', 'release')][string]$Variant
  )
  $target = Get-QingmuDomAssetRoot -ProjectRoot $ProjectRoot -Variant $Variant
  if (-not (Test-Path -LiteralPath $target)) { throw "DOM asset publication is missing: $target" }
  $resolved = Assert-QingmuDomAssetTarget -ProjectRoot $ProjectRoot -Variant $Variant -Target $target
  $root = (Resolve-Path -LiteralPath $resolved).Path
  $files = @(Get-ChildItem -LiteralPath $root -Recurse -File)
  $referenced = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
  $unresolved = [Collections.Generic.List[string]]::new()
  foreach ($html in @($files | Where-Object Extension -eq '.html')) {
    $htmlRelative = Get-QingmuRelativePath -Base $root -Path $html.FullName
    [void]$referenced.Add($htmlRelative)
    $text = Get-Content -LiteralPath $html.FullName -Raw
    foreach ($match in [regex]::Matches($text, '<script[^>]+src=["'']([^"'']+)["'']')) {
      $asset = $match.Groups[1].Value.TrimStart('./').Replace('/', '\')
      $assetPath = Join-Path $root $asset
      if (-not (Test-Path -LiteralPath $assetPath -PathType Leaf)) {
        [void]$unresolved.Add($asset)
      } else {
        [void]$referenced.Add($asset.Replace('\', '/'))
      }
    }
  }
  $webRoot = Join-Path $root '_expo\static\js\web'
  foreach ($js in @($files | Where-Object Extension -eq '.js')) {
    $jsRelative = Get-QingmuRelativePath -Base $root -Path $js.FullName
    if (-not $referenced.Contains($jsRelative)) { continue }
    $text = Get-Content -LiteralPath $js.FullName -Raw
    foreach ($match in [regex]::Matches($text, 'sourceMappingURL=([^\s]+)')) {
      $map = $match.Groups[1].Value.Trim()
      $mapFromRoot = $false
      if ($map -match '/node_modules/expo/dom/(.+)$') { $map = $Matches[1]; $mapFromRoot = $true }
      $map = $map.TrimStart('/')
      $mapPath = if ($mapFromRoot) { Join-Path $root $map } else { Join-Path (Split-Path -Parent $js.FullName) $map }
      if (-not (Test-Path -LiteralPath $mapPath -PathType Leaf)) {
        [void]$unresolved.Add("$jsRelative -> $map")
      } else {
        [void]$referenced.Add((Get-QingmuRelativePath -Base $root -Path $mapPath))
      }
    }
    foreach ($match in [regex]::Matches($text, '(?:empty-module|YouVersionAuthProvider)-[A-Za-z0-9-]+\.js')) {
      $dependencyPath = Join-Path $webRoot $match.Value
      if (-not (Test-Path -LiteralPath $dependencyPath -PathType Leaf)) {
        [void]$unresolved.Add("$jsRelative -> $($match.Value)")
      } else {
        [void]$referenced.Add((Get-QingmuRelativePath -Base $root -Path $dependencyPath))
      }
    }
  }
  $webAssets = if (Test-Path -LiteralPath $webRoot) { @(Get-ChildItem -LiteralPath $webRoot -File | Where-Object { $_.Extension -eq '.js' -or $_.Name.EndsWith('.js.map') }) } else { @() }
  $orphan = @($webAssets | Where-Object { -not $referenced.Contains((Get-QingmuRelativePath -Base $root -Path $_.FullName)) } | ForEach-Object { Get-QingmuRelativePath -Base $root -Path $_.FullName })
  return [pscustomobject]@{
    root = $root
    htmlCount = @($files | Where-Object Extension -eq '.html').Count
    referencedAssetCount = $referenced.Count
    unresolved = @($unresolved)
    orphanWebAssetCount = $orphan.Count
    orphanWebAssets = $orphan
    pass = $unresolved.Count -eq 0
  }
}
