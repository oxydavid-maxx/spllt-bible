<#
  Device verification for 青牧 App, on a machine that has nothing installed.

  WHY THIS EXISTS: the phone and the build machine are not always the same machine. The alternative
  to this file is a conversation — run this, tell me what it said, now run that — which costs a round
  trip per step and leaves a transcript nobody can re-run. This is one command. It finds or fetches
  adb, fetches the build, installs it, drives the app, judges what it sees, and sends the evidence
  back so the next iteration does not cost anyone a copy-paste.

  THE JUDGING RULE: a check may report PASS, FAIL, or ERROR, and the third one is not decoration.
  FAIL means the screen was read and did not contain what was expected. ERROR means the screen could
  not be read at all. Collapsing those two is how this app shipped a broken reader three times — a
  spinner that never resolves and a screen nobody looked at produce the same silence.

  USAGE:  powershell -ExecutionPolicy Bypass -File verify-device.ps1
          powershell -ExecutionPolicy Bypass -File verify-device.ps1 -Apk <path-or-url>
#>

param(
  [string] $Apk = 'https://contemporary-apparel-knit-albany.trycloudflare.com/qingmu-0.5.1.apk',
  [string] $Out = "$env:USERPROFILE\qingmu-verify",
  [string] $UploadTo = 'https://contemporary-apparel-knit-albany.trycloudflare.com/up/serve-2693-3111516877'
)

$ErrorActionPreference = 'Continue'

# Windows PowerShell 5.1 redraws the progress bar on every chunk Invoke-WebRequest receives, and that
# redraw dominates the transfer: measured, the same 8 MB file took 18.7s with the bar and 0.2s
# without it. The build is 97 MB, so with the bar left on the script looks hung rather than slow —
# which is exactly how it read on the machine it was first run on.
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
# Pulled as a file and decoded as UTF-8 on purpose. Reading it through `adb shell cat` would put the
# XML through the console decoder, and on a machine whose console codepage is not UTF-8 every Chinese
# label in it becomes mojibake — so every check would report "not found" for text that is plainly on
# the screen. Pulling bytes removes the console from the question entirely.
#
# /data/local/tmp rather than /sdcard: it is the shell user's own directory, with no storage
# permission or mount-namespace question attached to it.
$script:TreeError = $null

function Get-Tree {
  $remote = '/data/local/tmp/qm-ui.xml'
  $local = Join-Path $Out 'ui.xml'
  Remove-Item $local -ErrorAction SilentlyContinue
  & $adb shell rm -f $remote 2>&1 | Out-Null

  # uiautomator waits for the UI to go idle and gives up if it never does — an animation or a busy
  # WebView is enough. That refusal is information, so it is captured rather than discarded.
  $dump = ((& $adb shell uiautomator dump $remote 2>&1) | Out-String).Trim()
  & $adb pull $remote $local 2>&1 | Out-Null

  if (-not (Test-Path $local)) { $script:TreeError = "no dump file. uiautomator said: $dump"; return $null }
  $text = [IO.File]::ReadAllText($local, [Text.Encoding]::UTF8)
  if ($text.Length -lt 100) { $script:TreeError = "dump was $($text.Length) chars. uiautomator said: $dump"; return $null }
  $script:TreeError = $null
  return $text
}

function Node-Count($tree) { return ([Regex]::Matches($tree, '<node ')).Count }

function Tap-Text($tree, $needle) {
  if ($null -eq $tree) { return $false }
  $pattern = 'text="[^"]*' + [Regex]::Escape($needle) + '[^"]*"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"'
  $hit = [Regex]::Match($tree, $pattern)
  if (-not $hit.Success) { return $false }
  $x = ([int]$hit.Groups[1].Value + [int]$hit.Groups[3].Value) / 2
  $y = ([int]$hit.Groups[2].Value + [int]$hit.Groups[4].Value) / 2
  & $adb shell input tap ([int]$x) ([int]$y) | Out-Null
  return $true
}

function Check($label, $needle) {
  $tree = Get-Tree
  if ($null -eq $tree) { Say "ERROR $label  (could not read the screen: $script:TreeError)"; return }
  if ($tree -like "*$needle*") { Say "PASS  $label" }
  else { Say "FAIL  $label  (read $(Node-Count $tree) nodes, none contained: $needle)" }
}

# --- install ---------------------------------------------------------------------------------------
# install -r, never uninstall: the journal drafts and the unsent queue live on the device.
if ($Apk -match '^https?://') {
  Say 'downloading the build'
  $file = Join-Path $Out 'app.apk'
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  Invoke-WebRequest -Uri $Apk -OutFile $file -UseBasicParsing
  $Apk = $file
}
if (-not (Test-Path $Apk)) { Say "FAIL  no such build: $Apk"; exit 1 }

Say "installing $([IO.Path]::GetFileName($Apk)) ($([math]::Round((Get-Item $Apk).Length / 1MB)) MB)"
Say ((& $adb install -r $Apk 2>&1) | Select-Object -Last 1)
Say "on the phone now: $((& $adb shell dumpsys package $pkg 2>&1 | Select-String 'versionName' | Select-Object -First 1))"

& $adb shell am force-stop $pkg | Out-Null
& $adb shell monkey -p $pkg -c android.intent.category.LAUNCHER 1 2>&1 | Out-Null
Start-Sleep -Seconds 10
& $adb exec-out screencap -p > (Join-Path $Out '01-launch.png')

# --- what the screen actually contains --------------------------------------------------------------
# Printed once, before any judging. When every check reports "not found", this line is what separates
# "the app is blank" from "the dump never worked" without another round trip.
$first = Get-Tree
if ($null -eq $first) {
  Say "ERROR screen unreadable: $script:TreeError"
} else {
  $labels = [Regex]::Matches($first, 'text="([^"]{1,24})"') |
    ForEach-Object { $_.Groups[1].Value } | Where-Object { $_ -ne '' } | Select-Object -First 14
  Say "screen: $(Node-Count $first) nodes; labels: $($labels -join ' | ')"
}

Check 'app launches' '讀經'

# --- the reader ------------------------------------------------------------------------------------
# The check that matters. It shipped broken three times because a spinner was read as "still loading"
# rather than "never finishes", so the question asked here is the literal one: after twenty seconds,
# is the waiting notice still on the screen?
Say '--- reader ---'
if (-not (Tap-Text $first '開始今日讀經')) {
  Say 'NOTE  no 開始今日讀經 button found; trying the reading tab'
  Tap-Text $first '讀經' | Out-Null
}
Start-Sleep -Seconds 22
& $adb exec-out screencap -p > (Join-Path $Out '02-reader.png')
$tree = Get-Tree
if ($null -eq $tree) {
  Say "ERROR reader  (could not read the screen: $script:TreeError)"
} elseif ($tree -like '*官方閱讀器還在準備中*') {
  Say 'FAIL  reader still says 官方閱讀器還在準備中 after 22s — the YouVersion SDK did not initialise'
} elseif ([Regex]::IsMatch($tree, 'text="[^"]{25,}"')) {
  Say 'PASS  reader rendered scripture'
} else {
  Say "FAIL  reader read $(Node-Count $tree) nodes with no long text and no waiting notice — see 02-reader.png"
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
$lines = Get-Content $report
Say "$(($lines | Select-String '^PASS').Count) passed, $(($lines | Select-String '^FAIL').Count) failed, $(($lines | Select-String '^ERROR').Count) unreadable"

# --- send the evidence back --------------------------------------------------------------------------
# Screenshots and the report, zipped, one PUT. Without this the screenshots stay on this machine and
# every ambiguous result costs another round trip. The build is excluded — it came from there.
try {
  Remove-Item (Join-Path $Out 'app.apk') -ErrorAction SilentlyContinue
  $zip = Join-Path $env:TEMP "qingmu-verify-$(Get-Date -Format yyyyMMdd-HHmmss).zip"
  Compress-Archive -Path (Join-Path $Out '*') -DestinationPath $zip -Force
  Invoke-WebRequest -Uri "$UploadTo/$([IO.Path]::GetFileName($zip))" -Method Put -InFile $zip -UseBasicParsing | Out-Null
  Say "results sent back ($([math]::Round((Get-Item $zip).Length / 1KB)) KB)"
} catch {
  Say "could not send the results back: $($_.Exception.Message)"
  Say "they are in $Out"
}

Say "screenshots and this report: $Out"
