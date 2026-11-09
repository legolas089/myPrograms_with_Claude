"""Normality tests (H0: the data come from a normal distribution).

With very large N every test rejects even tiny, practically irrelevant
departures — read the effect sizes (skewness, kurtosis, Q-Q plot) too.
"""

from __future__ import annotations

import warnings

import numpy as np
from scipy import stats
from statsmodels.stats.diagnostic import lilliefors

SW_MAX = 5000  # Shapiro-Wilk p-values are only accurate up to about this N


def anderson_normal(x: np.ndarray) -> tuple[float, float]:
    """A² from scipy (log-cdf based, finite even for far outliers) and the
    Stephens (1986) p-value for estimated mean and variance.

    statsmodels' normal_ad returns A² = ∞ once a point's normal cdf rounds to 1,
    and scipy's own p-value is interpolated and clipped to [0.01, 0.15].
    """
    n = x.size
    a2 = float(stats.anderson(x, dist="norm", method="interpolate").statistic)
    a = a2 * (1 + 0.75 / n + 2.25 / n**2)
    if a >= 10:  # the quadratic fit turns upward beyond its range; p is ~1e-24 here
        p = 0.0
    elif a >= 0.6:
        p = np.exp(1.2937 - 5.709 * a + 0.0186 * a**2)
    elif a > 0.34:
        p = np.exp(0.9177 - 4.279 * a - 1.38 * a**2)
    elif a > 0.2:
        p = 1 - np.exp(-8.318 + 42.796 * a - 59.938 * a**2)
    else:
        p = 1 - np.exp(-13.436 + 101.14 * a - 223.73 * a**2)
    return a2, float(p)


def tests(x: np.ndarray, alpha: float = 0.05) -> dict:
    n = x.size
    out = []

    def add(key, name, stat, p, note=""):
        out.append({"key": key, "name": name, "stat": float(stat), "p": float(p),
                    "reject": bool(p < alpha), "note": note})

    if np.ptp(x) == 0:
        return {"alpha": alpha, "tests": [], "note": "모든 값이 같아 검정할 수 없습니다."}
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        if n >= 3:
            sub = x
            note = "순서통계량 기반 — 작은·중간 N 에서 검정력이 가장 높음"
            if n > SW_MAX:
                sub = np.random.default_rng(0).choice(x, SW_MAX, replace=False)
                note = f"N > {SW_MAX:,} 이라 무작위 {SW_MAX:,}개로 검정"
            r = stats.shapiro(sub)
            add("shapiro", "Shapiro–Wilk", r.statistic, r.pvalue, note)
        if n >= 8:
            r = stats.normaltest(x)
            add("dagostino", "D'Agostino K²", r.statistic, r.pvalue, "왜도 + 첨도 검정 결합 (N ≥ 20 권장)")
        r = stats.jarque_bera(x)
        add("jb", "Jarque–Bera", r.statistic, r.pvalue, "왜도·첨도 기반, 큰 N 에서 정확 (점근 χ²₂)")
        if n >= 5:
            d, p = lilliefors(x, dist="norm", pvalmethod="table")
            add("lilliefors", "Kolmogorov–Smirnov (Lilliefors)", d, p, "평균·분산을 추정한 KS 보정판, 분포 가운데에 민감 (p 는 0.001~0.2 로 잘린 표 근사)")
            a2, p = anderson_normal(x)
            add("ad", "Anderson–Darling", a2, p, "꼬리에 가중치를 둔 EDF 검정")
        if n >= 8:
            r = stats.skewtest(x)
            add("skew", "왜도 검정", r.statistic, r.pvalue, "H0: 왜도 = 0")
        if n >= 20:
            r = stats.kurtosistest(x)
            add("kurt", "첨도 검정", r.statistic, r.pvalue, "H0: 초과첨도 = 0")
    note = ""
    if n > 20_000:
        note = f"N = {n:,} 처럼 크면 아주 작은 차이도 유의하게 나옵니다 — Q-Q 그림과 왜도·첨도 크기를 함께 보세요."
    elif n < 30:
        note = "N 이 작아 검정력이 낮습니다 — 기각하지 못해도 정규라는 뜻은 아닙니다."
    return {"alpha": alpha, "tests": out, "note": note}
