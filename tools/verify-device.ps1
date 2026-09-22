<#
  Device verification for 青牧 App, on a machine that has nothing installed.

  WHY THIS EXISTS: the phone and the build machine are not always the same machine. The alternative
  to this file is a conversation — run this, tell me what it said, now run that — which costs a round
  trip per step and leaves a transcript nobody can re-run. This is one command. It finds or fetches
  adb, fetches the build, installs it, drives the app, and judges what it sees.

  The judging is the point. It reads the view hierarchy rather than counting screenshots, because a
  tap that silently did nothing and a tap that worked produce identical pictures.

  USAGE:  powershell -ExecutionPolicy Bypass -File verify-device.ps1
          powershell -ExecutionPolicy Bypass -File verify-device.ps1 -Apk <path-or-url>
#>

param(
  [string] $Apk = 'https://contemporary-apparel-knit-albany.trycloudflare.com/qingmu-0.5.1.apk',
  [string] $Out = "$env:USERPROFILE\qingmu-verify"
)

$ErrorActionPreference = 'Continue'

# Windows PowerShell 5.1 redraws the progress bar on every chunk Invoke-WebRequest receives, and that
# redraw dominates the transfer: measured on this machine, the same 8 MB file took 18.7s with the bar
# and 0.2s without it. The 97 MB build is twelve times larger, so with the bar left on the script
# looks hung rather than slow — which is exactly how it read on the machine it was first run on.
$ProgressPreference = 'SilentlyContinue'

$pkg = 'org.qingmu.youth'
New-Item -ItemType Directory -Force -Path $Out | Out-Null
$report = Join-Path $Out 'verify-report.txt'
'' | Set-Content -Path $report -Encoding UTF8

function Say($text) { Write-Host $text; Add-Content -Path $report -Value $text -Encoding UTF8 }

# --- adb, wherever it is, or from Google if it is nowhere ------------------------------------------
# An office machine has no reason to have platform-tools. Rather than making that a prerequisite the
# person has to satisfy before the script is useful, the script satisfies it: an 8 MB zip into temp,
# used in place, nothing installed and nothing on PATH afterwards.
function Get-Adb {
  $onPath = Get-Command adb -ErrorAction SilentlyContinue
  if ($onPath) { return $onPath.Source }

  $known = @(
    "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe",
    "$env:LOCALAPPDATA\Microsoft\WinGet\Packages\Google.PlatformTools_Microsoft.Winget.Source_8wekyb3d8bbwe\platform-tools\adb.exe",
    "$env:ProgramFiles\Android\platform-tools\adb.exe"
  )
  foreach ($candidate in $known) { if (Test-Path $candidate) { return $candidate } }

  $root = Join-Path $env:TEMP 'qingmu-platform-tools'
  $local = Join-Path $root 'platform-tools\adb.exe'
  if (Test-Path $local) { return $local }

  Say 'adb not found; fetching platform-tools from Google (8 MB, nothing is installed)'
  New-Item -ItemType Directory -Force -Path $root | Out-Null
  $zip = Join-Path $root 'pt.zip'
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  Invoke-WebRequest -Uri 'https://dl.google.com/android/repository/platform-tools-latest-windows.zip' -OutFile $zip -UseBasicParsing
  Expand-Archive -Path $zip -DestinationPath $root -Force
  return $local
}

$adb = Get-Adb
if (-not (Test-Path $adb)) { Say 'FAIL  could not obtain adb'; exit 1 }
Say "adb: $adb"

$devices = & $adb devices -l 2>&1
Say ($devices -join "`n")
if (-not ($devices | Select-String -Pattern '\sdevice\b')) {
  Say 'FAIL  no device attached — plug the phone in, unlock it, and accept the USB debugging prompt'
  exit 1
}

# --- the screen, as the phone reports it ----------------------------------------------------------
# Tapping fixed coordinates assumes a screen size. Reading the hierarchy and tapping the element that
# carries the label works on whatever phone is in front of you, and fails loudly when the label is
# gone — which is the failure worth hearing about.
function Get-Tree {
  & $adb shell uiautomator dump /sdcard/qm-ui.xml 2>&1 | Out-Null
  return (& $adb shell cat /sdcard/qm-ui.xml 2>&1) -join ''
}
function Test-Text($tree, $needle) { return $tree -like "*$needle*" }

function Tap-Text($tree, $needle) {
  $pattern = 'text="[^"]*' + [Regex]::Escape($needle) + '[^"]*"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"'
  $hit = [Regex]::Match($tree, $pattern)
  if (-not $hit.Success) { return $false }
  $x = ([int]$hit.Groups[1].Value + [int]$hit.Groups[3].Value) / 2
  $y = ([int]$hit.Groups[2].Value + [int]$hit.Groups[4].Value) / 2
  & $adb shell input tap ([int]$x) ([int]$y) | Out-Null
  return $true
}

function Check($label, $needle) {
  if (Test-Text (Get-Tree) $needle) { Say "PASS  $label" } else { Say "FAIL  $label  (nothing on screen matched: $needle)" }
}

# --- install ---------------------------------------------------------------------------------------
# install -r, never uninstall: the journal drafts and the unsent queue live on the device.
if ($Apk -match '^https?://') {
  Say "downloading the build"
  $file = Join-Path $Out 'app.apk'
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  Invoke-WebRequest -Uri $Apk -OutFile $file -UseBasicParsing
  $Apk = $file
}
if (-not (Test-Path $Apk)) { Say "FAIL  no such build: $Apk"; exit 1 }

Say "installing $([IO.Path]::GetFileName($Apk)) ($([math]::Round((Get-Item $Apk).Length / 1MB)) MB)"
Say ((& $adb install -r $Apk 2>&1) | Select-Object -Last 1)
$installed = (& $adb shell dumpsys package $pkg 2>&1 | Select-String 'versionName' | Select-Object -First 1)
Say "on the phone now: $installed"

& $adb shell am force-stop $pkg | Out-Null
& $adb shell monkey -p $pkg -c android.intent.category.LAUNCHER 1 2>&1 | Out-Null
Start-Sleep -Seconds 10
& $adb exec-out screencap -p > (Join-Path $Out '01-launch.png')
Check 'app launches' '讀經'

# --- the reader ------------------------------------------------------------------------------------
# This is the check that matters. It shipped broken three times because a spinner was read as "still
# loading" rather than "never finishes", so the question asked here is the literal one: after twenty
# seconds, is the waiting notice still on the screen?
Say '--- reader ---'
if (-not (Tap-Text (Get-Tree) '開始今日讀經')) { Say 'NOTE  no 開始今日讀經 button found; trying the reading tab' ; Tap-Text (Get-Tree) '讀經' | Out-Null }
Start-Sleep -Seconds 22
& $adb exec-out screencap -p > (Join-Path $Out '02-reader.png')
$tree = Get-Tree
if (Test-Text $tree '官方閱讀器還在準備中') {
  Say 'FAIL  reader still says 官方閱讀器還在準備中 after 22s — the YouVersion SDK did not initialise'
} elseif ([Regex]::IsMatch($tree, 'text="[^"]{25,}"')) {
  Say 'PASS  reader rendered scripture'
} else {
  Say 'FAIL  reader shows neither the waiting notice nor any text — look at 02-reader.png'
}

& $adb shell input keyevent KEYCODE_BACK | Out-Null; Start-Sleep -Seconds 3

Say '--- announcements ---'
Tap-Text (Get-Tree) '公告' | Out-Null; Start-Sleep -Seconds 6
& $adb exec-out screencap -p > (Join-Path $Out '03-announcements.png')
Check 'announcement tab opens' '公告'

Say '--- points ---'
Tap-Text (Get-Tree) '積分' | Out-Null; Start-Sleep -Seconds 6
& $adb exec-out screencap -p > (Join-Path $Out '04-points.png')
Check 'reward goal shows' '目標獎品'

Say ''
Say "$(((Get-Content $report) | Select-String '^PASS').Count) passed, $(((Get-Content $report) | Select-String '^FAIL').Count) failed"
Say "screenshots and this report: $Out"
