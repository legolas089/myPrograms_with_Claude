"""Standalone launcher for the Article Printer.

Starts the Flask backend (which also serves the static frontend) on port 5001
and opens the default web browser. If a backend is already running (e.g.
started from the unified launcher), it just opens the browser.

Run:  pythonw launcher.py   (or double-click "Article Printer.bat")
"""

import os
import sys
import socket
import webbrowser

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

# Under pythonw there is no console: Flask/werkzeug logging would choke on None streams.
if sys.stdout is None:
    sys.stdout = open(os.devnull, "w", encoding="utf-8")
if sys.stderr is None:
    sys.stderr = open(os.devnull, "w", encoding="utf-8")

try:
    import server  # noqa: E402
except ImportError as e:
    # pythonw has no console, so on a PC without the packages the launcher
    # would otherwise vanish silently. Say what is missing instead.
    import ctypes
    py = sys.executable
    if py.lower().endswith("pythonw.exe"):
        py = py[:-11] + "python.exe"
    ctypes.windll.user32.MessageBoxW(
        None,
        f"{e}\n\n이 PC에 필요한 Python 패키지를 설치하세요:\n\n"
        f"\"{py}\" -m pip install flask flask-cors requests trafilatura readability-lxml",
        "Article Printer — 백엔드 시작 실패", 0x10)
    sys.exit(1)


def port_in_use(port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.settimeout(0.3)
        return s.connect_ex(("127.0.0.1", port)) == 0


def main() -> None:
    url = f"http://localhost:{server.API_PORT}"
    if port_in_use(server.API_PORT):
        webbrowser.open(url)
        return
    print("=" * 50)
    print("  Article Printer")
    print("=" * 50)
    print(f"  Running at: {url}")
    print("  Close this window to stop the server.")
    print("=" * 50)
    server.run(open_browser=True)


if __name__ == "__main__":
    main()
