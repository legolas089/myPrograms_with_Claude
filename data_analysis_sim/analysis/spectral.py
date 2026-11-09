"""Frequency-domain analysis.

    amplitude_spectrum  one-sided FFT amplitude, scaled so a sine of amplitude A
                        shows a peak of height ≈ A (Hann window, coherent gain)
    peaks               strongest spectral lines, frequency refined by parabolic
                        interpolation of the log amplitude between bins
    welch               averaged periodogram (PSD) — lower variance than one FFT
    descriptors         centroid, bandwidth, roll-off, spectral entropy / flatness
    spectrogram         short-time Fourier transform in dB
Frequencies are in Hz when fs is given; with fs = 1 they are cycles per sample.
"""

from __future__ import annotations

import numpy as np
from scipy import signal

DISPLAY_POINTS = 4000
SPEC_TIME_BINS = 300
SPEC_FREQ_BINS = 257


def _prep(x: np.ndarray, detrend: str) -> np.ndarray:
    if detrend == "linear":
        return signal.detrend(x, type="linear")
    if detrend == "constant":
        return x - x.mean()
    return x.astype(float)


def _max_envelope(f: np.ndarray, a: np.ndarray, max_points: int = DISPLAY_POINTS):
    """Thin a spectrum for plotting, keeping the maximum of each bucket (peaks survive)."""
    if f.size <= max_points:
        return f, a
    edges = np.linspace(0, f.size, max_points + 1).astype(np.int64)
    idx = np.array([s + int(np.argmax(a[s:e])) for s, e in zip(edges[:-1], edges[1:])])
    return f[idx], a[idx]


def amplitude_spectrum(x: np.ndarray, fs: float, detrend: str = "linear") -> dict:
    n = x.size
    w = signal.windows.hann(n, sym=False)
    X = np.fft.rfft(_prep(x, detrend) * w)
    amp = 2.0 * np.abs(X) / w.sum()
    amp[0] /= 2.0  # DC is not doubled
    if n % 2 == 0:
        amp[-1] /= 2.0  # neither is Nyquist
    f = np.fft.rfftfreq(n, d=1.0 / fs)
    return {"f": f, "amp": amp, "df": fs / n}


def peaks(spec: dict, k: int = 6) -> list[dict]:
    f, amp, df = spec["f"], spec["amp"], spec["df"]
    if amp.size < 4:
        return []
    a = amp.copy()
    a[0] = 0.0  # DC is the mean, not a periodic component
    idx, props = signal.find_peaks(a, prominence=a.max() * 0.02)
    if idx.size == 0:
        return []
    idx = idx[np.argsort(props["prominences"])[::-1]][:k]
    total = float(np.sum(a**2))
    out = []
    for i in idx:
        fi, ai = f[i], amp[i]
        if 0 < i < a.size - 1 and a[i - 1] > 0 and a[i + 1] > 0:
            l, c, r = np.log(a[i - 1]), np.log(a[i]), np.log(a[i + 1])
            den = l - 2 * c + r
            if den < 0:
                d = 0.5 * (l - r) / den  # vertex offset in bins, |d| ≤ 0.5
                fi = f[i] + d * df
                ai = float(np.exp(c - 0.25 * (l - r) * d))
        # share of AC power within ±2 bins of the line (Hann main lobe)
        lo, hi = max(1, i - 2), min(a.size, i + 3)
        out.append({"f": float(fi), "period": float(1 / fi) if fi > 0 else None, "amp": float(ai),
                    "power_frac": float(np.sum(a[lo:hi] ** 2) / total) if total > 0 else None})
    return out


def welch(x: np.ndarray, fs: float, nperseg: int | None, detrend: str = "linear") -> dict:
    n = x.size
    if not nperseg:
        nperseg = int(2 ** np.clip(np.round(np.log2(n / 8)), 4, 13))  # 8 segments, 16 … 8192
    nperseg = int(min(nperseg, n))
    f, p = signal.welch(x, fs=fs, nperseg=nperseg, detrend=detrend if detrend != "none" else False,
                        scaling="density")
    return {"f": f, "psd": p, "nperseg": nperseg, "segments": int((n - nperseg) // (nperseg // 2) + 1)}


def descriptors(w: dict) -> dict:
    f, p = w["f"][1:], w["psd"][1:]  # drop DC
    tot = float(p.sum())
    if tot <= 0:
        return {}
    q = p / tot
    centroid = float(np.sum(f * q))
    cum = np.cumsum(q)
    pos = p[p > 0]
    return {
        "centroid": centroid,
        "bandwidth": float(np.sqrt(np.sum((f - centroid) ** 2 * q))),
        "rolloff85": float(f[np.searchsorted(cum, 0.85)]),
        "median_freq": float(f[np.searchsorted(cum, 0.5)]),
        # 1 = flat (white noise), → 0 = a single line
        "entropy": float(-np.sum(q[q > 0] * np.log(q[q > 0])) / np.log(q.size)),
        "flatness": float(np.exp(np.mean(np.log(pos))) / np.mean(pos)) if pos.size else None,
        "peak_freq": float(f[np.argmax(p)]),
    }


def spectrogram(x: np.ndarray, fs: float, nperseg: int | None, detrend: str = "linear") -> dict:
    n = x.size
    if not nperseg:
        nperseg = int(2 ** np.clip(np.round(np.log2(n / 64)), 4, 9))  # 16 … 512
    nperseg = int(min(nperseg, max(16, n // 4)))
    f, t, S = signal.spectrogram(x, fs=fs, nperseg=nperseg, noverlap=nperseg // 2,
                                 detrend=detrend if detrend != "none" else False, scaling="density")
    if t.size > SPEC_TIME_BINS:  # average neighbouring frames
        g = int(np.ceil(t.size / SPEC_TIME_BINS))
        m = t.size // g
        S = S[:, : m * g].reshape(S.shape[0], m, g).mean(axis=2)
        t = t[: m * g].reshape(m, g).mean(axis=1)
    if f.size > SPEC_FREQ_BINS:
        g = int(np.ceil(f.size / SPEC_FREQ_BINS))
        m = f.size // g
        S = S[: m * g].reshape(m, g, -1).mean(axis=1)
        f = f[: m * g].reshape(m, g).mean(axis=1)
    db = np.round(10 * np.log10(np.maximum(S, S.max() * 1e-12 if S.max() > 0 else 1e-300)), 2)
    return {"f": f, "t": t, "db": db, "nperseg": nperseg}


def analyze(x: np.ndarray, fs: float, nperseg: int | None, detrend: str, spec_nperseg: int | None) -> dict:
    if x.size < 16:
        raise ValueError("주파수 분석에는 최소 16개 샘플이 필요합니다")
    if detrend not in ("linear", "constant", "none"):
        raise ValueError(f"알 수 없는 추세 제거 방식: {detrend}")
    spec = amplitude_spectrum(x, fs, detrend)
    w = welch(x, fs, nperseg, detrend)
    fd, ad = _max_envelope(spec["f"], spec["amp"])
    return {
        "fs": fs, "nyquist": fs / 2, "df": spec["df"], "n": int(x.size),
        "fft": {"f": fd, "amp": ad, "decimated": bool(fd.size < spec["f"].size)},
        "peaks": peaks(spec), "welch": w, "descriptors": descriptors(w),
        "spectrogram": spectrogram(x, fs, spec_nperseg, detrend),
    }
