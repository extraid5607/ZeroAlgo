@echo off
setlocal enabledelayedexpansion

title ZeroAlgo Trading Terminal (Port 5050)

echo ===================================================
echo               Starting ZeroAlgo Terminal
echo ===================================================
echo.

cd /d "%~dp0"

:: 1. Locate Python / Virtual Environment
set "PYTHON_BIN=..\venv\Scripts\python.exe"

if not exist "!PYTHON_BIN!" (
    python --version >nul 2>&1
    if %errorlevel% equ 0 (
        set "PYTHON_BIN=python"
    ) else (
        echo [ERROR] Python virtual environment not found in parent directory.
        echo Please ensure venv exists in OpenAlgo root.
        pause
        exit /b 1
    )
)

echo [INFO] Using Python: !PYTHON_BIN!
echo [INFO] Starting ZeroAlgo on http://127.0.0.1:5050 ...
echo [INFO] Press Ctrl+C at any time to stop.
echo.

:: Automatically open browser after 2 seconds
start /b cmd /c "timeout /t 2 /nobreak >nul & start http://127.0.0.1:5050"

:: Run lightweight MyAlgo server
!PYTHON_BIN! server.py

if %errorlevel% neq 0 (
    echo.
    echo [ERROR] Server exited with code %errorlevel%.
    echo Review the messages above.
)

echo.
pause
