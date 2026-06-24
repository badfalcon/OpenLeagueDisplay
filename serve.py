#!/usr/bin/env python3
"""
Local static-serving wrapper
============================
Equivalent to `python -m http.server`, wrapped thinly so it can run in script
mode. PyCharm's Python Run Configuration sometimes fails to launch it via
module mode, so this script-mode wrapper sidesteps that.

Usage:
    python serve.py            # serve on port 8000
    python serve.py 8080       # specify a port
"""

from __future__ import annotations

import http.server
import sys

HOST = "127.0.0.1"  # not exposed externally (dev only)
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8000


def main() -> None:
    handler = http.server.SimpleHTTPRequestHandler
    # Unlike bare socketserver.TCPServer, HTTPServer sets allow_reuse_address=1,
    # so restarting right after Ctrl+C won't hit TIME_WAIT "Address already in use"
    with http.server.HTTPServer((HOST, PORT), handler) as httpd:
        print(f"Serving at http://{HOST}:{PORT}  (Ctrl+C to stop)")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nstopped.")


if __name__ == "__main__":
    main()
