#!/usr/bin/env python3
"""
ローカル配信用ラッパー
======================
`python -m http.server` 相当だが、PyCharm の Python Run Configuration から
モジュールモード経由で起動するとうまく動かないケースがあるため、
スクリプトモードで実行できるよう薄く包んである。

実行:
    python serve.py            # 8000番で起動
    python serve.py 8080       # ポート指定
"""

from __future__ import annotations

import http.server
import socketserver
import sys

HOST = "127.0.0.1"  # 外向きには公開しない (開発用)
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8000


def main() -> None:
    handler = http.server.SimpleHTTPRequestHandler
    with socketserver.TCPServer((HOST, PORT), handler) as httpd:
        print(f"Serving at http://{HOST}:{PORT}  (Ctrl+C to stop)")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nstopped.")


if __name__ == "__main__":
    main()
