"""Convert analysis results to strict-JSON-safe Python objects.

Python's json module writes NaN/Infinity, which the browser's JSON.parse
rejects. Undefined statistics (Cauchy mean, constant-data skewness, ...) are
sent as null, and infinities as the strings "inf" / "-inf" so the UI can still
say "∞" (e.g. Student-t kurtosis for ν ≤ 4).
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
