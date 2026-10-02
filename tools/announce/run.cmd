@echo off
REM Weekly announcement job. Called by the scheduled task via run.vbs so no window appears.
REM
REM The scheduled task runs it every day at 09:00. The deck is usually up by Sunday morning and the
REM recording is posted after the weekend's editing; each run rebuilds the same week's file and simply
REM finds more in the folder. Running often is cheaper than deciding which run is the real one.
REM
REM The job runs the announcement code as it is on GitHub main, never the code in this working tree.
REM On 2026-10-02 a fix had been merged the day before, but this checkout still sat on an older main
REM and the 09:00 run published the old wording again. The code checkout below belongs to the job
REM alone, so whatever branch or half-done edit this working tree holds cannot change what is published.

setlocal
set "PATH=C:\Program Files\nodejs;%PATH%"
set "REPO=C:\dev\apps\qingmu-bible"
set "CODE=C:\dev\machine\worktrees\qingmu-announce-code"
set "LOG=%REPO%\tools\announce\last-run.log"

cd /d "%REPO%" || exit /b 1

echo ---------------------------------------- >> "%LOG%"
echo %DATE% %TIME% starting >> "%LOG%"

git -C "%REPO%" fetch -q --no-tags origin refs/heads/main:refs/remotes/origin/main >> "%LOG%" 2>&1 || goto :no_code
if not exist "%CODE%\.git" git -C "%REPO%" worktree add -q --detach "%CODE%" refs/remotes/origin/main >> "%LOG%" 2>&1 || goto :no_code
git -C "%CODE%" checkout -q --detach --force refs/remotes/origin/main >> "%LOG%" 2>&1 || goto :no_code
for /f %%c in ('git -C "%CODE%" rev-parse --short HEAD') do echo code=main@%%c >> "%LOG%"

REM tsx and tsconfig come from this working tree; the announcement code imports only Node built-ins.
node "%REPO%\node_modules\tsx\dist\cli.mjs" "%CODE%\tools\announce\index.ts" %* >> "%LOG%" 2>&1
set "RC=%ERRORLEVEL%"
echo %DATE% %TIME% exit=%RC% >> "%LOG%"

REM The log is the whole alerting story on purpose: this runs on the owner's own machine, and a
REM refusal to publish leaves last week's file in place, which is stale but not wrong.
exit /b %RC%

:no_code
REM Without main's code nothing is published, for the same reason: stale is better than wrong.
echo %DATE% %TIME% exit=1 could not check out main's code >> "%LOG%"
exit /b 1
