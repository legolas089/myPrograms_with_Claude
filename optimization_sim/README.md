# Optimization Sim

1·2차원 함수나 데이터를 최소화하면서 최적화 알고리즘들을 같은 문제 위에서 비교하는 시뮬레이터.
SciPy `minimize` 의 국소 방법 15종, SciPy 전역 최적화 5종, CasADi NLP 솔버(IPOPT·SQP), 베이지안 최적화(GP 직접 구현·Optuna TPE/GP)와 무작위 탐색 기준선 — 모두 26개.

**실행**: `Optimization Sim.bat` 더블클릭 (http://localhost:5003 — 고정 포트, 이미 실행 중이면 브라우저만 연다) · 통합 런처에서 열면 백엔드가 자동으로 뜬다.

## 구조

화면은 웹(Plotly), 계산은 Python 백엔드. 문제는 서버에 만들어 두고(최대 8개), 화면에는 지형 격자·경로·통계만 보낸다.

```
optimization_sim/
├── server.py            Flask API + 정적 파일 (포트 5003), 비교·다중 시작은 백그라운드 작업
├── launcher.py          .bat 이 실행하는 진입점 (패키지 없으면 안내창)
├── optim/               최적화 엔진 — Flask 와 무관
│   ├── functions.py     테스트 함수 25종 (1D 7 · 2D 18) — CasADi 식, 기본 영역, 문헌 최솟값
│   ├── expr.py          안전한 수식 파서 (목적 함수·제약식 → CasADi, eval 안 씀)
│   ├── surrogate.py     데이터 → 대리모델 (RBF · GP · 스플라인 · 선형) → CasADi 보간
│   ├── problem.py       문제 정의, 격자 전수 탐색으로 기준 전역 최솟값·국소 최솟값
│   ├── algorithms.py    알고리즘 카탈로그와 실행기 (평가 기록, 경로, 수렴 곡선)
│   ├── bayes.py         GP 베이지안 최적화, Optuna TPE/GP, 무작위 탐색
│   ├── batch.py         알고리즘 비교 · 다중 시작 테스트
│   ├── loaders.py       붙여넣기·CSV·TSV·TXT·XLSX 파싱 (Data Analysis Sim 과 같음)
│   └── jsonsafe.py      NaN/∞ 를 JSON 으로, 큰 격자 유효숫자 줄이기
├── tests/test_optim.py  문헌값·알려진 해와 대조 (python 으로 바로 실행)
├── index.html, css/, js/    화면
```

## 문제 만들기 (왼쪽)

- **테스트 함수** — 1차원 f(x) 7종(Forrester, Gramacy & Lee, 사인 합, 기울어진 이중 우물, Rastrigin, Ackley, 2차 함수), 2차원 f(x, y) 18종(회전 타원, Rosenbrock, Himmelblau, Rastrigin, Ackley, Beale, Booth, Matyas, Three/Six-hump camel, Branin, McCormick, Goldstein–Price, Levy, Styblinski–Tang, Easom, Eggholder, Bukin N.6), 또는 **직접 입력** 수식(`x^4 - 2*x^2 + 0.3*x`, 변수 x·y, sin cos tan exp log sqrt abs tanh min max …)
  - 파라미터(예: Rosenbrock a·b, 타원 조건수 κ·회전 θ, Rastrigin A)와 탐색 영역을 바꿀 수 있다
- **목적 함수로 쓸 것**
  - *참 함수 그대로*: 해석식. 기울기·헤시안은 CasADi 자동미분으로 정확하게
  - *샘플 데이터 → 대리모델*: 함수에서 N개 점을 뽑고(LHS · 균등 · Sobol · 격자, seed 고정, 잡음 σ = f 범위의 %), 그 데이터로 만든 대리모델을 최소화. 최적점의 **참 함수 값**과 참 최솟값을 함께 보여 줘 "데이터로 최적화하면 얼마나 틀리는가"를 본다
- **내 데이터** — CSV·TXT·XLSX 끌어놓기 또는 붙여넣기. 열 x, f (1차원) 또는 x, y, f (2차원)를 고른다. 탐색 영역 = 데이터의 x(, y) 범위
- **대리모델** — RBF(thin-plate, 평활화 λ), 가우시안 과정(Matérn 5/2 + 잡음 자동 추정), 3차 스플라인/Clough–Tocher, 선형 보간. 맞춘 모델을 촘촘한 격자(1D 1001점, 2D 121×121)에서 계산해 CasADi B-스플라인(선형은 선형 보간)으로 만들므로 모든 솔버가 그 위에서 정확한 기울기·헤시안을 쓴다. 영역 밖은 2차 벽(경계를 다루지 못하는 BFGS·CG 등이 빠져나가지 않게)
- **제약식** — 한 줄에 하나, `x^2 + y^2 <= 1`, `x + y >= 0.5`, `x - y = 0` (최대 4개)

## 탭

### 문제 · 지형
- 1차원 곡선 / 2차원 등고선(색 로그 축, 3D 표면), 데이터 점, 국소 최솟값 ▽, 기준 전역 최솟값 ★, 제약 위반 영역(어둡게)·등식 제약(점선)
- **기준 해**: 1·2차원이므로 영역 전체를 격자(1D 20,001점 · 2D 401×401)로 계산하고 낮은 후보들을 SLSQP/L-BFGS-B 로 다듬어 전역 최솟값을 정한다 (Himmelblau·Branin 처럼 같은 높이 최솟값이 여럿이면 모두). 문헌값과 나란히 표시
- 국소 최솟값 목록(격자에서 이웃보다 낮은 점을 다듬은 것), 실현가능 영역 비율, 대리모델 RMSE·추정 잡음
- 그래프를 클릭하면 그 점이 시작점이 된다

### 단일 실행
- 알고리즘을 고르면 설명과 특성(기울기·헤시안 사용, 경계·제약 지원, 시작점 사용, 확률적)이 나오고, 옵션 폼은 백엔드 카탈로그에서 만들어진다. 길이 옵션(초기 신뢰반경·심플렉스 크기·점프 크기)은 영역 폭 비율
- 기울기 방법은 **정확(CasADi) / 유한차분 2점 / 3점**을 고를 수 있다. 유한차분이면 그 f 호출도 평가 수에 들어간다
- 결과: 최종 f, f − f*, 전역 도달 여부, 함수·기울기·헤시안 평가 수, 반복, 시간, 제약 위반, (대리모델이면) 참 함수 값, 솔버 메시지
- **탐색 경로**: 국소·CasADi 방법은 반복점, 전역·표본 방법은 '지금까지의 최선점'이 바뀐 곳. 함수를 계산한 모든 위치를 평가 순서대로(흰→빨강) 겹쳐 그린다. Dual Annealing·Basin-hopping·SHGO 는 단계별 국소 최솟값도 표시
- **수렴**: 각 평가의 f 와 지금까지 최선 f − f* (로그) 대 평가 수
- **베이지안 최적화 단계 보기**: 단계 슬라이더/재생으로 GP 평균 ± 2σ·획득함수(1D), 평균·표준편차·획득함수 히트맵(2D)과 다음 평가점
- **IPOPT 반복 정보**: inf_pr · inf_du · 장벽 μ

### 알고리즘 비교
- 같은 시작점에서 여러 알고리즘을 한 번에 (백그라운드 작업, 진행률·취소). 옵션은 단일 실행 탭에서 바꾼 값
- 결과 표(f 순), 최선 f − f* 대 평가 수 겹쳐 보기, 경로 겹쳐 보기(행을 누르면 강조)

### 다중 시작 테스트
- Sobol 무작위 시작점 M개(모든 알고리즘에 같은 점), 확률적 방법은 시작마다 seed + i
- 알고리즘별 전역 도달률, 오차 중앙값·IQR·최악, 평가 수·시간 중앙값, 도달한 서로 다른 분지 수 — 허용오차를 바꾸면 바로 다시 계산
- 최종 오차 분포(상자 + 점), 중앙값 수렴 곡선(25~75% 띠), **출발점 지도**(초록 = 전역 도달, 빨강 = 실패 → 국소 방법의 끌림 영역이 보인다)
- 한도: 시작점 ≤ 200, 시작점 × 알고리즘 ≤ 3000, 실행 한 번의 평가 ≤ 100,000

## 알고리즘

| 그룹 | 알고리즘 | 라이브러리 |
|---|---|---|
| 국소 · 미분 없음 | Nelder–Mead, Powell, COBYLA, COBYQA | `scipy.optimize.minimize` |
| 국소 · 기울기 | CG, BFGS, L-BFGS-B, TNC, SLSQP | `scipy.optimize.minimize` |
| 국소 · 헤시안 | Newton-CG, dogleg, trust-ncg, trust-krylov, trust-exact, trust-constr | `scipy.optimize.minimize` |
| 전역 | Dual Annealing, 차분 진화(DE), Basin-hopping, SHGO, DIRECT | `scipy.optimize` |
| CasADi NLP | IPOPT(정확 헤시안 / L-BFGS, μ 전략), SQP(qrqp · qpOASES · OSQP) | `casadi.nlpsol` |
| 베이지안 · 표본 | GP 베이지안 최적화(EI · PI · LCB, Matérn/RBF, 잡음 추정), Optuna TPE, Optuna GP, 무작위 탐색 | scikit-learn, Optuna |

- 제약식: SLSQP · COBYLA(등식은 부등식 두 개로) · COBYQA · trust-constr · DE · SHGO · Basin-hopping(국소 SLSQP) · IPOPT · SQP 가 지킨다. 베이지안·무작위 탐색은 부등식 제약을 아는 식으로 보고 후보에서 뺀다(등식은 무시). 나머지는 무시하고 화면에 알린다
- 경계: CG · BFGS · Newton-CG · dogleg · trust-ncg/krylov/exact 는 경계를 다루지 못한다(영역 밖으로 나갈 수 있음)
- 평가 수: SciPy·베이지안은 모든 f 호출을 기록한다. CasADi 는 함수 호출을 하나씩 볼 수 없어 솔버 통계의 호출 수를 쓰고, 수렴 곡선은 반복점을 총 평가 수에 고르게 배치한 근사(점선)
- 전역 도달 = f − f* ≤ 허용오차(기본 10⁻⁴ × (f 중앙값 − f*) + 10⁻⁹) 이면서 제약 위반 ≤ 10⁻⁶
- Optuna GP 는 처음 실행할 때 PyTorch 를 불러오느라 몇 초 걸린다

## 검증

```bash
python optimization_sim/tests/test_optim.py
```

수식 파서의 거부 규칙, 기준 해와 문헌값(Rosenbrock, Himmelblau 4개, Branin 3개, Six-hump camel, Eggholder 경계 최솟값, Forrester, 원판 제약 Rosenbrock (0.7864, 0.6177), 등식 제약 투영), 대리모델이 데이터를 지나는지·GP 잡음 추정, 모든 알고리즘의 볼록 문제 수렴, 유한차분 평가 수 집계, 제약 준수, 다중 시작의 분지 수·취소를 확인한다.

## 필요 패키지

```bash
python -m pip install flask flask-cors numpy scipy pandas openpyxl casadi scikit-learn optuna
```

Optuna GP 를 쓰려면 PyTorch(`torch`)도 필요하다 (없으면 그 알고리즘만 오류).
