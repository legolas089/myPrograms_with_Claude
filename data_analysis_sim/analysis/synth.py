"""Seeded synthetic data: a marginal distribution plus optional time structure.

The same (distribution, parameters, n, seed, time options) always yields the
same array, because every draw goes through one `np.random.default_rng(seed)`.

Time structure (applied in this order, all optional):
    AR(1)        y_t = φ·y_{t-1} + √(1-φ²)·e_t on the centred samples, so the
                 stationary variance equals the base distribution's variance
                 (the marginal *shape* drifts toward normal as |φ| grows)
    random walk  cumulative sum
    trend        + slope · t
    sines        + Σ A·sin(2π f t + phase)

With any of these active the data no longer follow the base distribution, so
no theoretical values are attached.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
from scipy import optimize, signal, stats

MAX_N = 5_000_000
PERCENTILES = (1, 5, 10, 25, 50, 75, 90, 95, 99)


# ── parameter specs ────────────────────────────────────────────────
@dataclass
class Param:
    key: str
    label: str
    default: float
    kind: str = "real"  # real | positive | prob | int_pos | unit_open
    step: float = 0.1


@dataclass
class Dist:
    label: str
    params: list[Param]
    build: object  # callable(params dict) -> frozen distribution
    note: str = ""
    discrete: bool = False
    tags: list[str] = field(default_factory=list)


def _uniform(p):
    if p["b"] <= p["a"]:
        raise ValueError("Uniform: b 는 a 보다 커야 합니다")
    return stats.uniform(loc=p["a"], scale=p["b"] - p["a"])


class NormalMixture:
    """Two-component Gaussian mixture with the frozen-scipy methods we use."""

    def __init__(self, w1, mu1, s1, mu2, s2):
        self.w = np.array([w1, 1.0 - w1])
        self.mu = np.array([mu1, mu2], dtype=float)
        self.s = np.array([s1, s2], dtype=float)

    def rvs(self, size, random_state):
        rng = random_state
        comp = rng.random(size) >= self.w[0]  # False -> component 1
        return np.where(comp, rng.normal(self.mu[1], self.s[1], size),
                        rng.normal(self.mu[0], self.s[0], size))

    def pdf(self, x):
        x = np.asarray(x, dtype=float)
        return sum(w * stats.norm.pdf(x, m, s) for w, m, s in zip(self.w, self.mu, self.s))

    def cdf(self, x):
        x = np.asarray(x, dtype=float)
        return sum(w * stats.norm.cdf(x, m, s) for w, m, s in zip(self.w, self.mu, self.s))

    def ppf(self, q):
        lo = float(np.min(self.mu - 40 * self.s))
        hi = float(np.max(self.mu + 40 * self.s))
        q = np.atleast_1d(np.asarray(q, dtype=float))
        out = [optimize.brentq(lambda x, qq=qq: float(self.cdf(x)) - qq, lo, hi, xtol=1e-12) for qq in q]
        return np.array(out)

    def median(self):
        return float(self.ppf(0.5)[0])

    def stats(self, moments="mvsk"):
        m, s, w = self.mu, self.s, self.w
        # raw moments of each normal component, mixed by weight
        r1 = np.sum(w * m)
        r2 = np.sum(w * (m**2 + s**2))
        r3 = np.sum(w * (m**3 + 3 * m * s**2))
        r4 = np.sum(w * (m**4 + 6 * m**2 * s**2 + 3 * s**4))
        var = r2 - r1**2
        c3 = r3 - 3 * r1 * r2 + 2 * r1**3
        c4 = r4 - 4 * r1 * r3 + 6 * r1**2 * r2 - 3 * r1**4
        return r1, var, c3 / var**1.5, c4 / var**2 - 3.0


DISTRIBUTIONS: dict[str, Dist] = {
    "normal": Dist("정규 Normal", [
        Param("mu", "μ 평균", 0.0), Param("sigma", "σ 표준편차", 1.0, "positive")],
        lambda p: stats.norm(p["mu"], p["sigma"])),
    "uniform": Dist("균등 Uniform", [
        Param("a", "a 하한", 0.0), Param("b", "b 상한", 1.0)],
        _uniform),
    "exponential": Dist("지수 Exponential", [
        Param("lam", "λ 비율(rate)", 1.0, "positive")],
        lambda p: stats.expon(scale=1.0 / p["lam"])),
    "lognormal": Dist("로그정규 Log-normal", [
        Param("mu", "μ (log 평균)", 0.0), Param("sigma", "σ (log 표준편차)", 0.5, "positive", 0.05)],
        lambda p: stats.lognorm(s=p["sigma"], scale=np.exp(p["mu"]))),
    "gamma": Dist("감마 Gamma", [
        Param("k", "k 형상(shape)", 2.0, "positive"), Param("theta", "θ 척도(scale)", 1.0, "positive")],
        lambda p: stats.gamma(a=p["k"], scale=p["theta"])),
    "beta": Dist("베타 Beta", [
        Param("alpha", "α", 2.0, "positive"), Param("beta", "β", 5.0, "positive")],
        lambda p: stats.beta(p["alpha"], p["beta"])),
    "weibull": Dist("와이블 Weibull", [
        Param("k", "k 형상(shape)", 1.5, "positive"), Param("lam", "λ 척도(scale)", 1.0, "positive")],
        lambda p: stats.weibull_min(c=p["k"], scale=p["lam"])),
    "student_t": Dist("스튜던트 t", [
        Param("nu", "ν 자유도", 5.0, "positive", 0.5), Param("mu", "μ 위치", 0.0),
        Param("sigma", "σ 척도", 1.0, "positive")],
        lambda p: stats.t(p["nu"], p["mu"], p["sigma"]),
        note="ν ≤ 2 이면 분산, ν ≤ 4 이면 첨도가 무한대"),
    "laplace": Dist("라플라스 Laplace", [
        Param("mu", "μ 위치", 0.0), Param("b", "b 척도", 1.0, "positive")],
        lambda p: stats.laplace(p["mu"], p["b"])),
    "cauchy": Dist("코시 Cauchy", [
        Param("x0", "x₀ 위치", 0.0), Param("gamma", "γ 척도", 1.0, "positive")],
        lambda p: stats.cauchy(p["x0"], p["gamma"]),
        note="평균·분산이 정의되지 않음 — 표본 평균이 N 을 늘려도 수렴하지 않는다"),
    "pareto": Dist("파레토 Pareto", [
        Param("alpha", "α 형상(꼬리지수)", 3.0, "positive"), Param("xm", "xₘ 최솟값(scale)", 1.0, "positive")],
        lambda p: stats.pareto(b=p["alpha"], scale=p["xm"]),
        note="α ≤ 2 이면 분산 무한, α ≤ 4 이면 첨도 무한"),
    "gumbel": Dist("검벨 Gumbel (극값)", [
        Param("mu", "μ 위치", 0.0), Param("beta", "β 척도", 1.0, "positive")],
        lambda p: stats.gumbel_r(p["mu"], p["beta"])),
    "mixture": Dist("정규 혼합 (봉우리 2개)", [
        Param("w1", "w₁ 성분1 비중", 0.5, "unit_open", 0.05),
        Param("mu1", "μ₁", -2.0), Param("s1", "σ₁", 1.0, "positive"),
        Param("mu2", "μ₂", 2.0), Param("s2", "σ₂", 1.0, "positive")],
        lambda p: NormalMixture(p["w1"], p["mu1"], p["s1"], p["mu2"], p["s2"])),
    "poisson": Dist("포아송 Poisson (이산)", [
        Param("lam", "λ 평균 발생 수", 4.0, "positive")],
        lambda p: stats.poisson(p["lam"]), discrete=True),
    "binomial": Dist("이항 Binomial (이산)", [
        Param("trials", "n 시행 횟수", 20, "int_pos", 1), Param("p", "p 성공 확률", 0.3, "prob", 0.05)],
        lambda p: stats.binom(int(p["trials"]), p["p"]), discrete=True),
}


def catalog() -> list[dict]:
    """Distribution list for the UI form."""
    return [{
        "key": k, "label": d.label, "note": d.note, "discrete": d.discrete,
        "params": [{"key": p.key, "label": p.label, "default": p.default,
                    "kind": p.kind, "step": p.step} for p in d.params],
    } for k, d in DISTRIBUTIONS.items()]


def _check(p: Param, v) -> float:
    try:
        v = float(v)
    except (TypeError, ValueError):
        raise ValueError(f"{p.label}: 숫자가 아닙니다") from None
    if not np.isfinite(v):
        raise ValueError(f"{p.label}: 유한한 값이어야 합니다")
    if p.kind == "positive" and v <= 0:
        raise ValueError(f"{p.label}: 0 보다 커야 합니다")
    if p.kind == "prob" and not 0 <= v <= 1:
        raise ValueError(f"{p.label}: 0 ~ 1 사이여야 합니다")
    if p.kind == "unit_open" and not 0 < v < 1:
        raise ValueError(f"{p.label}: 0 과 1 사이(양 끝 제외)여야 합니다")
    if p.kind == "int_pos" and (v < 1 or v != int(v)):
        raise ValueError(f"{p.label}: 1 이상의 정수여야 합니다")
    return v


def build(dist_key: str, params: dict):
    """Validated parameters and the frozen distribution."""
    if dist_key not in DISTRIBUTIONS:
        raise ValueError(f"알 수 없는 분포: {dist_key}")
    d = DISTRIBUTIONS[dist_key]
    clean = {p.key: _check(p, params.get(p.key, p.default)) for p in d.params}
    return clean, d.build(clean)


def theory(frozen) -> dict:
    """Closed-form (or numerically exact) population values."""
    m, v, s, k = (float(x) for x in frozen.stats(moments="mvsk"))
    qs = np.asarray(frozen.ppf(np.array(PERCENTILES) / 100.0), dtype=float).ravel()
    pct = dict(zip(PERCENTILES, qs))
    return {
        "mean": m, "var": v, "std": float(np.sqrt(v)) if v >= 0 else float("nan"),
        "skew": s, "exkurt": k, "median": float(frozen.median()),
        "q1": pct[25], "q3": pct[75], "iqr": pct[75] - pct[25],
        "percentiles": {str(p): q for p, q in pct.items()},
    }


def _ts_active(ts: dict) -> bool:
    return bool(ts.get("ar_phi") or ts.get("random_walk") or ts.get("trend")
                or any(s.get("amp") for s in ts.get("sines", [])))


def generate(dist_key: str, params: dict, n: int, seed: int, ts: dict | None = None) -> tuple[np.ndarray, dict]:
    ts = ts or {}
    n = int(n)
    if not 2 <= n <= MAX_N:
        raise ValueError(f"샘플 수는 2 ~ {MAX_N:,} 사이여야 합니다")
    seed = int(seed)
    if not 0 <= seed < 2**32:
        raise ValueError("seed 는 0 ~ 4294967295 사이 정수여야 합니다")
    clean, frozen = build(dist_key, params)
    rng = np.random.default_rng(seed)
    x = np.asarray(frozen.rvs(size=n, random_state=rng), dtype=float)
    th = theory(frozen)

    fs = float(ts.get("fs") or 1.0)
    if fs <= 0:
        raise ValueError("샘플링 주파수 fs 는 0 보다 커야 합니다")
    phi = float(ts.get("ar_phi") or 0.0)
    if not -0.999 <= phi <= 0.999:
        raise ValueError("AR(1) φ 는 -0.999 ~ 0.999 사이여야 합니다")
    if phi:
        centre = th["mean"] if np.isfinite(th["mean"]) else th["median"]
        e = x - centre
        y = np.empty_like(e)
        y[0] = e[0]  # start in the stationary state
        if n > 1:
            y[1:], _ = signal.lfilter([np.sqrt(1 - phi**2)], [1.0, -phi], e[1:], zi=[phi * e[0]])
        x = y + centre
    if ts.get("random_walk"):
        x = np.cumsum(x)
    t = np.arange(n) / fs
    if ts.get("trend"):
        x = x + float(ts["trend"]) * t
    sines = []
    for s in ts.get("sines", []):
        amp, freq = float(s.get("amp") or 0), float(s.get("freq") or 0)
        if not amp:
            continue
        if freq < 0:
            raise ValueError("사인 주파수는 0 이상이어야 합니다")
        phase = np.deg2rad(float(s.get("phase") or 0))
        x = x + amp * np.sin(2 * np.pi * freq * t + phase)
        sines.append({"freq": freq, "amp": amp, "phase": float(s.get("phase") or 0)})

    active = _ts_active(ts)
    d = DISTRIBUTIONS[dist_key]
    meta = {
        "source": "synthetic", "dist": dist_key, "dist_label": d.label, "params": clean,
        "n": n, "seed": seed, "fs": fs, "discrete": d.discrete and not active,
        "ts": {"ar_phi": phi, "random_walk": bool(ts.get("random_walk")),
               "trend": float(ts.get("trend") or 0), "sines": sines},
        "ts_active": active,
        "theory": None if active else th,
        "note": d.note,
    }
    return x, meta


def true_density(dist_key: str, params: dict, x: np.ndarray) -> np.ndarray:
    """pdf (continuous) or pmf (discrete) on the given points."""
    _, frozen = build(dist_key, params)
    if DISTRIBUTIONS[dist_key].discrete:
        return frozen.pmf(x)
    return frozen.pdf(x)
