"""Check the optimisation engine against known answers.

Run:  python optimization_sim/tests/test_optim.py      (no pytest needed)
"""

from __future__ import annotations

import sys
import threading
from pathlib import Path

import casadi as ca
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from optim import algorithms, batch, expr  # noqa: E402
from optim.problem import Problem  # noqa: E402

FAILS: list[str] = []


def check(name, ok, detail=""):
    print(f"  {'ok ' if ok else 'FAIL'} {name}{f': {detail}' if detail else ''}")
    if not ok:
        FAILS.append(name)


def close(name, got, want, atol=1e-5):
    got, want = np.asarray(got, float), np.asarray(want, float)
    check(name, got.shape == want.shape and np.allclose(got, want, atol=atol), f"{np.round(got, 6)} vs {want}")


def fn(func, dim=2, **kw):
    return Problem({"source": "function", "dim": dim, "func": func, **kw}, {})


def test_expr():
    print("expression parser")
    X = ca.SX.sym("X", 2)
    f, smooth = expr.objective("x^2 + 3*sin(y) - abs(x)", X)
    F = ca.Function("f", [X], [f])
    close("value", float(F([1.5, 0.3])), 1.5 ** 2 + 3 * np.sin(0.3) - 1.5)
    check("abs marks non-smooth", not smooth)
    c = expr.constraint("x + y >= 1", X)
    check("'>=' becomes g <= 0", c["kind"] == "ineq" and float(ca.Function("g", [X], [c["expr"]])([0.2, 0.3])) == 0.5)
    check("'=' is equality", expr.constraint("x = y", X)["kind"] == "eq")
    for bad in ["__import__('os')", "x.real", "open('a')", "[1, 2]", "lambda: 1", "z + 1"]:
        try:
            expr.objective(bad, X)
            check(f"rejects {bad!r}", False)
        except ValueError:
            check(f"rejects {bad!r}", True)


def test_reference():
    print("reference global minimum (grid + polish) vs literature")
    p = fn("rosenbrock")
    close("Rosenbrock", p.ref_x, [1, 1])
    p = fn("himmelblau")
    check("Himmelblau has 4 global minima", len(p.ref_all) == 4 and p.n_local_minima == 4)
    p = fn("branin")
    check("Branin has 3 global minima", len(p.ref_all) == 3, f"f*={p.ref_f:.6f}")
    close("Branin f*", p.ref_f, 0.397887)
    p = fn("six_hump")
    close("six-hump camel f*", p.ref_f, -1.031628)
    check("six-hump camel: 6 local minima", p.n_local_minima == 6, str(p.n_local_minima))
    p = fn("eggholder")
    close("Eggholder (minimum on the boundary)", p.ref_x, [512, 404.231805], atol=1e-4)
    p = fn("forrester", dim=1)
    close("Forrester 1-D", [p.ref_x[0], p.ref_f], [0.757249, -6.020740])
    p = fn("rastrigin")
    check("Rastrigin: ~100 local minima", 90 <= p.n_local_minima <= 130, str(p.n_local_minima))
    # constrained: Rosenbrock in the unit disk (a classic: (0.7864, 0.6177), f = 0.045675)
    p = fn("rosenbrock", constraints=["x^2 + y^2 <= 1"])
    close("Rosenbrock in the unit disk", [*p.ref_x, p.ref_f], [0.786415, 0.617698, 0.045675])
    # equality: projection of (1, −0.5) onto x + y = 1 is (1.25, −0.25)
    p = fn("custom", expr="(x-1)^2 + (y+0.5)^2", constraints=["x + y = 1"])
    close("equality-constrained projection", p.ref_x, [1.25, -0.25])


def test_surrogate():
    print("data -> surrogate")
    spec = {"source": "function", "dim": 2, "func": "branin", "objective": "samples",
            "sampling": {"n": 60, "method": "lhs", "seed": 3}}
    # The fitted model is resampled on a 121×121 grid and B-spline / bilinearly
    # interpolated, so even an interpolating model is only close at the data.
    for method, rel in [("rbf", 1e-3), ("gp", 1e-3), ("cubic", 3e-2), ("linear", 3e-2)]:
        p = Problem({**spec, "surrogate": {"method": method}}, {})
        pts, vals = p.data["points"], p.data["values"]
        err = max(abs(p.funs.f(x) - v) for x, v in zip(pts, vals)) / np.ptp(vals)
        check(f"{method}: surrogate passes near the data", err < rel, f"max |f̂ − f| / range = {err:.2g}")
    # with noise the GP should estimate roughly the noise level that was added
    p = Problem({**spec, "sampling": {"n": 300, "method": "lhs", "seed": 3, "noise_pct": 3}, "surrogate": {"method": "gp"}}, {})
    est, true = p.surrogate["noise_std"], p.sampling["noise_sigma"]
    check("GP noise estimate", 0.5 < est / true < 1.6, f"{est:.3g} vs {true:.3g}")
    # upload path: x, y, f columns
    ds = {"d": {"columns": {"a": pts[:, 0], "b": pts[:, 1], "c": vals}, "meta": {"filename": "t"}}}
    p = Problem({"source": "data", "dim": 2, "dataset_id": "d", "x_col": "a", "y_col": "b", "f_col": "c"}, ds)
    close("uploaded data -> bounding box", p.bounds, np.c_[pts.min(0), pts.max(0)])


def test_algorithms():
    print("every algorithm on a convex problem (Booth, minimum (1, 3))")
    p = fn("booth")
    loose = {"bo_gp": 5.0, "optuna_tpe": 10.0, "optuna_gp": 5.0, "random": 50.0, "direct": 1e-3,
             "COBYLA": 1e-4, "dual_annealing": 1e-6}
    for a in algorithms.ALGOS:
        if a["key"] == "optuna_gp":  # slow (PyTorch); covered by the API smoke run
            continue
        r = algorithms.run(p, a["key"], {}, [-5, 5])
        tol = loose.get(a["key"], 1e-6)
        check(f"{a['key']}", r["gap"] <= tol, f"gap {r['gap']:.2e}, nfev {r['nfev']}")
    print("evaluation accounting")
    exact = algorithms.run(p, "BFGS", {"jac_mode": "exact"}, [-5, 5])
    fd = algorithms.run(p, "BFGS", {"jac_mode": "2-point"}, [-5, 5])
    check("finite differences cost f evaluations", fd["nfev"] >= exact["nfev"] + 2 * exact["njev"] - 2 and fd["njev"] == 0,
          f"exact nfev {exact['nfev']}+njev {exact['njev']} vs FD nfev {fd['nfev']}")
    r = algorithms.run(p, "Nelder-Mead", {"maxiter": 5}, [-5, 5])
    check("iteration limit respected", r["nit"] <= 5 and not r["success"])
    c = fn("rosenbrock", constraints=["x^2 + y^2 <= 1"])
    for k in ["SLSQP", "trust-constr", "COBYQA", "ipopt", "sqpmethod", "differential_evolution"]:
        r = algorithms.run(c, k, {}, [-1.2, 1])
        check(f"{k} respects the disk constraint", r["violation"] < 1e-6 and r["gap"] < 1e-5,
              f"gap {r['gap']:.1e}, viol {r['violation']:.1e}")
    r = algorithms.run(c, "BFGS", {}, [-1.2, 1])
    check("BFGS ignores constraints and says so", r["violation"] > 0.5 and any("제약" in n for n in r["notes"]))
    r = algorithms.run(fn("forrester", dim=1), "bo_gp", {"n_iter": 15, "seed": 1})
    check("BO finds the Forrester minimum", r["gap"] < 0.05, f"gap {r['gap']:.3g}")
    check("BO snapshots", len(r["extra"]["bo"]["snaps"]) == 16)


def test_batch():
    print("multi-start")
    p = fn("himmelblau")
    stop = threading.Event()
    res = batch.multistart(p, [{"algo": "BFGS"}, {"algo": "differential_evolution"}], 16, 0, stop, lambda *a: None)
    bfgs = res["algos"][0]["runs"]
    check("BFGS from 16 starts reaches all 4 basins", len({r["basin"] for r in bfgs}) == 4)
    check("same starts for every x0 method", np.allclose([r["x0"] for r in bfgs], res["starts"]))
    stop.set()
    try:
        batch.multistart(p, [{"algo": "BFGS"}], 4, 0, stop, lambda *a: None)
        check("cancel", False)
    except algorithms.Aborted:
        check("cancel stops the job", True)


if __name__ == "__main__":
    test_expr()
    test_reference()
    test_surrogate()
    test_algorithms()
    test_batch()
    print("\nALL PASSED" if not FAILS else f"\nFAILED: {FAILS}")
    sys.exit(1 if FAILS else 0)
