"""Standalone launcher for the Half-Car Suspension Simulator.

Serves the bundled static files over a local HTTP server and opens the
default web browser. Packaged into a single .exe with PyInstaller.
"""

import http.server
import socketserver
import os
import sys
import socket
import threading
import webbrowser


def resource_path(relative_path: str) -> str:
    base_path = getattr(sys, "_MEIPASS", os.path.abspath(os.path.dirname(__file__)))
    return os.path.join(base_path, relative_path)


def find_free_port(preferred: int = 3003) -> int:
    for port in range(preferred, preferred + 100):
        try:
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
                s.bind(("127.0.0.1", port))
                return port
        except OSError:
            continue
    return preferred


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, format, *args):
        pass


def main() -> None:
    os.chdir(resource_path("."))
    port = find_free_port(3003)
    url = f"http://localhost:{port}"

    with socketserver.TCPServer(("127.0.0.1", port), QuietHandler) as httpd:
        print("=" * 50)
        print("  Half-Car Suspension Simulator")
        print("=" * 50)
        print(f"  Running at: {url}")
        print("  Close this window to stop the server.")
        print("=" * 50)
        threading.Timer(0.8, lambda: webbrowser.open(url)).start()
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nShutting down...")


if __name__ == "__main__":
    main()
