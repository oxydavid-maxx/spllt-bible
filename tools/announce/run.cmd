@echo off
REM Weekly announcement job. Called by the scheduled task via run.vbs so no window appears.
REM
REM Sunday 09:00 because the deck is usually up by then, Tuesday 09:00 because the recording is
REM usually posted after the weekend's editing. Both runs build the same file; the Tuesday one
REM simply finds more in the folder. Running twice is cheaper than deciding which one is the real one.

setlocal
set "PATH=C:\Program Files\nodejs;%PATH%"
set "REPO=C:\dev\apps\qingmu-bible"
set "LOG=%REPO%\tools\announce\last-run.log"

cd /d "%REPO%" || exit /b 1

echo ---------------------------------------- >> "%LOG%"
echo %DATE% %TIME% starting >> "%LOG%"
node "%REPO%\node_modules\tsx\dist\cli.mjs" "%REPO%\tools\announce\index.ts" >> "%LOG%" 2>&1
echo %DATE% %TIME% exit=%ERRORLEVEL% >> "%LOG%"

REM The log is the whole alerting story on purpose: this runs on the owner's own machine, and a
REM refusal to publish leaves last week's file in place, which is stale but not wrong.
exit /b %ERRORLEVEL%
