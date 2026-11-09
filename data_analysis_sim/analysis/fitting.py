"""Distribution fitting (MLE) ranked by AIC / BIC, plus Q-Q and ECDF data.

Families follow the parametrisations of the synthetic-data generator, so a
fitted "gamma k=2.01, θ=0.99" can be read against the true "k=2, θ=1".
Positive-support families are fitted with location fixed at 0 (2-parameter
forms); they are skipped when the data contain values ≤ 0.

Fitting uses at most FIT_SAMPLE points (random subsample, fixed seed) for speed;
log-likelihood, AIC and BIC are then evaluated on the full data.
"""

from __future__ import annotations

import warnings
from dataclasses import dataclass

import numpy as np
from scipy import stats

FIT_SAMPLE = 50_000
QQ_POINTS = 400
CURVE_POINTS = 400


@dataclass
class Family:
    key: str
    label: str
    dist: object
    fit_kw: dict
    params: object       # frozen -> [(label, value)]
    support: str = "real"  # real | positive | nonneg | unit | integer
    synth_key: str = ""
    fitter: object = None  # optional fast MLE: x -> params tuple


def _fit_t(x: np.ndarray) -> tuple:
    """Student-t MLE in (log ν, μ, log σ); scipy's generic t.fit takes ~6 s on 1e5 points."""
    from scipy.optimize import minimize
    med = float(np.median(x))
    mad = float(np.median(np.abs(x - med))) * 1.482602218505602 or float(np.std(x)) or 1.0
    k = float(stats.kurtosis(x))
    nu0 = 4 + 6 / k if k > 0.05 else 30.0

    def nll(p):
        nu = np.exp(p[0])
        return -np.sum(stats.t.logpdf(x, nu, p[1], np.exp(p[2])))
    res = minimize(nll, [np.log(nu0), med, np.log(mad)], method="L-BFGS-B",
                   bounds=[(np.log(0.2), np.log(1e4)), (None, None), (None, None)])
    return float(np.exp(res.x[0])), float(res.x[1]), float(np.exp(res.x[2]))


CONTINUOUS = [
    Family("norm", "정규", stats.norm, {}, lambda f: [("μ", f.args[0]), ("σ", f.args[1])], synth_key="normal"),
    Family("t", "스튜던트 t", stats.t, {},
           lambda f: [("ν", f.args[0]), ("μ", f.args[1]), ("σ", f.args[2])], synth_key="student_t",
           fitter=_fit_t),
    Family("laplace", "라플라스", stats.laplace, {}, lambda f: [("μ", f.args[0]), ("b", f.args[1])], synth_key="laplace"),
    Family("logistic", "로지스틱", stats.logistic, {}, lambda f: [("μ", f.args[0]), ("s", f.args[1])]),
    Family("cauchy", "코시", stats.cauchy, {}, lambda f: [("x₀", f.args[0]), ("γ", f.args[1])], synth_key="cauchy"),
    Family("gumbel_r", "검벨", stats.gumbel_r, {}, lambda f: [("μ", f.args[0]), ("β", f.args[1])], synth_key="gumbel"),
    Family("uniform", "균등", stats.uniform, {},
           lambda f: [("a", f.args[0]), ("b", f.args[0] + f.args[1])], synth_key="uniform"),
    Family("expon", "지수", stats.expon, {"floc": 0},
           lambda f: [("λ", 1 / f.args[1])], "nonneg", "exponential"),
    Family("lognorm", "로그정규", stats.lognorm, {"floc": 0},
           lambda f: [("μ", np.log(f.args[2])), ("σ", f.args[0])], "positive", "lognormal"),
    Family("gamma", "감마", stats.gamma, {"floc": 0},
           lambda f: [("k", f.args[0]), ("θ", f.args[2])], "positive", "gamma"),
    Family("weibull_min", "와이블", stats.weibull_min, {"floc": 0},
           lambda f: [("k", f.args[0]), ("λ", f.args[2])], "positive", "weibull"),
    Family("pareto", "파레토", stats.pareto, {"floc": 0},
           lambda f: [("α", f.args[0]), ("xₘ", f.args[2])], "positive", "pareto"),
    Family("beta", "베타", stats.beta, {"floc": 0, "fscale": 1},
           lambda f: [("α", f.args[0]), ("β", f.args[1])], "unit", "beta"),
]

SYNTH_TO_FAMILY = {f.synth_key: f.key for f in CONTINUOUS if f.synth_key}
SYNTH_TO_FAMILY.update({"poisson": "poisson", "binomial": "binom"})


def _fit_discrete(x: np.ndarray) -> list[dict]:
    """Poisson / geometric / negative-binomial / binomial by MLE (closed form or 1-D)."""
    m, v, n = float(np.mean(x)), float(np.var(x)), x.size
    out = []
    out.append(("poisson", "포아송", stats.poisson(m), [("λ", m)], 1))
    if m > 0:
        p = 1 / (1 + m)  # geometric on {0,1,2,…}: scipy geom is on {1,2,…} → shift loc=-1
        out.append(("geom", "기하 (0부터)", stats.geom(p, loc=-1), [("p", p)], 1))
    if v > m > 0:  # overdispersed: negative binomial, MLE of r by 1-D search
        def nll(log_r):
            r = np.exp(log_r)
            return -np.sum(stats.nbinom.logpmf(x, r, r / (r + m)))
        from scipy.optimize import minimize_scalar
        r0 = m * m / (v - m)
        res = minimize_scalar(nll, bracket=(np.log(r0) - 1, np.log(r0) + 1))
        r = float(np.exp(res.x))
        out.append(("nbinom", "음이항", stats.nbinom(r, r / (r + m)), [("r", r), ("p", r / (r + m))], 2))
    if 0 < v < m:  # underdispersed: binomial with N ≥ max, p = mean/N, best N by likelihood
        top = int(np.max(x))
        best = None
        for N in range(max(top, 1), max(top, 1) + 200):
            ll = float(np.sum(stats.binom.logpmf(x, N, m / N)))
            if best is None or ll > best[0]:
                best = (ll, N)
            elif ll < best[0] - 5:
                break
        N = best[1]
        out.append(("binom", "이항", stats.binom(N, m / N), [("n", N), ("p", m / N)], 2))
    rows = []
    for key, label, fz, params, k in out:
        ll = float(np.sum(fz.logpmf(x)))
        rows.append({"key": key, "label": label, "frozen": fz, "params": params, "k": k, "loglik": ll,
                     "aic": 2 * k - 2 * ll, "bic": k * np.log(n) - 2 * ll, "ks": None})
    return rows


def fit_all(x: np.ndarray, discrete: bool) -> tuple[list[dict], list[str]]:
    notes = []
    n = x.size
    if discrete and np.all(x >= 0) and np.all(x == np.round(x)):
        rows = _fit_discrete(x)
    else:
        if discrete:
            notes.append("음수가 있어 이산 분포 대신 연속 분포로 적합했습니다.")
        rng = np.random.default_rng(0)
        sub = x if n <= FIT_SAMPLE else rng.choice(x, FIT_SAMPLE, replace=False)
        if n > FIT_SAMPLE:
            notes.append(f"파라미터는 무작위 {FIT_SAMPLE:,}개로 추정, logL·AIC·BIC 는 전체 {n:,}개로 계산했습니다.")
        mn, mx = float(np.min(x)), float(np.max(x))
        rows = []
        skipped = []
        for fam in CONTINUOUS:
            if (fam.support == "positive" and mn <= 0) or (fam.support == "nonneg" and mn < 0) \
                    or (fam.support == "unit" and (mn <= 0 or mx >= 1)):
                skipped.append(fam.label)
                continue
            try:
                with warnings.catch_warnings():
                    warnings.simplefilter("ignore")
                    params = fam.fitter(sub) if fam.fitter else fam.dist.fit(sub, **fam.fit_kw)
                    fz = fam.dist(*params)
                    ll = float(np.sum(fz.logpdf(x)))
            except Exception:  # noqa: BLE001 - one failing family must not sink the rest
                skipped.append(fam.label)
                continue
            if not np.isfinite(ll):
                skipped.append(fam.label)
                continue
            k = len(params) - len(fam.fit_kw)
            ks = stats.kstest(sub, fz.cdf)
            rows.append({"key": fam.key, "label": fam.label, "frozen": fz, "params": fam.params(fz), "k": k,
                         "loglik": ll, "aic": 2 * k - 2 * ll, "bic": k * np.log(n) - 2 * ll,
                         "ks": {"stat": float(ks.statistic), "p": float(ks.pvalue)}})
        if skipped:
            notes.append("지원 범위가 맞지 않거나 적합에 실패해 제외: " + ", ".join(skipped))
    rows.sort(key=lambda r: r["aic"])
    best = rows[0]["aic"] if rows else 0
    w = np.exp(-0.5 * (np.array([r["aic"] for r in rows]) - best))
    for r, wi in zip(rows, w / w.sum() if rows else []):
        r["daic"] = r["aic"] - best
        r["weight"] = float(wi)
    return rows, notes


def curves(rows: list[dict], lo: float, hi: float, discrete: bool) -> dict:
    if discrete:
        xs = np.arange(np.floor(lo), np.ceil(hi) + 1)
        return {"x": xs, "pdf": {r["key"]: r["frozen"].pmf(xs) for r in rows},
                "cdf": {r["key"]: r["frozen"].cdf(xs) for r in rows}}
    xs = np.linspace(lo, hi, CURVE_POINTS)
    return {"x": xs, "pdf": {r["key"]: r["frozen"].pdf(xs) for r in rows},
            "cdf": {r["key"]: r["frozen"].cdf(xs) for r in rows}}


def qq(xs_sorted: np.ndarray, rows: list[dict]) -> dict:
    """Sample vs theoretical quantiles at QQ_POINTS plotting positions."""
    n = xs_sorted.size
    m = min(QQ_POINTS, n)
    # dense in the tails, where Q-Q plots are read: uniform in normal-score space
    z = np.linspace(stats.norm.ppf(0.5 / n), stats.norm.ppf(1 - 0.5 / n), m)
    p = stats.norm.cdf(z)
    sample = np.quantile(xs_sorted, p)
    return {"p": p, "sample": sample,
            "theory": {r["key"]: r["frozen"].ppf(p) for r in rows}}


def ecdf(xs_sorted: np.ndarray, points: int = 600) -> dict:
    n = xs_sorted.size
    if n <= points:
        return {"x": xs_sorted, "y": np.arange(1, n + 1) / n}
    idx = np.unique(np.linspace(0, n - 1, points).astype(np.int64))
    return {"x": xs_sorted[idx], "y": (idx + 1) / n}


def public(rows: list[dict]) -> list[dict]:
    return [{k: v for k, v in r.items() if k != "frozen"} for r in rows]
