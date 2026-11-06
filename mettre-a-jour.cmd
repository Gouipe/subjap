@echo off
rem Double-clic : met a jour SubJap (git pull + build), comme "npm.cmd run update".
cd /d "%~dp0"
call npm.cmd run update
echo.
pause
