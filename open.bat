@echo off
title QuantVeda AI - Setup and Launcher
color 0A

:: Ensure script runs from its directory
cd /d "%~dp0"
if exist "QuantVeda" (
    cd QuantVeda
)

echo =======================================================
echo              QuantVeda AI - Launcher
echo =======================================================
echo.

:: 1. Check Python installation
echo [1/5] Checking Python installation...
python --version >nul 2>&1
if %errorlevel% neq 0 (
    color 0C
    echo [ERROR] Python is not installed or not added to PATH!
    echo Please install Python 3.10+ from https://www.python.org/
    echo Make sure to check "Add Python to PATH" during installation.
    echo.
    pause
    exit /b 1
)
python --version
echo [OK] Python is available.
echo.

:: 2. Check and Create Virtual Environment
echo [2/5] Setting up Virtual Environment (.venv)...
if not exist ".venv\Scripts\activate.bat" (
    echo [.venv not found. Creating new virtual environment...]
    python -m venv .venv
    if %errorlevel% neq 0 (
        color 0C
        echo [ERROR] Failed to create virtual environment.
        pause
        exit /b 1
    )
    echo [OK] Virtual environment created successfully.
) else (
    echo [OK] Existing virtual environment detected.
)
echo.

:: 3. Activate Virtual Environment & Install Dependencies
echo [3/5] Checking and installing dependencies...
call .venv\Scripts\activate.bat

if exist "backend\requirements.txt" (
    echo Installing / Updating required packages from backend\requirements.txt...
    python -m pip install --upgrade pip
    pip install -r backend\requirements.txt
    if %errorlevel% neq 0 (
        color 0C
        echo [ERROR] Failed to install dependencies.
        pause
        exit /b 1
    )
    echo [OK] Dependencies are ready.
) else (
    echo [WARNING] backend\requirements.txt not found! Skipping pip install.
)
echo.

:: 4. Check for .env configuration
echo [4/5] Checking configuration (.env)...
if not exist ".env" (
    echo [.env file not found. Creating template .env file...]
    (
        echo # QuantVeda Configuration
        echo # Optional: Add your OpenAI API key below for AI Sentiment analysis
        echo # If left empty, QuantVeda will use deterministic fallback mode
        echo OPENAI_API_KEY=
    ) > .env
    echo [OK] Created .env template.
) else (
    echo [OK] .env file exists.
)
echo.

:: 5. Launch Application and Browser
echo [5/5] Launching QuantVeda AI Server...
echo.
echo   - Auth Portal:   http://127.0.0.1:8000/
echo   - Live Terminal: http://127.0.0.1:8000/terminal
echo   - API Docs:      http://127.0.0.1:8000/docs
echo =======================================================
echo.
echo Opening browser in 3 seconds...
start /b cmd /c "timeout /t 3 /nobreak >nul & start http://127.0.0.1:8000/"

echo Starting Uvicorn server (Press Ctrl+C to stop)...
echo.
python -m uvicorn backend.main:app --reload --host 127.0.0.1 --port 8000

if %errorlevel% neq 0 (
    echo.
    color 0C
    echo [ERROR] Server terminated with an error.
    pause
)
