"""Standalone launcher for the Quarter-Car Suspension Simulator.

Serves the bundled static files over a local HTTP server and opens the
default web browser. Optionally starts the Python control server
(python/server.py) if system Python is available. Packaged into a single
.exe with PyInstaller.
"""

import http.server
import socketserver
import os
import sys
import socket
import threading
import webbrowser
import subprocess
import shutil


def resource_path(relative_path: str) -> str:
    base_path = getattr(sys, "_MEIPASS", os.path.abspath(os.path.dirname(__file__)))
    return os.path.join(base_path, relative_path)


def find_free_port(preferred: int = 3002) -> int:
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


def find_system_python():
    """Find system Python (not the PyInstaller exe itself)."""
    if getattr(sys, "frozen", False):
        for name in ("python", "python3", "py"):
            path = shutil.which(name)
            if path:
                return path
        return None
    return sys.executable


def try_start_control_server():
    """Try to start the Python control server if system Python is available."""
    try:
        python = find_system_python()
        if not python:
            return None
        server_py = resource_path(os.path.join("python", "server.py"))
        if os.path.exists(server_py):
            proc = subprocess.Popen(
                [python, server_py],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
            return proc
    except Exception:
        pass
    return None


def main() -> None:
    os.chdir(resource_path("."))
    port = find_free_port(3002)
    url = f"http://localhost:{port}"

    ctrl_proc = try_start_control_server()
    ctrl_status = "Running (port 8000)" if ctrl_proc else "Not available (run python/server.py manually)"

    with socketserver.TCPServer(("127.0.0.1", port), QuietHandler) as httpd:
        print("=" * 50)
        print("  Quarter-Car Suspension Simulator")
        print("=" * 50)
        print(f"  Web UI:          {url}")
        print(f"  Control Server:  {ctrl_status}")
        print("  Close this window to stop the server.")
        print("=" * 50)
        threading.Timer(0.8, lambda: webbrowser.open(url)).start()
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nShutting down...")
        finally:
            if ctrl_proc:
                ctrl_proc.terminate()


if __name__ == "__main__":
    main()
