"""Histogram, Gaussian KDE and box-plot statistics.

The KDE is *binned*: samples are linearly binned onto an M-point grid and the
counts are convolved with the Gaussian kernel by FFT. Cost is O(N + M log M)
instead of O(N·M), so 5 million samples take well under a second while the
result matches the exact KDE to ~1e-4 relative error at M = 2048.

Bandwidth rules (statsmodels conventions, A = min(σ, IQR/1.349)):
    silverman   h = 0.9   · A · n^(-1/5)   (robust; default)
    scott       h = 1.059 · A · n^(-1/5)   (normal-reference rule)
The UI multiplies h by a user scale factor.
"""

from __future__ import annotations

import numpy as np
from scipy import signal, stats

GRID_POINTS = 2048
CLIP_IQR_RATIO = 30.0  # data range wider than this many IQRs -> clip the view
CLIP_FENCE = 6.0       # clipped view = [Q1 - 6·IQR, Q3 + 6·IQR] (inside the data)


def bandwidth(x: np.ndarray, method: str = "silverman", scale: float = 1.0) -> float:
    n = x.size
    std = float(np.std(x, ddof=1)) if n > 1 else 0.0
    q1, q3 = np.percentile(x, [25, 75])
    iqr = float(q3 - q1)
    a = min(std, iqr / 1.349) if iqr > 0 else std
    if a <= 0:  # constant data
        a = max(abs(float(np.mean(x))), 1.0) * 1e-3
    c = {"silverman": 0.9, "scott": 1.059}.get(method)
    if c is None:
        raise ValueError(f"알 수 없는 대역폭 방법: {method}")
    if not scale or scale <= 0:
        raise ValueError("대역폭 배율은 0 보다 커야 합니다")
    return c * a * n ** (-0.2) * float(scale)


def view_range(x: np.ndarray, mode: str = "auto") -> dict:
    """x-range for the plots; heavy tails (Cauchy, Pareto) would squash the body."""
    lo, hi = float(np.min(x)), float(np.max(x))
    q1, q3 = np.percentile(x, [25, 75])
    iqr = float(q3 - q1)
    clipped = False
    if mode == "auto" and iqr > 0 and (hi - lo) > CLIP_IQR_RATIO * iqr:
        lo = max(lo, float(q1) - CLIP_FENCE * iqr)
        hi = min(hi, float(q3) + CLIP_FENCE * iqr)
        clipped = True
    if hi <= lo:  # constant data
        pad = max(abs(lo), 1.0) * 0.05
        lo, hi = lo - pad, hi + pad
    outside = int(np.count_nonzero((x < lo) | (x > hi)))
    return {"lo": lo, "hi": hi, "clipped": clipped, "n_outside": outside,
            "frac_outside": outside / x.size}


def histogram(x: np.ndarray, lo: float, hi: float, discrete: bool) -> dict:
    inside = x[(x >= lo) & (x <= hi)]
    if discrete and (hi - lo) <= 400:
        edges = np.arange(np.floor(lo) - 0.5, np.ceil(hi) + 1.0, 1.0)
        rule = "integer"
    else:
        q1, q3 = np.percentile(inside, [25, 75]) if inside.size else (lo, hi)
        w = 2 * (q3 - q1) * max(inside.size, 1) ** (-1 / 3)  # Freedman–Diaconis
        nb = int(np.ceil((hi - lo) / w)) if w > 0 else int(np.sqrt(max(inside.size, 1)))
        nb = int(np.clip(nb, 10, 200))
        edges = np.linspace(lo, hi, nb + 1)
        rule = "freedman-diaconis"
    counts, edges = np.histogram(inside, bins=edges)
    widths = np.diff(edges)
    return {
        "edges": edges, "counts": counts,
        "density": counts / (x.size * widths),  # normalised by ALL samples
        "rule": rule, "bins": int(counts.size),
    }


def kde(x: np.ndarray, lo: float, hi: float, h: float, m: int = GRID_POINTS) -> dict:
    grid = np.linspace(lo, hi, m)
    dx = grid[1] - grid[0]
    pos = (x - lo) / dx
    keep = (pos >= 0) & (pos <= m - 1)
    pos = pos[keep]
    j = np.minimum(np.floor(pos).astype(np.int64), m - 2)
    w = pos - j
    c = np.bincount(j, 1 - w, m) + np.bincount(j + 1, w, m)
    half = int(min(m - 1, np.ceil(5 * h / dx)))
    k = stats.norm.pdf(np.arange(-half, half + 1) * dx / h) / h
    dens = signal.fftconvolve(c, k, mode="same") / x.size
    dens = np.maximum(dens, 0.0)  # FFT round-off

    peaks, _ = signal.find_peaks(dens, prominence=0.02 * float(dens.max() or 1))
    if peaks.size == 0:
        peaks = np.array([int(np.argmax(dens))])
    order = peaks[np.argsort(dens[peaks])[::-1]]
    return {
        "x": grid, "y": dens, "h": h,
        "mode": float(grid[order[0]]),
        "peaks": [{"x": float(grid[i]), "density": float(dens[i])} for i in order[:5]],
        "n_peaks": int(peaks.size),
        "mass_in_view": float(np.trapezoid(dens, grid)),
    }


def box(x: np.ndarray, s: dict) -> dict:
    q1, q3, iqr = s["q1"], s["q3"], s["iqr"]
    lo_f, hi_f = q1 - 1.5 * iqr, q3 + 1.5 * iqr
    inner = x[(x >= lo_f) & (x <= hi_f)]
    return {
        "q1": q1, "median": s["median"], "q3": q3, "mean": s["mean"],
        "lowerfence": float(inner.min()) if inner.size else q1,
        "upperfence": float(inner.max()) if inner.size else q3,
        "n_low": int(np.count_nonzero(x < lo_f)),
        "n_high": int(np.count_nonzero(x > hi_f)),
    }


def discrete_mode(x: np.ndarray) -> float:
    vals, counts = np.unique(x, return_counts=True)
    return float(vals[np.argmax(counts)])
