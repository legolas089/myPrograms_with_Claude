"""Cross-check the analysis engine against SciPy / pandas reference values.

Run:  python data_analysis_sim/tests/test_analysis.py      (no pytest needed)
"""

from __future__ import annotations

import sys
import time
from pathlib import Path

import numpy as np
import pandas as pd
from scipy import stats

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from analysis import (  # noqa: E402
    density, descriptive, fitting, loaders, normality, risk, spectral, synth, timeseries,
)

FAILS: list[str] = []


def close(name, got, want, rtol=1e-9, atol=1e-12):
    ok = np.allclose(got, want, rtol=rtol, atol=atol, equal_nan=True)
    print(f"  {'ok ' if ok else 'FAIL'} {name}: {np.ravel(got)[:4]} vs {np.ravel(want)[:4]}")
    if not ok:
        FAILS.append(name)


def test_descriptive():
    print("descriptive vs scipy/pandas")
    x = stats.gamma(2.0).rvs(size=5000, random_state=np.random.default_rng(7))
    s = descriptive.summary(x)
    ser = pd.Series(x)
    close("mean", s["mean"], np.mean(x))
    close("var ddof1", s["var"], np.var(x, ddof=1))
    close("skew bias=False", s["skew"], stats.skew(x, bias=False))
    close("skew bias=True", s["skew_g1"], stats.skew(x, bias=True))
    close("exkurt bias=False", s["exkurt"], stats.kurtosis(x, bias=False))
    close("exkurt bias=True", s["exkurt_g2"], stats.kurtosis(x, bias=True))
    close("pandas skew", s["skew"], ser.skew())
    close("pandas kurt", s["exkurt"], ser.kurt())
    close("central m3", s["central_moments"][2], stats.moment(x, 3))
    close("central m4", s["central_moments"][3], stats.moment(x, 4))
    close("sem", s["sem"], stats.sem(x))
    lo, hi = stats.t.interval(0.95, x.size - 1, loc=np.mean(x), scale=stats.sem(x))
    close("ci95", [s["ci95_low"], s["ci95_high"]], [lo, hi])
    close("mad", s["mad"], stats.median_abs_deviation(x))
    close("iqr", s["iqr"], stats.iqr(x))
    close("gmean", s["geo_mean"], stats.gmean(x))
    # standard errors of skew / kurtosis (Excel / SPSS formula), checked at n = 50
    n = 50
    se_s = np.sqrt(6 * n * (n - 1) / ((n - 2) * (n + 1) * (n + 3)))
    s50 = descriptive.summary(x[:n])
    close("se_skew n=50", s50["se_skew"], se_s)
    close("se_kurt n=50", s50["se_kurt"], 2 * se_s * np.sqrt((n**2 - 1) / ((n - 3) * (n + 5))))
    c = descriptive.summary(np.full(10, 3.0))
    close("constant data skew is NaN", c["skew"], np.nan)


def test_kde():
    print("binned KDE vs scipy.stats.gaussian_kde (exact)")
    rng = np.random.default_rng(3)
    x = np.concatenate([rng.normal(-2, 1, 3000), rng.normal(2.5, 0.6, 2000)])
    h = density.bandwidth(x, "silverman")
    k = density.kde(x, x.min() - 3 * h, x.max() + 3 * h, h)
    ref = stats.gaussian_kde(x, bw_method=h / np.std(x, ddof=1))(k["x"])
    err = np.max(np.abs(k["y"] - ref)) / ref.max()
    print(f"  max error / peak = {err:.2e}")
    if err > 1e-3:
        FAILS.append("kde accuracy")
    close("kde integrates to 1", k["mass_in_view"], 1.0, rtol=1e-3)
    print(f"  peaks found: {k['n_peaks']} at {[round(p['x'], 2) for p in k['peaks']]}")
    if k["n_peaks"] != 2:
        FAILS.append("bimodal peak count")
    big = rng.standard_normal(5_000_000)
    t = time.perf_counter()
    hb = density.bandwidth(big, "silverman")
    density.kde(big, big.min(), big.max(), hb)
    print(f"  5,000,000 samples: {(time.perf_counter() - t) * 1000:.0f} ms")


def test_synth():
    print("synthetic data")
    a, _ = synth.generate("lognormal", {"mu": 0, "sigma": 0.5}, 1000, 42)
    b, _ = synth.generate("lognormal", {"mu": 0, "sigma": 0.5}, 1000, 42)
    c, _ = synth.generate("lognormal", {"mu": 0, "sigma": 0.5}, 1000, 43)
    print(f"  {'ok ' if np.array_equal(a, b) else 'FAIL'} same seed -> same data")
    print(f"  {'ok ' if not np.array_equal(a, c) else 'FAIL'} other seed -> other data")
    if not np.array_equal(a, b) or np.array_equal(a, c):
        FAILS.append("seed reproducibility")
    for key in synth.DISTRIBUTIONS:
        x, meta = synth.generate(key, {}, 200_000, 1)
        th, s = meta["theory"], descriptive.summary(x)
        fin = np.isfinite(th["var"]) and th["var"] > 0
        err = abs(s["mean"] - th["mean"]) / np.sqrt(th["var"] / x.size) if fin else float("nan")
        flag = "ok " if (not fin or err < 5) else "FAIL"
        print(f"  {flag} {key:12s} mean {s['mean']:+.4f} vs theory {th['mean']:+.4f}"
              f"  ({err:.1f} SE)  skew {s['skew']:+.3f} vs {th['skew']:+.3f}")
        if flag == "FAIL":
            FAILS.append(f"{key} mean")
    mix = synth.NormalMixture(0.3, -1, 0.5, 2, 1.5)
    y = mix.rvs(2_000_000, np.random.default_rng(0))
    close("mixture var", mix.stats()[1], np.var(y), rtol=5e-3)
    close("mixture skew", mix.stats()[2], stats.skew(y), rtol=2e-2, atol=5e-3)
    close("mixture kurt", mix.stats()[3], stats.kurtosis(y), rtol=3e-2, atol=1e-2)
    close("mixture median", mix.median(), np.median(y), atol=5e-3)
    x, meta = synth.generate("normal", {"mu": 0, "sigma": 2}, 400_000, 5, {"ar_phi": 0.8})
    close("AR(1) keeps variance", np.var(x), 4.0, rtol=2e-2)
    close("AR(1) lag-1 autocorrelation", np.corrcoef(x[:-1], x[1:])[0, 1], 0.8, atol=5e-3)
    if meta["theory"] is not None:
        FAILS.append("theory must be dropped with time structure")


def test_loaders():
    print("data loaders")
    cases = {
        "one per line": (b"1\n2\n3.5\n-4e1\n", {"value"}, 4),
        "comma one line": (b"1, 2, 3, 4, 5", {"value"}, 5),
        "csv header": (b"time,temp,label\n0,20.1,a\n1,20.5,b\n2,21.0,c\n", {"time", "temp"}, 3),
        "tsv no header": (b"1\t10\n2\t20\n3\t30\n", {"열 1", "열 2"}, 3),
        "messy text": (b"values: 3 apples, 4.5 kg; and -2", {"value"}, 3),
    }
    for name, (raw, want_cols, want_n) in cases.items():
        cols = loaders.parse(raw)
        ok = set(cols) == want_cols and all(v.size == want_n for v in cols.values())
        print(f"  {'ok ' if ok else 'FAIL'} {name}: {[(k, v.size) for k, v in cols.items()]}")
        if not ok:
            FAILS.append(f"loader {name}")


def test_risk():
    print("VaR / CVaR")
    rng = np.random.default_rng(11)
    x = rng.standard_normal(200_003)
    xs = np.sort(x)
    for a in (0.05, 0.01, 0.025):
        k = int(np.floor(x.size * a))
        brute = (xs[:k].sum() + (x.size * a - k) * xs[k]) / (x.size * a)
        close(f"ES {a} == step integral", risk._es_sorted(xs, a), brute)
    # integer n·α: ES is the plain mean of the k smallest
    y = np.arange(1.0, 101.0)
    close("ES of 1..100 at 5% = mean(1..5)", risk._es_sorted(y, 0.05), 3.0)
    lv = risk.var_cvar(xs, (0.95,), stats.norm(), False, 0.0)[0]
    close("theory ES normal 95% = φ(z)/α", lv["left"]["cvar_theory"], -stats.norm.pdf(1.6448536269514722) / 0.05)
    close("theory ES right = -left (symmetric)", lv["right"]["cvar_theory"], -lv["left"]["cvar_theory"])
    close("sample ES ≈ theory (N=2e5)", lv["left"]["cvar"], lv["left"]["cvar_theory"], rtol=2e-2)
    close("normal (ES-μ)/(VaR-μ) at 95%", lv["normal_shape"], 2.0627128 / 1.6448536, rtol=1e-6)
    # discrete: exact ES vs the quantile integral on a fine midpoint grid
    pois = stats.poisson(3.0)
    u = (np.arange(200_000) + 0.5) / 200_000 * 0.05
    for side, uu in (("left", u), ("right", 1 - u)):
        close(f"poisson ES {side} = (1/α)∫Q(u)du", risk._theory_es(pois, 0.05, side, True, 3.0),
              pois.ppf(uu).mean(), rtol=1e-4, atol=1e-5)
    mix = synth.NormalMixture(0.3, -1, 0.5, 2, 1.5)
    for side in ("left", "right"):
        a, b = (0, 0.05) if side == "left" else (0.95, 1)
        from scipy import integrate
        num = integrate.quad(lambda u: mix.ppf(u)[0], a, b, limit=100)[0] / 0.05
        close(f"mixture closed-form ES {side}", risk._theory_es(mix, 0.05, side, False, mix.stats()[0]), num, rtol=1e-4)
    c = risk.var_cvar(np.sort(stats.cauchy.rvs(size=1000, random_state=1)), (0.95,), stats.cauchy(), False, np.nan)[0]
    print(f"  {'ok ' if c['left']['cvar_theory'] == -np.inf else 'FAIL'} cauchy theory ES = -inf")
    if c["left"]["cvar_theory"] != -np.inf:
        FAILS.append("cauchy ES")
    print("Hill tail index")
    for a in (1.5, 3.0):
        z = np.sort(stats.pareto(a).rvs(400_000, random_state=np.random.default_rng(4)))
        close(f"pareto α={a} right tail", risk.hill(z)["right"], a, rtol=0.1)
    print("drawdown")
    d = risk.drawdown(np.array([1, 3, 2, 5, 1, 2, 6, 0.5]))
    close("mdd", d["mdd"], -5.5)
    close("peak/trough/recovery index", [d["peak_i"], d["trough_i"]], [6, 7])
    d = risk.drawdown(np.array([1, 3, 2, 5, 1, 2, 6.0]))
    close("first big fall 5->1 recovers at 6", [d["mdd"], d["peak_i"], d["trough_i"], d["recovery_i"]], [-4, 3, 4, 6])


def test_fit():
    print("distribution fitting")
    rng = np.random.default_rng(5)
    cases = [("gamma", stats.gamma(2.0, scale=1.5), {"k": 2.0, "θ": 1.5}),
             ("lognorm", stats.lognorm(0.4, scale=np.exp(1.0)), {"μ": 1.0, "σ": 0.4}),
             ("t", stats.t(4, 1, 2), {"ν": 4, "μ": 1, "σ": 2}),
             ("weibull_min", stats.weibull_min(1.5, scale=2), {"k": 1.5, "λ": 2})]
    for key, fz, want in cases:
        x = fz.rvs(40_000, random_state=rng)
        rows, _ = fitting.fit_all(x, False)
        best = rows[0]["key"]
        got = dict(next(r for r in rows if r["key"] == key)["params"])
        ok_rank = best == key
        print(f"  {'ok ' if ok_rank else 'FAIL'} {key}: AIC best = {best}")
        if not ok_rank:
            FAILS.append(f"fit rank {key}")
        close(f"{key} params", [got[k] for k in want], list(want.values()), rtol=0.05)
    x = stats.poisson(4).rvs(20_000, random_state=rng).astype(float)
    rows, _ = fitting.fit_all(x, True)
    print(f"  {'ok ' if rows[0]['key'] in ('poisson', 'nbinom') else 'FAIL'} poisson data -> {rows[0]['key']}")
    x = stats.nbinom(3, 0.4).rvs(20_000, random_state=rng).astype(float)
    rows, _ = fitting.fit_all(x, True)
    close("nbinom r, p", [v for _, v in rows[0]["params"]], [3, 0.4], rtol=0.08)
    print("normality tests")
    from statsmodels.stats.diagnostic import normal_ad
    y = rng.standard_normal(3000)
    close("Anderson-Darling vs statsmodels", normality.anderson_normal(y), normal_ad(y), rtol=1e-6)
    a2, p = normality.anderson_normal(stats.lognorm(0.5).rvs(20_000, random_state=rng))
    print(f"  {'ok ' if np.isfinite(a2) and p == 0 else 'FAIL'} far-from-normal data: A2={a2:.1f} finite, p=0")
    if not (np.isfinite(a2) and p == 0):
        FAILS.append("AD extreme")
    nt = normality.tests(rng.standard_normal(2000))
    print(f"  normal data p-values: {[(t['key'], round(t['p'], 3)) for t in nt['tests']]}")
    nt = normality.tests(stats.expon.rvs(size=2000, random_state=rng))
    rej = all(t["reject"] for t in nt["tests"] if t["key"] != "kurt")
    print(f"  {'ok ' if rej else 'FAIL'} exponential data rejected by every omnibus test")
    if not rej:
        FAILS.append("normality power")


def test_timeseries():
    print("time series")
    rng = np.random.default_rng(21)
    x = rng.standard_normal(3000).cumsum() * 0.1 + rng.standard_normal(3000)
    r = timeseries.rolling(x, 50, 2.0)
    ser = pd.Series(x).rolling(50)
    close("rolling mean vs pandas", r["mean"], ser.mean().to_numpy()[49:], rtol=1e-9, atol=1e-9)
    close("rolling std vs pandas", r["std"], ser.std().to_numpy()[49:], rtol=1e-8, atol=1e-9)
    close("rolling time axis (trailing, fs=2)", r["t"][:2], [49 / 2, 50 / 2])
    from statsmodels.stats.diagnostic import acorr_ljungbox
    from statsmodels.tsa.stattools import pacf
    from statsmodels.sandbox.stats.runs import runstest_1samp
    y, _ = synth.generate("normal", {}, 4000, 9, {"ar_phi": 0.7})
    c = timeseries.correlation(y, 30)
    close("AR(1) φ=0.7: ACF lag 1", c["acf"][1], 0.7, atol=0.03)
    close("PACF vs statsmodels ywm", c["pacf"], pacf(y, nlags=30, method="ywm"), rtol=1e-9, atol=1e-12)
    close("AR(1): PACF lag 2 ≈ 0", c["pacf"][2], 0.0, atol=0.05)
    lb = acorr_ljungbox(y, lags=[5, 20])
    got = {d["lag"]: d["stat"] for d in c["ljung_box"]}
    close("Ljung-Box Q vs statsmodels", [got[5], got[20]], lb["lb_stat"].to_numpy(), rtol=1e-9)
    z, p = runstest_1samp(y, cutoff="median", correction=False)
    rt = timeseries.runs_test(y)
    close("runs test z vs statsmodels", rt["z"], z, rtol=1e-9)
    print("stationarity / DFA")
    wn = rng.standard_normal(20_000)
    rw = wn.cumsum()
    s_wn, s_rw = timeseries.stationarity(wn), timeseries.stationarity(rw)
    ok = s_wn["adf"]["p"] < 0.01 and s_rw["adf"]["p"] > 0.05 and s_rw["kpss"]["p"] <= 0.05
    print(f"  {'ok ' if ok else 'FAIL'} ADF: white noise p={s_wn['adf']['p']:.3g}, random walk p={s_rw['adf']['p']:.3g}; "
          f"KPSS random walk p={s_rw['kpss']['p']:.3g}")
    if not ok:
        FAILS.append("stationarity")
    close("DFA α white noise ≈ 0.5", timeseries.dfa(wn)["alpha"], 0.5, atol=0.06)
    close("DFA α random walk ≈ 1.5", timeseries.dfa(rw)["alpha"], 1.5, atol=0.08)
    tr = timeseries.trend(np.arange(100) * 0.3 + 2, 10.0)
    close("trend slope per second (fs=10)", [tr["slope"], tr["r2"]], [3.0, 1.0])


def test_spectral():
    print("spectral")
    fs, n = 200.0, 8000
    t = np.arange(n) / fs
    rng = np.random.default_rng(8)
    x = 3 * np.sin(2 * np.pi * 7.3 * t) + 1.5 * np.sin(2 * np.pi * 41.05 * t + 1) + 0.5 * rng.standard_normal(n) + 0.02 * t
    res = spectral.analyze(x, fs, None, "linear", None)
    pk = sorted(res["peaks"][:2], key=lambda p: p["f"])
    close("peak frequencies (between bins)", [pk[0]["f"], pk[1]["f"]], [7.3, 41.05], atol=0.01)
    close("peak amplitudes", [pk[0]["amp"], pk[1]["amp"]], [3.0, 1.5], rtol=0.03)
    w = res["welch"]
    close("Welch PSD integrates to variance", np.trapezoid(w["psd"], w["f"]),
          np.var(spectral._prep(x, "linear")), rtol=0.05)
    wn = spectral.welch(rng.standard_normal(100_000), 1.0, 1024)
    d = spectral.descriptors(wn)
    ok = d["entropy"] > 0.98 and d["flatness"] > 0.9
    print(f"  {'ok ' if ok else 'FAIL'} white noise: spectral entropy {d['entropy']:.3f}, flatness {d['flatness']:.3f}")
    if not ok:
        FAILS.append("white-noise descriptors")
    sp = res["spectrogram"]
    print(f"  {'ok ' if sp['db'].shape == (sp['f'].size, sp['t'].size) else 'FAIL'} spectrogram shape {sp['db'].shape}")


if __name__ == "__main__":
    test_descriptive()
    test_kde()
    test_synth()
    test_loaders()
    test_risk()
    test_fit()
    test_timeseries()
    test_spectral()
    print("\nALL PASSED" if not FAILS else f"\nFAILED: {FAILS}")
    sys.exit(1 if FAILS else 0)
