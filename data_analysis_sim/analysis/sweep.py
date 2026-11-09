"""Seed × N sweep: how fast (and whether) estimates converge to the truth.

Design: each seed s draws max(N) samples once with default_rng(base_seed + s);
sample size N uses the first N of them. So every seed traces one path of
estimates as N grows (nested samples), and paths of different seeds are
independent.

Error measure per statistic and N:
    RMSE over seeds        when the population value is finite
    IQR over seeds         when it is undefined or infinite (Cauchy mean, ...)
Convergence rate = slope of log(error) against log(N): −0.5 is the usual
1/√N rate, about 0 means the estimate does not settle down.
"""

from __future__ import annotations

import warnings

import numpy as np

from .risk import _es_sorted, _theory_es
from .synth import DISTRIBUTIONS, build, theory

MAX_N = 1_000_000
MAX_SEEDS = 100
MAX_WORK = 20_000_000  # seeds × max(N)

STATS = [
    ("mean", "평균"),
    ("std", "표준편차"),
    ("skew", "왜도 (G1)"),
    ("exkurt", "초과첨도 (G2)"),
    ("median", "중앙값"),
    ("var_l95", "왼쪽 VaR 95% (5% 분위수)"),
    ("cvar_l95", "왼쪽 CVaR 95%"),
    ("var_r95", "오른쪽 VaR 95% (95% 분위수)"),
    ("cvar_r95", "오른쪽 CVaR 95%"),
    ("ks", "KS 거리 sup|Fₙ − F|"),
]


def ks_distance(xs: np.ndarray, frozen, discrete: bool) -> float:
    """sup_x |Fₙ(x) − F(x)| for sorted data.

    Continuous: checked just before and at each order statistic. Discrete: ties
    make Fₙ jump by their count, so compare at each distinct value u and just
    below it (F(u⁻) = F(u − 1) on the integers).
    """
    n = xs.size
    if discrete:
        u, cnt = np.unique(xs, return_counts=True)
        fn = np.cumsum(cnt) / n
        fn_before = np.concatenate([[0.0], fn[:-1]])
        return float(max(np.max(np.abs(fn - frozen.cdf(u))), np.max(np.abs(fn_before - frozen.cdf(u - 1)))))
    cdf = np.asarray(frozen.cdf(xs), dtype=float)
    i = np.arange(1, n + 1)
    return float(max(np.max(i / n - cdf), np.max(cdf - (i - 1) / n)))


def _estimates(xs: np.ndarray, x: np.ndarray, frozen, discrete: bool) -> dict:
    """All statistics of one sample (xs = sorted copy of x)."""
    n = x.size
    mean = float(x.mean())
    d = x - mean
    m2, m3, m4 = float(np.mean(d * d)), float(np.mean(d**3)), float(np.mean(d**4))
    if m2 > 0 and n > 3:
        g1, g2 = m3 / m2**1.5, m4 / m2**2 - 3
        skew = g1 * np.sqrt(n * (n - 1)) / (n - 2)
        exkurt = ((n + 1) * g2 + 6) * (n - 1) / ((n - 2) * (n - 3))
    else:
        skew = exkurt = np.nan
    ks = ks_distance(xs, frozen, discrete)
    return {
        "mean": mean, "std": float(np.sqrt(m2 * n / (n - 1))), "skew": skew, "exkurt": exkurt,
        "median": float(np.quantile(xs, 0.5)),
        "var_l95": float(np.quantile(xs, 0.05)), "cvar_l95": _es_sorted(xs, 0.05),
        "var_r95": float(np.quantile(xs, 0.95)), "cvar_r95": -_es_sorted(-xs[::-1], 0.05),
        "ks": ks,
    }


def _truth(dist_key: str, frozen) -> dict:
    th = theory(frozen)
    disc = DISTRIBUTIONS[dist_key].discrete
    m = th["mean"]
    return {
        "mean": m, "std": th["std"], "skew": th["skew"], "exkurt": th["exkurt"], "median": th["median"],
        "var_l95": th["percentiles"]["5"], "var_r95": th["percentiles"]["95"],
        "cvar_l95": _theory_es(frozen, 0.05, "left", disc, m),
        "cvar_r95": _theory_es(frozen, 0.05, "right", disc, m),
        "ks": 0.0,
    }


def _slope(ns: np.ndarray, err: np.ndarray) -> float | None:
    ok = np.isfinite(err) & (err > 0)
    if ok.sum() < 3:
        return None
    return float(np.polyfit(np.log(ns[ok]), np.log(err[ok]), 1)[0])


def _verdict(slope: float | None, err: np.ndarray) -> str:
    if np.isfinite(err[-1]) and err[-1] == 0:
        return "오차 0 (모든 seed 가 참값과 정확히 일치)"
    if slope is None:
        return "판단 불가"
    if slope <= -0.4:
        return "1/√N 속도로 수렴"
    if slope <= -0.15:
        return "느리게 수렴 (두꺼운 꼬리)"
    return "수렴하지 않음"


def run(dist_key: str, params: dict, ns, seeds: int, base_seed: int) -> dict:
    ns = np.array(sorted({int(n) for n in ns}), dtype=np.int64)
    if ns.size < 2:
        raise ValueError("N 을 2개 이상 지정하세요")
    if ns[0] < 10 or ns[-1] > MAX_N:
        raise ValueError(f"N 은 10 ~ {MAX_N:,} 사이여야 합니다")
    seeds = int(seeds)
    if not 2 <= seeds <= MAX_SEEDS:
        raise ValueError(f"seed 개수는 2 ~ {MAX_SEEDS} 사이여야 합니다")
    if seeds * int(ns[-1]) > MAX_WORK:
        raise ValueError(f"seed 개수 × 최대 N 이 {MAX_WORK:,} 을 넘습니다 — 둘 중 하나를 줄이세요")
    base_seed = int(base_seed)
    if not 0 <= base_seed <= 2**32 - 1 - seeds:
        raise ValueError("시작 seed 가 범위를 벗어났습니다")

    clean, frozen = build(dist_key, params)
    disc = DISTRIBUTIONS[dist_key].discrete
    truth = _truth(dist_key, frozen)
    keys = [k for k, _ in STATS]
    est = {k: np.full((seeds, ns.size), np.nan) for k in keys}  # [seed, N]
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")  # overflow in x**4 for Cauchy etc. is part of the lesson
        for s in range(seeds):
            rng = np.random.default_rng(base_seed + s)
            full = np.asarray(frozen.rvs(size=int(ns[-1]), random_state=rng), dtype=float)
            for j, n in enumerate(ns):
                x = full[:n]
                e = _estimates(np.sort(x), x, frozen, disc)
                for k in keys:
                    est[k][s, j] = e[k]

    out_stats = []
    for k, label in STATS:
        a = est[k]
        t = truth[k]
        finite_truth = t is not None and np.isfinite(t)
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            q = np.nanpercentile(a, [5, 25, 50, 75, 95], axis=0)
            mean_est = np.nanmean(a, axis=0)
            spread = np.nanstd(a, axis=0, ddof=1)
            iqr = q[3] - q[1]
            rmse = np.sqrt(np.nanmean((a - t) ** 2, axis=0)) if finite_truth else np.full(ns.size, np.nan)
        err = rmse if finite_truth else iqr
        slope = _slope(ns.astype(float), err)
        out_stats.append({
            "key": k, "label": label, "truth": t, "truth_finite": bool(finite_truth),
            "error_kind": "rmse" if finite_truth else "iqr",
            "paths": a, "q05": q[0], "q25": q[1], "q50": q[2], "q75": q[3], "q95": q[4],
            "mean": mean_est, "bias": mean_est - t if finite_truth else np.full(ns.size, np.nan),
            "spread": spread, "iqr": iqr, "rmse": rmse, "error": err,
            "slope": slope, "verdict": _verdict(slope, err),
        })
    d = DISTRIBUTIONS[dist_key]
    return {"dist": dist_key, "dist_label": d.label, "params": clean, "note": d.note,
            "ns": ns, "seeds": seeds, "base_seed": base_seed, "stats": out_stats}
