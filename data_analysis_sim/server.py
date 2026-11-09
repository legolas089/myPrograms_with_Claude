"""Data Analysis Simulator backend.

Holds datasets in memory and returns analysis *results* only, so raw samples
cross the wire once (upload) or never (synthetic data is generated here).
Serves the static frontend too, so `python server.py` alone is a full app:
    http://localhost:5002

API
    GET  /api/health                      -> {ok, versions}
    GET  /api/distributions               -> synthetic-data catalog
    POST /api/generate {dist, params, n, seed, ts}       -> {dataset_id, columns, meta}
    POST /api/upload?filename=<name>  <raw file bytes>   -> {dataset_id, columns, meta}
    POST /api/analyze {dataset_id, column, kde, view}    -> overview (stats + plots)
    POST /api/density {dataset_id, column, kde, view}    -> histogram + KDE only
    POST /api/risk    {dataset_id, column}               -> VaR/CVaR, tail index, outliers, drawdown
    POST /api/fit     {dataset_id, column}               -> MLE fits ranked by AIC, Q-Q, ECDF, normality tests
    POST /api/timeseries {dataset_id, column, window, lags, segments} -> rolling, trend, ACF/PACF, ADF/KPSS, DFA
    POST /api/spectral   {dataset_id, column, nperseg, detrend, spec_nperseg} -> FFT, peaks, Welch PSD, STFT
    POST /api/set_fs     {dataset_id, fs | time_column}  -> sampling rate of an uploaded dataset
    POST /api/sweep      {dist, params, ns, seeds, base_seed} -> seed × N convergence of estimates
"""

from __future__ import annotations

import sys
import threading
import uuid
from collections import OrderedDict
from pathlib import Path

import numpy as np
import scipy
from flask import Flask, jsonify, request, send_from_directory
from flask_cors import CORS
from werkzeug.exceptions import HTTPException

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from analysis import (  # noqa: E402
    density, descriptive, fitting, loaders, normality, risk, spectral, sweep, synth, timeseries,
)
from analysis.jsonsafe import clean  # noqa: E402

API_PORT = 5002
MAX_DATASETS = 8

app = Flask(__name__, static_folder=str(HERE), static_url_path="")
app.config["MAX_CONTENT_LENGTH"] = 200 * 1024 * 1024
app.json.sort_keys = False  # keep parameter / percentile order
CORS(app)

class DatasetGone(Exception):
    pass


_lock = threading.Lock()
_datasets: OrderedDict[str, dict] = OrderedDict()


# ── dataset store ──────────────────────────────────────────────────
def _store(columns: dict[str, np.ndarray], meta: dict) -> str:
    ds_id = uuid.uuid4().hex[:12]
    with _lock:
        _datasets[ds_id] = {"columns": columns, "meta": meta, "cache": {}}
        while len(_datasets) > MAX_DATASETS:
            _datasets.popitem(last=False)
    return ds_id


def _get(body: dict) -> tuple[dict, str, np.ndarray]:
    with _lock:
        ds = _datasets.get(str(body.get("dataset_id", "")))
        if ds is not None:
            _datasets.move_to_end(body["dataset_id"])
    if ds is None:
        raise DatasetGone("데이터셋이 만료되었습니다 — 데이터를 다시 생성/불러오세요")
    cols = ds["columns"]
    col = body.get("column") or next(iter(cols))
    if col not in cols:
        raise ValueError(f"열이 없습니다: {col}")
    return ds, col, cols[col]


def _dataset_reply(ds_id: str, columns: dict, meta: dict):
    return jsonify(clean({
        "dataset_id": ds_id,
        "columns": [{"name": k, "n": int(v.size)} for k, v in columns.items()],
        "meta": meta,
    }))


def _summary(ds: dict, col: str, x: np.ndarray) -> dict:
    key = ("summary", col)
    if key not in ds["cache"]:
        ds["cache"][key] = descriptive.summary(x)
    return ds["cache"][key]


def _is_discrete(meta: dict, s: dict) -> bool:
    return bool(meta.get("discrete")) or (s["integer_valued"] and (s["n_unique"] or 999) <= 200)


def _true_frozen(meta: dict):
    """Population distribution of untouched synthetic data, else None."""
    if meta.get("source") != "synthetic" or meta.get("ts_active"):
        return None
    return synth.build(meta["dist"], meta["params"])[1]


def _cached(ds: dict, key: tuple, make):
    if key not in ds["cache"]:
        ds["cache"][key] = make()
    return ds["cache"][key]


def _density(ds: dict, x: np.ndarray, s: dict, body: dict) -> dict:
    opts = body.get("kde") or {}
    method = opts.get("method", "silverman")
    scale = float(opts.get("scale", 1.0))
    meta = ds["meta"]
    discrete = _is_discrete(meta, s)
    h = density.bandwidth(x, method, scale)
    view = density.view_range(x, body.get("view", "auto"))
    lo, hi = view["lo"], view["hi"]
    if not view["clipped"]:  # let the KDE tails die out inside the plot
        lo, hi = lo - 3 * h, hi + 3 * h
    hist = density.histogram(x, view["lo"], view["hi"], discrete)
    k = density.kde(x, lo, hi, h)
    out = {"view": view, "hist": hist, "kde": k, "bw_method": method, "bw_scale": scale,
           "discrete": discrete, "true": None}
    if meta.get("source") == "synthetic" and not meta.get("ts_active"):
        if meta.get("discrete"):
            xs = np.arange(np.floor(view["lo"]), np.ceil(view["hi"]) + 1)
        else:
            xs = k["x"]
        out["true"] = {"x": xs, "y": synth.true_density(meta["dist"], meta["params"], xs)}
    return out


# ── routes ─────────────────────────────────────────────────────────
@app.errorhandler(ValueError)
def _bad_request(e):
    return jsonify({"error": str(e)}), 400


@app.errorhandler(DatasetGone)
def _gone(e):
    return jsonify({"error": str(e)}), 404


@app.errorhandler(Exception)
def _crash(e):
    if isinstance(e, HTTPException):
        return e
    app.logger.exception(e)
    return jsonify({"error": f"{type(e).__name__}: {e}"}), 500


@app.route("/")
def index():
    return send_from_directory(HERE, "index.html")


@app.route("/api/health")
def health():
    return jsonify({"ok": True, "python": sys.version.split()[0],
                    "numpy": np.__version__, "scipy": scipy.__version__})


@app.route("/api/distributions")
def distributions():
    return jsonify(clean({"distributions": synth.catalog(), "max_n": synth.MAX_N}))


@app.route("/api/generate", methods=["POST"])
def generate():
    b = request.get_json(force=True) or {}
    x, meta = synth.generate(b.get("dist", "normal"), b.get("params") or {},
                             b.get("n", 1000), b.get("seed", 0), b.get("ts") or {})
    columns = {"value": x}
    return _dataset_reply(_store(columns, meta), columns, meta)


@app.route("/api/upload", methods=["POST"])
def upload():
    filename = request.args.get("filename", "")
    columns = loaders.parse(request.get_data(), filename)
    meta = {"source": "upload", "filename": filename or "붙여넣은 데이터", "fs": 1.0,
            "discrete": False, "theory": None}
    return _dataset_reply(_store(columns, meta), columns, meta)


@app.route("/api/analyze", methods=["POST"])
def analyze():
    b = request.get_json(force=True) or {}
    ds, col, x = _get(b)
    s = _summary(ds, col, x)
    dens = _density(ds, x, s, b)
    meta = ds["meta"]
    mode = density.discrete_mode(x) if dens["discrete"] else dens["kde"]["mode"]
    fs = float(b.get("fs") or meta.get("fs") or 1.0)
    return jsonify(clean({
        "column": col, "meta": meta, "summary": s, "mode": mode,
        "theory": meta.get("theory"),
        "density": dens, "box": density.box(x, s),
        "series": timeseries.envelope(x, fs),
    }))


@app.route("/api/density", methods=["POST"])
def density_only():
    b = request.get_json(force=True) or {}
    ds, col, x = _get(b)
    s = _summary(ds, col, x)
    dens = _density(ds, x, s, b)
    mode = density.discrete_mode(x) if dens["discrete"] else dens["kde"]["mode"]
    return jsonify(clean({"column": col, "density": dens, "mode": mode}))


@app.route("/api/risk", methods=["POST"])
def risk_route():
    b = request.get_json(force=True) or {}
    ds, col, x = _get(b)
    s = _summary(ds, col, x)
    meta = ds["meta"]
    fs = float(meta.get("fs") or 1.0)

    def make():
        frozen = _true_frozen(meta)
        th_mean = meta["theory"]["mean"] if frozen is not None else np.nan
        return risk.analyze(x, s, fs, frozen, bool(meta.get("discrete")), th_mean)
    return jsonify(clean({"column": col, "fs": fs, **_cached(ds, ("risk", col), make)}))


@app.route("/api/fit", methods=["POST"])
def fit_route():
    b = request.get_json(force=True) or {}
    ds, col, x = _get(b)
    s = _summary(ds, col, x)
    meta = ds["meta"]

    def make():
        discrete = _is_discrete(meta, s)
        rows, notes = fitting.fit_all(x, discrete)
        xs = np.sort(x)
        view = density.view_range(x, "auto")
        true_key = None
        if _true_frozen(meta) is not None:
            true_key = fitting.SYNTH_TO_FAMILY.get(meta["dist"])
        return {
            "discrete": discrete, "families": fitting.public(rows), "notes": notes,
            "true_family": true_key,
            "curves": fitting.curves(rows, view["lo"], view["hi"], discrete),
            "qq": fitting.qq(xs, rows), "ecdf": fitting.ecdf(xs), "view": view,
            "normality": normality.tests(x),
        }
    return jsonify(clean({"column": col, **_cached(ds, ("fit", col), make)}))


def _int_or_none(v):
    return int(v) if v not in (None, "", "auto") else None


@app.route("/api/timeseries", methods=["POST"])
def timeseries_route():
    b = request.get_json(force=True) or {}
    ds, col, x = _get(b)
    fs = float(ds["meta"].get("fs") or 1.0)
    n = x.size
    window = int(b.get("window") or max(5, min(n // 20, 1000)))
    lags = int(b.get("lags") or min(40, n // 4))
    k = int(b.get("segments") or 10)
    key = ("ts", col, fs, window, lags, k)
    res = _cached(ds, key, lambda: timeseries.analyze(x, fs, window, lags, k))
    return jsonify(clean({"column": col, **res}))


@app.route("/api/spectral", methods=["POST"])
def spectral_route():
    b = request.get_json(force=True) or {}
    ds, col, x = _get(b)
    fs = float(ds["meta"].get("fs") or 1.0)
    nperseg, spec = _int_or_none(b.get("nperseg")), _int_or_none(b.get("spec_nperseg"))
    detrend = b.get("detrend", "linear")
    key = ("spec", col, fs, nperseg, detrend, spec)
    res = _cached(ds, key, lambda: spectral.analyze(x, fs, nperseg, detrend, spec))
    return jsonify(clean({"column": col, **res}))


@app.route("/api/set_fs", methods=["POST"])
def set_fs():
    """Sampling rate for uploaded data: a number, or derived from a time column."""
    b = request.get_json(force=True) or {}
    ds, _, _ = _get(b)
    meta = ds["meta"]
    if meta.get("source") == "synthetic":
        raise ValueError("합성 데이터의 fs 는 생성할 때 정합니다")
    note = ""
    tcol = b.get("time_column")
    if tcol:
        if tcol not in ds["columns"]:
            raise ValueError(f"열이 없습니다: {tcol}")
        dt = np.diff(ds["columns"][tcol])
        dt = dt[np.isfinite(dt)]
        med = float(np.median(dt)) if dt.size else 0.0
        if med <= 0:
            raise ValueError("시간 열이 증가하지 않아 간격을 구할 수 없습니다")
        fs = 1.0 / med
        jitter = float(np.std(dt) / med)
        if jitter > 0.01:
            note = (f"시간 간격이 고르지 않습니다 (표준편차가 중앙값의 {jitter * 100:.1f}%). "
                    "주파수 분석은 등간격을 가정하므로 결과를 주의해서 보세요.")
        meta.update({"time_column": tcol, "fs_note": note})
    else:
        fs = float(b.get("fs") or 0)
        if not np.isfinite(fs) or fs <= 0:
            raise ValueError("fs 는 0 보다 커야 합니다")
        meta.update({"time_column": None, "fs_note": ""})
    meta["fs"] = fs
    ds["cache"].clear()  # risk/time/frequency results depend on fs
    return jsonify(clean({"meta": meta}))


@app.route("/api/sweep", methods=["POST"])
def sweep_route():
    b = request.get_json(force=True) or {}
    res = sweep.run(b.get("dist", "normal"), b.get("params") or {}, b.get("ns") or [],
                    b.get("seeds", 20), b.get("base_seed", 0))
    return jsonify(clean(res))


def run(open_browser: bool = False):
    if open_browser:
        import webbrowser
        threading.Timer(0.8, lambda: webbrowser.open(f"http://localhost:{API_PORT}")).start()
    app.run(host="127.0.0.1", port=API_PORT, debug=False, threaded=True)


if __name__ == "__main__":
    run(open_browser="--open" in sys.argv)
