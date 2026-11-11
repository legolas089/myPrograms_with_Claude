"""Optimization Sim backend.

Builds 1-D / 2-D optimisation problems (test functions, typed formulas, or
surrogates fitted to synthetic or uploaded data), runs SciPy / CasADi /
Bayesian optimisers on them and returns paths, convergence and statistics.
Serves the static frontend too, so `python server.py` alone is a full app:
    http://localhost:5003

API
    GET  /api/health                         -> {ok, versions}
    GET  /api/catalog                        -> test functions, algorithms, surrogate methods
    POST /api/upload?filename=<name>  <raw file bytes>      -> {dataset_id, columns}
    POST /api/problem {source, dim, func, params, bounds, objective, sampling, surrogate,
                       dataset_id, x_col, y_col, f_col, constraints}  -> problem + landscape
    POST /api/run     {problem_id, algo, options, x0}       -> one run (path, evals, curve, extras)
    POST /api/compare {problem_id, runs: [{algo, options}], x0}           -> {job_id}
    POST /api/multistart {problem_id, runs, n_starts, seed}               -> {job_id}
    GET  /api/job/<id>                       -> {state, done, total, label, result | error}
    POST /api/job/<id>/cancel
"""

from __future__ import annotations

import sys
import threading
import time
import uuid
import warnings
from collections import OrderedDict
from pathlib import Path

import casadi
import numpy as np
import scipy
from flask import Flask, jsonify, request, send_from_directory
from flask_cors import CORS
from werkzeug.exceptions import HTTPException

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from optim import algorithms, batch, functions, loaders, surrogate  # noqa: E402
from optim.jsonsafe import clean  # noqa: E402
from optim.problem import Problem  # noqa: E402

warnings.filterwarnings("ignore", category=RuntimeWarning)
warnings.filterwarnings("ignore", message=".*delta_grad == 0.0.*")

API_PORT = 5003
MAX_ITEMS = 8
JOB_TTL = 1800

app = Flask(__name__, static_folder=str(HERE), static_url_path="")
app.config["MAX_CONTENT_LENGTH"] = 50 * 1024 * 1024
app.json.sort_keys = False
CORS(app)

_lock = threading.Lock()
_datasets: OrderedDict[str, dict] = OrderedDict()
_problems: OrderedDict[str, Problem] = OrderedDict()
_jobs: dict[str, dict] = {}


class Gone(Exception):
    pass


def _put(store: OrderedDict, item) -> str:
    key = uuid.uuid4().hex[:12]
    with _lock:
        store[key] = item
        while len(store) > MAX_ITEMS:
            store.popitem(last=False)
    return key


def _problem(body: dict) -> Problem:
    pid = str(body.get("problem_id", ""))
    with _lock:
        p = _problems.get(pid)
        if p is not None:
            _problems.move_to_end(pid)
    if p is None:
        raise Gone("문제가 만료되었습니다 — 왼쪽에서 문제를 다시 만드세요")
    return p


# ── errors ──────────────────────────────────────────────────────────
@app.errorhandler(ValueError)
def _bad_request(e):
    return jsonify({"error": str(e)}), 400


@app.errorhandler(Gone)
@app.errorhandler(LookupError)
def _gone(e):
    return jsonify({"error": str(e).strip("'\"")}), 404


@app.errorhandler(Exception)
def _crash(e):
    if isinstance(e, HTTPException):
        return e
    app.logger.exception(e)
    return jsonify({"error": f"{type(e).__name__}: {e}"}), 500


# ── routes ──────────────────────────────────────────────────────────
@app.route("/")
def index():
    return send_from_directory(HERE, "index.html")


@app.route("/api/health")
def health():
    return jsonify({"ok": True, "python": sys.version.split()[0], "numpy": np.__version__,
                    "scipy": scipy.__version__, "casadi": casadi.__version__})


@app.route("/api/catalog")
def catalog():
    return jsonify(clean({"functions": functions.catalog(), "algorithms": algorithms.catalog(),
                          "surrogates": [{"key": k, "label": v} for k, v in surrogate.METHODS.items()]}))


@app.route("/api/upload", methods=["POST"])
def upload():
    filename = request.args.get("filename", "")
    columns = loaders.parse(request.get_data(), filename)
    meta = {"filename": filename or "붙여넣은 데이터"}
    ds_id = _put(_datasets, {"columns": columns, "meta": meta})
    return jsonify(clean({"dataset_id": ds_id, "meta": meta,
                          "columns": [{"name": k, "n": int(v.size), "min": float(v.min()), "max": float(v.max())}
                                      for k, v in columns.items()]}))


@app.route("/api/problem", methods=["POST"])
def make_problem():
    spec = request.get_json(force=True) or {}
    t0 = time.perf_counter()
    with _lock:
        datasets = dict(_datasets)
    p = Problem(spec, datasets)
    pid = _put(_problems, p)
    return jsonify(clean({"problem_id": pid, **p.describe(), "landscape": p.landscape(),
                          "build_time": time.perf_counter() - t0}))


@app.route("/api/run", methods=["POST"])
def run_one():
    b = request.get_json(force=True) or {}
    p = _problem(b)
    r = algorithms.run(p, b.get("algo", ""), b.get("options") or {}, b.get("x0"))
    return jsonify(clean(r))


# ── background jobs ────────────────────────────────────────────────
def _start_job(fn, *args) -> str:
    jid = uuid.uuid4().hex[:12]
    stop = threading.Event()
    job = {"state": "running", "done": 0, "total": 1, "label": "", "result": None, "error": None,
           "stop": stop, "t0": time.time()}

    def progress(done, total, label):
        job.update(done=done, total=total, label=label)

    def target():
        try:
            job["result"] = clean(fn(*args, stop, progress))
            job["state"] = "done"
        except algorithms.Aborted:
            job["state"] = "cancelled"
        except Exception as e:  # reported to the page
            job["error"] = f"{type(e).__name__}: {e}" if not isinstance(e, ValueError) else str(e)
            job["state"] = "error"
        job["t1"] = time.time()

    with _lock:
        now = time.time()
        for k in [k for k, j in _jobs.items() if j["state"] != "running" and now - j.get("t1", now) > JOB_TTL]:
            del _jobs[k]
        _jobs[jid] = job
    threading.Thread(target=target, daemon=True).start()
    return jid


@app.route("/api/compare", methods=["POST"])
def compare():
    b = request.get_json(force=True) or {}
    p = _problem(b)
    specs = batch._check_specs(b.get("runs") or [])
    return jsonify({"job_id": _start_job(batch.compare, p, specs, b.get("x0"))})


@app.route("/api/multistart", methods=["POST"])
def multistart():
    b = request.get_json(force=True) or {}
    p = _problem(b)
    specs = batch._check_specs(b.get("runs") or [])
    n, seed = int(b.get("n_starts", 20)), int(b.get("seed", 0))
    if not 1 <= n <= 200 or n * len(specs) > 3000:
        raise ValueError("시작점 수는 1 ~ 200, 시작점 수 × 알고리즘 수 ≤ 3000")
    return jsonify({"job_id": _start_job(batch.multistart, p, specs, n, seed)})


@app.route("/api/job/<jid>")
def job_status(jid):
    job = _jobs.get(jid)
    if job is None:
        raise Gone("작업을 찾을 수 없습니다")
    out = {k: job[k] for k in ("state", "done", "total", "label", "error")}
    out["elapsed"] = (job.get("t1") or time.time()) - job["t0"]
    if job["state"] == "done":
        out["result"] = job["result"]
    return jsonify(out)


@app.route("/api/job/<jid>/cancel", methods=["POST"])
def job_cancel(jid):
    job = _jobs.get(jid)
    if job is not None:
        job["stop"].set()
    return jsonify({"ok": True})


def run(open_browser: bool = False):
    if open_browser:
        import webbrowser
        threading.Timer(0.8, lambda: webbrowser.open(f"http://localhost:{API_PORT}")).start()
    app.run(host="127.0.0.1", port=API_PORT, debug=False, threaded=True)


if __name__ == "__main__":
    run(open_browser="--open" in sys.argv)
