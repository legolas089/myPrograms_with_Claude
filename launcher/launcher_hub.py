"""Unified launcher for the myPrograms_with_Claude suite.

Serves the whole repo over a single local HTTP server (port 3100) so every
web program can be embedded as an iframe under one origin, and exposes a small
JSON API for the launcher shell (program registry, Downloads browsing, CLI
program launch).

Run:  pythonw launcher/launcher_hub.py   (or double-click Launcher.bat)
"""

import http.server
import socketserver
import os
import sys
import json
import socket
import threading
import webbrowser
import subprocess
from pathlib import Path
from urllib.parse import urlparse


LAUNCHER_DIR = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.dirname(LAUNCHER_DIR)
DOWNLOADS_DIR = Path.home() / "Downloads"
REGISTRY_FILE = os.path.join(LAUNCHER_DIR, "programs.json")


# ── Program registry ────────────────────────────────────────────────
# The registry lives in programs.json (data, not code). Add a program by
# appending one object there — no edits to this file are needed.
#   mode: "web" → served on localhost, embedded as an iframe tab
#         "cli" → no localhost; launched in a terminal instead
def load_programs():
    """Load and lightly validate the program registry from programs.json."""
    try:
        # utf-8-sig tolerates a BOM, which Windows editors / PowerShell often add.
        with open(REGISTRY_FILE, encoding="utf-8-sig") as f:
            data = json.load(f)
    except (OSError, json.JSONDecodeError) as e:
        print(f"  [WARN] could not read programs.json: {e}")
        return []
    programs = data.get("programs", []) if isinstance(data, dict) else data
    valid = []
    for p in programs:
        if not isinstance(p, dict) or not p.get("id") or not p.get("folder"):
            print(f"  [WARN] skipping invalid program entry: {p!r}")
            continue
        p.setdefault("mode", "web")
        p.setdefault("group", "Programs")
        p.setdefault("category", p["group"])
        p.setdefault("name", p["id"])
        p.setdefault("icon", "ti-app-window")
        valid.append(p)
    return valid


def programs_by_id():
    return {p["id"]: p for p in load_programs()}


def find_free_port(preferred: int = 3100) -> int:
    for port in range(preferred, preferred + 100):
        try:
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
                s.bind(("127.0.0.1", port))
                return port
        except OSError:
            continue
    return preferred


def _safe_in_downloads(path: Path) -> bool:
    """True only if path resolves to a file inside the Downloads folder."""
    try:
        resolved = path.resolve()
        resolved.relative_to(DOWNLOADS_DIR.resolve())
        return resolved.is_file()
    except (ValueError, OSError):
        return False


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=REPO_ROOT, **kwargs)

    def log_message(self, format, *args):  # noqa: A002 - match stdlib signature
        pass

    # ── routing ──────────────────────────────────────────────────
    def do_GET(self):
        path = urlparse(self.path).path
        if path == "/" or path == "/index.html":
            return self._serve_file(os.path.join(REPO_ROOT, "launcher", "index.html"),
                                    "text/html; charset=utf-8")
        if path == "/api/programs":
            return self._send_json(load_programs())
        if path == "/api/downloads":
            return self._send_json(self._list_downloads())
        return super().do_GET()

    def do_POST(self):
        path = urlparse(self.path).path
        body = self._read_json()
        if path == "/api/open":
            return self._open_download(body)
        if path == "/api/open-folder":
            return self._open_folder()
        if path == "/api/run-cli":
            return self._run_cli(body)
        self._send_json({"error": "not found"}, status=404)

    # ── API handlers ─────────────────────────────────────────────
    def _list_downloads(self):
        if not DOWNLOADS_DIR.is_dir():
            return []
        items = []
        try:
            for entry in DOWNLOADS_DIR.iterdir():
                if entry.is_file() and not entry.name.startswith("~"):
                    st = entry.stat()
                    items.append({
                        "name": entry.name,
                        "path": str(entry),
                        "size": st.st_size,
                        "mtime": st.st_mtime,
                        "ext": entry.suffix.lower().lstrip("."),
                    })
        except OSError:
            return []
        items.sort(key=lambda x: x["mtime"], reverse=True)
        return items[:40]

    def _open_download(self, body):
        target = Path(body.get("path", ""))
        if not _safe_in_downloads(target):
            return self._send_json({"error": "invalid path"}, status=400)
        try:
            os.startfile(str(target.resolve()))  # noqa: S606 - local user action, Windows
            return self._send_json({"ok": True})
        except OSError as e:
            return self._send_json({"error": str(e)}, status=500)

    def _open_folder(self):
        try:
            os.startfile(str(DOWNLOADS_DIR))
            return self._send_json({"ok": True})
        except OSError as e:
            return self._send_json({"error": str(e)}, status=500)

    def _run_cli(self, body):
        prog = programs_by_id().get(body.get("id", ""))
        if not prog or prog.get("mode") != "cli":
            return self._send_json({"error": "unknown cli program"}, status=400)
        commands = prog.get("commands", [])
        # Open a terminal at the repo root with the commands pre-filled.
        joined = " & ".join(commands) if commands else "echo No command configured"
        try:
            subprocess.Popen(
                f'start "myPrograms — {prog["name"]}" cmd /k "{joined}"',
                cwd=REPO_ROOT, shell=True,
            )
            return self._send_json({"ok": True, "commands": commands})
        except OSError as e:
            return self._send_json({"error": str(e)}, status=500)

    # ── helpers ──────────────────────────────────────────────────
    def _read_json(self):
        try:
            length = int(self.headers.get("Content-Length", 0))
            if length:
                return json.loads(self.rfile.read(length))
        except (ValueError, json.JSONDecodeError):
            pass
        return {}

    def _send_json(self, obj, status=200):
        data = json.dumps(obj).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _serve_file(self, filepath, content_type):
        try:
            with open(filepath, "rb") as f:
                data = f.read()
        except OSError:
            self.send_error(404)
            return
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)


class ThreadingServer(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True
    allow_reuse_address = True


def main() -> None:
    port = find_free_port(3100)
    url = f"http://localhost:{port}"

    with ThreadingServer(("127.0.0.1", port), Handler) as httpd:
        print("=" * 50)
        print("  myPrograms Launcher")
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
