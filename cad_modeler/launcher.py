"""Standalone launcher for the Simple CAD Modeler.

Serves the bundled static files over a local HTTP server and opens the
default web browser. Packaged into a single .exe with PyInstaller.

models/ 폴더는 읽기(GET)와 쓰기(PUT)를 모두 받는다. 브라우저의 cad.saveStep / cad.saveText 가
STEP 파일과 작업 기록(.md)을 여기에 저장하고, 다음 작업 때 cad.importStep('models/...') 으로 다시 불러온다.

  python launcher.py [--port 3007] [--no-browser]
"""

import argparse
import http.server
import os
import socket
import socketserver
import sys
import threading
import urllib.parse
import webbrowser


def resource_path(relative_path: str) -> str:
    base_path = getattr(sys, "_MEIPASS", os.path.abspath(os.path.dirname(__file__)))
    return os.path.join(base_path, relative_path)


def models_dir() -> str:
    # exe 로 실행하면 번들 임시 폴더가 아니라 exe 옆의 models/ 를 쓴다
    base = os.path.dirname(sys.executable) if getattr(sys, "frozen", False) else os.path.dirname(os.path.abspath(__file__))
    path = os.path.join(base, "models")
    os.makedirs(path, exist_ok=True)
    return path


MODELS_DIR = models_dir()
WRITABLE_EXT = {".step", ".stp", ".md", ".js", ".json", ".stl", ".txt"}
MAX_UPLOAD = 200 * 1024 * 1024


def find_free_port(preferred: int = 3007) -> int:
    for port in range(preferred, preferred + 100):
        try:
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
                s.bind(("127.0.0.1", port))
                return port
        except OSError:
            continue
    return preferred


def models_target(url_path: str):
    """'/models/a/b.step' → models 폴더 안의 실제 경로. models 밖이면 None"""
    path = urllib.parse.unquote(urllib.parse.urlsplit(url_path).path)
    if not path.startswith("/models/"):
        return None
    rel = path[len("/models/"):]
    target = os.path.realpath(os.path.join(MODELS_DIR, rel))
    root = os.path.realpath(MODELS_DIR)
    if os.path.commonpath([root, target]) != root or target == root:
        return None
    return target


class Handler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, format, *args):
        pass

    def end_headers(self):
        # 같은 이름으로 다시 저장한 STEP 을 바로 읽을 수 있게 캐시하지 않는다
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def translate_path(self, path):
        target = models_target(path)
        return target if target else super().translate_path(path)

    # 오류는 브라우저 스크립트가 그대로 보여 줄 수 있게 UTF-8 평문으로 (send_error 는 HTML 이고 상태 줄이 latin-1 이다)
    def _fail(self, code, message):
        body = message.encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_PUT(self):
        target = models_target(self.path)
        if not target:
            self._fail(403, "models/ 폴더 안에만 저장할 수 있습니다")
            return
        if os.path.splitext(target)[1].lower() not in WRITABLE_EXT:
            self._fail(415, "저장할 수 없는 확장자입니다. 가능한 확장자: " + ", ".join(sorted(WRITABLE_EXT)))
            return
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0 or length > MAX_UPLOAD:
            self._fail(413, "빈 파일이거나 너무 큽니다 (최대 %d MB)" % (MAX_UPLOAD // (1024 * 1024)))
            return
        data = self.rfile.read(length)
        os.makedirs(os.path.dirname(target), exist_ok=True)
        tmp = target + ".part"
        with open(tmp, "wb") as f:
            f.write(data)
        os.replace(tmp, target)
        rel = os.path.relpath(target, os.path.dirname(MODELS_DIR)).replace(os.sep, "/")
        body = ('{"path": "%s", "bytes": %d}' % (rel, len(data))).encode("utf-8")
        self.send_response(201)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def main() -> None:
    parser = argparse.ArgumentParser(description="Simple CAD Modeler")
    parser.add_argument("--port", type=int, default=3007, help="선호 포트 (사용 중이면 다음 빈 포트)")
    parser.add_argument("--no-browser", action="store_true", help="브라우저를 자동으로 열지 않음")
    args = parser.parse_args()

    os.chdir(resource_path("."))
    port = find_free_port(args.port)
    url = f"http://localhost:{port}"

    with socketserver.ThreadingTCPServer(("127.0.0.1", port), Handler) as httpd:
        print("=" * 50)
        print("  Simple CAD Modeler")
        print("=" * 50)
        print(f"  Running at: {url}")
        print(f"  models/   : {MODELS_DIR}")
        print("  Close this window to stop the server.")
        print("=" * 50)
        if not args.no_browser:
            threading.Timer(0.8, lambda: webbrowser.open(url)).start()
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nShutting down...")


if __name__ == "__main__":
    main()
