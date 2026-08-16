@echo off
rem ASCII only. cmd breaks non-ASCII lines and runs the fragments as commands.
rem (Hit on 2026-08-15: a Japanese rem line ran as 'em'.)
chcp 65001 >nul
cd /d "%~dp0..\.."
:loop
call npm start
timeout /t 3 /nobreak >nul
goto loop
