"""An optimisation problem in 1-D or 2-D.

    minimise f(x)  subject to  lo <= x <= hi,  g_i(x) <= 0,  h_j(x) = 0

f is one CasADi expression whatever its origin — a test function, a typed
formula, or a surrogate fitted to (synthetic or user) data — so every solver
gets exact gradients/Hessians by automatic differentiation. Because the
dimension is at most 2, the reference global minimum is found by brute force
(dense grid + local polish), which makes "did the solver find the global
minimum?" answerable for any problem.
"""

from __future__ import annotations

import math
import warnings

import casadi as ca
import numpy as np
from scipy.optimize import minimize
from scipy.stats import qmc

from . import expr as fexpr
from . import functions, surrogate
from .jsonsafe import sig

NAMES = ["x", "y"]
PLOT_N = {1: 801, 2: 141}
REF_N = {1: 20001, 2: 401}
MAX_SAMPLES = 20000
MAX_LOCAL_MINIMA = 150


class FunSet:
    """Compiled CasADi functions + NumPy wrappers. One per run, so concurrent
    runs never share evaluation memory."""

    def __init__(self, prob: "Problem"):
        X = prob.X
        f = prob.f_expr
        self.F = ca.Function("f", [X], [f])
        self.G = ca.Function("g", [X], [ca.gradient(f, X)])
        self.H = ca.Function("h", [X], [ca.hessian(f, X)[0]])
        self.n_ineq = sum(c["kind"] == "ineq" for c in prob.cons)
        self.n_eq = len(prob.cons) - self.n_ineq
        # inequalities first, then equalities
        order = [c for c in prob.cons if c["kind"] == "ineq"] + [c for c in prob.cons if c["kind"] == "eq"]
        self.cons = order
        if order:
            gv = ca.vertcat(*[c["expr"] for c in order])
            self.C = ca.Function("c", [X], [gv])
            self.JC = ca.Function("jc", [X], [ca.jacobian(gv, X)])
        else:
            self.C = self.JC = None
        self.T = ca.Function("t", [X], [prob.true_expr]) if prob.true_expr is not None else None

    def f(self, x) -> float:
        v = float(self.F(np.asarray(x, float)))
        return v if math.isfinite(v) else math.inf

    def grad(self, x) -> np.ndarray:
        return np.asarray(self.G(np.asarray(x, float))).ravel()

    def hess(self, x) -> np.ndarray:
        return np.asarray(self.H(np.asarray(x, float)))

    def c(self, x) -> np.ndarray:
        """Constraint values: [g (<=0) …, h (=0) …]."""
        if self.C is None:
            return np.zeros(0)
        return np.asarray(self.C(np.asarray(x, float))).ravel()

    def jc(self, x) -> np.ndarray:
        return np.asarray(self.JC(np.asarray(x, float))).reshape(len(self.cons), -1)

    def violation(self, x) -> float:
        if self.C is None:
            return 0.0
        v = self.c(x)
        gi, he = v[: self.n_ineq], v[self.n_ineq:]
        return float(max(np.max(np.maximum(gi, 0), initial=0.0), np.max(np.abs(he), initial=0.0)))

    def true_f(self, x):
        return float(self.T(np.asarray(x, float))) if self.T is not None else None

    def map(self, fun: ca.Function, pts: np.ndarray) -> np.ndarray:
        """Evaluate a scalar/vector function at many points (rows of pts)."""
        out = np.asarray(fun.map(pts.shape[0])(pts.T))
        return out


def _mesh(bounds: np.ndarray, n: int) -> tuple[list[np.ndarray], np.ndarray]:
    axes = [np.linspace(lo, hi, n) for lo, hi in bounds]
    mesh = np.stack(np.meshgrid(*axes, indexing="ij"), -1).reshape(-1, len(axes))
    return axes, mesh


def _bounds(raw, dim: int) -> np.ndarray:
    try:
        b = np.asarray(raw, float).reshape(dim, 2)
    except (TypeError, ValueError):
        raise ValueError("탐색 영역(하한·상한)을 숫자로 입력하세요") from None
    if not np.all(np.isfinite(b)) or np.any(b[:, 1] <= b[:, 0]):
        raise ValueError("탐색 영역은 하한 < 상한 인 유한한 값이어야 합니다")
    return b


def sobol(dim: int, n: int, rng: np.random.Generator) -> np.ndarray:
    """Scrambled Sobol' points (any n; the power-of-2 balance warning is noise here)."""
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", UserWarning)
        return qmc.Sobol(d=dim, scramble=True, rng=rng).random(n)


def _samples(bounds: np.ndarray, n: int, method: str, seed: int) -> np.ndarray:
    dim = bounds.shape[0]
    lo, width = bounds[:, 0], bounds[:, 1] - bounds[:, 0]
    if method == "grid":
        m = max(2, int(round(n ** (1 / dim))))
        axes = [np.linspace(0, 1, m)] * dim
        u = np.stack(np.meshgrid(*axes, indexing="ij"), -1).reshape(-1, dim)
    elif method == "lhs":
        u = qmc.LatinHypercube(d=dim, rng=np.random.default_rng(seed)).random(n)
    elif method == "sobol":
        u = sobol(dim, n, np.random.default_rng(seed))
    else:
        u = np.random.default_rng(seed).random((n, dim))
    return lo + u * width


class Problem:
    def __init__(self, spec: dict, datasets: dict):
        self.spec = spec
        source = spec.get("source", "function")
        self.notes: list[str] = []
        self.data = None          # {"points": (n,d), "values": (n,)}
        self.surrogate = None     # info dict
        self.true_expr = None     # known function behind synthetic samples
        self.known = None         # literature minima of a test function
        self.x0_default = None

        if source == "function":
            self._from_function(spec)
        elif source == "data":
            self._from_data(spec, datasets)
        else:
            raise ValueError(f"알 수 없는 문제 출처: {source}")

        self.cons = []
        for text in spec.get("constraints") or []:
            if str(text).strip():
                self.cons.append(fexpr.constraint(str(text), self.X))
        if len(self.cons) > 4:
            raise ValueError("제약식은 4개까지 넣을 수 있습니다")
        self.funs = FunSet(self)
        self._reference()

    # ── construction ────────────────────────────────────────────────
    def _from_function(self, spec: dict):
        dim = int(spec.get("dim", 2))
        if dim not in (1, 2):
            raise ValueError("1차원 또는 2차원만 지원합니다")
        self.dim = dim
        self.X = ca.SX.sym("X", dim)
        key = spec.get("func", "rosenbrock")
        if key == functions.CUSTOM_KEY:
            text = str(spec.get("expr") or "").strip()
            if not text:
                raise ValueError("목적 함수 수식을 입력하세요")
            f, smooth = fexpr.objective(text, self.X)
            if not ca.depends_on(f, self.X):
                raise ValueError("수식에 변수(x" + (", y" if dim == 2 else "") + ")가 없습니다")
            self.label, self.formula, self.params = "직접 입력", text, {}
        else:
            f, self.params, self.known, smooth, self.label = functions.build(key, dim, spec.get("params") or {}, self.X)
            self.formula = functions.get(key, dim)[3]
        self.bounds = _bounds(spec.get("bounds") or functions_domain(key, dim), dim)
        self.func_key = key
        self.smooth = smooth

        if spec.get("objective", "true") == "samples":
            sm = spec.get("sampling") or {}
            n = int(sm.get("n", 40))
            if not 3 <= n <= MAX_SAMPLES:
                raise ValueError(f"샘플 수는 3 ~ {MAX_SAMPLES:,} 개")
            seed = int(sm.get("seed", 0))
            pts = _samples(self.bounds, n, sm.get("method", "lhs"), seed)
            T = ca.Function("t", [self.X], [f])
            vals = np.asarray(T.map(pts.shape[0])(pts.T)).ravel()
            # noise relative to the spread of f over the box (10%–90% range)
            _, mesh = _mesh(self.bounds, 101 if dim == 2 else 2001)
            fg = np.asarray(T.map(mesh.shape[0])(mesh.T)).ravel()
            fg = fg[np.isfinite(fg)]
            spread = float(np.percentile(fg, 90) - np.percentile(fg, 10)) if fg.size else 1.0
            pct = float(sm.get("noise_pct", 0.0))
            sigma = pct / 100 * spread
            if sigma > 0:
                vals = vals + np.random.default_rng(seed + 7919).normal(0, sigma, vals.shape)
            ok = np.isfinite(vals)
            if not ok.all():
                self.notes.append(f"함수 값이 정의되지 않는 샘플 {int((~ok).sum())}개를 뺐습니다.")
            self.sampling = {"n": int(pts.shape[0]), "method": sm.get("method", "lhs"), "seed": seed,
                             "noise_pct": pct, "noise_sigma": sigma}
            self.true_expr = f
            self._set_surrogate(pts[ok], vals[ok], spec.get("surrogate") or {}, seed)
            self.source = "samples"
        else:
            self.f_expr = f
            self.source = "function"
            if not smooth:
                self.notes.append("미분 불가능한 점이 있는 함수입니다 — 기울기·헤시안 기반 방법이 그 근처에서 멈추거나 진동할 수 있습니다.")

    def _from_data(self, spec: dict, datasets: dict):
        ds = datasets.get(str(spec.get("dataset_id", "")))
        if ds is None:
            raise LookupError("데이터셋이 만료되었습니다 — 데이터를 다시 불러오세요")
        cols = ds["columns"]
        dim = int(spec.get("dim", 1))
        if dim not in (1, 2):
            raise ValueError("1차원 또는 2차원만 지원합니다")
        names = [spec.get("x_col"), spec.get("y_col")][:dim] + [spec.get("f_col")]
        for nm in names:
            if nm not in cols:
                raise ValueError(f"열이 없습니다: {nm}")
        if len(set(names)) < len(names):
            raise ValueError("입력 변수 열과 목적값 열은 서로 달라야 합니다")
        arrs = [cols[nm] for nm in names]
        n = min(a.size for a in arrs)
        if any(a.size != n for a in arrs):
            self.notes.append(f"열 길이가 달라 앞쪽 {n}행만 썼습니다.")
        M = np.column_stack([a[:n] for a in arrs])
        M = M[np.all(np.isfinite(M), axis=1)]
        if M.shape[0] > MAX_SAMPLES:
            raise ValueError(f"데이터 점은 {MAX_SAMPLES:,}개까지 받습니다")
        pts, vals = M[:, :dim], M[:, dim]
        self.dim = dim
        self.X = ca.SX.sym("X", dim)
        lo, hi = pts.min(axis=0), pts.max(axis=0)
        same = hi - lo <= 0
        if same.any():
            raise ValueError("입력 변수 값이 모두 같은 열이 있습니다 — 범위를 만들 수 없습니다")
        self.bounds = np.column_stack([lo, hi])
        self.label = ds["meta"].get("filename") or "내 데이터"
        self.formula = f"{names[-1]} = f({', '.join(names[:-1])})"
        self.params, self.func_key, self.smooth = {}, None, True
        self.col_names = names
        self.source = "data"
        self._set_surrogate(pts, vals, spec.get("surrogate") or {}, 0)

    def _set_surrogate(self, pts: np.ndarray, vals: np.ndarray, sopt: dict, seed: int):
        method = sopt.get("method", "rbf")
        s = surrogate.fit(pts, vals, self.bounds, method, float(sopt.get("smoothing", 0.0)), seed)
        self.data = {"points": pts, "values": vals}
        self.surrogate = s["info"]
        self.notes += s["info"]["notes"]
        values = s["grid"].ravel(order="F")       # CasADi wants the first axis fastest
        I = ca.interpolant("surrogate", s["kind"], s["axes"], values)
        lo, hi = self.bounds[:, 0], self.bounds[:, 1]
        Xc = ca.fmin(ca.fmax(self.X, ca.DM(lo)), ca.DM(hi))
        # Outside the box the surrogate is not defined: a quadratic wall on the
        # distance to the box keeps unbounded methods (BFGS, CG, …) from
        # sliding off to wherever the extrapolation goes.
        frange = float(np.ptp(s["grid"])) or 1.0
        w = 10.0 * frange / float(np.mean(hi - lo)) ** 2
        self.f_expr = I(Xc) + w * ca.sumsqr(self.X - Xc)
        self.smooth = method != "linear"
        if method == "linear":
            self.notes.append("선형 보간은 기울기가 조각마다 상수이고 헤시안이 0 입니다 — 뉴턴 계열은 잘 동작하지 않습니다.")

    # ── reference solution ─────────────────────────────────────────
    def _reference(self):
        fs = self.funs
        dim = self.dim
        axes, mesh = _mesh(self.bounds, REF_N[dim])
        fv = fs.map(fs.F, mesh).ravel()
        fv = np.where(np.isfinite(fv), fv, np.inf)
        finite = fv[np.isfinite(fv)]
        if finite.size == 0:
            raise ValueError("탐색 영역 전체에서 함수 값이 정의되지 않습니다")
        fmin, fmax = float(finite.min()), float(finite.max())
        self.f_stats = {"min": fmin, "max": fmax, "median": float(np.median(finite)),
                        "q95": float(np.percentile(finite, 95))}
        frange = max(self.f_stats["median"] - fmin, 1e-12)

        # local minima of the box-constrained landscape (constraints ignored)
        shape = [a.size for a in axes]
        F = fv.reshape(shape)
        cand = _grid_minima(F, 1e-9 * max(fmax - fmin, 1e-300))
        cand_x = np.stack([axes[i][cand[:, i]] for i in range(dim)], -1) if cand.size else np.zeros((0, dim))
        order = np.argsort(F[tuple(cand.T)]) if cand.size else np.zeros(0, int)
        cand_x = cand_x[order][:400]
        width = self.bounds[:, 1] - self.bounds[:, 0]
        minima = []
        for x in cand_x:
            xp, fp = self._polish(x, constrained=False)
            if any(np.max(np.abs(xp - m[0]) / width) < 1e-3 for m in minima):
                continue
            minima.append((xp, fp))
        minima.sort(key=lambda m: m[1])
        self.local_minima = minima[:MAX_LOCAL_MINIMA]
        self.n_local_minima = len(minima)

        # global minimum (with constraints)
        if fs.C is not None:
            cv = fs.map(fs.C, mesh).T.reshape(mesh.shape[0], -1)
            gi, he = cv[:, : fs.n_ineq], cv[:, fs.n_ineq:]
            viol = np.maximum(gi, 0).sum(axis=1) + np.abs(he).sum(axis=1)
            vscale = np.std(cv, axis=0).sum() or 1.0
            merit = (fv - fmin) / frange + 1e3 * viol / vscale
            seeds = mesh[np.argsort(merit)[:30]]
            self.feasible_frac = float(np.mean(viol <= 1e-12)) if fs.n_eq == 0 else None
        else:
            seeds = mesh[np.argsort(fv)[:10]]
            self.feasible_frac = None
        seeds = np.vstack([seeds, [m[0] for m in self.local_minima[:20]]]) if self.local_minima else seeds
        best = None
        for x in seeds:
            xp, fp = self._polish(x, constrained=True)
            if fs.violation(xp) > 1e-6:
                continue
            if best is None or fp < best[1] - 1e-12:
                best = (xp, fp)
        if best is None:
            raise ValueError("제약을 만족하는 점을 찾지 못했습니다 — 제약식이나 탐색 영역을 확인하세요")
        self.ref_x, self.ref_f = best
        # every minimiser within tolerance of the best one (Himmelblau has 4)
        tol = self.success_tol()
        glob = [best[0]]
        cands = [m for m in self.local_minima if fs.violation(m[0]) <= 1e-6] if fs.C is not None else self.local_minima
        for x, f in cands:
            if f <= self.ref_f + tol and all(np.max(np.abs(x - g) / width) > 1e-3 for g in glob):
                glob.append(x)
        self.ref_all = glob
        self.x0_default = self._default_x0()

    def _polish(self, x: np.ndarray, constrained: bool) -> tuple[np.ndarray, float]:
        fs = self.funs
        b = [tuple(r) for r in self.bounds]
        f0 = fs.f(x)
        try:
            if constrained and fs.C is not None:
                cons = _scipy_constraints(fs)
                r = minimize(fs.f, x, jac=fs.grad, bounds=b, constraints=cons, method="SLSQP",
                             options={"maxiter": 300, "ftol": 1e-12})
            else:
                r = minimize(fs.f, x, jac=fs.grad, bounds=b, method="L-BFGS-B",
                             options={"maxiter": 500, "ftol": 1e-15, "gtol": 1e-10})
            xp = np.clip(r.x, self.bounds[:, 0], self.bounds[:, 1])
            fp = fs.f(xp)
        except (ValueError, ArithmeticError):
            return x, f0
        if not math.isfinite(fp) or fp > f0:
            return x, f0
        return xp, fp

    def _default_x0(self) -> list[float]:
        frac = [0.85] if self.dim == 1 else [0.2, 0.5]
        x0 = self.bounds[:, 0] + np.array(frac) * (self.bounds[:, 1] - self.bounds[:, 0])
        return x0.tolist()

    def success_tol(self) -> float:
        """Absolute f tolerance for 'reached the global minimum'."""
        return 1e-4 * max(self.f_stats["median"] - self.f_stats["min"], 1e-12) + 1e-9

    # ── output ──────────────────────────────────────────────────────
    def nearest_global(self, x) -> float:
        x = np.asarray(x, float)
        width = self.bounds[:, 1] - self.bounds[:, 0]
        return float(min(np.linalg.norm((x - g) / width) for g in self.ref_all))

    def basin(self, x) -> int:
        """Index of the local minimum x is at (−1 if none within 1% of the box)."""
        x = np.asarray(x, float)
        width = self.bounds[:, 1] - self.bounds[:, 0]
        best, idx = 1e-2, -1
        for i, (m, _) in enumerate(self.local_minima):
            d = float(np.max(np.abs(x - m) / width))
            if d < best:
                best, idx = d, i
        return idx

    def landscape(self) -> dict:
        fs = self.funs
        axes, mesh = _mesh(self.bounds, PLOT_N[self.dim])
        fv = fs.map(fs.F, mesh).ravel()
        shape = [a.size for a in axes]
        out = {"axes": [a for a in axes]}
        # Plotly heatmaps index z[row=y][col=x]: transpose the 'ij' mesh
        def grid(v):
            return sig(v.reshape(shape).T if self.dim == 2 else v, 5)
        out["f"] = grid(fv)
        if fs.T is not None:
            out["f_true"] = grid(fs.map(fs.T, mesh).ravel())
        if fs.C is not None:
            cv = fs.map(fs.C, mesh).T.reshape(mesh.shape[0], -1)
            out["cons"] = [{"kind": c["kind"], "text": c["text"], "v": grid(cv[:, i])}
                           for i, c in enumerate(fs.cons)]
        return out

    def describe(self) -> dict:
        fs = self.funs
        d = {
            "dim": self.dim, "names": NAMES[: self.dim], "bounds": self.bounds,
            "source": self.source, "label": self.label, "formula": self.formula, "params": self.params,
            "func": self.func_key, "smooth": self.smooth,
            "constraints": [{"text": c["text"], "kind": c["kind"]} for c in fs.cons],
            "reference": {"x": self.ref_x, "f": self.ref_f, "all": self.ref_all,
                          "f_true": fs.true_f(self.ref_x)},
            "known": None, "local_minima": [{"x": m[0], "f": m[1]} for m in self.local_minima],
            "n_local_minima": self.n_local_minima,
            "f_stats": self.f_stats, "success_tol": self.success_tol(),
            "feasible_frac": self.feasible_frac, "x0_default": self.x0_default,
            "surrogate": self.surrogate, "notes": self.notes,
            "sampling": getattr(self, "sampling", None),
        }
        if self.known:
            xs, fstar = self.known
            d["known"] = {"xs": xs, "f": fstar}
        if self.true_expr is not None:
            T = fs.T
            # where the true function's own minimum is (for samples: what the data should reveal)
            _, mesh = _mesh(self.bounds, REF_N[self.dim] // 2)
            tv = fs.map(T, mesh).ravel()
            tv = np.where(np.isfinite(tv), tv, np.inf)
            i = int(np.argmin(tv))
            d["true_min"] = {"x": mesh[i], "f": float(tv[i])}
        if self.data is not None:
            pts, vals = self.data["points"], self.data["values"]
            idx = np.arange(pts.shape[0])
            if idx.size > 3000:
                idx = np.random.default_rng(0).choice(idx.size, 3000, replace=False)
            d["data"] = {"points": pts[idx], "values": vals[idx], "n": int(pts.shape[0])}
            if getattr(self, "col_names", None):
                d["col_names"] = self.col_names
        return d


def functions_domain(key: str, dim: int):
    if key == functions.CUSTOM_KEY:
        return [[-3, 3]] * dim
    return functions.get(key, dim)[4]


def _grid_minima(F: np.ndarray, eps: float) -> np.ndarray:
    """Indices of grid points strictly lower (by eps) than all their neighbours."""
    pad = np.pad(F, 1, constant_values=np.inf)
    nb_min = np.full(F.shape, np.inf)
    for off in np.ndindex(*([3] * F.ndim)):
        if all(o == 1 for o in off):
            continue
        sl = tuple(slice(o, o + s) for o, s in zip(off, F.shape))
        nb_min = np.minimum(nb_min, pad[sl])
    mask = np.isfinite(F) & (F < nb_min - eps)
    return np.argwhere(mask)


def _scipy_constraints(fs: FunSet) -> list[dict]:
    """SciPy dict constraints (its 'ineq' means fun(x) >= 0)."""
    out = []
    ni = fs.n_ineq
    for i in range(len(fs.cons)):
        if i < ni:
            out.append({"type": "ineq", "fun": (lambda x, i=i: -fs.c(x)[i]),
                        "jac": (lambda x, i=i: -fs.jc(x)[i])})
        else:
            out.append({"type": "eq", "fun": (lambda x, i=i: fs.c(x)[i]),
                        "jac": (lambda x, i=i: fs.jc(x)[i])})
    return out
