"""Sample-based optimisers: Gaussian-process Bayesian optimisation (own
implementation, so the surrogate and acquisition can be shown step by step),
Optuna TPE / GP samplers, and random search as the baseline.

All treat f as a black box (no gradients). Inequality constraints are known
formulas, so infeasible candidates are simply never proposed; equality
constraints cannot be hit by sampling and are ignored (with a note).
"""

from __future__ import annotations

import inspect
import warnings

import numpy as np
from scipy.optimize import minimize
from scipy.stats import norm, qmc

from .jsonsafe import sig
from .problem import sobol

SNAP_N = {1: 240, 2: 41}
MAX_SNAPS = 80


def _unit_design(dim: int, n: int, method: str, rng: np.random.Generator) -> np.ndarray:
    if method == "sobol":
        return sobol(dim, n, rng)
    if method == "lhs":
        return qmc.LatinHypercube(d=dim, rng=rng).random(n)
    return rng.random((n, dim))


def _feasible_design(prob, rec, dim, n, method, rng):
    """n design points in the box, preferring points that satisfy the known
    inequality constraints."""
    lo, width = prob.bounds[:, 0], prob.bounds[:, 1] - prob.bounds[:, 0]
    if rec.funs.n_ineq == 0:
        return lo + _unit_design(dim, n, method, rng) * width
    got = np.zeros((0, dim))
    for _ in range(20):
        x = lo + _unit_design(dim, max(4 * n, 64), method, rng) * width
        got = np.vstack([got, x[[rec.ineq_ok(xi) for xi in x]]])
        if got.shape[0] >= n:
            return got[:n]
    extra = lo + rng.random((n - got.shape[0], dim)) * width
    return np.vstack([got, extra])


def _acq(kind, mu, sd, best, xi, kappa):
    sd = np.maximum(sd, 1e-12)
    if kind == "lcb":
        return -(mu - kappa * sd)
    imp = best - mu - xi
    z = imp / sd
    if kind == "pi":
        return norm.cdf(z)
    return imp * norm.cdf(z) + sd * norm.pdf(z)


def run_gp(prob, rec, opts: dict, seed: int) -> dict:
    from sklearn.exceptions import ConvergenceWarning
    from sklearn.gaussian_process import GaussianProcessRegressor
    from sklearn.gaussian_process.kernels import RBF, ConstantKernel, Matern, WhiteKernel

    dim = prob.dim
    rng = np.random.default_rng(seed)
    lo, width = prob.bounds[:, 0], prob.bounds[:, 1] - prob.bounds[:, 0]
    n_init = int(opts.get("n_init", 6))
    n_iter = int(opts.get("n_iter", 25))
    kind = opts.get("acquisition", "ei")
    xi, kappa = float(opts.get("xi", 0.01)), float(opts.get("kappa", 2.0))
    kern = opts.get("kernel", "matern52")
    noise = opts.get("noise", "auto")
    if n_init < 2 or n_iter < 0:
        raise ValueError("초기 점은 2개 이상, 추가 평가는 0 이상이어야 합니다")

    X = _feasible_design(prob, rec, dim, n_init, opts.get("init", "lhs"), rng)
    y = np.array([rec.f(x) for x in X])

    # snapshot grid (unit coords) for the step-by-step viewer
    axes = [np.linspace(0, 1, SNAP_N[dim])] * dim
    sgrid = np.stack(np.meshgrid(*axes, indexing="ij"), -1).reshape(-1, dim)
    sfeas = np.array([rec.ineq_ok(lo + u * width) for u in sgrid]) if rec.funs.n_ineq else None
    every = max(1, int(np.ceil(n_iter / MAX_SNAPS)))
    snaps = []

    # candidate pool for maximising the acquisition
    if dim == 1:
        pool = np.linspace(0, 1, 2001)[:, None]
    else:
        pool = sobol(2, 4096, rng)
    pool_ok = np.array([rec.ineq_ok(lo + u * width) for u in pool]) if rec.funs.n_ineq else None

    base = {"matern52": Matern([0.2] * dim, (1e-3, 10.0), nu=2.5),
            "matern32": Matern([0.2] * dim, (1e-3, 10.0), nu=1.5),
            "rbf": RBF([0.2] * dim, (1e-3, 10.0))}[kern]
    kernel = ConstantKernel(1.0, (1e-3, 1e3)) * base
    if noise == "auto":
        kernel = kernel + WhiteKernel(1e-4, (1e-10, 1e-1))
    gp_last = None

    for it in range(n_iter + 1):
        U = (X - lo) / width
        good = np.isfinite(y)
        ym, ys = float(np.mean(y[good])), float(np.std(y[good])) or 1.0
        z = (y[good] - ym) / ys
        gp = GaussianProcessRegressor(kernel, alpha=1e-8 if noise == "auto" else 1e-6,
                                      normalize_y=False, n_restarts_optimizer=2,
                                      random_state=int(rng.integers(2 ** 31)))
        with warnings.catch_warnings():
            warnings.simplefilter("ignore", ConvergenceWarning)
            gp.fit(U[good], z)
        gp_last = gp
        best = float(np.min(z))
        if it == n_iter:
            nxt = None
        else:
            mu, sd = gp.predict(pool, return_std=True)
            a = _acq(kind, mu, sd, best, xi, kappa)
            if pool_ok is not None:
                a = np.where(pool_ok, a, -np.inf)
            cand = pool[np.argsort(-a)[:5]]
            best_u, best_a = cand[0], a[np.argsort(-a)[0]]
            for c in cand:  # polish the best pool points
                def neg(u):
                    m, s = gp.predict(u[None, :], return_std=True)
                    if pool_ok is not None and not rec.ineq_ok(lo + u * width):
                        return 1e30
                    return -float(_acq(kind, m, s, best, xi, kappa)[0])
                r = minimize(neg, c, method="L-BFGS-B", bounds=[(0, 1)] * dim, options={"maxiter": 40})
                if -r.fun > best_a:
                    best_u, best_a = r.x, -r.fun
            # never re-sample an existing point (singular GP); fall back to a random one
            if np.min(np.max(np.abs(U - best_u), axis=1)) < 1e-7:
                best_u = rng.random(dim)
            nxt = best_u
        if it % every == 0 or it == n_iter:
            mu, sd = gp.predict(sgrid, return_std=True)
            a = _acq(kind, mu, sd, best, xi, kappa)
            if sfeas is not None:
                a = np.where(sfeas, a, np.nan)
            snaps.append({
                "iter": it, "n_obs": int(X.shape[0]),
                "mu": mu * ys + ym, "sd": sd * ys,
                "acq": a, "next": None if nxt is None else (lo + nxt * width),
            })
        if nxt is None:
            break
        xn = lo + nxt * width
        X = np.vstack([X, xn])
        y = np.append(y, rec.f(xn))

    k = gp_last.kernel_
    ls = k.k1.k2.length_scale if noise != "auto" else k.k1.k2.length_scale
    info = {"length_scale": (np.atleast_1d(ls) * width).tolist()}
    if noise == "auto":
        info["noise_std"] = float(np.sqrt(k.k2.noise_level) * (np.std(y[np.isfinite(y)]) or 1.0))
    s_axes = [lo[i] + axes[i] * width[i] for i in range(dim)]
    for s in snaps:  # Plotly heatmap orientation: z[row=y][col=x]
        for key in ("mu", "sd", "acq"):
            v = s[key]
            s[key] = sig(v.reshape([SNAP_N[dim]] * dim).T if dim == 2 else v, 4)
    return {"nit": n_iter, "bo": {"axes": s_axes, "snaps": snaps, "n_init": n_init, "info": info,
                                  "acquisition": kind}}


def run_optuna(prob, rec, opts: dict, seed: int, sampler_kind: str) -> dict:
    import optuna
    optuna.logging.set_verbosity(optuna.logging.WARNING)
    warnings.filterwarnings("ignore", category=optuna.exceptions.ExperimentalWarning)
    n_trials = int(opts.get("n_trials", 60 if sampler_kind == "tpe" else 30))
    n_startup = int(opts.get("n_startup", 10))
    names = ["x", "y"][: prob.dim]
    ni = rec.funs.n_ineq

    def constraints(trial):
        return trial.user_attrs["c"]

    kw = {"seed": seed, "n_startup_trials": n_startup}
    if sampler_kind == "tpe":
        cls = optuna.samplers.TPESampler
        kw["multivariate"] = bool(opts.get("multivariate", True))
    else:
        cls = optuna.samplers.GPSampler
    if ni and "constraints_func" in inspect.signature(cls).parameters:
        kw["constraints_func"] = constraints
    sampler = cls(**kw)
    study = optuna.create_study(sampler=sampler, direction="minimize")

    def objective(trial):
        x = np.array([trial.suggest_float(n, lo, hi) for n, (lo, hi) in zip(names, prob.bounds)])
        v = rec.f(x)
        if ni:
            trial.set_user_attr("c", rec.funs.c(x)[:ni].tolist())
        return v if np.isfinite(v) else 1e300

    study.optimize(objective, n_trials=n_trials, catch=())
    return {"nit": n_trials}


def run_random(prob, rec, opts: dict, seed: int) -> dict:
    n = int(opts.get("n_samples", 100))
    rng = np.random.default_rng(seed)
    X = _feasible_design(prob, rec, prob.dim, n, opts.get("design", "random"), rng)
    for x in X:
        rec.f(x)
    return {"nit": n}
