"""Algorithm catalog and a single entry point, run(problem, key, options, x0, seed).

Every objective call goes through a Recorder, so all methods report the same
things: the evaluation log (x, f), counts of f / gradient / Hessian calls, the
iterate path, and best-so-far f against the number of evaluations — the fair
axis for comparing a gradient method with a population method.
"""

from __future__ import annotations

import math
import threading
import time

import casadi as ca
import numpy as np
from scipy import optimize as so

from . import bayes
from .jsonsafe import sig
from .problem import _scipy_constraints

MAX_EVALS = 100_000
MAX_PATH = 800
MAX_EVAL_LOG = 4000
MAX_CURVE = 500


class Aborted(Exception):
    pass


class BudgetExceeded(Exception):
    pass


class Recorder:
    def __init__(self, funs, stop: threading.Event | None = None, max_evals: int = MAX_EVALS):
        self.funs = funs
        self.stop = stop
        self.max_evals = max_evals
        self.xs: list[np.ndarray] = []
        self.fs: list[float] = []
        self.feas: list[bool] = []
        self.nf = self.ng = self.nh = 0

    def _check(self):
        if self.stop is not None and self.stop.is_set():
            raise Aborted()

    def log(self, x, v):
        x = np.array(x, float).ravel()
        self.xs.append(x)
        self.fs.append(v)
        self.feas.append(self.funs.C is None or self.funs.violation(x) <= 1e-6)

    def f(self, x) -> float:
        self._check()
        self.nf += 1
        if self.nf > self.max_evals:
            raise BudgetExceeded()
        v = self.funs.f(x)
        self.log(x, v)
        return v

    def grad(self, x) -> np.ndarray:
        self._check()
        self.ng += 1
        return self.funs.grad(x)

    def hess(self, x) -> np.ndarray:
        self.nh += 1
        return self.funs.hess(x)

    def ineq_ok(self, x) -> bool:
        ni = self.funs.n_ineq
        return ni == 0 or bool(np.all(self.funs.c(x)[:ni] <= 1e-12))

    def best(self):
        """Best feasible evaluated point (or best overall if none is feasible)."""
        if not self.fs:
            return None
        f = np.asarray(self.fs, float)
        ok = np.asarray(self.feas)
        pool = np.where(ok & np.isfinite(f))[0]
        if pool.size == 0:
            pool = np.where(np.isfinite(f))[0]
        if pool.size == 0:
            return None
        i = pool[np.argmin(f[pool])]
        return self.xs[i], float(f[i])


def _fd_grad(rec: Recorder, mode: str):
    """Finite-difference gradient whose f calls are counted as evaluations."""
    eps = np.finfo(float).eps
    rel = math.sqrt(eps) if mode == "2-point" else eps ** (1 / 3)

    def g(x):
        x = np.asarray(x, float)
        h = rel * np.maximum(1.0, np.abs(x))
        out = np.empty_like(x)
        if mode == "2-point":
            f0 = rec.f(x)
            for i in range(x.size):
                e = np.zeros_like(x)
                e[i] = h[i]
                out[i] = (rec.f(x + e) - f0) / h[i]
        else:
            for i in range(x.size):
                e = np.zeros_like(x)
                e[i] = h[i]
                out[i] = (rec.f(x + e) - rec.f(x - e)) / (2 * h[i])
        return out
    return g


# ── catalog ─────────────────────────────────────────────────────────
def _o(key, label, default, kind="float", **kw):
    d = {"key": key, "label": label, "default": default, "type": kind}
    d.update(kw)
    return d


JAC = _o("jac_mode", "기울기", "exact", "select",
         choices=[["exact", "정확 (CasADi 자동미분)"], ["2-point", "유한차분 2점"], ["3-point", "유한차분 3점 (중앙)"]],
         help="유한차분이면 기울기 계산에 쓴 f 호출도 평가 수에 들어갑니다")
SEED = _o("seed", "seed", 0, "int", min=0)


def _a(key, label, group, lib, desc, options, *, grad=False, hess=False, bounds=True, cons=False,
       eq=True, x0=True, stochastic=False):
    return {"key": key, "label": label, "group": group, "lib": lib, "desc": desc, "options": options,
            "grad": grad, "hess": hess, "bounds": bounds, "cons": cons, "eq": eq, "x0": x0,
            "stochastic": stochastic}


G_FREE, G_GRAD, G_HESS, G_GLOBAL, G_CASADI, G_BAYES = (
    "국소 · 미분 없음", "국소 · 기울기", "국소 · 헤시안", "전역 (SciPy)", "CasADi (NLP)", "베이지안 · 표본 기반")

ALGOS = [
    _a("Nelder-Mead", "Nelder–Mead (심플렉스)", G_FREE, "scipy.optimize.minimize",
       "d+1개 꼭짓점의 심플렉스를 반사·확장·수축시킵니다. 미분이 필요 없고 잡음·꺾임에 강하지만 느립니다.",
       [_o("maxiter", "최대 반복", 1000, "int", min=1), _o("xatol", "x 허용오차", 1e-8), _o("fatol", "f 허용오차", 1e-8),
        _o("init_step", "초기 심플렉스 크기 (영역 폭 비율)", 0.05, min=1e-6), _o("adaptive", "차원 적응 계수", False, "bool")]),
    _a("Powell", "Powell (방향 집합)", G_FREE, "scipy.optimize.minimize",
       "좌표 방향을 따라 1차원 선탐색을 반복하고 방향 집합을 갱신합니다. 미분 없음.",
       [_o("maxiter", "최대 반복", 1000, "int", min=1), _o("xtol", "x 허용오차", 1e-8), _o("ftol", "f 허용오차", 1e-10)]),
    _a("COBYLA", "COBYLA (선형 근사 신뢰영역)", G_FREE, "scipy.optimize.minimize",
       "목적·제약을 선형 보간으로 근사하는 신뢰영역 방법. 미분 없이 부등식 제약을 다룹니다 (등식은 부등식 두 개로 바꿔 넣음).",
       [_o("maxiter", "최대 평가", 2000, "int", min=1), _o("rhobeg", "초기 신뢰반경 (영역 폭 비율)", 0.1, min=1e-6),
        _o("tol", "최종 신뢰반경", 1e-8)], cons=True),
    _a("COBYQA", "COBYQA (2차 근사 신뢰영역)", G_FREE, "scipy.optimize.minimize",
       "COBYLA 의 후속: 2차 모형으로 근사하는 미분 없는 SQP 형 신뢰영역 방법. 경계·부등식·등식 제약을 모두 다룹니다.",
       [_o("maxfev", "최대 평가", 1000, "int", min=1), _o("initial_tr_radius", "초기 신뢰반경 (영역 폭 비율)", 0.1, min=1e-6),
        _o("final_tr_radius", "최종 신뢰반경", 1e-8)], cons=True),
    _a("CG", "켤레기울기 CG (Polak–Ribière)", G_GRAD, "scipy.optimize.minimize",
       "이전 방향과 켤레가 되도록 탐색 방향을 고릅니다. 메모리가 거의 안 들지만 경계를 다루지 못합니다.",
       [JAC, _o("maxiter", "최대 반복", 1000, "int", min=1), _o("gtol", "기울기 허용오차", 1e-6)], grad=True, bounds=False),
    _a("BFGS", "BFGS (준뉴턴)", G_GRAD, "scipy.optimize.minimize",
       "기울기 변화로 역헤시안을 근사하는 준뉴턴 방법. 매끄러운 문제의 기본값. 경계 없음.",
       [JAC, _o("maxiter", "최대 반복", 1000, "int", min=1), _o("gtol", "기울기 허용오차", 1e-6)], grad=True, bounds=False),
    _a("L-BFGS-B", "L-BFGS-B (제한 메모리, 경계)", G_GRAD, "scipy.optimize.minimize",
       "최근 m 개 기울기 쌍만 쓰는 BFGS 에 경계(박스) 제약을 더한 방법.",
       [JAC, _o("maxiter", "최대 반복", 1000, "int", min=1), _o("maxcor", "메모리 m", 10, "int", min=1),
        _o("ftol", "f 상대 허용오차", 2.2e-9), _o("gtol", "투영 기울기 허용오차", 1e-6)], grad=True),
    _a("TNC", "TNC (절단 뉴턴, 경계)", G_GRAD, "scipy.optimize.minimize",
       "뉴턴 방향을 CG 로 근사해 푸는 절단 뉴턴 방법. 경계 제약 지원.",
       [JAC, _o("maxfun", "최대 평가", 1000, "int", min=1), _o("ftol", "f 허용오차", 1e-10), _o("gtol", "기울기 허용오차", 1e-8)], grad=True),
    _a("SLSQP", "SLSQP (순차 2차 계획)", G_GRAD, "scipy.optimize.minimize",
       "라그랑지안의 준뉴턴 근사로 QP 부분문제를 반복해서 풉니다. 경계·부등식·등식 제약을 모두 다루는 표준 방법.",
       [JAC, _o("maxiter", "최대 반복", 200, "int", min=1), _o("ftol", "f 허용오차", 1e-10)], grad=True, cons=True),
    _a("Newton-CG", "Newton-CG", G_HESS, "scipy.optimize.minimize",
       "정확한 헤시안으로 뉴턴 방향을 CG 로 풀고 선탐색합니다. 헤시안이 양정치가 아니면 방향이 나빠질 수 있습니다.",
       [JAC, _o("maxiter", "최대 반복", 500, "int", min=1), _o("xtol", "x 허용오차", 1e-10)], grad=True, hess=True, bounds=False),
    _a("dogleg", "Dogleg 신뢰영역", G_HESS, "scipy.optimize.minimize",
       "최급강하점과 뉴턴점을 잇는 꺾인 경로로 신뢰영역 부분문제를 풉니다. 헤시안이 양정치여야 합니다(아니면 실패).",
       [JAC, _o("maxiter", "최대 반복", 500, "int", min=1), _o("gtol", "기울기 허용오차", 1e-8),
        _o("initial_trust_radius", "초기 신뢰반경 (영역 폭 비율)", 0.1, min=1e-6)], grad=True, hess=True, bounds=False),
    _a("trust-ncg", "신뢰영역 Newton-CG", G_HESS, "scipy.optimize.minimize",
       "Steihaug CG 로 신뢰영역 부분문제를 근사합니다. 음의 곡률 방향도 이용합니다.",
       [JAC, _o("maxiter", "최대 반복", 500, "int", min=1), _o("gtol", "기울기 허용오차", 1e-8),
        _o("initial_trust_radius", "초기 신뢰반경 (영역 폭 비율)", 0.1, min=1e-6)], grad=True, hess=True, bounds=False),
    _a("trust-krylov", "신뢰영역 Krylov (GLTR)", G_HESS, "scipy.optimize.minimize",
       "Krylov 부분공간에서 신뢰영역 부분문제를 거의 정확하게 풉니다.",
       [JAC, _o("maxiter", "최대 반복", 500, "int", min=1), _o("gtol", "기울기 허용오차", 1e-8),
        _o("initial_trust_radius", "초기 신뢰반경 (영역 폭 비율)", 0.1, min=1e-6)], grad=True, hess=True, bounds=False),
    _a("trust-exact", "신뢰영역 정확해 (Moré–Sorensen)", G_HESS, "scipy.optimize.minimize",
       "헤시안을 분해해 부분문제를 정확히 풉니다. 작은 문제에서 반복 수가 가장 적습니다.",
       [JAC, _o("maxiter", "최대 반복", 500, "int", min=1), _o("gtol", "기울기 허용오차", 1e-8),
        _o("initial_trust_radius", "초기 신뢰반경 (영역 폭 비율)", 0.1, min=1e-6)], grad=True, hess=True, bounds=False),
    _a("trust-constr", "trust-constr (신뢰영역 내점/SQP)", G_HESS, "scipy.optimize.minimize",
       "제약이 있으면 내점법 + 신뢰영역 SQP, 없으면 신뢰영역 뉴턴. 헤시안은 정확값 또는 BFGS/SR1 근사.",
       [JAC, _o("hess", "헤시안", "exact", "select", choices=[["exact", "정확 (CasADi)"], ["BFGS", "BFGS 근사"], ["SR1", "SR1 근사"]]),
        _o("maxiter", "최대 반복", 1000, "int", min=1), _o("gtol", "기울기 허용오차", 1e-8), _o("xtol", "x 허용오차", 1e-10),
        _o("initial_tr_radius", "초기 신뢰반경 (영역 폭 비율)", 0.1, min=1e-6)], grad=True, hess=True, cons=True),
    # global
    _a("dual_annealing", "Dual Annealing (일반화 담금질)", G_GLOBAL, "scipy.optimize.dual_annealing",
       "Tsallis 분포로 크게 뛰는 담금질(방문)과 국소 탐색(L-BFGS-B)을 섞습니다. 온도가 내려가며 탐색이 좁아지고, 일정 온도에서 재시작합니다.",
       [_o("maxiter", "최대 전역 반복", 300, "int", min=1), _o("maxfun", "최대 평가", 10000, "int", min=10),
        _o("initial_temp", "초기 온도", 5230.0, min=0.02, max=5e4), _o("restart_temp_ratio", "재시작 온도 비", 2e-5, min=1e-10, max=0.999),
        _o("visit", "방문 분포 q_v", 2.62, min=1.01, max=3.0), _o("accept", "수락 분포 q_a", -5.0, min=-1e4, max=-1e-4),
        _o("no_local_search", "국소 탐색 끄기 (순수 담금질)", False, "bool"), _o("use_x0", "시작점 사용", True, "bool"), SEED],
       x0=True, stochastic=True),
    _a("differential_evolution", "차분 진화 DE", G_GLOBAL, "scipy.optimize.differential_evolution",
       "개체군의 차이 벡터로 돌연변이·교차를 만들어 더 나은 개체로 바꿉니다. 미분 없음, 제약 지원. 마지막에 국소 polish.",
       [_o("strategy", "전략", "best1bin", "select", choices=[[s, s] for s in
            ["best1bin", "rand1bin", "currenttobest1bin", "randtobest1bin", "best2bin", "rand2bin", "rand1exp"]]),
        _o("maxiter", "최대 세대", 200, "int", min=1), _o("popsize", "개체군 배수 (×d)", 15, "int", min=2),
        _o("mutation_lo", "돌연변이 F 하한", 0.5, min=0, max=2), _o("mutation_hi", "돌연변이 F 상한", 1.0, min=0, max=2),
        _o("recombination", "교차율 CR", 0.7, min=0, max=1), _o("tol", "수렴 허용오차 (상대)", 0.01),
        _o("init", "초기 개체군", "latinhypercube", "select", choices=[["latinhypercube", "LHS"], ["sobol", "Sobol"], ["halton", "Halton"], ["random", "무작위"]]),
        _o("polish", "마지막에 국소 polish", True, "bool"), SEED], cons=True, x0=False, stochastic=True),
    _a("basinhopping", "Basin-hopping", G_GLOBAL, "scipy.optimize.basinhopping",
       "무작위로 점프 → 국소 최적화 → Metropolis 기준으로 수락을 반복해 국소 최솟값 사이를 건너다닙니다.",
       [_o("niter", "점프 횟수", 50, "int", min=1), _o("T", "온도 T (f 단위)", 1.0, min=0),
        _o("stepsize", "점프 크기 (영역 폭 비율)", 0.1, min=1e-6),
        _o("local", "국소 최적화", "auto", "select", choices=[["auto", "자동 (L-BFGS-B / 제약 있으면 SLSQP)"],
            ["L-BFGS-B", "L-BFGS-B"], ["BFGS", "BFGS"], ["Nelder-Mead", "Nelder–Mead"], ["SLSQP", "SLSQP"]]), SEED],
       cons=True, stochastic=True),
    _a("shgo", "SHGO (단체 호몰로지)", G_GLOBAL, "scipy.optimize.shgo",
       "표본점으로 단체 복합체를 만들고 국소 최솟값 후보 영역마다 국소 최적화를 돌립니다. 결정론적, 제약 지원.",
       [_o("n", "표본점 수", 64, "int", min=4), _o("iters", "정제 반복", 3, "int", min=1),
        _o("sampling_method", "표본 방식", "simplicial", "select", choices=[["simplicial", "simplicial"], ["sobol", "Sobol"], ["halton", "Halton"]])],
       cons=True, x0=False),
    _a("direct", "DIRECT (구간 분할)", G_GLOBAL, "scipy.optimize.direct",
       "탐색 영역을 초직사각형으로 나누고 '잠재적으로 최적인' 상자를 계속 3등분합니다. 결정론적, 립시츠 상수 불필요.",
       [_o("maxfun", "최대 평가", 2000, "int", min=10), _o("maxiter", "최대 반복", 1000, "int", min=1),
        _o("eps", "ε (지역/전역 균형)", 1e-4), _o("locally_biased", "국소 편향 (DIRECT-L)", True, "bool")], x0=False),
    # casadi
    _a("ipopt", "IPOPT (내점법)", G_CASADI, "casadi.nlpsol('ipopt')",
       "원-쌍대 내점법 + 필터 선탐색. 장벽 매개변수 μ 를 줄여 가며 KKT 조건을 풉니다. CasADi 가 정확한 기울기·헤시안을 넘깁니다.",
       [_o("hessian_approximation", "헤시안", "exact", "select", choices=[["exact", "정확 (자동미분)"], ["limited-memory", "L-BFGS 근사"]]),
        _o("mu_strategy", "μ 갱신", "monotone", "select", choices=[["monotone", "monotone (Fiacco–McCormick)"], ["adaptive", "adaptive"]]),
        _o("max_iter", "최대 반복", 500, "int", min=1), _o("tol", "허용오차", 1e-8)], grad=True, hess=True, cons=True),
    _a("sqpmethod", "CasADi SQP (sqpmethod)", G_CASADI, "casadi.nlpsol('sqpmethod')",
       "정확한 라그랑지안 헤시안(또는 L-BFGS)으로 QP 부분문제를 만들고 QP 솔버로 풉니다. 선탐색으로 전역화.",
       [_o("qpsol", "QP 솔버", "qrqp", "select", choices=[["qrqp", "qrqp (CasADi 내장 활성집합)"], ["qpoases", "qpOASES"], ["osqp", "OSQP (ADMM)"]]),
        _o("hessian_approximation", "헤시안", "exact", "select", choices=[["exact", "정확 (자동미분)"], ["limited-memory", "L-BFGS 근사"]]),
        _o("max_iter", "최대 반복", 200, "int", min=1), _o("tol", "허용오차 (원·쌍대)", 1e-8)], grad=True, hess=True, cons=True),
    # bayesian / sampling
    _a("bo_gp", "베이지안 최적화 (GP)", G_BAYES, "자체 구현 (scikit-learn GP)",
       "지금까지의 관측으로 가우시안 과정 대리모델을 맞추고, 획득함수(EI·PI·LCB)가 가장 큰 곳을 다음에 평가합니다. 평가가 비싼 함수용.",
       [_o("n_init", "초기 점", 6, "int", min=2), _o("n_iter", "추가 평가 (반복)", 25, "int", min=0, max=200),
        _o("acquisition", "획득함수", "ei", "select", choices=[["ei", "EI (기대 개선량)"], ["pi", "PI (개선 확률)"], ["lcb", "LCB (하한 신뢰)"]]),
        _o("xi", "ξ (EI·PI 탐험, σ_y 단위)", 0.01, min=0), _o("kappa", "κ (LCB 탐험)", 2.0, min=0),
        _o("kernel", "커널", "matern52", "select", choices=[["matern52", "Matérn 5/2"], ["matern32", "Matérn 3/2"], ["rbf", "RBF (제곱지수)"]]),
        _o("noise", "관측 잡음", "auto", "select", choices=[["auto", "추정 (WhiteKernel)"], ["none", "없음 (보간)"]]),
        _o("init", "초기 설계", "lhs", "select", choices=[["lhs", "LHS"], ["sobol", "Sobol"], ["random", "무작위"]]), SEED],
       x0=False, stochastic=True, eq=False),
    _a("optuna_tpe", "Optuna TPE", G_BAYES, "optuna.samplers.TPESampler",
       "좋은 점/나쁜 점의 밀도 l(x), g(x) 를 Parzen 추정해 l/g 가 큰 곳을 고르는 트리 구조 Parzen 추정기.",
       [_o("n_trials", "평가 수", 60, "int", min=2, max=2000), _o("n_startup", "무작위 시작 평가", 10, "int", min=1),
        _o("multivariate", "다변량 TPE", True, "bool"), SEED], x0=False, stochastic=True, eq=False),
    _a("optuna_gp", "Optuna GP", G_BAYES, "optuna.samplers.GPSampler",
       "Optuna 의 가우시안 과정 + logEI 베이지안 최적화 (PyTorch). 처음 실행은 torch 불러오기로 몇 초 걸립니다.",
       [_o("n_trials", "평가 수", 30, "int", min=2, max=300), _o("n_startup", "무작위 시작 평가", 10, "int", min=1), SEED],
       x0=False, stochastic=True, eq=False),
    _a("random", "무작위 탐색 (기준선)", G_BAYES, "numpy",
       "영역에서 균등하게 뽑아 평가만 합니다. 다른 방법이 이것보다 나은지 보는 기준선.",
       [_o("n_samples", "평가 수", 100, "int", min=1, max=100000),
        _o("design", "표본 방식", "random", "select", choices=[["random", "균등 무작위"], ["sobol", "Sobol"], ["lhs", "LHS"]]), SEED],
       x0=False, stochastic=True, eq=False),
]
BY_KEY = {a["key"]: a for a in ALGOS}


def catalog() -> list[dict]:
    return ALGOS


def _opts(algo: dict, given: dict) -> dict:
    o = {}
    for d in algo["options"]:
        v = given.get(d["key"], d["default"]) if given else d["default"]
        t = d["type"]
        try:
            if t == "int":
                v = int(v)
            elif t == "float":
                v = float(v)
                if not math.isfinite(v):
                    raise ValueError
            elif t == "bool":
                v = bool(v)
            else:
                if v not in [c[0] for c in d["choices"]]:
                    raise ValueError
        except (TypeError, ValueError):
            raise ValueError(f"{algo['label']}: '{d['label']}' 값이 올바르지 않습니다") from None
        if "min" in d and v < d["min"]:
            raise ValueError(f"{algo['label']}: '{d['label']}' 은 {d['min']} 이상")
        if "max" in d and v > d["max"]:
            raise ValueError(f"{algo['label']}: '{d['label']}' 은 {d['max']} 이하")
        o[d["key"]] = v
    return o


def _rng_kw(fn, seed):
    import inspect
    params = inspect.signature(fn).parameters
    return {"rng": np.random.default_rng(seed)} if "rng" in params else {"seed": seed}


# ── runners ─────────────────────────────────────────────────────────
def _run_local(prob, rec, algo, o, x0, notes, path):
    m = algo["key"]
    fs = rec.funs
    w = float(np.mean(prob.bounds[:, 1] - prob.bounds[:, 0]))
    kw = {}
    if algo["grad"]:
        kw["jac"] = rec.grad if o["jac_mode"] == "exact" else _fd_grad(rec, o["jac_mode"])
    if algo["hess"]:
        if m == "trust-constr" and o["hess"] != "exact":
            kw["hess"] = so.BFGS() if o["hess"] == "BFGS" else so.SR1()
        else:
            kw["hess"] = rec.hess
    if algo["bounds"]:
        kw["bounds"] = so.Bounds(prob.bounds[:, 0], prob.bounds[:, 1])
    if fs.cons and algo["cons"]:
        cons = _scipy_constraints(fs)
        if m == "COBYLA":  # inequalities only: h = 0  ->  h >= 0 and -h >= 0
            conv = []
            for c in cons:
                if c["type"] == "eq":
                    conv.append({"type": "ineq", "fun": c["fun"]})
                    conv.append({"type": "ineq", "fun": (lambda x, f=c["fun"]: -f(x))})
                else:
                    conv.append(c)
            cons = conv
        kw["constraints"] = cons
    opts = {}
    if m == "Nelder-Mead":
        step = o["init_step"] * (prob.bounds[:, 1] - prob.bounds[:, 0])
        simplex = [x0] + [x0 + np.eye(prob.dim)[i] * step[i] for i in range(prob.dim)]
        simplex = np.clip(simplex, prob.bounds[:, 0], prob.bounds[:, 1])
        for i in range(1, len(simplex)):  # a clipped vertex can land on x0
            if np.allclose(simplex[i], simplex[0]):
                simplex[i] = x0 - np.eye(prob.dim)[i - 1] * step[i - 1]
        opts = {"maxiter": o["maxiter"], "xatol": o["xatol"], "fatol": o["fatol"], "adaptive": o["adaptive"],
                "initial_simplex": simplex, "maxfev": MAX_EVALS}
    elif m == "Powell":
        opts = {"maxiter": o["maxiter"], "xtol": o["xtol"], "ftol": o["ftol"], "maxfev": MAX_EVALS}
    elif m == "COBYLA":
        opts = {"maxiter": o["maxiter"], "rhobeg": o["rhobeg"] * w, "tol": o["tol"]}
    elif m == "COBYQA":
        opts = {"maxfev": o["maxfev"], "initial_tr_radius": o["initial_tr_radius"] * w,
                "final_tr_radius": o["final_tr_radius"]}
    elif m in ("CG", "BFGS"):
        opts = {"maxiter": o["maxiter"], "gtol": o["gtol"]}
    elif m == "L-BFGS-B":
        opts = {"maxiter": o["maxiter"], "maxcor": o["maxcor"], "ftol": o["ftol"], "gtol": o["gtol"],
                "maxfun": MAX_EVALS}
    elif m == "TNC":
        opts = {"maxfun": o["maxfun"], "ftol": o["ftol"], "gtol": o["gtol"]}
    elif m == "SLSQP":
        opts = {"maxiter": o["maxiter"], "ftol": o["ftol"]}
    elif m == "Newton-CG":
        opts = {"maxiter": o["maxiter"], "xtol": o["xtol"]}
    elif m in ("dogleg", "trust-ncg", "trust-krylov", "trust-exact"):
        r0 = o["initial_trust_radius"] * w
        opts = {"maxiter": o["maxiter"], "gtol": o["gtol"], "initial_trust_radius": r0,
                "max_trust_radius": max(10 * w, r0)}
    elif m == "trust-constr":
        opts = {"maxiter": o["maxiter"], "gtol": o["gtol"], "xtol": o["xtol"],
                "initial_tr_radius": o["initial_tr_radius"] * w}
    if algo["grad"] and o.get("jac_mode") != "exact" and m == "trust-constr" and o["hess"] == "exact":
        kw["hess"] = so.BFGS()
        notes.append("유한차분 기울기에서는 trust-constr 가 정확 헤시안을 쓸 수 없어 BFGS 근사로 바꿨습니다.")

    def cb(xk, *_):
        path.append(np.array(xk, float).copy())

    res = so.minimize(rec.f, x0, method=m, callback=cb, options=opts, **kw)
    nit = int(getattr(res, "nit", len(path)) or len(path))
    return res.x, bool(res.success), str(res.message), nit, {}


def _run_global(prob, rec, algo, o, x0, notes, path):
    m = algo["key"]
    fs = rec.funs
    b = [tuple(r) for r in prob.bounds]
    lo, hi = prob.bounds[:, 0], prob.bounds[:, 1]
    w = hi - lo
    extra = {}
    stages = []
    if m == "dual_annealing":
        def cb(x, f, context):
            stages.append([*np.asarray(x, float), int(context)])
        res = so.dual_annealing(
            rec.f, b, maxiter=o["maxiter"], maxfun=o["maxfun"], initial_temp=o["initial_temp"],
            restart_temp_ratio=o["restart_temp_ratio"], visit=o["visit"], accept=o["accept"],
            no_local_search=o["no_local_search"], x0=x0 if o["use_x0"] else None, callback=cb,
            minimizer_kwargs={"method": "L-BFGS-B", "jac": rec.grad}, **_rng_kw(so.dual_annealing, o["seed"]))
        extra["stages"] = {"label": "새 최솟값 발견 (0 담금질 · 1 국소탐색 · 2 dual annealing)", "pts": stages}
    elif m == "differential_evolution":
        gens = []

        def cb(intermediate_result):
            gens.append(rec.nf)
        kw = {}
        if fs.cons:
            ni = fs.n_ineq
            lb = np.r_[np.full(ni, -np.inf), np.zeros(len(fs.cons) - ni)]
            kw["constraints"] = so.NonlinearConstraint(fs.c, lb, np.zeros(len(fs.cons)))
        res = so.differential_evolution(
            rec.f, b, strategy=o["strategy"], maxiter=o["maxiter"], popsize=o["popsize"],
            mutation=(min(o["mutation_lo"], o["mutation_hi"]), max(o["mutation_lo"], o["mutation_hi"])),
            recombination=o["recombination"], tol=o["tol"], init=o["init"], polish=o["polish"],
            callback=cb, **kw, **_rng_kw(so.differential_evolution, o["seed"]))
        extra["generations"] = gens
    elif m == "basinhopping":
        local = o["local"]
        if local == "auto":
            local = "SLSQP" if fs.cons else "L-BFGS-B"
        mk = {"method": local}
        if local in ("L-BFGS-B", "BFGS", "SLSQP"):
            mk["jac"] = rec.grad
        if local in ("L-BFGS-B", "SLSQP", "Nelder-Mead"):
            mk["bounds"] = b
        if fs.cons:
            if local == "SLSQP":
                mk["constraints"] = _scipy_constraints(fs)
            else:
                notes.append(f"국소 최적화 {local} 은 제약을 다루지 않아 제약을 무시했습니다 (SLSQP 를 고르세요).")

        def accept(f_new, x_new, f_old, x_old):
            x_new = np.asarray(x_new)
            return bool(np.all(x_new >= lo - 1e-12) and np.all(x_new <= hi + 1e-12))

        def cb(x, f, accepted):
            stages.append([*np.asarray(x, float), int(bool(accepted))])
        res = so.basinhopping(rec.f, x0, niter=o["niter"], T=o["T"], stepsize=o["stepsize"] * float(np.mean(w)),
                              minimizer_kwargs=mk, accept_test=accept, callback=cb,
                              **_rng_kw(so.basinhopping, o["seed"]))
        extra["stages"] = {"label": "점프 후 국소 최솟값 (1 수락 · 0 거절)", "pts": stages}
        res.success = True
    elif m == "shgo":
        kw = {}
        if fs.cons:
            kw["constraints"] = _scipy_constraints(fs)
        res = so.shgo(rec.f, b, n=o["n"], iters=o["iters"], sampling_method=o["sampling_method"],
                      callback=lambda xk: path.append(np.array(xk, float)),
                      minimizer_kwargs={"method": "SLSQP", "options": {"jac": rec.grad}}, options={"jac": rec.grad},
                      **kw)
        if getattr(res, "xl", None) is not None:
            extra["stages"] = {"label": "SHGO 가 찾은 국소 최솟값", "pts": [[*x, 1] for x in np.atleast_2d(res.xl)]}
    elif m == "direct":
        res = so.direct(rec.f, b, eps=o["eps"], maxfun=o["maxfun"], maxiter=o["maxiter"],
                        locally_biased=o["locally_biased"], callback=lambda xk: path.append(np.array(xk, float)))
    else:
        raise ValueError(m)
    nit = int(getattr(res, "nit", 0) or 0)
    msg = res.message
    if isinstance(msg, (list, tuple)):
        msg = "; ".join(map(str, msg))
    return res.x, bool(res.success), str(msg), nit, extra


class _IterCB(ca.Callback):
    """CasADi iteration callback: records every accepted iterate."""

    def __init__(self, nx, ng, sink, stop):
        ca.Callback.__init__(self)
        self.nx, self.ng, self.sink, self.stop = nx, ng, sink, stop
        self.construct("itercb", {})

    def get_n_in(self):
        return ca.nlpsol_n_out()

    def get_n_out(self):
        return 1

    def get_name_in(self, i):
        return ca.nlpsol_out(i)

    def get_name_out(self, i):
        return "ret"

    def get_sparsity_in(self, i):
        n = ca.nlpsol_out(i)
        if n == "f":
            return ca.Sparsity.scalar()
        if n in ("x", "lam_x"):
            return ca.Sparsity.dense(self.nx)
        if n in ("g", "lam_g"):
            return ca.Sparsity.dense(self.ng)
        return ca.Sparsity(0, 0)

    def eval(self, arg):
        self.sink.append((np.array(arg[0], float).ravel(), float(arg[1])))
        return [1 if (self.stop is not None and self.stop.is_set()) else 0]


def _run_casadi(prob, rec, algo, o, x0, notes, path):
    m = algo["key"]
    fs = rec.funs
    gexpr = ca.vertcat(*[c["expr"] for c in fs.cons]) if fs.cons else ca.SX(0, 1)
    ng = len(fs.cons)
    iters: list = []
    cb = _IterCB(prob.dim, ng, iters, rec.stop)
    opts = {"print_time": False, "iteration_callback": cb, "error_on_fail": False}
    if m == "ipopt":
        opts.update({"ipopt.print_level": 0, "ipopt.sb": "yes", "ipopt.max_iter": o["max_iter"],
                     "ipopt.tol": o["tol"], "ipopt.hessian_approximation": o["hessian_approximation"],
                     "ipopt.mu_strategy": o["mu_strategy"]})
    else:
        qp = o["qpsol"]
        qpo = {"qrqp": {"print_iter": False, "print_header": False, "print_info": False},
               "qpoases": {"printLevel": "none"},
               "osqp": {"osqp": {"verbose": False}}}[qp]
        qpo["error_on_fail"] = False
        opts.update({"qpsol": qp, "qpsol_options": qpo, "max_iter": o["max_iter"],
                     "tol_pr": o["tol"], "tol_du": o["tol"],
                     "hessian_approximation": o["hessian_approximation"],
                     "print_header": False, "print_iteration": False, "print_status": False})
    S = ca.nlpsol("S", m, {"x": prob.X, "f": prob.f_expr, "g": gexpr}, opts)
    ni = fs.n_ineq
    lbg = [-ca.inf] * ni + [0.0] * (ng - ni)
    r = S(x0=x0, lbx=prob.bounds[:, 0], ubx=prob.bounds[:, 1], lbg=lbg, ubg=[0.0] * ng)
    st = S.stats()
    for x, f in iters:
        path.append(x)
        rec.log(x, f)
    rec.nf = int(st.get("n_call_nlp_f", 0) + st.get("n_call_nlp_fg", 0))
    rec.ng = int(st.get("n_call_nlp_grad_f", 0) + st.get("n_call_nlp_jac_fg", 0))
    rec.nh = int(st.get("n_call_nlp_hess_l", 0))
    status = str(st.get("return_status", ""))
    extra = {"approx_curve": True}
    if m == "ipopt" and "iterations" in st:
        it = st["iterations"]
        extra["ipopt"] = {k: list(it.get(k, [])) for k in ("obj", "inf_pr", "inf_du", "mu", "alpha_pr")}
    return np.array(r["x"], float).ravel(), bool(st.get("success", False)), status, int(st.get("iter_count", len(iters))), extra


# ── entry point ─────────────────────────────────────────────────────
def _downsample(n: int, cap: int, log: bool = False) -> np.ndarray:
    if n <= cap:
        return np.arange(n)
    if log:
        idx = np.unique(np.round(np.geomspace(1, n, cap)).astype(int) - 1)
    else:
        idx = np.unique(np.round(np.linspace(0, n - 1, cap)).astype(int))
    return idx


def run(prob, key: str, options: dict | None, x0=None, stop: threading.Event | None = None,
        light: bool = False) -> dict:
    """light=True keeps only what the comparison views need."""
    if key not in BY_KEY:
        raise ValueError(f"알 수 없는 알고리즘: {key}")
    algo = BY_KEY[key]
    o = _opts(algo, options or {})
    from .problem import FunSet
    funs = FunSet(prob)
    rec = Recorder(funs, stop)
    notes: list[str] = []
    lo, hi = prob.bounds[:, 0], prob.bounds[:, 1]
    if x0 is None:
        x0 = prob.x0_default
    x0 = np.asarray(x0, float).ravel()
    if x0.size != prob.dim or not np.all(np.isfinite(x0)):
        raise ValueError(f"시작점은 숫자 {prob.dim}개")
    if np.any(x0 < lo) or np.any(x0 > hi):
        x0 = np.clip(x0, lo, hi)
        notes.append("시작점이 영역 밖이라 영역 안으로 옮겼습니다.")
    if funs.cons and not algo["cons"]:
        if algo["group"] == G_BAYES and funs.n_eq == 0:
            pass
        elif algo["group"] == G_BAYES:
            notes.append("등식 제약은 표본 기반 방법이 맞출 수 없어 무시했습니다 (부등식 제약은 지킵니다).")
        else:
            notes.append("이 방법은 제약식을 다루지 못해 제약을 무시하고 풀었습니다 — 결과가 제약을 어길 수 있습니다.")
    if not algo["bounds"]:
        notes.append("이 방법은 경계(탐색 영역)를 다루지 못합니다 — 영역 밖으로 나갈 수 있습니다"
                     + (" (데이터 대리모델은 영역 밖에 2차 벽을 둡니다)." if prob.data is not None else "."))
    if algo["hess"] and not prob.smooth:
        notes.append("목적 함수가 매끄럽지 않은 곳이 있어 헤시안이 정의되지 않는 점이 있습니다.")

    path: list[np.ndarray] = [x0.copy()] if algo["x0"] else []
    t0 = time.perf_counter()
    extra: dict = {}
    try:
        group = algo["group"]
        if group in (G_FREE, G_GRAD, G_HESS):
            x, ok, msg, nit, extra = _run_local(prob, rec, algo, o, x0, notes, path)
        elif group == G_GLOBAL:
            x, ok, msg, nit, extra = _run_global(prob, rec, algo, o, x0, notes, path)
        elif group == G_CASADI:
            x, ok, msg, nit, extra = _run_casadi(prob, rec, algo, o, x0, notes, path)
        else:
            if key == "bo_gp":
                extra = bayes.run_gp(prob, rec, o, o["seed"])
            elif key in ("optuna_tpe", "optuna_gp"):
                extra = bayes.run_optuna(prob, rec, o, o["seed"], "tpe" if key == "optuna_tpe" else "gp")
            else:
                extra = bayes.run_random(prob, rec, o, o["seed"])
            nit = extra.pop("nit")
            bx = rec.best()
            x, ok, msg = bx[0], True, f"평가 {rec.nf}회 중 최선"
    except BudgetExceeded:
        bx = rec.best()
        x, ok, msg, nit = bx[0], False, f"평가 한도 {MAX_EVALS:,}회 초과 — 그때까지의 최선", len(path)
    elapsed = time.perf_counter() - t0
    x = np.asarray(x, float).ravel()

    f = funs.f(x)
    out = {
        "algo": key, "label": algo["label"], "group": algo["group"], "options": o,
        "x0": x0 if algo["x0"] else None, "x": x, "f": f, "f_true": funs.true_f(x),
        "violation": funs.violation(x), "gap": f - prob.ref_f, "dist": prob.nearest_global(x),
        "basin": prob.basin(x), "success": ok, "message": msg, "nit": nit,
        "nfev": rec.nf, "njev": rec.ng, "nhev": rec.nh, "time": elapsed, "notes": notes,
    }
    # best-so-far (feasible) against the number of evaluations
    fsv = np.asarray(rec.fs, float)
    feas = np.asarray(rec.feas, bool)
    if fsv.size:
        masked = np.where(feas & np.isfinite(fsv), fsv, np.inf)
        best = np.minimum.accumulate(masked)
        idx = _downsample(best.size, MAX_CURVE, log=True)
        if extra.get("approx_curve"):  # CasADi: iterates spread over the solver's evaluation count
            n_at = np.round(np.linspace(1, max(rec.nf, best.size), best.size)).astype(int)
        else:
            n_at = np.arange(1, best.size + 1)
        out["curve"] = {"n": n_at[idx], "best": best[idx], "approx": bool(extra.get("approx_curve"))}
    else:
        out["curve"] = {"n": [], "best": [], "approx": False}

    # path: iterates for local/CasADi methods, incumbents (best so far) otherwise
    if algo["group"] in (G_GLOBAL, G_BAYES) and fsv.size:
        inc, cur = [], np.inf
        for xi, fi, ok_i in zip(rec.xs, rec.fs, rec.feas):
            if ok_i and fi < cur:
                cur = fi
                inc.append(xi)
        if not np.allclose(inc[-1] if inc else x, x):
            inc.append(x)
        P = np.array(inc) if inc else x[None, :]
        out["path_kind"] = "incumbent"
    else:
        if not path or not np.allclose(path[-1], x):
            path.append(x)
        P = np.array(path)
        out["path_kind"] = "iterate"
    pi = _downsample(len(P), MAX_PATH)
    P = P[pi]
    out["path"] = {"x": P, "f": [funs.f(p) for p in P]}

    if not light:
        n = len(rec.xs)
        ei = _downsample(n, MAX_EVAL_LOG)
        out["evals"] = {"x": sig(np.array(rec.xs)[ei], 6) if n else [], "f": sig(fsv[ei], 6) if n else [],
                        "idx": ei + 1}
        out["extra"] = extra
    return out
