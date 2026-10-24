#!/bin/sh
# Avvia l'editor di Panera (Linux / macOS). Richiede Python 3.
cd "$(dirname "$0")" || exit 1
if command -v python3 >/dev/null 2>&1; then exec python3 avvia-editor.py; fi
if command -v python >/dev/null 2>&1; then exec python avvia-editor.py; fi
echo "Python 3 non trovato: installalo (es. sudo apt install python3) e riprova."
exit 1
