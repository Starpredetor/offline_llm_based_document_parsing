@echo off
setlocal EnableExtensions

set "ROOT=%~dp0"
set "VENV_ACTIVATE=%ROOT%.venv\Scripts\activate.bat"
set "HOST=127.0.0.1"
set "PORT=8000"
set "APP_URL=http://%HOST%:%PORT%/app"

set "TOKENIZERS_PARALLELISM=true"
set "OMP_NUM_THREADS=%NUMBER_OF_PROCESSORS%"
set "MKL_NUM_THREADS=%NUMBER_OF_PROCESSORS%"
set "OPENBLAS_NUM_THREADS=%NUMBER_OF_PROCESSORS%"
set "NUMEXPR_NUM_THREADS=%NUMBER_OF_PROCESSORS%"
set "HF_HUB_DISABLE_TELEMETRY=1"

if not exist "%VENV_ACTIVATE%" (
    echo Virtual environment not found:
    echo   %VENV_ACTIVATE%
    echo.
    echo Create it first with:
    echo   python -m venv .venv
    echo   .venv\Scripts\activate
    echo   pip install -r requirements.txt
    exit /b 1
)

if not exist "%ROOT%frontend_web\index.html" (
    echo Flask/FastAPI frontend not found:
    echo   %ROOT%frontend_web\index.html
    exit /b 1
)

echo Starting Offline RAG web app...
echo.
echo App:     %APP_URL%
echo API:     http://%HOST%:%PORT%
echo.
echo Keep the backend window open while using the app.
echo Close that window to stop the project.
echo.

start "Offline RAG Web App" cmd /k "cd /d ""%ROOT%"" && call ""%VENV_ACTIVATE%"" && python scripts/download_models.py && python -m uvicorn backend.main:app --host %HOST% --port %PORT%"

timeout /t 3 /nobreak >nul
start "" "%APP_URL%"

endlocal
