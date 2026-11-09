"""Tail risk: VaR / CVaR (Expected Shortfall) on both tails, tail heaviness,
outliers and drawdown.

Definitions (tail probability α = 1 − confidence level c):
    VaR_left  = Q(α)       VaR_right = Q(1 − α)        Q = empirical quantile,
                                                       linear interpolation (as in the
                                                       percentile table)
    CVaR_left  = (1/α) ∫₀^α Q(u) du                    mean of the worst α share
    CVaR_right = (1/α) ∫_{1−α}^1 Q(u) du
The empirical CVaR uses the exact step-function integral: with sorted x and
k = ⌊nα⌋,  CVaR = (Σ_{i≤k} x₍ᵢ₎ + (nα − k)·x₍ₖ₊₁₎) / (nα).
Values are in data units (no sign flip): for returns the left tail is the loss
side, for loss amounts the right tail is.
"""

from __future__ import annotations

import warnings

import numpy as np
from scipy import integrate, stats

from .synth import NormalMixture
from .timeseries import envelope

LEVELS = (0.90, 0.95, 0.975, 0.99, 0.995)


# ── VaR / CVaR ─────────────────────────────────────────────────────
def _es_sorted(xs: np.ndarray, alpha: float) -> float:
    """Exact empirical lower-tail ES of ascending-sorted data."""
    n = xs.size
    na = n * alpha
    k = int(np.floor(na))
    if k >= n:
        return float(xs.mean())
    return float((xs[:k].sum() + (na - k) * xs[k]) / na)


def _theory_es(frozen, alpha: float, side: str, discrete: bool, mean: float) -> float:
    """Population CVaR; ±inf when that tail has no finite mean."""
    lo, hi = (frozen.support() if hasattr(frozen, "support") else (-np.inf, np.inf))
    if not np.isfinite(mean):
        if side == "left" and not np.isfinite(lo):
            return -np.inf
        if side == "right" and not np.isfinite(hi):
            return np.inf
    if isinstance(frozen, NormalMixture):
        if side == "left":
            q = float(frozen.ppf(alpha)[0])
            z = (q - frozen.mu) / frozen.s
            part = frozen.w * (frozen.mu * stats.norm.cdf(z) - frozen.s * stats.norm.pdf(z))
        else:
            q = float(frozen.ppf(1 - alpha)[0])
            z = (q - frozen.mu) / frozen.s
            part = frozen.w * (frozen.mu * stats.norm.sf(z) + frozen.s * stats.norm.pdf(z))
        return float(part.sum() / alpha)
    if discrete:
        # ES = (E[X·1{X<q}] + q·(α − P(X<q))) / α  (and the mirror for the right tail)
        if side == "left":
            q = float(frozen.ppf(alpha))
            ks = np.arange(lo, q)
            below = float(np.sum(ks * frozen.pmf(ks)))
            return (below + q * (alpha - float(frozen.cdf(q - 1)))) / alpha
        q = float(frozen.ppf(1 - alpha))
        ks = np.arange(lo, q + 1)
        upto = float(np.sum(ks * frozen.pmf(ks)))
        return (mean - upto + q * (float(frozen.cdf(q)) - (1 - alpha))) / alpha
    a, b = (0.0, alpha) if side == "left" else (1 - alpha, 1.0)
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        val, _ = integrate.quad(frozen.ppf, a, b, limit=200)
    return val / alpha


def var_cvar(xs: np.ndarray, levels=LEVELS, frozen=None, discrete=False, theory_mean=np.nan) -> list[dict]:
    out = []
    med = float(np.quantile(xs, 0.5))
    rev = -xs[::-1]  # ascending sort of −x: the right tail becomes a left tail
    for c in levels:
        a = 1.0 - c
        row = {"level": c, "alpha": a}
        for side in ("left", "right"):
            if side == "left":
                var = float(np.quantile(xs, a))
                es = _es_sorted(xs, a)
                n_tail = int(np.count_nonzero(xs <= var))
            else:
                var = float(np.quantile(xs, 1 - a))
                es = -_es_sorted(rev, a)
                n_tail = int(np.count_nonzero(xs >= var))
            d = {"var": var, "cvar": es, "n_tail": n_tail,
                 # (CVaR − median)/(VaR − median): 1.254 for a normal at 95 %
                 "shape": (es - med) / (var - med) if var != med else np.nan}
            if frozen is not None:
                tv = float(np.ravel(frozen.ppf(a if side == "left" else 1 - a))[0])
                te = _theory_es(frozen, a, side, discrete, theory_mean)
                d.update({"var_theory": tv, "cvar_theory": te})
            row[side] = d
        z = stats.norm.ppf(c)
        row["normal_shape"] = float(stats.norm.pdf(z) / (1 - c) / z)
        out.append(row)
    return out


# ── tail heaviness ─────────────────────────────────────────────────
def hill(xs: np.ndarray) -> dict:
    """Hill tail-index α on each tail, measured from the median.

    k = √n largest deviations (at least 10, at most n/10). Small α = heavy tail:
    α ≤ 2 infinite variance, α ≤ 4 infinite kurtosis. Light tails (normal,
    exponential) give large α that keeps growing with n.
    """
    n = xs.size
    k = int(min(max(10, np.sqrt(n)), n // 10))
    med = float(np.quantile(xs, 0.5))
    res = {"k": k}
    if k < 5:
        return {**res, "left": None, "right": None}
    for side, tail in (("right", xs[::-1][: k + 1] - med), ("left", med - xs[: k + 1])):
        thr = tail[k]
        if thr <= 0 or np.any(tail[:k] <= 0):
            res[side] = None
            continue
        gamma = float(np.mean(np.log(tail[:k] / thr)))
        res[side] = 1.0 / gamma if gamma > 0 else np.inf
    return res


def tail_ratios(xs: np.ndarray) -> dict:
    q = np.quantile(xs, [0.01, 0.05, 0.5, 0.95, 0.99])
    up95, dn95 = q[3] - q[2], q[2] - q[1]
    up99, dn99 = q[4] - q[2], q[2] - q[0]
    return {"ratio95": up95 / dn95 if dn95 > 0 else np.nan,
            "ratio99": up99 / dn99 if dn99 > 0 else np.nan}


# ── outliers ───────────────────────────────────────────────────────
def outliers(x: np.ndarray, s: dict, fs: float = 1.0, top: int = 10) -> dict:
    mean, std, med, mad = s["mean"], s["std"], s["median"], s["mad"]
    q1, q3, iqr = s["q1"], s["q3"], s["iqr"]
    rules = []

    def add(key, label, low_mask, high_mask, normal_frac, bounds):
        nl, nh = int(np.count_nonzero(low_mask)), int(np.count_nonzero(high_mask))
        rules.append({"key": key, "label": label, "low": nl, "high": nh,
                      "frac": (nl + nh) / x.size, "normal_frac": normal_frac, "bounds": bounds})

    for k, key in ((1.5, "iqr15"), (3.0, "iqr3")):
        lo, hi = q1 - k * iqr, q3 + k * iqr
        z = 0.6744897501960817 + k * 1.3489795003921634  # fence in σ for a normal
        add(key, f"IQR × {k:g} 울타리", x < lo, x > hi, 2 * stats.norm.sf(z), [lo, hi])
    if std > 0:
        lo, hi = mean - 3 * std, mean + 3 * std
        add("z3", "|z| > 3 (평균·표준편차)", x < lo, x > hi, 2 * stats.norm.sf(3), [lo, hi])
    if mad > 0:
        c = 3.5 / 0.6745 * mad
        add("mz35", "|수정 z| > 3.5 (중앙값·MAD)", x < med - c, x > med + c,
            2 * stats.norm.sf(3.5 / 0.6745 * 0.6744897501960817), [med - c, med + c])

    dev = np.abs(x - med) / (1.482602218505602 * mad if mad > 0 else (std or 1.0))
    idx = np.argpartition(dev, -min(top, x.size))[-min(top, x.size):]
    idx = idx[np.argsort(dev[idx])[::-1]]
    return {"rules": rules, "extremes": [
        {"index": int(i), "t": i / fs, "value": float(x[i]), "robust_z": float(np.sign(x[i] - med) * dev[i])}
        for i in idx]}


# ── drawdown ───────────────────────────────────────────────────────
def drawdown(y: np.ndarray, fs: float = 1.0) -> dict:
    """Largest peak-to-trough fall of a level series y."""
    peak = np.maximum.accumulate(y)
    dd = y - peak
    trough = int(np.argmin(dd))
    pk = int(np.argmax(y[: trough + 1]))
    mdd = float(dd[trough])
    rec = None
    if mdd < 0:
        after = np.nonzero(y[trough:] >= y[pk])[0]
        rec = int(trough + after[0]) if after.size else None
    rel = mdd / y[pk] if y[pk] > 0 and np.all(y > 0) else None
    return {
        "mdd": mdd, "mdd_rel": rel, "peak_i": pk, "trough_i": trough, "recovery_i": rec,
        "peak_t": pk / fs, "trough_t": trough / fs, "recovery_t": None if rec is None else rec / fs,
        "fall_time": (trough - pk) / fs,
        "underwater_time": None if rec is None else (rec - pk) / fs,
        "series": envelope(y, fs), "dd": envelope(dd, fs), "peak": envelope(peak, fs),
    }


def analyze(x: np.ndarray, s: dict, fs: float = 1.0, frozen=None, discrete=False, theory_mean=np.nan) -> dict:
    xs = np.sort(x)
    return {
        "levels": var_cvar(xs, LEVELS, frozen, discrete, theory_mean),
        "hill": hill(xs),
        "tail_ratio": tail_ratios(xs),
        "outliers": outliers(x, s, fs),
        "drawdown": {"level": drawdown(x, fs), "cumulative": drawdown(np.cumsum(x), fs)},
    }
