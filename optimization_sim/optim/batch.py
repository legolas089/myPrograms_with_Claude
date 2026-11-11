"""Many runs at once: algorithm comparison from one start point, and the
multi-start test (same random starts / seeds for every algorithm).

Both run in a background thread (see server.py) and report progress through
a callback; a threading.Event cancels between — and inside — runs.
"""

from __future__ import annotations

import threading
import warnings

import numpy as np
from . import algorithms
from .problem import sobol

CURVE_GRID = 60


def _check_specs(specs: list[dict]) -> list[dict]:
    if not specs:
        raise ValueError("알고리즘을 하나 이상 고르세요")
    if len(specs) > 30:
        raise ValueError("한 번에 30개까지 비교할 수 있습니다")
    for s in specs:
        if s.get("algo") not in algorithms.BY_KEY:
            raise ValueError(f"알 수 없는 알고리즘: {s.get('algo')}")
    return specs


def compare(prob, specs: list[dict], x0, stop: threading.Event, progress) -> dict:
    specs = _check_specs(specs)
    out = []
    for i, s in enumerate(specs):
        progress(i, len(specs), algorithms.BY_KEY[s["algo"]]["label"])
        try:
            r = algorithms.run(prob, s["algo"], s.get("options") or {}, x0, stop=stop, light=True)
        except algorithms.Aborted:
            raise
        except Exception as e:  # one failing method must not sink the comparison
            r = {"algo": s["algo"], "label": algorithms.BY_KEY[s["algo"]]["label"], "error": f"{type(e).__name__}: {e}"}
        out.append(r)
    progress(len(specs), len(specs), "")
    return {"runs": out, "x0": x0}


def starts(prob, n: int, seed: int) -> np.ndarray:
    lo, width = prob.bounds[:, 0], prob.bounds[:, 1] - prob.bounds[:, 0]
    u = sobol(prob.dim, n, np.random.default_rng(seed))
    return lo + u * width


def _gap_at(curve: dict, ref_f: float, grid: np.ndarray) -> np.ndarray:
    """Best-so-far gap (f − f_ref) as a step function evaluated on an nfev grid."""
    n, best = np.asarray(curve["n"], float), np.asarray(curve["best"], float)
    if n.size == 0:
        return np.full(grid.size, np.nan)
    idx = np.searchsorted(n, grid, side="right") - 1
    v = np.where(idx >= 0, best[np.clip(idx, 0, None)], np.nan)
    v = np.where(np.isfinite(v), v - ref_f, np.nan)
    return np.maximum(v, 0)


def multistart(prob, specs: list[dict], n_starts: int, seed: int, stop: threading.Event, progress) -> dict:
    specs = _check_specs(specs)
    if not 1 <= n_starts <= 200:
        raise ValueError("시작점 수는 1 ~ 200")
    if n_starts * len(specs) > 3000:
        raise ValueError("시작점 수 × 알고리즘 수는 3000 이하로 해 주세요")
    X0 = starts(prob, n_starts, seed)
    total = n_starts * len(specs)
    done = 0
    algos = []
    for s in specs:
        algo = algorithms.BY_KEY[s["algo"]]
        runs, curves = [], []
        err = None
        for i in range(n_starts):
            progress(done, total, f"{algo['label']} — {i + 1}/{n_starts}")
            opts = dict(s.get("options") or {})
            if algo["stochastic"]:
                opts["seed"] = int(seed + i)
            try:
                r = algorithms.run(prob, s["algo"], opts, X0[i], stop=stop, light=True)
            except algorithms.Aborted:
                raise
            except Exception as e:
                err = f"{type(e).__name__}: {e}"
                done += n_starts - i
                break
            runs.append({k: r[k] for k in ("x", "f", "gap", "dist", "basin", "violation", "nfev", "njev",
                                           "nhev", "nit", "time", "success")})
            runs[-1]["x0"] = X0[i] if algo["x0"] else None
            curves.append(r["curve"])
            done += 1
        entry = {"algo": s["algo"], "label": algo["label"], "group": algo["group"],
                 "uses_x0": algo["x0"], "stochastic": algo["stochastic"], "runs": runs, "error": err}
        if curves:
            nmax = max((c["n"][-1] if len(c["n"]) else 1) for c in curves)
            grid = np.unique(np.round(np.geomspace(1, max(nmax, 1), CURVE_GRID)))
            G = np.array([_gap_at(c, prob.ref_f, grid) for c in curves])
            with np.errstate(all="ignore"), warnings.catch_warnings():
                warnings.simplefilter("ignore", RuntimeWarning)
                entry["curve"] = {"n": grid, "q25": np.nanpercentile(G, 25, axis=0),
                                  "q50": np.nanpercentile(G, 50, axis=0),
                                  "q75": np.nanpercentile(G, 75, axis=0)}
        algos.append(entry)
    progress(total, total, "")
    return {"algos": algos, "starts": X0, "seed": seed, "n_starts": n_starts}
