# 2D Robot Arm Simulator

2관절(2-DOF) 평면 로봇 암 시뮬레이터. 위치 **A(Pick)** 에서 위치 **B(Place)** 로 물체를 옮기기 위한 다양한 관절 각도 경로를 자동으로 탐색·비교합니다.

최종 목표는 다물체동역학(MBD) 툴로 로봇 암 응력을 해석하는 것이며, 그 전 단계로 기하학적으로 다양한 경로를 탐색하는 것이 목적입니다.

---

## 실행 방법

1. `RobotArmSimulator.exe` 를 더블클릭합니다.
2. 검정색 콘솔 창이 하나 뜨고, 잠시 후 기본 브라우저에서 자동으로 페이지가 열립니다.
3. 종료하려면 콘솔 창을 닫으면 됩니다.

> **중요**: 콘솔 창은 내장 웹서버입니다. 시뮬레이터를 쓰는 동안 닫지 마세요.
>
> Windows SmartScreen이 "알 수 없는 게시자" 경고를 띄울 수 있습니다. `추가 정보 → 실행`으로 넘어가면 됩니다. (코드 서명이 되어 있지 않을 뿐, 바이러스는 아닙니다.)

---

## 로봇 암 기구학

- **Forward Kinematics (FK)**: 관절 각도 `(θ1, θ2)` → 말단 위치 `(x, y)`
- **Inverse Kinematics (IK)**: 목표 위치 `(x, y)` → 관절 각도, 기하학적 해법(Law of Cosines) 사용
- **2개의 IK 해**: `Elbow-Up` / `Elbow-Down` 두 가지 팔꿈치 구성
- **작업공간(Workspace)**: 도달 가능 영역은 `|L1 − L2| ≤ r ≤ L1 + L2` 인 환형(annulus) 영역으로 시각화됩니다.

---

## 경로는 어떻게 생성되나?

`Explore Paths` 버튼을 누르면, 6가지 전략으로 A→B 경로를 **동시에** 생성합니다. 각 경로는 80개의 웨이포인트로 샘플링됩니다.

| # | 전략 | 산업 명령어 | 원리 |
|---|------|------------|------|
| 1 | **Joint Linear** | MoveJ / PTP | 관절공간에서 `θ1`, `θ2` 를 선형 보간. IK 불필요, 특이점(singularity) 면역. 말단은 곡선을 그립니다. |
| 2 | **Cartesian Linear** | MoveL / LIN | 카테시안 공간에서 직선. 매 스텝마다 IK를 풀어 관절 각도를 구합니다. 말단이 정확한 직선을 그립니다. |
| 3 | **Via-Point Spline** | Zone / APO / CNT | 중간에 랜덤 경유점을 두고 2차 Bezier 곡선으로 부드럽게 경유. |
| 4 | **Elbow Switch** | confdata / STATUS | 팔꿈치 구성을 `Up → Down` (또는 반대)으로 시그모이드 블렌드 전환하면서 이동. |
| 5 | **Cubic Polynomial** | 내부 보간 엔진 | `q(t) = a0 + a1·t + a2·t² + a3·t³`. 경계 속도 `v0`, `v1` 을 바꿔 "부드럽게", "빠른 출발", "오버슛" 등 변형 생성. |
| 6 | **Circular Arc** | MoveC / CIRC 변형 | 관절공간에서 직선 경로에 수직 오프셋을 주어 원호(Quadratic Bezier) 궤적 생성. |

각 전략은 Elbow-Up / Elbow-Down 조합으로 보통 2개씩 만들어지므로, 기본적으로 10개 이상의 후보 경로가 나옵니다.

---

## 비용 메트릭 (경로 순위)

생성된 모든 경로는 아래 4가지 지표로 평가되어 점수가 매겨집니다.

| 지표 | 의미 | 가중치 |
|------|------|--------|
| **Joint Travel** | 관절 이동 총합 (rad) | 1.0 |
| **Cartesian Length** | 말단 이동 거리 (px) | 0.005 |
| **Max Joint Velocity** | 구간별 최대 관절 각속도 (피크 토크 관련) | 5.0 |
| **Smoothness** | 2차 차분 총합 (가속도 변화 = jerk 관련) | 3.0 |

> `Total Cost = 1.0·JointTravel + 0.005·CartesianLen + 5.0·MaxJointVel + 3.0·Smoothness`

점수가 **낮을수록 좋은 경로** 입니다. 관절 제한을 위반한 경로는 뒤로 밀리고 `✗` 로 표시됩니다.

---

## 사용법

1. **암 파라미터**: 좌측 패널의 `L1`, `L2` 슬라이더로 링크 길이 조절
2. **(선택) 관절 제한**: `Enable Joint Limits` 체크 후 `θ1 / θ2` 의 min/max 설정
3. **Pick/Place 지정**: 슬라이더 또는 메인 캔버스에서 빨간점(A) / 초록점(B)을 **드래그**
4. **Explore Paths** 클릭 → 다양한 경로가 색상별로 그려지고, 좌측 패널에 순위 목록이 생깁니다.
5. 경로 목록에서 원하는 항목을 클릭하면 해당 경로가 하이라이트되고 상세 지표가 표시됩니다.
6. **Play** 버튼으로 선택 경로를 따라 로봇 암이 애니메이션되며 박스를 운반합니다. `Speed` 로 속도 조절.

### 시각화 (3개 뷰)

- **메인 캔버스**: 로봇 암, 작업공간 환형 영역, 모든 경로 궤적, A/B 마커, 박스
- **관절공간 그래프**: `θ1 vs θ2` 좌표계에 모든 경로 + (활성화 시) 관절 제한 영역
- **카테시안 궤적 그래프**: `X vs Y` 에 말단 경로

### 인터랙션 팁

- 캔버스에서 A/B 마커를 **직접 드래그**할 수 있습니다.
- `Number of Paths` 슬라이더로 생성 후보 수를 조절합니다.
- 전략 체크박스를 끄면 해당 전략은 생성되지 않습니다.

---

## 참고 문헌

- Craig, J.J. *Introduction to Robotics: Mechanics and Control* — Ch.4 (IK), Ch.7 (Trajectory)
- Siciliano, B. et al. *Robotics: Modelling, Planning and Control* — Ch.2, Ch.4
- Spong, M.W. et al. *Robot Modeling and Control* — Ch.3, Ch.7
- Lynch, K.M. & Park, F.C. *Modern Robotics* — Ch.6, Ch.9
- 산업 로봇 모션 명령어: ABB RAPID (`MoveJ/L/C`), KUKA KRL (`PTP/LIN/CIRC`), FANUC TP, UR Script

---

## 기술 정보

- 프런트엔드: Vanilla JavaScript (ES6 Modules) + Canvas 2D API
- 런처: 내장 Python HTTP 서버 (PyInstaller `--onefile` 로 패키징)
- 포트: 기본 `3005`, 사용 중이면 자동으로 다음 빈 포트로 이동
- 외부 인터넷 연결 불필요 (모두 로컬에서 동작)
