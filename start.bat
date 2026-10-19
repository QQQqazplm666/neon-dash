@echo off
chcp 65001 >nul
setlocal

rem ============================================================
rem  start.bat —— 双击启动霓虹冲刺
rem  1. 优先使用 PATH 里的 node
rem  2. 找不到则回退到常见的 Node.js 安装位置
rem  3. 启动本地服务器并打开浏览器
rem ============================================================

cd /d "%~dp0"

set "NODE_EXE="

rem --- 1) 先试 PATH 里的 node ---
where node >nul 2>nul
if %errorlevel%==0 (
  set "NODE_EXE=node"
  goto :found
)

rem --- 2) 再试几个常见的 Node.js 安装位置 ---
if exist "%ProgramFiles%\nodejs\node.exe" set "NODE_EXE=%ProgramFiles%\nodejs\node.exe"
if not defined NODE_EXE if exist "%LOCALAPPDATA%\Programs\nodejs\node.exe" set "NODE_EXE=%LOCALAPPDATA%\Programs\nodejs\node.exe"
if defined NODE_EXE goto :found

echo.
echo   [错误] 没有找到 Node.js。
echo.
echo   请先安装 Node.js：https://nodejs.org
echo   装好后重开一个窗口再双击本文件，或把 node.exe 的完整路径填到下面这行：
echo     if exist "你的\node.exe" set "NODE_EXE=你的\node.exe"
echo.
pause
exit /b 1

:found
echo.
echo   使用 Node: %NODE_EXE%
echo   正在启动 霓虹冲刺 Neon Dash ...
echo.

rem 过 2 秒后再打开浏览器，给服务器一点启动时间
start "" cmd /c "timeout /t 2 /nobreak >nul & start http://localhost:5180"

"%NODE_EXE%" server.mjs

echo.
echo   服务器已停止。
pause
endlocal