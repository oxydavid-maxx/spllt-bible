' Runs the weekly announcement job with no console window, the same way the other registered
' routines in ~/.claude/governance/routines.yaml are launched. A twice-weekly job that flashes a
' terminal on somebody's desktop is a job they will eventually disable.
Set shell = CreateObject("WScript.Shell")
shell.Run """C:\dev\apps\qingmu-bible\tools\announce\run.cmd""", 0, False
