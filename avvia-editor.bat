@echo off
rem Avvia l'editor di Panera (Windows). Richiede Python 3: https://www.python.org/downloads/
cd /d "%~dp0"
where py >nul 2>nul && (py -3 avvia-editor.py & goto :eof)
where python >nul 2>nul && (python avvia-editor.py & goto :eof)
echo Python 3 non trovato. Installalo da https://www.python.org/downloads/
echo (spunta "Add python.exe to PATH" durante l'installazione) e riprova.
pause
