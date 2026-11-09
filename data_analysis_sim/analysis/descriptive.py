"""Descriptive statistics: location, spread, moments, quantiles.

Conventions (match scipy / pandas so results can be cross-checked):
    var, std        unbiased (ddof = 1)
    skew_g1         m3 / m2^1.5                    (scipy.stats.skew, bias=True)
    skew            adjusted Fisher-Pearson G1     (bias=False, = pandas/Excel)
    exkurt_g2       m4 / m2² − 3                   (scipy.stats.kurtosis, bias=True)
    exkurt          bias-corrected G2              (bias=False, = pandas/Excel)
    percentiles     linear interpolation           (numpy default, "type 7")
"""

from __future__ import annotations

import numpy as np
from scipy import stats

from .synth import PERCENTILES


def is_integer_valued(x: np.ndarray) -> bool:
    return bool(np.all(np.isfinite(x)) and np.all(x == np.round(x)))


def summary(x: np.ndarray) -> dict:
    x = np.asarray(x, dtype=float)
    n = x.size
    nan = float("nan")
    mean = float(np.mean(x))
    d = x - mean
    m2 = float(np.mean(d**2))
    m3 = float(np.mean(d**3))
    m4 = float(np.mean(d**4))
    var = m2 * n / (n - 1) if n > 1 else nan
    std = float(np.sqrt(var)) if n > 1 else nan

    if m2 > 0:
        g1 = m3 / m2**1.5
        g2 = m4 / m2**2 - 3.0
        G1 = g1 * np.sqrt(n * (n - 1)) / (n - 2) if n > 2 else nan
        G2 = ((n + 1) * g2 + 6) * (n - 1) / ((n - 2) * (n - 3)) if n > 3 else nan
    else:  # constant data: shape is undefined
        g1 = g2 = G1 = G2 = nan
    se_skew = np.sqrt(6.0 * n * (n - 1) / ((n - 2) * (n + 1) * (n + 3))) if n > 2 else nan
    se_kurt = 2 * se_skew * np.sqrt((n**2 - 1) / ((n - 3) * (n + 5))) if n > 3 else nan

    pct = np.percentile(x, PERCENTILES)
    p = dict(zip(PERCENTILES, (float(v) for v in pct)))
    med = p[50]
    mad = float(np.median(np.abs(x - med)))
    sem = std / np.sqrt(n) if n > 1 else nan
    tcrit = float(stats.t.ppf(0.975, n - 1)) if n > 1 else nan

    out = {
        "n": n,
        # location
        "mean": mean, "median": med,
        "trim_mean_10": float(stats.trim_mean(x, 0.1)),
        "geo_mean": float(stats.gmean(x)) if np.all(x > 0) else None,
        "harm_mean": float(stats.hmean(x)) if np.all(x > 0) else None,
        "sem": sem, "ci95_low": mean - tcrit * sem, "ci95_high": mean + tcrit * sem,
        # spread
        "var": var, "std": std, "var_pop": m2,
        "min": float(np.min(x)), "max": float(np.max(x)),
        "range": float(np.ptp(x)),
        "q1": p[25], "q3": p[75], "iqr": p[75] - p[25],
        "mad": mad, "mad_sigma": 1.482602218505602 * mad,  # = σ for normal data
        "mean_abs_dev": float(np.mean(np.abs(d))),
        "cv": std / abs(mean) if mean != 0 else nan,
        # shape
        "skew": G1, "skew_g1": g1, "se_skew": se_skew,
        "exkurt": G2, "exkurt_g2": g2, "se_kurt": se_kurt,
        # moments
        "raw_moments": [float(np.mean(x**k)) for k in (1, 2, 3, 4)],
        "central_moments": [0.0, m2, m3, m4],
        "percentiles": {str(k): v for k, v in p.items()},
        "integer_valued": is_integer_valued(x),
        "n_unique": int(np.unique(x).size) if n <= 2_000_000 else None,
    }
    return out
