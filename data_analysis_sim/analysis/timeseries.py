"""Time-domain analysis of the samples taken in their given order.

    envelope      min/max downsampling for plots (keeps spikes visible)
    rolling       trailing moving mean / std
    trend         least-squares line through (t, x)
    segments      mean, std, skewness, kurtosis of K equal consecutive blocks
    correlation   ACF (Bartlett band), PACF, Ljung–Box
    runs_test     Wald–Wolfowitz runs above/below the median
    stationarity  ADF (H0: unit root) and KPSS (H0: stationary)
    dfa           detrended fluctuation analysis → scaling exponent α and Hurst H
"""

from __future__ import annotations

import warnings

import numpy as np
from scipy import stats

DISPLAY_POINTS = 4000
STATIONARITY_MAX = 100_000  # ADF/KPSS regressions use at most this many leading samples
DFA_MAX = 1_000_000


def envelope(x: np.ndarray, fs: float = 1.0, max_points: int = DISPLAY_POINTS) -> dict:
    """Downsample for plotting without hiding spikes: min and max of each bucket.

    Returns at most `max_points` (t, value) pairs; short series pass through.
    """
    n = x.size
    if n <= max_points:
        t = np.arange(n) / fs
        return {"t": t, "y": x, "decimated": False}
    buckets = max_points // 2
    edges = np.linspace(0, n, buckets + 1).astype(np.int64)
    starts = edges[:-1]
    i_min = np.array([s + int(np.argmin(x[s:e])) for s, e in zip(starts, edges[1:])])
    i_max = np.array([s + int(np.argmax(x[s:e])) for s, e in zip(starts, edges[1:])])
    idx = np.sort(np.concatenate([i_min, i_max]))  # keep time order
    return {"t": idx / fs, "y": x[idx], "decimated": True}


def _thin(t: np.ndarray, *ys: np.ndarray, max_points: int = DISPLAY_POINTS):
    """Even stride for smooth curves (rolling stats) where min/max is not needed."""
    step = max(1, int(np.ceil(t.size / max_points)))
    return (t[::step], *(y[::step] for y in ys))


def rolling(x: np.ndarray, window: int, fs: float) -> dict:
    """Trailing moving mean and std (ddof=1) over `window` samples, O(n)."""
    n = x.size
    w = int(window)
    if not 2 <= w <= n:
        raise ValueError(f"이동 창은 2 ~ N({n:,}) 사이여야 합니다")
    d = x - x.mean()  # centre first: cumulative sums of squares lose precision otherwise
    c1 = np.concatenate([[0.0], np.cumsum(d)])
    c2 = np.concatenate([[0.0], np.cumsum(d * d)])
    s1 = c1[w:] - c1[:-w]
    s2 = c2[w:] - c2[:-w]
    mean = s1 / w + x.mean()
    var = np.maximum((s2 - s1 * s1 / w) / (w - 1), 0.0)
    t = np.arange(w - 1, n) / fs
    t, mean, std = _thin(t, mean, np.sqrt(var))
    return {"window": w, "t": t, "mean": mean, "std": std}


def trend(x: np.ndarray, fs: float) -> dict:
    t = np.arange(x.size) / fs
    r = stats.linregress(t, x)
    return {
        "slope": r.slope, "intercept": r.intercept, "r2": r.rvalue**2, "p": r.pvalue, "stderr": r.stderr,
        "change": r.slope * (t[-1] - t[0]),  # fitted rise over the whole record
        "line": {"t": [t[0], t[-1]], "y": [r.intercept + r.slope * t[0], r.intercept + r.slope * t[-1]]},
    }


def segments(x: np.ndarray, k: int, fs: float) -> dict:
    n = x.size
    k = int(np.clip(k, 2, max(2, n // 10)))
    edges = np.linspace(0, n, k + 1).astype(np.int64)
    rows = []
    for a, b in zip(edges[:-1], edges[1:]):
        seg = x[a:b]
        rows.append({
            "t0": a / fs, "t1": b / fs, "tm": (a + b) / 2 / fs, "n": int(b - a),
            "mean": float(seg.mean()), "std": float(seg.std(ddof=1)) if seg.size > 1 else np.nan,
            "skew": float(stats.skew(seg, bias=False)) if seg.size > 2 and np.ptp(seg) > 0 else np.nan,
            "exkurt": float(stats.kurtosis(seg, bias=False)) if seg.size > 3 and np.ptp(seg) > 0 else np.nan,
        })
    means = np.array([r["mean"] for r in rows])
    stds = np.array([r["std"] for r in rows])
    groups = [x[a:b] for a, b in zip(edges[:-1], edges[1:])]
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        anova = stats.f_oneway(*groups) if n >= 2 * k else None   # are the block means equal?
        levene = stats.levene(*groups, center="median") if n >= 2 * k else None  # equal spreads?
    return {
        "k": k, "rows": rows,
        "mean_spread": float(np.ptp(means)), "std_ratio": float(np.nanmax(stds) / np.nanmin(stds)) if np.nanmin(stds) > 0 else np.nan,
        "anova_p": float(anova.pvalue) if anova is not None else None,
        "levene_p": float(levene.pvalue) if levene is not None else None,
    }


def durbin_levinson(rho: np.ndarray) -> np.ndarray:
    """PACF from autocorrelations ρ₀..ρₘ (Yule–Walker, O(m²))."""
    m = rho.size - 1
    out = np.zeros(m + 1)
    out[0] = 1.0
    if m == 0:
        return out
    phi = np.array([rho[1]])
    out[1] = rho[1]
    v = 1 - rho[1] ** 2
    for k in range(2, m + 1):
        if v <= 0:
            break
        a = (rho[k] - phi @ rho[k - 1:0:-1]) / v
        phi = np.concatenate([phi - a * phi[::-1], [a]])
        v *= 1 - a * a
        out[k] = a
    return out


def correlation(x: np.ndarray, nlags: int) -> dict:
    """ACF by FFT with Bartlett band, PACF by Durbin–Levinson, Ljung–Box Q.

    statsmodels' acorr_ljungbox recomputes the ACF without FFT (minutes at 1e6
    samples), so Q = n(n+2) Σ ρ_k²/(n−k) is evaluated from the FFT ACF here.
    """
    from statsmodels.tsa.stattools import acf

    n = x.size
    nlags = int(np.clip(nlags, 1, max(1, min(n // 2 - 1, 500))))
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        a, conf = acf(x, nlags=nlags, fft=True, alpha=0.05)  # Bartlett band
    p = durbin_levinson(a)
    lb_lags = sorted({lg for lg in (1, 5, 10, 20, 40) if lg <= nlags} | {nlags})
    k = np.arange(1, nlags + 1)
    q = n * (n + 2) * np.cumsum(a[1:] ** 2 / (n - k))
    band = conf[:, 1] - a  # half-width per lag
    white = 1.96 / np.sqrt(n)
    first_cross = next((j for j in range(1, nlags + 1) if abs(a[j]) < white), None)
    return {
        "lags": np.arange(nlags + 1), "acf": a, "acf_band": band, "pacf": p, "white_band": white,
        "decorrelation_lag": first_cross,  # first lag inside the white-noise band
        "ljung_box": [{"lag": int(lg), "stat": float(q[lg - 1]), "p": float(stats.chi2.sf(q[lg - 1], lg))}
                      for lg in lb_lags],
    }


def runs_test(x: np.ndarray) -> dict:
    """Wald–Wolfowitz: too few runs above/below the median = clustering (trend,
    positive correlation), too many = alternation (negative correlation)."""
    med = np.median(x)
    s = x[x != med] > med
    n1, n2 = int(s.sum()), int((~s).sum())
    n = n1 + n2
    if n1 == 0 or n2 == 0:
        return {"runs": None, "expected": None, "z": np.nan, "p": np.nan}
    runs = int(1 + np.count_nonzero(s[1:] != s[:-1]))
    mu = 2.0 * n1 * n2 / n + 1
    var = 2.0 * n1 * n2 * (2.0 * n1 * n2 - n) / (n**2 * (n - 1))
    z = (runs - mu) / np.sqrt(var) if var > 0 else np.nan
    return {"runs": runs, "expected": mu, "z": z, "p": float(2 * stats.norm.sf(abs(z)))}


def stationarity(x: np.ndarray) -> dict:
    from statsmodels.tsa.stattools import adfuller, kpss

    used = x[:STATIONARITY_MAX]
    note = f"N 이 커서 앞 {STATIONARITY_MAX:,}개 구간으로 검정" if x.size > STATIONARITY_MAX else ""
    out = {"n_used": int(used.size), "note": note}
    if np.ptp(used) == 0 or used.size < 20:
        return {**out, "adf": None, "kpss": None}
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")  # KPSS warns when p is outside its table (0.01 ~ 0.1)
        stat, p, lag, nobs, crit, _ = adfuller(used, autolag="AIC", maxlag=min(30, used.size // 4))
        out["adf"] = {"stat": stat, "p": p, "lag": int(lag), "crit5": crit["5%"]}
        k_stat, k_p, k_lag, k_crit = kpss(used, regression="c", nlags="auto")
        out["kpss"] = {"stat": k_stat, "p": k_p, "lag": int(k_lag), "crit5": k_crit["5%"]}
    return out


def dfa(x: np.ndarray) -> dict:
    """Detrended fluctuation analysis (DFA-1).

    F(s) ∝ s^α over window sizes s. α ≈ 0.5 uncorrelated noise, 0.5 < α < 1
    long-range persistence, α ≈ 1 1/f noise, α ≈ 1.5 random walk (Brownian).
    Hurst exponent: H = α for stationary noise, H = α − 1 for a walk (α > 1).
    """
    used = x[:DFA_MAX]
    n = used.size
    if n < 100 or np.ptp(used) == 0:
        return {"alpha": None, "hurst": None, "scales": [], "fluct": [], "note": ""}
    y = np.cumsum(used - used.mean())
    scales = np.unique(np.logspace(np.log10(10), np.log10(n // 4), 20).astype(np.int64))
    F = []
    for s in scales:
        m = n // s
        w = y[: m * s].reshape(m, s)
        t = np.arange(s) - (s - 1) / 2
        slope = (w @ t) / (t @ t)
        resid = w - w.mean(axis=1, keepdims=True) - slope[:, None] * t
        F.append(np.sqrt(np.mean(resid**2)))
    F = np.array(F)
    alpha, logc = np.polyfit(np.log(scales), np.log(F), 1)
    hurst = alpha if alpha <= 1 else alpha - 1
    return {
        "alpha": float(alpha), "hurst": float(hurst), "scales": scales, "fluct": F,
        "fit": np.exp(logc) * scales.astype(float) ** alpha,
        "note": f"앞 {DFA_MAX:,}개로 계산" if x.size > DFA_MAX else "",
    }


def analyze(x: np.ndarray, fs: float, window: int, nlags: int, k: int) -> dict:
    return {
        "fs": fs, "series": envelope(x, fs),
        "rolling": rolling(x, window, fs), "trend": trend(x, fs), "segments": segments(x, k, fs),
        "correlation": correlation(x, nlags), "runs": runs_test(x),
        "stationarity": stationarity(x), "dfa": dfa(x),
    }
