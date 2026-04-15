@echo off
setlocal

set "ROOT=%~dp0"
set "VENV_ACTIVATE=%ROOT%.venv\Scripts\activate.bat"
set "TOKENIZERS_PARALLELISM=true"
set "OMP_NUM_THREADS=%NUMBER_OF_PROCESSORS%"
set "MKL_NUM_THREADS=%NUMBER_OF_PROCESSORS%"
set "OPENBLAS_NUM_THREADS=%NUMBER_OF_PROCESSORS%"
set "NUMEXPR_NUM_THREADS=%NUMBER_OF_PROCESSORS%"
set "HF_HUB_DISABLE_TELEMETRY=1"

if not exist "%VENV_ACTIVATE%" (
    echo Virtual environment not found: %VENV_ACTIVATE%
    echo Create it first with: python -m venv .venv
    exit /b 1
)

start "Offline RAG Backend" cmd /k "cd /d ""%ROOT%"" && call ""%VENV_ACTIVATE%"" && uvicorn backend.main:app --host 127.0.0.1 --port 8000 --reload"
start "Offline RAG Frontend" cmd /k "cd /d ""%ROOT%"" && call ""%VENV_ACTIVATE%"" && streamlit run frontend/app.py --server.port 8501"

echo Backend started on http://127.0.0.1:8000
echo Frontend started on http://localhost:8501
echo.
echo Close the two command windows to stop the project.
endlocal
