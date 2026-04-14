"""Standalone launcher for the LaTeX Renderer.

Serves the bundled static files over a local HTTP server, optionally
starts the pix2tex OCR server, and opens the default web browser.
Packaged into a single .exe with PyInstaller.
"""

import http.server
import socketserver
import os
import sys
import socket
import threading
import webbrowser
import subprocess


def resource_path(relative_path: str) -> str:
    """Resolve a path that works both in dev and inside a PyInstaller onefile exe."""
    base_path = getattr(sys, "_MEIPASS", os.path.abspath(os.path.dirname(__file__)))
    return os.path.join(base_path, relative_path)


def find_free_port(preferred: int = 3006) -> int:
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


def try_start_ocr_server():
    """Try to start the OCR server if pix2tex is installed."""
    try:
        server_py = resource_path("server.py")
        if os.path.exists(server_py):
            proc = subprocess.Popen(
                [sys.executable, server_py],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
            return proc
    except Exception:
        pass
    return None


def main() -> None:
    os.chdir(resource_path("."))
    port = find_free_port(3006)
    url = f"http://localhost:{port}"

    # Try to start OCR server
    ocr_proc = try_start_ocr_server()
    ocr_status = "Running (port 5000)" if ocr_proc else "Not available (install pix2tex)"

    with socketserver.TCPServer(("127.0.0.1", port), QuietHandler) as httpd:
        print("=" * 50)
        print("  LaTeX Renderer")
        print("=" * 50)
        print(f"  Web UI:     {url}")
        print(f"  OCR Server: {ocr_status}")
        print("  Close this window to stop the server.")
        print("=" * 50)
        threading.Timer(0.8, lambda: webbrowser.open(url)).start()
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nShutting down...")
        finally:
            if ocr_proc:
                ocr_proc.terminate()


if __name__ == "__main__":
    main()
