"""Convert results to strict-JSON-safe Python objects.

Python's json module writes NaN/Infinity, which the browser's JSON.parse
rejects. NaN is sent as null, and infinities as the strings "inf" / "-inf".
"""

from __future__ import annotations

import math

import numpy as np


def clean(obj):
    if isinstance(obj, dict):
        return {str(k): clean(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [clean(v) for v in obj]
    if isinstance(obj, np.ndarray):
        return clean(obj.tolist())
    if isinstance(obj, (bool, np.bool_)):
        return bool(obj)
    if isinstance(obj, (int, np.integer)):
        return int(obj)
    if isinstance(obj, (float, np.floating)):
        f = float(obj)
        if math.isnan(f):
            return None
        if math.isinf(f):
            return "inf" if f > 0 else "-inf"
        return f
    return obj


def sig(a, digits: int = 5) -> np.ndarray:
    """Round to `digits` significant digits so large grids serialise compactly."""
    a = np.asarray(a, float)
    with np.errstate(all="ignore"):
        mag = np.floor(np.log10(np.abs(a)))
        mag = np.where(np.isfinite(mag), mag, 0)
        scale = 10.0 ** (digits - 1 - mag)
        out = np.round(a * scale) / scale
    return np.where(np.isfinite(a), out, a)
