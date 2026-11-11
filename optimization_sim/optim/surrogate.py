"""Data -> smooth objective.

Scattered samples (x, f) or (x, y, f) are turned into a function the
optimisers can query: a fitted model (RBF / GP / spline / linear) is
evaluated on a dense grid over the search box, and that grid becomes a CasADi
interpolant, so gradients and Hessians are available to every solver
(B-spline for the smooth models, piecewise-linear for "linear").
"""

from __future__ import annotations

import warnings

import numpy as np
from scipy.interpolate import (
    CloughTocher2DInterpolator, CubicSpline, LinearNDInterpolator, NearestNDInterpolator,
    RBFInterpolator,
)

GRID_N = {1: 1001, 2: 121}
GP_MAX_N = 1500
METHODS = {
    "rbf": "RBF (thin-plate spline)",
    "gp": "가우시안 과정 (잡음 자동 추정)",
    "cubic": "3차 스플라인 / Clough–Tocher",
    "linear": "선형 보간",
}


def grid_axes(bounds: np.ndarray, dim: int) -> list[np.ndarray]:
    n = GRID_N[dim]
    return [np.linspace(lo, hi, n) for lo, hi in bounds]


def _dedupe_1d(x: np.ndarray, v: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Average values at repeated x (splines need strictly increasing x)."""
    ux, inv = np.unique(x, return_inverse=True)
    sums = np.bincount(inv, weights=v)
    return ux, sums / np.bincount(inv)


def fit(points: np.ndarray, values: np.ndarray, bounds: np.ndarray, method: str,
        smoothing: float, seed: int = 0) -> dict:
    """Returns {axes, grid (values on the mesh, 'ij' indexing), predict, info}."""
    n, dim = points.shape
    if method not in METHODS:
        raise ValueError(f"알 수 없는 대리모델: {method}")
    if n < dim + 2:
        raise ValueError(f"데이터가 너무 적습니다 ({n}개) — {dim}차원이면 {dim + 2}개 이상 필요")
    lo, width = bounds[:, 0], bounds[:, 1] - bounds[:, 0]
    u = (points - lo) / width                     # unit box: kernels see a round domain
    mu, sd = float(np.mean(values)), float(np.std(values)) or 1.0
    z = (values - mu) / sd                       # smoothing is scale free
    axes = grid_axes(bounds, dim)
    mesh = np.stack(np.meshgrid(*[(a - l) / w for a, l, w in zip(axes, lo, width)], indexing="ij"), -1)
    q = mesh.reshape(-1, dim)
    info = {"method": method, "label": METHODS[method], "n": int(n), "smoothing": float(smoothing)}
    notes = []

    if method == "rbf":
        neighbors = None if n <= 2500 else 64
        if neighbors:
            notes.append(f"N 이 커서 RBF 를 이웃 {neighbors}개만 쓰는 국소 RBF 로 계산했습니다.")
        model = RBFInterpolator(u, z, kernel="thin_plate_spline", smoothing=max(smoothing, 0.0),
                                neighbors=neighbors)
        pred = model
    elif method == "gp":
        from sklearn.exceptions import ConvergenceWarning
        from sklearn.gaussian_process import GaussianProcessRegressor
        from sklearn.gaussian_process.kernels import ConstantKernel, Matern, WhiteKernel
        idx = np.arange(n)
        if n > GP_MAX_N:
            idx = np.random.default_rng(seed).choice(n, GP_MAX_N, replace=False)
            notes.append(f"GP 는 무작위 {GP_MAX_N}개 점으로 학습했습니다 (N={n}).")
        kernel = (ConstantKernel(1.0, (1e-3, 1e5)) * Matern([0.2] * dim, (1e-3, 10.0), nu=2.5)
                  + WhiteKernel(1e-2, (1e-10, 1.0)))
        gp = GaussianProcessRegressor(kernel, normalize_y=False, n_restarts_optimizer=2,
                                      random_state=seed)
        with warnings.catch_warnings():
            warnings.simplefilter("ignore", ConvergenceWarning)
            gp.fit(u[idx], z[idx])
        k = gp.kernel_
        info["noise_std"] = float(np.sqrt(k.k2.noise_level) * sd)
        info["length_scale"] = (np.atleast_1d(k.k1.k2.length_scale) * width).tolist()
        pred = gp.predict
    elif method == "cubic":
        if dim == 1:
            ux, uv = _dedupe_1d(u[:, 0], z)
            if ux.size < 4:
                raise ValueError("3차 스플라인에는 서로 다른 x 가 4개 이상 필요합니다")
            cs = CubicSpline(ux, uv, bc_type="natural", extrapolate=True)
            pred = lambda pts: cs(pts[:, 0])  # noqa: E731
        else:
            ct = CloughTocher2DInterpolator(u, z)
            near = NearestNDInterpolator(u, z)
            pred = lambda pts: _fill(ct(pts), near, pts)  # noqa: E731
    else:  # linear
        if dim == 1:
            ux, uv = _dedupe_1d(u[:, 0], z)
            pred = lambda pts: np.interp(pts[:, 0], ux, uv)  # noqa: E731
        else:
            li = LinearNDInterpolator(u, z)
            near = NearestNDInterpolator(u, z)
            pred = lambda pts: _fill(li(pts), near, pts)  # noqa: E731

    grid = (np.asarray(pred(q)) * sd + mu).reshape([a.size for a in axes])
    resid = values - (np.asarray(pred(u)) * sd + mu)
    info["rmse"] = float(np.sqrt(np.mean(resid ** 2)))
    info["notes"] = notes
    if method in ("cubic", "linear") and dim == 2:
        info["notes"].append("점들의 볼록 껍질 밖은 가장 가까운 점의 값으로 채웠습니다.")
    return {"axes": axes, "grid": grid, "info": info,
            "kind": "linear" if method == "linear" else "bspline"}


def _fill(v: np.ndarray, near, pts: np.ndarray) -> np.ndarray:
    bad = ~np.isfinite(v)
    if bad.any():
        v = v.copy()
        v[bad] = near(pts[bad])
    return v
