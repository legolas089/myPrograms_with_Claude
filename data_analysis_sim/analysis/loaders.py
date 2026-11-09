"""Parse user data (pasted text, CSV/TSV/TXT, Excel) into numeric columns.

Accepted shapes:
    * one number per line / numbers separated by spaces, commas or tabs
    * a table with or without a header row (delimiter sniffed)
    * .xlsx / .xls (first sheet)
Non-numeric cells become NaN and are dropped per column.
"""

from __future__ import annotations

import csv
import io
import re

import numpy as np
import pandas as pd

_NUM = re.compile(r"[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?")
MIN_VALUES = 2


def _is_number(tok: str) -> bool:
    try:
        float(tok)
        return True
    except ValueError:
        return False


def _read_text(text: str) -> pd.DataFrame:
    text = text.strip().lstrip("﻿")
    if not text:
        raise ValueError("데이터가 비어 있습니다")
    lines = [ln for ln in text.splitlines() if ln.strip()]
    sample = "\n".join(lines[:50])
    try:
        sep = csv.Sniffer().sniff(sample, delimiters=",\t;| ").delimiter
    except csv.Error:
        sep = None
    first = re.split(r"[,\t;| ]+", lines[0].strip())
    header = None if all(_is_number(t) for t in first if t) else 0
    if sep is None or sep == " ":
        df = pd.read_csv(io.StringIO("\n".join(lines)), sep=r"\s+", header=header, engine="python")
    else:
        df = pd.read_csv(io.StringIO("\n".join(lines)), sep=sep, header=header,
                         skipinitialspace=True, engine="python")
    if len(df) == 1 and df.shape[1] >= MIN_VALUES:  # "1, 2, 3, 4" on one line
        df = pd.DataFrame({"value": df.iloc[0].to_numpy()})
    return df


def _numeric_columns(df: pd.DataFrame) -> dict[str, np.ndarray]:
    cols: dict[str, np.ndarray] = {}
    for i, c in enumerate(df.columns):
        if isinstance(c, str) and c.strip():
            name = c.strip()
        else:  # no header row
            name = "value" if df.shape[1] == 1 else f"열 {i + 1}"
        v = pd.to_numeric(df[c], errors="coerce").to_numpy(dtype=float)
        v = v[np.isfinite(v)]
        if v.size >= MIN_VALUES:
            while name in cols:
                name += "'"
            cols[name] = v
    return cols


def parse(raw: bytes, filename: str = "") -> dict[str, np.ndarray]:
    """Numeric columns {name: values}; raises ValueError when nothing usable."""
    fname = filename.lower()
    if fname.endswith((".xlsx", ".xlsm", ".xls")):
        df = pd.read_excel(io.BytesIO(raw), sheet_name=0)
        cols = _numeric_columns(df)
    else:
        for enc in ("utf-8-sig", "cp949", "latin-1"):
            try:
                text = raw.decode(enc)
                break
            except UnicodeDecodeError:
                continue
        try:
            cols = _numeric_columns(_read_text(text))
        except (pd.errors.ParserError, ValueError) as e:
            if "비어" in str(e):
                raise
            cols = {}
        if not cols:  # last resort: every number in the text, in order
            nums = np.array([float(t) for t in _NUM.findall(text)])
            if nums.size >= MIN_VALUES:
                cols = {"value": nums}
    if not cols:
        raise ValueError(f"숫자 값이 {MIN_VALUES}개 이상인 열을 찾지 못했습니다")
    return cols
