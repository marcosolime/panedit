#!/usr/bin/env python3
"""Avvia l'editor di Panera: server locale + apertura del browser.

Funziona su Windows, Linux e macOS con il solo Python 3.7+ (nessun pacchetto da installare).
Uso: python3 avvia-editor.py   (oppure doppio clic su avvia-editor.bat / avvia-editor.sh)
"""
import functools
import http.server
import os
import sys
import threading
import webbrowser

ROOT = os.path.dirname(os.path.abspath(__file__))
# Porta fissa: bozze e preferenze dell'editor sono salvate nel browser per indirizzo,
# quindi cambiando porta non si ritroverebbero. Le successive servono solo se è occupata.
PORTS = range(8765, 8776)


class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        '.js': 'text/javascript',
        '.css': 'text/css',
        '.webp': 'image/webp',
        '.woff2': 'font/woff2',
        '.json': 'application/json',
        '.geojson': 'application/geo+json',
    }

    def end_headers(self):
        # i dati devono essere sempre letti freschi dal disco
        self.send_header('Cache-Control', 'no-store' if self.path.startswith('/data/') else 'no-cache')
        super().end_headers()

    def log_message(self, fmt, *args):
        pass  # niente log per ogni tile


def main():
    handler = functools.partial(Handler, directory=ROOT)
    server = None
    for port in PORTS:
        try:
            server = http.server.ThreadingHTTPServer(('127.0.0.1', port), handler)
            break
        except OSError:
            continue
    if server is None:
        sys.exit(f'Nessuna porta libera tra {PORTS.start} e {PORTS.stop - 1}: l\'editor è forse già aperto?')

    url = f'http://localhost:{port}/viewer/index.html'
    print(f'Editor di Panera in esecuzione su {url}')
    if port != PORTS.start:
        print(f'Attenzione: la porta {PORTS.start} era occupata, le bozze salvate nel browser '
              f'con l\'altra porta non saranno visibili qui.')
    print('Chiudi questa finestra (o premi Ctrl+C) per fermarlo.')
    threading.Timer(0.5, lambda: webbrowser.open(url)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == '__main__':
    main()
