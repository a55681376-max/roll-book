@echo off
cd /d "%~dp0"
where node >nul 2>nul
if not errorlevel 1 (
  node tools\local.cjs
) else if exist "%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" (
  "%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" tools\local.cjs
) else (
  echo Node.js is required. Install Node.js or ask Codex to start the server.
)
pause
