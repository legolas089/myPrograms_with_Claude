"""Catalog of 1-D and 2-D test functions, written once as CasADi expressions.

Each entry gives the formula (for the UI), its default search box, optional
parameters and the literature minimisers. The expression is symbolic, so
gradients and Hessians come from automatic differentiation.
"""

from __future__ import annotations

import math

import casadi as ca

PI = math.pi


def _p(key, label, default, step=0.1):
    return {"key": key, "label": label, "default": default, "step": step}


# ── 1-D ─────────────────────────────────────────────────────────────
def _forrester(X, p):
    x = X[0]
    return (6 * x - 2) ** 2 * ca.sin(12 * x - 4)


def _gramacy_lee(X, p):
    x = X[0]
    return ca.sin(10 * PI * x) / (2 * x) + (x - 1) ** 4


def _double_well(X, p):
    x = X[0]
    return x ** 4 - p["a"] * x ** 2 + p["b"] * x


def _sine_mix(X, p):
    x = X[0]
    return ca.sin(x) + ca.sin(10 * x / 3)


def _rastrigin1(X, p):
    x = X[0]
    return p["A"] + x ** 2 - p["A"] * ca.cos(2 * PI * x)


def _ackley1(X, p):
    x = X[0]
    return -20 * ca.exp(-0.2 * ca.fabs(x)) - ca.exp(ca.cos(2 * PI * x)) + 20 + math.e


def _quad1(X, p):
    x = X[0]
    return p["a"] * (x - p["c"]) ** 2


# ── 2-D ─────────────────────────────────────────────────────────────
def _ellipse(X, p):
    th = math.radians(p["theta"])
    u = math.cos(th) * X[0] + math.sin(th) * X[1]
    v = -math.sin(th) * X[0] + math.cos(th) * X[1]
    return u ** 2 + p["kappa"] * v ** 2


def _rosenbrock(X, p):
    x, y = X[0], X[1]
    return (p["a"] - x) ** 2 + p["b"] * (y - x ** 2) ** 2


def _himmelblau(X, p):
    x, y = X[0], X[1]
    return (x ** 2 + y - 11) ** 2 + (x + y ** 2 - 7) ** 2


def _rastrigin(X, p):
    x, y = X[0], X[1]
    A = p["A"]
    return 2 * A + x ** 2 - A * ca.cos(2 * PI * x) + y ** 2 - A * ca.cos(2 * PI * y)


def _ackley(X, p):
    x, y = X[0], X[1]
    r = ca.sqrt(0.5 * (x ** 2 + y ** 2))
    return (-20 * ca.exp(-0.2 * r) - ca.exp(0.5 * (ca.cos(2 * PI * x) + ca.cos(2 * PI * y)))
            + 20 + math.e)


def _beale(X, p):
    x, y = X[0], X[1]
    return (1.5 - x + x * y) ** 2 + (2.25 - x + x * y ** 2) ** 2 + (2.625 - x + x * y ** 3) ** 2


def _booth(X, p):
    x, y = X[0], X[1]
    return (x + 2 * y - 7) ** 2 + (2 * x + y - 5) ** 2


def _branin(X, p):
    x, y = X[0], X[1]
    b, c = 5.1 / (4 * PI ** 2), 5 / PI
    return (y - b * x ** 2 + c * x - 6) ** 2 + 10 * (1 - 1 / (8 * PI)) * ca.cos(x) + 10


def _six_hump(X, p):
    x, y = X[0], X[1]
    return (4 - 2.1 * x ** 2 + x ** 4 / 3) * x ** 2 + x * y + (-4 + 4 * y ** 2) * y ** 2


def _three_hump(X, p):
    x, y = X[0], X[1]
    return 2 * x ** 2 - 1.05 * x ** 4 + x ** 6 / 6 + x * y + y ** 2


def _goldstein_price(X, p):
    x, y = X[0], X[1]
    a = 1 + (x + y + 1) ** 2 * (19 - 14 * x + 3 * x ** 2 - 14 * y + 6 * x * y + 3 * y ** 2)
    b = 30 + (2 * x - 3 * y) ** 2 * (18 - 32 * x + 12 * x ** 2 + 48 * y - 36 * x * y + 27 * y ** 2)
    return a * b


def _levy(X, p):
    w1, w2 = 1 + (X[0] - 1) / 4, 1 + (X[1] - 1) / 4
    return (ca.sin(PI * w1) ** 2 + (w1 - 1) ** 2 * (1 + 10 * ca.sin(PI * w1 + 1) ** 2)
            + (w2 - 1) ** 2 * (1 + ca.sin(2 * PI * w2) ** 2))


def _styblinski(X, p):
    return 0.5 * sum(X[i] ** 4 - 16 * X[i] ** 2 + 5 * X[i] for i in range(2))


def _matyas(X, p):
    x, y = X[0], X[1]
    return 0.26 * (x ** 2 + y ** 2) - 0.48 * x * y


def _mccormick(X, p):
    x, y = X[0], X[1]
    return ca.sin(x + y) + (x - y) ** 2 - 1.5 * x + 2.5 * y + 1


def _easom(X, p):
    x, y = X[0], X[1]
    return -ca.cos(x) * ca.cos(y) * ca.exp(-((x - PI) ** 2 + (y - PI) ** 2))


def _eggholder(X, p):
    x, y = X[0], X[1]
    return (-(y + 47) * ca.sin(ca.sqrt(ca.fabs(x / 2 + y + 47)))
            - x * ca.sin(ca.sqrt(ca.fabs(x - (y + 47)))))


def _bukin6(X, p):
    x, y = X[0], X[1]
    return 100 * ca.sqrt(ca.fabs(y - 0.01 * x ** 2)) + 0.01 * ca.fabs(x + 10)


# key: (dim, label, formula, domain, params, fn, minima(p) -> ([x…], f*) | None, note, smooth)
_CATALOG = [
    # 1-D
    ("forrester", 1, "Forrester", "(6x−2)² sin(12x−4)", [[0, 1]], [], _forrester,
     lambda p: ([[0.757249]], -6.020740), "국소 최솟값 1개 + 전역 최솟값. 베이지안 최적화 예제로 자주 쓰입니다.", True),
    ("gramacy_lee", 1, "Gramacy & Lee", "sin(10πx)/(2x) + (x−1)⁴", [[0.5, 2.5]], [], _gramacy_lee,
     lambda p: ([[0.548563]], -0.869011), "왼쪽에 빠르게 진동하는 국소 최솟값이 몰려 있습니다.", True),
    ("sine_mix", 1, "사인 합", "sin x + sin(10x/3)", [[2.7, 7.5]], [], _sine_mix,
     lambda p: ([[5.145735]], -1.899599), "국소 최솟값 3개.", True),
    ("double_well", 1, "기울어진 이중 우물", "x⁴ − a x² + b x", [[-2.5, 2.5]],
     [_p("a", "a (우물 깊이)", 3.0), _p("b", "b (기울기)", 0.5)], _double_well,
     None, "b > 0 이면 왼쪽 우물이 더 깊습니다. 오른쪽에서 출발한 국소 탐색은 얕은 우물에 갇힙니다.", True),
    ("rastrigin1", 1, "Rastrigin (1-D)", "A + x² − A cos(2πx)", [[-5.12, 5.12]], [_p("A", "A (진동 세기)", 10.0, 1)],
     _rastrigin1, lambda p: ([[0.0]], 0.0), "정수 근처마다 국소 최솟값이 있습니다.", True),
    ("ackley1", 1, "Ackley (1-D)", "−20e^(−0.2|x|) − e^(cos 2πx) + 20 + e", [[-5, 5]], [], _ackley1,
     lambda p: ([[0.0]], 0.0), "최솟값 x=0 에서 미분 불가능(뾰족)합니다.", False),
    ("quad1", 1, "2차 함수", "a (x − c)²", [[-5, 5]], [_p("a", "a (곡률)", 1.0), _p("c", "c (최솟점)", 1.5)],
     _quad1, lambda p: ([[p["c"]]], 0.0), "볼록 기준 문제 — 모든 국소 방법이 바로 수렴해야 합니다.", True),
    # 2-D
    ("ellipse", 2, "회전 타원 (2차형)", "u² + κ v²,  (u,v) = θ만큼 회전한 (x,y)", [[-5, 5], [-5, 5]],
     [_p("kappa", "κ (조건수)", 25.0, 1), _p("theta", "θ [deg]", 30.0, 5)], _ellipse,
     lambda p: ([[0.0, 0.0]], 0.0), "κ 가 크면 최급강하·CG 가 지그재그로 움직이고 뉴턴 방법은 한 번에 갑니다.", True),
    ("rosenbrock", 2, "Rosenbrock", "(a − x)² + b (y − x²)²", [[-2, 2], [-1, 3]],
     [_p("a", "a", 1.0), _p("b", "b", 100.0, 10)], _rosenbrock,
     lambda p: ([[p["a"], p["a"] ** 2]], 0.0), "좁고 휘어진 골짜기. 골짜기에 들어가기는 쉽고 따라가기는 어렵습니다.", True),
    ("himmelblau", 2, "Himmelblau", "(x² + y − 11)² + (x + y² − 7)²", [[-5, 5], [-5, 5]], [], _himmelblau,
     lambda p: ([[3.0, 2.0], [-2.805118, 3.131312], [-3.779310, -3.283186], [3.584428, -1.848126]], 0.0),
     "같은 높이(0)의 전역 최솟값이 4개 — 출발점에 따라 다른 곳으로 갑니다.", True),
    ("rastrigin", 2, "Rastrigin", "2A + Σ (xᵢ² − A cos 2πxᵢ)", [[-5.12, 5.12], [-5.12, 5.12]],
     [_p("A", "A (진동 세기)", 10.0, 1)], _rastrigin, lambda p: ([[0.0, 0.0]], 0.0),
     "격자 모양으로 국소 최솟값이 약 100개. 국소 방법은 거의 항상 갇힙니다.", True),
    ("ackley", 2, "Ackley", "−20e^(−0.2√(½Σxᵢ²)) − e^(½Σcos 2πxᵢ) + 20 + e", [[-5, 5], [-5, 5]], [], _ackley,
     lambda p: ([[0.0, 0.0]], 0.0), "평평한 바깥 + 잔물결 + 가운데 깊은 구멍. 원점에서 미분 불가능.", False),
    ("beale", 2, "Beale", "(1.5−x+xy)² + (2.25−x+xy²)² + (2.625−x+xy³)²", [[-4.5, 4.5], [-4.5, 4.5]], [], _beale,
     lambda p: ([[3.0, 0.5]], 0.0), "모서리 쪽 값이 매우 커서 색은 로그 축이 잘 보입니다.", True),
    ("booth", 2, "Booth", "(x + 2y − 7)² + (2x + y − 5)²", [[-10, 10], [-10, 10]], [], _booth,
     lambda p: ([[1.0, 3.0]], 0.0), "볼록 2차 함수.", True),
    ("matyas", 2, "Matyas", "0.26(x² + y²) − 0.48xy", [[-10, 10], [-10, 10]], [], _matyas,
     lambda p: ([[0.0, 0.0]], 0.0), "볼록이지만 최솟점 근처가 아주 평평합니다.", True),
    ("three_hump", 2, "Three-hump camel", "2x² − 1.05x⁴ + x⁶/6 + xy + y²", [[-5, 5], [-5, 5]], [], _three_hump,
     lambda p: ([[0.0, 0.0]], 0.0), "국소 최솟값 3개.", True),
    ("six_hump", 2, "Six-hump camel", "(4 − 2.1x² + x⁴/3)x² + xy + (4y² − 4)y²", [[-3, 3], [-2, 2]], [], _six_hump,
     lambda p: ([[0.089842, -0.712656], [-0.089842, 0.712656]], -1.031628), "국소 최솟값 6개 중 전역 2개.", True),
    ("branin", 2, "Branin", "(y − 5.1x²/4π² + 5x/π − 6)² + 10(1 − 1/8π) cos x + 10", [[-5, 10], [0, 15]], [], _branin,
     lambda p: ([[-PI, 12.275], [PI, 2.275], [9.424778, 2.475]], 0.397887), "전역 최솟값 3개 (같은 높이).", True),
    ("mccormick", 2, "McCormick", "sin(x + y) + (x − y)² − 1.5x + 2.5y + 1", [[-1.5, 4], [-3, 4]], [], _mccormick,
     lambda p: ([[-0.547198, -1.547198]], -1.913223), "", True),
    ("goldstein_price", 2, "Goldstein–Price", "[1 + (x+y+1)²(…)]·[30 + (2x−3y)²(…)]", [[-2, 2], [-2, 2]], [],
     _goldstein_price, lambda p: ([[0.0, -1.0]], 3.0), "값의 범위가 10⁶ 배 넘게 차이 납니다 — 로그 축 추천.", True),
    ("levy", 2, "Levy", "sin²(πw₁) + (w₁−1)²(1 + 10 sin²(πw₁+1)) + (w₂−1)²(1 + sin²(2πw₂))", [[-10, 10], [-10, 10]], [],
     _levy, lambda p: ([[1.0, 1.0]], 0.0), "wᵢ = 1 + (xᵢ − 1)/4. 국소 최솟값이 많습니다.", True),
    ("styblinski", 2, "Styblinski–Tang", "½ Σ (xᵢ⁴ − 16xᵢ² + 5xᵢ)", [[-5, 5], [-5, 5]], [], _styblinski,
     lambda p: ([[-2.903534, -2.903534]], -78.332331), "국소 최솟값 4개 중 하나가 전역.", True),
    ("easom", 2, "Easom", "−cos x cos y · e^(−(x−π)² − (y−π)²)", [[-10, 10], [-10, 10]], [], _easom,
     lambda p: ([[PI, PI]], -1.0), "거의 전부 평평(기울기 0)하고 한 곳만 깊습니다 — 바늘 찾기.", True),
    ("eggholder", 2, "Eggholder", "−(y+47) sin√|x/2 + y + 47| − x sin√|x − y − 47|", [[-512, 512], [-512, 512]], [],
     _eggholder, lambda p: ([[512.0, 404.231805]], -959.640663), "전역 최솟값이 경계에 있고 국소 최솟값이 아주 많습니다.", False),
    ("bukin6", 2, "Bukin N.6", "100 √|y − 0.01x²| + 0.01 |x + 10|", [[-15, -5], [-3, 3]], [], _bukin6,
     lambda p: ([[-10.0, 1.0]], 0.0), "골짜기 바닥(y = 0.01x²)에서 미분 불가능 — 기울기 기반 방법에 매우 어렵습니다.", False),
]

CUSTOM_KEY = "custom"


def catalog() -> list[dict]:
    out = []
    for key, dim, label, formula, domain, params, _fn, minima, note, smooth in _CATALOG:
        out.append({"key": key, "dim": dim, "label": label, "formula": formula, "domain": domain,
                    "params": params, "note": note, "smooth": smooth})
    for dim, dom, ex in ((1, [[-3, 3]], "x^4 - 2*x^2 + 0.3*x"),
                         (2, [[-3, 3], [-3, 3]], "(x^2 + y - 1)^2 + 0.5*sin(3*x)*cos(2*y) + 0.1*x")):
        out.append({"key": CUSTOM_KEY, "dim": dim, "label": "직접 입력 (수식)", "formula": "",
                    "domain": dom, "params": [], "note": "", "smooth": True, "example": ex})
    return out


def get(key: str, dim: int):
    for row in _CATALOG:
        if row[0] == key and row[1] == dim:
            return row
    raise ValueError(f"알 수 없는 테스트 함수: {key} ({dim}-D)")


def build(key: str, dim: int, params: dict, X: ca.SX):
    """(expression, params used, literature minima or None, smooth, label)."""
    _, _, label, _, _, pdefs, fn, minima, _, smooth = get(key, dim)
    p = {d["key"]: float(params.get(d["key"], d["default"])) for d in pdefs}
    for k, v in p.items():
        if not math.isfinite(v):
            raise ValueError(f"파라미터 {k} 가 숫자가 아닙니다")
    known = minima(p) if minima else None
    return fn(X, p), p, known, smooth, label
